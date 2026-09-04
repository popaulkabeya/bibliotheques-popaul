/**
 * pratique.js — La régularité de la pratique dans le temps.
 * Un miroir, pas un jeu : ce que tu tiens, ce qui glisse, sans badge ni récompense.
 */
import { allAlarms, toutesLesFaites, jourClef, allProgrammes } from './store.js';
import { seancesDu, estFait as seanceFaite, progression, etat as etatProgramme, nbJours } from './programmes.js';
import { escapeHtml } from './reader.js';
import { bookOf } from './library.js';

const $ = (id) => document.getElementById(id);
const JOURS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const FENETRE = 90;                     // minutes de grâce après l'heure prévue

const dateDe = (iso) => { const [y, m, j] = iso.split('-').map(Number); return new Date(y, m - 1, j); };
const decale = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const hhmm = (h, m) => `${String(h).padStart(2, '0')} h ${String(m).padStart(2, '0')}`;
const pct = (n, t) => (t ? Math.round((n / t) * 100) : null);

/* ═══════════════ Calcul ═══════════════ */

/**
 * Reconstitue chaque journée : prières dues, faites, manquées.
 * Une prière n'est due qu'à partir de sa date de création — ou, pour les rappels
 * antérieurs à cette règle, de la première fois où elle a été pointée.
 */
/**
 * Traduit les séances d'un programme de prière dans la même forme qu'un rappel,
 * pour qu'elles comptent dans une régularité unique — sans dupliquer leur suivi :
 * `p.faits` reste la seule source de vérité pour un programme, on ne fait que la lire.
 */
export function seancesCommeItems(programmes, iso) {
  const items = [];
  for (const p of programmes) {
    if (iso < p.debut || iso > p.fin) continue;                 // hors période : rien dû
    for (const s of seancesDu(p, iso)) {
      const [h, m] = s.heure.split(':').map(Number);
      items.push({
        id: `prog:${p.id}:${iso}:${s.id}`, source: 'prog', programmeId: p.id, jour: iso, seanceId: s.id,
        label: s.intention || p.titre, sectionLabel: p.titre,
        hour: h, minute: m, bookId: s.bookId, volume: s.volume ?? 0,
        section: s.h3 != null ? `p${s.h3}` : null,
        faite: seanceFaite(p, iso, s.id),
      });
    }
  }
  return items;
}

export async function historique(nbJours = 35) {
  const alarmes = (await allAlarms()).filter((a) => a.enabled);
  const programmes = await allProgrammes();
  const faites = (await toutesLesFaites()) || [];

  const parJour = new Map();
  const premiere = new Map();
  for (const f of faites) {
    if (!parJour.has(f.jour)) parJour.set(f.jour, new Set());
    parJour.get(f.jour).add(f.alarmId);
    if (!premiere.has(f.alarmId) || f.jour < premiere.get(f.alarmId)) premiere.set(f.alarmId, f.jour);
  }
  const aujourdhui = jourClef();
  const debut = (a) => a.createdAt || premiere.get(a.id) || aujourdhui;

  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const jours = [];
  for (let i = nbJours - 1; i >= 0; i--) {
    const d = decale(now, -i);
    const iso = jourClef(d);
    const estAujourdhui = iso === aujourdhui;

    const duesAlarmes = alarmes.filter((a) => a.days.includes(d.getDay()) && debut(a) <= iso);
    const pointees = parJour.get(iso) || new Set();
    const duesProg = seancesCommeItems(programmes, iso);   // portent déjà leur propre `faite`

    const dues = [
      ...duesAlarmes.map((a) => ({ ...a, source: 'alarm', faite: pointees.has(a.id) })),
      ...duesProg,
    ];
    const faitesJ = dues.filter((x) => x.faite);
    // Aujourd'hui, seules les prières dont l'heure est passée peuvent être manquées.
    const echues = estAujourdhui
      ? dues.filter((x) => x.hour * 60 + x.minute + FENETRE <= minutesNow) : dues;
    const manquees = echues.filter((x) => !x.faite);
    const aVenir = estAujourdhui ? dues.filter((x) => !echues.includes(x) && !x.faite) : [];
    jours.push({ iso, date: d, dues, faites: faitesJ, manquees, aVenir, estAujourdhui,
                 ratio: pct(faitesJ.length, faitesJ.length + manquees.length) });
  }
  return { alarmes, programmes, jours };
}

/** Jours consécutifs sans prière manquée, en remontant depuis aujourd'hui. */
export function serie(jours) {
  let n = 0;
  for (let i = jours.length - 1; i >= 0; i--) {
    const j = jours[i];
    if (j.manquees.length) return n;
    if (!j.dues.length) continue;                       // rien de prévu : ne casse pas la série
    if (j.estAujourdhui && j.aVenir.length) continue;   // journée encore ouverte
    if (!j.faites.length) return n;
    n++;
  }
  return n;
}

const cumul = (jours, alarme) => {
  let dus = 0, faits = 0;
  for (const j of jours) {
    if (j.dues.some((a) => a.id === alarme.id) && (!j.estAujourdhui || !j.aVenir.some((a) => a.id === alarme.id))) dus++;
    if (j.faites.some((a) => a.id === alarme.id)) faits++;
  }
  return { dus, faits };
};

const total = (jours) => jours.reduce((s, j) => ({ f: s.f + j.faites.length, m: s.m + j.manquees.length }), { f: 0, m: 0 });

/* ═══════════════ Rendu ═══════════════ */

export async function renderPratique() {
  const host = $('pratique');
  const { alarmes, programmes, jours } = await historique(35);
  const semaine = jours.slice(-7);
  const t7 = total(semaine), t30 = total(jours.slice(-30));
  const progActifs = programmes.filter((p) => (p.seances || []).length && jours.some((j) => j.dues.some((x) => x.programmeId === p.id)));

  if (!alarmes.length && !progActifs.length) {
    host.innerHTML = `
      <header class="home-head"><p class="home-date">Pratique</p><h1>Ta régularité.</h1></header>
      <p class="pr-vide">Rien à mesurer encore : aucune prière n'est programmée.
        <a href="#/rappels">Programmer un rappel →</a></p>`;
    return;
  }

  host.innerHTML = `
    <header class="home-head">
      <p class="home-date">Pratique</p>
      <h1>Ta régularité.</h1>
      <p class="rap-lede">Ce que tu tiens, ce qui glisse. Une prière compte comme faite quand tu la pointes
        sur l'accueil ; manquée quand son heure est passée de plus de ${FENETRE} minutes sans pointage.</p>
    </header>

    <div class="pr-stats">
      <div class="pr-stat"><b>${serie(jours)}</b><span>jour${serie(jours) > 1 ? 's' : ''} d'affilée</span></div>
      <div class="pr-stat"><b>${pct(t7.f, t7.f + t7.m) ?? '—'}${pct(t7.f, t7.f + t7.m) === null ? '' : ' %'}</b>
        <span>cette semaine · ${t7.f} sur ${t7.f + t7.m}</span></div>
      <div class="pr-stat"><b>${pct(t30.f, t30.f + t30.m) ?? '—'}${pct(t30.f, t30.f + t30.m) === null ? '' : ' %'}</b>
        <span>sur 30 jours · ${t30.f} sur ${t30.f + t30.m}</span></div>
    </div>

    <section class="home-block">
      <h2 class="home-h">Les sept derniers jours</h2>
      <div class="pr-semaine">${semaine.map(colonneJour).join('')}</div>
      <p class="pr-legende"><i class="ok"></i> faite <i class="ko"></i> manquée <i class="av"></i> à venir</p>
    </section>

    ${alarmes.length ? `
    <section class="home-block">
      <h2 class="home-h">Par prière</h2>
      <div class="pr-liste">${alarmes.map((a) => lignePriere(a, jours)).join('')}</div>
    </section>` : ''}

    ${progActifs.length ? `
    <section class="home-block">
      <h2 class="home-h">Programmes en cours</h2>
      <div class="pr-liste">${progActifs.map(ligneProgramme).join('')}</div>
    </section>` : ''}

    <section class="home-block">
      <h2 class="home-h">Les cinq dernières semaines</h2>
      <div class="pr-grille">${jours.map(caseMois).join('')}</div>
    </section>`;
}

function colonneJour(j) {
  const points = [
    ...j.faites.map((a) => `<i class="ok" title="${escapeHtml(a.label)} — faite"></i>`),
    ...j.manquees.map((a) => `<i class="ko" title="${escapeHtml(a.label)} — manquée"></i>`),
    ...j.aVenir.map((a) => `<i class="av" title="${escapeHtml(a.label)} — à venir"></i>`),
  ].join('');
  return `
  <div class="pr-jour ${j.estAujourdhui ? 'auj' : ''}">
    <span class="pr-jour-nom">${JOURS[j.date.getDay()]}</span>
    <span class="pr-jour-num">${j.date.getDate()}</span>
    <div class="pr-points">${points || '<i class="none" title="rien de prévu"></i>'}</div>
  </div>`;
}

function lignePriere(a, jours) {
  const s7 = cumul(jours.slice(-7), a), s30 = cumul(jours.slice(-30), a);
  const barre = (s) => `<div class="pr-barre" title="${s.faits} sur ${s.dus}">
      <span style="width:${s.dus ? (s.faits / s.dus) * 100 : 0}%"></span></div>`;
  const livre = bookOf(a.bookId);
  return `
  <div class="pr-ligne">
    <div class="pr-ligne-tete">
      <b>${escapeHtml(a.label)}</b>
      <small>${hhmm(a.hour, a.minute)} · ${escapeHtml(a.sectionLabel || livre?.title || '')}</small>
    </div>
    <div class="pr-mesure"><span>7 j</span>${barre(s7)}<em>${s7.faits}/${s7.dus}</em></div>
    <div class="pr-mesure"><span>30 j</span>${barre(s30)}<em>${s30.faits}/${s30.dus}</em></div>
  </div>`;
}

function ligneProgramme(p) {
  const pr = progression(p);
  const j = nbJours(p);
  const encours = etatProgramme(p) === 'encours';
  return `
  <div class="pr-ligne" data-go-programme="${p.id}">
    <div class="pr-ligne-tete">
      <b>${escapeHtml(p.titre)}</b>
      <small>${j} jour${j > 1 ? 's' : ''} · ${encours ? 'en cours' : etatProgramme(p)}</small>
    </div>
    <div class="pr-mesure"><span>Total</span>
      <div class="pr-barre" title="${pr.faits} sur ${pr.total}"><span style="width:${pr.pct}%"></span></div>
      <em>${pr.faits}/${pr.total}</em>
    </div>
  </div>`;
}

function caseMois(j) {
  const cls = j.ratio === null ? 'vide' : j.ratio === 100 ? 'plein' : j.ratio >= 50 ? 'moitie' : 'peu';
  const titre = `${JOURS[j.date.getDay()]} ${j.date.getDate()} — ${j.dues.length ? `${j.faites.length} faite(s), ${j.manquees.length} manquée(s)` : 'rien de prévu'}`;
  return `<i class="pr-case ${cls} ${j.estAujourdhui ? 'auj' : ''}" title="${escapeHtml(titre)}"></i>`;
}
