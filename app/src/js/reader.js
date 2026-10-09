/**
 * reader.js — Lecteur multi-format : PDF, EPUB, Markdown, galerie d'images, audio.
 * Chaque format expose la même interface interne : rendu, localisation, extraction du texte pour la voix.
 */
import { saveProgress, getProgress, formatBytes, isCached } from './store.js';
import { splitSentences } from './tts.js';
import { highlight as surligner, clearHighlight as effacer, indexSentences } from './sentences.js';
import { mesurer, resumer } from './progress.js';
import { aplatir, filtrerPhrases } from './lisibilite.js';
import { chercherPageAvecTexteDe } from './pdf-recherche.js';
import { renderGallery, renderAudio } from './viewers.js';
import * as miniplayer from './miniplayer.js';

const $ = (id) => document.getElementById(id);
export const url = (p) => '../' + p.split('/').map(encodeURIComponent).join('/');

let pdfjs = null;
let lastStageWidth = 0;
let renderToken = 0;
let pendingRender = null;
let resizeObs = null;
let resizeTimer = null;
async function getPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('../../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

/** État du volume ouvert. Consommé par app.js pour la barre vocale. */
export const session = {
  book: null, volume: null, vIndex: 0, kind: null,
  page: 1, pages: 1, doc: null, rendition: null, sentences: [], spans: [],
  chars: 0, sections: 0, audioTime: 0,
};

const stage = () => $('stage');
const spinner = (msg) => { stage().innerHTML = `<div class="loading"><div class="sp"></div><p>${msg}</p></div>`; };
const fail = (title, detail) => {
  // Le détail peut reprendre un message d'erreur brut : il s'affiche, il ne s'interprète pas.
  stage().innerHTML = `<div class="err"><b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span></div>`;
};

/* ═══════════════ Surlignage des phrases ═══════════════ */

/* ═══════════════ Surlignage (délégué à sentences.js) ═══════════════ */

export { indexSentences } from './sentences.js';

/** Surligne la phrase i du document en cours. */
export const highlight = (i, follow = true) => surligner(session.spans, i, follow);
export const clearHighlight = () => effacer(session.spans);

/* ═══════════════ PDF ═══════════════ */

async function openPdf(volume) {
  spinner('Ouverture du document');
  const lib = await getPdfjs();
  const task = lib.getDocument({ url: url(volume.path), cMapUrl: '', disableAutoFetch: false });
  session.doc = await task.promise;
  session.pages = session.doc.numPages;
  session.kind = 'pdf';

  stage().innerHTML = `<div class="pdf-wrap"><div class="pdf-page" id="pdfPage"></div>
    <p class="pdf-hint">Flèches ← → pour tourner les pages · la lecture vocale enchaîne les pages toute seule</p></div>`;

  $('pager').hidden = false;
  $('pageTotal').textContent = session.pages;
  const range = $('pageRange'); range.max = session.pages; range.min = 1;
  $('pageInput').max = session.pages;

  const saved = await getProgress(progressId());
  const cible = session.locate?.page;
  await renderPdfPage(cible ? Math.min(cible, session.pages)
    : (saved?.page && saved.page <= session.pages ? saved.page : 1));
  watchResize();
}

/** Re-rend la page courante quand la largeur disponible change (fenêtre, sommaire, rotation). */
function watchResize() {
  resizeObs?.disconnect();
  if (!('ResizeObserver' in window)) return;
  resizeObs = new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (!w || Math.abs(w - lastStageWidth) < 40) return;   // ignore le bruit et les viewports nuls
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (session.kind === 'pdf') renderPdfPage(session.page); }, 180);
  });
  resizeObs.observe(stage());
}

/**
 * Va à la page n. Le texte est prêt dès le retour de la promesse ; le dessin du canvas
 * se poursuit en arrière-plan. C'est essentiel pour la lecture vocale : dans un onglet
 * masqué, le rendu graphique est gelé par le navigateur alors que la voix, elle, continue.
 */
export async function renderPdfPage(n) {
  if (!session.doc) return;
  session.page = Math.max(1, Math.min(n, session.pages));
  const page = await session.doc.getPage(session.page);

  // 1. Le texte d'abord — aucune dépendance à l'affichage.
  const tc = await page.getTextContent();
  const text = tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');
  // Un PDF numérisé rend aussi le bruit des planches et des gravures : on l'écarte
  // avant la lecture vocale. Réservé aux PDF — les textes saisis sont fiables.
  session.sentences = filtrerPhrases(splitSentences(text));
  session.spans = [];

  const input = $('pageInput'), range = $('pageRange');
  if (input) input.value = session.page;
  if (range) { range.max = session.pages; range.value = session.page; }
  persist();

  // 2. Le dessin ensuite, sans bloquer l'appelant.
  drawPage(page).catch((e) => { if (e?.name !== 'RenderingCancelledException') console.warn('Rendu PDF :', e); });
}

/** Dessine la page sur un canvas, en annulant tout rendu encore en cours. */
async function drawPage(page) {
  const token = ++renderToken;
  try { pendingRender?.cancel(); } catch {}

  const host = $('pdfPage');
  if (!host) return;

  // Un onglet en arrière-plan ou une fenêtre réduite donne une largeur nulle.
  const width = stage().clientWidth || lastStageWidth || 900;
  lastStageWidth = width;
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.max(0.4, Math.min(width - 44, 1000) / base.width) });

  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = viewport.width + 'px';
  canvas.style.height = viewport.height + 'px';
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.scale(dpr, dpr);

  pendingRender = page.render({ canvasContext: ctx, viewport });
  await pendingRender.promise;
  pendingRender = null;

  if (token !== renderToken) return;        // une autre page a été demandée entre-temps
  host.replaceChildren(canvas);
  stage().scrollTop = 0;
}

/* ═══════════════ Markdown ═══════════════ */

async function openMarkdown(volume) {
  spinner('Chargement du texte');
  const res = await fetch(url(volume.path));
  // Le code HTTP doit remonter : c'est lui qui distingue « fichier absent » (404)
  // de « source injoignable » (503 du service worker hors connexion).
  if (!res.ok) throw new Error(`Réponse ${res.status} du serveur`);
  const md = await res.text();

  const doc = document.createElement('article');
  doc.className = 'doc';
  doc.innerHTML = window.marked.parse(md, { mangle: false, headerIds: true });
  stage().replaceChildren(doc);
  session.kind = 'md';

  const { sentences, spans } = indexSentences(doc);
  session.sentences = sentences;
  session.spans = spans;
  session.chars = doc.textContent.length;      // sert à convertir le texte en pages

  buildToc(doc.querySelectorAll('h1, h2, h3'), (el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));

  if (session.locate?.norm) reperer(doc, session.locate.norm);

  if (!session.skipRestore) {
    const saved = await getProgress(progressId());
    // Minuteur plutôt que requestAnimationFrame : ce dernier est gelé dans un onglet
    // masqué, et la position enregistrée n'aurait jamais été restaurée.
    if (saved?.scroll) {
      const remettre = () => { stage().scrollTop = saved.scroll; };
      remettre();
      setTimeout(remettre, 120);
    }
  }
  stage().addEventListener('scroll', onScroll, { passive: true });
}

/** Défile jusqu'au bloc contenant le passage recherché et le met en lumière. */
function reperer(doc, brut) {
  // Puces, numéros et ponctuation d'ouverture n'existent pas dans le rendu : on les ignore.
  const norm = String(brut || '').replace(/^\s*(?:[-*+•]|\d+[.)])\s*/, '').replace(/^[\s«"'(]+/, '');
  const blocs = [...doc.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, td, dd')]
    .map((el) => ({ el, plat: aplatir(el.textContent) }));
  // Clé de plus en plus courte : un passage peut chevaucher plusieurs blocs rendus.
  let cible = null;
  for (const n of [60, 40, 25, 15]) {
    const cle = norm.slice(0, n).trim();
    if (cle.length < 8) break;
    cible = blocs.find((b) => b.plat.includes(cle))?.el || null;
    if (cible) break;
  }
  if (!cible) return;
  const viser = () => stage().scrollTo({ top: Math.max(0, cible.offsetTop - 90), behavior: 'instant' });
  viser(); setTimeout(viser, 120);               // pas de rAF : gelé en arrière-plan
  cible.classList.add('locate-flash'); setTimeout(() => cible.classList.remove('locate-flash'), 2800);
}

let scrollTimer = null;
function onScroll() {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(persist, 700);
}

/* ═══════════════ EPUB ═══════════════ */

async function openEpub(volume) {
  spinner('Ouverture du livre');
  session.kind = 'epub';

  const book = window.ePub(url(volume.path), { openAs: 'epub' });
  await withTimeout(book.opened, 20000, 'ouverture du fichier EPUB');
  session.sections = book.spine?.length || book.spine?.items?.length || 0;

  // Le sommaire est construit avant l'affichage : il reste utilisable même si
  // le rendu de la première section tarde.
  await book.loaded.navigation;
  const items = (book.navigation?.toc || [])
    .flatMap((t) => [t, ...(t.subitems || []).map((sub) => ({ ...sub, sub: true }))]);

  stage().innerHTML = '<div id="epubHost"></div>';
  const rendition = book.renderTo('epubHost', {
    width: '100%', height: '100%', flow: 'scrolled-doc', allowScriptedContent: false,
  });
  session.rendition = rendition;

  rendition.themes.register('nuit', {
    body: { background: '#12100e', color: '#e6dccb', 'font-family': 'Iowan Old Style, Palatino, Georgia, serif',
            'line-height': '1.85', padding: '30px 26px 80px', 'max-width': '74ch', margin: '0 auto' },
    'h1,h2,h3,h4': { color: '#e8c885', 'line-height': '1.3' },
    a: { color: '#e8c885' },
    p: { 'text-align': 'justify', margin: '0 0 1.15em' },
    '.spk': { background: 'rgba(217,164,65,.22)', 'border-radius': '4px' },
  });
  rendition.themes.select('nuit');
  rendition.themes.fontSize((parseInt(getComputedStyle(document.documentElement).getPropertyValue('--fs'), 10) || 18) + 'px');

  if (items.length) {
    const toc = $('toc');
    toc.innerHTML = '<h5>Sommaire</h5>' + items.map((t) =>
      `<a data-href="${escapeHtml(t.href)}" class="${t.sub ? 'lvl2' : ''}">${escapeHtml((t.label || '').trim())}</a>`).join('');
    toc.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => {
      toc.querySelectorAll('a').forEach((x) => x.classList.remove('active'));
      a.classList.add('active');
      rendition.display(a.dataset.href);
    }));
    $('tocBtn').hidden = false;
  }

  rendition.on('relocated', () => { indexEpubSection(); persist(); });

  const saved = await getProgress(progressId());
  await withTimeout(rendition.display(saved?.cfi || undefined), 20000, 'affichage de la section');
  indexEpubSection();
}

/** Rejette explicitement au lieu de rester bloqué indéfiniment sur une promesse d'epub.js. */
function withTimeout(promise, ms, what) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Délai dépassé lors de l'${what}`)), ms)),
  ]);
}

/** Récupère le texte de la section EPUB affichée et y pose les repères de phrases. */
function indexEpubSection() {
  try {
    const contents = session.rendition?.getContents?.() || [];
    const c = Array.isArray(contents) ? contents[0] : contents;
    if (!c?.document?.body) return;
    const { sentences, spans } = indexSentences(c.document.body, c.document);
    session.sentences = sentences;
    session.spans = spans;
  } catch { session.sentences = []; session.spans = []; }
}

/* ═══════════════ Galerie et audio (délégués à viewers.js) ═══════════════ */

function openGallery(volume) {
  session.kind = 'gallery';
  session.sentences = [];
  renderGallery(volume, stage(), url);
}

let detacherAudio = null;

/**
 * La lecture est déléguée au moteur persistant (miniplayer.js) : ouvrir cette vue
 * ne fait que reprendre ou afficher un livre déjà en cours ailleurs, sans jamais
 * l'interrompre en refermant le lecteur.
 */
async function openAudio(volume) {
  session.kind = 'audio';
  session.sentences = [];
  detacherAudio?.();
  const saved = await getProgress(progressId());
  const reprise = saved && saved.volume === session.vIndex ? saved : null;
  detacherAudio = renderAudio(volume, stage(), {
    book: session.book, vIndex: session.vIndex, mp: miniplayer,
    startTrack: reprise?.page ? Math.min(reprise.page - 1, volume.tracks.length - 1) : 0,
    startAt: reprise?.audioTime || 0,
  });
}

/* ═══════════════ Sommaire générique ═══════════════ */

function buildToc(headings, onClick) {
  const toc = $('toc');
  const list = [...headings];
  if (list.length < 2) { $('tocBtn').hidden = true; toc.hidden = true; return; }
  toc.innerHTML = '<h5>Sommaire</h5>';
  list.forEach((h, i) => {
    const a = document.createElement('a');
    a.textContent = h.textContent.trim();
    if (h.tagName === 'H3') a.className = 'lvl2';
    a.addEventListener('click', () => {
      toc.querySelectorAll('a').forEach((x) => x.classList.remove('active'));
      a.classList.add('active');
      onClick(h, i);
    });
    toc.appendChild(a);
  });
  $('tocBtn').hidden = false;
}

/* ═══════════════ Progression ═══════════════ */

/** Conserve l'appel existant de voicebar.js — l'algorithme vit dans pdf-recherche.js. */
export const chercherPageAvecTexte = (depart) => chercherPageAvecTexteDe(session.doc, depart, session.pages);

export const progressId = () => `${session.book?.id}:${session.vIndex}`;

export function persist() {
  if (!session.book) return;
  const st = stage();
  const loc = session.kind === 'epub' ? session.rendition?.currentLocation()?.start : null;

  const m = mesurer({
    kind: session.kind,
    page: session.page, pages: session.pages,
    scrollTop: st.scrollTop, scrollHeight: st.scrollHeight, clientHeight: st.clientHeight,
    chars: session.chars,
    section: loc?.index ?? 0, sections: session.sections,
    track: session.page, tracks: session.volume?.tracks?.length || 0,
  });

  saveProgress({
    id: progressId(),
    bookId: session.book.id,
    title: session.book.title,
    glyph: session.book.glyph,
    category: session.book.category,
    volume: session.vIndex,
    volumeLabel: session.volume?.label || '',
    kind: session.kind,
    page: session.page,
    total: session.pages,
    scroll: session.kind === 'md' ? st.scrollTop : 0,
    cfi: loc?.cfi || '',
    // Une mesure non fiable n'écrase rien : les champs sont simplement omis.
    ...(m.mesurable ? { percent: m.percent, read: m.read } : {}),
    audioTime: session.kind === 'audio' ? Math.floor(session.audioTime || 0) : 0,
    unitTotal: m.total, unit: m.unit, approx: m.approx,
  });

  const el = $('readerProg');
  if (el) {
    const texte = m.mesurable ? resumer(m) : '';
    el.hidden = !texte;
    el.textContent = texte;
  }
}

/* ═══════════════ Ouverture ═══════════════ */

/**
 * @param {object} [opts]
 * @param {boolean} [opts.skipRestore] Ne pas restaurer la position enregistrée —
 *   utilisé quand l'appelant vise déjà une section précise (lien depuis l'accueil).
 */
export async function openVolume(book, vIndex, opts = {}) {
  const volume = book.volumes[vIndex];
  session.skipRestore = !!opts.skipRestore || !!opts.locate;
  session.locate = opts.locate || null;      // { page } pour un PDF, { norm } pour un texte
  session.book = book; session.volume = volume; session.vIndex = vIndex;
  session.page = 1; session.pages = 1; session.doc = null; session.rendition = null;
  session.sentences = []; session.spans = [];
  session.chars = 0; session.sections = 0; session.audioTime = 0;

  detacherAudio?.(); detacherAudio = null;
  arreterMedias();
  stage().removeEventListener('scroll', onScroll);
  $('pager').hidden = true;
  $('toc').hidden = true;
  $('tocBtn').hidden = true;
  $('readerProg').hidden = true;             // sinon l'avancement du livre précédent reste affiché
  $('readerTitle').textContent = book.title;
  $('readerSub').textContent = `${volume.label} · ${book.author}`;

  try {
    if (volume.type === 'pdf') await openPdf(volume);
    else if (volume.type === 'md') await openMarkdown(volume);
    else if (volume.type === 'epub') await openEpub(volume);
    else if (volume.type === 'gallery') openGallery(volume);
    else if (volume.type === 'audio') await openAudio(volume);
    persist();
  } catch (err) {
    console.error(err);
    await explain(book, err);
  }
}

/**
 * Diagnostique l'échec d'ouverture. `navigator.onLine` ne suffit pas : il reste vrai
 * quand c'est la source des livres qui est injoignable, pas la machine.
 */
async function explain(book, err) {
  const msg = String(err?.message || err);
  const unreachable =
    /\b5\d\d\b|failed to fetch|networkerror|load failed|unexpected server response|délai dépassé|réponse 5\d\d/i.test(msg)
    || !navigator.onLine;
  const stored = await isCached(book).catch(() => false);

  if (unreachable) document.dispatchEvent(new CustomEvent('bs:source-ko'));

  if (unreachable && !stored) {
    // Distinguer les deux cas : sans cette nuance, on cherche un problème de réseau
    // alors que c'est simplement le serveur de la bibliothèque qui n'est pas lancé.
    if (!navigator.onLine) {
      return fail('Hors connexion, et ce livre n\'est pas téléchargé',
        `« ${book.title} » n'est pas encore sur cet appareil. Une fois reconnecté, ouvrez sa ` +
        'fiche et choisissez « Rendre disponible hors-ligne » : il vous suivra partout.');
    }
    return fail('La bibliothèque n\'est pas démarrée',
      `Votre connexion fonctionne, mais le serveur qui sert les livres ne répond pas. ` +
      'Lancez-le depuis le Terminal avec ./scripts/start.sh — ou téléchargez vos textes ' +
      'depuis leur fiche pour ne plus jamais en dépendre.');
  }
  if (unreachable) {
    return fail('Source injoignable',
      'Le livre est bien enregistré sur cet appareil, mais un de ses fichiers manque au cache. ' +
      'Reconnectez-vous et retéléchargez-le depuis sa fiche.');
  }
  if (/\b404\b|réponse 404/i.test(msg)) {
    return fail('Fichier introuvable',
      `Le fichier de « ${book.title} » n'est plus à l'emplacement attendu. ` +
      'Il a sans doute été déplacé ou renommé — relancez `node scripts/verify-catalog.mjs` pour le retrouver.');
  }
  fail('Impossible d\'ouvrir ce volume',
    `Le fichier est peut-être endommagé. Détail technique : ${msg}`);
}

/**
 * Coupe tout média en cours dans la scène.
 * Indispensable : retirer un <audio> du DOM n'interrompt pas sa lecture — le son
 * continuerait après la fermeture du lecteur, sans plus aucune commande à l'écran.
 */
function arreterMedias() {
  for (const el of stage().querySelectorAll('audio, video')) {
    try {
      el.pause();
      el.removeAttribute('src');
      el.load();                      // libère le flux et le tampon
    } catch {}
  }
}

export function closeVolume() {
  // La position d'un texte ne s'enregistre qu'à 700 ms du dernier défilement : refermer
  // avant ce délai la perdait. On l'enregistre tant que la scène est encore là.
  clearTimeout(scrollTimer);
  if (session.kind === 'md') persist();
  resizeObs?.disconnect(); resizeObs = null; clearTimeout(resizeTimer);
  try { pendingRender?.cancel(); } catch {}
  pendingRender = null;
  try { session.rendition?.destroy(); } catch {}
  try { session.doc?.destroy(); } catch {}
  // L'audio n'est plus arrêté ici : il vit dans le moteur persistant et continue
  // même si le lecteur se ferme. On se contente de ne plus écouter ses mises à jour.
  detacherAudio?.(); detacherAudio = null;
  arreterMedias();
  stage().removeEventListener('scroll', onScroll);
  stage().innerHTML = '';
  Object.assign(session, { book: null, volume: null, doc: null, rendition: null,
                           sentences: [], spans: [], audioTime: 0 });
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
