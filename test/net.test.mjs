import test from 'node:test';
import assert from 'node:assert/strict';

import { httpAction } from '../src/host/actions/handlers/net.mjs';

// Gli indirizzi usati qui sono letterali IP interni: vengono bloccati prima di
// qualunque connessione, quindi i test non toccano la rete.

test('http: un URL loopback/privato viene rifiutato (SSRF)', async () => {
  for (const url of [
    'http://127.0.0.1:8080/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://[::1]:9000/'
  ]) {
    // La validazione accetta l'URL (e' formalmente valido)...
    assert.doesNotThrow(() => httpAction.validate({ url }), `validate dovrebbe accettare ${url}`);
    // ...ma l'esecuzione reale lo blocca.
    await assert.rejects(
      httpAction.run({ url }, { dryRun: false }),
      (err) => err.code === 'forbidden' && /interno|non consentita/.test(err.message),
      `run dovrebbe bloccare ${url}`
    );
  }
});

test('http: in dry-run non viene contattato nulla', async () => {
  const res = await httpAction.run({ url: 'http://127.0.0.1/' }, { dryRun: true });
  assert.equal(res.ok, true);
  assert.equal(res.simulated, true);
});
