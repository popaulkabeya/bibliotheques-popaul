/**
 * home.js — Page d'accueil : point de départ quotidien plutôt qu'un simple rayonnage.
 * Met en avant l'office correspondant à l'heure, la lecture en cours et un texte du jour.
 */
import { recent, allAlarms, faitesDuJour, marquerFaite, retirerFaite } from './store.js';
import { escapeHtml, url } from './reader.js';
import { state, catOf, bookOf } from './library.js';
import { resumer } from './progress.js';

const $ = (id) => document.getElementById(id);

/* ─────────── L'office du moment ─────────── */

const OFFICES = [
  { id: 'matin', titre: 'Invocation du Matin', heure: '6 h 00', glyphe: '☀',
    mots: 'Éveil · Identité · Intention · Abondance', de: 5,  a: 12 },
  { id: 'midi',  titre: 'Invocation de Midi',  heure: '12 h 00', glyphe: '☉',
    mots: 'Recentrage · Décharge · Gratitude · Bénédiction', de: 12, a: 18 },
  { id: 'soir',  titre: 'Invocation du Soir',  heure: '21 h 00', glyphe: '☾',
    mots: 'Réflexion · Confiance · Protection · Reconnaissance', de: 18, a: 5 },
];

/** L'office en cours, d'après l'heure locale. Le soir enjambe minuit. */
export function officeDuMoment(h = new Date().getHours()) {
  return OFFICES.find((o) => (o.de < o.a ? h >= o.de && h < o.a : h >= o.de || h < o.a)) || OFFICES[0];
}

const salutation = (h = new Date().getHours()) =>
  h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';

const dateLongue = (d = new Date()) =>
  d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });


/* ─────────── L'agenda du jour ─────────── */

const JOURS_COURTS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

/**
 * Les rappels programmés pour aujourd'hui, ordonnés par heure, avec leur état.
 * Une prière est « à faire maintenant » dans les 90 minutes qui suivent son heure :
 * au-delà, on la considère passée sans pour autant la cacher.
 */
export async function agendaDuJour(maintenant = new Date()) {
  const jour = maintenant.getDay();
  const minutes = maintenant.getHours() * 60 + maintenant.getMinutes();
  const faites = await faitesDuJour();

  return (await allAlarms())
    .filter((a) => a.enabled && a.days.includes(jour))
    .map((a) => {
      const prevu = a.hour * 60 + a.minute;
      const ecart = minutes - prevu;
      // Une prière accomplie le reste, quelle que soit l'heure. Sinon : à venir,
      // puis « c'est l'heure » pendant 90 minutes, puis manquée.
      const etat = faites.has(a.id) ? 'faite'
        : ecart < 0 ? 'avenir'
        : ecart <= 90 ? 'maintenant'
        : 'manquee';
      return { ...a, prevu, ecart, etat, faite: faites.has(a.id) };
    })
    .sort((a, b) => a.prevu - b.prevu);
}

const hhmm = (h, m) => `${String(h).padStart(2, '0')} h ${String(m).padStart(2, '0')}`;

const ETIQUETTES = { maintenant: "c'est l'heure", avenir: 'à venir',
                     manquee: 'manquée', faite: 'faite' };

function ligneAgenda(a) {
  const livre = bookOf(a.bookId);
  const cat = livre ? catOf(livre.category) : null;
  const sec = a.section !== null && a.section !== undefined ? `data-sec="${a.section}"` : '';
  // Ouvrir la ligne arme la validation par la lecture (voir app.js) ; inutile si c'est déjà fait.
  const alarme = a.faite ? '' : `data-alarm="${a.id}"`;
  return `
  <div class="ag-item ${a.etat}" style="--cat:${cat?.accent || '#d9a441'}">
    <button class="ag-check" data-faite="${a.id}" aria-pressed="${a.faite}"
            title="${a.faite ? 'Marquer comme non faite' : 'Marquer comme faite'}">
      ${a.faite ? '✓' : ''}
    </button>
    <span class="ag-heure">${hhmm(a.hour, a.minute)}</span>
    <span class="ag-corps" data-go="${a.bookId}" data-vol="${a.volume ?? 0}" ${sec} ${alarme}>
      <b>${escapeHtml(a.label)}</b>
      <small>${escapeHtml(a.sectionLabel || livre?.title || '')}</small>
    </span>
    <span class="ag-etat">${ETIQUETTES[a.etat]}</span>
  </div>`;
}

/** Bilan de la journée, en une phrase. */
function bilan(agenda) {
  const n = (e) => agenda.filter((a) => a.etat === e).length;
  const parts = [];
  if (n('faite')) parts.push(`<b>${n('faite')}</b> faite${n('faite') > 1 ? 's' : ''}`);
  if (n('manquee')) parts.push(`<b class="manq">${n('manquee')}</b> manquée${n('manquee') > 1 ? 's' : ''}`);
  const reste = n('avenir') + n('maintenant');
  if (reste) parts.push(`<b>${reste}</b> à venir`);
  return parts.join(' · ');
}

/* ─────────── Texte du jour ─────────── */

/** Choix stable sur la journée : le même livre du lever au coucher, un autre demain. */
function texteDuJour(exclure = []) {
  const pool = state.catalog.books.filter((b) => !exclure.includes(b.id));
  if (!pool.length) return null;
  const d = new Date();
  const jour = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  return pool[(jour * 7 + d.getFullYear()) % pool.length];
}

/* ─────────── Rendu ─────────── */

export async function renderHome() {
  const office = officeDuMoment();
  const livret = bookOf('livret-trois-prieres');
  const reprises = (await recent(3)) || [];
  const agenda = await agendaDuJour();
  const aFaire = agenda.filter((a) => a.etat !== 'passe');
  const suggestion = texteDuJour([livret?.id, ...reprises.map((r) => r.bookId)]);

  $('home').innerHTML = `
    <header class="home-head">
      <p class="home-date">${escapeHtml(dateLongue())}</p>
      <h1>${salutation()}.</h1>
    </header>

    ${agenda.length ? `
    <section class="home-block">
      <h2 class="home-h">Aujourd'hui · ${JOURS_COURTS[new Date().getDay()]}.</h2>
      <p class="ag-bilan">${bilan(agenda)}</p>
      <div class="agenda">${agenda.map(ligneAgenda).join('')}</div>
      <p class="ag-lien"><a href="#/pratique">Voir ma régularité →</a></p>
    </section>` : (livret ? officeCard(office, livret) : '')}

    ${reprises.length ? `
    <section class="home-block">
      <h2 class="home-h">Reprendre où tu t'es arrêté</h2>
      <div class="home-resume">${reprises.map(resumeCard).join('')}</div>
    </section>` : ''}

    <section class="home-block">
      <h2 class="home-h">Les six corpus</h2>
      <div class="home-corpus">${state.catalog.categories
        .slice().sort((a, b) => a.order - b.order).map(corpusTile).join('')}</div>
    </section>

    ${suggestion ? `
    <section class="home-block">
      <h2 class="home-h">Le texte du jour</h2>
      ${suggestionCard(suggestion)}
    </section>` : ''}
  `;
}

/** La carte maîtresse : l'invocation à réciter maintenant. */
function officeCard(office, livret) {
  const i = OFFICES.indexOf(office);
  return `
  <section class="office" data-office="${office.id}">
    <div class="office-glyph">${office.glyphe}</div>
    <div class="office-body">
      <p class="office-kicker">C'est l'heure de l'office</p>
      <h2>${escapeHtml(office.titre)}</h2>
      <p class="office-time">${office.heure}</p>
      <p class="office-words">${escapeHtml(office.mots)}</p>
      <div class="office-actions">
        <button class="office-btn primary" data-go="${livret.id}" data-sec="${i}">Lire l'invocation</button>
        <button class="office-btn" data-go="${livret.id}" data-sec="${i}" data-voice="1">▶ L'écouter</button>
      </div>
      <p class="office-note">Extrait de « ${escapeHtml(livret.title)} » · ${escapeHtml(livret.author)}</p>
    </div>
  </section>`;
}

function resumeCard(p) {
  const cat = catOf(p.category);
  const ou = resumer(p) || p.volumeLabel || 'en cours';
  const pct = p.percent || 0;
  return `
  <article class="rcard" data-go="${p.bookId}" data-vol="${p.volume}" style="--cat:${cat?.accent || '#d9a441'}">
    <span class="rcard-glyph">${p.glyph || '✦'}</span>
    <div class="rcard-body">
      <h3>${escapeHtml(p.title)}</h3>
      <p>${escapeHtml(ou)}</p>
      ${pct ? `<div class="rcard-bar"><span style="width:${pct}%"></span></div>` : ''}
    </div>
  </article>`;
}

function corpusTile(c) {
  const n = state.catalog.books.filter((b) => b.category === c.id).length;
  return `
  <a class="ctile" href="#/c/${c.id}" style="--cat:${c.accent}">
    <span class="ctile-glyph">${c.glyph}</span>
    <b>${escapeHtml(c.name)}</b>
    <small>${n} ouvrage${n > 1 ? 's' : ''}</small>
  </a>`;
}

function suggestionCard(b) {
  const cat = catOf(b.category);
  const gal = b.volumes.find((v) => v.type === 'gallery');
  return `
  <article class="sugg" data-go="${b.id}" data-vol="0" style="--cat:${cat.accent}">
    <div class="sugg-cover">${gal ? `<img src="${url(gal.images[0])}" alt="" loading="lazy">`
                                  : `<span>${b.glyph}</span>`}</div>
    <div class="sugg-body">
      <p class="sugg-cat">${cat.glyph} ${escapeHtml(cat.name)}</p>
      <h3>${escapeHtml(b.title)}</h3>
      <p class="sugg-auth">${escapeHtml(b.author)} · ${escapeHtml(b.era)}</p>
      <p class="sugg-sum">${escapeHtml(b.summary)}</p>
    </div>
  </article>`;
}
