#!/usr/bin/env node
/**
 * build-judas-marie-audio.mjs — Fabrique le livre audio d'Évangile de Judas &
 * Évangile de Marie à partir de la source markdown propre (pas du texte extrait
 * du PDF, qui porte encore les numéros de folio du papyrus collés en pleine phrase),
 * via la synthèse vocale hors-ligne macOS (`say`).
 *
 * `say -o fichier.aiff` tronque silencieusement au-delà d'environ 7,5 Ko de texte
 * (bug connu, indépendant du contenu) : chaque piste est donc synthétisée par petits
 * morceaux (< 6 Ko, coupés aux phrases), convertis en WAV, puis recollés avec le
 * module `wave` de Python avant l'encodage final en M4A/AAC (afconvert).
 *
 * Usage : node scripts/build-judas-marie-audio.mjs [--voice=Thomas] [--only=01,02] [--keep-text]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_MD = join('/Users/popaulkabeya/Documents/Grimoires-travail/biblio', 'Judas-et-Marie-Mattison-FR.md');
const OUT_DIR = join(ROOT, 'Judas-et-Marie-Audio');
const CHUNK_MAX_BYTES = 6000; // marge de sécurité sous le seuil de troncature de `say` (~7,5 Ko)

const args = process.argv.slice(2);
const VOICE = (args.find((a) => a.startsWith('--voice=')) || '--voice=Thomas').split('=')[1];
const ONLY = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',');
const KEEP_TEXT = args.includes('--keep-text');

/**
 * Chaque piste regroupe des sections consécutives de la source, référencées par leur
 * titre exact (## ou ###) tel qu'il apparaît dans le markdown, dans l'ordre du document.
 * « Évangile de Judas » et « Évangile de Marie » désignent le paragraphe qui suit
 * directement le titre de niveau 2 (« par Mark M. Mattison… »), avant ses sous-parties.
 */
const TRACKS = [
  { n: '01', title: 'Introduction', sections: ['Note du traducteur'] },
  { n: '02', title: 'Évangile de Judas (I)', sections: [
    'Évangile de Judas', 'Symboles#1', 'Introduction#1', 'Jésus critique les disciples',
    'Une autre génération', 'La vision des disciples',
  ] },
  { n: '03', title: 'Évangile de Judas (II)', sections: ['Jésus et Judas', 'Jésus révèle tout à Judas'] },
  { n: '04', title: 'Évangile de Judas (III) — La trahison', sections: ['La trahison', 'Notes de traduction#1'] },
  { n: '05', title: 'Évangile de Marie', sections: [
    'Évangile de Marie', 'Symboles#2', 'Une perspective éternelle', 'L’Évangile',
    'Marie et Jésus', 'Vaincre les puissances', 'Conflit d’autorité', 'Notes de traduction#2',
  ] },
];

/** Découpe le markdown en sections (## ou ###), dans l'ordre du document. */
function parseSections(md) {
  const lines = md.split('\n');
  const sections = [];
  const seen = new Map();
  let cur = null;
  for (const line of lines) {
    const m = /^(##+) (.*)$/.exec(line);
    if (m) {
      const base = m[2].trim();
      const count = (seen.get(base) || 0) + 1;
      seen.set(base, count);
      const key = count > 1 ? `${base}#${count}` : base;
      // Compat : la première occurrence répond aussi à « Titre#1 » si demandée plus tard.
      cur = { key, base, body: [] };
      sections.push(cur);
      continue;
    }
    if (cur) cur.body.push(line);
  }
  const byKey = new Map();
  for (const s of sections) {
    byKey.set(s.key, s.body.join('\n'));
    if (!byKey.has(`${s.base}#1`)) byKey.set(`${s.base}#1`, s.body.join('\n'));
  }
  return byKey;
}

/** Markdown → texte propre pour la synthèse vocale. */
function cleanMarkdown(raw) {
  return raw
    // gras/italique markdown : on garde le mot, pas la balise
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    // lignes qui ne sont qu'un numéro de folio du papyrus (« 33 », « 34 »…) : supprimées
    .replace(/^[ \t]*\d{1,3}[ \t]*$/gm, '')
    // crochets d'apparat critique : « […] » (lacune) ou « [mot] » (reconstruction éditoriale)
    // — dans les deux cas on garde le contenu et on retire les crochets, jamais lus par la voix
    .replace(/\[([^\]]*)\]/g, '$1')
    .replace(/[ \t]*\n[ \t]*\n[ \t]*/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function buildTrackText(byKey, sectionKeys) {
  return sectionKeys
    .map((k) => {
      const body = byKey.get(k);
      if (body === undefined) throw new Error(`Section introuvable dans la source : « ${k} »`);
      return cleanMarkdown(body);
    })
    .filter(Boolean)
    .join('\n\n');
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
  console.log(`Voix : ${VOICE}\nLecture de la source : ${SRC_MD.replace(ROOT + '/', '')}`);
  const md = readFileSync(SRC_MD, 'utf8');
  const byKey = parseSections(md);
  const workDir = mkdtempSync(join(tmpdir(), 'jm-work-'));

  const tracks = ONLY ? TRACKS.filter((t) => ONLY.includes(t.n)) : TRACKS;
  const results = [];

  for (const track of tracks) {
    const label = `${track.n} - ${track.title}`;
    console.log(`\n[${label}]`);
    const text = buildTrackText(byKey, track.sections);
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
    results.push({ n: track.n, title: track.title, path: `Judas-et-Marie-Audio/${label}.m4a`, bytes });
  }

  rmSync(workDir, { recursive: true, force: true });

  writeFileSync(join(OUT_DIR, '.manifest.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`\n${results.length} piste(s) écrite(s) dans ${OUT_DIR.replace(ROOT + '/', '')}/`);
  console.log('Manifeste : Judas-et-Marie-Audio/.manifest.json (à reporter dans catalog.json)');
}

main();
