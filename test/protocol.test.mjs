import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ENDPOINTS,
  LITE_FIELDS,
  LITE_MSG,
  LITE_FIELD_KEYS,
  LITE_MSG_KEYS,
  LITE_PROTOCOL_VERSION,
  MSG,
  PROTOCOL_VERSION,
  toLiteButton,
  toLitePage
} from '../shared/protocol.mjs';

test('protocollo: le versioni sono numeri interi positivi', () => {
  assert.ok(Number.isInteger(PROTOCOL_VERSION) && PROTOCOL_VERSION >= 1);
  assert.ok(Number.isInteger(LITE_PROTOCOL_VERSION) && LITE_PROTOCOL_VERSION >= 1);
});

test('protocollo: tutti gli endpoint iniziano con /', () => {
  for (const [name, value] of Object.entries(ENDPOINTS)) {
    assert.ok(value.startsWith('/'), `${name}: ${value}`);
  }
  assert.equal(new Set(Object.values(ENDPOINTS)).size, Object.keys(ENDPOINTS).length, 'endpoint duplicati');
});

test('protocollo: i tipi di messaggio full sono univoci', () => {
  assert.equal(new Set(Object.values(MSG)).size, Object.keys(MSG).length);
});

test('protocollo lite: chiavi di campo compatte e univoche', () => {
  assert.equal(new Set(LITE_FIELD_KEYS).size, LITE_FIELD_KEYS.length, 'chiavi lite duplicate');
  for (const key of LITE_FIELD_KEYS) {
    assert.equal(key.length, 1, `la chiave "${key}" deve essere di un solo carattere`);
  }
});

test('protocollo lite: tipi di messaggio compatti e univoci', () => {
  assert.equal(new Set(LITE_MSG_KEYS).size, LITE_MSG_KEYS.length, 'tipi lite duplicati');
  for (const key of LITE_MSG_KEYS) assert.equal(key.length, 1);
});

test('protocollo lite: toLiteButton comprime i campi essenziali', () => {
  const lite = toLiteButton({
    id: 'play',
    label: 'Play',
    row: 1,
    col: 2,
    color: '#112233',
    icon: 'play',
    action: { type: 'media', params: { key: 'playpause' } }
  });

  assert.equal(lite[LITE_FIELDS.id], 'play');
  assert.equal(lite[LITE_FIELDS.label], 'Play');
  assert.equal(lite[LITE_FIELDS.row], 1);
  assert.equal(lite[LITE_FIELDS.col], 2);
  assert.equal(lite[LITE_FIELDS.color], '#112233');
  assert.equal(lite[LITE_FIELDS.icon], 'play');
  assert.equal(lite[LITE_FIELDS.type], 'media');
  assert.equal(lite.params, undefined, 'i parametri non devono raggiungere il dispositivo');
});

test('protocollo lite: i campi opzionali assenti non vengono serializzati', () => {
  const lite = toLiteButton({ id: 'x', row: 0, col: 0, action: { type: 'noop' } });
  assert.equal(lite[LITE_FIELDS.label], '');
  assert.ok(!(LITE_FIELDS.color in lite));
  assert.ok(!(LITE_FIELDS.icon in lite));
});

test('protocollo lite: toLitePage produce un layout compatto e completo', () => {
  const page = {
    id: 'home',
    rows: 2,
    cols: 3,
    buttons: [
      { id: 'a', label: 'A', row: 0, col: 0, action: { type: 'noop' } },
      { id: 'b', label: 'B', row: 1, col: 2, action: { type: 'noop' } }
    ]
  };
  const lite = toLitePage(page, { profileId: 'main', dryRun: true, pages: ['home', 'due'] });

  assert.equal(lite[LITE_FIELDS.version], LITE_PROTOCOL_VERSION);
  assert.equal(lite[LITE_FIELDS.page], 'home');
  assert.equal(lite[LITE_FIELDS.profile], 'main');
  assert.equal(lite[LITE_FIELDS.rows], 2);
  assert.equal(lite[LITE_FIELDS.cols], 3);
  assert.equal(lite[LITE_FIELDS.dryRun], 1);
  assert.deepEqual(lite[LITE_FIELDS.pages], ['home', 'due']);
  assert.equal(lite[LITE_FIELDS.buttons].length, 2);
});

test('protocollo lite: il payload resta piccolo (adatto a un ESP32)', () => {
  const buttons = Array.from({ length: 15 }, (_, i) => ({
    id: `bottone-${i}`,
    label: `Etichetta ${i}`,
    row: Math.floor(i / 5),
    col: i % 5,
    color: '#123456',
    icon: 'play',
    action: { type: 'media' }
  }));
  const json = JSON.stringify(toLitePage({ id: 'home', rows: 3, cols: 5, buttons }, { profileId: 'main' }));
  assert.ok(json.length < 1400, `payload troppo grande: ${json.length} byte`);
});

test('protocollo lite: nessuna collisione fra tipi messaggio e nomi campo usati insieme', () => {
  // il campo "t" trasporta il tipo: non deve essere anche un tipo di messaggio ambiguo
  assert.equal(LITE_FIELDS.type, 't');
  assert.ok(!LITE_MSG_KEYS.includes(LITE_FIELDS.type));
  assert.equal(LITE_MSG.press, 'p');
});
