/**
 * Azione "riproduci suono" (soundboard) e generazione dello script di
 * riproduzione. La riproduzione vera richiede Windows e una scheda audio, quindi
 * qui si collaudano la parte pura e la validazione.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { AUDIO_EXTENSIONS, buildPlaySoundScript } from '../src/host/platform/windows.mjs';
import { createDefaultRegistry } from '../src/host/actions/handlers/index.mjs';

const sound = createDefaultRegistry().get('sound');

test('sound: lo script apre e riproduce col volume dato, e non blocca in eterno', () => {
  const s = buildPlaySoundScript('C:/Suoni/x.mp3', 50);
  assert.match(s, /MediaPlayer/);
  assert.match(s, /\$player\.Play\(\)/);
  assert.match(s, /\$player\.Volume = 0\.5/);
  assert.match(s, /\$ms -gt 120000/); // tetto alla durata
  // il percorso non compare in chiaro: viaggia in base64
  assert.ok(!s.includes('C:/Suoni/x.mp3'));
});

test('sound: volume fuori scala viene riportato dentro 0..1', () => {
  assert.match(buildPlaySoundScript('a.wav', 999), /\$player\.Volume = 1\b/); // 100% -> 1.0
  assert.match(buildPlaySoundScript('a.wav', -5), /\$player\.Volume = 0\b/);  // sotto zero -> 0.0
  assert.match(buildPlaySoundScript('a.wav', 50), /\$player\.Volume = 0\.5\b/);
});

test('sound: validate accetta i formati audio e rifiuta gli altri', () => {
  for (const ext of AUDIO_EXTENSIONS) {
    assert.doesNotThrow(() => sound.validate({ path: `C:/s/clip${ext}` }), `dovrebbe accettare ${ext}`);
  }
  assert.throws(() => sound.validate({ path: 'C:/s/clip.txt' }), /non supportato/);
  assert.throws(() => sound.validate({ path: '' }), /mancante/);
  assert.throws(() => sound.validate({ path: 'a.mp3', volume: 200 }), /volume/);
});

test('sound: in dry-run non riproduce e riporta lo script', async () => {
  const out = await sound.run({ path: 'C:/s/clip.mp3', volume: 80 }, { dryRun: true });
  assert.equal(out.ok, true);
  assert.equal(out.simulated, true);
  assert.match(out.script, /MediaPlayer/);
});
