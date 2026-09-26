/**
 * library.js — Rendu de la bibliothèque : navigation, rayons, cartes et fiche livre.
 */
import { formatBytes, isCached, cacheBook, uncacheBook, allProgress, persist } from './store.js';
import { escapeHtml, url } from './reader.js';
import { resumer } from './progress.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);

export const state = { catalog: null, prayers: [], query: '', progress: new Map(), cached: new Set() };

const FMT = { pdf: 'PDF', epub: 'EPUB', md: 'Texte', audio: 'Audio', gallery: 'Images' };
const ICO = { pdf: '▤', epub: '❐', md: '✎', audio: '♪', gallery: '❈' };

/** Date d'ajout d'un livre à la bibliothèque, en clair (« 26 septembre 2026 »). */
const FMT_AJOUT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const dateAjoutEnClair = (iso) => {
  if (!iso) return '';
  const [y, m, j] = iso.split('-').map(Number);
  return FMT_AJOUT.format(new Date(y, m - 1, j));
};

export const catOf = (id) => state.catalog.categories.find((c) => c.id === id);
export const bookOf = (id) => state.catalog.books.find((b) => b.id === id);

/** Livres d'une catégorie, dans l'ordre d'étude défini par le catalogue. */
const booksIn = (catId) =>
  state.catalog.books.filter((b) => b.category === catId).sort((a, b) => a.order - b.order);

/* ═══════════════ Recherche ═══════════════ */

const haystack = (b) =>
  [b.title, b.subtitle, b.author, b.era, b.summary, ...(b.tags || []), catOf(b.category)?.name]
    .join(' ').toLowerCase();

const matches = (b) => {
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const hay = haystack(b);
  return q.split(/\s+/).every((word) => hay.includes(word));
};

/* ═══════════════ Recherche dans les prières (extrait, pas le livre entier) ═══════════════ */

const prayerHaystack = (p) => [p.title, p.category, p.source, p.usage, p.excerpt].join(' ').toLowerCase();

/** Prières correspondant à la recherche en cours — vide si la requête est trop courte. */
function matchingPrayers() {
  const q = state.query.trim().toLowerCase();
  if (q.length < 3) return [];
  const words = q.split(/\s+/);
  return state.prayers
    .filter((p) => { const hay = prayerHaystack(p); return words.every((w) => hay.includes(w)); })
    .slice(0, 12);
}

function prayerCardHtml(p) {
  const book = bookOf(p.bookId);
  if (!book) return '';
  const cat = catOf(book.category);
  return `
  <article class="pcard" data-prayer-book="${book.id}" data-prayer-vol="${p.volume}" data-prayer-h3="${p.h3Index}"
            style="--cat:${cat?.accent || '#d9a441'}" tabindex="0" role="button">
    <p class="pcard-book">${cat ? cat.glyph + ' ' : ''}${escapeHtml(book.title)} · ${escapeHtml(p.category)}</p>
    <h3>${escapeHtml(p.title)}</h3>
    <p class="pcard-excerpt">${escapeHtml(p.excerpt)}</p>
    ${p.usage ? `<p class="pcard-usage">Usage : ${escapeHtml(p.usage)}</p>` : ''}
  </article>`;
}

/** Affiche les prières trouvées au-dessus des rayons de livres ; masqué hors recherche. */
export function renderPrayerResults() {
  const host = $('prayerResults');
  const results = matchingPrayers();
  if (!results.length) { host.innerHTML = ''; host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = `
    <section class="presults">
      <h2 class="home-h">Prières trouvées <span class="pcount">${results.length}${results.length === 12 ? '+' : ''}</span></h2>
      <div class="pgrid">${results.map(prayerCardHtml).join('')}</div>
    </section>`;
}

/* ═══════════════ Chargement de l'état ═══════════════ */

export async function refreshState() {
  const rows = (await allProgress()) || [];
  state.progress = new Map();
  for (const r of rows.sort((a, b) => b.at - a.at)) if (!state.progress.has(r.bookId)) state.progress.set(r.bookId, r);

  state.cached = new Set();
  await Promise.all(state.catalog.books.map(async (b) => { if (await isCached(b)) state.cached.add(b.id); }));
}

/* ═══════════════ Navigation latérale ═══════════════ */

export function renderNav() {
  const nav = $('catNav');
  nav.innerHTML = `<p class="nav-h">${t('nav.corpus')}</p>` +
    `<a href="#/" data-cat="__home" class="active"><span class="g">✦</span><span class="n">${t('nav.home')}</span></a>` +
    `<a href="#/tout" data-cat=""><span class="g">❧</span><span class="n">${t('nav.all')}</span>` +
    `<span class="c">${state.catalog.books.length}</span></a>` +
    `<a href="#/programmes" data-cat="__programmes"><span class="g">✧</span><span class="n">${t('nav.programmes')}</span></a>` +
    `<a href="#/rappels" data-cat="__rappels"><span class="g">☾</span><span class="n">${t('nav.reminders')}</span></a>` +
    `<a href="#/pratique" data-cat="__pratique"><span class="g">◎</span><span class="n">${t('nav.practice')}</span></a>` +
    state.catalog.categories.sort((a, b) => a.order - b.order).map((c) => `
      <a href="#/c/${c.id}" data-cat="${c.id}" style="--cat:${c.accent}">
        <span class="g">${c.glyph}</span><span class="n">${escapeHtml(c.name)}</span>
        <span class="c">${booksIn(c.id).length}</span>
      </a>`).join('');
}

export function markNav(catId = '') {
  $('catNav').querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.cat === catId));
}

/* ═══════════════ Statistiques d'accueil ═══════════════ */

export function renderStats() {
  const books = state.catalog.books;
  const files = books.reduce((n, b) => n + b.volumes.reduce((m, v) =>
    m + (v.images?.length || v.tracks?.length || 1), 0), 0);
  const audio = books.filter((b) => b.volumes.some((v) => v.type === 'audio')).length;
  const stats = [
    [books.length, 'ouvrages'],
    [state.catalog.categories.length, 'corpus'],
    [files, 'fichiers'],
    [formatBytes(state.catalog.totalBytes || 0), 'de textes'],
    [audio ? audio : '—', 'livre audio'],
  ];
  $('heroStats').innerHTML = stats.map(([b, s]) =>
    `<div class="hstat"><b>${b}</b><span>${s}</span></div>`).join('');

  const kicker = $('heroKicker');
  if (kicker) kicker.textContent =
    `${books.length} ouvrages · ${state.catalog.categories.length} corpus · lecture vocale`;
}

/* ═══════════════ Rayons et cartes ═══════════════ */

function coverFor(book) {
  const gal = book.volumes.find((v) => v.type === 'gallery');
  return gal ? `<img src="${url(gal.images[0])}" alt="" loading="lazy">` : '';
}

function cardHtml(book) {
  const cat = catOf(book.category);
  const prog = state.progress.get(book.id);
  const pct = prog?.percent || 0;
  const kinds = [...new Set(book.volumes.map((v) => v.type))];

  return `
  <article class="card" data-book="${book.id}" style="--cat:${cat.accent}" tabindex="0" role="button"
           aria-label="${escapeHtml(book.title)}">
    <div class="card-badges">
      ${state.cached.has(book.id) ? '<span class="badge saved" title="Disponible hors-ligne">⤓</span>' : ''}
      ${prog ? `<span class="badge reading" title="${pct} % lu">${pct >= 97 ? '✓' : '◐'}</span>` : ''}
    </div>
    <div class="cover">
      ${coverFor(book) || `<span class="cover-glyph">${book.glyph}</span>`}
      <span class="cover-era">${escapeHtml(book.era)}</span>
    </div>
    <div class="card-body">
      <h3>${escapeHtml(book.title)}</h3>
      <p class="auth">${escapeHtml(book.author)}</p>
      <div class="fmts">${kinds.map((k) => `<span class="fmt ${k}">${FMT[k]}</span>`).join('')}</div>
    </div>
    ${pct ? `<div class="card-prog" title="${pct} % lu"><span style="width:${pct}%"></span></div>
             <span class="card-pct">${pct} %</span>` : ''}
  </article>`;
}

export function renderShelves(onlyCat = '') {
  const cats = state.catalog.categories
    .sort((a, b) => a.order - b.order)
    .filter((c) => !onlyCat || c.id === onlyCat);

  let total = 0;
  const html = cats.map((c) => {
    const books = booksIn(c.id).filter(matches);
    if (!books.length) return '';
    total += books.length;
    return `
    <section class="shelf" id="c-${c.id}" style="--cat:${c.accent}">
      <div class="shelf-head">
        <div class="shelf-glyph">${c.glyph}</div>
        <div>
          <h2>${escapeHtml(c.name)}</h2>
          <span class="count">${books.length} ouvrage${books.length > 1 ? 's' : ''}</span>
        </div>
      </div>
      <p class="shelf-intro">${escapeHtml(c.intro)}</p>
      <div class="shelf-rule"></div>
      <div class="grid">${books.map(cardHtml).join('')}</div>
    </section>`;
  }).join('');

  $('shelves').innerHTML = html;
  $('emptyState').hidden = total > 0;
  $('hero').hidden = !!(state.query || onlyCat);
}

/* ═══════════════ Reprendre la lecture ═══════════════ */

export function renderContinue() {
  const rows = [...state.progress.values()].slice(0, 4);
  $('continueCard').hidden = !rows.length;
  $('continueList').innerHTML = rows.map((p) => {
    const cat = catOf(p.category);
    const where = resumer(p) || p.volumeLabel || 'en cours';
    return `<div class="continue-item" data-open="${p.bookId}" data-vol="${p.volume}" style="--cat:${cat?.accent || '#d9a441'}">
      <span class="ci-g">${p.glyph || '✦'}</span>
      <span class="ci-b"><b>${escapeHtml(p.title)}</b><small>${escapeHtml(where)}</small></span>
    </div>`;
  }).join('');
}

/* ═══════════════ Fiche livre ═══════════════ */

export function openSheet(book, handlers) {
  const cat = catOf(book.category);
  const saved = state.cached.has(book.id);
  const prog = state.progress.get(book.id);

  $('sheet').style.setProperty('--cat', cat.accent);
  $('sheet').innerHTML = `
    <div class="sheet-top">
      <span class="sheet-cat">${cat.glyph} ${escapeHtml(cat.name)}</span>
      <button class="icon-btn" data-close-sheet aria-label="Fermer">✕</button>
    </div>
    <div class="sheet-hero">
      <div class="sheet-cover">${coverFor(book) || `<span>${book.glyph}</span>`}</div>
      <div class="sheet-meta">
        <h2>${escapeHtml(book.title)}</h2>
        ${book.subtitle ? `<p class="sub">${escapeHtml(book.subtitle)}</p>` : ''}
        <dl>
          <dt>Auteur</dt><dd>${escapeHtml(book.author)}</dd>
          <dt>Époque</dt><dd>${escapeHtml(book.era)}</dd>
          <dt>Langue</dt><dd>${({ fr: 'Français', en: 'Anglais', gez: 'Guèze', he: 'Hébreu' })[book.lang] || book.lang}</dd>
          <dt>Poids</dt><dd>${formatBytes(book.bytes || 0)}</dd>
          ${book.addedAt ? `<dt>Ajouté</dt><dd>${dateAjoutEnClair(book.addedAt)}</dd>` : ''}
        </dl>
      </div>
    </div>
    <p class="sheet-sum">${escapeHtml(book.summary)}</p>
    <div class="sheet-tags">${(book.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>

    <h4>Éditions disponibles</h4>
    <div class="vol-list">
      ${book.volumes.map((v, i) => {
        const count = v.images?.length || v.tracks?.length;
        const size = v.bytes || (v.sizes || []).reduce((a, b) => a + (b || 0), 0);
        const here = prog && prog.volume === i && prog.percent
          ? ` · <span class="vol-prog">${resumer(prog)}</span>` : '';
        return `<div class="vol" data-vol="${i}">
          <span class="vol-ico">${ICO[v.type]}</span>
          <span class="vol-b"><b>${escapeHtml(v.label)}</b>
            <small>${FMT[v.type]}${count ? ` · ${count} éléments` : ''} · ${formatBytes(size)}${here}</small></span>
          <span class="vol-go">›</span>
        </div>`;
      }).join('')}
    </div>

    <div class="sheet-actions">
      <button class="act primary" data-read>${prog ? 'Reprendre la lecture' : 'Commencer la lecture'}</button>
      <button class="act ${saved ? 'done' : ''}" data-offline>${saved ? '✓ Disponible hors-ligne' : '⤓ Rendre disponible hors-ligne'}</button>
      <button class="act" data-plan>⏰ Programmer une lecture</button>
    </div>
    <div id="sheetPlan" class="sheet-plan"></div>`;

  const wrap = $('sheetWrap');
  wrap.hidden = false;
  document.body.style.overflow = 'hidden';

  $('sheet').querySelectorAll('.vol').forEach((el) =>
    el.addEventListener('click', () => handlers.open(book, +el.dataset.vol)));

  $('sheet').querySelector('[data-read]').addEventListener('click', () =>
    handlers.open(book, prog?.volume ?? 0));

  const planBtn = $('sheet').querySelector('[data-plan]');
  planBtn.addEventListener('click', async () => {
    const hote = $('sheetPlan');
    if (hote.innerHTML) { hote.innerHTML = ''; planBtn.classList.remove('on'); return; }
    planBtn.classList.add('on');
    const { planificateurPour } = await import('./alarms.js');
    planificateurPour(book, hote, () => planBtn.classList.remove('on'));
    hote.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  const offBtn = $('sheet').querySelector('[data-offline]');
  offBtn.addEventListener('click', async () => {
    if (state.cached.has(book.id)) {
      await uncacheBook(book);
      state.cached.delete(book.id);
      offBtn.className = 'act';
      offBtn.textContent = '⤓ Rendre disponible hors-ligne';
      handlers.toast(`« ${book.title} » retiré du stockage local.`);
    } else {
      offBtn.disabled = true;
      try {
        await persist();          // évite que le navigateur évince les livres sous pression disque
        await cacheBook(book, (d, t) => { offBtn.textContent = `Téléchargement ${d}/${t}…`; });
        state.cached.add(book.id);
        offBtn.className = 'act done';
        offBtn.textContent = '✓ Disponible hors-ligne';
        handlers.toast(`« ${book.title} » est lisible sans connexion.`);
      } catch (e) {
        offBtn.textContent = '⤓ Rendre disponible hors-ligne';
        handlers.toast('Téléchargement interrompu : ' + e.message);
      }
      offBtn.disabled = false;
    }
    handlers.refresh();
  });
}

export function closeSheet() {
  $('sheetWrap').hidden = true;
  document.body.style.overflow = '';
}
