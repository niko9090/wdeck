import test from 'node:test';
import assert from 'node:assert/strict';

import { PowerShellWorker, workerLoop } from '../src/host/platform/psworker.mjs';
import { levelBootstrap, withLevelServer, levelServerEnabled } from '../src/host/platform/levelserver.mjs';
import {
  LEVEL_FUNCTIONS, buildAdjustVolumeScript, buildMuteScript, buildReadBrightnessScript,
  buildSetBrightnessScript, buildSetVolumeScript, muteMode, parseLevelOutput
} from '../src/host/platform/levels.mjs';

/** Un worker senza processo: si prova solo la lettura delle risposte. */
function fakeWorker() {
  const w = new PowerShellWorker({ name: 'prova', bootstrap: '' });
  const esiti = new Map();
  const attendi = (id) => new Promise((resolve, reject) => {
    w.pending.set(id, { resolve, reject, timer: setTimeout(() => {}, 0) });
    esiti.set(id, null);
  });
  return { w, attendi };
}

test('psworker: "OK <testo>" risolve col testo, "ERR" rifiuta con remote=true', async () => {
  const { w, attendi } = fakeWorker();
  const p1 = attendi('1');
  const p2 = attendi('2');
  const p3 = attendi('3');
  // le righe possono arrivare spezzate in piu' pezzi: il buffer le ricompone
  w.onData('1 OK volume=42;mu');
  w.onData('ted=false\n2 ERR nessun metodo di controllo luminosita\' disponibile\n3 OK\n');
  assert.equal(await p1, 'volume=42;muted=false');
  await assert.rejects(p2, (err) => err.remote === true && /nessun metodo/.test(err.message));
  assert.equal(await p3, '', 'un OK senza testo risolve con la stringa vuota');
});

test('psworker: un errore del processo (fail) rifiuta tutto SENZA remote', async () => {
  const { w, attendi } = fakeWorker();
  const p = attendi('7');
  w.fail(new Error('processo terminato'));
  await assert.rejects(p, (err) => !err.remote && /terminato/.test(err.message));
  assert.equal(w.pending.size, 0);
});

test('workerLoop: stampa READY e risponde "<id> OK $r" o "<id> ERR ..."', () => {
  const s = workerLoop('    $r = "x"');
  assert.match(s, /WriteLine\("READY"\)/);
  assert.match(s, /"\$id OK \$r"/);
  assert.match(s, /"\$id ERR "/);
  assert.ok(s.indexOf('READY') < s.indexOf('while'), 'READY viene prima del ciclo');
});

test('level server: il bootstrap contiene i due ponti C#, le funzioni e tutti i comandi', () => {
  const b = levelBootstrap();
  for (const atteso of ['class WdeckAudio', 'class WdeckMon', 'class WdeckGamma', 'function Wdeck-VolOut', 'function Wdeck-BriAdjust',
    '"VR"', '"VS"', '"VA"', '"VM"', '"BR"', '"BS"', '"BA"', 'READY']) {
    assert.ok(b.includes(atteso), `manca ${atteso}`);
  }
  // I numeri decimali si leggono con la cultura invariante: "2.5" e' due e
  // mezzo anche su un Windows italiano, dove altrimenti sarebbe "2,5".
  assert.match(b, /InvariantCulture/);
});

test('level server: gli script singoli usano LE STESSE funzioni e chiudono con exit 5', () => {
  const s = buildSetVolumeScript('speaker', 140);
  assert.ok(s.includes(LEVEL_FUNCTIONS), 'le funzioni condivise stanno nello script singolo');
  assert.match(s, /Write-Output \(Wdeck-VolSet 0 100\)/, 'percentuale limitata a 100, canale 0');
  assert.match(s, /exit 5/);
  assert.match(buildAdjustVolumeScript('mic', -2.5), /Wdeck-VolAdjust 1 -2\.5/);
  assert.match(buildMuteScript('speaker', 'toggle'), /Wdeck-VolMute 0 2/);
  assert.match(buildMuteScript('speaker', true), /Wdeck-VolMute 0 1/);
  assert.match(buildReadBrightnessScript(), /Wdeck-BriRead\)/);
  assert.match(buildSetBrightnessScript(-4), /Wdeck-BriSet 0\)/);
  assert.equal(muteMode(false), 0);
});

test('level server: con WDECK_LEVELSERVER=0 si passa direttamente alla via lenta', async () => {
  const prima = process.env.WDECK_LEVELSERVER;
  process.env.WDECK_LEVELSERVER = '0';
  try {
    assert.equal(levelServerEnabled(), false);
    let chiamato = 0;
    const out = await withLevelServer('VR 0', async () => { chiamato += 1; return { volume: 7 }; });
    assert.equal(chiamato, 1);
    assert.deepEqual(out, { volume: 7 });
  } finally {
    if (prima === undefined) delete process.env.WDECK_LEVELSERVER;
    else process.env.WDECK_LEVELSERVER = prima;
  }
});

test('parseLevelOutput: legge quello che le funzioni scrivono', () => {
  assert.deepEqual(parseLevelOutput('volume=42;muted=true'), { volume: 42, muted: true });
  assert.deepEqual(parseLevelOutput('brightness=60;mode=ddc'), { brightness: 60, mode: 'ddc' });
});
