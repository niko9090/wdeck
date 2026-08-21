/**
 * Script della tray (icona nell'area di notifica). E' PowerShell generato: un
 * errore di sintassi non si vedrebbe mai, perche' gira nascosto. Qui si
 * controlla che le voci ci siano e, su Windows, che lo script sia sintatticamente
 * valido senza eseguirlo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { buildTrayScript } from '../src/host/tray.mjs';

const script = buildTrayScript({
  url: 'http://127.0.0.1:8899/?token=abc',
  urls: ['http://127.0.0.1:8899/?token=abc', 'http://192.168.1.5:8899/?token=abc'],
  token: 'un-token-segreto',
  pid: 1234,
  version: '9.9.9',
  deckName: 'Il mio deck'
});

test('tray: contiene le voci del menu', () => {
  for (const voce of [
    'Apri il deck nel browser',
    'Apri le impostazioni',
    'Copia indirizzo per il telefono',
    'Ricarica deck.json',
    'Controlla aggiornamenti',
    'Scarica e installa aggiornamento',
    'Esci da Wdeck'
  ]) {
    assert.ok(script.includes(voce), `manca la voce "${voce}"`);
  }
});

test('tray: l\'esito del controllo aggiornamenti usa una finestra visibile', () => {
  assert.ok(script.includes('MessageBox'), 'l\'esito deve usare una MessageBox, non solo un fumetto');
});

test('tray: le impostazioni aprono l\'ancora #settings', () => {
  assert.ok(script.includes('#settings'), 'la voce impostazioni deve aprire l\'ancora #settings');
});

test('tray: le chiamate API non producono il doppio slash', () => {
  // $url finisce con "/": usare "$url/api/..." darebbe "//api/...", che il
  // server non riconosce (HTML per i GET, 404 per i POST). Devono passare da $base.
  assert.ok(!script.includes('$url/api/'), 'le chiamate API non devono usare $url (doppio slash)');
  assert.ok(script.includes('$base = $url.TrimEnd'), 'deve definire $base senza slash finale');
  assert.ok(script.includes('$base/api/'), 'le chiamate API devono usare $base');
});

test('tray: token e url non finiscono in chiaro nello script', () => {
  // Sono passati in base64 e decodificati a runtime.
  assert.ok(!script.includes('un-token-segreto'), 'il token non deve comparire in chiaro');
});

test('tray: lo script PowerShell e\' sintatticamente valido (solo Windows)', (t) => {
  if (process.platform !== 'win32') return t.skip('richiede PowerShell su Windows');
  const file = path.join(os.tmpdir(), `wdeck-tray-test-${process.pid}.ps1`);
  fs.writeFileSync(file, script, 'utf8');
  t.after(() => { try { fs.rmSync(file); } catch { /* */ } });
  // Analisi senza esecuzione: il parser tokenizza il file e riporta gli errori.
  const check = '$e=$null; $t=$null; '
    + '[void][System.Management.Automation.Language.Parser]::ParseFile($env:WDECK_TRAY_PS, [ref]$t, [ref]$e); '
    + 'if ($e.Count -gt 0) { $e | ForEach-Object { Write-Output $_.Message }; exit 1 } else { Write-Output OK }';
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', check], {
    env: { ...process.env, WDECK_TRAY_PS: file },
    encoding: 'utf8'
  });
  assert.equal(res.status, 0, `errori di sintassi nello script tray:\n${res.stdout}\n${res.stderr}`);
});
