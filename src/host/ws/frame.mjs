/**
 * Implementazione minimale (ma conforme) del framing WebSocket RFC 6455.
 * Serve a evitare qualunque dipendenza esterna: l'host usa solo moduli built-in.
 *
 * Supporta: frame di testo/binari, frammentazione, ping/pong, close, masking.
 * Non supporta: estensioni (permessage-deflate) - il campo RSV deve essere 0.
 */

import crypto from 'node:crypto';

export const OPCODES = Object.freeze({
  CONT: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa
});

export const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class ProtocolError extends Error {
  constructor(message, code = 1002) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

/** Calcola il valore dell'header Sec-WebSocket-Accept. */
export function acceptKey(secWebSocketKey) {
  return crypto.createHash('sha1').update(String(secWebSocketKey) + GUID).digest('base64');
}

/** Genera una Sec-WebSocket-Key valida (lato client). */
export function generateKey() {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * Codifica un frame WebSocket.
 * @param {number} opcode
 * @param {Buffer|string} data
 * @param {{mask?: boolean, fin?: boolean}} [options]
 * @returns {Buffer}
 */
export function encodeFrame(opcode, data = Buffer.alloc(0), { mask = false, fin = true } = {}) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const len = payload.length;

  // I frame di controllo (CLOSE/PING/PONG) devono stare in 125 byte: e' una
  // regola del protocollo, non una scelta di comodo. Meglio fallire qui che
  // spedire un frame che il peer rifiutera'.
  if (opcode >= 0x8 && len > 125) {
    throw new ProtocolError(`payload di controllo troppo grande: ${len} byte`);
  }

  let headerLen = 2;
  if (len >= 65536) headerLen += 8;
  else if (len > 125) headerLen += 2;
  if (mask) headerLen += 4;

  const frame = Buffer.allocUnsafe(headerLen + len);
  frame[0] = (fin ? 0x80 : 0x00) | (opcode & 0x0f);

  let offset = 2;
  if (len >= 65536) {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
    offset = 10;
  } else if (len > 125) {
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
    offset = 4;
  } else {
    frame[1] = len;
  }

  if (mask) {
    frame[1] |= 0x80;
    const key = crypto.randomBytes(4);
    key.copy(frame, offset);
    offset += 4;
    for (let i = 0; i < len; i += 1) {
      frame[offset + i] = payload[i] ^ key[i % 4];
    }
  } else {
    payload.copy(frame, offset);
  }

  return frame;
}

/** Costruisce il payload di un frame di close (codice + motivo). */
export function encodeCloseBody(code = 1000, reason = '') {
  const reasonBuf = Buffer.from(String(reason), 'utf8').subarray(0, 123);
  const body = Buffer.allocUnsafe(2 + reasonBuf.length);
  body.writeUInt16BE(code, 0);
  reasonBuf.copy(body, 2);
  return body;
}

/** Decoder UTF-8 rigoroso: fallisce sulle sequenze non valide invece di
 * sostituirle silenziosamente con U+FFFD (RFC 6455 §8.1). */
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });

/**
 * Verifica che un codice di close sia usabile "sul filo".
 * Ammessi: 1000-1003, 1007-1011 e l'intervallo privato 3000-4999.
 * Esclusi i riservati (1004, 1005, 1006, 1015): non devono comparire nei frame.
 * @param {number} code
 * @returns {boolean}
 */
export function isValidCloseCode(code) {
  if (code >= 3000 && code <= 4999) return true;
  return code === 1000 || code === 1001 || code === 1002 || code === 1003
    || (code >= 1007 && code <= 1011);
}

/**
 * Interpreta il payload di un frame di close.
 * @param {Buffer} payload
 * @returns {{code: number, reason: string}}
 * @throws {ProtocolError} su lunghezza (1 byte), codice o motivo non validi
 */
export function decodeCloseBody(payload) {
  // Nessun corpo: chiusura senza codice esplicito (1005 = "nessun codice ricevuto").
  if (!payload || payload.length === 0) return { code: 1005, reason: '' };
  // Un solo byte non basta a contenere un codice: e' un frame malformato.
  if (payload.length < 2) throw new ProtocolError('frame di close malformato (1 byte)');
  const code = payload.readUInt16BE(0);
  if (!isValidCloseCode(code)) throw new ProtocolError(`codice di close non valido: ${code}`);
  let reason;
  try {
    reason = UTF8_STRICT.decode(payload.subarray(2));
  } catch {
    throw new ProtocolError('motivo di close non UTF-8 valido', 1007);
  }
  return { code, reason };
}

/**
 * Parser incrementale di frame WebSocket.
 * Gestisce la riassemblazione dei messaggi frammentati.
 */
export class FrameParser {
  /** @param {{maxPayload?: number, requireMask?: boolean}} [options] */
  constructor({ maxPayload = 1024 * 1024, requireMask = false } = {}) {
    this.maxPayload = maxPayload;
    this.requireMask = requireMask;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = null;
    this.fragmentSize = 0;
  }

  /**
   * Aggiunge dati ricevuti dal socket e restituisce i messaggi completi.
   * @param {Buffer} chunk
   * @returns {Array<{opcode: number, payload: Buffer}>}
   */
  push(chunk) {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const messages = [];

    for (;;) {
      const frame = this.#readFrame();
      if (!frame) break;

      if (frame.opcode >= 0x8) {
        messages.push({ opcode: frame.opcode, payload: frame.payload });
        continue;
      }

      if (frame.opcode === OPCODES.CONT) {
        if (this.fragmentOpcode === null) throw new ProtocolError('frame di continuazione inatteso');
        this.fragments.push(frame.payload);
        this.fragmentSize += frame.payload.length;
        if (this.fragmentSize > this.maxPayload) throw new ProtocolError('messaggio troppo grande', 1009);
        if (frame.fin) {
          messages.push({ opcode: this.fragmentOpcode, payload: Buffer.concat(this.fragments) });
          this.fragments = [];
          this.fragmentOpcode = null;
          this.fragmentSize = 0;
        }
        continue;
      }

      if (this.fragmentOpcode !== null) throw new ProtocolError('nuovo messaggio iniziato prima della fine del precedente');

      if (frame.fin) {
        messages.push({ opcode: frame.opcode, payload: frame.payload });
      } else {
        this.fragmentOpcode = frame.opcode;
        this.fragments = [frame.payload];
        this.fragmentSize = frame.payload.length;
      }
    }

    return messages;
  }

  #readFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;

    const b0 = buf[0];
    const b1 = buf[1];
    if ((b0 & 0x70) !== 0) throw new ProtocolError('bit RSV non supportati (estensioni non abilitate)');

    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let length = b1 & 0x7f;
    let offset = 2;

    if (opcode >= 0x8) {
      if (!fin) throw new ProtocolError('i frame di controllo non possono essere frammentati');
      if (length > 125) throw new ProtocolError('frame di controllo troppo grande');
    }

    if (length === 126) {
      if (buf.length < 4) return null;
      length = buf.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buf.length < 10) return null;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(this.maxPayload)) throw new ProtocolError('messaggio troppo grande', 1009);
      length = Number(big);
      offset = 10;
    }

    if (length > this.maxPayload) throw new ProtocolError('messaggio troppo grande', 1009);
    if (this.requireMask && !masked) throw new ProtocolError('i frame dal client devono essere mascherati');

    let maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + length) return null;

    const payload = Buffer.from(buf.subarray(offset, offset + length));
    if (maskKey) {
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i % 4];
    }

    this.buffer = buf.subarray(offset + length);
    return { fin, opcode, payload };
  }
}
