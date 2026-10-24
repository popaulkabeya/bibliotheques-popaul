#!/usr/bin/env node
/**
 * Vérifie que chaque fichier référencé par le catalogue existe sur le disque,
 * injecte sa taille en octets, et signale les fichiers présents mais non catalogués.
 * Les livrets privés de catalog.prive.json (hors Git) sont vérifiés de même ; leur poids
 * n'entre pas dans le total public, l'application l'y ajoute quand elle les trouve.
 * Usage : node scripts/verify-catalog.mjs [--write]
 */
import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'app/src/data/catalog.json');
const PRIVE = join(ROOT, 'app/src/data/catalog.prive.json');
const WRITE = process.argv.includes('--write');
const IGNORE = new Set(['.DS_Store']);
const SKIP_DIRS = new Set(['app', 'scripts', 'docs', 'node_modules', '.git']);

/**
 * Fichiers volontairement hors catalogue, groupés par raison : le rapport ne signale
 * plus comme oubli que ce qui n'est ni catalogué ni déclaré ici. Un chemin finissant
 * par « / » couvre tout le dossier. Les fichiers des livrets privés se déclarent de même
 * sous la clé « horsCatalogue » de catalog.prive.json, pour que leur nom reste hors de Git.
 */
const HORS_CATALOGUE = [
  { raison: 'édition texte en cours, à relier à sa fiche', chemins: [
    'Dogme-Eliphas-Levi-FR.md', 'Rituel-Eliphas-Levi-FR.md', 'La-Clavicule-de-Salomon-FR.md',
    'Le-Petit-Albert-FR.md', 'Le-Veritable-Dragon-Rouge-FR.md', 'Long-Lost-Friend-FR.md',
    'Secrets-Egyptiens-Albert-le-Grand-FR.md',
    'Enchiridion_Oraisons_de_protection.md', 'Enchiridion_Oraisons_voyage_et_saint_Cyprien.md',
  ] },
  { raison: 'fascicule à convertir (.docx, illisible par l\'application)', chemins: [
    'Fascicule_Psaumes_Athanase.docx',
  ] },
  { raison: 'source de travail (scan d\'origine, OCR)', chemins: [
    'Enchiridion_du_pape_Leon.pdf', 'Enchiridion_du_pape_Leon_texte_OCR.txt',
  ] },
  { raison: 'ancien PDF anglais (septembre), remplacé par l\'intérieur du broché', chemins: [
    'Une-Meme-Lumiere-Cinq-Religions-EN.pdf',
  ] },
];

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const prive = existsSync(PRIVE) ? JSON.parse(readFileSync(PRIVE, 'utf8')) : null;
const exclusions = [...HORS_CATALOGUE, ...(prive?.horsCatalogue || [])];
const raisonDe = (rel) => exclusions.find((g) =>
  g.chemins.some((c) => (c.endsWith('/') ? rel.startsWith(c) : rel === c)))?.raison;
const referenced = new Set();
const missing = [];
let totalBytes = 0;

const stamp = (rel) => {
  referenced.add(rel);
  try {
    const bytes = statSync(join(ROOT, rel)).size;
    totalBytes += bytes;
    return bytes;
  } catch {
    missing.push(rel);
    return null;
  }
};

for (const book of [...catalog.books, ...(prive?.books || [])]) {
  for (const vol of book.volumes) {
    if (vol.type === 'gallery') vol.sizes = vol.images.map(stamp);
    else if (vol.type === 'audio') vol.sizes = vol.tracks.map(stamp);
    else vol.bytes = stamp(vol.path);
  }
  // Poids total du livre, utilisé par le bouton « rendre disponible hors-ligne »
  book.bytes = book.volumes.reduce((sum, v) =>
    sum + (v.bytes ?? (v.sizes || []).reduce((a, b) => a + (b || 0), 0)), 0);
}

// Fichiers sur disque jamais référencés
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === ROOT && SKIP_DIRS.has(entry.name)) continue;
      walk(full);
    } else {
      const rel = relative(ROOT, full);
      if (referenced.has(rel)) continue;
      const raison = raisonDe(rel);
      if (raison) horsCatalogue.set(raison, (horsCatalogue.get(raison) || 0) + 1);
      else orphans.push(rel);
    }
  }
};
const orphans = [];
const horsCatalogue = new Map();
walk(ROOT);

// Une exclusion qui ne couvre plus rien (fichier supprimé, ou catalogué depuis) est à retirer
const sansObjet = exclusions.flatMap((g) => g.chemins).filter((c) => c.endsWith('/')
  ? !existsSync(join(ROOT, c)) || [...referenced].some((r) => r.startsWith(c))
  : !existsSync(join(ROOT, c)) || referenced.has(c));

const mb = (b) => (b / 1048576).toFixed(1) + ' Mo';
console.log(`Catalogue : ${catalog.books.length} livres, ${catalog.categories.length} catégories`
  + (prive ? ` — et ${prive.books.length} livres privés` : ''));
console.log(`Fichiers référencés : ${referenced.size} — ${mb(totalBytes)}`);
if (missing.length) { console.log(`\n MANQUANTS (${missing.length}) :`); missing.forEach(m => console.log('   - ' + m)); }
if (orphans.length) { console.log(`\n NON CATALOGUÉS (${orphans.length}) :`); orphans.forEach(o => console.log('   - ' + o)); }
if (sansObjet.length) { console.log(`\n EXCLUSIONS SANS OBJET (${sansObjet.length}) — à retirer de la liste :`); sansObjet.forEach(c => console.log('   - ' + c)); }
if (horsCatalogue.size) {
  console.log('\n Hors catalogue, volontairement :');
  horsCatalogue.forEach((n, raison) => console.log(`   - ${raison} : ${n} fichier${n > 1 ? 's' : ''}`));
}
if (!missing.length && !orphans.length && !sansObjet.length) console.log('\n Catalogue et disque parfaitement alignés.');

if (WRITE) {
  catalog.totalBytes = catalog.books.reduce((sum, b) => sum + b.bytes, 0);
  catalog.generatedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + '\n');
  if (prive) writeFileSync(PRIVE, JSON.stringify(prive, null, 2) + '\n');
  console.log('\n Tailles injectées dans catalog.json');
}
process.exit(missing.length ? 1 : 0);
