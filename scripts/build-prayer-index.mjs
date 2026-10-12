#!/usr/bin/env node
/**
 * build-prayer-index.mjs — Construit app/src/data/prayers.json : un index des
 * prières individuelles (titre + orientation + source/usage + extrait) tirées
 * des livres markdown structurés en sections "### Titre" (avec ou sans citation
 * `> …` et ligne(s) *Source / Usage / Rubrique*).
 *
 * Chaque entrée porte `h3Index` : le rang de son titre parmi tous les <h3> du
 * document rendu (marked, dans l'ordre du fichier) — c'est ce qui permet au
 * lecteur de sauter directement à la bonne section (voir app.js/goToSection).
 *
 * Les livrets privés (noms réels de personnes et d'entreprises) restent hors de Git :
 * leurs fiches sont dans catalog.prive.json, et leurs prières vont dans prayers.prive.json,
 * ignoré lui aussi. Chaque livret privé à volume .md y est indexé, sans figurer ci-dessous.
 *
 * À relancer après toute modification des .md sources listées ci-dessous.
 * Usage : node scripts/build-prayer-index.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXCERPT_MAX = 800;

const SOURCES = [
  { bookId: 'recueil-prieres', file: 'Recueil-Prieres-et-Invocations/Recueil-Prieres-et-Invocations-FR.md' },
  { bookId: 'prieres-faveur', file: 'Prieres-de-Faveur-et-d-Autorite/Prieres-de-Faveur-et-d-Autorite-FR.md' },
  { bookId: 'priere-deblocage', file: 'Priere-du-Matin-Deblocage-Financier/Priere-du-Matin-Deblocage-Financier-FR.md' },
  { bookId: 'office-matin-soir', file: 'Office-Matin-et-Soir/Office-Matin-et-Soir-FR.md' },
  { bookId: 'livret-trois-prieres', file: 'Livret-Trois-Prieres-du-Jour/Livret-Trois-Prieres-du-Jour-FR.md' },
  { bookId: 'sept-jours-travail', file: 'Sept-Jours-Resistance-Professionnelle/Sept-Jours-Resistance-Professionnelle-FR.md' },
  { bookId: 'sept-nuits-famille', file: 'Sept-Nuits-de-Priere-Familiale/Sept-Nuits-de-Priere-Familiale-FR.md' },
  { bookId: 'prieres-invocations', file: 'Prieres-Invocations-Exercices/Prieres-Invocations-Exercices-FR.md' },
  { bookId: 'moise-6-7', file: 'Septieme-Livres-de-Moise/Sixieme-et-Septieme-Livres-de-Moise-FR.md' },
  { bookId: 'grimorium-verum', file: 'Grimorium-Verum-FR.md' },
];

function mdVolumeIndex(catalog, bookId) {
  const book = catalog.books.find((b) => b.id === bookId);
  const i = book?.volumes.findIndex((v) => v.type === 'md');
  return i >= 0 ? i : 0;
}

/** Une ligne entièrement entre astérisques simples (pas **gras**) : ligne de métadonnées. */
function isMetaLine(line) {
  return /^\*[^*].*[^*]\*$/.test(line.trim()) || /^\*[^*]\*$/.test(line.trim());
}

function stripMeta(line) {
  return line.trim().replace(/^\*/, '').replace(/\*$/, '').trim();
}

function extractField(metaText, field) {
  const re = new RegExp(`${field}\\s*:\\s*([^.]*(?:\\.[^.]*){0,1})`, 'i');
  const m = metaText.match(re);
  return m ? m[1].trim().replace(/\s+$/, '') : '';
}

function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max) + '…';
}

function parseBook(bookId, filePath, mdVolIndex) {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');

  const entries = [];
  let category = '';
  let h3Index = -1;
  let cur = null; // { title, quoteLines: [], plainLines: [], metaLines: [] }

  const flush = () => {
    if (!cur) return;
    const quote = cur.quoteLines.join(' ').replace(/\s+/g, ' ').trim();
    const plain = cur.plainLines.join(' ').replace(/\s+/g, ' ').trim();
    const excerptSrc = quote || plain;
    if (excerptSrc) {
      const metaText = cur.metaLines.map(stripMeta).join(' ');
      entries.push({
        id: `${bookId}-${cur.h3Index}`,
        bookId,
        volume: mdVolIndex,
        h3Index: cur.h3Index,
        category,
        title: cur.title,
        source: extractField(metaText, 'Source'),
        usage: extractField(metaText, 'Usage') || extractField(metaText, 'Rubrique'),
        excerpt: truncate(excerptSrc, EXCERPT_MAX),
      });
    }
    cur = null;
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const h1h2 = /^(#|##)\s+(.*)$/.exec(line);
    const h3 = /^###\s+(.*)$/.exec(line);

    if (h1h2 && !h3) { flush(); category = h1h2[2].trim(); continue; }
    if (h3) {
      flush();
      h3Index += 1;
      // Les marques d'emphase du markdown n'ont rien à faire dans un titre d'index :
      // « Le Sceau *(voir fig. 2)* » doit s'afficher sans ses astérisques.
      const titre = h3[1].trim().replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/[_`]/g, '');
      cur = { title: titre, h3Index, quoteLines: [], plainLines: [], metaLines: [] };
      continue;
    }
    if (!cur) continue;

    // Un sous-titre « #### » ouvre un bloc rattaché à la section sans en faire partie :
    // il ne doit pas nourrir son extrait (le Psaume 23 sous « Le Sceau », par exemple).
    if (/^####+\s/.test(line)) { cur.clos = true; continue; }
    if (cur.clos) continue;

    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('>')) { cur.quoteLines.push(t.replace(/^>\s?/, '')); continue; }
    if (t.startsWith('<') || t === '---') continue; // balises HTML d'annotation, séparateurs
    if (isMetaLine(t)) { cur.metaLines.push(t); continue; }
    cur.plainLines.push(t);
  }
  flush();
  return entries;
}

function indexer(catalog, sources, sortie) {
  const all = [];
  for (const { bookId, file } of sources) {
    const mdVolIndex = mdVolumeIndex(catalog, bookId);
    const entries = parseBook(bookId, join(ROOT, file), mdVolIndex);
    console.log(`${bookId} : ${entries.length} prières indexées`);
    all.push(...entries);
  }
  writeFileSync(join(ROOT, sortie), JSON.stringify(all, null, 2) + '\n');
  console.log(`\n${all.length} prières écrites dans ${sortie}\n`);
}

function main() {
  const catalog = JSON.parse(readFileSync(join(ROOT, 'app/src/data/catalog.json'), 'utf8'));
  indexer(catalog, SOURCES, 'app/src/data/prayers.json');

  const prive = join(ROOT, 'app/src/data/catalog.prive.json');
  if (!existsSync(prive)) return;
  const catalogPrive = JSON.parse(readFileSync(prive, 'utf8'));
  const sources = catalogPrive.books.flatMap((b) => {
    const md = b.volumes.find((v) => v.type === 'md');
    return md ? [{ bookId: b.id, file: md.path }] : [];
  });
  indexer(catalogPrive, sources, 'app/src/data/prayers.prive.json');
}

main();
