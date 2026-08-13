/**
 * Registro persistente delle azioni: scrittura, pulizia dei segreti,
 * rotazione, lettura e integrazione con l'host.
 *
 * Il registro esiste per rispondere a "chi ha fatto cosa, e quando": ogni test
 * qui verifica che risponda davvero, e che non risponda anche a domande a cui
 * non dovrebbe (i segreti non ci devono finire).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createAuditLog, pressEntry, redact } from '../src/host/audit.mjs';
import { createHost } from '../src/host/index.mjs';
import { ENDPOINTS } from '../shared/protocol.mjs';
import { rawDeck } from '../tools/fixtures.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {}, log() {} };

function tempLog(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-audit-'));
  const file = path.join(dir, 'wdeck-audit.log');
  const audit = createAuditLog({ file, logger: silent, ...options });
  return { dir, file, audit, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ------------------------------------------------------------------ scrittura

test('audit: scrive una riga JSON per evento', () => {
  const { audit, file, cleanup } = tempLog({ now: () => 1700000000000 });
  try {
    audit.write('press', { buttonId: 'play', ok: true });
    audit.write('pair', { device: 'd-1' });

    const righe = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(righe.length, 2);
    assert.deepEqual(JSON.parse(righe[0]), { at: 1700000000000, event: 'press', buttonId: 'play', ok: true });
    assert.equal(JSON.parse(righe[1]).event, 'pair');
  } finally {
    cleanup();
  }
});

test('audit: disattivato non scrive nulla', () => {
  const { audit, file, cleanup } = tempLog({ enabled: false });
  try {
    audit.write('press', { buttonId: 'play' });
    assert.equal(fs.existsSync(file), false);
  } finally {
    cleanup();
  }
});

test('audit: un file non scrivibile non fa fallire l\'azione', () => {
  // La cartella non esiste e il percorso e' impossibile: la scrittura fallisce.
  const audit = createAuditLog({ file: path.join(os.tmpdir(), 'wdeck\0impossibile', 'x.log'), logger: silent });
  assert.doesNotThrow(() => audit.write('press', { buttonId: 'play' }));
  assert.equal(audit.write('press', {}), null, 'dopo il primo errore smette di provarci');
});

// ------------------------------------------------------------------ segreti

test('audit: i campi sensibili non finiscono nel registro', () => {
  const pulito = redact({
    url: 'https://esempio.it',
    token: 'segretissimo',
    headers: { Authorization: 'Bearer abc', 'X-Ok': 'visibile' },
    nested: { password: 'p', pin: '1234' }
  });
  assert.equal(pulito.token, '[omesso]');
  assert.equal(pulito.headers.Authorization, '[omesso]');
  assert.equal(pulito.headers['X-Ok'], 'visibile');
  assert.equal(pulito.nested.password, '[omesso]');
  assert.equal(pulito.nested.pin, '[omesso]');
  assert.equal(pulito.url, 'https://esempio.it');
});

test('audit: le stringhe lunghe e le strutture profonde vengono troncate', () => {
  assert.equal(redact('x'.repeat(500)).length, 303);
  assert.equal(redact({ a: { b: { c: { d: { e: { f: 1 } } } } } }).a.b.c.d.e, '[...]');
  assert.equal(redact(Array.from({ length: 50 }, (_, i) => i)).length, 20);
});

test('audit: un segreto passato a una scrittura non arriva su disco', () => {
  const { audit, file, cleanup } = tempLog();
  try {
    audit.write('http', { url: 'https://x.it', headers: { authorization: 'Bearer segretissimo' } });
    assert.ok(!fs.readFileSync(file, 'utf8').includes('segretissimo'));
  } finally {
    cleanup();
  }
});

// ------------------------------------------------------------------ rotazione

test('audit: il file viene ruotato quando supera la dimensione massima', () => {
  const { audit, file, cleanup } = tempLog({ maxBytes: 200, keep: 2 });
  try {
    for (let i = 0; i < 20; i += 1) audit.write('press', { buttonId: `bottone-numero-${i}` });

    assert.ok(fs.existsSync(`${file}.1`), 'manca la prima rotazione');
    assert.ok(fs.statSync(file).size < 400, 'il file corrente deve essere piccolo');
    assert.equal(fs.existsSync(`${file}.3`), false, 'oltre "keep" i vecchi si buttano');
  } finally {
    cleanup();
  }
});

// ------------------------------------------------------------------ lettura

test('audit: tail restituisce le righe piu\' recenti per prime', () => {
  const { audit, cleanup } = tempLog();
  try {
    for (let i = 0; i < 5; i += 1) audit.write('press', { buttonId: `b${i}` });
    const ultime = audit.tail({ limit: 2 });
    assert.deepEqual(ultime.map((e) => e.buttonId), ['b4', 'b3']);
  } finally {
    cleanup();
  }
});

test('audit: tail filtra per tipo di evento', () => {
  const { audit, cleanup } = tempLog();
  try {
    audit.write('press', { buttonId: 'a' });
    audit.write('pair', { device: 'd-1' });
    audit.write('press', { buttonId: 'b' });
    assert.deepEqual(audit.tail({ event: 'press' }).map((e) => e.buttonId), ['b', 'a']);
  } finally {
    cleanup();
  }
});

test('audit: una riga troncata costa se stessa, non il resto del registro', () => {
  const { audit, file, cleanup } = tempLog();
  try {
    audit.write('press', { buttonId: 'prima' });
    // Come un arresto improvviso a meta' scrittura.
    fs.appendFileSync(file, '{"at":1,"event":"pre');
    audit.write('press', { buttonId: 'dopo' });

    const letto = audit.tail();
    assert.deepEqual(letto.map((e) => e.buttonId).filter(Boolean), ['dopo', 'prima']);
  } finally {
    cleanup();
  }
});

test('audit: tail su un registro inesistente restituisce una lista vuota', () => {
  const { audit, cleanup } = tempLog();
  try {
    assert.deepEqual(audit.tail(), []);
  } finally {
    cleanup();
  }
});

// ------------------------------------------------------------------ forma delle voci

test('audit: pressEntry conserva chi, cosa ed esito', () => {
  const entry = pressEntry({
    buttonId: 'mute',
    type: 'media',
    label: 'Muto',
    ok: true,
    dryRun: false,
    source: 'ws',
    durationMs: 42,
    detail: 'inviato',
    deviceId: 'd-1',
    address: '192.168.1.5'
  });
  assert.equal(entry.buttonId, 'mute');
  assert.equal(entry.device, 'd-1');
  assert.equal(entry.address, '192.168.1.5');
  assert.equal(entry.error, null);
});

test('audit: pressEntry riporta l\'errore e non il dettaglio quando fallisce', () => {
  const entry = pressEntry({ buttonId: 'x', ok: false, detail: 'ignorato', error: { message: 'non riuscito' } });
  assert.equal(entry.error, 'non riuscito');
  assert.equal(entry.detail, null);
});

// ------------------------------------------------------------------ host

async function startHost(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-audit-host-'));
  const configFile = path.join(dir, 'deck.json');
  fs.writeFileSync(configFile, JSON.stringify(rawDeck(), null, 2));

  const host = createHost({
    configFile,
    overrides: { port: 0, host: '127.0.0.1', token: 'token-audit-di-test', dryRun: true },
    logger: silent,
    watch: false,
    tray: false
  });
  const info = await host.start();
  t.after(async () => {
    await host.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { host, dir, base: `http://127.0.0.1:${info.port}` };
}

const H = { 'Content-Type': 'application/json', 'x-wdeck-token': 'token-audit-di-test' };

test('audit: ogni pressione finisce nel registro accanto a deck.json', async (t) => {
  const { host, dir, base } = await startHost(t);

  await fetch(`${base}${ENDPOINTS.press}`, { method: 'POST', headers: H, body: JSON.stringify({ buttonId: 'play' }) });
  await new Promise((r) => setTimeout(r, 30));

  assert.ok(fs.existsSync(path.join(dir, 'wdeck-audit.log')), 'il registro sta accanto alla configurazione');
  const voci = host.audit.tail({ event: 'press' });
  assert.equal(voci[0].buttonId, 'play');
  assert.equal(voci[0].ok, true);
  assert.equal(voci[0].dryRun, true);
  assert.equal(voci[0].source, 'rest');
  assert.ok(voci[0].address, 'deve sapere da dove e\' arrivata');
});

test('audit: registra chi ha premuto, quando e\' un dispositivo accoppiato', async (t) => {
  const { host, base } = await startHost(t);

  const pair = await (await fetch(`${base}${ENDPOINTS.pair}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '1234', name: 'Telefono' })
  })).json();

  await fetch(`${base}${ENDPOINTS.press}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-wdeck-token': pair.token },
    body: JSON.stringify({ buttonId: 'play' })
  });
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(host.audit.tail({ event: 'press' })[0].device, pair.device.id);
});

test('audit: registra pairing riusciti e falliti', async (t) => {
  const { host, base } = await startHost(t);
  const pair = (pin) => fetch(`${base}${ENDPOINTS.pair}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });

  await pair('0000');
  await pair('1234');

  assert.equal(host.audit.tail({ event: 'pair-failed' }).length, 1);
  assert.equal(host.audit.tail({ event: 'pair' }).length, 1);
});

test('audit: registra revoche e rotazioni del token', async (t) => {
  const { host, base } = await startHost(t);

  const creato = await (await fetch(`${base}${ENDPOINTS.devices}`, {
    method: 'POST', headers: H, body: JSON.stringify({ name: 'Tablet' })
  })).json();
  await fetch(`${base}${ENDPOINTS.devices}?id=${creato.device.id}`, { method: 'DELETE', headers: H });
  await fetch(`${base}${ENDPOINTS.tokenRotate}`, { method: 'POST', headers: H, body: '{}' });

  assert.equal(host.audit.tail({ event: 'device-created' })[0].device, creato.device.id);
  assert.equal(host.audit.tail({ event: 'device-revoked' })[0].device, creato.device.id);
  assert.equal(host.audit.tail({ event: 'token-rotated' }).length, 1);
});

test('audit: /api/audit richiede il token e restituisce le ultime voci', async (t) => {
  const { base } = await startHost(t);
  await fetch(`${base}${ENDPOINTS.press}`, { method: 'POST', headers: H, body: JSON.stringify({ buttonId: 'play' }) });
  await new Promise((r) => setTimeout(r, 30));

  assert.equal((await fetch(`${base}${ENDPOINTS.audit}`)).status, 401);

  const res = await fetch(`${base}${ENDPOINTS.audit}?limit=5&event=press`, { headers: H });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.enabled, true);
  assert.equal(body.entries[0].buttonId, 'play');
});

test('audit: nel registro non compaiono mai token ne\' PIN', async (t) => {
  const { dir, base } = await startHost(t);
  await fetch(`${base}${ENDPOINTS.pair}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '1234', name: 'Telefono' })
  });
  await new Promise((r) => setTimeout(r, 30));

  const contenuto = fs.readFileSync(path.join(dir, 'wdeck-audit.log'), 'utf8');
  assert.ok(!contenuto.includes('1234'), 'il PIN non deve comparire');
  assert.ok(!contenuto.includes('token-audit-di-test'), 'nemmeno il token');
});
