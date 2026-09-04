/**
 * pdf-recherche.js — Repère la première page lisible d'un document PDF.
 * N'extrait que le texte — aucun rendu graphique — pour rester rapide sur les
 * ouvrages numérisés qui ouvrent sur des dizaines de planches muettes.
 */
import { splitSentences } from './tts.js';
import { filtrerPhrases, estLisible } from './lisibilite.js';

/**
 * @param {object} doc document pdf.js déjà ouvert
 * @param {number} depart première page à essayer
 * @param {number} pages nombre total de pages
 * @returns {Promise<number>} le numéro de page, ou 0 si rien jusqu'à la fin
 */
export async function chercherPageAvecTexteDe(doc, depart, pages) {
  if (!doc) return 0;
  for (let n = Math.max(1, depart); n <= pages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const brut = tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');
    // Double condition : la page doit être globalement vraisemblable, et livrer
    // plus d'un fragment. Un mot isolé rescapé d'une gravure ne justifie pas
    // d'interrompre l'écoute sur une planche muette.
    if (estLisible(brut) && filtrerPhrases(splitSentences(brut)).length >= 2) return n;
  }
  return 0;
}
