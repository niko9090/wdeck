import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { WebSocketConnection } from '../src/host/ws/connection.mjs';
import { FrameParser, OPCODES, encodeFrame, encodeCloseBody, decodeCloseBody } from '../src/host/ws/frame.mjs';

/**
 * Socket finto: registra cio' che viene scritto e simula la coda di uscita.
 * Basta a esercitare la connessione senza aprire un vero socket TCP.
 */
class MockSocket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writableLength = 0;
    this.writes = [];
    this.ended = [];
  }

  setNoDelay() {}

  write(buffer) {
    this.writes.push(Buffer.from(buffer));
    return true;
  }

  end(buffer) {
    if (buffer) this.ended.push(Buffer.from(buffer));
    this.emit('close');
    return this;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('close');
  }
}

/** Estrae il codice del primo frame di close presente nei buffer passati. */
function closeCodeIn(buffers) {
  const parser = new FrameParser();
  for (const buf of buffers) {
    for (const msg of parser.push(buf)) {
      if (msg.opcode === OPCODES.CLOSE) return decodeCloseBody(msg.payload).code;
    }
  }
  return null;
}

test('ws-conn: un frame di testo non UTF-8 chiude con 1007', () => {
  const socket = new MockSocket();
  const conn = new WebSocketConnection(socket, { isServer: true });
  let messaggi = 0;
  conn.on('message', () => { messaggi += 1; });

  // 0xff 0xfe 0xfd non e' una sequenza UTF-8 valida.
  socket.emit('data', encodeFrame(OPCODES.TEXT, Buffer.from([0xff, 0xfe, 0xfd]), { mask: true }));

  assert.equal(messaggi, 0, 'nessun messaggio deve essere emesso');
  assert.equal(closeCodeIn(socket.writes), 1007);
});

test('ws-conn: la chiusura ricevuta usa socket.end (handshake pulito)', () => {
  const socket = new MockSocket();
  const conn = new WebSocketConnection(socket, { isServer: true });
  let chiusura = null;
  conn.on('close', (info) => { chiusura = info; });

  const body = encodeCloseBody(1000, 'ciao');
  socket.emit('data', encodeFrame(OPCODES.CLOSE, body, { mask: true }));

  // Il frame di eco deve passare da end(), non da write()+destroy() che lo troncava.
  assert.equal(socket.ended.length, 1, 'il close di eco deve essere spedito con end()');
  assert.equal(closeCodeIn(socket.ended), 1000);
  assert.ok(chiusura, 'la connessione deve segnalare la chiusura');
  assert.equal(chiusura.code, 1000);
});

test('ws-conn: una coda di uscita gonfia termina la connessione (backpressure)', () => {
  const socket = new MockSocket();
  const conn = new WebSocketConnection(socket, { isServer: true });
  let chiusura = null;
  conn.on('close', (info) => { chiusura = info; });
  conn.on('error', () => {}); // l'errore di backpressure e' atteso

  // Simula un client che non legge: la coda del socket supera il tetto.
  socket.writableLength = 8 * 1024 * 1024;
  conn.send({ hello: 'mondo' });

  assert.ok(socket.destroyed, 'il socket lento deve essere distrutto');
  assert.ok(chiusura, 'deve emettere close');
  assert.equal(chiusura.code, 1009);
});
