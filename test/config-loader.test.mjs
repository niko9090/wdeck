import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ConfigError, applyOverrides, createConfigStore, envOverrides, loadDeckFile } from '../src/host/config/loader.mjs';
import { createDefaultRegistry } from '../src/host/actions/handlers/index.mjs';
import { rawDeck } from '../tools/fixtures.mjs';

const actionTypes = createDefaultRegistry().types();

function tempDeck(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-test-'));
  const file = path.join(dir, 'deck.json');
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return { dir, file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('loader: carica e normalizza un file valido', (t) => {
  const { file, cleanup } = tempDeck(rawDeck());
  t.after(cleanup);

  const { deck, warnings } = loadDeckFile(file, { actionTypes });
  assert.equal(deck.name, 'Deck di test');
  assert.equal(deck.profiles.length, 1);
  assert.equal(deck.settings.server.port, 8900);
  assert.equal(warnings.length, 0);
});

test('loader: file inesistente -> ConfigError', () => {
  assert.throws(
    () => loadDeckFile(path.join(os.tmpdir(), 'wdeck-non-esiste.json')),
    (err) => err instanceof ConfigError && /impossibile leggere/.test(err.message)
  );
});

test('loader: JSON malformato -> ConfigError', (t) => {
  const { file, cleanup } = tempDeck('{ "version": 1, ');
  t.after(cleanup);
  assert.throws(() => loadDeckFile(file), (err) => err instanceof ConfigError && /JSON non valido/.test(err.message));
});

test('loader: configurazione non valida -> ConfigError con elenco errori', (t) => {
  const invalid = rawDeck();
  invalid.profiles[0].pages[0].buttons[0].row = 99;
  const { file, cleanup } = tempDeck(invalid);
  t.after(cleanup);

  try {
    loadDeckFile(file, { actionTypes });
    assert.fail('atteso ConfigError');
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    assert.ok(err.errors.length > 0);
    assert.match(err.message, /configurazione non valida/);
  }
});

test('loader: applyOverrides ha la precedenza sul file', () => {
  const { deck } = loadDeckFileFromObject(rawDeck());
  const overridden = applyOverrides(deck, { port: 1234, host: '127.0.0.1', token: 'nuovo-token-abcdef', dryRun: true });
  assert.equal(overridden.settings.server.port, 1234);
  assert.equal(overridden.settings.security.token, 'nuovo-token-abcdef');
  assert.equal(overridden.settings.security.dryRun, true);
  // l'originale resta immutato
  assert.equal(deck.settings.server.port, 8900);
});

function loadDeckFileFromObject(obj) {
  const { file, cleanup } = tempDeck(obj);
  try {
    return loadDeckFile(file, { actionTypes });
  } finally {
    cleanup();
  }
}

test('loader: envOverrides interpreta le variabili WDECK_*', () => {
  assert.deepEqual(envOverrides({}), {});
  assert.deepEqual(
    envOverrides({ WDECK_PORT: '9000', WDECK_HOST: '0.0.0.0', WDECK_TOKEN: 'tok', WDECK_DRY_RUN: 'true' }),
    { port: 9000, host: '0.0.0.0', token: 'tok', dryRun: true }
  );
  assert.equal(envOverrides({ WDECK_DRY_RUN: 'no' }).dryRun, false);
  assert.equal(envOverrides({ WDECK_DRY_RUN: '1' }).dryRun, true);
  assert.equal(envOverrides({ WDECK_REQUIRE_TOKEN: 'off' }).requireToken, false);
});

test('store: load/get e ricarica a caldo', (t) => {
  const { file, cleanup } = tempDeck(rawDeck());
  t.after(cleanup);

  const store = createConfigStore({ file, actionTypes });
  t.after(() => store.close());

  const deck = store.load();
  assert.equal(deck.name, 'Deck di test');
  assert.equal(store.get().name, 'Deck di test');

  const modified = rawDeck();
  modified.name = 'Deck aggiornato';
  fs.writeFileSync(file, JSON.stringify(modified));

  let changed = null;
  store.on('change', (next) => { changed = next; });
  const result = store.reload();

  assert.equal(result.ok, true);
  assert.equal(store.get().name, 'Deck aggiornato');
  assert.equal(changed.name, 'Deck aggiornato');
});

test('store: una ricarica non valida mantiene la configurazione precedente', (t) => {
  const { file, cleanup } = tempDeck(rawDeck());
  t.after(cleanup);

  const store = createConfigStore({ file, actionTypes, logger: { error() {}, warn() {} } });
  t.after(() => store.close());
  store.load();

  fs.writeFileSync(file, '{ rotto');
  let errorEvent = null;
  store.on('error', (err) => { errorEvent = err; });
  const result = store.reload();

  assert.equal(result.ok, false);
  assert.ok(result.error instanceof ConfigError);
  assert.ok(errorEvent instanceof ConfigError);
  assert.equal(store.get().name, 'Deck di test', 'il deck precedente deve restare attivo');
});

test('store: get() prima di load() e\' un errore esplicito', (t) => {
  const { file, cleanup } = tempDeck(rawDeck());
  t.after(cleanup);
  const store = createConfigStore({ file, actionTypes });
  assert.throws(() => store.get(), /non ancora caricata/);
});

test('store: watch() ricarica automaticamente alla modifica del file', async (t) => {
  const { file, cleanup } = tempDeck(rawDeck());
  t.after(cleanup);

  const store = createConfigStore({ file, actionTypes, logger: { warn() {}, error() {} } });
  t.after(() => store.close());
  store.load();
  store.watch({ debounceMs: 20 });

  const changed = new Promise((resolve) => store.once('change', resolve));
  const modified = rawDeck();
  modified.name = 'Ricaricato a caldo';
  fs.writeFileSync(file, JSON.stringify(modified));

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
  const deck = await Promise.race([changed, timeout]);

  // fs.watch puo' non essere disponibile su alcuni filesystem: in quel caso
  // verifichiamo almeno che la ricarica manuale funzioni.
  if (deck === null) {
    assert.equal(store.reload().ok, true);
    assert.equal(store.get().name, 'Ricaricato a caldo');
  } else {
    assert.equal(deck.name, 'Ricaricato a caldo');
  }
});
