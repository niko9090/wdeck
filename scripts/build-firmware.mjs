/**
 * Compila il firmware ESP32 e raccoglie i binari in `release/firmware/`.
 *
 * Serve PlatformIO installato (`pip install platformio`): e' l'unico modo di
 * ottenere un .bin, perche' il codice va compilato per l'architettura xtensa.
 * La prima esecuzione scarica la toolchain e ci mette parecchi minuti; le
 * successive sono nell'ordine del minuto per scheda.
 *
 * Attenzione a cosa dimostra e cosa no: che il firmware **compili** per tutte
 * le schede supportate e' una verifica vera, e ha gia' trovato un errore. Che
 * **funzioni** su una scheda accesa e' un'altra cosa, e richiede l'hardware.
 *
 *   node scripts/build-firmware.mjs           tutte le schede
 *   node scripts/build-firmware.mjs esp32-cyd solo quella
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FW = path.join(ROOT, 'firmware', 'esp32');
const OUT = path.join(ROOT, 'release', 'firmware');

/** Gli ambienti dichiarati in platformio.ini, letti da li' e non ricopiati. */
function environments() {
  const ini = fs.readFileSync(path.join(FW, 'platformio.ini'), 'utf8');
  return [...ini.matchAll(/^\[env:([^\]]+)\]/gm)].map((m) => m[1]);
}

/** I tre pezzi che servono per una scrittura completa della flash. */
const PARTS = ['firmware', 'bootloader', 'partitions'];

function main() {
  const wanted = process.argv.slice(2);
  const envs = environments().filter((e) => wanted.length === 0 || wanted.includes(e));
  if (envs.length === 0) {
    console.error(`Ambiente sconosciuto. Disponibili: ${environments().join(', ')}`);
    process.exit(1);
  }

  if (spawnSync('pio', ['--version'], { shell: true }).status !== 0) {
    console.error('PlatformIO non trovato. Installalo con:  pip install platformio');
    console.error('Senza di esso il firmware resta sorgente: non c\'e\' modo di produrre un .bin.');
    process.exit(1);
  }

  const args = envs.flatMap((e) => ['-e', e]);
  console.log(`  compilo ${envs.length} scheda/e: ${envs.join(', ')}`);
  execFileSync('pio', ['run', ...args], { cwd: FW, stdio: 'inherit', shell: true });

  fs.mkdirSync(OUT, { recursive: true });
  const prodotti = [];
  for (const env of envs) {
    for (const part of PARTS) {
      const src = path.join(FW, '.pio', 'build', env, `${part}.bin`);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(OUT, `${env}-${part}.bin`);
      fs.copyFileSync(src, dest);
      prodotti.push([path.relative(ROOT, dest), fs.statSync(dest).size]);
    }
  }

  if (prodotti.length === 0) throw new Error('compilazione riuscita ma nessun .bin prodotto');
  console.log('');
  for (const [file, size] of prodotti) {
    console.log(`  ${file.padEnd(46)} ${(size / 1024).toFixed(1)} KB`);
  }
  console.log('\nFIRMWARE OK');
  console.log('Compilato, non collaudato: serve una scheda vera per dirlo funzionante.');
}

main();
