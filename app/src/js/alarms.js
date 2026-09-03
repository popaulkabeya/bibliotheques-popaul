/**
 * alarms.js — Rappels de prière.
 *
 * Le web ne sait pas réveiller une application fermée. Deux réponses complémentaires :
 *  — un minuteur interne qui notifie tant que l'application tourne (onglet, même en arrière-plan) ;
 *  — un export .ics, pour confier les rappels à l'agenda du téléphone, qui lui sonne toujours.
 */
import { allAlarms, saveAlarm, deleteAlarm } from './store.js';
import { escapeHtml } from './reader.js';
import { bookOf } from './library.js';

const $ = (id) => document.getElementById(id);
const JOURS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const JOURS_ICS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

let ticker = null;
let onOuvrir = null;          // (bookId, volume, section) → ouvre le lecteur

/* ═══════════════ Planification ═══════════════ */

const clef = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const hhmm = (h, m) => `${String(h).padStart(2, '0')} h ${String(m).padStart(2, '0')}`;

/** Démarre la surveillance. Un battement par demi-minute suffit pour une précision à la minute. */
export function demarrer(ouvrir) {
  onOuvrir = ouvrir;
  arreter();
  verifier();
  ticker = setInterval(verifier, 30000);
}
export function arreter() { if (ticker) { clearInterval(ticker); ticker = null; } }

async function verifier() {
  const maintenant = new Date();
  const jour = maintenant.getDay();
  const minutes = maintenant.getHours() * 60 + maintenant.getMinutes();

  for (const a of await allAlarms()) {
    if (!a.enabled || !a.days.includes(jour)) continue;
    const prevu = a.hour * 60 + a.minute;
    const retard = minutes - prevu;
    // Fenêtre de 3 minutes : un onglet endormi peut rater la minute exacte.
    if (retard < 0 || retard > 3) continue;
    if (a.lastFired === clef(maintenant) + '-' + prevu) continue;

    a.lastFired = clef(maintenant) + '-' + prevu;
    await saveAlarm(a);
    sonner(a);
  }
}

/** Prochaine occurrence d'un rappel, en texte lisible. */
export function prochaine(a) {
  if (!a.enabled || !a.days.length) return 'désactivé';
  const now = new Date();
  for (let d = 0; d < 8; d++) {
    const j = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, a.hour, a.minute);
    if (a.days.includes(j.getDay()) && j > now) {
      if (d === 0) return `aujourd'hui à ${hhmm(a.hour, a.minute)}`;
      if (d === 1) return `demain à ${hhmm(a.hour, a.minute)}`;
      return `${JOURS[j.getDay()]}. à ${hhmm(a.hour, a.minute)}`;
    }
  }
  return '—';
}

/* ═══════════════ Notification ═══════════════ */

export const permission = () => (('Notification' in window) ? Notification.permission : 'unsupported');

export async function demanderPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

function sonner(a) {
  const livre = bookOf(a.bookId);
  const corps = livre ? `${livre.title}${a.sectionLabel ? ' · ' + a.sectionLabel : ''}` : '';

  if (permission() === 'granted') {
    const n = new Notification(a.label, { body: corps, icon: 'icons/icon-192.png', tag: a.id,
                                          badge: 'icons/icon-192.png', requireInteraction: false });
    n.onclick = () => { window.focus(); ouvrirDepuis(a); n.close(); };
  }
  banniere(a);
}

/** Repli visible dans l'application, utile aussi quand les notifications sont refusées. */
function banniere(a) {
  const livre = bookOf(a.bookId);
  const el = document.createElement('div');
  el.className = 'alarm-pop';
  el.innerHTML = `
    <span class="ap-glyph">☩</span>
    <div class="ap-body">
      <b>${escapeHtml(a.label)}</b>
      <small>${escapeHtml(livre ? livre.title : '')}${a.sectionLabel ? ' · ' + escapeHtml(a.sectionLabel) : ''}</small>
    </div>
    <button class="ap-go">Ouvrir</button>
    <button class="ap-close" aria-label="Fermer">✕</button>`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 20);   // pas de rAF : gelé en arrière-plan

  const fermer = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 320); };
  el.querySelector('.ap-go').addEventListener('click', () => { ouvrirDepuis(a); fermer(); });
  el.querySelector('.ap-close').addEventListener('click', fermer);
  setTimeout(fermer, 60000);
}

const ouvrirDepuis = (a) => onOuvrir?.(a.bookId, a.volume ?? 0, a.section ?? null, a.id);

/* ═══════════════ Export vers l'agenda ═══════════════ */

const pad = (n) => String(n).padStart(2, '0');

/** Fuseau de l'appareil : un rappel exporté doit sonner à la même heure locale. */
const fuseau = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
};

/** Fichier .ics avec une règle de répétition hebdomadaire par rappel. */
export function versICS(alarmes) {
  const l = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bibliotheque Spirituelle//FR',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Prières',
  ];
  const d = new Date();
  const base = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

  alarmes.filter((a) => a.enabled && a.days.length).forEach((a, i) => {
    const livre = bookOf(a.bookId);
    l.push('BEGIN:VEVENT',
      `UID:${a.id}@bibliotheque-spirituelle`,
      `DTSTAMP:${base}T000000Z`,
      `DTSTART;TZID=${fuseau()}:${base}T${pad(a.hour)}${pad(a.minute)}00`,
      `DURATION:PT15M`,
      `RRULE:FREQ=WEEKLY;BYDAY=${a.days.map((j) => JOURS_ICS[j]).join(',')}`,
      `SUMMARY:${echapICS(a.label)}`,
      `DESCRIPTION:${echapICS((livre ? livre.title : '') + (a.sectionLabel ? ' — ' + a.sectionLabel : ''))}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M',
      `DESCRIPTION:${echapICS(a.label)}`, 'END:VALARM',
      'END:VEVENT');
  });
  l.push('END:VCALENDAR');
  return l.join('\r\n');
}

const echapICS = (t) => String(t).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

export function telechargerICS(alarmes) {
  const blob = new Blob([versICS(alarmes)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'prieres.ics';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ═══════════════ Création rapide des trois offices ═══════════════ */

export async function creerLesTroisOffices() {
  const livret = bookOf('livret-trois-prieres');
  if (!livret) return 0;
  const modeles = [
    { s: 0, h: 6,  label: 'Invocation du Matin',  sectionLabel: 'Matin · 6 h 00' },
    { s: 1, h: 12, label: 'Invocation de Midi',   sectionLabel: 'Midi · 12 h 00' },
    { s: 2, h: 21, label: 'Invocation du Soir',   sectionLabel: 'Soir · 21 h 00' },
  ];
  const existants = await allAlarms();
  let n = 0;
  for (const m of modeles) {
    if (existants.some((a) => a.bookId === livret.id && a.section === m.s)) continue;
    await saveAlarm({
      id: `office-${m.s}`, label: m.label, sectionLabel: m.sectionLabel,
      bookId: livret.id, volume: 0, section: m.s,
      hour: m.h, minute: 0, days: [0, 1, 2, 3, 4, 5, 6], enabled: true, lastFired: '',
    });
    n++;
  }
  return n;
}

export { allAlarms, saveAlarm, deleteAlarm };

/* ═══════════════ Interface ═══════════════ */

/** Sections proposées pour un livre — seul le livret en a d'utiles. */
const sectionsDe = (bookId) =>
  bookId === 'livret-trois-prieres'
    ? [{ v: 0, t: 'Matin · 6 h 00' }, { v: 1, t: 'Midi · 12 h 00' }, { v: 2, t: 'Soir · 21 h 00' }]
    : [];

export async function renderRappels(livres) {
  const alarmes = await allAlarms();
  const perm = permission();

  $('rappels').innerHTML = `
    <header class="home-head">
      <p class="home-date">Rappels</p>
      <h1>Être appelé à l'heure.</h1>
      <p class="rap-lede">Un rappel sonne tant que la bibliothèque est ouverte quelque part —
        onglet en arrière-plan compris. Pour être réveillé même application fermée,
        exporte-les vers l'agenda de ton téléphone : lui sonne toujours.</p>
    </header>

    ${perm !== 'granted' ? `
    <div class="rap-perm ${perm === 'denied' ? 'refuse' : ''}">
      <span>${perm === 'denied'
        ? "Les notifications sont refusées pour ce site. Réautorise-les dans les réglages du navigateur — en attendant, un bandeau s'affichera dans l'application."
        : 'Autorise les notifications pour être prévenu même quand tu regardes ailleurs.'}</span>
      ${perm === 'denied' ? '' : '<button class="mini-btn" id="rapPerm">Autoriser</button>'}
    </div>` : ''}

    <section class="home-block">
      <h2 class="home-h">Mes rappels</h2>
      ${alarmes.length ? `<div class="rap-list">${alarmes.map(ligne).join('')}</div>`
        : `<p class="rap-vide">Aucun rappel pour l'instant.</p>`}
      <div class="rap-tools">
        <button class="mini-btn" id="rapTrois">Créer les trois offices</button>
        <button class="mini-btn" id="rapICS"${alarmes.length ? '' : ' disabled'}>Exporter vers mon agenda</button>
      </div>
    </section>

    <section class="home-block">
      <h2 class="home-h">Nouveau rappel</h2>
      <form class="rap-form" id="rapForm">
        <label>Intitulé<input name="label" id="rapLabel" maxlength="60"
          placeholder="Nom du rappel"></label>
        <label>Texte à ouvrir<select name="bookId" id="rapBook">
          ${livres.map((b) => `<option value="${b.id}"${b.id === 'livret-trois-prieres' ? ' selected' : ''}>${escapeHtml(b.title)}</option>`).join('')}
        </select></label>
        <label id="rapSecWrap">Passage<select name="section" id="rapSec"></select></label>
        <label>Heure<input type="time" name="heure" value="06:00" required></label>
        <fieldset class="rap-days">
          <legend>Jours</legend>
          ${JOURS.map((j, i) => `<label class="rap-day"><input type="checkbox" name="j" value="${i}" checked><span>${j}</span></label>`).join('')}
        </fieldset>
        <button class="act primary" type="submit">Ajouter le rappel</button>
      </form>
    </section>`;

  majSections();
  brancher(livres);
}

function ligne(a) {
  return `
  <div class="rap-item ${a.enabled ? '' : 'off'}" data-id="${a.id}">
    <button class="rap-toggle" data-toggle title="${a.enabled ? 'Désactiver' : 'Activer'}">${a.enabled ? '◉' : '○'}</button>
    <div class="rap-time">${hhmm(a.hour, a.minute)}</div>
    <div class="rap-body">
      <b>${escapeHtml(a.label)}</b>
      <small>${escapeHtml(a.sectionLabel || (bookOf(a.bookId)?.title ?? ''))} · ${a.days.length === 7 ? 'tous les jours' : a.days.map((j) => JOURS[j]).join(' ')}</small>
      <small class="rap-next">Prochain : ${escapeHtml(prochaine(a))}</small>
    </div>
    <button class="rap-del" data-del title="Supprimer">✕</button>
  </div>`;
}

let intituleTouche = false;

function majSections() {
  const sel = $('rapSec');
  const opts = sectionsDe($('rapBook').value);
  $('rapSecWrap').hidden = !opts.length;
  sel.innerHTML = opts.map((o) => `<option value="${o.v}">${o.t}</option>`).join('');
  majIntitule();
}

/** L'intitulé suit le texte choisi tant que l'utilisateur ne l'a pas écrit lui-même. */
function majIntitule() {
  const champ = $('rapLabel');
  if (!champ || intituleTouche) return;
  const livre = bookOf($('rapBook').value);
  champ.value = livre ? livre.title : '';
}

function brancher(livres) {
  intituleTouche = false;
  $('rapBook')?.addEventListener('change', majSections);
  $('rapLabel')?.addEventListener('input', () => { intituleTouche = true; });
  $('rapPerm')?.addEventListener('click', async () => { await demanderPermission(); renderRappels(livres); });

  $('rapTrois')?.addEventListener('click', async () => {
    const n = await creerLesTroisOffices();
    await demanderPermission();
    renderRappels(livres);
    document.dispatchEvent(new CustomEvent('bs:toast', {
      detail: n ? `${n} rappel${n > 1 ? 's' : ''} créé${n > 1 ? 's' : ''}.` : 'Les trois offices sont déjà programmés.' }));
  });

  $('rapICS')?.addEventListener('click', async () => {
    telechargerICS(await allAlarms());
    document.dispatchEvent(new CustomEvent('bs:toast', {
      detail: "Fichier prieres.ics téléchargé — ouvre-le pour l'ajouter à ton agenda." }));
  });

  $('rappels').querySelectorAll('.rap-item').forEach((el) => {
    el.querySelector('[data-toggle]').addEventListener('click', async () => {
      const a = (await allAlarms()).find((x) => x.id === el.dataset.id);
      if (!a) return;
      a.enabled = !a.enabled;
      await saveAlarm(a);
      renderRappels(livres);
    });
    el.querySelector('[data-del]').addEventListener('click', async () => {
      await deleteAlarm(el.dataset.id);
      renderRappels(livres);
    });
  });

  $('rapForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const [h, m] = String(f.get('heure')).split(':').map(Number);
    const jours = [...e.target.querySelectorAll('[name=j]:checked')].map((c) => +c.value);
    if (!jours.length) {
      document.dispatchEvent(new CustomEvent('bs:toast', { detail: 'Choisis au moins un jour.' }));
      return;
    }
    const bookId = String(f.get('bookId'));
    const sec = $('rapSecWrap').hidden ? null : Number(f.get('section'));
    // Jamais de blocage silencieux : sans intitulé, on prend le titre du texte.
    const titre = String(f.get('label') || '').trim() || bookOf(bookId)?.title || 'Rappel';
    await saveAlarm({
      id: 'a' + Math.random().toString(36).slice(2, 10),
      label: titre, bookId, volume: 0, section: sec,
      sectionLabel: sec === null ? '' : (sectionsDe(bookId)[sec]?.t || ''),
      hour: h, minute: m, days: jours, enabled: true, lastFired: '',
    });
    await demanderPermission();
    intituleTouche = false;
    e.target.reset();
    renderRappels(livres);
    document.dispatchEvent(new CustomEvent('bs:toast', { detail: `« ${titre} » programmé à ${hhmm(h, m)}.` }));
  });
}

/* ═══════════════ Planificateur par ouvrage ═══════════════ */

/**
 * Formulaire compact de programmation, injecté dans la fiche d'un livre.
 * Permet de choisir l'édition, le passage, l'heure et les jours de lecture.
 * @param {object} book       l'ouvrage concerné
 * @param {HTMLElement} hote  conteneur où dessiner le formulaire
 * @param {() => void} apres  appelé après enregistrement
 */
export function planificateurPour(book, hote, apres) {
  const sections = sectionsDe(book.id);
  const multi = book.volumes.length > 1;

  hote.innerHTML = `
    <form class="plan-form">
      <p class="plan-h">Programmer une lecture</p>
      <label>Intitulé<input name="label" value="${escapeHtml(book.title)}" maxlength="60" required></label>
      ${multi ? `<label>Édition<select name="volume">
        ${book.volumes.map((v, i) => `<option value="${i}">${escapeHtml(v.label)}</option>`).join('')}
      </select></label>` : ''}
      ${sections.length ? `<label>Passage<select name="section">
        ${sections.map((o) => `<option value="${o.v}">${o.t}</option>`).join('')}
      </select></label>` : ''}
      <label>Heure<input type="time" name="heure" value="06:00" required></label>
      <fieldset class="rap-days">
        <legend>Jours</legend>
        ${JOURS.map((j, i) => `<label class="rap-day"><input type="checkbox" name="j" value="${i}" checked><span>${j}</span></label>`).join('')}
      </fieldset>
      <div class="plan-actions">
        <button type="submit" class="act primary">Programmer</button>
        <button type="button" class="act" data-annuler>Annuler</button>
      </div>
    </form>`;

  const form = hote.querySelector('form');
  form.querySelector('[data-annuler]').addEventListener('click', () => { hote.innerHTML = ''; apres?.(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const jours = [...form.querySelectorAll('[name=j]:checked')].map((c) => +c.value);
    if (!jours.length) {
      document.dispatchEvent(new CustomEvent('bs:toast', { detail: 'Choisis au moins un jour.' }));
      return;
    }
    const [h, m] = String(f.get('heure')).split(':').map(Number);
    const sec = sections.length ? Number(f.get('section')) : null;

    await saveAlarm({
      id: 'a' + Math.random().toString(36).slice(2, 10),
      label: String(f.get('label')).trim() || book.title,
      bookId: book.id,
      volume: multi ? Number(f.get('volume')) : 0,
      section: sec,
      sectionLabel: sec === null ? '' : (sections[sec]?.t || ''),
      hour: h, minute: m, days: jours, enabled: true, lastFired: '',
    });
    await demanderPermission();
    hote.innerHTML = '';
    apres?.();
    document.dispatchEvent(new CustomEvent('bs:toast', {
      detail: `« ${book.title} » programmé à ${hhmm(h, m)}, ` +
        `${jours.length === 7 ? 'tous les jours' : jours.map((j) => JOURS[j]).join(', ')}.` }));
  });
}
