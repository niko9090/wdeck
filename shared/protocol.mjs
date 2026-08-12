/**
 * Definizione unica e condivisa del protocollo Wdeck.
 *
 * Questo modulo e' la "single source of truth" usata da:
 *  - host Node.js  (src/host/**)
 *  - client web PWA (web/** , importato come /shared/protocol.mjs)
 *  - test di conformita' del firmware ESP32 (scripts/test-esp32.mjs)
 *
 * Qualunque modifica qui deve essere riflessa in firmware/esp32/include/wdeck_protocol.h,
 * altrimenti `npm run test:esp32` fallisce.
 */

/** Versione del protocollo "full" (client web). */
export const PROTOCOL_VERSION = 1;

/** Versione del protocollo "lite" (ESP32 / microcontrollori). */
export const LITE_PROTOCOL_VERSION = 1;

/** Nome dell'header HTTP alternativo alla query string per il token. */
export const TOKEN_HEADER = 'x-wdeck-token';

/** Nome del parametro query per il token. */
export const TOKEN_QUERY = 'token';

/** Endpoint HTTP/WebSocket esposti dall'host. */
export const ENDPOINTS = {
  // --- full API (client web) ---
  health: '/api/health',
  deck: '/api/deck',
  state: '/api/state',
  press: '/api/press',
  pair: '/api/pair',
  actions: '/api/actions',
  reload: '/api/reload',
  ws: '/ws',
  // --- lite API (ESP32) ---
  liteDeck: '/api/lite/deck',
  liteState: '/api/lite/state',
  litePress: '/api/lite/press',
  wsLite: '/ws/lite'
};

/** Tipi di messaggio WebSocket del protocollo full. */
export const MSG = {
  hello: 'hello',
  auth: 'auth',
  authOk: 'auth-ok',
  state: 'state',
  deck: 'deck',
  press: 'press',
  ack: 'ack',
  event: 'event',
  error: 'error',
  navigate: 'navigate',
  reload: 'reload',
  ping: 'ping',
  pong: 'pong'
};

/**
 * Mappa dei nomi di campo compatti del protocollo lite.
 * Chiave = nome leggibile, valore = chiave JSON effettivamente trasmessa.
 */
export const LITE_FIELDS = {
  version: 'v',
  profile: 'f',
  page: 'p',
  rows: 'r',
  cols: 'c',
  buttons: 'b',
  id: 'i',
  label: 'l',
  col: 'x',
  row: 'y',
  color: 'g',
  icon: 'n',
  type: 't',
  ok: 'k',
  error: 'e',
  message: 'm',
  timestamp: 's',
  pages: 'q',
  dryRun: 'd'
};

/** Tipi di messaggio (campo `t`) del protocollo lite su WebSocket. */
export const LITE_MSG = {
  hello: 'h',
  auth: 'u',
  authOk: 'k',
  state: 's',
  press: 'p',
  ack: 'a',
  error: 'e',
  ping: 'i',
  pong: 'o',
  navigate: 'n'
};

/** Codici di errore applicativi, condivisi fra REST e WebSocket. */
export const ERROR_CODES = {
  unauthorized: 'unauthorized',
  badRequest: 'bad_request',
  notFound: 'not_found',
  forbidden: 'forbidden',
  actionFailed: 'action_failed',
  unsupportedAction: 'unsupported_action',
  rateLimited: 'rate_limited',
  internal: 'internal'
};

/** Codici di chiusura WebSocket usati dall'host. */
export const WS_CLOSE = {
  normal: 1000,
  goingAway: 1001,
  protocolError: 1002,
  policyViolation: 1008,
  tooBig: 1009,
  internal: 1011
};

/**
 * Comprime un oggetto bottone "full" nella forma lite.
 * @param {object} button
 * @returns {object}
 */
export function toLiteButton(button) {
  const F = LITE_FIELDS;
  const out = {
    [F.id]: button.id,
    [F.label]: button.label ?? '',
    [F.col]: button.col ?? 0,
    [F.row]: button.row ?? 0
  };
  if (button.color) out[F.color] = button.color;
  if (button.icon) out[F.icon] = button.icon;
  if (button.action?.type) out[F.type] = button.action.type;
  return out;
}

/**
 * Comprime una pagina "full" nella forma lite (layout scaricabile dall'ESP32).
 * @param {object} page
 * @param {{profileId?: string, dryRun?: boolean}} [ctx]
 */
export function toLitePage(page, ctx = {}) {
  const F = LITE_FIELDS;
  const out = {
    [F.version]: LITE_PROTOCOL_VERSION,
    [F.page]: page.id,
    [F.rows]: page.rows,
    [F.cols]: page.cols,
    [F.buttons]: (page.buttons ?? []).map(toLiteButton)
  };
  if (ctx.profileId) out[F.profile] = ctx.profileId;
  if (ctx.dryRun !== undefined) out[F.dryRun] = ctx.dryRun ? 1 : 0;
  if (ctx.pages) out[F.pages] = ctx.pages;
  return out;
}

/** Elenco piatto delle chiavi lite, utile ai test di conformita'. */
export const LITE_FIELD_KEYS = Object.values(LITE_FIELDS);

/** Elenco piatto dei tipi messaggio lite, utile ai test di conformita'. */
export const LITE_MSG_KEYS = Object.values(LITE_MSG);
