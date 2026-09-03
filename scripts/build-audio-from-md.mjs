#!/usr/bin/env node
/**
 * build-audio-from-md.mjs — Fabrique un livre audio à partir d'une source markdown,
 * via la synthèse vocale hors-ligne macOS (`say`), suivant le même pipeline que
 * build-judas-marie-audio.mjs / build-bible-ethiopienne-audio.mjs : découpage en
 * pistes par titres markdown, chunking sous le seuil de troncature de `say`
 * (~7,5 Ko), synthèse AIFF → WAV, recollage (module `wave` de Python), encodage
 * final M4A/AAC (afconvert).
 *
 * Usage :
 *   node scripts/build-audio-from-md.mjs --src=<fichier.md> --out=<dossier> \
 *     [--level=1|2|3|0] [--voice=Thomas] [--only=01,02] [--keep-text] [--single-title="..."]
 *
 * --level=N découpe aux titres markdown à exactement N dièses (## pour N=2, etc.).
 *   Les sous-titres de niveau supérieur restent dans le corps de la piste (lus comme
 *   texte, sans le marqueur #).
 * --level=0 : pas de découpage, tout le fichier (moins le tout premier titre, s'il
 *   n'est que le titre du livre) devient une seule piste ; utiliser --single-title
 *   pour la nommer.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHUNK_MAX_BYTES = 6000;

const args = process.argv.slice(2);
const opt = (name, def) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || def;
const SRC = resolve(ROOT, opt('src'));
const OUT_DIR = resolve(ROOT, opt('out'));
const LEVEL = Number(opt('level', '2'));
const VOICE = opt('voice', 'Thomas');
const ONLY = opt('only', null)?.split(',');
const KEEP_TEXT = args.includes('--keep-text');
const SINGLE_TITLE = opt('single-title', 'Texte intégral');
const SKIP = new Set((opt('skip', '') || '').split('|').filter(Boolean));

if (!SRC || !OUT_DIR) {
  console.error('Usage: node scripts/build-audio-from-md.mjs --src=<fichier.md> --out=<dossier> [--level=N] [--voice=Thomas] [--only=01,02] [--skip=Titre1|Titre2]');
  process.exit(1);
}

/** Markdown → texte propre pour la synthèse vocale (titres inclus, lus comme phrases). */
function cleanMarkdown(raw) {
  return raw
    .replace(/^>\s?/gm, '')
    .replace(/<small>([^<]*)<\/small>/gi, '$1')
    .replace(/^-{3,}\s*$/gm, '')
    .replace(/^#{1,6}\s+(.*)$/gm, '$1.')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[ \t]*\d{1,3}[ \t]*$/gm, '')
    .replace(/\[([^\]]*)\]/g, '$1')
    .replace(/[ \t]*\n[ \t]*\n[ \t]*/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Découpe le markdown en sections de titre exactement `level` dièses ; le corps de
 *  chaque section inclut tout jusqu'au prochain titre de niveau <= level (donc les
 *  sous-titres de niveau supérieur restent dans le corps, lus comme texte). */
function parseTracks(md, level) {
  const lines = md.split('\n');
  const hashRe = new RegExp(`^#{${level}} (.*)$`);
  const higherOrEqualRe = new RegExp(`^#{1,${level}} `);
  const tracks = [];
  let cur = null;
  for (const line of lines) {
    const m = hashRe.exec(line);
    if (m) {
      cur = { title: m[1].trim(), body: [] };
      tracks.push(cur);
      continue;
    }
    if (higherOrEqualRe.test(line)) { cur = null; continue; } // titre de niveau <= level mais pas ==level : hors piste
    if (cur) cur.body.push(line);
  }
  return tracks.filter((t) => t.body.join('').trim().length > 0 && !SKIP.has(t.title));
}

function chunkText(text, maxBytes = CHUNK_MAX_BYTES) {
  const chunks = [];
  let buf = '';
  const pushPiece = (piece) => {
    if (Buffer.byteLength(buf ? buf + ' ' + piece : piece, 'utf8') > maxBytes && buf) {
      chunks.push(buf.trim());
      buf = piece;
    } else {
      buf = buf ? buf + ' ' + piece : piece;
    }
  };
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (Buffer.byteLength(sentence, 'utf8') <= maxBytes) { pushPiece(sentence); continue; }
    for (const part of sentence.split(/(?<=,)\s+/)) pushPiece(part);
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

function run(cmd, cmdArgs) {
  execFileSync(cmd, cmdArgs, { stdio: 'inherit' });
}

function concatWav(wavPaths, outPath) {
  const py = `
import wave, sys
files = sys.argv[1:-1]
out = wave.open(sys.argv[-1], 'wb')
params = None
for fp in files:
    w = wave.open(fp, 'rb')
    p = w.getparams()
    if params is None:
        params = p
        out.setparams(p)
    out.writeframes(w.readframes(p.nframes))
    w.close()
out.close()
`;
  execFileSync('python3', ['-c', py, ...wavPaths, outPath], { stdio: 'inherit' });
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Voix : ${VOICE}\nLecture de la source : ${SRC.replace(ROOT + '/', '')}`);
  const md = readFileSync(SRC, 'utf8');

  let rawTracks;
  if (LEVEL === 0) {
    const withoutTitle = md.replace(/^#\s+.*$/m, '');
    rawTracks = [{ title: SINGLE_TITLE, body: [withoutTitle] }];
  } else {
    rawTracks = parseTracks(md, LEVEL);
  }

  const numbered = rawTracks.map((t, i) => ({ n: String(i + 1).padStart(2, '0'), title: t.title, text: cleanMarkdown(t.body.join('\n')) }));
  const tracks = ONLY ? numbered.filter((t) => ONLY.includes(t.n)) : numbered;

  const workDir = mkdtempSync(join(tmpdir(), 'md-audio-work-'));
  const results = [];
  const outLabel = OUT_DIR.replace(ROOT + '/', '');

  for (const track of tracks) {
    const label = `${track.n} - ${track.title}`;
    console.log(`\n[${label}]`);
    if (KEEP_TEXT) writeFileSync(join(OUT_DIR, `${label}.txt`), track.text, 'utf8');

    const pieces = chunkText(track.text);
    console.log(`  texte : ${track.text.split(/\s+/).length} mots → ${pieces.length} segment(s)`);

    const wavPaths = [];
    pieces.forEach((piece, i) => {
      const idx = String(i).padStart(3, '0');
      const txtPath = join(workDir, `${track.n}.${idx}.txt`);
      const aiffPath = join(workDir, `${track.n}.${idx}.aiff`);
      const wavPath = join(workDir, `${track.n}.${idx}.wav`);
      writeFileSync(txtPath, piece, 'utf8');
      run('say', ['-v', VOICE, '-o', aiffPath, '-f', txtPath]);
      run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', aiffPath, wavPath]);
      wavPaths.push(wavPath);
      rmSync(aiffPath, { force: true });
      rmSync(txtPath, { force: true });
    });
    console.log(`  synthèse : ${pieces.length}/${pieces.length} segment(s) rendus`);

    const mergedWav = join(workDir, `${track.n}.merged.wav`);
    console.log('  recollage (wave)…');
    concatWav(wavPaths, mergedWav);
    wavPaths.forEach((p) => rmSync(p, { force: true }));

    const m4aPath = join(OUT_DIR, `${label}.m4a`);
    console.log('  encodage final (afconvert → m4a/aac)…');
    run('afconvert', ['-f', 'm4af', '-d', 'aac', '-q', '127', '-b', '48000', mergedWav, m4aPath]);
    rmSync(mergedWav, { force: true });

    const bytes = statSync(m4aPath).size;
    console.log(`  écrit : ${m4aPath.replace(ROOT + '/', '')} (${(bytes / 1048576).toFixed(1)} Mo)`);
    results.push({ n: track.n, title: track.title, path: `${outLabel}/${label}.m4a`, bytes });
  }

  rmSync(workDir, { recursive: true, force: true });

  writeFileSync(join(OUT_DIR, '.manifest.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`\n${results.length} piste(s) écrite(s) dans ${outLabel}/`);
  console.log(`Manifeste : ${outLabel}/.manifest.json (à reporter dans catalog.json)`);
}

main();
