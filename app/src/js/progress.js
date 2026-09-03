/**
 * progress.js — Mesure et mise en forme de l'avancement de lecture.
 * Chaque format se mesure autrement : un PDF a des pages, un texte défile,
 * un EPUB avance par sections, un livre audio par pistes.
 */

/** Nombre de signes tenant sur une page imprimée — sert à convertir un texte en pages. */
const SIGNES_PAR_PAGE = 1800;

/**
 * Construit la mesure d'avancement à enregistrer.
 * @returns {{percent:number, read:number, total:number, unit:string, approx:boolean}}
 */
export function mesurer({ kind, page, pages, scrollTop, scrollHeight, clientHeight, chars,
                          section, sections, track, tracks }) {
  switch (kind) {
    case 'pdf':
      return { mesurable: true, percent: pct(page, pages), read: page || 0, total: pages || 0,
               unit: 'page', approx: false };

    case 'md': {
      // Onglet masqué ou fenêtre réduite : la mise en page s'effondre et clientHeight tombe
      // à zéro. Mesurer là-dessus donnerait un pourcentage faux — qu'on garderait à jamais,
      // puisque seule la valeur la plus avancée est conservée. Mieux vaut ne rien mesurer.
      if (!clientHeight || !scrollHeight || scrollHeight <= clientHeight) {
        return { mesurable: false, percent: 0, read: 0,
                 total: Math.max(1, Math.round((chars || 0) / SIGNES_PAR_PAGE)),
                 unit: 'page', approx: true };
      }
      const ratio = Math.min(1, Math.max(0, (scrollTop || 0) / (scrollHeight - clientHeight)));
      const total = Math.max(1, Math.round((chars || 0) / SIGNES_PAR_PAGE));
      return { mesurable: true, percent: Math.round(ratio * 100),
               read: Math.max(1, Math.round(ratio * total)), total, unit: 'page', approx: true };
    }

    case 'epub':
      return { mesurable: true, percent: pct(section + 1, sections), read: (section || 0) + 1,
               total: sections || 0, unit: 'section', approx: false };

    case 'audio':
      return { mesurable: true, percent: pct(track, tracks), read: track || 0, total: tracks || 0,
               unit: 'piste', approx: false };

    default:
      return { mesurable: false, percent: 0, read: 0, total: 0, unit: '', approx: false };
  }
}

const pct = (n, total) => (total ? Math.min(100, Math.round((n / total) * 100)) : 0);

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/**
 * Total exprimé dans l'unité du format. Un enregistrement stocké porte `unitTotal`
 * (pages estimées, sections, pistes) tandis que `total` reste le nombre de pages PDF ;
 * une mesure fraîche ne porte que `total`. On accepte les deux.
 */
const totalUnite = (p) => p.unitTotal ?? p.total ?? 0;

/**
 * Phrase lisible : « 42 % · 93 pages sur 221 ».
 * @param {object} p enregistrement de progression, ou mesure fraîche
 */
export function resumer(p) {
  const t = p ? totalUnite(p) : 0;
  if (!t) return '';
  const tilde = p.approx ? '≈ ' : '';
  return `${p.percent || 0} % · ${tilde}${pluriel(p.read || 0, p.unit)} sur ${t}`;
}

/** Version courte pour les cartes : « 42 % ». */
export const court = (p) => (p && p.percent ? `${p.percent} %` : '');

/** Reste à lire, en unités du format. */
export function reste(p) {
  const t = p ? totalUnite(p) : 0;
  if (!t) return '';
  const r = Math.max(0, t - (p.read || 0));
  if (!r) return 'Terminé';
  return `${pluriel(r, p.unit)} restante${r > 1 ? 's' : ''}`;
}

/** Un livre est considéré lu au-delà de ce seuil. */
export const TERMINE = 97;
export const estTermine = (p) => !!p && p.percent >= TERMINE;
