/**
 * miniplayer.js — Moteur audio persistant, unique pour toute l'application.
 *
 * Un seul <audio> vit ici, hors de la scène du lecteur : fermer le lecteur ou changer
 * de page ne l'arrête plus — c'est le seul moyen de continuer d'écouter en parcourant
 * la bibliothèque. Intègre la Media Session (écran verrouillé, écouteurs), la vitesse
 * de lecture, les sauts de 15 s et une minuterie de sommeil.
 */
import { saveProgress, loadSettings, saveSettings } from './store.js';
import { mesurer } from './progress.js';

const $ = (id) => document.getElementById(id);
const url = (p) => '../' + p.split('/').map(encodeURIComponent).join('/');
const nomPiste = (p) => decodeURIComponent(p.split('/').pop()).replace(/^\d+\s*-\s*/, '').replace(/\.(mp3|m4a)$/i, '');

/* ═══════════════ État ═══════════════ */

const etat = {
  book: null, vIndex: 0, volume: null, trackIndex: 0,
  audioTime: 0, sleepAt: null, sleepFinPiste: false,
};

let audio = null;                 // créé au premier usage
let abonnes = [];
let sauvegarde = null;
let reprises = 0;
let sleepMinuteur = null;

const emettre = () => abonnes.forEach((f) => f(etat));
export const onChange = (f) => { abonnes.push(f); return () => { abonnes = abonnes.filter((x) => x !== f); }; };

const estCourant = (bookId, vIndex) => etat.book?.id === bookId && etat.vIndex === vIndex;
export { estCourant as estLeLivreCourant };

/* ═══════════════ Persistance (même forme que reader.js, indépendante de sa session) ═══════════════ */

function persister() {
  if (!etat.book) return;
  const m = mesurer({ kind: 'audio', track: etat.trackIndex + 1, tracks: etat.volume?.tracks?.length || 0 });
  saveProgress({
    id: `${etat.book.id}:${etat.vIndex}`,
    bookId: etat.book.id, title: etat.book.title, glyph: etat.book.glyph, category: etat.book.category,
    volume: etat.vIndex, volumeLabel: etat.volume?.label || '', kind: 'audio',
    page: etat.trackIndex + 1, total: 0, scroll: 0, cfi: '',
    ...(m.mesurable ? { percent: m.percent, read: m.read } : {}),
    audioTime: Math.floor(etat.audioTime || 0), unitTotal: m.total, unit: m.unit, approx: m.approx,
  });
}

/* ═══════════════ Media Session : écran verrouillé, écouteurs ═══════════════ */

function majMediaSession() {
  if (!('mediaSession' in navigator) || !etat.book || !('MediaMetadata' in window)) return;
  try {
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: nomPiste(etat.volume.tracks[etat.trackIndex]) || etat.book.title,
      artist: etat.book.author || 'Bibliothèque Spirituelle',
      album: etat.book.title,
      artwork: [96, 192, 512].map((s) => ({ src: 'icons/icon.svg', sizes: `${s}x${s}`, type: 'image/svg+xml' })),
    });
  } catch {}
  navigator.mediaSession.playbackState = audio && !audio.paused ? 'playing' : 'paused';
}

function brancherMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => resume());
  ms.setActionHandler('pause', () => pause());
  ms.setActionHandler('stop', () => stop());
  ms.setActionHandler('previoustrack', () => precedente());
  ms.setActionHandler('nexttrack', () => suivante());
  try {
    ms.setActionHandler('seekbackward', (d) => sauter(-(d.seekOffset || 15)));
    ms.setActionHandler('seekforward', (d) => sauter(d.seekOffset || 15));
    ms.setActionHandler('seekto', (d) => { if (audio && d.seekTime != null) audio.currentTime = d.seekTime; });
  } catch {}
}

/* ═══════════════ Moteur ═══════════════ */

function creerAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'metadata';
  const reglages = loadSettings();
  audio.playbackRate = reglages.audioRate || 1;

  audio.addEventListener('play', () => { majMediaSession(); emettre(); });
  audio.addEventListener('pause', () => { majMediaSession(); emettre(); });
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    etat.audioTime = audio.currentTime;
    clearTimeout(sauvegarde);
    sauvegarde = setTimeout(persister, 4000);
    emettre();
  });
  audio.addEventListener('ended', () => {
    if (etat.sleepFinPiste) { etat.sleepFinPiste = false; stop(); return; }
    if (etat.trackIndex + 1 < (etat.volume?.tracks.length || 0)) jouerPiste(etat.trackIndex + 1);
    else emettre();
  });
  audio.addEventListener('error', () => {
    if (reprises >= 2) return;
    reprises++;
    const t = etat.audioTime || 0;
    setTimeout(() => jouerPiste(etat.trackIndex, t), 800);
  });
  audio.addEventListener('playing', () => { reprises = 0; });

  brancherMediaSession();
  return audio;
}

function jouerPiste(i, depart = 0) {
  const a = creerAudio();
  etat.trackIndex = i;
  a.src = url(etat.volume.tracks[i]);
  if (depart > 0) {
    a.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(a.duration) && depart < a.duration - 1) a.currentTime = depart;
    }, { once: true });
  }
  a.play().catch(() => {});
  persister();
  emettre();
}

/** Ouvre un livre audio. Si c'est déjà le livre en cours, ne relance rien — la barre se contente d'afficher son état. */
export function ouvrir(book, vIndex, volume, { trackIndex = null, startAt = 0 } = {}) {
  if (estCourant(book.id, vIndex)) {
    if (trackIndex !== null && trackIndex !== etat.trackIndex) jouerPiste(trackIndex, startAt);
    return;
  }
  // On quitte un autre livre : sauver sa position avant de l'écraser, sinon reprendre
  // plus tard le repose à la piste 1.
  if (etat.book) persister();
  etat.book = book; etat.vIndex = vIndex; etat.volume = volume; etat.audioTime = startAt;
  jouerPiste(trackIndex ?? 0, startAt);
}

export function toggle() { if (!audio) return; audio.paused ? resume() : pause(); }
export function pause() { audio?.pause(); }
export function resume() { audio?.play().catch(() => {}); }
export function suivante() { if (etat.book && etat.trackIndex + 1 < etat.volume.tracks.length) jouerPiste(etat.trackIndex + 1); }
export function precedente() {
  if (!etat.book) return;
  if (audio.currentTime > 4) audio.currentTime = 0; else if (etat.trackIndex > 0) jouerPiste(etat.trackIndex - 1);
}
export function sauter(sec) { if (audio) audio.currentTime = Math.max(0, Math.min((audio.duration || 0), audio.currentTime + sec)); }
export function allerA(fraction) { if (audio?.duration) audio.currentTime = fraction * audio.duration; }

export function stop() {
  clearMinuteur();
  if (audio) { persister(); audio.pause(); audio.removeAttribute('src'); audio.load(); }
  etat.book = null; etat.volume = null; etat.trackIndex = 0; etat.audioTime = 0;
  try { navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.metadata = null; } catch {}
  emettre();
}

export function definirVitesse(r) {
  if (!audio) creerAudio();
  audio.playbackRate = r;
  saveSettings({ audioRate: r });
  emettre();
}
export const vitesse = () => loadSettings().audioRate || 1;
export function setVolume(v) { if (audio) audio.volume = Math.max(0, Math.min(1, v)); }

/* ═══════════════ Minuterie de sommeil ═══════════════ */

function clearMinuteur() { if (sleepMinuteur) { clearTimeout(sleepMinuteur); sleepMinuteur = null; } etat.sleepAt = null; etat.sleepFinPiste = false; }

/** @param {number|'piste'|null} minutes null annule, 'piste' arrête à la fin de la piste en cours */
export function minuterie(minutes) {
  clearMinuteur();
  if (minutes === 'piste') { etat.sleepFinPiste = true; emettre(); return; }
  if (minutes) {
    etat.sleepAt = Date.now() + minutes * 60000;
    sleepMinuteur = setTimeout(() => { pause(); clearMinuteur(); emettre(); }, minutes * 60000);
  }
  emettre();
}

/* ═══════════════ Lecture pour l'affichage ═══════════════ */

export function instantane() {
  return {
    ouvert: !!etat.book, book: etat.book, vIndex: etat.vIndex, volume: etat.volume,
    trackIndex: etat.trackIndex, enLecture: !!audio && !audio.paused,
    currentTime: audio?.currentTime || 0, duree: audio?.duration || 0,
    rate: audio?.playbackRate || 1, sleepAt: etat.sleepAt, sleepFinPiste: etat.sleepFinPiste,
  };
}

export { nomPiste };

window.addEventListener('beforeunload', () => { if (etat.book) persister(); });
