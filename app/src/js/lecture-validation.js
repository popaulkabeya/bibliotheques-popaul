/**
 * lecture-validation.js — Valider une prière en la lisant, plutôt qu'en cochant une case.
 *
 * Rester deux minutes dans le lecteur suffit. L'horodatage vit sur disque (localStorage),
 * pas seulement en mémoire : un onglet iOS mis en arrière-plan pendant qu'on prie — l'écran
 * se verrouille tout seul si l'on ne touche pas au téléphone — peut être entièrement déchargé
 * par le système pour récupérer de la mémoire. Le minuteur JS meurt avec la page ; l'horodatage,
 * non. Au retour, on compare l'heure d'armement à l'heure réelle plutôt que de compter sur un
 * minuteur survécu — le temps passé écran verrouillé compte comme du temps de lecture, ce qui
 * est justement le cas le plus probable en priant.
 */
import * as store from './store.js';

let signalerToast = () => {};
let rafraichirAccueil = () => {};

/** @param {(msg:string)=>void} onToast @param {() => void} onRefresh */
export function initLectureValidation(onToast, onRefresh) {
  signalerToast = onToast;
  rafraichirAccueil = onRefresh;
}

const DUREE_LECTURE = 2 * 60 * 1000;
const CLEF_ARMEE = 'bs:lecture-armee';
let veille = null;   // { alarmId, cumul, depuis, timer } — accélère la validation pendant la même session

/**
 * Démarre le décompte pour un rappel. Un nouveau départ remplace le précédent.
 *
 * L'horodatage est aussi écrit sur disque (localStorage), pas seulement gardé en mémoire :
 * un onglet iOS mis en arrière-plan pendant qu'on prie — l'écran se verrouille tout seul
 * si on ne touche pas au téléphone — peut être entièrement déchargé par le système pour
 * récupérer de la mémoire. Le minuteur JS meurt avec la page ; l'horodatage, non. Au retour,
 * on compare l'heure d'armement à l'heure réelle plutôt que de compter sur un timer survécu.
 */
export function armerLecture(alarmId) {
  annulerLecture();
  veille = { alarmId, cumul: 0, depuis: 0, timer: null };
  try { localStorage.setItem(CLEF_ARMEE, JSON.stringify({ alarmId, startedAt: Date.now(), jour: store.jourClef() })); } catch {}
  reprendreLecture();
}

export function reprendreLecture() {
  if (!veille || veille.timer) return;
  veille.depuis = Date.now();
  veille.timer = setTimeout(validerLecture, Math.max(0, DUREE_LECTURE - veille.cumul));
}

export function suspendreLecture() {
  if (!veille || !veille.timer) return;
  clearTimeout(veille.timer);
  veille.timer = null;
  veille.cumul += Date.now() - veille.depuis;
}

/** Annule pour de bon : sortie volontaire avant l'échéance, rien ne doit être compté. */
export function annulerLecture() {
  suspendreLecture();
  veille = null;
  try { localStorage.removeItem(CLEF_ARMEE); } catch {}
}

async function validerLecture() {
  if (!veille) return;
  const { alarmId } = veille;
  veille = null;
  try { localStorage.removeItem(CLEF_ARMEE); } catch {}
  await pointer(alarmId);
  rafraichirAccueil();                                  // l'agenda est prêt quand on ressortira
  signalerToast('Prière marquée comme faite — 2 minutes de lecture.');
}

/**
 * Une séance de programme (« prog:<programme>:<jour>:<séance> ») se pointe dans son programme :
 * `p.faits` est la seule source que l'agenda lit pour elle. Un rappel, lui, va dans l'historique
 * des prières faites. Sans cette distinction, la lecture était bien comptée, mais jamais relue.
 */
const SEANCE = /^prog:([^:]+):([^:]+):(.+)$/;

async function pointer(id) {
  const m = SEANCE.exec(id);
  if (!m) return store.marquerFaite(id);
  const [, pid, jour, sid] = m;
  const p = await store.getProgramme(pid);
  const deja = p?.faits?.[jour] || [];
  if (!p || deja.includes(sid)) return;                // jamais décocher : la lecture ne fait qu'ajouter
  p.faits = { ...p.faits, [jour]: [...deja, sid] };
  await store.saveProgramme(p);
}

/**
 * Rend à leur programme les séances validées par la lecture avant ce correctif : elles avaient
 * été rangées parmi les rappels, où l'agenda ne les cherche pas. Une fois au démarrage.
 */
export async function recupererSeancesEgarees() {
  const egarees = ((await store.toutesLesFaites()) || []).filter((f) => SEANCE.test(f.alarmId));
  for (const f of egarees) {                           // une à une : même programme, même enregistrement
    await pointer(f.alarmId);
    await store.retirerFaite(f.alarmId, f.jour);
  }
  if (egarees.length) rafraichirAccueil();
}

/**
 * Rattrape une lecture dont le minuteur n'a pas survécu à un déchargement de page.
 * Appelée au démarrage et à chaque retour au premier plan. Une horloge murale plutôt
 * qu'un compteur : le temps passé écran verrouillé compte comme du temps de lecture —
 * c'est justement le cas le plus probable en priant.
 */
export async function rattraperLecture() {
  let arme;
  try { arme = JSON.parse(localStorage.getItem(CLEF_ARMEE) || 'null'); } catch { arme = null; }
  if (!arme) return;
  if (arme.jour !== store.jourClef()) { localStorage.removeItem(CLEF_ARMEE); return; }   // trop vieux, sans rapport
  if (Date.now() - arme.startedAt < DUREE_LECTURE) return;                                // pas encore l'heure
  localStorage.removeItem(CLEF_ARMEE);
  if (veille?.alarmId === arme.alarmId) veille = null;
  await pointer(arme.alarmId);
  rafraichirAccueil();
  signalerToast('Prière marquée comme faite — 2 minutes de lecture.');
}

