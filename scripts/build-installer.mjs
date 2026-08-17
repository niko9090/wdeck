/**
 * Costruisce `release/WdeckSetup-<versione>.exe`: l'installer di Windows.
 *
 * Fa tre cose in fila, perche' saltarne una da' un installer che sembra a
 * posto e non lo e': genera l'icona, costruisce l'eseguibile, e solo allora
 * chiama il compilatore di Inno Setup.
 *
 * Inno Setup e' uno strumento da banco di lavoro, come postject: non entra in
 * package.json e non finisce dentro il programma. Va installato a parte
 * (https://jrsoftware.org/isdl.php).
 *
 *   node scripts/build-installer.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { firmaEseguibile } from './build-exe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** Dove Inno Setup si installa di suo (anche l'installazione per-utente via winget). */
const CANDIDATI = [
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files (x86)\\Inno Setup 5\\ISCC.exe',
  path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe')
];

function trovaCompilatore() {
  for (const c of CANDIDATI) if (fs.existsSync(c)) return c;
  return null;
}

function main() {
  if (process.platform !== 'win32') {
    console.error('L\'installer di Windows si costruisce su Windows.');
    process.exit(1);
  }

  const iscc = trovaCompilatore();
  if (!iscc) {
    console.error('Inno Setup non trovato. Scaricalo da https://jrsoftware.org/isdl.php');
    console.error('Senza, restano l\'eseguibile singolo (npm run exe) e l\'archivio (npm run package).');
    process.exit(1);
  }

  console.log('  genero l\'icona...');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-ico.mjs')], { stdio: 'pipe' });

  console.log('  costruisco l\'eseguibile...');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-exe.mjs')], { stdio: 'inherit' });

  console.log('\n  compilo l\'installer...');
  execFileSync(iscc, [`/DVersione=${pkg.version}`, 'wdeck.iss'], {
    cwd: path.join(ROOT, 'installer'),
    stdio: 'pipe'
  });

  const setup = path.join(ROOT, 'release', `WdeckSetup-${pkg.version}.exe`);
  if (!fs.existsSync(setup)) throw new Error('Inno Setup non ha prodotto il file atteso');

  // Anche l'installer va firmato: e' il file che l'utente scarica ed esegue per
  // primo, quindi e' quello su cui Windows mostra (o no) l'avviso dell'editore.
  console.log('  firmo l\'installer...');
  const firma = firmaEseguibile(setup);
  if (!firma.firmato) {
    console.warn(`  ATTENZIONE: installer NON firmato (${firma.motivo}).`);
    console.warn('  Imposta WDECK_SIGN_PFX (+ WDECK_SIGN_PASSWORD) o WDECK_SIGN_THUMBPRINT per firmare.');
  }

  const mb = (fs.statSync(setup).size / 1048576).toFixed(1);
  console.log(`\n  versione  : ${pkg.version}`);
  console.log(`  firma     : ${firma.firmato ? 'applicata e verificata' : 'assente'}`);
  console.log(`  installer : ${path.relative(ROOT, setup)} (${mb} MB)`);
  console.log('\nINSTALLER OK');
}

main();
