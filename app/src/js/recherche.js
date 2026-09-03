/**
 * recherche.js — Recherche dans les textes eux-mêmes, pas seulement dans le catalogue.
 * L'index se construit une fois (textes saisis + couche OCR des PDF) et vit dans IndexedDB.
 */
import { saveChunks, allChunks, countChunks, clearChunks } from './store.js';
import { escapeHtml, url } from './reader.js';
import { state, bookOf, catOf } from './library.js';
import { estLisible, aplatir } from './lisibilite.js';

const $ = (id) => document.getElementById(id);
const META = 'bs:index';
const LIMITE = 40;
let memoire = null;               // fragments chargés une fois par session
let ouvrir = () => {};
let enCours = false;

export const etatIndex = () => { try { return JSON.parse(localStorage.getItem(META) || 'null'); } catch { return null; } };

/* ═══════════════ Construction de l'index ═══════════════ */

const volumesIndexables = () => state.catalog.books.flatMap((b) =>
  b.volumes.map((v, i) => ({ book: b, vol: v, i })).filter((x) => x.vol.type === 'md' || x.vol.type === 'pdf'));

/** Le texte brut d'un Markdown, allégé de sa syntaxe, découpé en paragraphes avec leur titre courant. */
function fragmentsMarkdown(md, book, i) {
  const out = [];
  let titre = '';
  let n = 0;
  for (const bloc of md.split(/\n\s*\n/)) {
    const ligne = bloc.trim();
    if (!ligne || /^---+$/.test(ligne)) continue;
    const h = /^#{1,6}\s+(.+)$/.exec(ligne);
    if (h) { titre = h[1].replace(/[*_`]/g, '').trim(); continue; }
    const texte = ligne
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')          // images
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')        // liens : on garde le libellé
      .replace(/<[^>]+>/g, ' ')                           // balises
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')        // puces et numéros de liste
      .replace(/[*_`>#]/g, '')
      .replace(/\s+/g, ' ').trim();
    if (texte.length < 30) continue;
    out.push({ key: `${book.id}|${i}|${n}`, bookId: book.id, vol: i, kind: 'md', ref: n++, titre, texte, norm: aplatir(texte) });
  }
  return out;
}

async function fragmentsPdf(vol, book, i, signaler) {
  const pdfjs = await import('../../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ url: url(vol.path) }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const texte = tc.items.map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim();
    if (texte.length < 40 || !estLisible(texte)) continue;   // planches, gravures, pages muettes
    out.push({ key: `${book.id}|${i}|${p}`, bookId: book.id, vol: i, kind: 'pdf', ref: p, titre: '', texte, norm: aplatir(texte) });
    if (p % 25 === 0) signaler(p, doc.numPages);
  }
  await doc.destroy();
  return out;
}

/** Construit l'index complet. Long sur les gros PDF : on informe au fur et à mesure. */
export async function construireIndex(onProgress = () => {}) {
  if (enCours) return;
  enCours = true;
  try {
    await clearChunks();
    memoire = null;
    const liste = volumesIndexables();
    let fragments = 0;
    for (const [k, { book, vol, i }] of liste.entries()) {
      const label = `${book.title} — ${vol.label}`;
      onProgress({ etape: k, total: liste.length, label, fragments });
      let lot = [];
      try {
        if (vol.type === 'md') {
          const r = await fetch(url(vol.path));
          if (r.ok) lot = fragmentsMarkdown(await r.text(), book, i);
        } else {
          lot = await fragmentsPdf(vol, book, i, (p, n) => onProgress({ etape: k, total: liste.length, label: `${label} · page ${p}/${n}`, fragments }));
        }
      } catch (e) { console.warn('Index :', label, e); }
      for (let j = 0; j < lot.length; j += 300) await saveChunks(lot.slice(j, j + 300));
      fragments += lot.length;
    }
    localStorage.setItem(META, JSON.stringify({ builtAt: Date.now(), volumes: liste.length, fragments }));
    onProgress({ etape: liste.length, total: liste.length, label: 'Terminé', fragments, fini: true });
  } finally { enCours = false; }
}

/* ═══════════════ Interrogation ═══════════════ */

const occurrences = (s, m) => { let n = 0, i = 0; while ((i = s.indexOf(m, i)) !== -1) { n++; i += m.length; } return n; };

export async function chercher(q) {
  const nq = aplatir(q).trim();
  if (nq.length < 3) return [];
  const mots = nq.split(/\s+/).filter((m) => m.length >= 2);
  if (!mots.length) return [];
  if (!memoire) memoire = await allChunks();

  const ordre = new Map(state.catalog.books.map((b, i) => [b.id, i]));
  const res = [];
  for (const c of memoire) {
    if (!mots.every((m) => c.norm.includes(m))) continue;
    const score = (c.norm.includes(nq) ? 10 : 0) + mots.reduce((s, m) => s + occurrences(c.norm, m), 0);
    res.push({ c, score });
  }
  res.sort((a, b) => b.score - a.score || (ordre.get(a.c.bookId) - ordre.get(b.c.bookId)) || a.c.ref - b.c.ref);
  return res.slice(0, LIMITE).map((r) => r.c);
}

/**
 * Extrait autour de la première occurrence, avec les mots surlignés.
 * On travaille sur la forme décomposée pour retrouver la position exacte malgré les accents.
 */
function extrait(texte, nq, mots, largeur = 190) {
  const nfd = texte.normalize('NFD');
  const map = [];
  let plat = '';
  for (let i = 0; i < nfd.length; i++) {
    const ch = nfd[i];
    if (/\p{M}/u.test(ch)) continue;
    plat += ch.toLowerCase();
    map.push(i);
  }
  let pos = plat.indexOf(nq);
  if (pos < 0) pos = Math.min(...mots.map((m) => plat.indexOf(m)).filter((p) => p >= 0));
  if (!Number.isFinite(pos) || pos < 0) pos = 0;
  const debut = Math.max(0, pos - Math.floor(largeur / 3));
  const fin = Math.min(plat.length, debut + largeur);
  let morceau = nfd.slice(map[debut] ?? 0, map[fin - 1] !== undefined ? map[fin - 1] + 1 : nfd.length).normalize('NFC');
  if (debut > 0) morceau = '… ' + morceau;
  if (fin < plat.length) morceau += ' …';
  let html = escapeHtml(morceau);
  for (const m of [...new Set(mots)].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(m.split('').map((ch) => `${ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\p{M}*`).join(''), 'giu');
    html = html.replace(re, (x) => `<mark>${x}</mark>`);
  }
  return html;
}

/* ═══════════════ Rendu ═══════════════ */

export function init({ onOpen }) {
  ouvrir = onOpen;
  const host = $('textResults');
  host.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-indexer]');
    if (b) { await lancerIndexation(host); return; }
    const s = e.target.closest('.tsnip');
    if (s) ouvrir({ bookId: s.dataset.book, vol: +s.dataset.vol, kind: s.dataset.kind,
                    ref: +s.dataset.ref, norm: s.dataset.norm });
  });
}

async function lancerIndexation(host) {
  const barre = host.querySelector('.tprog span'), txt = host.querySelector('.tprog-txt');
  host.querySelector('[data-indexer]')?.setAttribute('disabled', '');
  await construireIndex(({ etape, total, label, fragments, fini }) => {
    if (barre) barre.style.width = `${(etape / total) * 100}%`;
    if (txt) txt.textContent = fini ? `${fragments} passages indexés.` : `${etape + 1}/${total} — ${label}`;
  });
  render(state.query, host);
}

export async function render(query, host = $('textResults')) {
  const q = String(query || '').trim();
  if (q.length < 3) { host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;

  const meta = etatIndex();
  const nb = await countChunks();
  if (!meta || !nb) {
    host.innerHTML = `
      <div class="tindex">
        <p><b>Chercher « ${escapeHtml(q)} » dans les textes ?</b><br>L'index des textes n'est pas encore construit.
          Une seule fois, quelques minutes : les éditions texte et la couche OCR des PDF.</p>
        <button class="mini-btn" data-indexer>Indexer les textes</button>
        <div class="tprog"><span></span></div><p class="tprog-txt"></p>
      </div>`;
    return;
  }

  const res = await chercher(q);
  const actuels = volumesIndexables().length;
  const perime = meta.volumes !== actuels
    ? `<div class="tindex"><p>L'index couvre ${meta.volumes} volumes ; la bibliothèque en compte ${actuels}. Les nouveaux textes n'y sont pas encore.</p>
         <button class="mini-btn" data-indexer>Réindexer</button><div class="tprog"><span></span></div><p class="tprog-txt"></p></div>` : '';
  if (!res.length) { host.innerHTML = perime + `<p class="tnone">Aucun passage ne contient « ${escapeHtml(q)} ».</p>`; return; }

  const nq = aplatir(q).trim();
  const mots = nq.split(/\s+/).filter((m) => m.length >= 2);
  const groupes = new Map();
  for (const c of res) { if (!groupes.has(c.bookId)) groupes.set(c.bookId, []); groupes.get(c.bookId).push(c); }

  host.innerHTML = perime + `<section class="tresults">
    <h2 class="home-h">Dans les textes <span>${res.length}${res.length === LIMITE ? '+' : ''} passage${res.length > 1 ? 's' : ''}</span></h2>
    ${[...groupes].map(([id, cs]) => {
      const b = bookOf(id); const cat = b ? catOf(b.category) : null;
      return `<div class="tgroup" style="--cat:${cat?.accent || '#d9a441'}">
        <p class="tbook">${cat ? cat.glyph + ' ' : ''}${escapeHtml(b?.title || id)}</p>
        ${cs.map((c) => `
        <div class="tsnip" data-book="${c.bookId}" data-vol="${c.vol}" data-kind="${c.kind}" data-ref="${c.ref}"
             data-norm="${escapeHtml(c.norm.slice(0, 80))}">
          <span class="tref">${c.kind === 'pdf' ? `p. ${c.ref}` : (b?.volumes[c.vol]?.label || 'texte')}</span>
          <p>${extrait(c.texte, nq, mots)}${c.titre ? `<small>${escapeHtml(c.titre)}</small>` : ''}</p>
        </div>`).join('')}
      </div>`; }).join('')}
  </section>`;
}

export const invaliderMemoire = () => { memoire = null; };
