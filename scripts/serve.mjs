#!/usr/bin/env node
/**
 * serve.mjs — Serveur statique local pour la Bibliothèque Spirituelle.
 * Sans dépendance. Gère les requêtes Range (lecture audio, gros PDF) et les bons types MIME.
 * Usage : node scripts/serve.mjs [port]
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8420);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf', '.epub': 'application/epub+zip',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

const send = (res, code, body, type = 'text/plain; charset=utf-8') =>
  res.writeHead(code, { 'Content-Type': type }).end(body);

const server = createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { return send(res, 400, 'Requête invalide'); }

  // La coquille vit dans /app/ : on redirige la racine pour que les chemins
  // relatifs (src/…, vendor/…, ../Zohar-…) se résolvent correctement.
  if (pathname === '/') {
    return res.writeHead(302, { Location: '/app/' }).end();
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = resolve(join(ROOT, pathname));
  // Empêche toute sortie de l'arborescence du projet
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return send(res, 403, 'Accès refusé');

  let stat;
  try { stat = statSync(file); } catch { return send(res, 404, 'Introuvable : ' + pathname); }
  if (stat.isDirectory()) return send(res, 404, 'Introuvable');

  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  // Sans validateur, « no-cache » laisse certains navigateurs resservir une copie
  // périmée : une modification du catalogue ou du code passait inaperçue.
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  // Code et données : jamais mis en cache par le navigateur — une modification doit être
  // visible au rechargement suivant, pas à celui d'après. Le hors-ligne reste assuré par
  // le service worker, qui stocke explicitement ce dont il a besoin.
  // Livres : revalidation par ETag, car ce sont de gros fichiers qui ne changent presque jamais.
  const CODE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest']);
  const estCode = CODE.has(extname(file).toLowerCase());

  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': estCode ? 'no-store, must-revalidate' : 'no-cache',
    'Service-Worker-Allowed': '/',
    'ETag': etag,
    'Last-Modified': stat.mtime.toUTCString(),
  };

  const known = req.headers['if-none-match'];
  const since = req.headers['if-modified-since'];
  if (!estCode && (known === etag ||
      (since && Date.parse(since) >= Math.floor(stat.mtimeMs / 1000) * 1000))) {
    return res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }).end();
  }

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size) end = stat.size - 1;
      if (start > end) return res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
      res.writeHead(206, { ...headers,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1 });
      return createReadStream(file, { start, end }).pipe(res);
    }
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
});

const lanIP = () => Object.values(networkInterfaces()).flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

server.listen(PORT, () => {
  const ip = lanIP();
  console.log(`\n  ✦  Bibliothèque Spirituelle\n`);
  console.log(`     Sur cet ordinateur : http://localhost:${PORT}/`);
  if (ip) console.log(`     Sur téléphone/tablette (même Wi-Fi) : http://${ip}:${PORT}/`);
  console.log(`\n     Racine : ${ROOT}`);
  console.log(`     Ctrl+C pour arrêter.\n`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Le port ${PORT} est déjà occupé. Essayez : node scripts/serve.mjs ${PORT + 1}\n`);
    process.exit(1);
  }
  throw e;
});
