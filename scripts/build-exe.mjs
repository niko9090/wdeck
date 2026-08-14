/**
 * Costruisce `release/wdeck.exe`: un eseguibile singolo che non richiede
 * Node.js sul PC di destinazione.
 *
 * Come funziona: Node 20+ sa incorporare uno script dentro una copia di se
 * stesso (Single Executable Application). Lo script incorporato e'
 * `scripts/sea-entry.cjs`, e i moduli dell'host viaggiano con lui come asset.
 *
 * L'unico pezzo che Node non fa da solo e' scrivere il blob dentro il binario:
 * lo fa `postject`, strumento ufficiale del progetto Node.js, scaricato al
 * volo da `npx`. E' un attrezzo da banco di lavoro, non una dipendenza: non
 * finisce in package.json e l'host non lo importa mai. Il vincolo di zero
 * dipendenze a runtime resta intatto, ed e' verificato da `check:deps`.
 *
 *   node scripts/build-exe.mjs
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** Cartelle e file che devono finire dentro l'eseguibile. */
const INCLUDE = ['bin', 'src', 'shared', 'schema', path.join('dist', 'web')];
const INCLUDE_FILES = ['package.json'];

/** Il fusibile che Node cerca dentro il binario per sapere dove sta il blob. */
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(ROOT, full).split(path.sep).join('/'));
  }
  return out;
}

function main() {
  if (process.platform !== 'win32') {
    console.error('Questo script produce un .exe e va lanciato su Windows.');
    console.error('Su macOS e Linux si avvia dai sorgenti: npm start.');
    process.exit(1);
  }

  // Il client va compilato prima: dentro l'exe ci va dist/web, non i sorgenti.
  console.log('  compilo il client web...');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-web.mjs')], { stdio: 'pipe' });

  const files = [];
  for (const item of INCLUDE) {
    const full = path.join(ROOT, item);
    if (!fs.existsSync(full)) throw new Error(`manca ${item}: lancia prima "npm run build"`);
    files.push(...walk(full));
  }
  files.push(...INCLUDE_FILES);

  // L'impronta del contenuto diventa il nome della cartella di estrazione:
  // cosi' un exe ricostruito estrae di nuovo, e uno identico non ripete il
  // lavoro. La versione da sola non basterebbe durante lo sviluppo.
  const digest = crypto.createHash('sha256');
  const assets = { MANIFEST: null };
  for (const file of files) {
    const buf = fs.readFileSync(path.join(ROOT, file));
    digest.update(file).update(buf);
    assets[file] = path.join(ROOT, file);
  }
  const stamp = `${pkg.version}-${digest.digest('hex').slice(0, 12)}`;

  const buildDir = path.join(ROOT, 'release', '.sea');
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });

  const manifestFile = path.join(buildDir, 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify({ version: pkg.version, stamp, files }));
  assets.MANIFEST = manifestFile;
  assets['deck.default.json'] = path.join(ROOT, 'deck.json');

  const seaConfig = {
    main: path.join(ROOT, 'scripts', 'sea-entry.cjs'),
    output: path.join(buildDir, 'wdeck.blob'),
    disableExperimentalSEAWarning: true,
    assets
  };
  const configFile = path.join(buildDir, 'sea-config.json');
  fs.writeFileSync(configFile, JSON.stringify(seaConfig, null, 2));

  console.log(`  incorporo ${files.length} file...`);
  execFileSync(process.execPath, ['--experimental-sea-config', configFile], { stdio: 'pipe' });

  const exe = path.join(ROOT, 'release', 'wdeck.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.copyFileSync(process.execPath, exe);

  console.log('  scrivo il blob nel binario (postject)...');
  execFileSync(
    'npx',
    ['--yes', 'postject', exe, 'NODE_SEA_BLOB', seaConfig.output, '--sentinel-fuse', FUSE],
    { stdio: 'pipe', shell: true }
  );

  // Un exe che non parte e' peggio di un errore di build: lo provo qui.
  console.log('  verifico che parta...');
  const help = execFileSync(exe, ['--help'], { encoding: 'utf8', timeout: 60000 });
  if (!help.includes('Wdeck host')) throw new Error('l\'eseguibile non risponde a --help');

  const mb = (fs.statSync(exe).size / 1048576).toFixed(1);
  console.log(`\n  versione : ${pkg.version}`);
  console.log(`  file     : ${files.length} incorporati`);
  console.log(`  impronta : ${stamp}`);
  console.log(`  exe      : ${path.relative(ROOT, exe)} (${mb} MB)`);
  console.log('\nEXE OK');
}

main();
