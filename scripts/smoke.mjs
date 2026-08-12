#!/usr/bin/env node
/**
 * Smoke test end-to-end.
 *
 * Avvia un host reale su una porta di test e verifica il percorso completo:
 *   health -> layout -> autenticazione WebSocket -> pressione in dry-run -> rifiuto senza token.
 *
 * Uso: npm run smoke
 */

import { createHost } from '../src/host/index.mjs';
import { connectWebSocket, waitForMessage } from '../src/host/ws/client.mjs';
import { ENDPOINTS, MSG, LITE_FIELDS, LITE_MSG } from '../shared/protocol.mjs';

const PORT = Number(process.env.WDECK_SMOKE_PORT ?? 8971);
const TOKEN = 'smoke-token-0123456789';

let passed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

const quietLogger = { ...console, info: () => {}, debug: () => {}, warn: () => {} };

async function main() {
  console.log('\nWdeck - smoke test end-to-end\n');

  const host = createHost({
    overrides: { port: PORT, host: '127.0.0.1', token: TOKEN, dryRun: true },
    logger: quietLogger,
    watch: false
  });

  const info = await host.start();
  const base = `http://127.0.0.1:${info.port}`;
  console.log(`host avviato su ${base} (dry-run attivo)\n`);

  try {
    // ---------------------------------------------------------------
    console.log('1) API REST');
    const health = await fetch(`${base}${ENDPOINTS.health}`);
    const healthBody = await health.json();
    check('/api/health risponde 200', health.status === 200, `status=${health.status}`);
    check('/api/health -> ok:true', healthBody.ok === true, JSON.stringify(healthBody));
    check('/api/health espone protocollo e piattaforma',
      typeof healthBody.protocol === 'number' && typeof healthBody.platform === 'string');
    check('/api/health segnala dry-run attivo', healthBody.dryRun === true);

    const deckNoToken = await fetch(`${base}${ENDPOINTS.deck}`);
    check('/api/deck senza token -> 401', deckNoToken.status === 401, `status=${deckNoToken.status}`);

    const deckBadToken = await fetch(`${base}${ENDPOINTS.deck}?token=sbagliato`);
    check('/api/deck con token errato -> 401', deckBadToken.status === 401, `status=${deckBadToken.status}`);

    const deckRes = await fetch(`${base}${ENDPOINTS.deck}?token=${TOKEN}`);
    const deckBody = await deckRes.json();
    check('/api/deck con token -> 200', deckRes.status === 200, `status=${deckRes.status}`);
    check('il layout contiene almeno un profilo',
      Array.isArray(deckBody.deck?.profiles) && deckBody.deck.profiles.length > 0);
    const firstPage = deckBody.deck?.profiles?.[0]?.pages?.[0];
    check('la prima pagina contiene bottoni', Array.isArray(firstPage?.buttons) && firstPage.buttons.length > 0);
    check('il layout NON espone il token', !JSON.stringify(deckBody).includes(TOKEN));

    const pressNoToken = await fetch(`${base}${ENDPOINTS.press}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buttonId: 'media-playpause' })
    });
    check('POST /api/press senza token -> 401', pressNoToken.status === 401, `status=${pressNoToken.status}`);

    const pressRes = await fetch(`${base}${ENDPOINTS.press}?token=${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buttonId: 'media-playpause' })
    });
    const pressBody = await pressRes.json();
    check('POST /api/press con token -> 200', pressRes.status === 200, `status=${pressRes.status}`);
    check('la pressione REST e\' confermata in dry-run',
      pressBody.ok === true && pressBody.result?.dryRun === true, JSON.stringify(pressBody));

    const unknownPress = await fetch(`${base}${ENDPOINTS.press}?token=${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buttonId: 'non-esiste' })
    });
    check('pressione di un bottone inesistente -> 404', unknownPress.status === 404, `status=${unknownPress.status}`);

    // ---------------------------------------------------------------
    console.log('\n2) WebSocket full (client PWA)');
    const ws = await connectWebSocket(`ws://127.0.0.1:${info.port}${ENDPOINTS.ws}`);
    const hello = await waitForMessage(ws, (m) => m.type === MSG.hello, { label: 'hello' });
    check('il server invia hello', hello.type === MSG.hello && typeof hello.protocol === 'number');
    check('hello segnala che il token e\' richiesto', hello.requiresToken === true);

    ws.send({ type: MSG.auth, token: TOKEN });
    const authOk = await waitForMessage(ws, (m) => m.type === MSG.authOk, { label: 'auth-ok' });
    check('autenticazione WebSocket riuscita', authOk.type === MSG.authOk);

    const deckMsg = await waitForMessage(ws, (m) => m.type === MSG.deck, { label: 'deck' });
    check('dopo l\'autenticazione arriva il deck', Array.isArray(deckMsg.deck?.profiles));

    const stateMsg = await waitForMessage(ws, (m) => m.type === MSG.state, { label: 'state' });
    check('dopo l\'autenticazione arriva lo stato',
      typeof stateMsg.state?.activeProfile === 'string' && typeof stateMsg.state?.activePage === 'string');
    check('lo stato riporta dry-run attivo', stateMsg.state.dryRun === true);

    ws.send({ type: MSG.press, buttonId: 'media-playpause', requestId: 'req-1' });
    const ack = await waitForMessage(ws, (m) => m.type === MSG.ack && m.requestId === 'req-1', { label: 'ack pressione' });
    check('la pressione via WebSocket riceve ack ok', ack.ok === true, JSON.stringify(ack));
    check('l\'ack conferma l\'esecuzione in dry-run', ack.result?.dryRun === true);
    check('l\'ack descrive l\'azione simulata',
      typeof ack.result?.description === 'string' && ack.result.description.length > 0, JSON.stringify(ack.result));

    ws.send({ type: MSG.navigate, page: 'utility', requestId: 'req-2' });
    const navAck = await waitForMessage(ws, (m) => m.type === MSG.ack && m.requestId === 'req-2', { label: 'ack navigate' });
    check('il cambio pagina via WebSocket funziona', navAck.ok === true && navAck.result?.pageId === 'utility', JSON.stringify(navAck));

    ws.close(1000, 'fine test');

    // ---------------------------------------------------------------
    console.log('\n3) WebSocket senza token');
    const wsAnon = await connectWebSocket(`ws://127.0.0.1:${info.port}${ENDPOINTS.ws}`);
    await waitForMessage(wsAnon, (m) => m.type === MSG.hello, { label: 'hello anonimo' });
    wsAnon.send({ type: MSG.press, buttonId: 'media-playpause' });
    const err = await waitForMessage(wsAnon, (m) => m.type === MSG.error, { label: 'errore di autorizzazione' });
    check('il client non autenticato non puo\' premere bottoni', err.code === 'unauthorized', JSON.stringify(err));

    const closed = new Promise((resolve) => wsAnon.once('close', resolve));
    wsAnon.send({ type: MSG.auth, token: 'token-sbagliato' });
    await waitForMessage(wsAnon, (m) => m.type === MSG.error, { label: 'errore token' }).catch(() => {});
    const closeInfo = await Promise.race([closed, new Promise((r) => setTimeout(() => r(null), 3000))]);
    check('token errato -> connessione chiusa', closeInfo !== null, 'la connessione e\' rimasta aperta');

    // ---------------------------------------------------------------
    console.log('\n4) Protocollo lite (ESP32)');
    const liteNoToken = await fetch(`${base}${ENDPOINTS.liteDeck}`);
    check('/api/lite/deck senza token -> 401', liteNoToken.status === 401, `status=${liteNoToken.status}`);

    const liteRes = await fetch(`${base}${ENDPOINTS.liteDeck}?token=${TOKEN}`);
    const lite = await liteRes.json();
    check('/api/lite/deck con token -> 200', liteRes.status === 200, `status=${liteRes.status}`);
    check('il layout lite usa i campi compatti',
      lite[LITE_FIELDS.version] === 1 && Array.isArray(lite[LITE_FIELDS.buttons]),
      JSON.stringify(lite).slice(0, 200));
    const liteButton = lite[LITE_FIELDS.buttons][0];
    check('i bottoni lite hanno id/label/riga/colonna',
      typeof liteButton[LITE_FIELDS.id] === 'string'
      && typeof liteButton[LITE_FIELDS.label] === 'string'
      && Number.isInteger(liteButton[LITE_FIELDS.row])
      && Number.isInteger(liteButton[LITE_FIELDS.col]),
      JSON.stringify(liteButton));

    const wsLiteDenied = await connectWebSocket(`ws://127.0.0.1:${info.port}${ENDPOINTS.wsLite}`).then(
      () => null,
      (e) => e
    );
    check('/ws/lite senza token -> handshake rifiutato',
      wsLiteDenied !== null && wsLiteDenied.statusCode === 401,
      wsLiteDenied ? wsLiteDenied.message : 'connessione accettata');

    const wsLite = await connectWebSocket(`ws://127.0.0.1:${info.port}${ENDPOINTS.wsLite}?token=${TOKEN}`);
    const liteHello = await waitForMessage(wsLite, (m) => m[LITE_FIELDS.type] === LITE_MSG.hello, { label: 'hello lite' });
    check('il canale lite invia hello compatto', liteHello[LITE_FIELDS.version] === 1, JSON.stringify(liteHello));

    wsLite.send({ [LITE_FIELDS.type]: LITE_MSG.press, [LITE_FIELDS.id]: 'lock-station' });
    const liteAck = await waitForMessage(wsLite, (m) => m[LITE_FIELDS.type] === LITE_MSG.ack, { label: 'ack lite' });
    check('la pressione lite riceve ack positivo', liteAck[LITE_FIELDS.ok] === 1, JSON.stringify(liteAck));
    wsLite.close(1000, 'fine test');

    // ---------------------------------------------------------------
    console.log('\n5) Pairing con PIN');
    const badPin = await fetch(`${base}${ENDPOINTS.pair}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '000000' })
    });
    check('PIN errato -> 401', badPin.status === 401, `status=${badPin.status}`);

    const goodPin = await fetch(`${base}${ENDPOINTS.pair}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: host.configStore.get().settings.security.pin })
    });
    const pairBody = await goodPin.json();
    check('PIN corretto -> token restituito', goodPin.status === 200 && pairBody.token === TOKEN, JSON.stringify(pairBody));

    // ---------------------------------------------------------------
    console.log('\n6) Client web servito dall\'host');
    const indexRes = await fetch(`${base}/`);
    const indexText = await indexRes.text();
    check('GET / restituisce la PWA', indexRes.status === 200 && indexText.includes('<html'), `status=${indexRes.status}`);
  } finally {
    await host.stop();
  }

  console.log(`\nRisultato: ${passed} verifiche superate, ${failures.length} fallite`);
  if (failures.length > 0) {
    console.log('Verifiche fallite:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('SMOKE TEST OK\n');
  }
}

main().catch((err) => {
  console.error('\nsmoke test interrotto da un errore:');
  console.error(err);
  process.exitCode = 1;
});
