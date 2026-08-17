/**
 * Endpoint "Prova" dell'editor: POST /api/action/test esegue un'azione in
 * dry-run e riferisce cosa farebbe, senza salvarla ne' toccare il sistema.
 *
 * L'host gira su una configurazione temporanea, isolata dal repository.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createHost } from '../src/host/index.mjs';
import { ENDPOINTS } from '../shared/protocol.mjs';
import { rawDeck } from '../tools/fixtures.mjs';

const TOKEN = 'token-prova-di-test-1';
const silent = { info() {}, warn() {}, error() {}, debug() {}, log() {} };

async function startHost(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-prova-'));
  const configFile = path.join(dir, 'deck.json');
  fs.writeFileSync(configFile, JSON.stringify(rawDeck(), null, 2));
  // Niente dry-run a livello di host: cosi' si verifica che sia l'endpoint a
  // forzarlo, non lo stato globale.
  const host = createHost({
    configFile,
    overrides: { port: 0, host: '127.0.0.1', token: TOKEN, dryRun: false },
    logger: silent,
    watch: false,
    tray: false
  });
  const info = await host.start();
  t.after(async () => {
    await host.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${info.port}` };
}

async function call(base, endpoint, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-wdeck-token': TOKEN },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

test('prova: un\'azione valida risponde ok e in dry-run', async (t) => {
  const { base } = await startHost(t);
  const res = await call(base, ENDPOINTS.actionTest, { method: 'POST', body: { type: 'delay', params: { ms: 50 } } });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.result.dryRun, true, 'il dry-run deve essere forzato dall\'endpoint');
  assert.equal(res.body.result.type, 'delay');
  assert.ok(res.body.result.description, 'manca la descrizione di cosa farebbe');
});

test('prova: senza "type" risponde 400', async (t) => {
  const { base } = await startHost(t);
  const res = await call(base, ENDPOINTS.actionTest, { method: 'POST', body: { params: {} } });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('prova: parametri non validi risponde ok:false con errore', async (t) => {
  const { base } = await startHost(t);
  const res = await call(base, ENDPOINTS.actionTest, { method: 'POST', body: { type: 'delay', params: { ms: 99999 } } });
  assert.equal(res.body.ok, false);
  assert.ok(res.body.result.error?.message, 'atteso un messaggio d\'errore sui parametri');
});

test('prova: senza token e\' rifiutata', async (t) => {
  const { base } = await startHost(t);
  const res = await fetch(`${base}${ENDPOINTS.actionTest}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'delay', params: { ms: 10 } })
  });
  assert.equal(res.status, 401);
});
