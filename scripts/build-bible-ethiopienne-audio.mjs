#!/usr/bin/env node
/**
 * build-bible-ethiopienne-audio.mjs — Fabrique le livre audio de la Bible Éthiopienne
 * à partir de l'EPUB source, via la synthèse vocale hors-ligne macOS (`say`).
 *
 * `say -o fichier.aiff` tronque silencieusement au-delà d'environ 7,5 Ko de texte
 * (bug connu, indépendant du contenu) : chaque piste est donc synthétisée par petits
 * morceaux (< 6 Ko, coupés aux phrases), convertis en WAV, puis recollés avec le
 * module `wave` de Python avant l'encodage final en M4A/AAC (afconvert).
 *
 * Usage : node scripts/build-bible-ethiopienne-audio.mjs [--voice=Thomas] [--only=03,04] [--keep-text]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'Bible-Ethiopienne');
const EPUB = join(SRC_DIR, 'Bible-Ethiopienne-Livres-Oublies-FR.epub');
const OUT_DIR = join(SRC_DIR, 'Livre-Audio');
const CHUNK_MAX_BYTES = 6000; // marge de sécurité sous le seuil de troncature de `say` (~7,5 Ko)

const args = process.argv.slice(2);
const VOICE = (args.find((a) => a.startsWith('--voice=')) || '--voice=Thomas').split('=')[1];
const ONLY = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',');
const KEEP_TEXT = args.includes('--keep-text');

/** Chaque piste correspond à une ou plusieurs sections de l'EPUB, dans l'ordre du sommaire. */
const TRACKS = [
  { n: '01', title: 'Introduction',                                    files: ['intro.xhtml', 'canon.xhtml'] },
  { n: '02', title: "Le Livre d'Hénoch (I)",                            files: ['henoch1.xhtml'] },
  { n: '03', title: "Le Livre d'Hénoch (II)",                           files: ['henoch2.xhtml'] },
  { n: '04', title: 'Le Livre des Jubilés (I)',                         files: ['jubiles1.xhtml'] },
  { n: '05', title: 'Le Livre des Jubilés (II)',                        files: ['jubiles2.xhtml'] },
  { n: '06', title: 'Le Quatrième Livre d’Esdras',                  files: ['esdras.xhtml'] },
  { n: '07', title: 'Psaume 151 et Prière de Manassé',                  files: ['petits.xhtml'] },
  { n: '08', title: 'Deutérocanoniques — Tobie et Judith',              files: ['deutero0.xhtml', 'deutero1.xhtml', 'deutero2.xhtml'] },
  { n: '09', title: 'Deutérocanoniques — Sagesse et Ecclésiastique',    files: ['deutero3.xhtml', 'deutero4.xhtml'] },
  { n: '10', title: 'Deutérocanoniques — Baruch, Esther, Daniel',       files: ['deutero5.xhtml', 'deutero6.xhtml', 'deutero7.xhtml'] },
  { n: '11', title: 'Les livres sans traduction française',            files: ['notices.xhtml'] },
];

/** Dézippe l'EPUB (c'est un simple zip) dans un dossier temporaire. */
function extractEpub() {
  const dir = mkdtempSync(join(tmpdir(), 'be-epub-'));
  execFileSync('unzip', ['-o', '-q', EPUB, '-d', dir]);
  return join(dir, 'OEBPS');
}

/** HTML → texte propre pour la synthèse : entités décodées après suppression des balises,
 *  espace ajouté après les numéros de versets pour que `say` marque une pause. */
function cleanHtml(raw) {
  return raw
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[ \t]*\n[ \t]*/g, ' ')
    .replace(/(^|[\s.!?»—])(\d{1,3})\.(?=\S)/g, '$1$2. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildTrackText(oebps, files) {
  return files.map((f) => cleanHtml(readFileSync(join(oebps, f), 'utf8'))).join('\n\n');
}

/** Découpe le texte en morceaux < CHUNK_MAX_BYTES, aux frontières de phrases (repli sur les virgules). */
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

/** Recolle une liste de WAV mono/même format en un seul WAV, via le module `wave` de Python. */
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
  console.log(`Voix : ${VOICE}\nExtraction de l'EPUB…`);
  const oebps = extractEpub();
  const workDir = mkdtempSync(join(tmpdir(), 'be-work-'));

  const tracks = ONLY ? TRACKS.filter((t) => ONLY.includes(t.n)) : TRACKS;
  const results = [];

  for (const track of tracks) {
    const label = `${track.n} - ${track.title}`;
    console.log(`\n[${label}]`);
    const text = buildTrackText(oebps, track.files);
    if (KEEP_TEXT) writeFileSync(join(OUT_DIR, `${label}.txt`), text, 'utf8');

    const pieces = chunkText(text);
    console.log(`  texte : ${text.split(/\s+/).length} mots → ${pieces.length} segment(s)`);

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
    results.push({ n: track.n, title: track.title, path: `Bible-Ethiopienne/Livre-Audio/${label}.m4a`, bytes });
  }

  rmSync(oebps, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });

  writeFileSync(join(OUT_DIR, '.manifest.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`\n${results.length} piste(s) écrite(s) dans ${OUT_DIR.replace(ROOT + '/', '')}/`);
  console.log('Manifeste : Bible-Ethiopienne/Livre-Audio/.manifest.json (à reporter dans catalog.json)');
}

main();
