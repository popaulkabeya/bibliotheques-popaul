/**
 * voicebar.js — Pilotage de la barre de lecture vocale : choix de la voix,
 * vitesse, hauteur, surlignage suivi et enchaînement automatique des pages.
 */
import * as store from './store.js';
import * as rd from './reader.js';
import { speaker, loadVoices, rankVoices } from './tts.js';
import { t, onLangChange } from './i18n.js';

const $ = (id) => document.getElementById(id);
let settings = store.loadSettings();
let signaler = () => {};

/** Coupe la voix — appelé à la fermeture du lecteur. */
export const stop = () => speaker.stop();
/** Bascule lecture/pause — raccourci Espace. */
export const toggle = () => speaker.toggle();

/** @param {(msg:string)=>void} onToast pour les messages destinés au lecteur */
export async function init(onToast) {
  signaler = onToast;
  await loadVoices();
  fillVoices();
  wireVoice();
}

export function fillVoices() {
  const sel = $('vbVoice');
  const voices = rankVoices(rd.session.volume?.lang || rd.session.book?.lang || 'fr');
  sel.innerHTML = voices.map((v, i) =>
    `<option value="${v.voiceURI}"${v.voiceURI === settings.voiceURI ? ' selected' : ''}>
      ${v.name} — ${v.lang}${v.localService ? ' · hors-ligne' : ''}</option>`).join('')
    || `<option>${t('voicebar.noVoice')}</option>`;
  const pick = voices.find((v) => v.voiceURI === settings.voiceURI) || voices[0];
  if (pick) { speaker.voice = pick; sel.value = pick.voiceURI; }
  $('vbRate').value = settings.rate; $('vbRateVal').textContent = (+settings.rate).toFixed(2) + '×';
  $('vbPitch').value = settings.pitch; $('vbPitchVal').textContent = (+settings.pitch).toFixed(2);
  $('vbFollow').checked = settings.follow;
  $('vbAuto').checked = settings.autoPage;
  speaker.rate = +settings.rate; speaker.pitch = +settings.pitch;
}

export function resetVoice(lang = 'fr') {
  speaker.stop();
  speaker.lang = lang === 'en' ? 'en-GB' : 'fr-FR';
  $('voicebar').hidden = true;
  $('vbFill').style.width = '0%';
  $('vbText').textContent = t('voicebar.ready');
  if (rankVoices(lang).length) fillVoices();
}

/**
 * Avance jusqu'à la prochaine page contenant du texte lisible.
 * Les ouvrages numérisés ouvrent parfois sur des dizaines de planches muettes ;
 * s'arrêter sur chacune rendrait l'écoute impraticable.
 * @returns {Promise<boolean>} vrai si une page exploitable a été trouvée
 */
async function chercherPageLisible() {
  const s = rd.session;
  if (s.kind !== 'pdf' || s.page >= s.pages) return false;
  const n = await rd.chercherPageAvecTexte(s.page + 1);
  if (!n) return false;
  await rd.renderPdfPage(n);
  return s.sentences.length > 0;
}

export function startVoice(depart = 0) {
  const sentences = rd.session.sentences;
  if (!sentences.length) {
    if (rd.session.kind === 'pdf') {
      signaler(t('voicebar.pageUnreadable'));
      chercherPageLisible().then((ok) => {
        if (ok) startVoice(0);
        else signaler(t('voicebar.noReadableText'));
      });
      return;
    }
    signaler(t('voicebar.nothingToRead'));
    return;
  }
  $('voicebar').hidden = false;
  speaker.load(sentences, depart);
  speaker.play();
}

function wireVoice() {
  $('speakBtn').addEventListener('click', () => {
    if ($('voicebar').hidden) startVoice();
    else speaker.toggle();
  });
  $('vbPlay').addEventListener('click', () => {
    if (!speaker.total) startVoice(); else speaker.toggle();
  });
  $('vbPrev').addEventListener('click', () => speaker.skip(-1));
  $('vbNext').addEventListener('click', () => speaker.skip(1));
  $('vbStop').addEventListener('click', () => { speaker.stop(); rd.clearHighlight(); $('vbFill').style.width = '0%'; });
  $('vbClose').addEventListener('click', () => {
    speaker.stop(); rd.clearHighlight(); $('voicebar').hidden = true; $('vbPanel').hidden = true;
  });
  $('vbSettings').addEventListener('click', () => { $('vbPanel').hidden = !$('vbPanel').hidden; });

  $('vbVoice').addEventListener('change', (e) => {
    const v = rankVoices().find((x) => x.voiceURI === e.target.value);
    if (!v) return;
    speaker.voice = v;
    settings = store.saveSettings({ voiceURI: v.voiceURI });
    if (speaker.playing) speaker.skip(0);       // relance la phrase avec la nouvelle voix
  });
  $('vbRate').addEventListener('input', (e) => {
    speaker.rate = +e.target.value;
    $('vbRateVal').textContent = speaker.rate.toFixed(2) + '×';
    settings = store.saveSettings({ rate: speaker.rate });
  });
  $('vbRate').addEventListener('change', () => { if (speaker.playing) speaker.skip(0); });
  $('vbPitch').addEventListener('input', (e) => {
    speaker.pitch = +e.target.value;
    $('vbPitchVal').textContent = speaker.pitch.toFixed(2);
    settings = store.saveSettings({ pitch: speaker.pitch });
  });
  $('vbPitch').addEventListener('change', () => { if (speaker.playing) speaker.skip(0); });
  $('vbFollow').addEventListener('change', (e) => { settings = store.saveSettings({ follow: e.target.checked }); });
  $('vbAuto').addEventListener('change', (e) => { settings = store.saveSettings({ autoPage: e.target.checked }); });

  // retours du moteur vocal
  speaker.onSentence = (i, text) => {
    rd.highlight(i, settings.follow);
    $('vbText').textContent = text;
    $('vbFill').style.width = (speaker.progress * 100).toFixed(1) + '%';
  };
  speaker.onState = (playing) => {
    $('vbPlay').textContent = playing ? '❚❚' : '▶';
    $('speakBtn').textContent = `${playing ? '❚❚' : '▶'} ${t('reader.speak.label')}`;
    $('speakBtn').classList.toggle('on', playing);
  };
  onLangChange(() => { $('speakBtn').textContent = `${speaker.playing ? '❚❚' : '▶'} ${t('reader.speak.label')}`; });
  speaker.onEnd = async () => {
    rd.clearHighlight();
    const s = rd.session;
    if (settings.autoPage && s.kind === 'pdf' && s.page < s.pages) {
      await rd.renderPdfPage(s.page + 1);
      // La page suivante peut être une planche : on enjambe les pages muettes.
      if (!s.sentences.length) await chercherPageLisible();
      if (s.sentences.length) { speaker.load(s.sentences, 0); speaker.play(); return; }
    }
    if (settings.autoPage && s.kind === 'epub' && s.rendition) {
      await s.rendition.next();
      await new Promise((r) => setTimeout(r, 350));
      if (s.sentences.length) { speaker.load(s.sentences, 0); speaker.play(); return; }
    }
    $('vbText').textContent = t('voicebar.finished');
    $('vbFill').style.width = '100%';
  };
}
