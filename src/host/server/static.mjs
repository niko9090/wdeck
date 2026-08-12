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
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
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

    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': mimeFor(file),
      'Content-Length': body.length,
      'Cache-Control': cacheControl
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
