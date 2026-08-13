#!/usr/bin/env node
/**
 * Build statica del client web PWA.
 *
 * Non serve un bundler: l'app usa moduli ES nativi. Questo script:
 *  1. ricrea dist/web da web/;
 *  2. copia shared/protocol.mjs in dist/web/shared/ (import condiviso con l'host);
 *  3. minifica il CSS (solo commenti e spazi: trasformazione sicura);
 *  4. calcola un id di build e lo inietta nel service worker e in index.html;
 *  5. scrive asset-manifest.json e build.json;
 *  6. verifica che tutti i file attesi esistano (altrimenti esce con codice 1).
 *
 * Uso: npm run build
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'web');
const SHARED = path.join(ROOT, 'shared');
const OUT = path.join(ROOT, 'dist', 'web');

const REQUIRED = [
  'index.html',
  'app.css',
  'app.js',
  'icons.js',
  'i18n.js',
  'sw.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'shared/protocol.mjs'
];

const errors = [];

/** Copia ricorsiva di una directory. */
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

/** Elenco ricorsivo dei file di una directory, relativo alla stessa. */
function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/** Minificazione CSS conservativa: rimuove commenti e spazi ridondanti. */
export function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function main() {
  console.log('\nWdeck - build del client web PWA\n');

  if (!fs.existsSync(SRC)) {
    console.error(`sorgenti non trovati: ${SRC}`);
    process.exit(1);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  copyDir(SRC, OUT);

  // il protocollo condiviso viene servito su /shared/protocol.mjs
  fs.mkdirSync(path.join(OUT, 'shared'), { recursive: true });
  fs.copyFileSync(path.join(SHARED, 'protocol.mjs'), path.join(OUT, 'shared', 'protocol.mjs'));

  // --- controllo sintattico di tutto il JavaScript prodotto ---
  for (const rel of listFiles(OUT).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))) {
    try {
      execFileSync(process.execPath, ['--check', path.join(OUT, rel)], { stdio: 'pipe' });
    } catch (err) {
      errors.push(`${rel}: errore di sintassi\n${(err.stderr ?? '').toString().trim()}`);
    }
  }

  // --- minificazione CSS ---
  const cssPath = path.join(OUT, 'app.css');
  const cssBefore = fs.readFileSync(cssPath, 'utf8');
  const cssAfter = minifyCss(cssBefore);
  fs.writeFileSync(cssPath, cssAfter);

  // --- id di build ---
  const hash = crypto.createHash('sha256');
  for (const rel of listFiles(OUT)) hash.update(rel).update(fs.readFileSync(path.join(OUT, rel)));
  const buildId = hash.digest('hex').slice(0, 12);

  // --- iniezione nel service worker ---
  const swPath = path.join(OUT, 'sw.js');
  const sw = fs.readFileSync(swPath, 'utf8');
  if (!sw.includes('__WDECK_BUILD__')) errors.push('sw.js: segnaposto __WDECK_BUILD__ non trovato');
  fs.writeFileSync(swPath, sw.replaceAll('__WDECK_BUILD__', buildId));

  // --- iniezione nell'HTML ---
  const htmlPath = path.join(OUT, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  if (!html.includes('<title>')) errors.push('index.html: tag <title> non trovato');
  fs.writeFileSync(
    htmlPath,
    html.replace('<title>', `<meta name="wdeck-build" content="${buildId}" />\n  <title>`)
  );

  // --- manifest degli asset ---
  const files = listFiles(OUT);
  const assets = files.map((rel) => {
    const stat = fs.statSync(path.join(OUT, rel));
    return {
      file: rel,
      bytes: stat.size,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, rel))).digest('hex').slice(0, 16)
    };
  });
  fs.writeFileSync(path.join(OUT, 'asset-manifest.json'), `${JSON.stringify(assets, null, 2)}\n`);

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  fs.writeFileSync(
    path.join(OUT, 'build.json'),
    `${JSON.stringify({ name: pkg.name, version: pkg.version, buildId, files: files.length }, null, 2)}\n`
  );

  // --- verifiche finali ---
  for (const rel of REQUIRED) {
    if (!fs.existsSync(path.join(OUT, rel))) errors.push(`file mancante nella build: ${rel}`);
  }
  if (fs.readFileSync(swPath, 'utf8').includes('__WDECK_BUILD__')) {
    errors.push('sw.js: segnaposto non sostituito');
  }

  const total = assets.reduce((sum, a) => sum + a.bytes, 0);
  for (const asset of assets) {
    console.log(`  ${asset.file.padEnd(34)} ${humanSize(asset.bytes).padStart(9)}`);
  }
  console.log(`\n  build id : ${buildId}`);
  console.log(`  file     : ${assets.length}`);
  console.log(`  totale   : ${humanSize(total)}`);
  console.log(`  output   : ${path.relative(ROOT, OUT).split(path.sep).join('/')}\n`);

  if (errors.length > 0) {
    console.error('BUILD FALLITA:');
    for (const err of errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log('BUILD OK\n');
}

main();
