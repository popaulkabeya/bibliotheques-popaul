/**
 * programmes.js — Programmes de prière : prier sur une période décidée d'avance.
 *
 * Un programme = un titre, une période (début, fin) et des séances. Une séance porte une
 * heure, un passage, une intention, et la prière vers laquelle elle ouvre. Elle vaut soit
 * pour tous les jours (`jour: null`), soit pour un jour précis (`jour: 3`) — de quoi tenir
 * un rythme régulier comme un livret dont chaque jour a son propre texte.
 * Cochage conservé par jour : `faits['2026-08-30'] = ['s1','s2']`.
 */
import { allProgrammes, saveProgramme, deleteProgramme, getProgramme, deleteAlarm } from './store.js';
import { escapeHtml } from './reader.js';
import { bookOf, state } from './library.js';
import { armerLecture } from './lecture-validation.js';

// Le programme des trente jours accompagne un livret privé, hors de Git : sans lui, pas de bouton.
const trenteJours = await import('./trente-jours.js').catch(() => null);

const $ = (id) => document.getElementById(id);

/* ═══════════════ Dates ═══════════════ */
const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Une date ISO se lit en heure locale : `new Date('2026-08-30')` serait interprété en UTC. */
const dateDe = (s) => { const [y, m, j] = String(s).split('-').map(Number); return new Date(y, m - 1, j); };
export const aujourdhui = () => iso(new Date());
const plusDeJours = (s, n) => { const d = dateDe(s); d.setDate(d.getDate() + n); return iso(d); };

const FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });
const enClair = (s) => FMT.format(dateDe(s));
const hhmm = (h) => h.replace(':', ' h ');

/** Nombre de jours de la période, bornes comprises. */
export function nbJours(p) {
  return Math.max(1, Math.round((dateDe(p.fin) - dateDe(p.debut)) / 86400000) + 1);
}
/** Toutes les dates de la période, dans l'ordre. */
const joursDe = (p) => Array.from({ length: nbJours(p) }, (_, i) => plusDeJours(p.debut, i));
/** Rang du jour (1-based) pour une date donnée, ou 0 hors période. */
const rangDu = (p, j) => (j < p.debut || j > p.fin ? 0 : Math.round((dateDe(j) - dateDe(p.debut)) / 86400000) + 1);

export function etat(p) {
  const h = aujourdhui();
  if (h < p.debut) return 'avenir';
  if (h > p.fin) return 'termine';
  return 'encours';
}

/* ═══════════════ Séances et progression ═══════════════ */
/** Séances valant pour un jour donné, triées par heure. */
export const seancesDu = (p, j) => {
  const rang = rangDu(p, j);
  return (p.seances || [])
    .filter((s) => s.jour == null || s.jour === rang)
    .sort((a, b) => a.heure.localeCompare(b.heure));
};

export const estFait = (p, j, sid) => (p.faits?.[j] || []).includes(sid);

/** Nombre de séances cochées / nombre total sur toute la période. */
export function progression(p) {
  let total = 0, faits = 0;
  for (const j of joursDe(p)) {
    const ss = seancesDu(p, j);
    total += ss.length;
    faits += ss.filter((s) => estFait(p, j, s.id)).length;
  }
  return { faits, total, pct: total ? Math.round((faits / total) * 100) : 0 };
}

export async function basculer(pid, jour, sid) {
  const p = await getProgramme(pid);
  if (!p) return;
  p.faits = p.faits || {};
  const liste = new Set(p.faits[jour] || []);
  liste.has(sid) ? liste.delete(sid) : liste.add(sid);
  if (liste.size) p.faits[jour] = [...liste]; else delete p.faits[jour];
  await saveProgramme(p);
}

/* ═══════════════ Passages ═══════════════ */
/** Prières indexées d'un livre (src/data/prayers.json), dans l'ordre du texte. */
const prieresDe = (bookId) => (state.prayers || []).filter((x) => x.bookId === bookId);

/** Livres dont les prières sont indexées : seuls ceux-là peuvent fournir un passage précis. */
const livresIndexes = () => {
  const vus = new Set((state.prayers || []).map((x) => x.bookId));
  return (state.catalog?.books || []).filter((b) => vus.has(b.id));
};

/** Lien du lecteur vers la prière exacte d'une séance. */
const lienSeance = (s) =>
  s.bookId ? `#/lire/${s.bookId}/${s.volume ?? 0}${s.h3 != null ? `/p${s.h3}` : ''}` : '';

/* ═══════════════ Modèle tiré d'un livret ═══════════════ */
/** Une section de livret vaut une journée quand elle s'appelle « Jour … », « Nuit … »
 *  ou « Soir … », éventuellement précédé d'un ordinal (« Premier soir », « Deuxième nuit »). */
const RE_JOUR = /^(?:\d+\.\s*)?(?:\S+\s+)?(Jour|Nuit|Soir)\b/i;
/** Les pièces qui se prient — elles deviennent des séances. */
const RE_PRIERE = /^Pri[èe]re\b/i;
/** Ce qui se dit plutôt que ne se lit : à exclure des passages de la journée. */
const RE_A_DIRE = /^(Pri[èe]re|Décret|Déclaration|Verset)\b/i;

/** L'heure se lit dans l'intitulé ; à défaut, un livret de nuits se prie le soir. */
const heureDe = (t, defaut) => /matin/i.test(t) ? '06:00'
  : /midi/i.test(t) ? '12:00' : /(soir|nuit)/i.test(t) ? '21:00' : defaut;

/**
 * Construit un programme depuis un livret bâti jour par jour. Chaque journée donne une
 * séance par prière, avec pour passage les textes de la journée et pour intention son thème.
 * Deux prières tombant à la même heure sont décalées d'un quart d'heure, pour rester en ordre.
 */
export function modeleDepuisLivret(bookId, debut) {
  const livre = bookOf(bookId);
  const prieres = prieresDe(bookId);
  if (!livre || !prieres.length) return null;

  const parJour = new Map();
  for (const x of prieres) {
    if (!RE_JOUR.test(x.category || '')) continue;
    parJour.set(x.category, [...(parJour.get(x.category) || []), x]);
  }
  const jours = [...parJour.entries()];
  if (!jours.length) return null;

  const seances = [];
  jours.forEach(([titreJour, entrees], i) => {
    const theme = titreJour.split(/\s+—\s+/).slice(1).join(' — ') || titreJour;
    const nuit = /(nuit|soir)/i.test(titreJour);
    const passage = entrees.filter((e) => !RE_A_DIRE.test(e.title)).slice(0, 2)
      .map((e) => e.title).join(' · ');
    const prises = new Set();
    for (const e of entrees.filter((e) => RE_PRIERE.test(e.title))) {
      let h = heureDe(e.title, nuit ? '21:00' : '06:00');
      while (prises.has(h)) {   // même heure déjà prise : on décale d'un quart d'heure
        const [hh, mm] = h.split(':').map(Number);
        h = `${pad(hh + (mm >= 45 ? 1 : 0))}:${pad((mm + 15) % 60)}`;
      }
      prises.add(h);
      seances.push({
        id: `s${i + 1}-${h.replace(':', '')}`, jour: i + 1, heure: h, intitule: e.title,
        bookId, volume: e.volume ?? 0, h3: e.h3Index, passage, intention: theme,
      });
    }
    // Journée d'un seul tenant (office d'une heure, sans pièce intitulée « Prière ») :
    // une séance unique qui ouvre sur le début de la journée.
    if (!prises.size) {
      const h = heureDe(titreJour, nuit ? '21:00' : '06:00');
      seances.push({
        id: `s${i + 1}-${h.replace(':', '')}`, jour: i + 1, heure: h,
        intitule: nuit ? 'Office du soir' : 'Office du jour',
        bookId, volume: entrees[0].volume ?? 0, h3: entrees[0].h3Index, passage, intention: theme,
      });
    }
  });
  if (!seances.length) return null;

  return {
    id: `prog-${bookId}-${Date.now().toString(36)}`,
    titre: livre.title, intention: '', debut, fin: plusDeJours(debut, jours.length - 1),
    seances, faits: {},
  };
}

/** Livrets qui se prêtent à un modèle : ceux dont les sections sont des jours. */
const livretsModeles = () =>
  livresIndexes().filter((b) => prieresDe(b.id).some((x) => RE_JOUR.test(x.category || '')));

/* ═══════════════ Export vers l'agenda ═══════════════ */
const echapICS = (t) => String(t).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
const fuseau = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};

/**
 * Un événement daté par séance et par jour — pas de règle de répétition.
 * Un programme a une fin : l'agenda doit cesser de sonner tout seul.
 */
export function versICS(p) {
  const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bibliotheque Spirituelle//FR',
             'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${echapICS(p.titre)}`];
  const estampille = iso(new Date()).replace(/-/g, '');
  for (const j of joursDe(p)) for (const s of seancesDu(p, j)) {
    const jour = j.replace(/-/g, '');
    l.push('BEGIN:VEVENT', `UID:${p.id}-${s.id}-${jour}@bibliotheque-spirituelle`,
      `DTSTAMP:${estampille}T000000Z`,
      `DTSTART;TZID=${fuseau()}:${jour}T${s.heure.replace(':', '')}00`, 'DURATION:PT20M',
      `SUMMARY:${echapICS(s.intitule)}`,
      `DESCRIPTION:${echapICS([s.passage, s.intention].filter(Boolean).join(' — '))}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M',
      `DESCRIPTION:${echapICS(s.intitule)}`, 'END:VALARM', 'END:VEVENT');
  }
  l.push('END:VCALENDAR');
  return l.join('\r\n');
}

function telechargerICS(p) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([versICS(p)], { type: 'text/calendar;charset=utf-8' }));
  a.download = `${p.titre.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.ics`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const toast = (m) => document.dispatchEvent(new CustomEvent('bs:toast', { detail: m }));

/* ═══════════════ Vue : liste des programmes ═══════════════ */

const ETATS = { encours: 'en cours', avenir: 'à venir', termine: 'terminé' };
/** Séances du jour — sur un programme en cours, c'est ce qu'on veut voir en premier. */
const ligneDuJour = (p, j = aujourdhui(), ss = seancesDu(p, j)) => ss.length
  ? `<div class="pg-seances">${ss.map((s) => carteSeance(p, j, s)).join('')}</div>`
  : `<p class="pg-vide">Rien de prévu aujourd'hui.</p>`;

function carteSeance(p, jour, s) {
  const fait = estFait(p, jour, s.id);
  const lien = lienSeance(s);
  return `
  <div class="pg-seance${fait ? ' fait' : ''}" data-prog="${p.id}" data-jour="${jour}" data-seance="${s.id}">
    <button class="pg-check" data-check aria-label="${fait ? 'Décocher' : 'Marquer comme priée'}">${fait ? '◉' : '○'}</button>
    <span class="pg-heure">${hhmm(s.heure)}</span>
    <div class="pg-corps">
      <b>${escapeHtml(s.intitule)}</b>
      ${s.passage ? `<small class="pg-passage">${escapeHtml(s.passage)}</small>` : ''}
      ${s.intention ? `<small class="pg-intention">${escapeHtml(s.intention)}</small>` : ''}
    </div>
    ${lien ? `<a class="pg-ouvrir" href="${lien}">Prier</a>` : ''}
  </div>`;
}


function carteProgramme(p) {
  const e = etat(p);
  const { faits, total, pct } = progression(p);
  const n = nbJours(p);
  const rang = rangDu(p, aujourdhui());
  return `
  <article class="pg-card ${e}">
    <header class="pg-card-head">
      <a class="pg-titre" href="#/programmes/${p.id}">${escapeHtml(p.titre)}</a>
      <span class="pg-etat ${e}">${ETATS[e]}</span>
    </header>
    <p class="pg-periode">${enClair(p.debut)} → ${enClair(p.fin)} · ${n} jour${n > 1 ? 's' : ''}
      ${e === 'encours' ? ` · <b>jour ${rang}</b>` : ''}</p>
    ${p.intention ? `<p class="pg-card-int">${escapeHtml(p.intention)}</p>` : ''}
    <div class="pg-barre"><span style="width:${pct}%"></span></div>
    <p class="pg-compte">${faits} / ${total} séances priées</p>
    ${e === 'encours' ? ligneDuJour(p) : ''}
  </article>`;
}

function blocModeles() {
  const m = livretsModeles();
  const trente = trenteJours?.modeleTrenteJours() ? `<div class="pg-modeles">
      <button class="mini-btn" data-trente-jours>Trente Jours pour Gouverner — 7 oct. → 5 nov.</button></div>` : '';
  if (!m.length) return trente ? `<section class="home-block">
    <h2 class="home-h">Partir d'un livret</h2>${trente}</section>` : '';
  return `<section class="home-block">
    <h2 class="home-h">Partir d'un livret</h2>
    <p class="pg-lede">Ces livrets sont bâtis jour par jour : le programme se remplit tout seul —
      les passages, l'intention et les séances de chaque journée. Il commence aujourd'hui.</p>
    <div class="pg-modeles">${m.map((b) =>
      `<button class="mini-btn" data-modele="${b.id}">${escapeHtml(b.title)}</button>`).join('')}</div>
    ${trente}
  </section>`;
}

/** Le formulaire de composition, partagé entre la création et la modification. */
function formulaireHtml({ titre = '', intention = '', debut = aujourdhui(), fin = plusDeJours(aujourdhui(), 6),
  bouton = 'Créer le programme' } = {}) {
  return `
      <form class="pg-form" id="pgForm">
        <label class="large">Intitulé<input name="titre" maxlength="80" required
          placeholder="Ce que porte ce programme" value="${escapeHtml(titre)}"></label>
        <label class="large">Intention générale<input name="intention" maxlength="140"
          placeholder="Facultatif — la demande de fond" value="${escapeHtml(intention)}"></label>
        <label>Premier jour<input type="date" name="debut" value="${debut}" required></label>
        <label>Dernier jour<input type="date" name="fin" value="${fin}" required></label>
        <div class="pg-form-full">
          <h3 class="pg-sh">Séances</h3>
          <div class="pg-brouillon" id="pgBrouillon"></div>
          <div class="pg-ajout">
            <label>Heure<input type="time" id="pgHeure" value="06:00"></label>
            <label>Jour<select id="pgJour"><option value="">Tous les jours</option></select></label>
            <label>Intitulé<input id="pgIntitule" maxlength="60" placeholder="Prière du matin"></label>
            <label>Prière<select id="pgLivre">
              <option value="">— aucune —</option>
              ${livresIndexes().map((b) => `<option value="${b.id}">${escapeHtml(b.title)}</option>`).join('')}
            </select></label>
            <label>Passage<select id="pgPassage" disabled></select></label>
            <label>Intention<input id="pgIntention" maxlength="90" placeholder="Ce qu'on demande"></label>
            <button type="button" class="mini-btn" id="pgAdd">Ajouter la séance</button>
          </div>
        </div>
        <div class="pg-form-full">
          <button class="act primary" type="submit">${bouton}</button>
        </div>
      </form>`;
}

export async function renderProgrammes(id) {
  if (id) {
    // La route ne porte que l'id (voir app.js) ; le segment « modifier » se lit dans le hash.
    const troisieme = location.hash.slice(2).split('/')[2];
    return troisieme === 'modifier' ? renderEdition(id) : renderUn(id);
  }
  const ordre = { encours: 0, avenir: 1, termine: 2 };
  const liste = (await allProgrammes())
    .sort((a, b) => ordre[etat(a)] - ordre[etat(b)] || String(a.debut).localeCompare(String(b.debut)));

  $('programmes').innerHTML = `
    <header class="home-head">
      <p class="home-date">Programmes</p>
      <h1>Prier sur une période.</h1>
      <p class="pg-lede">Un programme tient une intention dans le temps : un jour de début, un jour
        de fin, et pour chaque journée les heures où l'on s'arrête, le passage à lire et ce que
        l'on demande. On coche à mesure ; ce qui reste se voit.</p>
    </header>

    <section class="home-block">
      <h2 class="home-h">Mes programmes</h2>
      ${liste.length ? `<div class="pg-liste">${liste.map(carteProgramme).join('')}</div>`
        : `<p class="pg-vide">Aucun programme pour l'instant. Partez d'un livret ci-dessous,
             ou composez le vôtre.</p>`}
    </section>

    ${blocModeles()}

    <section class="home-block">
      <h2 class="home-h">Composer un programme</h2>
      ${formulaireHtml()}
    </section>`;

  brouillon = [];
  majBrouillon();
  majJours();
  brancherListe({ mode: 'creer' });
}

/* ═══════════════ Vue : modifier un programme ═══════════════ */

async function renderEdition(id) {
  const p = await getProgramme(id);
  if (!p) { location.hash = '#/programmes'; return; }

  $('programmes').innerHTML = `
    <header class="home-head">
      <a class="pg-retour" href="#/programmes/${p.id}">← Annuler</a>
      <h1>Modifier « ${escapeHtml(p.titre)} »</h1>
      <p class="pg-lede">Changez l'intitulé, les dates ou les séances. Ce qui a déjà été coché
        le reste pour les séances qui subsistent à l'identique.</p>
    </header>

    <section class="home-block">
      ${formulaireHtml({ titre: p.titre, intention: p.intention, debut: p.debut, fin: p.fin,
        bouton: 'Enregistrer les modifications' })}
    </section>`;

  brouillon = (p.seances || []).map((s) => ({ ...s }));
  majBrouillon();
  majJours();
  brancherListe({ mode: 'modifier', prog: p });
}

/* ═══════════════ Vue : un programme ═══════════════ */

async function renderUn(id) {
  const p = await getProgramme(id);
  if (!p) { location.hash = '#/programmes'; return; }
  const e = etat(p);
  const { faits, total, pct } = progression(p);
  const h = aujourdhui();

  $('programmes').innerHTML = `
    <header class="home-head">
      <a class="pg-retour" href="#/programmes">← Tous les programmes</a>
      <h1>${escapeHtml(p.titre)}</h1>
      <p class="pg-periode grand">${enClair(p.debut)} → ${enClair(p.fin)}
        · ${nbJours(p)} jours · <span class="pg-etat ${e}">${ETATS[e]}</span></p>
      ${p.intention ? `<p class="pg-card-int grand">${escapeHtml(p.intention)}</p>` : ''}
      <div class="pg-barre grand"><span style="width:${pct}%"></span></div>
      <p class="pg-compte">${faits} / ${total} séances priées</p>
      <div class="pg-tools">
        <a class="mini-btn" href="#/programmes/${p.id}/modifier">Modifier ce programme</a>
        <button class="mini-btn" id="pgICS">Exporter vers mon agenda</button>
        <button class="mini-btn ghost" id="pgDel">Supprimer ce programme</button>
      </div>
    </header>

    <section class="home-block">
      ${joursDe(p).map((j, i) => {
        const ss = seancesDu(p, j);
        const cl = j === h ? ' auj' : (j < h ? ' passe' : '');
        return `
        <div class="pg-jour${cl}">
          <div class="pg-jour-tete">
            <span class="pg-jour-n">Jour ${i + 1}</span>
            <span class="pg-jour-date">${enClair(j)}${j === h ? " · aujourd'hui" : ''}</span>
          </div>
          ${ss.length ? ss.map((s) => carteSeance(p, j, s)).join('')
            : '<p class="pg-vide">Aucune séance ce jour-là.</p>'}
        </div>`;
      }).join('')}
    </section>`;

  brancherUn(p);
}

/* ═══════════════ Composition d'un programme ═══════════════ */
/** Séances en cours de saisie, avant enregistrement. */
let brouillon = [];

function majBrouillon() {
  const el = $('pgBrouillon');
  if (!el) return;
  if (!brouillon.length) return void (el.innerHTML =
    '<p class="pg-vide">Aucune séance. Ajoutez-en au moins une ci-dessous.</p>');
  el.innerHTML = brouillon
    .slice().sort((a, b) => (a.jour ?? 0) - (b.jour ?? 0) || a.heure.localeCompare(b.heure))
    .map((s) => `
      <div class="pg-br-item" data-id="${s.id}">
        <span class="pg-heure">${hhmm(s.heure)}</span>
        <div class="pg-corps">
          <b>${escapeHtml(s.intitule)}</b>
          <small>${s.jour ? `jour ${s.jour}` : 'tous les jours'}${s.passage ? ' · ' + escapeHtml(s.passage) : ''}</small>
          ${s.intention ? `<small class="pg-intention">${escapeHtml(s.intention)}</small>` : ''}
        </div>
        <button type="button" class="rap-del" data-br-del aria-label="Retirer">✕</button>
      </div>`).join('');
}

/** Le choix « jour n » ne peut proposer que des jours réellement compris dans la période. */
function majJours() {
  const sel = $('pgJour');
  const form = $('pgForm');
  if (!sel || !form) return;
  const debut = form.debut.value, fin = form.fin.value;
  const n = (debut && fin && fin >= debut) ? nbJours({ debut, fin }) : 1;
  const garde = sel.value;
  sel.innerHTML = '<option value="">Tous les jours</option>' +
    Array.from({ length: n }, (_, i) => `<option value="${i + 1}">Jour ${i + 1}</option>`).join('');
  if (garde && +garde <= n) sel.value = garde;
}

function majPassages() {
  const sel = $('pgPassage');
  const bookId = $('pgLivre').value;
  const prieres = bookId ? prieresDe(bookId) : [];
  sel.disabled = !prieres.length;
  sel.innerHTML = prieres.length
    ? '<option value="">— tout le livre —</option>' +
      prieres.map((x) => `<option value="${x.h3Index}" data-vol="${x.volume ?? 0}">${escapeHtml(x.title)}</option>`).join('')
    : '<option value="">—</option>';
}

function brancherListe({ mode = 'creer', prog = null } = {}) {
  const form = $('pgForm');

  $('pgLivre')?.addEventListener('change', majPassages);
  form?.debut.addEventListener('change', majJours);
  form?.fin.addEventListener('change', majJours);

  // — ajout d'une séance au brouillon —
  $('pgAdd')?.addEventListener('click', () => {
    const heure = $('pgHeure').value || '06:00';
    const jour = $('pgJour').value ? +$('pgJour').value : null;
    const bookId = $('pgLivre').value;
    const opt = $('pgPassage').selectedOptions[0];
    const h3 = $('pgPassage').value === '' ? null : +$('pgPassage').value;
    const intitule = $('pgIntitule').value.trim()
      || (h3 != null && opt ? opt.textContent : (bookOf(bookId)?.title || 'Séance'));

    brouillon.push({
      id: `s${Date.now().toString(36)}${brouillon.length}`,
      heure, jour, intitule,
      bookId: bookId || null, volume: opt ? +(opt.dataset.vol || 0) : 0, h3,
      passage: h3 != null && opt ? opt.textContent : '',
      intention: $('pgIntention').value.trim(),
    });
    $('pgIntitule').value = '';
    $('pgIntention').value = '';
    majBrouillon();
  });

  $('pgBrouillon')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-br-del]');
    if (!b) return;
    brouillon = brouillon.filter((s) => s.id !== b.closest('.pg-br-item').dataset.id);
    majBrouillon();
  });

  // — enregistrement —
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = form.debut.value, f = form.fin.value;
    if (f < d) { toast('Le dernier jour ne peut pas précéder le premier.'); return; }
    if (!brouillon.length) { toast('Ajoutez au moins une séance.'); return; }
    if (brouillon.some((s) => s.jour && s.jour > nbJours({ debut: d, fin: f })))
      { toast('Une séance vise un jour hors de la période.'); return; }

    if (mode === 'modifier' && prog) {
      // Ce qui a déjà été coché ne vaut que pour les séances qui subsistent à l'identique (même id).
      const idsRestants = new Set(brouillon.map((s) => s.id));
      const faits = {};
      for (const [jour, ids] of Object.entries(prog.faits || {})) {
        const gardes = ids.filter((sid) => idsRestants.has(sid));
        if (gardes.length) faits[jour] = gardes;
      }
      await saveProgramme({
        ...prog,
        titre: form.titre.value.trim(),
        intention: form.intention.value.trim(),
        debut: d, fin: f,
        seances: brouillon,
        faits,
      });
      toast('Programme modifié.');
      location.hash = `#/programmes/${prog.id}`;
      return;
    }

    await saveProgramme({
      id: `prog-${Date.now().toString(36)}`,
      titre: form.titre.value.trim(),
      intention: form.intention.value.trim(),
      debut: d, fin: f,
      seances: brouillon,
      faits: {},
    });
    toast('Programme créé.');
    renderProgrammes();
  });

  // — modèles tirés d'un livret (seulement à la création) —
  document.querySelectorAll('[data-modele]').forEach((b) => {
    b.addEventListener('click', async () => {
      const p = modeleDepuisLivret(b.dataset.modele, aujourdhui());
      if (!p) { toast('Ce livret ne se découpe pas en jours.'); return; }
      await saveProgramme(p);
      toast(`« ${p.titre} » commence aujourd'hui — ${nbJours(p)} jours.`);
      location.hash = `#/programmes/${p.id}`;
    });
  });

  // — le programme du mois, à dates fixes —
  document.querySelector('[data-trente-jours]')?.addEventListener('click', async () => {
    const { ID_TRENTE_JOURS, modeleTrenteJours } = trenteJours;
    if (!(await getProgramme(ID_TRENTE_JOURS))) {
      const p = modeleTrenteJours();
      if (!p) { toast("Le livret n'est pas indexé."); return; }
      await saveProgramme(p);
      // Le programme porte déjà la prière de Joseph matin, midi et soir, à ses dates :
      // les anciens rappels quotidiens « Comme Joseph » feraient doublon.
      for (const id of ['joseph-matin', 'joseph-midi', 'joseph-soir']) await deleteAlarm(id);
      toast(`« ${p.titre} » programmé du 7 octobre au 5 novembre — ${p.seances.length} séances.`);
    } else toast('Ce programme est déjà en place.');
    location.hash = `#/programmes/${ID_TRENTE_JOURS}`;
  });

  brancherCochage();
}

/** Cochage : écouteur délégué posé une seule fois — chaque rendu remplace le contenu, pas le conteneur. */
let cochageBranche = false;
function brancherCochage() {
  if (cochageBranche) return;
  cochageBranche = true;
  $('programmes').addEventListener('click', async (e) => {
    // « Prier » depuis le programme vaut l'accueil : deux minutes dans le texte valident la séance du jour.
    const prier = e.target.closest('.pg-ouvrir')?.closest('.pg-seance');
    if (prier) {
      const { prog, jour, seance } = prier.dataset;
      if (jour === aujourdhui() && !prier.classList.contains('fait')) armerLecture(`prog:${prog}:${jour}:${seance}`);
      return;
    }
    const el = e.target.closest('[data-check]')?.closest('.pg-seance');
    if (!el) return;
    await basculer(el.dataset.prog, el.dataset.jour, el.dataset.seance);
    renderProgrammes(location.hash.startsWith('#/programmes/') ? location.hash.slice(13) : '');
  });
}

function brancherUn(p) {
  $('pgICS')?.addEventListener('click', () => {
    telechargerICS(p);
    toast('Fichier .ics téléchargé — un rendez-vous par séance, sur la seule durée du programme.');
  });
  $('pgDel')?.addEventListener('click', async () => {
    if (!confirm(`Supprimer « ${p.titre} » et son suivi ?`)) return;
    await deleteProgramme(p.id);
    toast('Programme supprimé.');
    location.hash = '#/programmes';
  });

  brancherCochage();
}

/* ═══════════════ Suggestions tirées de la semaine de prière ═══════════════ */

/** Mots-outils : trop communs pour indiquer un thème, à écarter des intentions. */
const MOTS_VIDES = new Set(['pour','avec','dans','vers','tout','tous','toute','toutes','cette','contre',
  'leur','leurs','notre','votre','nos','vos','sur','les','des','une','que','qui','ses','mes','ces',
  'sans','plus','être','avoir','fait','faire','sera','sont','soit','ceux','celle','celles','celui']);

/** Mots significatifs (4 lettres ou plus, hors mots-outils) d'un texte libre, accents ignorés. */
const motsClefs = (texte) => (texte || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z]+/i).filter((m) => m.length >= 4 && !MOTS_VIDES.has(m));

/**
 * Livres suggérés d'après les prières programmées cette semaine (aujourd'hui + 6 jours).
 * Pondère les tags des livres déjà liés à une séance et les mots-clefs des intentions et
 * intitulés (y compris sans livre, pour les séances composées à la main), puis classe le
 * reste du catalogue par recoupement. Exclut ce qui est déjà programmé cette semaine.
 */
export async function suggestionsSemaine(n = 3) {
  const debut = aujourdhui();
  const jours = Array.from({ length: 7 }, (_, i) => plusDeJours(debut, i));
  const programmes = (await allProgrammes()).filter((p) => etat(p) !== 'termine');
  const seances = programmes.flatMap((p) => jours.flatMap((j) => seancesDu(p, j)));
  if (!seances.length) return [];

  const dejaId = new Set(seances.map((s) => s.bookId).filter(Boolean));
  const poids = new Map();
  const ajoute = (m, v) => poids.set(m, (poids.get(m) || 0) + v);

  for (const s of seances) {
    const livre = s.bookId ? bookOf(s.bookId) : null;
    if (livre) (livre.tags || []).forEach((t) => ajoute(t.toLowerCase(), 2));
    motsClefs(s.intention).forEach((m) => ajoute(m, 1));
    motsClefs(s.intitule).forEach((m) => ajoute(m, 1));
  }
  if (!poids.size) return [];

  const score = (b) => {
    let s = 0;
    for (const t of (b.tags || [])) s += poids.get(t.toLowerCase()) || 0;
    for (const m of new Set(motsClefs(b.summary))) s += (poids.get(m) || 0) * 0.3;
    return s;
  };

  return state.catalog.books
    .filter((b) => !dejaId.has(b.id))
    .map((b) => ({ b, s: score(b) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.b);
}
