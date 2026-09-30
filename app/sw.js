/**
 * sw.js — Service worker : coquille applicative en cache, livres servis hors connexion.
 * Deux caches distincts : « shell » (versionné, purgé à chaque mise à jour)
 * et « livres-v1 » (piloté par l'utilisateur, jamais purgé automatiquement).
 */
const SHELL = 'shell-v68';
const BOOKS = 'livres-v1';

const SHELL_FILES = [
  './', './index.html', './manifest.webmanifest',
  './src/css/app.css', './src/css/home.css', './src/css/reader.css',
  './src/css/alarms.css',
  './src/js/app.js', './src/js/library.js', './src/js/reader.js',
  './src/js/store.js', './src/js/tts.js', './src/js/home.js',
  './src/js/alarms.js', './src/js/progress.js', './src/js/sentences.js',
  './src/js/voicebar.js', './src/js/lisibilite.js', './src/js/viewers.js',
  './src/js/programmes.js', './src/css/programmes.css', './src/js/pdf-recherche.js',
  './src/js/miniplayer.js', './src/js/miniplayer-ui.js', './src/css/miniplayer.css',
  './src/js/pratique.js', './src/css/pratique.css', './src/js/recherche.js', './src/css/recherche.css',
  './src/js/dialogue.js', './src/js/sante.js', './src/js/stockage.js',
  './src/js/lecture-validation.js', './src/js/i18n.js',
  './src/data/catalog.json', './src/data/prayers.json',
  './vendor/pdf.min.mjs', './vendor/pdf.worker.min.mjs',
  './vendor/epub.min.js', './vendor/jszip.min.js', './vendor/marked.min.js',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // addAll échoue en bloc : on tolère les absences (icône PNG optionnelle)
    await Promise.all(SHELL_FILES.map((f) => cache.add(f).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL && k !== BOOKS).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/**
 * Répond à un en-tête Range depuis une réponse en cache.
 *
 * On passe par un Blob, jamais par un ArrayBuffer : `blob.slice()` est paresseux et
 * reste adossé au stockage, alors que `arrayBuffer()` chargerait tout le fichier en
 * mémoire à chaque requête. Sur un livre audio de 28 Mo, le navigateur en émet des
 * dizaines pendant l'écoute — de quoi saturer la mémoire et couper la lecture.
 */
async function rangeFrom(cached, rangeHeader) {
  const blob = await cached.blob();
  const size = blob.size;

  const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader || '');
  if (!m) return cached;

  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : size - 1;

  if (!m[1] && m[2]) {                       // forme « bytes=-500 » : les derniers octets
    start = Math.max(0, size - parseInt(m[2], 10));
    end = size - 1;
  }
  if (Number.isNaN(start) || Number.isNaN(end)) return cached;
  if (start >= size || start > end) {
    return new Response(null, { status: 416, statusText: 'Range Not Satisfiable',
                                headers: { 'Content-Range': `bytes */${size}` } });
  }
  if (end >= size) end = size - 1;

  return new Response(blob.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  const isShell = url.pathname.includes('/app/');
  const range = request.headers.get('range');

  // Test de santé : doit atteindre le vrai serveur, sans repli sur le cache,
  // sinon l'application se croirait connectée alors que la source est arrêtée.
  if (url.searchParams.has('ping')) return;

  event.respondWith((async () => {
    // 1. Livre déjà téléchargé → servi depuis le disque, même en ligne
    const bookHit = await caches.match(request, { cacheName: BOOKS, ignoreVary: true, ignoreSearch: true });
    if (bookHit) return range ? rangeFrom(bookHit.clone(), range) : bookHit;

    // 2. Page d'entrée et catalogue → réseau d'abord. Ce sont les deux fichiers qui
    //    changent quand la bibliothèque évolue ; « cache d'abord » aurait toujours
    //    un rechargement de retard. Repli sur le cache si le réseau manque.
    if (url.pathname.endsWith('/catalog.json') || url.pathname.endsWith('/prayers.json') || request.mode === 'navigate' ||
        url.pathname.endsWith('/app/') || url.pathname.endsWith('/index.html')) {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        if (fresh.ok) { (await caches.open(SHELL)).put(request, fresh.clone()); return fresh; }
      } catch {}
      const cached = await caches.match(request, { cacheName: SHELL, ignoreSearch: true });
      if (cached) return cached;
    }

    // 3. Coquille applicative → cache d'abord, rafraîchie en arrière-plan
    if (isShell) {
      const shellHit = await caches.match(request, { cacheName: SHELL, ignoreSearch: true });
      if (shellHit) {
        event.waitUntil((async () => {
          try {
            const fresh = await fetch(request);
            if (fresh.ok) (await caches.open(SHELL)).put(request, fresh.clone());
          } catch {}
        })());
        return shellHit;
      }
    }

    // 4. Réseau, avec repli sur le cache
    try {
      const res = await fetch(request);
      if (isShell && res.ok && !range) (await caches.open(SHELL)).put(request, res.clone());
      return res;
    } catch (err) {
      const any = await caches.match(request, { ignoreSearch: true, ignoreVary: true });
      if (any) return range ? rangeFrom(any.clone(), range) : any;
      if (request.mode === 'navigate') {
        const shell = await caches.match('./index.html', { cacheName: SHELL });
        if (shell) return shell;
      }
      return new Response(
        'Contenu indisponible hors connexion. Téléchargez ce livre depuis sa fiche pour le lire sans réseau.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
