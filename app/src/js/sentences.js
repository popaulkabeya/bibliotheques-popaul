/**
 * sentences.js — Repérage et surlignage des phrases dans un document rendu.
 * Isolé du lecteur : ne dépend que du DOM et du découpage en phrases.
 */
import { splitSentences } from './tts.js';

const BLOCKS = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, dd, dt, figcaption, pre, div, section, article';

/**
 * Repère les phrases du conteneur pour pouvoir les surligner pendant la lecture vocale.
 *
 * Deux cas, à dessein :
 *  — bloc de texte pur      → une balise <span> par phrase, surlignage à la phrase près ;
 *  — bloc avec mise en forme → le bloc entier sert de repère, ce qui préserve
 *    italiques, gras et liens. Le découpage en phrases reste le même pour la voix :
 *    seule la granularité du surlignage change.
 *
 * @returns {{sentences:string[], spans:HTMLElement[]}}
 */
export function indexSentences(root, doc = document) {
  const sentences = [], spans = [];

  const blocks = [...root.querySelectorAll(BLOCKS)].filter((el) => {
    if (el.closest('svg')) return false;                       // ignore le contenu vectoriel
    const inner = el.querySelector(BLOCKS);                    // ne garder que les blocs feuilles
    if (inner && inner.textContent.trim()) return false;
    return /[\p{L}\p{N}]/u.test(el.textContent);
  });

  for (const block of blocks) {
    const parts = splitSentences(block.textContent);
    if (!parts.length) continue;

    // Le bloc contient de la mise en forme : on n'y touche pas.
    if (block.children.length) {
      for (const p of parts) { sentences.push(p); spans.push(block); }
      continue;
    }

    const frag = doc.createDocumentFragment();
    parts.forEach((p, i) => {
      const span = doc.createElement('span');
      span.dataset.s = sentences.length;
      span.textContent = p + (i < parts.length - 1 ? ' ' : '');
      frag.appendChild(span);
      sentences.push(p); spans.push(span);
    });
    block.replaceChildren(frag);
  }
  return { sentences, spans };
}

/** Surligne la phrase i parmi `spans` et la fait défiler dans la vue. */
export function highlight(spans, i, follow = true) {
  const el = spans[i];
  for (const s of spans) if (s !== el) s.classList.remove('spk');
  if (!el) return;
  el.classList.add('spk');
  if (follow) {
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
  }
}

export const clearHighlight = (spans) => spans.forEach((s) => s.classList.remove('spk'));

