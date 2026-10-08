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

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const prive = existsSync(PRIVE) ? JSON.parse(readFileSync(PRIVE, 'utf8')) : null;
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
      if (!referenced.has(rel)) orphans.push(rel);
    }
  }
};
const orphans = [];
walk(ROOT);

const mb = (b) => (b / 1048576).toFixed(1) + ' Mo';
console.log(`Catalogue : ${catalog.books.length} livres, ${catalog.categories.length} catégories`
  + (prive ? ` — et ${prive.books.length} livres privés` : ''));
console.log(`Fichiers référencés : ${referenced.size} — ${mb(totalBytes)}`);
if (missing.length) { console.log(`\n MANQUANTS (${missing.length}) :`); missing.forEach(m => console.log('   - ' + m)); }
if (orphans.length) { console.log(`\n NON CATALOGUÉS (${orphans.length}) :`); orphans.forEach(o => console.log('   - ' + o)); }
if (!missing.length && !orphans.length) console.log('\n Catalogue et disque parfaitement alignés.');

if (WRITE) {
  catalog.totalBytes = catalog.books.reduce((sum, b) => sum + b.bytes, 0);
  catalog.generatedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + '\n');
  if (prive) writeFileSync(PRIVE, JSON.stringify(prive, null, 2) + '\n');
  console.log('\n Tailles injectées dans catalog.json');
}
process.exit(missing.length ? 1 : 0);
