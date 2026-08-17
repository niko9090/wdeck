/**
 * Token per dispositivo: creazione, scadenza, revoca selettiva, rotazione del
 * token principale e comandi di sicurezza da riga di comando.
 *
 * La proprieta' che conta e' una sola: revocare un dispositivo deve togliere
 * l'accesso **a quello** e a nessun altro.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createAuth, hashToken, isExpired, normalizeDevice } from '../src/host/security/auth.mjs';
import { addDevice, listDevices, pruneExpiredDevices, revokeDevice, rotateToken } from '../src/host/security/manage.mjs';
import { createHost } from '../src/host/index.mjs';
import { ENDPOINTS } from '../shared/protocol.mjs';
import { connectWebSocket, waitForMessage } from '../src/host/ws/client.mjs';
import { rawDeck } from '../tools/fixtures.mjs';

const TOKEN = 'token-dispositivi-test-1';
const silent = { info() {}, warn() {}, error() {}, debug() {}, log() {} };
const GIORNO = 86400000;

// ------------------------------------------------------------------ gestore

test('dispositivi: il pairing crea un token dedicato, non consegna quello principale', () => {
  const auth = createAuth({ token: 'principale-lungo-abcdef', pin: '1234' });
  const primo = auth.pair('1234', { name: 'Telefono' });
  const secondo = auth.pair('1234', { name: 'Tablet' });

  assert.notEqual(primo.token, 'principale-lungo-abcdef');
  assert.notEqual(primo.token, secondo.token);
  assert.equal(auth.verify(primo.token), true);
  assert.equal(auth.verify(secondo.token), true);
  assert.equal(auth.verify('principale-lungo-abcdef'), true, 'il principale continua a valere');
});

test('dispositivi: revocarne uno non tocca gli altri', () => {
  const auth = createAuth({ token: 'principale-lungo-abcdef', pin: '1234' });
  const perso = auth.pair('1234', { name: 'Telefono perso' });
  const buono = auth.pair('1234', { name: 'Tablet' });

  assert.equal(auth.revokeDevice(perso.device.id), true);
  assert.equal(auth.verify(perso.token), false, 'il dispositivo revocato non entra piu\'');
  assert.equal(auth.verify(buono.token), true, 'gli altri restano collegati');
  assert.equal(auth.verify('principale-lungo-abcdef'), true);
});

test('dispositivi: revocare un id inesistente non fa danni', () => {
  const auth = createAuth({ token: 'principale-lungo-abcdef' });
  assert.equal(auth.revokeDevice('d-inesistente'), false);
});

test('dispositivi: un token scaduto non e\' piu\' valido', () => {
  let ora = 1_000_000;
  const auth = createAuth({ token: 'principale-lungo-abcdef', pin: '1234' }, { now: () => ora });
  const temporaneo = auth.pair('1234', { name: 'Ospite', days: 1 });

  assert.equal(auth.verify(temporaneo.token), true);
  ora += GIORNO + 1;
  assert.equal(auth.verify(temporaneo.token), false);

  const identita = auth.identify(temporaneo.token);
  assert.equal(identita.ok, false);
  assert.match(identita.reason, /scaduto/);
});

test('dispositivi: la scadenza predefinita si eredita dalla configurazione', () => {
  let ora = 1_000_000;
  const auth = createAuth({ token: 'principale-lungo-abcdef', pin: '1234', deviceTokenDays: 7 }, { now: () => ora });
  const creato = auth.pair('1234');
  assert.equal(creato.device.expiresAt, ora + 7 * GIORNO);

  // Un valore esplicito ha la precedenza; null significa "senza scadenza".
  assert.equal(auth.createDevice({ days: null }).expiresAt, null);
  assert.equal(auth.createDevice({ days: 2 }).expiresAt, ora + 2 * GIORNO);
});

test('dispositivi: pruneExpired toglie solo i scaduti', () => {
  let ora = 1_000_000;
  const auth = createAuth({ token: 'principale-lungo-abcdef' }, { now: () => ora });
  const breve = auth.createDevice({ name: 'Breve', days: 1 });
  const eterno = auth.createDevice({ name: 'Eterno', days: null });

  ora += GIORNO + 1;
  assert.deepEqual(auth.pruneExpired(), [breve.id]);
  assert.deepEqual(auth.listDevices().map((d) => d.id), [eterno.id]);
});

test('dispositivi: identify dice se e\' il token principale o un dispositivo', () => {
  const auth = createAuth({ token: 'principale-lungo-abcdef', pin: '1234' });
  const device = auth.pair('1234', { name: 'Telefono' });

  assert.equal(auth.identify('principale-lungo-abcdef').kind, 'master');
  const daDispositivo = auth.identify(device.token);
  assert.equal(daDispositivo.kind, 'device');
  assert.equal(daDispositivo.device.name, 'Telefono');
});

test('dispositivi: nel file resta solo l\'impronta, mai il token', () => {
  let salvato = null;
  const auth = createAuth({ token: 'principale-lungo-abcdef', pin: '1234' }, { onChange: (state) => { salvato = state; } });
  const device = auth.pair('1234', { name: 'Telefono' });

  const serializzato = JSON.stringify(salvato);
  assert.ok(!serializzato.includes(device.token), 'il token non deve finire nel file');
  assert.ok(serializzato.includes(hashToken(device.token)), 'l\'impronta si');
  assert.equal(auth.listDevices()[0].hash, undefined, 'nemmeno l\'elenco pubblico espone l\'impronta');
});

test('dispositivi: la rotazione del principale non scollega i dispositivi', () => {
  const auth = createAuth({ token: 'principale-lungo-abcdef', pin: '1234' });
  const device = auth.pair('1234');

  const nuovo = auth.rotate();
  assert.equal(auth.verify('principale-lungo-abcdef'), false);
  assert.equal(auth.verify(nuovo), true);
  assert.equal(auth.verify(device.token), true, 'ruotare la chiave di casa non butta fuori chi ha gia\' la sua');
});

test('dispositivi: la rotazione puo\' anche revocare tutto', () => {
  const auth = createAuth({ token: 'principale-lungo-abcdef', pin: '1234' });
  const device = auth.pair('1234');
  auth.rotate({ revokeDevices: true });
  assert.equal(auth.verify(device.token), false);
  assert.deepEqual(auth.listDevices(), []);
});

test('dispositivi: syncFromConfig fa valere una revoca scritta a mano', () => {
  const auth = createAuth({ token: 'principale-lungo-abcdef', pin: '1234' });
  const device = auth.pair('1234');
  assert.equal(auth.verify(device.token), true);

  // Come se qualcuno avesse cancellato la voce da deck.json e salvato.
  auth.syncFromConfig({ token: 'principale-lungo-abcdef', pin: '1234', devices: [] });
  assert.equal(auth.verify(device.token), false);
});

test('dispositivi: syncFromConfig non adotta il token quando e\' imposto da un override', () => {
  const auth = createAuth({ token: 'da-riga-di-comando-1' });
  auth.syncFromConfig({ token: 'quello-del-file-123' }, { allowTokenChange: false });
  assert.equal(auth.token, 'da-riga-di-comando-1');

  auth.syncFromConfig({ token: 'quello-del-file-123' }, { allowTokenChange: true });
  assert.equal(auth.token, 'quello-del-file-123');
});

test('dispositivi: le voci malformate nel file vengono ignorate, non fanno cadere l\'host', () => {
  assert.equal(normalizeDevice(null), null);
  assert.equal(normalizeDevice({ id: 'd-1' }), null, 'senza impronta non e\' un dispositivo');
  assert.equal(normalizeDevice({ hash: 'x'.repeat(64) }), null, 'senza id nemmeno');
  assert.equal(normalizeDevice({ id: 'd-1', hash: 'troppo-corto' }), null);

  const auth = createAuth({ token: 'principale-lungo-abcdef', devices: [null, { id: 'x' }, { id: 'd-1', hash: 'a'.repeat(64) }] });
  assert.deepEqual(auth.listDevices().map((d) => d.id), ['d-1']);
});

test('dispositivi: isExpired tratta null come "senza scadenza"', () => {
  assert.equal(isExpired({ expiresAt: null }, 9e15), false);
  assert.equal(isExpired({ expiresAt: 1000 }, 999), false);
  assert.equal(isExpired({ expiresAt: 1000 }, 1000), true);
});

// ------------------------------------------------------------------ riga di comando

function tempConfig(mutate = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-dev-'));
  const file = path.join(dir, 'deck.json');
  const deck = rawDeck();
  mutate(deck);
  fs.writeFileSync(file, JSON.stringify(deck, null, 2));
  return { dir, file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('cli: --rotate-token riscrive il token nel file', () => {
  const { file, cleanup } = tempConfig();
  try {
    const result = rotateToken(file);
    assert.equal(result.ok, true);
    const scritto = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(scritto.settings.security.token, result.token);
    assert.notEqual(result.token, 'token-di-test-123456');
  } finally {
    cleanup();
  }
});

test('cli: --rotate-token --revoke-devices svuota anche l\'elenco', () => {
  const { file, cleanup } = tempConfig();
  try {
    addDevice(file, { name: 'Telefono' });
    assert.equal(listDevices(file).devices.length, 1);

    const result = rotateToken(file, { revokeDevices: true });
    assert.equal(result.revokedDevices, 1);
    assert.deepEqual(listDevices(file).devices, []);
  } finally {
    cleanup();
  }
});

test('cli: --add-device crea un token utilizzabile e ne mostra il valore una volta', () => {
  const { file, cleanup } = tempConfig();
  try {
    const creato = addDevice(file, { name: 'ESP32 salotto', days: 30 });
    assert.equal(creato.ok, true);
    assert.ok(creato.token.length >= 32);

    const scritto = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(scritto.settings.security.devices.length, 1);
    assert.ok(!JSON.stringify(scritto).includes(creato.token), 'nel file resta solo l\'impronta');

    const auth = createAuth(scritto.settings.security);
    assert.equal(auth.verify(creato.token), true);
  } finally {
    cleanup();
  }
});

test('cli: --add-device usa un id casuale, non derivato dall\'impronta', () => {
  const { file, cleanup } = tempConfig();
  try {
    const creato = addDevice(file, { name: 'ESP32' });
    const scritto = JSON.parse(fs.readFileSync(file, 'utf8'));
    const salvato = scritto.settings.security.devices[0];
    // L'id non deve essere un prefisso dell'impronta: la deriverebbe, rivelandone
    // 40 bit e divergendo dagli id casuali usati altrove.
    assert.equal(creato.device.id, salvato.id);
    assert.ok(!salvato.hash.startsWith(salvato.id.replace(/^d-/, '')), 'l\'id trapela l\'impronta');
    assert.match(salvato.id, /^d-[0-9a-f]{10}$/, 'stesso formato di generateDeviceId');
  } finally {
    cleanup();
  }
});

test('cli: --revoke-device toglie il dispositivo e segnala gli id sconosciuti', () => {
  const { file, cleanup } = tempConfig();
  try {
    const creato = addDevice(file, { name: 'Telefono' });
    assert.equal(revokeDevice(file, creato.device.id).ok, true);
    assert.deepEqual(listDevices(file).devices, []);

    const mancante = revokeDevice(file, 'd-mai-esistito');
    assert.equal(mancante.ok, false);
    assert.match(mancante.message, /sconosciuto/);
  } finally {
    cleanup();
  }
});

test('cli: --prune-devices toglie solo i scaduti', () => {
  const { file, cleanup } = tempConfig();
  try {
    const scaduto = addDevice(file, { name: 'Vecchio', days: 1 });
    const valido = addDevice(file, { name: 'Nuovo' });

    const domani = Date.now() + GIORNO + 1000;
    const result = pruneExpiredDevices(file, { now: domani });
    assert.deepEqual(result.removed, [scaduto.device.id]);
    assert.deepEqual(listDevices(file).devices.map((d) => d.id), [valido.device.id]);
  } finally {
    cleanup();
  }
});

test('cli: revocare un id sconosciuto non riscrive il file', () => {
  const { file, cleanup } = tempConfig();
  try {
    // Baseline in forma compatta: una riscrittura la trasformerebbe in JSON
    // indentato, quindi il confronto byte a byte rivela ogni scrittura spuria.
    const originale = JSON.stringify(rawDeck());
    fs.writeFileSync(file, originale);

    const res = revokeDevice(file, 'd-mai-esistito');
    assert.equal(res.ok, false);
    assert.match(res.message, /sconosciuto/);
    assert.equal(fs.readFileSync(file, 'utf8'), originale, 'nessuna scrittura per un id sconosciuto');
  } finally {
    cleanup();
  }
});

test('cli: --prune-devices senza scaduti non riscrive il file', () => {
  const { file, cleanup } = tempConfig();
  try {
    const originale = JSON.stringify(rawDeck());
    fs.writeFileSync(file, originale);

    const res = pruneExpiredDevices(file);
    assert.deepEqual(res.removed, []);
    assert.equal(fs.readFileSync(file, 'utf8'), originale, 'niente da potare, niente da riscrivere');
  } finally {
    cleanup();
  }
});

test('cli: un file inesistente produce un errore leggibile, non un\'eccezione', () => {
  const result = rotateToken(path.join(os.tmpdir(), 'wdeck-non-esiste', 'deck.json'));
  assert.equal(result.ok, false);
  assert.match(result.message, /impossibile leggere/);
});

// ------------------------------------------------------------------ endpoint

async function startHost(t) {
  const { dir, file, cleanup } = tempConfig();
  const host = createHost({
    configFile: file,
    overrides: { port: 0, host: '127.0.0.1', dryRun: true },
    logger: silent,
    watch: false,
    tray: false
  });
  const info = await host.start();
  t.after(async () => {
    await host.stop();
    cleanup();
  });
  return { host, dir, file, base: `http://127.0.0.1:${info.port}`, port: info.port, token: host.auth.token };
}

const call = (base, endpoint, token, { method = 'GET', body, query = '' } = {}) => fetch(`${base}${endpoint}${query}`, {
  method,
  headers: { 'Content-Type': 'application/json', 'x-wdeck-token': token },
  body: body ? JSON.stringify(body) : undefined
});

test('api: il pairing consegna un token dedicato che apre le rotte protette', async (t) => {
  const { base, token } = await startHost(t);

  const pair = await fetch(`${base}${ENDPOINTS.pair}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '1234', name: 'Telefono di prova' })
  });
  const body = await pair.json();
  assert.equal(pair.status, 200);
  assert.notEqual(body.token, token, 'non deve essere il token principale');
  assert.equal(body.device.name, 'Telefono di prova');

  assert.equal((await call(base, ENDPOINTS.deck, body.token)).status, 200);
});

test('api: /api/devices elenca i dispositivi senza esporne le credenziali', async (t) => {
  const { base, token } = await startHost(t);
  const creato = await (await call(base, ENDPOINTS.devices, token, { method: 'POST', body: { name: 'Tablet' } })).json();

  const res = await call(base, ENDPOINTS.devices, token);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.devices.length, 1);
  assert.equal(body.devices[0].name, 'Tablet');
  assert.ok(!JSON.stringify(body).includes(creato.device.token), 'il token non si rivede mai');
  assert.equal(body.current, null, 'la chiamata usa il token principale, non un dispositivo');
});

test('api: la revoca toglie l\'accesso a quel dispositivo soltanto', async (t) => {
  const { base, token } = await startHost(t);
  const uno = await (await call(base, ENDPOINTS.devices, token, { method: 'POST', body: { name: 'Uno' } })).json();
  const due = await (await call(base, ENDPOINTS.devices, token, { method: 'POST', body: { name: 'Due' } })).json();

  assert.equal((await call(base, ENDPOINTS.deck, uno.device.token)).status, 200);

  const revoca = await call(base, ENDPOINTS.devices, token, { method: 'DELETE', query: `?id=${uno.device.id}` });
  assert.equal(revoca.status, 200);

  assert.equal((await call(base, ENDPOINTS.deck, uno.device.token)).status, 401, 'revocato');
  assert.equal((await call(base, ENDPOINTS.deck, due.device.token)).status, 200, 'gli altri restano');
});

test('api: revocare un dispositivo inesistente risponde 404', async (t) => {
  const { base, token } = await startHost(t);
  const res = await call(base, ENDPOINTS.devices, token, { method: 'DELETE', query: '?id=d-mai-esistito' });
  assert.equal(res.status, 404);
});

test('api: la rotazione invalida il vecchio token principale', async (t) => {
  const { base, token } = await startHost(t);
  const res = await call(base, ENDPOINTS.tokenRotate, token, { method: 'POST', body: {} });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.notEqual(body.token, token);

  assert.equal((await call(base, ENDPOINTS.deck, token)).status, 401, 'il vecchio non vale piu\'');
  assert.equal((await call(base, ENDPOINTS.deck, body.token)).status, 200);
});

test('api: il dispositivo revocato viene scollegato, non solo respinto al prossimo accesso', async (t) => {
  const { base, port, token } = await startHost(t);
  const device = await (await call(base, ENDPOINTS.devices, token, { method: 'POST', body: { name: 'Telefono' } })).json();

  const ws = await connectWebSocket(`ws://127.0.0.1:${port}${ENDPOINTS.ws}?token=${device.device.token}`);
  await waitForMessage(ws, (m) => m.type === 'auth-ok', { label: 'auth-ok' });

  const closed = new Promise((resolve) => ws.once('close', resolve));
  ws.on('error', () => {});
  await call(base, ENDPOINTS.devices, token, { method: 'DELETE', query: `?id=${device.device.id}` });

  // Senza questo, un telefono revocato resterebbe collegato e capace di premere
  // bottoni fino a quando non chiude lui: cioe' la revoca non revocherebbe.
  const esito = await Promise.race([closed, new Promise((r) => setTimeout(() => r('scaduto'), 3000))]);
  assert.notEqual(esito, 'scaduto', 'la connessione doveva essere chiusa dall\'host');
});

test('api: le nuove credenziali finiscono in deck.json, non solo in memoria', async (t) => {
  const { base, file, token } = await startHost(t);
  const creato = await (await call(base, ENDPOINTS.devices, token, { method: 'POST', body: { name: 'Persistente' } })).json();

  const scritto = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(scritto.settings.security.devices.length, 1);
  assert.equal(scritto.settings.security.devices[0].name, 'Persistente');
  assert.ok(!JSON.stringify(scritto).includes(creato.device.token));
});

test('api: "days" fuori intervallo viene rifiutato', async (t) => {
  const { base, token } = await startHost(t);
  const res = await call(base, ENDPOINTS.devices, token, { method: 'POST', body: { name: 'X', days: 99999 } });
  assert.equal(res.status, 400);
});
