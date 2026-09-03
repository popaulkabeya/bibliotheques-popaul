/**
 * lisibilite.js — Distingue un texte réellement lisible d'un résidu d'OCR.
 *
 * Les livres numérisés au XIXᵉ contiennent des planches, des gravures et des pages de
 * garde dont la reconnaissance de caractères ne tire que du bruit : « DR PR dote 2e IP ».
 * Donner cela à la synthèse vocale produit un charabia pénible. On mesure donc la
 * vraisemblance d'un passage avant de le lire à voix haute.
 */

/** Mots-outils français : leur présence signe un vrai texte suivi. */
const OUTILS = new Set([
  // articles, déterminants
  'le','la','les','l','un','une','des','du','de','d','au','aux','ce','cet','cette','ces',
  'mon','ma','mes','ton','ta','tes','son','sa','ses','notre','nos','votre','vos','leur','leurs',
  // pronoms
  'je','tu','il','elle','on','nous','vous','ils','elles','me','te','se','moi','toi','lui','eux',
  'y','en','qui','que','quoi','dont','celui','celle','ceux','celles','soi',
  // prépositions, conjonctions, adverbes fréquents
  'à','dans','par','pour','sur','sous','avec','sans','vers','chez','entre','contre','depuis',
  'et','ou','mais','donc','or','ni','car','si','comme','quand','lorsque','afin','ainsi','aussi',
  'ne','pas','plus','moins','très','bien','tout','toute','tous','toutes','même','encore','déjà',
  'là','ici','où','alors','ensuite','puis','enfin','jamais','toujours','après','avant','pendant',
  // formes verbales très courantes
  'est','sont','était','étaient','être','suis','es','sera','seront','fut',
  'a','ai','as','ont','avait','avaient','avoir','aura','auront','eut',
  'fait','faire','dit','dire','peut','pouvoir','doit','devoir','va','aller',
]);

const MOTS = /[\p{L}][\p{L}'’-]*/gu;

/**
 * Évalue un passage.
 * @returns {{lisible:boolean, score:number, mots:number, outils:number, isoles:number}}
 */
export function evaluer(texte) {
  const brut = String(texte || '');
  const mots = brut.match(MOTS) || [];
  const total = mots.length;
  if (total < 12) return { lisible: false, score: 0, mots: total, outils: 0, isoles: 0 };

  let outils = 0, isoles = 0, longs = 0;
  for (const m of mots) {
    const b = m.toLowerCase().replace(/[’']/g, "'");
    if (OUTILS.has(b)) outils++;
    if (b.length === 1) isoles++;
    if (b.length >= 4) longs++;
  }

  const partOutils = outils / total;      // un texte suivi en contient ~25 %
  const partIsoles = isoles / total;      // le bruit d'OCR en produit énormément
  const partLongs = longs / total;        // le bruit fabrique surtout des fragments courts

  // Combinaison pondérée, ramenée entre 0 et 1.
  const score = Math.max(0, Math.min(1,
    partOutils * 2.2 + partLongs * 0.9 - partIsoles * 1.6));

  return {
    lisible: score >= 0.42 && outils >= 4 && partIsoles < 0.45,
    score: Math.round(score * 100) / 100,
    mots: total, outils, isoles,
  };
}

export const estLisible = (t) => evaluer(t).lisible;

/**
 * Une phrase mérite-t-elle d'être lue à voix haute ?
 * Écarte les en-têtes tronqués, les numéros de page et les lignes de tableau,
 * que l'OCR restitue sous forme de suites de chiffres et de barres verticales.
 */
export function phraseLisible(p) {
  const texte = String(p || '');
  const mots = texte.match(MOTS) || [];
  if (!mots.length) return false;

  const lettres = (texte.match(/\p{L}/gu) || []).length;
  const utiles = (texte.match(/\S/gu) || []).length;
  if (!utiles) return false;
  const densite = lettres / utiles;

  const isoles = mots.filter((m) => m.length === 1).length;
  const substantiels = mots.filter((m) => m.length >= 3).length / mots.length;
  const outils = mots.filter((m) => OUTILS.has(m.toLowerCase().replace(/[’']/g, "'"))).length;

  // Formules brèves — « Amen », « Ainsi soit-il », « Ô grand Adonay » — légitimes dans
  // une oraison. On les accepte si elles sont typographiquement propres.
  if (mots.length < 4) {
    return densite >= 0.7 && isoles <= 1 && !/\d/.test(texte);
  }

  if (isoles / mots.length >= 0.4) return false;
  if (densite < 0.62) return false;

  // Une forte proportion de mots-outils signe du français suivi, même quand les mots
  // sont courts : « Là, je me repose. » doit passer.
  if (outils / mots.length >= 0.35) return true;
  return (outils >= 1 && substantiels >= 0.5) || substantiels >= 0.65;
}

/** Ne conserve que les phrases vraisemblables d'une liste. */
export const filtrerPhrases = (phrases) => phrases.filter(phraseLisible);

/** Minuscules, sans accents, espaces normalisés — pour comparer des textes sans se soucier de la graphie. */
export function aplatir(t) {
  return String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
