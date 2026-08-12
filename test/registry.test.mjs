import test from 'node:test';
import assert from 'node:assert/strict';

import { createRegistry } from '../src/host/actions/registry.mjs';
import { createDefaultRegistry, builtinHandlers } from '../src/host/actions/handlers/index.mjs';

const dummy = (type = 'demo') => ({
  type,
  title: 'Demo',
  async run() {
    return { ok: true, detail: 'fatto' };
  }
});

test('registry: registra e recupera un handler', () => {
  const registry = createRegistry();
  registry.register(dummy());
  assert.equal(registry.has('demo'), true);
  assert.equal(registry.get('demo').type, 'demo');
  assert.equal(registry.size, 1);
});

test('registry: applica i valori di default agli handler', () => {
  const registry = createRegistry();
  registry.register(dummy());
  const handler = registry.get('demo');
  assert.deepEqual(handler.platforms, ['*']);
  assert.equal(typeof handler.validate, 'function');
  assert.equal(typeof handler.describe, 'function');
  assert.doesNotThrow(() => handler.validate({}));
});

test('registry: rifiuta handler malformati', () => {
  const registry = createRegistry();
  assert.throws(() => registry.register(null), TypeError);
  assert.throws(() => registry.register({}), /manca la proprieta'/);
  assert.throws(() => registry.register({ type: 'x' }), /manca la proprieta'/);
  assert.throws(() => registry.register({ type: 'Maiuscolo', run() {} }), /tipo azione non valido/);
  assert.throws(() => registry.register({ type: 'ok', run: 'non-funzione' }), /deve essere una funzione/);
});

test('registry: rifiuta la doppia registrazione senza override', () => {
  const registry = createRegistry();
  registry.register(dummy());
  assert.throws(() => registry.register(dummy()), /gia' registrata/);
  assert.doesNotThrow(() => registry.register({ ...dummy(), title: 'Nuovo' }, { override: true }));
  assert.equal(registry.get('demo').title, 'Nuovo');
});

test('registry: get() su tipo sconosciuto elenca i tipi disponibili', () => {
  const registry = createRegistry();
  registry.register(dummy());
  assert.throws(() => registry.get('assente'), /azione sconosciuta: "assente".*demo/s);
});

test('registry: unregister rimuove l\'handler', () => {
  const registry = createRegistry();
  registry.register(dummy());
  assert.equal(registry.unregister('demo'), true);
  assert.equal(registry.unregister('demo'), false);
  assert.equal(registry.has('demo'), false);
});

test('registry: types() e list() sono ordinati e serializzabili', () => {
  const registry = createRegistry();
  registry.register(dummy('zeta'));
  registry.register(dummy('alfa'));
  assert.deepEqual(registry.types(), ['alfa', 'zeta']);
  const list = registry.list();
  assert.equal(list.length, 2);
  assert.deepEqual(Object.keys(list[0]).sort(), ['description', 'paramsHelp', 'platforms', 'stub', 'title', 'type']);
  assert.doesNotThrow(() => JSON.stringify(list));
});

test('registry: supportsPlatform rispetta il campo platforms', () => {
  const registry = createRegistry();
  registry.register({ ...dummy('ovunque'), platforms: ['*'] });
  registry.register({ ...dummy('solo-win'), platforms: ['win32'] });
  assert.equal(registry.supportsPlatform('ovunque', 'linux'), true);
  assert.equal(registry.supportsPlatform('solo-win', 'linux'), false);
  assert.equal(registry.supportsPlatform('solo-win', 'win32'), true);
});

test('registry predefinito: contiene tutte le azioni documentate', () => {
  const registry = createDefaultRegistry();
  const expected = ['delay', 'hotkey', 'http', 'launch', 'media', 'navigate', 'noop', 'script', 'sequence', 'stub', 'text', 'url'];
  assert.deepEqual(registry.types(), expected);
  assert.equal(registry.size, builtinHandlers.length);
});

test('registry predefinito: accetta handler aggiuntivi (plugin)', () => {
  const registry = createDefaultRegistry({ extra: [dummy('plugin-demo')] });
  assert.equal(registry.has('plugin-demo'), true);
  assert.ok(registry.types().includes('media'));
});

test('registry predefinito: ogni handler dichiara metadati utilizzabili', () => {
  const registry = createDefaultRegistry();
  for (const info of registry.list()) {
    assert.ok(info.title.length > 0, `${info.type}: title mancante`);
    assert.ok(info.description.length > 0, `${info.type}: description mancante`);
    assert.ok(Array.isArray(info.platforms) && info.platforms.length > 0, `${info.type}: platforms mancante`);
  }
});

test('registry predefinito: solo "stub" e\' marcata come non implementata', () => {
  const registry = createDefaultRegistry();
  const stubs = registry.list().filter((a) => a.stub).map((a) => a.type);
  assert.deepEqual(stubs, ['stub']);
});
