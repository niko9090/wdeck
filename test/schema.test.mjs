import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDeck, normalizeDeck, DEFAULT_SETTINGS } from '../src/host/config/schema.mjs';
import { createDefaultRegistry } from '../src/host/actions/handlers/index.mjs';
import { rawDeck } from '../tools/fixtures.mjs';

const actionTypes = createDefaultRegistry().types();
const validate = (deck) => validateDeck(deck, { actionTypes });
const pathsOf = (result) => result.errors.map((e) => e.path);

test('schema: la fixture di riferimento e\' valida', () => {
  const result = validate(rawDeck());
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.errors.length, 0);
});

test('schema: il deck di produzione deck.json e\' valido', async () => {
  const { readFileSync } = await import('node:fs');
  const deck = JSON.parse(readFileSync(new URL('../deck.json', import.meta.url), 'utf8'));
  const result = validate(deck);
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
});

test('schema: rifiuta un input che non e\' un oggetto', () => {
  for (const input of [null, 42, 'testo', [], undefined]) {
    assert.equal(validate(input).valid, false, `accettato: ${JSON.stringify(input)}`);
  }
});

test('schema: version obbligatoria e pari a 1', () => {
  assert.deepEqual(pathsOf(validate({ ...rawDeck(), version: undefined })), ['version']);
  assert.deepEqual(pathsOf(validate({ ...rawDeck(), version: 2 })), ['version']);
  assert.deepEqual(pathsOf(validate({ ...rawDeck(), version: '1' })), ['version']);
});

test('schema: serve almeno un profilo con almeno una pagina', () => {
  assert.equal(validate({ ...rawDeck(), profiles: [] }).valid, false);
  assert.equal(validate({ ...rawDeck(), profiles: 'no' }).valid, false);

  const deck = rawDeck();
  deck.profiles[0].pages = [];
  const result = validate(deck);
  assert.equal(result.valid, false);
  assert.ok(pathsOf(result).includes('profiles[0].pages'));
});

test('schema: gli id devono essere slug minuscoli', () => {
  const deck = rawDeck();
  deck.profiles[0].id = 'Profilo Sbagliato';
  const result = validate(deck);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === 'profiles[0].id' && /formato non valido/.test(e.message)));
});

test('schema: gli id dei bottoni sono univoci in tutto il deck', () => {
  const deck = rawDeck();
  deck.profiles[0].pages[1].buttons[0].id = 'play';
  const result = validate(deck);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /duplicato/.test(e.message)), JSON.stringify(result.errors));
});

test('schema: due bottoni non possono occupare la stessa cella', () => {
  const deck = rawDeck();
  deck.profiles[0].pages[0].buttons[1].row = 0;
  deck.profiles[0].pages[0].buttons[1].col = 0;
  const result = validate(deck);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /gia' occupata/.test(e.message)), JSON.stringify(result.errors));
});

test('schema: i bottoni devono stare dentro la griglia', () => {
  const deck = rawDeck();
  deck.profiles[0].pages[0].buttons[0].col = 5; // cols = 3
  const result = validate(deck);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /fuori dalla griglia/.test(e.message)));
});

test('schema: rows/cols entro i limiti', () => {
  const tooMany = rawDeck();
  tooMany.profiles[0].pages[0].rows = 99;
  assert.equal(validate(tooMany).valid, false);

  const zero = rawDeck();
  zero.profiles[0].pages[0].cols = 0;
  assert.equal(validate(zero).valid, false);
});

test('schema: il tipo di azione deve essere registrato', () => {
  const deck = rawDeck();
  deck.profiles[0].pages[0].buttons[0].action.type = 'teletrasporto';
  const result = validate(deck);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /tipo azione sconosciuto/.test(e.message)));

  // senza elenco di tipi il controllo viene saltato
  assert.equal(validateDeck(deck).valid, true);
});

test('schema: le sequence richiedono steps non vuoti', () => {
  const deck = rawDeck();
  deck.profiles[0].pages[1].buttons[0].action.params.steps = [];
  assert.equal(validate(deck).valid, false);
});

test('schema: i target di navigate devono esistere', () => {
  const deck = rawDeck();
  deck.profiles[0].pages[0].buttons[5].action.params.page = 'inesistente';
  const result = validate(deck);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /pagina di destinazione/.test(e.message)));

  const deck2 = rawDeck();
  deck2.profiles[0].pages[0].buttons[5].action.params.profile = 'fantasma';
  assert.equal(validate(deck2).valid, false);
});

test('schema: defaultProfile e defaultPage devono esistere', () => {
  assert.equal(validate({ ...rawDeck(), defaultProfile: 'assente' }).valid, false);
  const deck = rawDeck();
  deck.profiles[0].defaultPage = 'assente';
  assert.equal(validate(deck).valid, false);
});

test('schema: validazione dei parametri di sicurezza', () => {
  const shortToken = rawDeck();
  shortToken.settings.security.token = 'corto';
  assert.equal(validate(shortToken).valid, false);

  const badPin = rawDeck();
  badPin.settings.security.pin = 'abcd';
  assert.equal(validate(badPin).valid, false);

  const badExt = rawDeck();
  badExt.settings.security.allowedExtensions = ['exe'];
  assert.equal(validate(badExt).valid, false);

  const badPort = rawDeck();
  badPort.settings.server.port = 99999;
  assert.equal(validate(badPort).valid, false);

  const badTheme = rawDeck();
  badTheme.settings.ui = { theme: 'neon' };
  assert.equal(validate(badTheme).valid, false);

  const badColor = rawDeck();
  badColor.profiles[0].pages[0].buttons[0].color = 'blu';
  assert.equal(validate(badColor).valid, false);
});

test('schema: avviso quando il token manca ma e\' richiesto', () => {
  const deck = rawDeck();
  delete deck.settings.security.token;
  const result = validate(deck);
  assert.equal(result.valid, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].path, /token/);
});

test('normalizeDeck: applica i default e completa i campi opzionali', () => {
  const deck = rawDeck();
  delete deck.settings.ui;
  delete deck.profiles[0].defaultPage;
  deck.profiles[0].pages[0].buttons[0].label = undefined;

  const normalized = normalizeDeck(deck);
  assert.equal(normalized.settings.ui.theme, DEFAULT_SETTINGS.ui.theme);
  assert.equal(normalized.settings.ui.accent, DEFAULT_SETTINGS.ui.accent);
  assert.equal(normalized.profiles[0].defaultPage, 'home');
  assert.equal(normalized.profiles[0].pages[0].buttons[0].label, '');
  assert.deepEqual(normalized.profiles[0].pages[0].buttons[0].action.params, { key: 'playpause' });
  assert.equal(normalized.profiles[0].pages[0].buttons[0].icon, null);
  assert.equal(normalized.profiles[0].pages[0].buttons[0].holdAction, null);
});

test('normalizeDeck: non altera l\'oggetto di partenza', () => {
  const deck = rawDeck();
  const before = JSON.stringify(deck);
  normalizeDeck(deck);
  assert.equal(JSON.stringify(deck), before);
});
