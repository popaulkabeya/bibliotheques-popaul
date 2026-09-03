#!/usr/bin/env node
/**
 * build-audio-from-pdf.mjs — Fabrique un livre audio à partir d'un PDF texte
 * (pas un scan image), via extract_pdf.py (PyMuPDF, nettoyage en-têtes/pieds
 * de page/césures) puis le même pipeline `say` → WAV → M4A que les autres
 * scripts build-audio-from-*.
 *
 * Le découpage en pistes se fait par nombre de mots cible (--words-per-track),
 * aux frontières de paragraphes — pas de titres de chapitres détectés (PDF
 * plat, pas de structure markdown), pistes nommées "<title-prefix> N".
 *
 * Usage :
 *   node scripts/build-audio-from-pdf.mjs --src=<fichier.pdf> --out=<dossier> \
 *     [--voice=Thomas] [--words-per-track=9000] [--title-prefix=Partie] \
 *     [--skip-pages=0,1] [--only=01,02] [--keep-text]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHUNK_MAX_BYTES = 6000;

const args = process.argv.slice(2);
const opt = (name, def) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || def;
const SRC = resolve(ROOT, opt('src'));
const OUT_DIR = resolve(ROOT, opt('out'));
const VOICE = opt('voice', 'Thomas');
const WORDS_PER_TRACK = Number(opt('words-per-track', '9000'));
const TITLE_PREFIX = opt('title-prefix', 'Partie');
const SKIP_PAGES = opt('skip-pages', '');
const ONLY = opt('only', null)?.split(',');
const KEEP_TEXT = args.includes('--keep-text');

if (!SRC || !OUT_DIR) {
  console.error('Usage: node scripts/build-audio-from-pdf.mjs --src=<fichier.pdf> --out=<dossier> [--voice=Thomas] [--words-per-track=9000] [--title-prefix=Partie] [--skip-pages=0,1]');
  process.exit(1);
}

function extractPdfText(src, skipPages) {
  const pyArgs = [join(ROOT, 'scripts', 'extract_pdf.py'), src];
  if (skipPages) pyArgs.push(`--skip-pages=${skipPages}`);
  return execFileSync('python3', pyArgs, { maxBuffer: 1024 * 1024 * 200 }).toString('utf8');
}

/** Découpe le texte (paragraphes séparés par \n\n) en pistes de ~wordsPerTrack mots,
 *  toujours à une frontière de paragraphe. */
function splitIntoTracks(text, wordsPerTrack) {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const tracks = [];
  let buf = [];
  let bufWords = 0;
  for (const p of paragraphs) {
    const w = p.split(/\s+/).length;
    if (bufWords > 0 && bufWords + w > wordsPerTrack) {
      tracks.push(buf.join('\n\n'));
      buf = [];
      bufWords = 0;
    }
    buf.push(p);
    bufWords += w;
  }
  if (buf.length) tracks.push(buf.join('\n\n'));
  return tracks;
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
  console.log(`Voix : ${VOICE}\nExtraction PDF : ${SRC.replace(ROOT + '/', '')}`);
  const text = extractPdfText(SRC, SKIP_PAGES);
  console.log(`  texte extrait : ${text.split(/\s+/).length} mots`);

  const rawTracks = splitIntoTracks(text, WORDS_PER_TRACK);
  const numbered = rawTracks.map((t, i) => ({ n: String(i + 1).padStart(2, '0'), title: `${TITLE_PREFIX} ${i + 1}`, text: t }));
  const tracks = ONLY ? numbered.filter((t) => ONLY.includes(t.n)) : numbered;

  const workDir = mkdtempSync(join(tmpdir(), 'pdf-audio-work-'));
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
