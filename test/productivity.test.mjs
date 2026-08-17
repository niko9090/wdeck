import test from 'node:test';
import assert from 'node:assert/strict';

import { folderAction } from '../src/host/actions/handlers/productivity.mjs';

test('folder: le shell: location note sono ammesse', () => {
  assert.doesNotThrow(() => folderAction.validate({ path: 'shell:Downloads' }));
  assert.doesNotThrow(() => folderAction.validate({ path: 'shell:Desktop' }));
  assert.doesNotThrow(() => folderAction.validate({ path: 'SHELL:Pictures' }));
});

test('folder: le shell: location arbitrarie o CLSID sono rifiutate', () => {
  assert.throws(() => folderAction.validate({ path: 'shell:::{645FF040-5081-101B-9F08-00AA002F954E}' }), /non consentita/);
  assert.throws(() => folderAction.validate({ path: 'shell:AppsFolder' }), /non consentita/);
  assert.throws(() => folderAction.validate({ path: 'shell:' }), /non consentita/);
});

test('folder: un percorso normale supera la validazione', () => {
  assert.doesNotThrow(() => folderAction.validate({ path: 'C:\\Users\\tizio\\Documenti' }));
  assert.throws(() => folderAction.validate({ path: '' }), /mancante/);
  assert.throws(() => folderAction.validate({ path: 42 }), /mancante/);
});
