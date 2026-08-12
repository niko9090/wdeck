import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../src/host/state.mjs';
import { makeDeck } from '../tools/fixtures.mjs';

test('state: valori iniziali presi dal deck', () => {
  const state = createState(makeDeck());
  assert.equal(state.activeProfileId, 'main');
  assert.equal(state.activePageId, 'home');
  assert.equal(state.dryRun, true);
  assert.equal(state.pressCount, 0);
  assert.equal(state.lastAction, null);
  assert.equal(state.page.id, 'home');
  assert.equal(state.profile.id, 'main');
});

test('state: navigate cambia pagina ed emette l\'evento', () => {
  const state = createState(makeDeck());
  const eventi = [];
  state.on('navigate', (snap) => eventi.push(snap.activePage));

  const applied = state.navigate(undefined, 'due');
  assert.deepEqual(applied, { profileId: 'main', pageId: 'due' });
  assert.equal(state.activePageId, 'due');
  assert.deepEqual(eventi, ['due']);

  // navigare sulla stessa pagina non riemette l'evento
  state.navigate(undefined, 'due');
  assert.equal(eventi.length, 1);
});

test('state: navigate verso target sconosciuti fallisce', () => {
  const state = createState(makeDeck());
  assert.throws(() => state.navigate('fantasma'), /profilo sconosciuto/);
  assert.throws(() => state.navigate(undefined, 'fantasma'), /pagina sconosciuta/);
  assert.equal(state.activePageId, 'home', 'lo stato non deve cambiare');
});

test('state: cambiando profilo si passa alla sua pagina predefinita', () => {
  const deck = makeDeck();
  deck.profiles.push({
    id: 'secondo',
    name: 'Secondo',
    defaultPage: 'unica',
    pages: [{ id: 'unica', name: 'Unica', rows: 1, cols: 1, buttons: [] }]
  });
  const state = createState(deck);
  const applied = state.navigate('secondo');
  assert.deepEqual(applied, { profileId: 'secondo', pageId: 'unica' });
});

test('state: recordPress aggiorna contatore e ultima azione', () => {
  const state = createState(makeDeck());
  const eventi = [];
  state.on('press', (entry) => eventi.push(entry));

  state.recordPress({ buttonId: 'play', type: 'media', ok: true, dryRun: true, detail: 'simulato' });
  assert.equal(state.pressCount, 1);
  assert.equal(state.lastAction.buttonId, 'play');
  assert.equal(state.lastAction.ok, true);
  assert.ok(state.lastAction.at > 0);
  assert.equal(eventi.length, 1);

  state.recordPress({ buttonId: 'copy', type: 'hotkey', ok: false, dryRun: true, error: { message: 'ko' } });
  assert.equal(state.pressCount, 2);
  assert.equal(state.lastAction.buttonId, 'copy');
  assert.equal(state.lastAction.ok, false);
});

test('state: gestione dei client collegati', () => {
  const state = createState(makeDeck());
  const clientA = { id: 'a' };
  const clientB = { id: 'b' };

  state.addClient(clientA);
  state.addClient(clientB);
  assert.equal(state.snapshot().clients, 2);

  state.removeClient(clientA);
  assert.equal(state.snapshot().clients, 1);

  // rimuovere due volte non altera il conteggio
  state.removeClient(clientA);
  assert.equal(state.snapshot().clients, 1);
});

test('state: setDryRun emette solo al cambio', () => {
  const state = createState(makeDeck());
  let emissioni = 0;
  state.on('state', () => { emissioni += 1; });

  state.setDryRun(true);
  assert.equal(emissioni, 0, 'nessun cambiamento');

  state.setDryRun(false);
  assert.equal(state.dryRun, false);
  assert.equal(emissioni, 1);
});

test('state: replaceDeck conserva pagina e profilo se esistono ancora', () => {
  const state = createState(makeDeck());
  state.navigate(undefined, 'due');

  const nuovo = makeDeck();
  nuovo.name = 'Nuovo deck';
  state.replaceDeck(nuovo);

  assert.equal(state.deck.name, 'Nuovo deck');
  assert.equal(state.activePageId, 'due');
  assert.equal(state.activeProfileId, 'main');
});

test('state: replaceDeck ripiega sui default se la pagina sparisce', () => {
  const state = createState(makeDeck());
  state.navigate(undefined, 'due');

  const ridotto = makeDeck();
  ridotto.profiles[0].pages = ridotto.profiles[0].pages.filter((p) => p.id === 'home');
  state.replaceDeck(ridotto);

  assert.equal(state.activePageId, 'home');
});

test('state: snapshot e\' serializzabile e completo', () => {
  const state = createState(makeDeck());
  const snap = state.snapshot();
  assert.deepEqual(Object.keys(snap).sort(), [
    'activePage', 'activeProfile', 'clients', 'deckName', 'dryRun',
    'lastAction', 'platform', 'pressCount', 'uptimeMs'
  ]);
  assert.doesNotThrow(() => JSON.stringify(snap));
});
