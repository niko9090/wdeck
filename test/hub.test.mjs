import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createHub } from '../src/host/server/hub.mjs';
import { ENDPOINTS, MSG, LITE_MSG, LITE_FIELDS, ERROR_CODES } from '../shared/protocol.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {}, log() {} };

/** Stato finto: solo cio' che l'hub tocca durante una pressione. */
function fakeState() {
  const state = new EventEmitter();
  state.activeProfileId = 'p1';
  state.activePageId = 'pg1';
  state.dryRun = true;
  state.snapshot = () => ({ activeProfile: 'p1', activePage: 'pg1' });
  state.addClient = () => {};
  state.removeClient = () => {};
  state.navigate = () => ({});
  return state;
}

/** Host finto con un dispatcher.press che rigetta sempre. */
function fakeHost() {
  const deck = {
    version: 1,
    name: 'test',
    defaultProfile: 'p1',
    profiles: [{ id: 'p1', pages: [{ id: 'pg1', buttons: [] }] }],
    settings: { server: { publicName: 'Test' }, ui: {}, integrations: {} }
  };
  return {
    auth: { required: false, verifyRequest: () => ({ ok: true }), identify: () => ({ ok: true }) },
    state: fakeState(),
    dispatcher: { press: async () => { throw new Error('dispatch esplosa'); } },
    configStore: { get: () => deck },
    logger: silent,
    limits: {
      checkPress: () => ({ allowed: true }),
      checkAuth: () => ({ allowed: true }),
      clearAuth: () => {}
    },
    status: { snapshot: () => ({}), refresh: async () => {} }
  };
}

/** Connessione finta: raccoglie i messaggi inviati. */
class FakeConn extends EventEmitter {
  constructor() {
    super();
    this.data = {};
    this.sent = [];
  }

  send(msg) { this.sent.push(msg); }

  close() {}
}

const req = { url: ENDPOINTS.ws, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
const flush = () => new Promise((r) => setTimeout(r, 20));

test('hub: un dispatcher.press che rigetta produce un errore, non una unhandledRejection (full)', async () => {
  let rejection = null;
  const onReject = (err) => { rejection = err; };
  process.on('unhandledRejection', onReject);

  const hub = createHub(fakeHost());
  const conn = new FakeConn();
  hub.routes[ENDPOINTS.ws](conn, req);
  assert.equal(conn.data.authenticated, true, 'pre-autenticato dal verifyRequest finto');

  conn.emit('message', JSON.stringify({ type: MSG.press, buttonId: 'x', requestId: 7 }));
  await flush();

  const errore = conn.sent.find((m) => m.type === MSG.error);
  assert.ok(errore, 'deve arrivare un messaggio di errore');
  assert.equal(errore.code, ERROR_CODES.internal);
  assert.equal(errore.requestId, 7, 'il requestId deve essere preservato');
  assert.equal(rejection, null, 'nessuna promise rifiutata deve sfuggire');

  process.off('unhandledRejection', onReject);
});

test('hub: un dispatcher.press che rigetta produce un errore, non una unhandledRejection (lite)', async () => {
  let rejection = null;
  const onReject = (err) => { rejection = err; };
  process.on('unhandledRejection', onReject);

  const hub = createHub(fakeHost());
  const conn = new FakeConn();
  hub.routes[ENDPOINTS.wsLite](conn, { ...req, url: ENDPOINTS.wsLite });

  conn.emit('message', JSON.stringify({ [LITE_FIELDS.type]: LITE_MSG.press, [LITE_FIELDS.id]: 'x' }));
  await flush();

  const errore = conn.sent.find((m) => m[LITE_FIELDS.type] === LITE_MSG.error);
  assert.ok(errore, 'deve arrivare un errore lite');
  assert.equal(rejection, null, 'nessuna promise rifiutata deve sfuggire');

  process.off('unhandledRejection', onReject);
});

test('hub: al collegamento il client riceve subito lo stato degli aggiornamenti', async () => {
  const host = fakeHost();
  host.updates = { status: { checkedAt: 0, available: false, current: '0.10.2', latest: null, error: null } };
  const hub = createHub(host);
  const conn = new FakeConn();
  hub.routes[ENDPOINTS.ws](conn, req);
  await flush();

  const evento = conn.sent.find((m) => m.type === MSG.event && m.event === 'update');
  assert.ok(evento, 'l\'evento update deve arrivare senza aspettare un controllo in rete');
  assert.equal(evento.data.current, '0.10.2');
  assert.equal(evento.data.available, false, 'e\' lo stato dell\'host appena ripartito: niente da installare');
});

test('hub: senza controllo aggiornamenti (host senza updates) non si manda nulla e non si esplode', async () => {
  const hub = createHub(fakeHost());
  const conn = new FakeConn();
  hub.routes[ENDPOINTS.ws](conn, req);
  await flush();
  assert.equal(conn.sent.some((m) => m.type === MSG.event && m.event === 'update'), false);
});
