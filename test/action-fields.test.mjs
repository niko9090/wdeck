/**
 * Schema dei campi delle azioni: e' cio' che permette all'editor di mostrare un
 * form guidato invece di un box JSON. Se un'azione dichiara campi malformati,
 * l'editor disegnerebbe controlli rotti - meglio accorgersene qui.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDefaultRegistry } from '../src/host/actions/handlers/index.mjs';

const TIPI_VALIDI = new Set(['text', 'number', 'select', 'toggle', 'textarea', 'hotkey', 'profile', 'page']);

const registry = createDefaultRegistry();
const azioni = registry.list();

test('ogni azione espone un array "fields" e il flag "advanced"', () => {
  for (const a of azioni) {
    assert.ok(Array.isArray(a.fields), `${a.type}: fields deve essere un array`);
    assert.equal(typeof a.advanced, 'boolean', `${a.type}: advanced deve essere booleano`);
  }
});

test('ogni campo ha key, label e un tipo riconosciuto', () => {
  for (const a of azioni) {
    const chiavi = new Set();
    for (const f of a.fields) {
      assert.ok(f.key, `${a.type}: campo senza key`);
      assert.ok(!chiavi.has(f.key), `${a.type}: chiave duplicata "${f.key}"`);
      chiavi.add(f.key);
      assert.ok(f.label, `${a.type}/${f.key}: senza label`);
      assert.ok(TIPI_VALIDI.has(f.type), `${a.type}/${f.key}: tipo non valido "${f.type}"`);
    }
  }
});

test('i campi "select" hanno opzioni con value e label', () => {
  for (const a of azioni) {
    for (const f of a.fields) {
      if (f.type !== 'select') continue;
      assert.ok(Array.isArray(f.options) && f.options.length > 0, `${a.type}/${f.key}: select senza opzioni`);
      for (const o of f.options) {
        assert.ok('value' in o, `${a.type}/${f.key}: opzione senza value`);
        assert.ok('label' in o, `${a.type}/${f.key}: opzione senza label`);
      }
    }
  }
});

test('i limiti numerici sono coerenti (min <= max)', () => {
  for (const a of azioni) {
    for (const f of a.fields) {
      if (f.type !== 'number') continue;
      if (typeof f.min === 'number' && typeof f.max === 'number') {
        assert.ok(f.min <= f.max, `${a.type}/${f.key}: min ${f.min} > max ${f.max}`);
      }
    }
  }
});

test('le azioni senza campi semplici (sequence) sono marcate advanced', () => {
  const sequence = azioni.find((a) => a.type === 'sequence');
  assert.ok(sequence, 'azione sequence assente');
  assert.equal(sequence.fields.length, 0);
  assert.equal(sequence.advanced, true);
});

test('la maggior parte delle azioni ha almeno un campo guidato', () => {
  const conCampi = azioni.filter((a) => a.fields.length > 0).length;
  // noop e sequence sono le uniche legittimamente senza campi.
  assert.ok(conCampi >= azioni.length - 2, `solo ${conCampi}/${azioni.length} azioni hanno campi`);
});
