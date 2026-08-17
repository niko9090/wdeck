import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { createHost, PROJECT_ROOT } from '../src/host/index.mjs';
import { publicDeck } from '../src/host/server/api.mjs';
import { resolveStatic } from '../src/host/server/static.mjs';
import { ENDPOINTS, TOKEN_HEADER } from '../shared/protocol.mjs';
import { makeDeck } from '../tools/fixtures.mjs';

const TOKEN = 'token-di-test-integrazione';
const silent = { info() {}, warn() {}, error() {}, debug() {}, log() {} };

/** Avvia un host reale su una porta effimera. */
async function startHost(t, overrides = {}) {
  const host = createHost({
    overrides: { port: 0, host: '127.0.0.1', token: TOKEN, dryRun: true, ...overrides },
    logger: silent,
    watch: false
  });
  const info = await host.start();
  t.after(() => host.stop());
  return { host, base: `http://127.0.0.1:${info.port}` };
}

const json = async (res) => ({ status: res.status, body: await res.json() });

test('api: /api/health e\' pubblico e descrive l\'host', async (t) => {
  const { base } = await startHost(t);
  const { status, body } = await json(await fetch(`${base}${ENDPOINTS.health}`));
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.requiresToken, true);
  assert.equal(body.dryRun, true);
  assert.equal(typeof body.version, 'string');
  assert.equal(body.platform, process.platform);
});

test('api: tutte le rotte protette rifiutano le richieste senza token', async (t) => {
  const { base } = await startHost(t);
  const protette = [
    ['GET', ENDPOINTS.deck],
    ['GET', ENDPOINTS.state],
    ['GET', ENDPOINTS.status],
    ['GET', ENDPOINTS.actions],
    ['GET', ENDPOINTS.liteDeck],
    ['GET', ENDPOINTS.liteState],
    ['POST', ENDPOINTS.press],
    ['POST', ENDPOINTS.litePress],
    ['POST', ENDPOINTS.reload]
  ];

  for (const [method, endpoint] of protette) {
    const res = await fetch(`${base}${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined
    });
    assert.equal(res.status, 401, `${method} ${endpoint}`);
    const body = await res.json();
    assert.equal(body.error.code, 'unauthorized');
  }
});

test('api: il token e\' accettato da querystring, header e Bearer', async (t) => {
  const { base } = await startHost(t);

  const viaQuery = await fetch(`${base}${ENDPOINTS.state}?token=${TOKEN}`);
  assert.equal(viaQuery.status, 200);

  const viaHeader = await fetch(`${base}${ENDPOINTS.state}`, { headers: { [TOKEN_HEADER]: TOKEN } });
  assert.equal(viaHeader.status, 200);

  const viaBearer = await fetch(`${base}${ENDPOINTS.state}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(viaBearer.status, 200);
});

test('api: /api/deck non espone mai i dati sensibili', async (t) => {
  const { base } = await startHost(t);
  const { body } = await json(await fetch(`${base}${ENDPOINTS.deck}?token=${TOKEN}`));
  const testo = JSON.stringify(body);

  assert.ok(!testo.includes(TOKEN), 'il token non deve comparire nel layout');
  assert.ok(!testo.includes('allowExec'), 'la whitelist non deve comparire nel layout');
  assert.equal(body.deck.settings, undefined);
  assert.ok(body.deck.ui, 'le impostazioni UI invece servono al client');
});

test('api: publicDeck rimuove security e server', () => {
  const pubblico = publicDeck(makeDeck());
  assert.deepEqual(
    Object.keys(pubblico).sort(),
    ['defaultProfile', 'integrations', 'name', 'profiles', 'ui', 'version']
  );
  assert.equal(pubblico.settings, undefined, 'nessuna traccia di token, PIN o allowExec');
});

test('api: il client non puo\' disattivare il dry-run dell\'host', async (t) => {
  const { base } = await startHost(t);
  const { status, body } = await json(await fetch(`${base}${ENDPOINTS.press}?token=${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buttonId: 'media-playpause', dryRun: false })
  }));

  assert.equal(status, 200);
  assert.equal(body.result.dryRun, true, 'il dry-run dell\'host deve prevalere');
});

test('api: il client puo\' invece forzare il dry-run', async (t) => {
  const { base, host } = await startHost(t);
  host.state.setDryRun(false);

  const { body } = await json(await fetch(`${base}${ENDPOINTS.press}?token=${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buttonId: 'media-playpause', dryRun: true })
  }));
  assert.equal(body.result.dryRun, true);
});

test('api: corpo JSON non valido -> 400', async (t) => {
  const { base } = await startHost(t);
  const res = await fetch(`${base}${ENDPOINTS.press}?token=${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ non json'
  });
  assert.equal(res.status, 400);
});

test('api: endpoint sconosciuto -> 404, metodo errato -> 405', async (t) => {
  const { base } = await startHost(t);

  const sconosciuto = await fetch(`${base}/api/inesistente?token=${TOKEN}`);
  assert.equal(sconosciuto.status, 404);
  assert.equal((await sconosciuto.json()).error.code, 'not_found');

  const metodo = await fetch(`${base}${ENDPOINTS.deck}?token=${TOKEN}`, { method: 'DELETE' });
  assert.equal(metodo.status, 405);
});

test('api: /api/actions elenca il registro', async (t) => {
  const { base } = await startHost(t);
  const { body } = await json(await fetch(`${base}${ENDPOINTS.actions}?token=${TOKEN}`));
  const tipi = body.actions.map((a) => a.type);
  assert.ok(tipi.includes('media'));
  assert.ok(tipi.includes('sequence'));
  assert.ok(body.actions.every((a) => typeof a.description === 'string'));
});

test('api: /api/reload ricarica la configurazione', async (t) => {
  const { base } = await startHost(t);
  const { status, body } = await json(await fetch(`${base}${ENDPOINTS.reload}?token=${TOKEN}`, { method: 'POST' }));
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.deck.profiles.length > 0);
});

test('api lite: layout e stato compatti', async (t) => {
  const { base } = await startHost(t);

  const layout = await json(await fetch(`${base}${ENDPOINTS.liteDeck}?token=${TOKEN}`));
  assert.equal(layout.status, 200);
  assert.equal(layout.body.v, 1);
  assert.ok(Array.isArray(layout.body.b));
  assert.equal(typeof layout.body.r, 'number');

  const stato = await json(await fetch(`${base}${ENDPOINTS.liteState}?token=${TOKEN}`));
  assert.equal(stato.body.v, 1);
  assert.equal(typeof stato.body.p, 'string');
  assert.equal(stato.body.d, 1);
});

test('api lite: profilo o pagina inesistenti -> 404', async (t) => {
  const { base } = await startHost(t);
  const profilo = await fetch(`${base}${ENDPOINTS.liteDeck}?token=${TOKEN}&profile=fantasma`);
  assert.equal(profilo.status, 404);

  const pagina = await fetch(`${base}${ENDPOINTS.liteDeck}?token=${TOKEN}&page=fantasma`);
  assert.equal(pagina.status, 404);
});

test('api lite: pressione compatta', async (t) => {
  const { base } = await startHost(t);
  const { status, body } = await json(await fetch(`${base}${ENDPOINTS.litePress}?token=${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ i: 'media-playpause' })
  }));
  assert.equal(status, 200);
  assert.equal(body.k, 1);
  assert.equal(body.d, 1);
  assert.equal(body.i, 'media-playpause');
});

test('api: con requireToken=false l\'accesso e\' libero', async (t) => {
  const { base } = await startHost(t, { requireToken: false });
  const res = await fetch(`${base}${ENDPOINTS.deck}`);
  assert.equal(res.status, 200);
});

test('static: la PWA e il protocollo condiviso sono serviti', async (t) => {
  const { base } = await startHost(t);

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<html/);

  const protocollo = await fetch(`${base}/shared/protocol.mjs`);
  assert.equal(protocollo.status, 200);
  assert.match(protocollo.headers.get('content-type'), /javascript/);

  const manifest = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type'), /manifest/);
});

test('static: resolveStatic blocca il path traversal', () => {
  const roots = [path.join(PROJECT_ROOT, 'web')];
  assert.ok(resolveStatic(roots, '/index.html'), 'file legittimo servito');
  assert.equal(resolveStatic(roots, '/../deck.json'), null);
  assert.equal(resolveStatic(roots, '/..%2Fdeck.json'), null);
  assert.equal(resolveStatic(roots, '/../../package.json'), null);
  assert.equal(resolveStatic(roots, '/non-esiste.html'), null);
});

test('static: resolveStatic blocca un symlink che esce dalla radice', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-static-'));
  const root = path.join(base, 'root');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'ok.txt'), 'contenuto legittimo');
  const secret = path.join(base, 'secret.txt');
  fs.writeFileSync(secret, 'fuori dalla sandbox');

  const link = path.join(root, 'fuga.txt');
  try {
    fs.symlinkSync(secret, link);
  } catch (err) {
    // Su Windows creare un symlink richiede privilegi: se non ci sono, si salta.
    t.skip(`symlink non creabile in questo ambiente: ${err.message}`);
    fs.rmSync(base, { recursive: true, force: true });
    return;
  }

  try {
    assert.ok(resolveStatic([root], '/ok.txt'), 'i file legittimi restano serviti');
    assert.equal(resolveStatic([root], '/fuga.txt'), null, 'il symlink verso l\'esterno e\' rifiutato');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('static: un percorso sconosciuto ripiega su index.html (SPA)', async (t) => {
  const { base } = await startHost(t);
  const res = await fetch(`${base}/qualcosa/di/inesistente`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<html/);
});
