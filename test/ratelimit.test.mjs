/**
 * Limitazione della frequenza: finestra scorrevole, identita' del richiedente
 * e comportamento degli endpoint quando il limite viene superato.
 *
 * Il tempo e' iniettato: un test che aspetta davvero cinque minuti per vedere
 * scadere una finestra non e' un test che qualcuno rilancera' volentieri.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_LIMITS,
  MAX_KEYS,
  createRateLimiter,
  createRateLimits,
  limiterKey,
  normalizeAddress
} from '../src/host/security/ratelimit.mjs';
import { createHost } from '../src/host/index.mjs';
import { ENDPOINTS, ERROR_CODES } from '../shared/protocol.mjs';
import { connectWebSocket, waitForMessage } from '../src/host/ws/client.mjs';
import { rawDeck } from '../tools/fixtures.mjs';

const TOKEN = 'token-limiti-di-test-1';
const silent = { info() {}, warn() {}, error() {}, debug() {}, log() {} };

/** Orologio pilotato dal test. */
function fakeClock(start = 10000) {
  let ora = start;
  return { now: () => ora, advance: (ms) => { ora += ms; } };
}

// ------------------------------------------------------------------ finestra scorrevole

test('limiti: consente fino al massimo e poi blocca', () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 3, now: fakeClock().now });
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').allowed, true);
  const terzo = limiter.check('a');
  assert.equal(terzo.allowed, true);
  assert.equal(terzo.remaining, 0);
  assert.equal(limiter.check('a').allowed, false);
});

test('limiti: la finestra scorre, non si azzera a scatti', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: clock.now });

  limiter.check('a');
  clock.advance(600);
  limiter.check('a');
  assert.equal(limiter.check('a').allowed, false, 'due tentativi dentro la finestra');

  // Passata la finestra del primo tentativo si libera un posto, non due:
  // e' proprio cio' che un contatore azzerato a intervalli fissi sbaglia.
  clock.advance(500);
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').allowed, false);
});

test('limiti: retryAfterMs dice quando si libera il primo posto', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ windowMs: 5000, max: 1, now: clock.now });
  limiter.check('a');
  clock.advance(2000);
  assert.equal(limiter.check('a').retryAfterMs, 3000);
});

test('limiti: le chiavi sono indipendenti', () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: fakeClock().now });
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('b').allowed, true);
  assert.equal(limiter.check('a').allowed, false);
});

test('limiti: reset dimentica i tentativi di una chiave', () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: fakeClock().now });
  limiter.check('a');
  assert.equal(limiter.check('a').allowed, false);
  limiter.reset('a');
  assert.equal(limiter.check('a').allowed, true);
});

test('limiti: la tabella delle chiavi non cresce senza fine', () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 5, now: fakeClock().now });
  for (let i = 0; i < MAX_KEYS + 50; i += 1) limiter.check(`chiave-${i}`);
  assert.ok(limiter.size <= MAX_KEYS, `${limiter.size} chiavi in memoria`);
});

test('limiti: count riporta solo i tentativi ancora dentro la finestra', () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ windowMs: 1000, max: 10, now: clock.now });
  limiter.check('a');
  limiter.check('a');
  assert.equal(limiter.count('a'), 2);
  clock.advance(1500);
  assert.equal(limiter.count('a'), 0);
});

// ------------------------------------------------------------------ identita'

test('limiti: il dispositivo autenticato ha la precedenza sull\'indirizzo', () => {
  // Dietro un NAT tutti i telefoni di casa condividono l'indirizzo: limitarli
  // insieme punirebbe l'innocente per il vicino.
  assert.equal(limiterKey({ deviceId: 'd-1', address: '192.168.1.5' }), 'd:d-1');
  assert.equal(limiterKey({ address: '192.168.1.5' }), 'a:192.168.1.5');
  assert.equal(limiterKey({}), 'a:sconosciuto');
});

test('limiti: gli indirizzi IPv4 mappati in IPv6 sono normalizzati', () => {
  assert.equal(normalizeAddress('::ffff:192.168.1.5'), '192.168.1.5');
  assert.equal(normalizeAddress('192.168.1.5'), '192.168.1.5');
  assert.equal(normalizeAddress(null), 'sconosciuto');
  assert.equal(normalizeAddress(''), 'sconosciuto');
});

// ------------------------------------------------------------------ configurazione

test('limiti: createRateLimits usa le tarature predefinite', () => {
  const limits = createRateLimits();
  assert.equal(limits.press.max, DEFAULT_LIMITS.press.max);
  assert.equal(limits.auth.windowMs, DEFAULT_LIMITS.auth.windowMs);
  assert.equal(limits.enabled, true);
});

test('limiti: enabled false lascia passare tutto', () => {
  const limits = createRateLimits({ enabled: false, press: { max: 1 } });
  for (let i = 0; i < 50; i += 1) {
    assert.equal(limits.checkPress({ address: '1.2.3.4' }).allowed, true);
  }
  assert.equal(limits.checkAuth({ address: '1.2.3.4' }).allowed, true);
});

test('limiti: un accesso riuscito azzera i tentativi falliti', () => {
  const limits = createRateLimits({ auth: { windowMs: 60000, max: 2 } });
  limits.checkAuth({ address: '1.2.3.4' });
  limits.checkAuth({ address: '1.2.3.4' });
  assert.equal(limits.checkAuth({ address: '1.2.3.4' }).allowed, false);
  limits.clearAuth({ address: '1.2.3.4' });
  assert.equal(limits.checkAuth({ address: '1.2.3.4' }).allowed, true);
});

// ------------------------------------------------------------------ endpoint

/** Host su configurazione temporanea, con limiti stretti per non allungare i test. */
async function startHost(t, rateLimit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-limiti-'));
  const configFile = path.join(dir, 'deck.json');
  const deck = rawDeck();
  deck.settings.security.rateLimit = rateLimit;
  fs.writeFileSync(configFile, JSON.stringify(deck, null, 2));

  const host = createHost({
    configFile,
    overrides: { port: 0, host: '127.0.0.1', token: TOKEN, dryRun: true },
    logger: silent,
    watch: false,
    tray: false
  });
  const info = await host.start();
  t.after(async () => {
    await host.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { host, base: `http://127.0.0.1:${info.port}`, port: info.port };
}

const press = (base, buttonId = 'play') => fetch(`${base}${ENDPOINTS.press}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-wdeck-token': TOKEN },
  body: JSON.stringify({ buttonId })
});

test('limiti: oltre il tetto le pressioni REST rispondono 429 con rate_limited', async (t) => {
  const { base } = await startHost(t, { press: { windowMs: 60000, max: 3 }, auth: { windowMs: 60000, max: 50 } });

  for (let i = 0; i < 3; i += 1) {
    assert.equal((await press(base)).status, 200, `pressione ${i + 1}`);
  }

  const bloccata = await press(base);
  assert.equal(bloccata.status, 429);
  assert.ok(Number(bloccata.headers.get('retry-after')) >= 1, 'manca Retry-After');
  const body = await bloccata.json();
  assert.equal(body.error.code, ERROR_CODES.rateLimited);
  assert.match(body.error.message, /riprova fra/);
});

test('limiti: il tetto vale anche per il canale lite', async (t) => {
  const { base } = await startHost(t, { press: { windowMs: 60000, max: 1 }, auth: { windowMs: 60000, max: 50 } });

  const litePress = () => fetch(`${base}${ENDPOINTS.litePress}?token=${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ i: 'play' })
  });

  assert.equal((await litePress()).status, 200);
  assert.equal((await litePress()).status, 429);
});

test('limiti: il pairing con PIN e\' protetto dal brute force', async (t) => {
  const { base } = await startHost(t, { press: { windowMs: 60000, max: 100 }, auth: { windowMs: 60000, max: 3 } });

  const pair = (pin) => fetch(`${base}${ENDPOINTS.pair}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });

  for (let i = 0; i < 3; i += 1) {
    assert.equal((await pair('0000')).status, 401, `tentativo ${i + 1}`);
  }

  const bloccato = await pair('0000');
  assert.equal(bloccato.status, 429);
  assert.equal((await bloccato.json()).error.code, ERROR_CODES.rateLimited);

  // Il PIN giusto non aiuta a scavalcare il limite: e' proprio il punto.
  assert.equal((await pair('1234')).status, 429);
});

test('limiti: anche i token sbagliati contano come tentativi di accesso', async (t) => {
  const { base } = await startHost(t, { press: { windowMs: 60000, max: 100 }, auth: { windowMs: 60000, max: 3 } });

  for (let i = 0; i < 3; i += 1) {
    const res = await fetch(`${base}${ENDPOINTS.deck}?token=sbagliato-${i}`);
    assert.equal(res.status, 401);
  }

  // Il limite sul PIN si aggirerebbe provando direttamente i token, se i due
  // contatori fossero separati.
  const pair = await fetch(`${base}${ENDPOINTS.pair}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '1234' })
  });
  assert.equal(pair.status, 429);
});

test('limiti: un PIN corretto azzera i tentativi precedenti', async (t) => {
  const { base } = await startHost(t, { press: { windowMs: 60000, max: 100 }, auth: { windowMs: 60000, max: 4 } });

  const pair = (pin) => fetch(`${base}${ENDPOINTS.pair}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });

  assert.equal((await pair('0000')).status, 401);
  assert.equal((await pair('0000')).status, 401);
  assert.equal((await pair('1234')).status, 200, 'PIN corretto');

  // Azzerato il conteggio, restano di nuovo tutti i tentativi disponibili.
  for (let i = 0; i < 4; i += 1) {
    assert.notEqual((await pair('0000')).status, 429, `tentativo ${i + 1} dopo l'azzeramento`);
  }
});

test('limiti: sul WebSocket la pressione oltre il tetto riceve un errore, non un ack', async (t) => {
  const { port } = await startHost(t, { press: { windowMs: 60000, max: 1 }, auth: { windowMs: 60000, max: 50 } });
  const ws = await connectWebSocket(`ws://127.0.0.1:${port}${ENDPOINTS.ws}?token=${TOKEN}`);
  await waitForMessage(ws, (m) => m.type === 'auth-ok', { label: 'auth-ok' });

  ws.send({ type: 'press', buttonId: 'play', requestId: 'r1' });
  const ack = await waitForMessage(ws, (m) => m.type === 'ack' && m.requestId === 'r1', { label: 'ack' });
  assert.equal(ack.ok, true);

  ws.send({ type: 'press', buttonId: 'play', requestId: 'r2' });
  const errore = await waitForMessage(ws, (m) => m.type === 'error', { label: 'errore di limite' });
  assert.equal(errore.code, ERROR_CODES.rateLimited);
  assert.equal(errore.requestId, 'r2');

  // Chiudere e basta lascerebbe la stretta di mano a meta': l'host viene fermato
  // subito dopo e il socket morirebbe con un ECONNRESET fuori dal test.
  const closed = new Promise((resolve) => ws.once('close', resolve));
  ws.on('error', () => {});
  ws.close(1000, 'fine');
  await closed;
});

test('limiti: disattivati, l\'host non blocca nulla', async (t) => {
  const { base } = await startHost(t, { enabled: false, press: { windowMs: 60000, max: 1 } });
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await press(base)).status, 200, `pressione ${i + 1}`);
  }
});
