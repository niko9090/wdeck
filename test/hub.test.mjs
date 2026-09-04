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

test('hub: authOk porta la build dell\'host e un client con build diversa riceve l\'ordine di ricaricarsi', async () => {
  const host = fakeHost();
  host.buildId = 'nuova1234567';
  host.version = '0.10.5';
  host.auth = { required: true, verifyRequest: () => ({ ok: false }), identify: () => ({ ok: true }) };
  const hub = createHub(host);

  const vecchio = new FakeConn();
  hub.routes[ENDPOINTS.ws](vecchio, req);
  vecchio.emit('message', JSON.stringify({ type: MSG.auth, token: 't', build: 'vecchia000000' }));
  await flush();
  const ok = vecchio.sent.find((m) => m.type === MSG.authOk);
  assert.equal(ok.build, 'nuova1234567');
  assert.equal(ok.version, '0.10.5');
  const reload = vecchio.sent.find((m) => m.type === MSG.event && m.event === 'reload');
  assert.ok(reload, 'un client con una build vecchia deve ricevere il comando di ricarica');
  assert.equal(reload.data.build, 'nuova1234567');

  const nuovo = new FakeConn();
  hub.routes[ENDPOINTS.ws](nuovo, req);
  nuovo.emit('message', JSON.stringify({ type: MSG.auth, token: 't', build: 'nuova1234567' }));
  await flush();
  assert.equal(nuovo.sent.some((m) => m.type === MSG.event && m.event === 'reload'), false, 'stessa build: nessun ordine');

  // un client che non dichiara la build (vecchio) non riceve l'ordine, ma neanche errori
  const muto = new FakeConn();
  hub.routes[ENDPOINTS.ws](muto, req);
  muto.emit('message', JSON.stringify({ type: MSG.auth, token: 't' }));
  await flush();
  assert.ok(muto.sent.some((m) => m.type === MSG.authOk));
  assert.equal(muto.sent.some((m) => m.type === MSG.event && m.event === 'reload'), false);
});

test('hub: senza controllo aggiornamenti (host senza updates) non si manda nulla e non si esplode', async () => {
  const hub = createHub(fakeHost());
  const conn = new FakeConn();
  hub.routes[ENDPOINTS.ws](conn, req);
  await flush();
  assert.equal(conn.sent.some((m) => m.type === MSG.event && m.event === 'update'), false);
});
