/**
 * app.js — Amorçage, routage, contrôles du lecteur et pilotage de la voix.
 */
import * as store from './store.js';
import { armerLecture, annulerLecture, suspendreLecture, reprendreLecture, rattraperLecture, initLectureValidation } from './lecture-validation.js';
import * as lib from './library.js';
import * as rd from './reader.js';
import { supported as ttsOk } from './tts.js';
import * as voice from './voicebar.js';
import { renderHome } from './home.js';
import * as alarms from './alarms.js';
import * as recherche from './recherche.js';
import { renderPratique } from './pratique.js';
import { demander } from './dialogue.js';
import { verifierSource, initSante } from './sante.js';
import { updateStorage, cacheEverything, initStockage } from './stockage.js';
import { renderProgrammes } from './programmes.js';
import * as progModule from './programmes.js';
import { initMiniplayerUI } from './miniplayer-ui.js';
import { applyStatic, toggleLang, onLangChange } from './i18n.js';

const $ = (id) => document.getElementById(id);
let settings = store.loadSettings();
let deferredInstall = null;

/* ═══════════════ Amorçage ═══════════════ */

(async function boot() {
  applyStatic();
  $('langBtn').addEventListener('click', toggleLang);
  try {
    const res = await fetch('src/data/catalog.json');
    lib.state.catalog = await res.json();
  } catch {
    $('boot').innerHTML = '<p style="color:#c1785f">Catalogue introuvable. Lancez l\'application via le serveur local (scripts/start.sh).</p>';
    return;
  }
  try {
    const res = await fetch('src/data/prayers.json');
    lib.state.prayers = await res.json();
  } catch { lib.state.prayers = []; }   // index optionnel : la recherche par livre continue de fonctionner sans lui

  // Livrets privés (noms réels de personnes et d'entreprises) : hors de Git, ajoutés
  // au catalogue et à l'index seulement s'ils sont présents sur ce disque.
  const [livresPrives, prieresPrivees] = await Promise.all(
    ['src/data/catalog.prive.json', 'src/data/prayers.prive.json'].map((url) =>
      fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  for (const b of livresPrives?.books || []) {
    lib.state.catalog.books.push(b);
    lib.state.catalog.totalBytes = (lib.state.catalog.totalBytes || 0) + (b.bytes || 0);
  }
  if (Array.isArray(prieresPrivees)) lib.state.prayers.push(...prieresPrivees);

  await lib.refreshState();
  // Un programme enregistré avant une mise à jour de son modèle reprend les nouvelles séances.
  // Le module accompagne un livret privé : il peut manquer.
  await import('./trente-jours.js').then((m) => m.actualiserTrenteJours()).catch(() => {});
  lib.renderNav();
  lib.renderStats();
  lib.renderContinue();

  onLangChange(() => {
    lib.renderNav();
    const [kind, a] = location.hash.slice(2).split('/');
    const cats = { rappels: '__rappels', pratique: '__pratique', programmes: '__programmes' };
    lib.markNav(kind === 'c' ? a : (cats[kind] || (!kind ? '__home' : '')));
    updateStorage();
    verifierSource();
  });
  route();
  applyFontSize(settings.fontSize);
  wire();
  updateStorage();
  registerSW();

  // Les rappels tournent tant que l'application est ouverte, onglet masqué compris.
  alarms.demarrer((bookId, volume, section, alarmId) => {
    if (alarmId) armerLecture(alarmId);
    location.hash = `#/lire/${bookId}/${volume}` + (section !== null ? `/${section}` : '');
  });
  document.addEventListener('bs:toast', (e) => toast(e.detail));
  initSante(toast);
  initLectureValidation(toast, renderHome);
  initStockage({ onToast: toast, onRefresh: () => lib.renderShelves(location.hash.startsWith('#/c/') ? location.hash.slice(4) : '') });

  if (ttsOk()) await voice.init(toast);
  else { $('speakBtn').hidden = true; }

  rattraperLecture();   // une lecture de 2 min peut avoir mûri pendant que l'app était fermée

  $('boot').classList.add('gone');
  setTimeout(() => $('boot').remove(), 600);
})();

/* ═══════════════ Routage ═══════════════ */

function route() {
  const hash = location.hash.slice(2);      // « c/kabbale », « tout », « lire/zohar/0/2 »
  const [kind, a, b, c] = hash.split('/');

  if (kind === 'lire' && a) {
    const book = lib.bookOf(a);
    // `c` peut être un rang de grande section (« 2 ») ou un rang de prière précise (« p42 »,
    // voir goToSection) — on le passe tel quel, sans le forcer en nombre.
    if (book) {
      const locate = pendingLocate; pendingLocate = null;
      openReader(book, +b || 0, c === undefined ? null : c, locate); return;
    }
  }
  closeReader(false);

  // L'accueil n'apparaît qu'à la racine, et jamais pendant une recherche.
  const accueil = !kind && !lib.state.query.trim();
  const rappels = kind === 'rappels';
  // « programmes » seul liste les programmes ; « programmes/<id> » en ouvre un.
  const progs = kind === 'programmes';
  const pratique = kind === 'pratique';
  $('home').hidden = !accueil;
  $('rappels').hidden = !rappels;
  $('programmes').hidden = !progs;
  $('pratique').hidden = !pratique;
  $('hero').hidden = accueil || rappels || progs || pratique || !!kind;
  $('shelves').hidden = accueil || rappels || progs || pratique;
  $('emptyState').hidden = true;
  $('prayerResults').hidden = true;
  $('textResults').hidden = true;

  if (rappels) { alarms.renderRappels(lib.state.catalog.books); lib.markNav('__rappels'); }
  else if (pratique) { renderPratique(); lib.markNav('__pratique'); }
  else if (progs) { renderProgrammes(a || ''); lib.markNav('__programmes'); }
  else if (accueil) { renderHome(); lib.markNav('__home'); }
  else {
    const cat = kind === 'c' ? a : '';
    lib.markNav(cat);
    lib.renderPrayerResults();
    lib.renderShelves(cat);
  }
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', route);

/* ═══════════════ Câblage de l'interface ═══════════════ */

function wire() {
  // — recherche —
  $('search').addEventListener('input', (e) => {
    lib.state.query = e.target.value;
    // Chercher fait quitter l'accueil ; effacer la recherche y ramène.
    if (!e.target.value.trim() && /^(#\/?)?$/.test(location.hash)) { route(); return; }
    $('home').hidden = true;
    $('shelves').hidden = false;
    lib.renderPrayerResults();
    recherche.render(lib.state.query);
    lib.renderShelves(location.hash.startsWith('#/c/') ? location.hash.slice(4) : '');
  });

  // — passage trouvé dans un texte : ouvre le livre à cet endroit précis —
  recherche.init({ onOpen: ({ bookId, vol, kind, ref, norm }) => {
    pendingLocate = kind === 'pdf' ? { page: ref } : { norm };
    const cible = `#/lire/${bookId}/${vol}`;
    if (location.hash === cible) route(); else location.hash = cible;
  } });

  // — résultat de recherche dans une prière : ouvre le livre directement à cette section —
  $('prayerResults').addEventListener('click', (e) => {
    const card = e.target.closest('[data-prayer-book]');
    if (!card) return;
    location.hash = `#/lire/${card.dataset.prayerBook}/${card.dataset.prayerVol}/p${card.dataset.prayerH3}`;
  });
  $('prayerResults').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('pcard')) {
      e.preventDefault();
      location.hash = `#/lire/${e.target.dataset.prayerBook}/${e.target.dataset.prayerVol}/p${e.target.dataset.prayerH3}`;
    }
  });
  // Le temps ne court que pendant qu'on a le texte sous les yeux.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { suspendreLecture(); return; }
    reprendreLecture();
    rattraperLecture();   // couvre le cas où la page a été déchargée pendant l'absence
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea|select/i.test(e.target.tagName) && $('reader').hidden) {
      e.preventDefault(); $('search').focus();
    }
  });

  // — ouverture d'une fiche —
  $('shelves').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) sheet(lib.bookOf(card.dataset.book));
  });
  $('shelves').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) {
      e.preventDefault(); sheet(lib.bookOf(e.target.dataset.book));
    }
  });
  $('pratique').addEventListener('click', (e) => {
    const go = e.target.closest('[data-go-programme]');
    if (go) location.hash = `#/programmes/${go.dataset.goProgramme}`;
  });

  $('home').addEventListener('click', async (e) => {
    // Pointer une prière comme faite, sans ouvrir le texte.
    const check = e.target.closest('[data-faite]');
    if (check) {
      const id = check.dataset.faite;
      const dejaFaite = check.getAttribute('aria-pressed') === 'true';
      const prog = /^prog:([^:]+):([^:]+):(.+)$/.exec(id);
      if (prog) {
        const [, programmeId, jour, seanceId] = prog;
        await progModule.basculer(programmeId, jour, seanceId);
      } else {
        await (dejaFaite ? store.retirerFaite(id) : store.marquerFaite(id));
      }
      renderHome();
      toast(dejaFaite ? 'Prière remise à faire.' : 'Prière marquée comme faite.');
      return;
    }
    const el = e.target.closest('[data-go]');
    if (!el) return;
    const sec = el.dataset.sec;
    // Une ligne d'agenda porte son rappel : la lire deux minutes la validera.
    if (el.dataset.alarm) armerLecture(el.dataset.alarm); else annulerLecture();
    pendingVoice = el.dataset.voice === '1';
    location.hash = `#/lire/${el.dataset.go}/${el.dataset.vol || 0}` + (sec !== undefined ? `/${sec}` : '');
  });

  $('continueList').addEventListener('click', (e) => {
    const item = e.target.closest('[data-open]');
    if (item) location.hash = `#/lire/${item.dataset.open}/${item.dataset.vol}`;
  });

  // — fiche —
  document.addEventListener('click', (e) => { if (e.target.closest('[data-close-sheet]')) lib.closeSheet(); });

  // — sommaire mobile —
  const drawer = (open) => {
    $('sidebar').classList.toggle('open', open);
    $('scrim').classList.toggle('open', open);
    $('menuBtn').setAttribute('aria-expanded', String(open));
  };
  $('menuBtn').addEventListener('click', () => drawer(!$('sidebar').classList.contains('open')));
  $('scrim').addEventListener('click', () => drawer(false));
  $('catNav').addEventListener('click', () => drawer(false));

  // — stockage —
  $('cacheAllBtn').addEventListener('click', cacheEverything);
  $('clearCacheBtn').addEventListener('click', async () => {
    const ok = await demander({
      titre: 'Vider le stockage hors-ligne ?',
      message: "Les livres téléchargés seront retirés de cet appareil. Vos fichiers d'origine ne sont pas touchés — vous pourrez les retélécharger.",
      valider: 'Vider', danger: true });
    if (!ok) return;
    await store.clearBooks();
    await lib.refreshState();
    lib.renderShelves(location.hash.startsWith('#/c/') ? location.hash.slice(4) : '');
    updateStorage();
    toast('Stockage hors-ligne vidé.');
  });

  // — état de la source —
  addEventListener('online', verifierSource);
  addEventListener('offline', verifierSource);
  addEventListener('focus', verifierSource);
  document.addEventListener('bs:source-ko', verifierSource);
  verifierSource();

  // — installation —
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredInstall = e; $('installBtn').hidden = false;
  });
  $('installBtn').addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null; $('installBtn').hidden = true;
  });

  wireReader();
  initMiniplayerUI({ onOpenBook: (bookId, vIndex) => { location.hash = `#/lire/${bookId}/${vIndex}`; } });
}

function sheet(book) {
  if (!book) return;
  lib.openSheet(book, {
    open: (b, v) => { lib.closeSheet(); location.hash = `#/lire/${b.id}/${v}`; },
    toast,
    refresh: async () => {
      await lib.refreshState();
      lib.renderShelves(location.hash.startsWith('#/c/') ? location.hash.slice(4) : '');
      updateStorage();
    },
  });
}

/* ═══════════════ Lecteur ═══════════════ */

let pendingVoice = false;

let pendingLocate = null;

async function openReader(book, vIndex, section = null, locate = null) {
  lib.closeSheet();                       // avant le verrou : closeSheet libère le défilement
  $('reader').hidden = false;
  document.body.style.overflow = 'hidden';
  await rd.openVolume(book, vIndex, { skipRestore: section !== null, locate });
  $('bookmarkBtn').classList.remove('on');
  voice.resetVoice(book.lang);
  const depart = section !== null ? goToSection(section) : 0;
  if (pendingVoice) { pendingVoice = false; setTimeout(() => voice.startVoice(depart), 350); }
}

/**
 * Positionne la lecture sur une section du document.
 * @param {string|number} section - un rang de grande section (titres de niveau 2), ou,
 *   préfixé de « p » (ex. « p42 »), le rang d'une prière précise (titres de niveau 3) —
 *   c'est ce que produit un résultat de recherche dans les prières (voir library.js).
 */
function goToSection(section) {
  const versUnePriere = typeof section === 'string' && section.startsWith('p');
  const n = versUnePriere ? +section.slice(1) : +section;
  const cible = document.querySelectorAll(versUnePriere ? '.doc h3' : '.doc h2')[n];
  if (!cible) return 0;
  const stage = $('stage');
  // offsetTop relatif à la scène : plus fiable que scrollIntoView dans un conteneur défilant.
  // « instant » est indispensable : « auto » suivrait le scroll-behavior:smooth du CSS,
  // et l'animation de plusieurs milliers de pixels n'aboutit pas.
  // Surtout : pas de requestAnimationFrame ici — il est gelé dans un onglet masqué,
  // et le lien se serait ouvert sans jamais atteindre la section. Un minuteur, lui, s'exécute.
  const viser = () => stage.scrollTo({ top: Math.max(0, cible.offsetTop - 24), behavior: 'instant' });
  viser();
  setTimeout(viser, 120);        // seconde passe, une fois les polices et images posées
  // Le sommaire contient aussi les sous-titres : on repère l'entrée par son libellé,
  // pas par son rang, sinon c'est « Le Sceau » qui se retrouve surligné.
  const libelle = cible.textContent.trim();
  document.querySelectorAll('#toc a').forEach((a) =>
    a.classList.toggle('active', a.textContent.trim() === libelle));

  return premierePhraseApres(cible);
}

/** Rang de la première phrase située après un élément — pour démarrer la voix au bon endroit. */
function premierePhraseApres(el) {
  const spans = rd.session.spans;
  for (let i = 0; i < spans.length; i++) {
    if (el.compareDocumentPosition(spans[i]) & Node.DOCUMENT_POSITION_FOLLOWING) return i;
  }
  return 0;
}

function closeReader(nav = true) {
  if ($('reader').hidden) return;
  annulerLecture();                       // sorti avant l'échéance : rien n'est validé
  voice.stop();
  $('voicebar').hidden = true;
  rd.closeVolume();
  $('reader').hidden = true;
  document.body.style.overflow = '';
  lib.refreshState().then(() => {
    lib.renderContinue();
    lib.renderShelves(location.hash.startsWith('#/c/') ? location.hash.slice(4) : '');
  });
  if (nav) location.hash = '#/';
}

function wireReader() {
  $('readerClose').addEventListener('click', () => closeReader());
  $('tocBtn').addEventListener('click', () => { $('toc').hidden = !$('toc').hidden; });

  // pagination PDF
  const go = (n) => rd.renderPdfPage(n);
  $('pagePrev').addEventListener('click', () => go(rd.session.page - 1));
  $('pageNext').addEventListener('click', () => go(rd.session.page + 1));
  $('pageInput').addEventListener('change', (e) => go(+e.target.value));
  $('pageRange').addEventListener('input', (e) => go(+e.target.value));

  // taille du texte
  $('fontPlus').addEventListener('click', () => applyFontSize(settings.fontSize + 1));
  $('fontMinus').addEventListener('click', () => applyFontSize(settings.fontSize - 1));

  // marque-page
  $('bookmarkBtn').addEventListener('click', async () => {
    const s = rd.session;
    if (!s.book) return;
    await store.addMark({
      bookId: s.book.id, volume: s.vIndex, locator: String(s.page),
      title: s.book.title, label: `${s.volume.label} · page ${s.page}`,
    });
    $('bookmarkBtn').classList.add('on');
    toast('Page marquée.');
  });

  // clavier
  document.addEventListener('keydown', (e) => {
    if ($('reader').hidden || /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === 'Escape') { $('toc').hidden ? closeReader() : ($('toc').hidden = true); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { if (rd.session.kind === 'pdf') go(rd.session.page + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { if (rd.session.kind === 'pdf') go(rd.session.page - 1); }
    else if (e.key === ' ' && !$('voicebar').hidden) { e.preventDefault(); voice.toggle(); }
  });
}

function applyFontSize(px) {
  settings = store.saveSettings({ fontSize: Math.max(13, Math.min(28, px)) });
  document.documentElement.style.setProperty('--fs', settings.fontSize + 'px');
  try { rd.session.rendition?.themes.fontSize(settings.fontSize + 'px'); } catch {}
}

/* ═══════════════ Divers ═══════════════ */

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  setTimeout(() => t.classList.add('show'), 16);   // pas de rAF : gelé en arrière-plan
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => (t.hidden = true), 320); }, 3600);
}

/**
 * Sans service worker, les livres peuvent être téléchargés mais pas resservis sans réseau :
 * on le dit clairement plutôt que de laisser croire à un hors-ligne fonctionnel.
 */
async function registerSW() {
  const warn = (why) => {
    const el = $('swWarn');
    if (el) { el.hidden = false; el.title = why; }
  };
  if (!('serviceWorker' in navigator)) return warn('Service worker non pris en charge par ce navigateur.');
  if (!window.isSecureContext) return warn('Le hors-ligne exige HTTPS ou localhost.');

  // Une version déjà installée sert l'ancienne coquille tant qu'elle contrôle la page.
  // Quand la nouvelle prend le relais, on recharge une seule fois : sans ça, toute
  // évolution de l'application n'apparaîtrait qu'au rechargement suivant.
  const avaitUnControleur = !!navigator.serviceWorker.controller;
  let dejaRecharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avaitUnControleur || dejaRecharge) return;   // 1re installation : rien à recharger
    dejaRecharge = true;
    location.reload();
  });

  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    reg.update().catch(() => {});
  } catch (e) {
    console.warn('Service worker :', e);
    warn('Enregistrement refusé : ' + e.message);
  }
}
