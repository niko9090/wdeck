import test from 'node:test';
import assert from 'node:assert/strict';

import { obsAction, hueAction } from '../src/host/actions/handlers/integrations.mjs';

test('obs toggle-source: un bottone con scene + itemId supera la validazione', () => {
  assert.doesNotThrow(() => obsAction.validate({ command: 'toggle-source', scene: 'Scena', itemId: 3 }));
  // itemId puo' valere 0 (id di elemento valido): non deve essere scambiato per assente.
  assert.doesNotThrow(() => obsAction.validate({ command: 'toggle-source', scene: 'Scena', itemId: 0 }));
});

test('obs toggle-source: senza scene o itemId la validazione fallisce', () => {
  assert.throws(() => obsAction.validate({ command: 'toggle-source', source: 'Cam' }), /scene/);
  assert.throws(() => obsAction.validate({ command: 'toggle-source', scene: 'Scena' }), /itemId/);
  assert.throws(() => obsAction.validate({ command: 'toggle-source' }), /scene/);
});

test('hue: hue e saturation fuori intervallo vengono rifiutati', () => {
  assert.doesNotThrow(() => hueAction.validate({ id: 1, hue: 30000, saturation: 200 }));
  assert.throws(() => hueAction.validate({ id: 1, hue: 70000 }), /hue/);
  assert.throws(() => hueAction.validate({ id: 1, hue: -1 }), /hue/);
  assert.throws(() => hueAction.validate({ id: 1, saturation: 300 }), /saturation/);
  assert.throws(() => hueAction.validate({ id: 1, saturation: -5 }), /saturation/);
});

test('hue: id deve essere un intero positivo, mai un frammento di percorso', () => {
  assert.doesNotThrow(() => hueAction.validate({ id: 2 }));
  assert.doesNotThrow(() => hueAction.validate({ id: '2' }));
  assert.throws(() => hueAction.validate({ id: '1/config' }), /id/);
  assert.throws(() => hueAction.validate({ id: 0 }), /id/);
  assert.throws(() => hueAction.validate({ id: -1 }), /id/);
  assert.throws(() => hueAction.validate({ id: 1.5 }), /id/);
});
