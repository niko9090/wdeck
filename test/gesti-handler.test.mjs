/**
 * Cosa fanno gli handler quando arriva un GESTO e non una pressione.
 *
 * Lo scarto (`delta`) e la coppia (`x`/`y`) entrano nei parametri dal
 * dispatcher; qui si verifica che gli handler li usino davvero, invece di
 * lasciarli cadere e rifare il gesto scritto nell'editor.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { hotkeyAction, mouseAction } from '../src/host/actions/handlers/input.mjs';

const DRY = { dryRun: true };

// ------------------------------------------------------------------- mouse

test('mouse: lo scarto di una manopola diventa scorrimento, il segno da’ il verso', async () => {
  assert.match(mouseAction.describe({ command: 'left', delta: 3 }), /scroll-up x3/);
  assert.match(mouseAction.describe({ command: 'left', delta: -2 }), /scroll-down x2/);
  const su = await mouseAction.run({ command: 'left', delta: 4 }, DRY);
  assert.match(su.detail, /scorri su x4/);
});

test('mouse: il gesto ha la precedenza sul comando scritto nell’editor', () => {
  // Chi appoggia il dito su una tavoletta si aspetta che il puntatore vada
  // li', non che parta il clic sinistro rimasto come valore predefinito.
  assert.match(mouseAction.describe({ command: 'left', x: 25, y: 75 }), /sposta a 25%, 75%/);
});

test('mouse: senza gesto resta il comando di sempre', async () => {
  assert.equal(mouseAction.describe({ command: 'double' }), 'mouse: double');
  const out = await mouseAction.run({ command: 'double' }, DRY);
  assert.match(out.detail, /doppio clic/);
});

test('mouse: mezza coppia e’ un errore, non una posizione inventata', () => {
  assert.throws(() => mouseAction.validate({ command: 'left', x: 10 }), /vanno insieme/);
  assert.throws(() => mouseAction.validate({ command: 'left', y: 10 }), /vanno insieme/);
  assert.doesNotThrow(() => mouseAction.validate({ command: 'left', x: 10, y: 90 }));
});

test('mouse: le coordinate stanno fra 0 e 100 e lo scarto e’ un numero', () => {
  assert.throws(() => mouseAction.validate({ command: 'left', x: 101, y: 0 }), /"x"/);
  assert.throws(() => mouseAction.validate({ command: 'left', x: 0, y: -1 }), /"y"/);
  assert.throws(() => mouseAction.validate({ command: 'left', delta: 'tanto' }), /"delta"/);
});

test('mouse: "sposta" configurato a mano pretende il punto', () => {
  assert.throws(() => mouseAction.validate({ command: 'move' }), /richiede i parametri/);
  assert.doesNotThrow(() => mouseAction.validate({ command: 'move', x: 50, y: 50 }));
});

test('mouse: un comando inventato viene rifiutato anche adesso', () => {
  assert.throws(() => mouseAction.validate({ command: 'grattugia' }), /"command"/);
});

// ------------------------------------------------------------------ hotkey

test('hotkey: ogni scatto della manopola e’ un invio', () => {
  assert.equal(hotkeyAction.describe({ keys: 'ctrl+z', delta: 3 }), 'hotkey "ctrl+z" x3');
  // Uno scatto quasi nullo manda comunque una volta: la manopola deve muovere.
  assert.equal(hotkeyAction.describe({ keys: 'ctrl+z', delta: 0.2 }), 'hotkey "ctrl+z"');
  // Tetto a 20, come per "repeat".
  assert.equal(hotkeyAction.describe({ keys: 'ctrl+z', delta: 500 }), 'hotkey "ctrl+z" x20');
});

test('hotkey: girando indietro parte la combinazione opposta, se c’e’', () => {
  const p = { keys: 'ctrl+plus', keysBack: 'ctrl+minus' };
  assert.match(hotkeyAction.describe({ ...p, delta: 2 }), /"ctrl\+plus" x2/);
  assert.match(hotkeyAction.describe({ ...p, delta: -2 }), /"ctrl\+minus" x2/);
  // Senza il verso opposto la manopola ripete la stessa combinazione.
  assert.match(hotkeyAction.describe({ keys: 'ctrl+plus', delta: -2 }), /"ctrl\+plus" x2/);
});

test('hotkey: senza scarto niente cambia', () => {
  assert.equal(hotkeyAction.describe({ keys: 'win+d' }), 'hotkey "win+d"');
  assert.equal(hotkeyAction.describe({ keys: 'win+d', repeat: 3 }), 'hotkey "win+d" x3');
});

test('hotkey: anche la combinazione all’indietro viene validata', () => {
  assert.throws(() => hotkeyAction.validate({ keys: 'ctrl+plus', keysBack: 'ctrl+bofonchio' }));
  assert.doesNotThrow(() => hotkeyAction.validate({ keys: 'ctrl+plus', keysBack: 'ctrl+minus' }));
  // Vuota o assente va bene: e' un campo facoltativo.
  assert.doesNotThrow(() => hotkeyAction.validate({ keys: 'ctrl+plus', keysBack: '' }));
});
