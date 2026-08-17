/**
 * Servizio di file statici per il client web PWA.
 *
 * Radici cercate in ordine:
 *   1. dist/web  (build prodotta da `npm run build`)
 *   2. web/      (sorgenti, cosi' l'host e' utilizzabile anche senza build)
 * Il percorso /shared/ e' mappato sulla cartella shared/ del progetto.
 */

import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

export const mimeFor = (file) => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/**
 * Risolve un percorso URL in un file reale, impedendo il path traversal.
 * @param {string[]} roots
 * @param {string} urlPath
 * @returns {string|null}
 */
export function resolveStatic(roots, urlPath) {
  let clean;
  try {
    clean = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (clean.includes('\0')) return null;
  if (clean === '/' || clean === '') clean = '/index.html';

  const relative = clean.replace(/^\/+/, '');
  for (const root of roots) {
    const candidate = path.resolve(root, relative);
    const normalizedRoot = path.resolve(root);
    if (candidate !== normalizedRoot && !candidate.startsWith(normalizedRoot + path.sep)) continue;

    let stat;
    try {
      stat = fs.statSync(candidate);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    // Il controllo lessicale non basta: un symlink *dentro* la radice puo'
    // puntare fuori. Solo il percorso reale (risolti i link) dice dove si finisce
    // davvero, e deve restare dentro la radice reale.
    let real;
    let realRoot;
    try {
      real = fs.realpathSync(candidate);
      realRoot = fs.realpathSync(normalizedRoot);
    } catch {
      continue;
    }
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) continue;

    return candidate;
  }
  return null;
}

/**
 * Crea il middleware statico.
 * @param {{roots: string[], mounts?: Record<string, string[]>, cacheControl?: string}} options
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => boolean}
 */
export function createStaticHandler({ roots, mounts = {}, cacheControl = 'no-cache' }) {
  const existingRoots = roots.filter((r) => fs.existsSync(r));

  return function serve(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const urlPath = (req.url ?? '/').split('?')[0];

    let file = null;
    for (const [prefix, mountRoots] of Object.entries(mounts)) {
      if (urlPath.startsWith(prefix)) {
        file = resolveStatic(mountRoots, urlPath.slice(prefix.length - 1) || '/');
        break;
      }
    }
    if (!file) file = resolveStatic(existingRoots, urlPath);
    if (!file) return false;

    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return false;
    }
    res.writeHead(200, {
      'Content-Type': mimeFor(file),
      'Content-Length': size,
      'Cache-Control': cacheControl
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    // Streaming invece di readFileSync: non si carica l'intero file in memoria
    // ne' si blocca il loop degli eventi mentre lo si legge.
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return true;
  };
}
