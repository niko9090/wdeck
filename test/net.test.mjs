import test from 'node:test';
import assert from 'node:assert/strict';

import { httpAction } from '../src/host/actions/handlers/net.mjs';

// Gli indirizzi usati qui sono letterali IP interni: vengono bloccati prima di
// qualunque connessione, quindi i test non toccano la rete.

test('http: con allowPrivateHttp=false un URL loopback/privato viene rifiutato (SSRF)', async () => {
  // La protezione anti-SSRF e' opzionale: si attiva con allowPrivateHttp=false
  // (di default un deck puo' contattare i propri servizi locali).
  const ctx = { dryRun: false, security: { allowPrivateHttp: false } };
  for (const url of [
    'http://127.0.0.1:8080/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://[::1]:9000/'
  ]) {
    assert.doesNotThrow(() => httpAction.validate({ url }), `validate dovrebbe accettare ${url}`);
    await assert.rejects(
      httpAction.run({ url }, ctx),
      (err) => err.code === 'forbidden' && /interno|non consentita/.test(err.message),
      `run dovrebbe bloccare ${url}`
    );
  }
});

test('http: di default (allowPrivateHttp true) un indirizzo locale non e\' bloccato dall\'anti-SSRF', async () => {
  // Non deve fallire con "forbidden": la richiesta parte (poi fallira' la
  // connessione perche' non c'e' nessun server, ed e' un errore diverso).
  await assert.rejects(
    httpAction.run({ url: 'http://127.0.0.1:9/' }, { dryRun: false, security: {} }),
    (err) => err.code !== 'forbidden'
  );
});

test('http: in dry-run non viene contattato nulla', async () => {
  const res = await httpAction.run({ url: 'http://127.0.0.1/' }, { dryRun: true });
  assert.equal(res.ok, true);
  assert.equal(res.simulated, true);
});
