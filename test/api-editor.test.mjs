/**
 * API dell'editor visuale: salvataggio di pagine e profili, spostamento dei
 * controlli, caricamento e uso delle icone personalizzate.
 *
 * L'host gira su una copia temporanea della configurazione: le icone finiscono
 * accanto a quella copia, quindi i test non lasciano nulla nel repository.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createHost } from '../src/host/index.mjs';
import { ENDPOINTS } from '../shared/protocol.mjs';
import { rawDeck } from '../tools/fixtures.mjs';

const TOKEN = 'token-editor-di-test-1';
const silent = { info() {}, warn() {}, error() {}, debug() {}, log() {} };

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01
]);
const dataUrl = (buffer, type = 'image/png') => `data:${type};base64,${buffer.toString('base64')}`;

/** Avvia un host su una configurazione temporanea, isolata dal repository. */
async function startHost(t, deckOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-editor-'));
  const configFile = path.join(dir, 'deck.json');
  fs.writeFileSync(configFile, JSON.stringify(rawDeck(deckOverrides), null, 2));

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
  return { host, dir, base: `http://127.0.0.1:${info.port}` };
}

/** Chiamata autenticata all'API. */
async function call(base, endpoint, { method = 'GET', body, query = '' } = {}) {
  const res = await fetch(`${base}${endpoint}${query}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-wdeck-token': TOKEN },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, raw: text, headers: res.headers };
}

/** Legge il deck pubblico attuale, da modificare e rispedire. */
async function readDeck(base) {
  const res = await call(base, ENDPOINTS.deck);
  return res.body.deck;
}

// ------------------------------------------------------------------ pagine

test('editor: aggiunge una pagina al profilo', async (t) => {
  const { base } = await startHost(t);
  const deck = await readDeck(base);
  deck.profiles[0].pages.push({ id: 'nuova', name: 'Nuova', rows: 2, cols: 2, buttons: [] });

  const res = await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.deck.profiles[0].pages.map((p) => p.id), ['home', 'due', 'nuova']);
});

test('editor: elimina una pagina e riordina le rimanenti', async (t) => {
  const { base } = await startHost(t);
  let deck = await readDeck(base);
  deck.profiles[0].pages = deck.profiles[0].pages.filter((p) => p.id !== 'due');
  // La pagina "home" ha un bottone che naviga verso "due": va tolto anche quello,
  // altrimenti il target di navigazione resta senza destinazione.
  deck.profiles[0].pages[0].buttons = deck.profiles[0].pages[0].buttons.filter((b) => b.id !== 'vai');

  const res = await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } });
  assert.equal(res.status, 200, res.raw);
  deck = res.body.deck;
  assert.deepEqual(deck.profiles[0].pages.map((p) => p.id), ['home']);
});

test('editor: eliminare una pagina ancora referenziata viene rifiutato con la ragione', async (t) => {
  const { base } = await startHost(t);
  const deck = await readDeck(base);
  deck.profiles[0].pages = deck.profiles[0].pages.filter((p) => p.id !== 'due');

  const res = await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.some((e) => /destinazione "due" non definita/.test(e.message)), res.raw);
});

test('editor: un profilo senza pagine viene rifiutato', async (t) => {
  const { base } = await startHost(t);
  const deck = await readDeck(base);
  deck.profiles[0].pages = [];

  const res = await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.some((e) => /almeno una pagina/.test(e.message)), res.raw);
});

test('editor: rimpicciolire la griglia lasciando fuori un controllo viene rifiutato', async (t) => {
  const { base } = await startHost(t);
  const deck = await readDeck(base);
  deck.profiles[0].pages[0].cols = 1;

  const res = await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.some((e) => /fuori dalla griglia/.test(e.message)), res.raw);
});

// ------------------------------------------------------------------ profili

test('editor: aggiunge un profilo con la sua pagina iniziale', async (t) => {
  const { base } = await startHost(t);
  const deck = await readDeck(base);
  deck.profiles.push({
    id: 'streaming',
    name: 'Streaming',
    defaultPage: 'home-streaming',
    pages: [{ id: 'home-streaming', name: 'Principale', rows: 2, cols: 2, buttons: [] }]
  });

  const res = await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } });
  assert.equal(res.status, 200, res.raw);
  assert.deepEqual(res.body.deck.profiles.map((p) => p.id), ['main', 'streaming']);
});

test('editor: elimina un profilo e sposta il profilo iniziale', async (t) => {
  const { base } = await startHost(t);
  let deck = await readDeck(base);
  deck.profiles.push({
    id: 'temporaneo',
    name: 'Temporaneo',
    defaultPage: 'g',
    pages: [{ id: 'g', name: 'G', rows: 1, cols: 1, buttons: [] }]
  });
  deck.defaultProfile = 'temporaneo';
  assert.equal((await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } })).status, 200);

  deck = await readDeck(base);
  deck.profiles = deck.profiles.filter((p) => p.id !== 'temporaneo');
  deck.defaultProfile = 'main';
  const res = await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } });
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.deck.defaultProfile, 'main');
});

test('editor: un deck senza profili viene rifiutato', async (t) => {
  const { base } = await startHost(t);
  const deck = await readDeck(base);
  deck.profiles = [];
  const res = await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } });
  assert.equal(res.status, 400);
});

// ------------------------------------------------------------------ spostamento

test('editor: sposta un controllo in una cella libera', async (t) => {
  const { base } = await startHost(t);
  const deck = await readDeck(base);
  const button = deck.profiles[0].pages[0].buttons.find((b) => b.id === 'vai');
  button.row = 1;
  button.col = 2;
  // libera la cella di destinazione spostando via chi la occupava
  const occupante = deck.profiles[0].pages[0].buttons.find((b) => b.id === 'vietato');
  deck.profiles[0].pages[0].buttons = deck.profiles[0].pages[0].buttons.filter((b) => b.id !== occupante.id);

  const res = await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } });
  assert.equal(res.status, 200, res.raw);
  const spostato = res.body.deck.profiles[0].pages[0].buttons.find((b) => b.id === 'vai');
  assert.deepEqual([spostato.row, spostato.col], [1, 2]);
});

test('editor: spostare un controllo su una cella occupata viene rifiutato', async (t) => {
  const { base } = await startHost(t);
  const deck = await readDeck(base);
  const button = deck.profiles[0].pages[0].buttons.find((b) => b.id === 'vai');
  button.row = 0;
  button.col = 0;

  const res = await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.some((e) => /gia' occupata/.test(e.message)), res.raw);
});

// ------------------------------------------------------------------ icone

test('icone: caricamento, elenco e download', async (t) => {
  const { base } = await startHost(t);

  const vuoto = await call(base, ENDPOINTS.icons);
  assert.equal(vuoto.status, 200);
  assert.deepEqual(vuoto.body.icons, []);
  assert.ok(vuoto.body.limits.maxBytes > 0);

  const caricata = await call(base, ENDPOINTS.icons, {
    method: 'POST',
    body: { name: 'mio-logo', content: dataUrl(PNG) }
  });
  assert.equal(caricata.status, 200, caricata.raw);
  assert.equal(caricata.body.icon.ref, 'custom:mio-logo');

  const elenco = await call(base, ENDPOINTS.icons);
  assert.deepEqual(elenco.body.icons.map((i) => i.name), ['mio-logo']);

  const file = await fetch(`${base}${ENDPOINTS.iconFile}?name=mio-logo&token=${TOKEN}`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(Buffer.from(await file.arrayBuffer()).equals(PNG));
});

test('icone: gli endpoint richiedono il token', async (t) => {
  const { base } = await startHost(t);
  for (const [method, endpoint] of [['GET', ENDPOINTS.icons], ['POST', ENDPOINTS.icons], ['GET', ENDPOINTS.iconFile]]) {
    const res = await fetch(`${base}${endpoint}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(res.status, 401, `${method} ${endpoint}`);
  }
});

test('icone: un contenuto che non e\' un\'immagine viene rifiutato', async (t) => {
  const { base } = await startHost(t);
  const res = await call(base, ENDPOINTS.icons, {
    method: 'POST',
    body: { name: 'finta', content: dataUrl(Buffer.from('MZ eseguibile'), 'image/png') }
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /formato non riconosciuto/);
});

test('icone: un nome con path traversal viene rifiutato', async (t) => {
  const { base } = await startHost(t);
  const res = await call(base, ENDPOINTS.icons, {
    method: 'POST',
    body: { name: '../../fuori', content: dataUrl(PNG) }
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /nome icona non valido/);
});

test('icone: eliminare un\'icona in uso richiede una conferma esplicita', async (t) => {
  const { base } = await startHost(t);
  await call(base, ENDPOINTS.icons, { method: 'POST', body: { name: 'usata', content: dataUrl(PNG) } });

  const deck = await readDeck(base);
  deck.profiles[0].pages[0].buttons[0].icon = 'custom:usata';
  assert.equal((await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } })).status, 200);

  const rifiutata = await call(base, ENDPOINTS.icons, { method: 'DELETE', query: '?name=usata' });
  assert.equal(rifiutata.status, 409);
  assert.deepEqual(rifiutata.body.usedBy, ['play']);

  const forzata = await call(base, ENDPOINTS.icons, { method: 'DELETE', query: '?name=usata&force=1' });
  assert.equal(forzata.status, 200);
  assert.equal((await call(base, ENDPOINTS.icons)).body.icons.length, 0);
});

test('icone: eliminare un\'icona inesistente risponde 404', async (t) => {
  const { base } = await startHost(t);
  const res = await call(base, ENDPOINTS.icons, { method: 'DELETE', query: '?name=mai-esistita' });
  assert.equal(res.status, 404);
});

test('icone: un controllo puo\' riferirsi a un\'icona caricata', async (t) => {
  const { base } = await startHost(t);
  await call(base, ENDPOINTS.icons, { method: 'POST', body: { name: 'logo', content: dataUrl(PNG) } });

  const deck = await readDeck(base);
  deck.profiles[0].pages[0].buttons[0].icon = 'custom:logo';
  const res = await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } });
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.deck.profiles[0].pages[0].buttons[0].icon, 'custom:logo');
});

test('icone: le icone stanno accanto a deck.json, non dentro', async (t) => {
  const { base, dir } = await startHost(t);
  await call(base, ENDPOINTS.icons, { method: 'POST', body: { name: 'accanto', content: dataUrl(PNG) } });
  assert.ok(fs.existsSync(path.join(dir, 'icons', 'accanto.png')));
  assert.ok(!fs.readFileSync(path.join(dir, 'deck.json'), 'utf8').includes('base64'));
});

// ------------------------------------------------------------------ regressione

test('editor: gli override di avvio non finiscono dentro deck.json', async (t) => {
  // Difetto trovato scrivendo questi test: il salvataggio partiva dal deck
  // normalizzato, che porta con se' --port, --token e le variabili WDECK_*.
  // Al primo salvataggio dall'editor quei valori diventavano permanenti, e un
  // avvio con --port 0 rendeva la configurazione perfino invalida.
  const { base, dir } = await startHost(t);

  const deck = await readDeck(base);
  deck.profiles[0].pages[0].buttons[0].label = 'Rinominato';
  assert.equal((await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } })).status, 200);

  const scritto = JSON.parse(fs.readFileSync(path.join(dir, 'deck.json'), 'utf8'));
  assert.equal(scritto.settings.server.port, 8900, 'la porta del file resta quella dell\'utente');
  assert.equal(scritto.settings.security.token, 'token-di-test-123456', 'il token del file resta quello dell\'utente');
  assert.equal(scritto.profiles[0].pages[0].buttons[0].label, 'Rinominato', 'la modifica vera e\' stata scritta');
});

test('editor: nemmeno le impostazioni a caldo trascinano gli override', async (t) => {
  const { base, dir } = await startHost(t);

  const res = await call(base, ENDPOINTS.settings, { method: 'POST', body: { pin: '987654' } });
  assert.equal(res.status, 200, res.raw);

  const scritto = JSON.parse(fs.readFileSync(path.join(dir, 'deck.json'), 'utf8'));
  assert.equal(scritto.settings.security.pin, '987654');
  assert.equal(scritto.settings.server.port, 8900);
  assert.equal(scritto.settings.security.token, 'token-di-test-123456');
});

test('editor: il salvataggio non puo\' toccare il blocco sicurezza', async (t) => {
  const { base, dir } = await startHost(t);
  const deck = await readDeck(base);
  deck.settings = { security: { token: 'token-rubato-dal-client', allowExec: ['**'] } };

  assert.equal((await call(base, ENDPOINTS.save, { method: 'POST', body: { deck } })).status, 200);
  const scritto = JSON.parse(fs.readFileSync(path.join(dir, 'deck.json'), 'utf8'));
  assert.equal(scritto.settings.security.token, 'token-di-test-123456');
  assert.deepEqual(scritto.settings.security.allowExec, rawDeck().settings.security.allowExec);
});
