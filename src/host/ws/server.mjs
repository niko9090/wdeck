/**
 * Gestione dell'handshake WebSocket lato server, senza dipendenze esterne.
 * Si aggancia all'evento 'upgrade' di un http.Server.
 */

import { WebSocketConnection } from './connection.mjs';
import { acceptKey } from './frame.mjs';

/** Risponde all'handshake con un errore HTTP e chiude il socket. */
export function rejectUpgrade(socket, status = 400, message = 'Bad Request') {
  const body = JSON.stringify({ ok: false, error: message });
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\n`
    + 'Connection: close\r\n'
    + 'Content-Type: application/json\r\n'
    + `Content-Length: ${Buffer.byteLength(body)}\r\n`
    + '\r\n'
    + body
  );
}

/**
 * Crea il gestore di upgrade.
 * @param {{
 *   routes: Record<string, (conn: WebSocketConnection, req: import('node:http').IncomingMessage) => void>,
 *   verify?: (req: import('node:http').IncomingMessage, pathname: string) => {ok: boolean, status?: number, message?: string},
 *   maxPayload?: number,
 *   heartbeatMs?: number,
 *   logger?: object
 * }} options
 */
export function createUpgradeHandler({ routes, verify, maxPayload = 256 * 1024, heartbeatMs = 30000, logger = console }) {
  /** @type {Set<WebSocketConnection>} */
  const connections = new Set();

  const heartbeat = setInterval(() => {
    for (const conn of connections) {
      if (conn.data.alive === false) {
        conn.terminate();
        continue;
      }
      conn.data.alive = false;
      conn.ping();
    }
  }, heartbeatMs);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:net').Socket} socket
   * @param {Buffer} head
   */
  function handleUpgrade(req, socket, head) {
    const pathname = (req.url ?? '/').split('?')[0];
    const handler = routes[pathname];
    if (!handler) return rejectUpgrade(socket, 404, 'Not Found');

    if ((req.headers.upgrade ?? '').toLowerCase() !== 'websocket') {
      return rejectUpgrade(socket, 400, 'Upgrade richiesto');
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) return rejectUpgrade(socket, 400, 'Sec-WebSocket-Key mancante');
    if (req.headers['sec-websocket-version'] !== '13') {
      return rejectUpgrade(socket, 426, 'Versione WebSocket non supportata');
    }

    if (verify) {
      const result = verify(req, pathname);
      if (!result.ok) return rejectUpgrade(socket, result.status ?? 401, result.message ?? 'Unauthorized');
    }

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n`
      + '\r\n'
    );

    const conn = new WebSocketConnection(socket, { isServer: true, maxPayload, head });
    conn.data.alive = true;
    conn.data.path = pathname;
    conn.data.remote = socket.remoteAddress ?? 'sconosciuto';
    conn.on('pong', () => { conn.data.alive = true; });
    conn.on('message', () => { conn.data.alive = true; });
    conn.on('error', (err) => logger.warn?.(`[wdeck] errore WebSocket (${pathname}): ${err.message}`));
    connections.add(conn);
    conn.on('close', () => connections.delete(conn));

    try {
      handler(conn, req);
    } catch (err) {
      logger.error?.(`[wdeck] handler WebSocket fallito: ${err.message}`);
      conn.close(1011, 'errore interno');
    }
    return undefined;
  }

  return {
    handleUpgrade,
    connections,
    /** Chiude tutte le connessioni e ferma l'heartbeat. */
    closeAll(code = 1001, reason = 'server in chiusura') {
      clearInterval(heartbeat);
      for (const conn of connections) conn.close(code, reason);
      connections.clear();
    }
  };
}
