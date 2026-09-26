/**
 * i18n.js — Traduction de l'interface fixe (en-tête, menu, lecteur, barre vocale, mini-lecteur).
 * Le contenu généré (accueil, rappels, programmes, fiches livres…) reste en français pour l'instant.
 */

const STRINGS = {
  fr: {
    'boot.opening': 'Ouverture de la bibliothèque…',
    'menu.open': 'Ouvrir le sommaire',
    'brand.strong': 'Bibliothèque',
    'brand.em': 'Spirituelle',
    'search.placeholder': 'Rechercher un livre, une prière, un passage…',
    'search.aria': 'Rechercher',
    'search.empty': 'Aucun ouvrage ne correspond à cette recherche.',
    'net.title': 'État de la connexion',
    'net.online': 'en ligne',
    'net.offline': 'hors ligne',
    'net.sourceDown': 'source coupée',
    'net.title.offline': 'Aucune connexion. Seuls les livres téléchargés sont lisibles.',
    'net.title.online': 'La bibliothèque répond.',
    'net.title.down': "Le serveur de la bibliothèque ne répond pas. Relancez ./scripts/start.sh — en attendant, seuls les livres téléchargés sont lisibles.",
    'install.title': "Installer l'application",
    'nav.categories': 'Catégories',
    'nav.corpus': 'Corpus',
    'nav.home': 'Accueil',
    'nav.all': 'Toute la bibliothèque',
    'nav.programmes': 'Programmes',
    'nav.reminders': 'Rappels',
    'nav.practice': 'Pratique',
    'storage.title': 'Hors-ligne',
    'storage.calculating': 'Calcul…',
    'storage.offlineWarn': '⚠ Hors-ligne indisponible dans ce navigateur : les livres se téléchargent mais ne seront pas resservis sans réseau.',
    'storage.downloadAll': 'Tout télécharger',
    'storage.clear': 'Vider',
    'storage.persistWarn': "⚠ Stockage non garanti : le navigateur peut supprimer ces livres s'il manque de place. Installez l'application (menu du navigateur → Installer, ou « Sur l'écran d'accueil » sur iPhone) pour les conserver à coup sûr.",
    'storage.line.some': '<b>{n}</b> {livre} sur l\'appareil · {poids}',
    'storage.line.used': '<br>{used} utilisés sur {quota}',
    'storage.line.none': 'Aucun livre téléchargé.<br>Bibliothèque complète : {total}',
    'storage.book': 'livre',
    'storage.books': 'livres',
    'continue.title': 'Reprendre',
    'hero.title': 'Une bibliothèque, un ordre.',
    'hero.lede': "Des Écritures au canon élargi, des apocryphes à la Kabbale, de la doctrine aux grimoires, jusqu'à la pratique quotidienne. Les textes sont rangés dans l'ordre où ils s'éclairent les uns les autres — et tout se lit hors connexion.",
    'footer.tagline': 'Bibliothèque personnelle · fonctionne hors-ligne · lecture vocale par synthèse système',
    'sheet.aria': 'Fiche du livre',
    'reader.close.aria': 'Fermer le lecteur',
    'reader.toc.title': 'Sommaire du livre',
    'reader.bookmark.title': 'Marquer cette page',
    'reader.fontMinus.title': 'Réduire le texte',
    'reader.fontPlus.title': 'Agrandir le texte',
    'reader.speak.title': 'Lecture vocale',
    'reader.speak.label': 'Voix',
    'pager.prev.aria': 'Page précédente',
    'pager.pageNumber.aria': 'Numéro de page',
    'pager.next.aria': 'Page suivante',
    'pager.range.aria': 'Curseur de page',
    'voicebar.prev.title': 'Phrase précédente',
    'voicebar.play.title': 'Lire / Pause',
    'voicebar.next.title': 'Phrase suivante',
    'voicebar.stop.title': 'Arrêter',
    'voicebar.ready': 'Prêt à lire.',
    'voicebar.finished': 'Lecture terminée.',
    'voicebar.noVoice': 'Aucune voix installée',
    'voicebar.pageUnreadable': 'Page sans texte lisible — recherche de la suivante…',
    'voicebar.noReadableText': "Aucun texte lisible jusqu'à la fin de ce volume.",
    'voicebar.nothingToRead': 'Aucun texte à lire dans cette vue.',
    'voicebar.settings.title': 'Réglages de la voix',
    'voicebar.close.title': 'Fermer la lecture vocale',
    'voicebar.voiceLabel': 'Voix',
    'voicebar.rateLabel': 'Vitesse',
    'voicebar.pitchLabel': 'Hauteur',
    'voicebar.follow': 'Suivre le texte pendant la lecture',
    'voicebar.autoNext': 'Enchaîner automatiquement les pages',
    'miniplayer.prev.title': 'Piste précédente',
    'miniplayer.play.title': 'Lire / Pause',
    'miniplayer.next.title': 'Piste suivante',
    'miniplayer.back15.title': 'Reculer de 15 s',
    'miniplayer.fwd15.title': 'Avancer de 15 s',
    'miniplayer.open.title': 'Ouvrir le livre',
    'miniplayer.rate.title': 'Vitesse de lecture',
    'miniplayer.sleep.title': 'Minuterie de sommeil',
    'miniplayer.stop.title': 'Arrêter',
    'miniplayer.speedLabel': 'Vitesse',
    'miniplayer.sleepLabel': "S'arrêter",
    'miniplayer.cancel': 'Annuler',
    'miniplayer.endOfTrack': 'Fin de la piste',
    'dialogue.confirm': 'Confirmer',
    'dialogue.cancel': 'Annuler',
    'lang.toggleTo': 'English',
  },
  en: {
    'boot.opening': 'Opening the library…',
    'menu.open': 'Open the menu',
    'brand.strong': 'Spiritual',
    'brand.em': 'Library',
    'search.placeholder': 'Search a book, a prayer, a passage…',
    'search.aria': 'Search',
    'search.empty': 'No book matches this search.',
    'net.title': 'Connection status',
    'net.online': 'online',
    'net.offline': 'offline',
    'net.sourceDown': 'source down',
    'net.title.offline': 'No connection. Only downloaded books can be read.',
    'net.title.online': 'The library is responding.',
    'net.title.down': "The library server isn't responding. Restart ./scripts/start.sh — until then, only downloaded books can be read.",
    'install.title': 'Install the app',
    'nav.categories': 'Categories',
    'nav.corpus': 'Corpus',
    'nav.home': 'Home',
    'nav.all': 'Entire library',
    'nav.programmes': 'Programs',
    'nav.reminders': 'Reminders',
    'nav.practice': 'Practice',
    'storage.title': 'Offline',
    'storage.calculating': 'Calculating…',
    'storage.offlineWarn': "⚠ Offline mode isn't available in this browser: books will download but won't be served again without a network.",
    'storage.downloadAll': 'Download all',
    'storage.clear': 'Clear',
    'storage.persistWarn': '⚠ Storage isn\'t guaranteed: the browser may remove these books if space runs low. Install the app (browser menu → Install, or "Add to Home Screen" on iPhone) to keep them for sure.',
    'storage.line.some': '<b>{n}</b> {livre} on this device · {poids}',
    'storage.line.used': '<br>{used} used of {quota}',
    'storage.line.none': 'No book downloaded.<br>Full library: {total}',
    'storage.book': 'book',
    'storage.books': 'books',
    'continue.title': 'Resume',
    'hero.title': 'One library, one order.',
    'hero.lede': 'From Scripture to the wider canon, from the apocrypha to the Kabbalah, from doctrine to grimoires, down to daily practice. The texts are arranged in the order in which they shed light on one another — and everything can be read offline.',
    'footer.tagline': 'Personal library · works offline · text-to-speech read-aloud',
    'sheet.aria': 'Book sheet',
    'reader.close.aria': 'Close reader',
    'reader.toc.title': 'Book contents',
    'reader.bookmark.title': 'Bookmark this page',
    'reader.fontMinus.title': 'Decrease text size',
    'reader.fontPlus.title': 'Increase text size',
    'reader.speak.title': 'Read aloud',
    'reader.speak.label': 'Voice',
    'pager.prev.aria': 'Previous page',
    'pager.pageNumber.aria': 'Page number',
    'pager.next.aria': 'Next page',
    'pager.range.aria': 'Page slider',
    'voicebar.prev.title': 'Previous sentence',
    'voicebar.play.title': 'Play / Pause',
    'voicebar.next.title': 'Next sentence',
    'voicebar.stop.title': 'Stop',
    'voicebar.ready': 'Ready to read.',
    'voicebar.finished': 'Finished reading.',
    'voicebar.noVoice': 'No voice installed',
    'voicebar.pageUnreadable': 'Page has no readable text — looking for the next one…',
    'voicebar.noReadableText': 'No readable text until the end of this volume.',
    'voicebar.nothingToRead': 'Nothing to read in this view.',
    'voicebar.settings.title': 'Voice settings',
    'voicebar.close.title': 'Close read-aloud',
    'voicebar.voiceLabel': 'Voice',
    'voicebar.rateLabel': 'Speed',
    'voicebar.pitchLabel': 'Pitch',
    'voicebar.follow': 'Follow the text while reading',
    'voicebar.autoNext': 'Turn pages automatically',
    'miniplayer.prev.title': 'Previous track',
    'miniplayer.play.title': 'Play / Pause',
    'miniplayer.next.title': 'Next track',
    'miniplayer.back15.title': 'Back 15 s',
    'miniplayer.fwd15.title': 'Forward 15 s',
    'miniplayer.open.title': 'Open the book',
    'miniplayer.rate.title': 'Playback speed',
    'miniplayer.sleep.title': 'Sleep timer',
    'miniplayer.stop.title': 'Stop',
    'miniplayer.speedLabel': 'Speed',
    'miniplayer.sleepLabel': 'Stop playback',
    'miniplayer.cancel': 'Cancel',
    'miniplayer.endOfTrack': 'End of track',
    'dialogue.confirm': 'Confirm',
    'dialogue.cancel': 'Cancel',
    'lang.toggleTo': 'Français',
  },
};

const KEY = 'bs-lang';
let lang = (() => {
  try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'fr'; } catch { return 'fr'; }
})();

const listeners = [];

export const getLang = () => lang;

/** Traduit une clé ; `vars` remplace les `{nom}` du gabarit. */
export function t(key, vars) {
  let s = STRINGS[lang]?.[key] ?? STRINGS.fr[key] ?? key;
  if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  return s;
}

export function onLangChange(fn) { listeners.push(fn); }

export function setLang(l) {
  lang = l === 'en' ? 'en' : 'fr';
  try { localStorage.setItem(KEY, lang); } catch {}
  document.documentElement.lang = lang;
  applyStatic();
  listeners.forEach((fn) => fn(lang));
}

export function toggleLang() { setLang(lang === 'fr' ? 'en' : 'fr'); }

/** Applique les traductions à tout le texte statique marqué `data-i18n*` sous `root`. */
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.getAttribute('data-i18n-title')); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
  const langBtn = document.getElementById('langBtn');
  if (langBtn) { langBtn.textContent = lang.toUpperCase(); langBtn.title = t('lang.toggleTo'); }
}
