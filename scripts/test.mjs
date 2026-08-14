/**
 * Esegue la suite di test.
 *
 * Perche' non basta `node --test test/*.test.mjs`: quel comando funziona solo
 * dove la shell espande il glob. Su Windows non lo fa, e Node ha imparato a
 * farlo da se' solo dalla 21 - quindi su Windows con Node 20.10, che questo
 * progetto dichiara di supportare, `npm test` non trovava un bel niente.
 * Passare la cartella non aiuta: le versioni recenti provano a caricarla come
 * modulo. L'elenco dei file lo facciamo qui, e vale ovunque.
 *
 * Gli argomenti in piu' arrivano a `node --test`:
 *   node scripts/test.mjs --test-name-pattern "audit"
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'test');

const files = fs
  .readdirSync(TEST_DIR)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => path.join(TEST_DIR, f));

if (files.length === 0) {
  console.error(`Nessun file di test in ${path.relative(ROOT, TEST_DIR)}/`);
  process.exit(1);
}

const esito = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
  stdio: 'inherit'
});

process.exit(esito.status ?? 1);
