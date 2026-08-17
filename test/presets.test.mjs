/**
 * Libreria dei preset (bottoni pronti dell'editor). Un preset che punta a
 * un'azione inesistente o con parametri non validi darebbe all'utente, al primo
 * clic, un bottone rotto: meglio accorgersene qui.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PRESETS } from '../web/presets.js';
import { ICONS } from '../web/icons.js';
import { createDefaultRegistry } from '../src/host/actions/handlers/index.mjs';

const registry = createDefaultRegistry();

test('ogni preset ha id, icona nota e azione', () => {
  const visti = new Set();
  for (const p of PRESETS) {
    assert.ok(p.id, 'preset senza id');
    assert.ok(!visti.has(p.id), `id preset duplicato: ${p.id}`);
    visti.add(p.id);
    assert.ok(p.icon in ICONS, `${p.id}: icona sconosciuta "${p.icon}"`);
    assert.ok(p.action && typeof p.action.type === 'string', `${p.id}: azione mancante`);
  }
});

test('ogni preset punta a un\'azione registrata con parametri validi', () => {
  for (const p of PRESETS) {
    assert.ok(registry.has(p.action.type), `${p.id}: azione non registrata "${p.action.type}"`);
    const handler = registry.get(p.action.type);
    assert.doesNotThrow(
      () => handler.validate(p.action.params ?? {}),
      `${p.id}: parametri non validi per ${p.action.type}`
    );
  }
});

test('esiste un numero ragionevole di preset', () => {
  assert.ok(PRESETS.length >= 6, `solo ${PRESETS.length} preset`);
});
