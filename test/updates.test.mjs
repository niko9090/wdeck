/**
 * Controllo aggiornamenti: scelta dell'asset e confronto delle versioni.
 *
 * Il punto delicato e' quale allegato viene scelto per l'auto-update: una
 * release ne pubblica due che finiscono entrambi in `.exe` (il binario nudo
 * `wdeck.exe` e l'installer `WdeckSetup-x.exe`), ma solo il primo si presta
 * alla sostituzione a caldo. Sceglierne uno a caso significherebbe, ogni tanto,
 * scambiare l'eseguibile in uso con un installer.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareVersions, fetchLatestRelease } from '../src/host/updates.mjs';

/** Finto `fetch` che restituisce una release con gli asset indicati. */
function fakeFetch(assets, { tag = 'v1.2.3' } = {}) {
  return async () => ({
    status: 200,
    ok: true,
    json: async () => ({
      tag_name: tag,
      name: `Wdeck ${tag}`,
      html_url: 'https://github.com/niko9090/wdeck/releases/latest',
      body: 'note',
      published_at: '2026-08-17T00:00:00Z',
      assets: assets.map((a) => ({
        name: a,
        browser_download_url: `https://example.com/${a}`,
        size: 123
      }))
    })
  });
}

test('fetchLatestRelease sceglie il binario nudo, non l\'installer', async () => {
  // L'installer compare per PRIMO: senza la scelta per nome verrebbe preso lui.
  const r = await fetchLatestRelease('niko9090/wdeck', {
    fetchImpl: fakeFetch(['WdeckSetup-1.2.3.exe', 'wdeck.exe', 'SHA256SUMS.txt'])
  });
  assert.equal(r.asset.name, 'wdeck.exe');
  assert.equal(r.checksums.url, 'https://example.com/SHA256SUMS.txt');
});

test('fetchLatestRelease evita comunque un asset "setup" se manca wdeck.exe', async () => {
  const r = await fetchLatestRelease('niko9090/wdeck', {
    fetchImpl: fakeFetch(['WdeckSetup-1.2.3.exe', 'wdeck-portable.exe'])
  });
  assert.equal(r.asset.name, 'wdeck-portable.exe');
});

test('fetchLatestRelease ripiega su .exe se c\'e\' solo un installer', async () => {
  const r = await fetchLatestRelease('niko9090/wdeck', {
    fetchImpl: fakeFetch(['WdeckSetup-1.2.3.exe'])
  });
  assert.equal(r.asset.name, 'WdeckSetup-1.2.3.exe');
});

test('fetchLatestRelease senza asset restituisce asset e checksums nulli', async () => {
  const r = await fetchLatestRelease('niko9090/wdeck', { fetchImpl: fakeFetch([]) });
  assert.equal(r.asset, null);
  assert.equal(r.checksums, null);
  assert.equal(r.version, '1.2.3');
});

test('compareVersions ordina come semver', () => {
  assert.ok(compareVersions('0.7.2', '0.7.1') > 0);
  assert.ok(compareVersions('0.7.1', '0.7.10') < 0);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
});
