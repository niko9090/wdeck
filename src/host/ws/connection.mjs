/**
 * Wrapper di connessione WebSocket costruito sopra a un socket TCP grezzo.
 * Usato sia dal server (frame non mascherati) sia dal client (frame mascherati).
 */

import { EventEmitter } from 'node:events';
import {
  OPCODES,
  FrameParser,
  ProtocolError,
  encodeFrame,
  encodeCloseBody,
  decodeCloseBody
} from './frame.mjs';

export const READY_STATE = Object.freeze({ OPEN: 1, CLOSING: 2, CLOSED: 3 });

/**
 * Tetto della coda di uscita del socket. Oltre questo valore un client lento
 * farebbe accumulare frame in memoria senza limite (DoS): meglio chiuderlo.
 */
const MAX_OUTBOUND_BYTES = 4 * 1024 * 1024;

/**
 * Decoder UTF-8 rigoroso per i frame di testo: le sequenze non valide devono
 * chiudere la connessione con 1007, non essere sostituite da U+FFFD.
 */
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });

export class WebSocketConnection extends EventEmitter {
  /**
   * @param {import('node:net').Socket} socket
   * @param {{isServer?: boolean, maxPayload?: number, head?: Buffer}} [options]
   */
  constructor(socket, { isServer = true, maxPayload = 1024 * 1024, head } = {}) {
    super();
    this.socket = socket;
    this.isServer = isServer;
    this.readyState = READY_STATE.OPEN;
    this.parser = new FrameParser({ maxPayload, requireMask: isServer });
    /** Dati applicativi liberi (id client, autenticazione, ...). */
    this.data = {};

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this.#onData(chunk));
    socket.on('error', (err) => this.emit('error', err));
    socket.on('close', () => this.#finish(1006, 'socket chiuso'));

    // I dati arrivati insieme all'handshake vengono elaborati al tick successivo:
    // altrimenti gli eventi verrebbero emessi prima che il chiamante possa
    // registrare i propri listener.
    if (head && head.length > 0) setImmediate(() => this.#onData(head));
  }

  #onData(chunk) {
    let messages;
    try {
      messages = this.parser.push(chunk);
    } catch (err) {
      const code = err instanceof ProtocolError ? err.code : 1002;
      this.emit('error', err);
      this.close(code, err.message);
      return;
    }

    for (const { opcode, payload } of messages) {
      switch (opcode) {
        case OPCODES.TEXT: {
          // Un frame di testo deve essere UTF-8 valido: sequenze rotte -> 1007.
          let str;
          try {
            str = UTF8_STRICT.decode(payload);
          } catch {
            this.close(1007, 'testo non UTF-8 valido');
            return;
          }
          this.emit('message', str, false);
          break;
        }
        case OPCODES.BINARY:
          this.emit('message', payload, true);
          break;
        case OPCODES.PING:
          this.#write(encodeFrame(OPCODES.PONG, payload, { mask: !this.isServer }));
          this.emit('ping', payload);
          break;
        case OPCODES.PONG:
          this.emit('pong', payload);
          break;
        case OPCODES.CLOSE: {
          let code = 1005;
          let reason = '';
          try {
            ({ code, reason } = decodeCloseBody(payload));
          } catch (err) {
            // Close malformato (1 byte, codice riservato, motivo non UTF-8):
            // si risponde col codice d'errore adeguato invece di fidarsi.
            this.close(err instanceof ProtocolError ? err.code : 1002, 'close non valido');
            return;
          }
          if (this.readyState === READY_STATE.OPEN) {
            // Chiusura ordinata: si spedisce il frame di eco e si lascia defluire
            // il socket con end(), perche' destroy() lo troncava spesso prima
            // che il frame di close raggiungesse il peer.
            this.readyState = READY_STATE.CLOSED;
            const echo = encodeFrame(OPCODES.CLOSE, encodeCloseBody(code === 1005 ? 1000 : code), { mask: !this.isServer });
            try {
              if (!this.socket.destroyed) this.socket.end(echo);
            } catch { /* socket gia' rotto: niente da fare */ }
            this.emit('close', { code, reason });
          } else {
            this.#finish(code, reason);
          }
          break;
        }
        default:
          this.close(1002, `opcode non supportato: ${opcode}`);
      }
    }
  }

  #write(buffer) {
    if (this.socket.destroyed) return false;
    try {
      const ok = this.socket.write(buffer);
      // Backpressure: se un client non legge, la coda di uscita del socket
      // cresce senza limite. Oltre il tetto si chiude la connessione (che il
      // gestore rimuove poi dai propri insiemi via evento 'close') invece di
      // consumare memoria per un peer che non tiene il passo.
      if (this.socket.writableLength > MAX_OUTBOUND_BYTES) {
        this.emit('error', new Error('coda di uscita oltre il limite: client troppo lento'));
        this.#finish(1009, 'client troppo lento');
        return false;
      }
      return ok;
    } catch (err) {
      this.emit('error', err);
      return false;
    }
  }

  #finish(code, reason) {
    if (this.readyState === READY_STATE.CLOSED) return;
    this.readyState = READY_STATE.CLOSED;
    if (!this.socket.destroyed) this.socket.destroy();
    this.emit('close', { code, reason });
  }

  /**
   * Invia un messaggio di testo (le stringhe cosi' come sono, gli oggetti come JSON).
   * @param {string|object|Buffer} data
   */
  send(data) {
    if (this.readyState !== READY_STATE.OPEN) return false;
    if (Buffer.isBuffer(data)) {
      return this.#write(encodeFrame(OPCODES.BINARY, data, { mask: !this.isServer }));
    }
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return this.#write(encodeFrame(OPCODES.TEXT, text, { mask: !this.isServer }));
  }

  /** Alias esplicito per l'invio di oggetti JSON. */
  sendJSON(obj) {
    return this.send(JSON.stringify(obj));
  }

  ping(payload = Buffer.alloc(0)) {
    if (this.readyState !== READY_STATE.OPEN) return false;
    return this.#write(encodeFrame(OPCODES.PING, payload, { mask: !this.isServer }));
  }

  /**
   * Avvia la chiusura ordinata della connessione.
   * @param {number} code
   * @param {string} reason
   */
  close(code = 1000, reason = '') {
    if (this.readyState !== READY_STATE.OPEN) {
      this.#finish(code, reason);
      return;
    }
    this.readyState = READY_STATE.CLOSING;
    this.#write(encodeFrame(OPCODES.CLOSE, encodeCloseBody(code, reason), { mask: !this.isServer }));
    // fallback: se il peer non risponde, chiudiamo comunque
    const timer = setTimeout(() => this.#finish(code, reason), 1000);
    if (typeof timer.unref === 'function') timer.unref();
  }

  /** Chiude immediatamente il socket senza handshake. */
  terminate() {
    this.#finish(1006, 'terminata');
  }
}
