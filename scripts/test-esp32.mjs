#!/usr/bin/env node
/**
 * Test di conformita' del firmware ESP32 al protocollo lite.
 *
 * Verifica in cinque fasi:
 *   1. presenza dei file del progetto PlatformIO;
 *   2. corrispondenza esatta fra firmware/esp32/include/wdeck_protocol.h
 *      e shared/protocol.mjs (versione, endpoint, campi, tipi di messaggio);
 *   3. uso delle macro nel sorgente (nessun endpoint o chiave JSON scritta a mano);
 *   4. configurazione del display in platformio.ini;
 *   5. prova end-to-end contro un host reale, usando *solo* i valori estratti
 *      dall'header C: layout scaricato, campi presenti, pressione confermata.
 *
 * Uso: npm run test:esp32
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ENDPOINTS,
  LITE_FIELDS,
  LITE_MSG,
  LITE_PROTOCOL_VERSION,
  TOKEN_HEADER,
  TOKEN_QUERY
} from '../shared/protocol.mjs';
import { createHost } from '../src/host/index.mjs';
import { connectWebSocket, waitForMessage } from '../src/host/ws/client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FW = path.join(ROOT, 'firmware', 'esp32');
const TOKEN = 'esp32-conformance-token-1';

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

/** camelCase -> SNAKE_UPPER (dryRun -> DRY_RUN). */
const toMacroSuffix = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

/** Estrae le #define da un header C. */
export function parseDefines(source) {
  const defines = {};
  const re = /^[ \t]*#define[ \t]+(WDECK_[A-Z0-9_]+)[ \t]+(.+)$/gm;
  let match;
  while ((match = re.exec(source)) !== null) {
    let value = match[2].replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '').trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (/^-?\d+$/.test(value)) value = Number(value);
    defines[match[1]] = value;
  }
  return defines;
}

const read = (relative) => fs.readFileSync(path.join(FW, relative), 'utf8');

async function main() {
  console.log('\nWdeck - conformita\' firmware ESP32 <-> protocollo lite\n');

  // ---------------------------------------------------------------
  console.log('1) Struttura del progetto PlatformIO');
  const requiredFiles = [
    'platformio.ini',
    'include/wdeck_protocol.h',
    'include/wdeck_config.h',
    'src/main.cpp',
    'README.md'
  ];
  for (const file of requiredFiles) {
    check(`presente firmware/esp32/${file}`, fs.existsSync(path.join(FW, file)));
  }
  if (failures.length > 0) {
    console.log('\nStruttura incompleta: test interrotto.');
    process.exitCode = 1;
    return;
  }

  const header = read('include/wdeck_protocol.h');
  const config = read('include/wdeck_config.h');
  const main = read('src/main.cpp');
  const ini = read('platformio.ini');
  const defines = parseDefines(header);

  // ---------------------------------------------------------------
  console.log('\n2) Header C allineato a shared/protocol.mjs');
  check('la versione del protocollo lite coincide',
    defines.WDECK_LITE_PROTOCOL_VERSION === LITE_PROTOCOL_VERSION,
    `header=${defines.WDECK_LITE_PROTOCOL_VERSION} shared=${LITE_PROTOCOL_VERSION}`);

  const endpointMap = {
    WDECK_EP_HEALTH: ENDPOINTS.health,
    WDECK_EP_LITE_DECK: ENDPOINTS.liteDeck,
    WDECK_EP_LITE_STATE: ENDPOINTS.liteState,
    WDECK_EP_LITE_PRESS: ENDPOINTS.litePress,
    WDECK_EP_WS_LITE: ENDPOINTS.wsLite
  };
  for (const [macro, expected] of Object.entries(endpointMap)) {
    check(`${macro} == "${expected}"`, defines[macro] === expected, `header=${defines[macro]}`);
  }

  check(`WDECK_TOKEN_QUERY == "${TOKEN_QUERY}"`, defines.WDECK_TOKEN_QUERY === TOKEN_QUERY, `header=${defines.WDECK_TOKEN_QUERY}`);
  check(`WDECK_TOKEN_HEADER == "${TOKEN_HEADER}"`, defines.WDECK_TOKEN_HEADER === TOKEN_HEADER, `header=${defines.WDECK_TOKEN_HEADER}`);

  for (const [name, value] of Object.entries(LITE_FIELDS)) {
    const macro = `WDECK_F_${toMacroSuffix(name)}`;
    check(`${macro} == "${value}" (LITE_FIELDS.${name})`, defines[macro] === value, `header=${JSON.stringify(defines[macro])}`);
  }

  for (const [name, value] of Object.entries(LITE_MSG)) {
    const macro = `WDECK_MSG_${toMacroSuffix(name)}`;
    check(`${macro} == "${value}" (LITE_MSG.${name})`, defines[macro] === value, `header=${JSON.stringify(defines[macro])}`);
  }

  const expectedFieldMacros = new Set(Object.keys(LITE_FIELDS).map((n) => `WDECK_F_${toMacroSuffix(n)}`));
  const expectedMsgMacros = new Set(Object.keys(LITE_MSG).map((n) => `WDECK_MSG_${toMacroSuffix(n)}`));
  const extraFields = Object.keys(defines).filter((k) => k.startsWith('WDECK_F_') && !expectedFieldMacros.has(k));
  const extraMsgs = Object.keys(defines).filter((k) => k.startsWith('WDECK_MSG_') && !expectedMsgMacros.has(k));
  check('nessun campo definito solo nel firmware', extraFields.length === 0, extraFields.join(', '));
  check('nessun tipo di messaggio definito solo nel firmware', extraMsgs.length === 0, extraMsgs.join(', '));

  // ---------------------------------------------------------------
  console.log('\n3) Il sorgente usa le macro, non stringhe letterali');
  const macrosUsed = new Set(main.match(/WDECK_[A-Z0-9_]+/g) ?? []);
  const mustUse = [
    'WDECK_EP_LITE_DECK', 'WDECK_EP_LITE_PRESS', 'WDECK_EP_WS_LITE',
    'WDECK_TOKEN_QUERY', 'WDECK_TOKEN_HEADER', 'WDECK_LITE_PROTOCOL_VERSION',
    'WDECK_F_VERSION', 'WDECK_F_ROWS', 'WDECK_F_COLS', 'WDECK_F_BUTTONS',
    'WDECK_F_ID', 'WDECK_F_LABEL', 'WDECK_F_ROW', 'WDECK_F_COL', 'WDECK_F_TYPE',
    'WDECK_F_OK', 'WDECK_F_DRY_RUN', 'WDECK_F_PAGE', 'WDECK_F_PROFILE',
    'WDECK_MSG_PRESS', 'WDECK_MSG_ACK', 'WDECK_MSG_NAVIGATE', 'WDECK_MSG_STATE', 'WDECK_MSG_PING'
  ];
  for (const macro of mustUse) {
    check(`main.cpp usa ${macro}`, macrosUsed.has(macro));
  }

  for (const [macro, value] of Object.entries(endpointMap)) {
    check(`main.cpp non contiene l'endpoint letterale "${value}"`, !main.includes(`"${value}"`), macro);
  }

  const literalKeyUse = main.match(/\[\s*"[a-z]"\s*\]/g) ?? [];
  check('main.cpp non accede al JSON con chiavi letterali', literalKeyUse.length === 0, literalKeyUse.join(', '));

  check('main.cpp include entrambi gli header del progetto',
    main.includes('"wdeck_protocol.h"') && main.includes('"wdeck_config.h"'));
  check('main.cpp verifica la versione del protocollo ricevuta',
    /WDECK_F_VERSION[\s\S]{0,200}WDECK_LITE_PROTOCOL_VERSION/.test(main));

  // ---------------------------------------------------------------
  console.log('\n4) platformio.ini e configurazione del display');
  check('platform espressif32', /platform\s*=\s*espressif32/.test(ini));
  check('framework arduino', /framework\s*=\s*arduino/.test(ini));
  for (const lib of ['TFT_eSPI', 'ArduinoJson', 'WebSockets']) {
    check(`lib_deps include ${lib}`, ini.includes(lib));
  }
  check('almeno un ambiente definisce un driver di display',
    /-D(ILI9341|ILI9341_2|ST7789|ST7735|ILI9488|GC9A01)_DRIVER=1/.test(ini));
  check('dimensioni del display configurate', /-DTFT_WIDTH=\d+/.test(ini) && /-DTFT_HEIGHT=\d+/.test(ini));
  check('pin del display configurati', /-DTFT_CS=/.test(ini) && /-DTFT_DC=/.test(ini));
  check('touch configurato in almeno un ambiente', /-DTOUCH_CS=/.test(ini));
  check('sono presenti piu\' ambienti di scheda', (ini.match(/^\[env:/gm) ?? []).length >= 2);
  check('wdeck_config.h espone host, porta e token',
    /WDECK_HOST_ADDR/.test(config) && /WDECK_HOST_PORT/.test(config) && /WDECK_TOKEN/.test(config));
  check('wdeck_config.h espone i parametri del display',
    /WDECK_TFT_ROTATION/.test(config) && /WDECK_TOUCH_THRESHOLD/.test(config));

  // ---------------------------------------------------------------
  console.log('\n5) Prova end-to-end contro un host reale');
  // Copia di lavoro della configurazione: la prova end-to-end usa la deck.json
  // vera, ma non deve lasciarci dentro registri o dispositivi.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-esp32-'));
  const tmpConfig = path.join(tmpDir, 'deck.json');
  fs.copyFileSync(path.join(ROOT, 'deck.json'), tmpConfig);

  const host = createHost({
    configFile: tmpConfig,
    overrides: { port: 0, host: '127.0.0.1', token: TOKEN, dryRun: true },
    logger: { info() {}, warn() {}, error() {}, debug() {}, log() {} },
    watch: false,
    tray: false
  });
  const info = await host.start();
  const base = `http://127.0.0.1:${info.port}`;

  try {
    // URL costruito esattamente come fa buildUrl() nel firmware
    const layoutUrl = `${base}${defines.WDECK_EP_LITE_DECK}?${defines.WDECK_TOKEN_QUERY}=${TOKEN}`;
    const res = await fetch(layoutUrl, { headers: { [defines.WDECK_TOKEN_HEADER]: TOKEN } });
    check('l\'host risponde all\'URL costruito dal firmware', res.status === 200, `status=${res.status}`);

    const layout = await res.json();
    check('la versione ricevuta e\' quella attesa dal firmware',
      layout[defines.WDECK_F_VERSION] === defines.WDECK_LITE_PROTOCOL_VERSION,
      JSON.stringify(layout).slice(0, 120));

    for (const macro of ['WDECK_F_PROFILE', 'WDECK_F_PAGE', 'WDECK_F_ROWS', 'WDECK_F_COLS', 'WDECK_F_BUTTONS', 'WDECK_F_DRY_RUN']) {
      check(`il layout contiene il campo letto tramite ${macro}`, defines[macro] in layout, Object.keys(layout).join(','));
    }

    const buttonsKey = defines.WDECK_F_BUTTONS;
    check('il layout contiene almeno un bottone', Array.isArray(layout[buttonsKey]) && layout[buttonsKey].length > 0);

    const first = layout[buttonsKey][0];
    for (const macro of ['WDECK_F_ID', 'WDECK_F_LABEL', 'WDECK_F_ROW', 'WDECK_F_COL']) {
      check(`ogni bottone espone il campo di ${macro}`,
        layout[buttonsKey].every((b) => defines[macro] in b),
        JSON.stringify(first));
    }

    check('le coordinate dei bottoni stanno nella griglia dichiarata',
      layout[buttonsKey].every((b) => b[defines.WDECK_F_ROW] < layout[defines.WDECK_F_ROWS]
        && b[defines.WDECK_F_COL] < layout[defines.WDECK_F_COLS]));

    check('il payload del layout resta gestibile dall\'ESP32 (< 4 KB)',
      JSON.stringify(layout).length < 4096, `${JSON.stringify(layout).length} byte`);

    // WebSocket lite, stesso path del firmware
    const wsPath = `${defines.WDECK_EP_WS_LITE}?${defines.WDECK_TOKEN_QUERY}=${TOKEN}`;
    const ws = await connectWebSocket(`ws://127.0.0.1:${info.port}${wsPath}`);
    const hello = await waitForMessage(ws, (m) => m[defines.WDECK_F_TYPE] === defines.WDECK_MSG_HELLO, { label: 'hello lite' });
    check('l\'host invia il messaggio di benvenuto atteso dal firmware',
      hello[defines.WDECK_F_VERSION] === defines.WDECK_LITE_PROTOCOL_VERSION, JSON.stringify(hello));

    // payload identico a quello prodotto da sendPress()
    ws.send({
      [defines.WDECK_F_TYPE]: defines.WDECK_MSG_PRESS,
      [defines.WDECK_F_ID]: first[defines.WDECK_F_ID]
    });
    const ack = await waitForMessage(ws, (m) => m[defines.WDECK_F_TYPE] === defines.WDECK_MSG_ACK, { label: 'ack lite' });
    check('la pressione inviata dal firmware riceve un ack positivo',
      ack[defines.WDECK_F_OK] === 1, JSON.stringify(ack));
    check('l\'ack riporta l\'id del bottone premuto',
      ack[defines.WDECK_F_ID] === first[defines.WDECK_F_ID], JSON.stringify(ack));

    ws.send({ [defines.WDECK_F_TYPE]: defines.WDECK_MSG_PING });
    const pong = await waitForMessage(ws, (m) => m[defines.WDECK_F_TYPE] === defines.WDECK_MSG_PONG, { label: 'pong lite' });
    check('il ping del firmware riceve pong', pong !== null);

    ws.close(1000, 'fine test');

    // REST di ripiego usato quando il WebSocket non e' disponibile
    const restRes = await fetch(`${base}${defines.WDECK_EP_LITE_PRESS}?${defines.WDECK_TOKEN_QUERY}=${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [defines.WDECK_TOKEN_HEADER]: TOKEN },
      body: JSON.stringify({ [defines.WDECK_F_ID]: first[defines.WDECK_F_ID] })
    });
    const restBody = await restRes.json();
    check('il ripiego REST del firmware funziona',
      restRes.status === 200 && restBody[defines.WDECK_F_OK] === 1, JSON.stringify(restBody));

    const denied = await fetch(`${base}${defines.WDECK_EP_LITE_DECK}`);
    check('senza token l\'host rifiuta anche i dispositivi lite', denied.status === 401, `status=${denied.status}`);
  } finally {
    await host.stop();
  }

  console.log(`\nRisultato: ${passed} verifiche superate, ${failures.length} fallite`);
  if (failures.length > 0) {
    console.log('Verifiche fallite:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('CONFORMITA\' ESP32 OK\n');
  }
}

main().catch((err) => {
  console.error('\ntest di conformita\' interrotto da un errore:');
  console.error(err);
  process.exitCode = 1;
});
