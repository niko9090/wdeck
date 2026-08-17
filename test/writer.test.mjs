/**
 * Scrittura di deck.json dall'editor.
 *
 * L'editor non deve poter toccare `settings.security` (token, allowExec, dryRun):
 * quel blocco ha endpoint dedicati. E un input malformato deve uscire come errore
 * di validazione, non come eccezione: chi salva merita un messaggio, non un 500.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { mergeDeckUpdate, saveDeck } from '../src/host/config/writer.mjs';
import { createDefaultRegistry } from '../src/host/actions/handlers/index.mjs';
import { rawDeck } from '../tools/fixtures.mjs';

const actionTypes = createDefaultRegistry().types();

// ---------------------------------------------------------------- sicurezza

test('merge: la sicurezza in arrivo viene ignorata quando su disco esiste', () => {
  const current = {
    version: 1,
    settings: { security: { requireToken: true, token: 'segreto-vero-123456', allowExec: ['ok'] } },
    profiles: []
  };
  const incoming = {
    version: 1,
    settings: { security: { requireToken: false, token: 'iniettato', allowExec: ['C:\\evil.exe'], dryRun: false } }
  };
  const merged = mergeDeckUpdate(current, incoming);
  // Sopravvive solo il blocco su disco, immutato.
  assert.deepEqual(merged.settings.security, current.settings.security);
});

test('merge: la sicurezza in arrivo viene ignorata anche senza blocco su disco', () => {
  // deck.json minimale: nessuna security su disco. Il client ne spedisce una: va
  // scartata comunque, non ereditata.
  const current = { version: 1, settings: {}, profiles: [] };
  const incoming = {
    version: 1,
    settings: { security: { token: 'iniettato', allowExec: ['C:\\evil.exe'], requireToken: false } }
  };
  const merged = mergeDeckUpdate(current, incoming);
  assert.equal(merged.settings.security, undefined, 'nessuna security deve comparire dal nulla');
});

// ---------------------------------------------------------------- validazione

test('save: un deck malformato da un errore di validazione, non un throw', () => {
  const current = rawDeck();
  // Un profilo senza "pages": prima della correzione compactDeck ci faceva .map
  // sopra e lanciava una TypeError.
  const incoming = { profiles: [{ id: 'rotto', name: 'Rotto' }] };

  const configPath = path.join(os.tmpdir(), `wdeck-mai-scritto-${process.pid}.json`);
  let esito;
  assert.doesNotThrow(() => {
    esito = saveDeck({ configPath, current, incoming, actionTypes });
  });
  assert.equal(esito.ok, false);
  assert.ok(Array.isArray(esito.errors) && esito.errors.length > 0);
  assert.ok(esito.errors.some((e) => /pages/.test(e.path)), 'atteso un errore sul campo pages');
  assert.equal(fs.existsSync(configPath), false, 'un deck non valido non deve essere scritto');
});
