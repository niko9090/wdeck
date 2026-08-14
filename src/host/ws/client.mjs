/**
 * Client WebSocket minimale (usato dallo smoke test e dagli strumenti CLI).
 * Non ha lo scopo di sostituire una libreria completa: implementa l'handshake
 * RFC 6455 e riusa lo stesso wrapper di connessione del server.
 */

import http from 'node:http';
import https from 'node:https';
import { WebSocketConnection } from './connection.mjs';
import { acceptKey, generateKey } from './frame.mjs';

/**
 * Apre una connessione WebSocket verso `url`.
 * @param {string} url es. ws://127.0.0.1:8899/ws?token=abc
 * @param {{headers?: object, timeoutMs?: number, maxPayload?: number}} [options]
 * @returns {Promise<WebSocketConnection>}
 */
export function connectWebSocket(url, { headers = {}, timeoutMs = 5000, maxPayload = 1024 * 1024, rejectUnauthorized } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const secure = target.protocol === 'wss:';
    const transport = secure ? https : http;
    const key = generateKey();

    const req = transport.request({
      hostname: target.hostname,
      port: target.port || (secure ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      // Un host con certificato autofirmato non e' verificabile da nessuna
      // autorita': chi si collega deve poterlo accettare esplicitamente, come
      // fa l'utente davanti all'avviso del browser.
      ...(secure && rejectUnauthorized !== undefined ? { rejectUnauthorized } : {}),
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
        ...headers
      }
    });

    const timer = setTimeout(() => {
      req.destroy(new Error(`timeout di connessione WebSocket verso ${url}`));
    }, timeoutMs);

    req.on('upgrade', (res, socket, head) => {
      clearTimeout(timer);
      if (res.headers['sec-websocket-accept'] !== acceptKey(key)) {
        socket.destroy();
        reject(new Error('handshake WebSocket non valido: Sec-WebSocket-Accept errato'));
        return;
      }
      const conn = new WebSocketConnection(socket, { isServer: false, maxPayload, head });
      // la coda va agganciata subito: i messaggi possono arrivare a raffica
      // (hello + auth-ok + deck + state) nello stesso frame TCP.
      ensureQueue(conn);
      resolve(conn);
    });

    req.on('response', (res) => {
      clearTimeout(timer);
      let body = '';
      res.on('data', (d) => { body += d.toString(); });
      res.on('end', () => {
        const err = new Error(`handshake WebSocket rifiutato: HTTP ${res.statusCode} ${body.slice(0, 200)}`);
        err.statusCode = res.statusCode;
        reject(err);
      });
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    req.end();
  });
}

/**
 * Aggancia (una sola volta) una coda che bufferizza i messaggi JSON ricevuti.
 * Serve perche' l'host puo' inviare piu' messaggi consecutivi nello stesso
 * frame TCP: senza buffer, quelli emessi mentre nessuno e' in ascolto
 * andrebbero persi.
 * @param {WebSocketConnection} conn
 */
export function ensureQueue(conn) {
  if (conn.messageQueue) return conn.messageQueue;

  const queue = { messages: [], waiters: [], closed: null };
  conn.messageQueue = queue;

  conn.on('message', (raw) => {
    let parsed;
    try {
      parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    } catch {
      return;
    }
    const index = queue.waiters.findIndex((w) => w.predicate(parsed));
    if (index >= 0) {
      const [waiter] = queue.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(parsed);
    } else {
      queue.messages.push(parsed);
      if (queue.messages.length > 200) queue.messages.shift();
    }
  });

  conn.on('close', (info) => {
    queue.closed = info;
    for (const waiter of queue.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`connessione chiusa (${info.code}) mentre si attendeva ${waiter.label}`));
    }
  });

  return queue;
}

/**
 * Attende il primo messaggio che soddisfa il predicato (anche se gia' ricevuto).
 * @param {WebSocketConnection} conn
 * @param {(msg: object) => boolean} predicate
 * @param {{timeoutMs?: number, label?: string}} [options]
 * @returns {Promise<object>}
 */
export function waitForMessage(conn, predicate, { timeoutMs = 5000, label = 'messaggio' } = {}) {
  const queue = ensureQueue(conn);

  const buffered = queue.messages.findIndex(predicate);
  if (buffered >= 0) return Promise.resolve(queue.messages.splice(buffered, 1)[0]);

  if (queue.closed) {
    return Promise.reject(new Error(`connessione gia' chiusa (${queue.closed.code}): impossibile attendere ${label}`));
  }

  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, reject, label, timer: null };
    waiter.timer = setTimeout(() => {
      const index = queue.waiters.indexOf(waiter);
      if (index >= 0) queue.waiters.splice(index, 1);
      reject(new Error(`timeout in attesa di ${label}`));
    }, timeoutMs);
    queue.waiters.push(waiter);
  });
}
