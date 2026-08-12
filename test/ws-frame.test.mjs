import test from 'node:test';
import assert from 'node:assert/strict';

import { FrameParser, OPCODES, acceptKey, encodeFrame, encodeCloseBody, decodeCloseBody, ProtocolError } from '../src/host/ws/frame.mjs';

const readAll = (parser, buffer) => parser.push(buffer);
const text = (payload) => payload.toString('utf8');

test('ws: acceptKey segue l\'esempio della RFC 6455', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('ws: round-trip di un frame di testo non mascherato', () => {
  const parser = new FrameParser();
  const messages = readAll(parser, encodeFrame(OPCODES.TEXT, 'ciao'));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].opcode, OPCODES.TEXT);
  assert.equal(text(messages[0].payload), 'ciao');
});

test('ws: round-trip di un frame mascherato (client -> server)', () => {
  const parser = new FrameParser({ requireMask: true });
  const messages = readAll(parser, encodeFrame(OPCODES.TEXT, 'dal client', { mask: true }));
  assert.equal(text(messages[0].payload), 'dal client');
});

test('ws: il server rifiuta i frame non mascherati', () => {
  const parser = new FrameParser({ requireMask: true });
  assert.throws(() => readAll(parser, encodeFrame(OPCODES.TEXT, 'x')), ProtocolError);
});

test('ws: payload di lunghezza media e grande (16 e 64 bit)', () => {
  for (const size of [125, 126, 1000, 70000]) {
    const parser = new FrameParser({ maxPayload: 1024 * 1024 });
    const payload = 'x'.repeat(size);
    const messages = readAll(parser, encodeFrame(OPCODES.TEXT, payload));
    assert.equal(messages.length, 1, `size=${size}`);
    assert.equal(messages[0].payload.length, size);
  }
});

test('ws: messaggi ricevuti a pezzi vengono riassemblati', () => {
  const parser = new FrameParser();
  const frame = encodeFrame(OPCODES.TEXT, 'messaggio spezzato in due');
  assert.equal(parser.push(frame.subarray(0, 4)).length, 0);
  const messages = parser.push(frame.subarray(4));
  assert.equal(text(messages[0].payload), 'messaggio spezzato in due');
});

test("ws: piu' frame nello stesso chunk", () => {
  const parser = new FrameParser();
  const buffer = Buffer.concat([
    encodeFrame(OPCODES.TEXT, 'uno'),
    encodeFrame(OPCODES.TEXT, 'due'),
    encodeFrame(OPCODES.PING, Buffer.from('p'))
  ]);
  const messages = parser.push(buffer);
  assert.equal(messages.length, 3);
  assert.deepEqual(messages.map((m) => m.opcode), [OPCODES.TEXT, OPCODES.TEXT, OPCODES.PING]);
});

test('ws: messaggi frammentati (fin=false + continuation)', () => {
  const parser = new FrameParser();
  const buffer = Buffer.concat([
    encodeFrame(OPCODES.TEXT, 'parte1-', { fin: false }),
    encodeFrame(OPCODES.CONT, 'parte2-', { fin: false }),
    encodeFrame(OPCODES.CONT, 'parte3')
  ]);
  const messages = parser.push(buffer);
  assert.equal(messages.length, 1);
  assert.equal(text(messages[0].payload), 'parte1-parte2-parte3');
  assert.equal(messages[0].opcode, OPCODES.TEXT);
});

test('ws: i frame di controllo possono intercalarsi ai frammenti', () => {
  const parser = new FrameParser();
  const buffer = Buffer.concat([
    encodeFrame(OPCODES.TEXT, 'a', { fin: false }),
    encodeFrame(OPCODES.PING),
    encodeFrame(OPCODES.CONT, 'b')
  ]);
  const messages = parser.push(buffer);
  assert.deepEqual(messages.map((m) => m.opcode), [OPCODES.PING, OPCODES.TEXT]);
  assert.equal(text(messages[1].payload), 'ab');
});

test('ws: continuation inattesa -> errore di protocollo', () => {
  const parser = new FrameParser();
  assert.throws(() => parser.push(encodeFrame(OPCODES.CONT, 'x')), /continuazione inatteso/);
});

test('ws: payload oltre il limite -> errore 1009', () => {
  const parser = new FrameParser({ maxPayload: 64 });
  try {
    parser.push(encodeFrame(OPCODES.TEXT, 'x'.repeat(200)));
    assert.fail('atteso errore');
  } catch (err) {
    assert.equal(err.code, 1009);
  }
});

test('ws: i bit RSV non sono supportati', () => {
  const parser = new FrameParser();
  const frame = encodeFrame(OPCODES.TEXT, 'x');
  frame[0] |= 0x40;
  assert.throws(() => parser.push(frame), /RSV/);
});

test('ws: i frame di controllo non possono essere frammentati o grandi', () => {
  const parser = new FrameParser();
  assert.throws(() => parser.push(encodeFrame(OPCODES.PING, 'x', { fin: false })), /frammentati/);

  const parser2 = new FrameParser();
  assert.throws(() => parser2.push(encodeFrame(OPCODES.CLOSE, 'x'.repeat(200))), /troppo grande/);
});

test('ws: codifica e decodifica del frame di close', () => {
  const body = encodeCloseBody(1008, 'token non valido');
  assert.deepEqual(decodeCloseBody(body), { code: 1008, reason: 'token non valido' });
  assert.deepEqual(decodeCloseBody(Buffer.alloc(0)), { code: 1005, reason: '' });
  assert.deepEqual(decodeCloseBody(null), { code: 1005, reason: '' });
});

test('ws: i frame binari mantengono i byte esatti', () => {
  const parser = new FrameParser();
  const payload = Buffer.from([0x00, 0xff, 0x10, 0x7f, 0x80]);
  const messages = parser.push(encodeFrame(OPCODES.BINARY, payload, { mask: true }));
  assert.equal(messages[0].opcode, OPCODES.BINARY);
  assert.deepEqual([...messages[0].payload], [...payload]);
});

test('ws: testo UTF-8 multibyte preservato', () => {
  const parser = new FrameParser();
  const messages = parser.push(encodeFrame(OPCODES.TEXT, 'perché però €'));
  assert.equal(text(messages[0].payload), 'perché però €');
});
