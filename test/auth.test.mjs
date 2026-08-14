import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuth, extractToken, generateToken, safeEqual } from '../src/host/security/auth.mjs';
import { TOKEN_HEADER } from '../shared/protocol.mjs';

test('auth: generateToken produce token distinti e non banali', () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32, `token troppo corto: ${a.length}`);
  assert.match(a, /^[A-Za-z0-9_-]+$/, 'il token deve essere URL-safe');
});

test('auth: safeEqual confronta correttamente', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), true);
  assert.equal(safeEqual(null, undefined), true, 'entrambi vuoti');
  assert.equal(safeEqual('abc', null), false);
});

test('auth: extractToken legge querystring, header e Bearer', () => {
  assert.equal(extractToken({ url: '/ws?token=abc123' }), 'abc123');
  assert.equal(extractToken({ url: '/api/deck?x=1&token=abc%20def' }), 'abc def');
  assert.equal(extractToken({ headers: { [TOKEN_HEADER]: 'da-header' } }), 'da-header');
  assert.equal(extractToken({ headers: { authorization: 'Bearer da-bearer' } }), 'da-bearer');
  assert.equal(extractToken({ headers: { authorization: 'bearer minuscolo' } }), 'minuscolo');
  assert.equal(extractToken({ url: '/api/deck' }), null);
  assert.equal(extractToken({}), null);
  assert.equal(extractToken({ headers: { authorization: 'Basic xyz' } }), null);
});

test('auth: l\'header ha la precedenza sulla querystring', () => {
  const token = extractToken({ headers: { [TOKEN_HEADER]: 'header' }, url: '/ws?token=query' });
  assert.equal(token, 'header');
});

test('auth: verify accetta solo il token configurato', () => {
  const auth = createAuth({ token: 'token-segreto-1234', requireToken: true });
  assert.equal(auth.required, true);
  assert.equal(auth.generated, false);
  assert.equal(auth.verify('token-segreto-1234'), true);
  assert.equal(auth.verify('token-segreto-1235'), false);
  assert.equal(auth.verify(''), false);
  assert.equal(auth.verify(null), false);
  assert.equal(auth.verify(undefined), false);
});

test('auth: genera un token se non configurato', () => {
  const auth = createAuth({ requireToken: true });
  assert.equal(auth.generated, true);
  assert.ok(auth.token.length >= 32);
  assert.equal(auth.verify(auth.token), true);
});

test('auth: requireToken=false accetta qualunque richiesta', () => {
  const auth = createAuth({ token: 'qualcosa-di-lungo', requireToken: false });
  assert.equal(auth.required, false);
  assert.equal(auth.verify(undefined), true);
  assert.equal(auth.verify('sbagliato'), true);
});

test('auth: verifyRequest usa la richiesta completa', () => {
  const auth = createAuth({ token: 'token-segreto-1234' });
  const riuscita = auth.verifyRequest({ url: '/ws?token=token-segreto-1234' });
  assert.equal(riuscita.ok, true);
  assert.equal(riuscita.token, 'token-segreto-1234');
  assert.equal(riuscita.kind, 'master');
  assert.equal(riuscita.device, null);
  assert.equal(auth.verifyRequest({ url: '/ws?token=nope' }).ok, false);
  assert.equal(auth.verifyRequest({ headers: {} }).ok, false);
  assert.equal(auth.verifyRequest({ headers: { [TOKEN_HEADER]: 'token-segreto-1234' } }).ok, true);
});

test('auth: pairing con PIN', () => {
  const auth = createAuth({ token: 'token-segreto-1234', pin: '246810' });
  assert.equal(auth.pinEnabled, true);

  // Il pairing non consegna piu' il token principale: ne crea uno dedicato a
  // quel dispositivo, revocabile da solo.
  const riuscito = auth.pair('246810', { name: 'Telefono' });
  assert.equal(riuscito.ok, true);
  assert.notEqual(riuscito.token, 'token-segreto-1234');
  assert.equal(riuscito.device.name, 'Telefono');
  assert.equal(auth.verify(riuscito.token), true);

  const errato = auth.pair('000000');
  assert.equal(errato.ok, false);
  assert.match(errato.reason, /PIN errato/);

  assert.equal(auth.pair('').ok, false);
  assert.equal(auth.pair(undefined).ok, false);
});

test('auth: pairing disabilitato quando non c\'e\' PIN', () => {
  const auth = createAuth({ token: 'token-segreto-1234' });
  assert.equal(auth.pinEnabled, false);
  const result = auth.pair('1234');
  assert.equal(result.ok, false);
  assert.match(result.reason, /non abilitato/);
});

test('auth: rotate invalida il token precedente', () => {
  const auth = createAuth({ token: 'token-segreto-1234' });
  const nuovo = auth.rotate();
  assert.notEqual(nuovo, 'token-segreto-1234');
  assert.equal(auth.verify('token-segreto-1234'), false);
  assert.equal(auth.verify(nuovo), true);
  assert.equal(auth.token, nuovo);
});
