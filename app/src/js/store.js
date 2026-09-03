/**
 * store.js — Persistance locale.
 * IndexedDB pour la progression et les marque-pages, Cache API pour les livres hors-ligne.
 */

const DB_NAME = 'bibliotheque-spirituelle';
export const BOOK_CACHE = 'livres-v1';

let dbPromise = null;

/** Magasins nécessaires au fonctionnement. Toute absence est réparée à l'ouverture. */
const MAGASINS = {
  progress: { keyPath: 'id' },
  marks: { keyPath: 'key' },
  alarms: { keyPath: 'id' },
  done: { keyPath: 'key' },
  fulltext: { keyPath: 'key' },     // index de recherche dans les textes
};

const creerManquants = (db) => {
  for (const [nom, opts] of Object.entries(MAGASINS)) {
    if (!db.objectStoreNames.contains(nom)) db.createObjectStore(nom, opts);
  }
};

/**
 * Ouvre la base en s'adaptant au schéma existant.
 *
 * Un numéro de version figé ne suffit pas : si une autre partie du logiciel a déjà
 * fait évoluer la base, notre `onupgradeneeded` ne se déclenche jamais et nos magasins
 * n'apparaissent pas. On ouvre donc sans version, on regarde ce qui manque, et on
 * ne réouvre en écriture de schéma que si c'est nécessaire.
 */
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const premiere = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onupgradeneeded = () => creerManquants(req.result);   // base neuve
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const manquants = Object.keys(MAGASINS).filter((n) => !premiere.objectStoreNames.contains(n));
    if (!manquants.length) return premiere;

    const version = premiere.version + 1;
    premiere.close();
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, version);
      req.onupgradeneeded = () => creerManquants(req.result);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Base verrouillée par un autre onglet'));
    });
  })();
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  // Un magasin peut manquer si la base a été ouverte par une version antérieure du
  // code : mieux vaut un résultat vide qu'une exception qui casse toute la page.
  if (!db.objectStoreNames.contains(store)) return undefined;
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

/* ─────────── Progression de lecture ─────────── */

/**
 * Enregistre la progression. Le point le plus avancé est conservé : revenir en arrière
 * pour relire un passage ne doit pas faire retomber le pourcentage.
 */
export async function saveProgress(rec) {
  const ancien = await getProgress(rec.id);
  const maxPage = Math.max(rec.page || 0, ancien?.maxPage || 0);
  const percent = Math.max(rec.percent || 0, ancien?.percent || 0);
  return tx('progress', 'readwrite', (s) =>
    s.put({ ...ancien, ...rec, maxPage, percent, at: Date.now() }));
}

export const getProgress = (id) => tx('progress', 'readonly', (s) => s.get(id));
export const allProgress = () => tx('progress', 'readonly', (s) => s.getAll());

/** Derniers livres ouverts, du plus récent au plus ancien. */
export async function recent(limit = 4) {
  const all = (await allProgress()) || [];
  const byBook = new Map();
  for (const p of all.sort((a, b) => b.at - a.at)) if (!byBook.has(p.bookId)) byBook.set(p.bookId, p);
  return [...byBook.values()].slice(0, limit);
}

/* ─────────── Marque-pages ─────────── */

export const addMark = (m) =>
  tx('marks', 'readwrite', (s) => s.put({ ...m, key: `${m.bookId}:${m.volume}:${m.locator}`, at: Date.now() }));
export const removeMark = (key) => tx('marks', 'readwrite', (s) => s.delete(key));
export const marksFor = async (bookId) =>
  ((await tx('marks', 'readonly', (s) => s.getAll())) || []).filter((m) => m.bookId === bookId);

/* ─────────── Rappels de prière ─────────── */

/** La date de création borne l'historique : on ne compte pas comme manquée une prière
 *  programmée après coup. Les rappels antérieurs à cette règle en reçoivent une au premier passage. */
export const saveAlarm = (a) =>
  tx('alarms', 'readwrite', (s) => s.put({ createdAt: jourClef(), ...a }));
export const deleteAlarm = (id) => tx('alarms', 'readwrite', (s) => s.delete(id));
export const allAlarms = async () =>
  ((await tx('alarms', 'readonly', (s) => s.getAll())) || [])
    .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

/* ─────────── Programmes de prière ─────────── */

export const saveProgramme = (p) => tx('programmes', 'readwrite', (s) => s.put(p));
export const deleteProgramme = (id) => tx('programmes', 'readwrite', (s) => s.delete(id));
export const getProgramme = (id) => tx('programmes', 'readonly', (s) => s.get(id));
/** Du plus récemment commencé au plus ancien : un programme en cours prime sur un programme clos. */
export const allProgrammes = async () =>
  ((await tx('programmes', 'readonly', (s) => s.getAll())) || [])
    .sort((a, b) => String(b.debut).localeCompare(String(a.debut)));

/* ─────────── Prières accomplies ─────────── */

/** Clé du jour : une prière se fait chaque jour, l'historique est donc daté. */
export const jourClef = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const clefFaite = (alarmId, jour) => `${jour}::${alarmId}`;

export const marquerFaite = (alarmId, jour = jourClef()) =>
  tx('done', 'readwrite', (s) => s.put({ key: clefFaite(alarmId, jour), alarmId, jour, at: Date.now() }));

export const retirerFaite = (alarmId, jour = jourClef()) =>
  tx('done', 'readwrite', (s) => s.delete(clefFaite(alarmId, jour)));

/** Identifiants des prières accomplies un jour donné. */
export async function faitesDuJour(jour = jourClef()) {
  const tout = (await tx('done', 'readonly', (s) => s.getAll())) || [];
  return new Set(tout.filter((d) => d.jour === jour).map((d) => d.alarmId));
}

/** Historique brut, pour un bilan sur plusieurs jours. */
export const toutesLesFaites = () => tx('done', 'readonly', (s) => s.getAll());

/* ─────────── Index plein-texte ─────────── */

/** Écrit une liste de fragments en une seule transaction — des milliers de pages sinon. */
export async function saveChunks(chunks) {
  if (!chunks.length) return;
  const db = await open();
  if (!db.objectStoreNames.contains('fulltext')) return;
  await new Promise((resolve, reject) => {
    const t = db.transaction('fulltext', 'readwrite');
    const st = t.objectStore('fulltext');
    for (const c of chunks) st.put(c);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
export const allChunks = async () => (await tx('fulltext', 'readonly', (s) => s.getAll())) || [];
export const countChunks = async () => (await tx('fulltext', 'readonly', (s) => s.count())) || 0;
export const clearChunks = () => tx('fulltext', 'readwrite', (s) => s.clear());

/* ─────────── Réglages ─────────── */

const SETTINGS_KEY = 'bs:settings';
const DEFAULTS = { rate: 1, pitch: 1, voiceURI: '', fontSize: 18, follow: true, autoPage: true };

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

/* ─────────── Hors-ligne (Cache API) ─────────── */

/** Toutes les URL d'un livre, encodées (les MP3 contiennent des espaces). */
export function bookUrls(book) {
  const urls = [];
  for (const v of book.volumes) {
    if (v.type === 'gallery') urls.push(...v.images);
    else if (v.type === 'audio') urls.push(...v.tracks);
    else urls.push(v.path);
  }
  return urls.map((p) => '../' + p.split('/').map(encodeURIComponent).join('/'));
}

export const cacheSupported = () => 'caches' in self;

/** Un livre est-il entièrement disponible hors-ligne ? */
export async function isCached(book) {
  if (!cacheSupported()) return false;
  const cache = await caches.open(BOOK_CACHE);
  const hits = await Promise.all(bookUrls(book).map((u) => cache.match(u)));
  return hits.every(Boolean);
}

/**
 * Télécharge un livre dans le cache, fichier par fichier.
 * @param {(done:number,total:number)=>void} [onProgress]
 */
export async function cacheBook(book, onProgress) {
  if (!cacheSupported()) throw new Error('Cache indisponible');
  const cache = await caches.open(BOOK_CACHE);
  const urls = bookUrls(book);
  let done = 0;
  for (const url of urls) {
    if (!(await cache.match(url))) {
      const res = await fetch(url, { cache: 'reload' });
      if (!res.ok) throw new Error(`Téléchargement impossible : ${decodeURIComponent(url)}`);
      await cache.put(url, res);
    }
    onProgress?.(++done, urls.length);
  }
}

export async function uncacheBook(book) {
  if (!cacheSupported()) return;
  const cache = await caches.open(BOOK_CACHE);
  await Promise.all(bookUrls(book).map((u) => cache.delete(u)));
}

export async function clearBooks() {
  if (!cacheSupported()) return;
  await caches.delete(BOOK_CACHE);
}

/** Quota navigateur utilisé / disponible. */
export async function usage() {
  if (!navigator.storage?.estimate) return null;
  const { usage: used = 0, quota = 0 } = await navigator.storage.estimate();
  return { used, quota, ratio: quota ? used / quota : 0 };
}

/** Demande un stockage persistant pour éviter l'éviction automatique. */
export async function persist() {
  if (!navigator.storage?.persist) return false;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}

export const formatBytes = (b) => {
  if (!b) return '0 o';
  const u = ['o', 'Ko', 'Mo', 'Go'];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return `${(b / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
};
