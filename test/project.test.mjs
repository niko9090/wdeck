/**
 * Verifiche sull'impianto del progetto: vincolo di zero dipendenze e
 * pipeline di integrazione continua.
 *
 * Sono controlli che valgono quanto un test di codice: se qualcuno aggiunge una
 * dipendenza npm o smonta la CI, il progetto smette di essere cio' che dichiara
 * di essere.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('package.json non dichiara dipendenze runtime', () => {
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
});

test('package.json non dichiara dipendenze di sviluppo', () => {
  assert.deepEqual(Object.keys(pkg.devDependencies ?? {}), []);
});

test('esiste il workflow di CI e lancia la verifica completa', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /npm run verify/);
  assert.match(workflow, /^on:/m, 'il workflow deve dichiarare i propri trigger');
  assert.match(workflow, /^\s+push:/m, 'la CI deve girare a ogni push');
  assert.match(workflow, /^\s+pull_request:/m, 'la CI deve girare su ogni pull request');
});

test('la CI prova l\'host su Windows, macOS e Linux', () => {
  const workflow = read('.github/workflows/ci.yml');
  for (const os of ['ubuntu-latest', 'windows-latest', 'macos-latest']) {
    assert.ok(workflow.includes(os), `manca il runner ${os}`);
  }
});

test('verify include ogni controllo della catena', () => {
  for (const step of ['npm test', 'npm run smoke', 'npm run build', 'npm run test:esp32', 'npm run check:docs', 'npm run check:deps']) {
    assert.ok(pkg.scripts.verify.includes(step), `verify non esegue "${step}"`);
  }
});

test('ogni comando citato da verify esiste fra gli script', () => {
  const referenced = [...pkg.scripts.verify.matchAll(/npm run ([a-z:0-9-]+)/g)].map((m) => m[1]);
  for (const name of referenced) {
    assert.ok(name in pkg.scripts, `script inesistente: ${name}`);
  }
});
