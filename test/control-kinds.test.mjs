/**
 * I tipi di comando: un deck non e' fatto di soli pulsanti.
 *
 * Qui si verifica cio' che sostiene manopole, rotelle, tavolette e quadranti:
 * l'elenco dei tipi, i campi che ogni tipo pretende, la larghezza predefinita,
 * il rifiuto delle pressioni sui comandi di sola lettura e i due messaggi
 * nuovi del protocollo (scarto e coppia).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTROL_KINDS, READONLY_KINDS, DELTA_KINDS, PAIR_KINDS,
  defaultSpan, validateDeck, normalizeDeck
} from '../src/host/config/schema.mjs';
import { compactDeck } from '../src/host/config/writer.mjs';
import { rawDeck } from '../tools/fixtures.mjs';

const TIPI = ['noop', 'media', 'hotkey', 'text', 'launch', 'navigate', 'sequence', 'delay'];

/** Deck con un solo controllo, del tipo e con i campi indicati. */
function conControllo(extra) {
  const deck = rawDeck();
  const page = deck.profiles[0].pages[0];
  page.buttons = [{
    id: 'prova',
    label: 'Prova',
    row: 0,
    col: 0,
    action: { type: 'noop', params: {} },
    ...extra
  }];
  return deck;
}

const esito = (deck) => validateDeck(deck, { actionTypes: TIPI });
const errori = (deck) => esito(deck).errors.map((e) => e.path + ': ' + e.message).join(' | ');

// ------------------------------------------------------------------ elenco

test('kinds: i quattro insiemi non si sovrappongono e stanno nell\u2019elenco', () => {
  for (const gruppo of [READONLY_KINDS, DELTA_KINDS, PAIR_KINDS]) {
    for (const k of gruppo) assert.ok(CONTROL_KINDS.includes(k), `"${k}" non e' un kind valido`);
  }
  for (const k of DELTA_KINDS) assert.equal(READONLY_KINDS.includes(k), false, `"${k}" non puo' essere anche di sola lettura`);
  for (const k of PAIR_KINDS) assert.equal(DELTA_KINDS.includes(k), false, `"${k}" non puo' mandare sia coppia sia scarto`);
});

test('kinds: un tipo inventato viene rifiutato', () => {
  const r = esito(conControllo({ kind: 'manopolone' }));
  assert.equal(r.valid, false);
  assert.ok(errori(conControllo({ kind: 'manopolone' })).includes('kind'));
});

// ------------------------------------------------------------------ larghezza

test('span: cursori, tavolette, matrici e grafici valgono due celle', () => {
  for (const k of ['slider', 'xy', 'pad', 'chart']) assert.equal(defaultSpan(k), 2, k);
  for (const k of ['button', 'encoder', 'jog', 'display']) assert.equal(defaultSpan(k), 1, k);
});

test('span: la larghezza predefinita e\u2019 la stessa in validazione e a runtime', () => {
  // Se i due valori divergessero, un controllo passerebbe il controllo di
  // sovrapposizione e poi sfonderebbe la griglia a runtime.
  const deck = conControllo({ kind: 'xy' });
  assert.equal(esito(deck).valid, true, errori(deck));
  assert.equal(normalizeDeck(deck).profiles[0].pages[0].buttons[0].span, defaultSpan('xy'));
});

// ------------------------------------------------------------------ intervalli

test('encoder: ammette decimali e negativi (0.5 gradi, -5 EV)', () => {
  const deck = conControllo({ kind: 'encoder', min: -5, max: 5, step: 0.3 });
  assert.equal(esito(deck).valid, true, errori(deck));
});

test('intervallo: max deve superare min, e il passo deve essere positivo', () => {
  assert.equal(esito(conControllo({ kind: 'slider', min: 10, max: 10 })).valid, false);
  assert.equal(esito(conControllo({ kind: 'encoder', step: 0 })).valid, false);
});

// ------------------------------------------------------------------ campi per tipo

test('selector: senza almeno due opzioni non e\u2019 un selettore', () => {
  assert.equal(esito(conControllo({ kind: 'selector' })).valid, false);
  assert.equal(esito(conControllo({ kind: 'selector', options: ['Solo'] })).valid, false);
  const ok = conControllo({ kind: 'selector', options: ['Auto', 'Manuale', 'Fermo'] });
  assert.equal(esito(ok).valid, true, errori(ok));
  assert.deepEqual(normalizeDeck(ok).profiles[0].pages[0].buttons[0].options, ['Auto', 'Manuale', 'Fermo']);
});

test('pad, timer, color: hanno valori predefiniti sensati', () => {
  const norm = (extra) => normalizeDeck(conControllo(extra)).profiles[0].pages[0].buttons[0];
  const pad = norm({ kind: 'pad' });
  assert.equal(pad.rows, 4);
  assert.equal(pad.cols, 4);
  assert.equal(norm({ kind: 'timer' }).seconds, 1500);
  assert.equal(norm({ kind: 'color' }).mode, 'kelvin');
});

test('slider: orientamento e centro sono normalizzati', () => {
  const b = normalizeDeck(conControllo({ kind: 'slider', orientation: 'v', center: true })).profiles[0].pages[0].buttons[0];
  assert.equal(b.orientation, 'v');
  assert.equal(b.center, true);
  assert.equal(esito(conControllo({ kind: 'slider', orientation: 'diagonale' })).valid, false);
});

test('i campi di un tipo non finiscono addosso agli altri', () => {
  // Un pulsante non deve portarsi dietro min/max/options: il file resta pulito
  // e il client non deve indovinare cosa e' inerte.
  const b = normalizeDeck(conControllo({ kind: 'button' })).profiles[0].pages[0].buttons[0];
  for (const k of ['min', 'max', 'step', 'options', 'rows', 'cols', 'seconds', 'mode', 'orientation']) {
    assert.equal(k in b, false, `un pulsante non deve avere "${k}"`);
  }
});

// ------------------------------------------------------------------ sola lettura

test('sola lettura: niente hold, niente rilascio, niente conferma', () => {
  for (const kind of READONLY_KINDS) {
    assert.equal(esito(conControllo({ kind, holdAction: { type: 'noop', params: {} } })).valid, false, kind);
    assert.equal(esito(conControllo({ kind, releaseAction: { type: 'noop', params: {} } })).valid, false, kind);
    assert.equal(esito(conControllo({ kind, confirm: true })).valid, false, kind);
    assert.equal(esito(conControllo({ kind })).valid, true, kind);
  }
});

// ------------------------------------------------------------------ salvataggio

test('i campi dei tipi nuovi sopravvivono al salvataggio su deck.json', () => {
  const deck = normalizeDeck(conControllo({
    kind: 'encoder', min: 15, max: 30, step: 0.5
  }));
  const b = compactDeck(deck).profiles[0].pages[0].buttons[0];
  assert.equal(b.kind, 'encoder');
  assert.equal(b.min, 15);
  assert.equal(b.step, 0.5);

  const sel = compactDeck(normalizeDeck(conControllo({ kind: 'selector', options: ['A', 'B'] })))
    .profiles[0].pages[0].buttons[0];
  assert.deepEqual(sel.options, ['A', 'B']);
});
