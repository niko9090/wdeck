/**
 * Prepara l'archivio di distribuzione da allegare a una release di GitHub.
 *
 * Produce `release/wdeck-<versione>.zip` con il necessario per installare ed
 * eseguire Wdeck: sorgenti dell'host, client gia' compilato, installer e
 * documentazione. Non include test, firmware e file di sviluppo.
 *
 * La compressione usa Compress-Archive di Windows: niente dipendenze npm.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/** Cosa finisce nell'archivio. Tutto il resto e' materiale di sviluppo. */
const INCLUDE = [
  'bin',
  'src',
  'shared',
  'web',
  'dist',
  'schema',
  'scripts/build-web.mjs',
  'scripts/gen-icons.mjs',
  'installer',
  'docs',
  'deck.json',
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'LICENSE'
];

const releaseDir = path.join(ROOT, 'release');
const stageDir = path.join(releaseDir, `wdeck-${version}`);
const zipFile = path.join(releaseDir, `wdeck-${version}.zip`);

fs.rmSync(stageDir, { recursive: true, force: true });
fs.rmSync(zipFile, { force: true });
fs.mkdirSync(stageDir, { recursive: true });

let copied = 0;
for (const entry of INCLUDE) {
  const source = path.join(ROOT, entry);
  if (!fs.existsSync(source)) {
    console.warn(`  saltato (assente): ${entry}`);
    continue;
  }
  const target = path.join(stageDir, entry);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  copied += 1;
}

// Il client compilato e' obbligatorio: senza, l'host servirebbe i sorgenti e
// chi installa non avrebbe mai la versione minificata.
if (!fs.existsSync(path.join(stageDir, 'dist', 'web', 'index.html'))) {
  console.error('\nERRORE: manca dist/web. Eseguire prima "npm run build".');
  process.exit(1);
}

execFileSync('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-Command',
  `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipFile}' -Force`
], { stdio: 'inherit' });

const size = fs.statSync(zipFile).size;
fs.rmSync(stageDir, { recursive: true, force: true });

console.log('');
console.log(`  versione : ${version}`);
console.log(`  voci     : ${copied}`);
console.log(`  archivio : ${path.relative(ROOT, zipFile)} (${(size / 1024).toFixed(1)} KB)`);
console.log('');
console.log('PACKAGE OK');
