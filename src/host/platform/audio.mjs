/**
 * Facciata del controllo audio: volume e muto, per piattaforma.
 *
 * Come per l'input sintetico, il percorso Windows resta quello gia' collaudato
 * (Core Audio via PowerShell, valori assoluti); macOS e Linux arrivano allo
 * stesso risultato con osascript e pactl/amixer.
 *
 * Tutte le funzioni restituiscono la stessa forma - `{volume, muted}` - cosi'
 * gli handler e la lettura di stato non devono sapere da dove viene il dato.
 * `muted` puo' essere `undefined` dove il sistema non lo espone (microfono su
 * macOS): meglio dichiararlo ignoto che inventarlo.
 */

import * as linux from './linux.mjs';
import * as macos from './macos.mjs';
import {
  buildAdjustVolumeScript,
  buildMuteScript,
  buildSetVolumeScript,
  clampPercent,
  flowOf,
  muteMode,
  runLevelScript
} from './levels.mjs';
import { readVolumeFast as readVolumeWindows, withLevelServer } from './levelserver.mjs';

/** Piattaforme su cui volume e muto sono pilotabili. */
export const AUDIO_PLATFORMS = Object.freeze(['win32', 'darwin', 'linux']);

/** true se la piattaforma corrente sa controllare l'audio. */
export const audioSupported = (platform = process.platform) => AUDIO_PLATFORMS.includes(platform);

function adapter(platform = process.platform) {
  if (platform === 'darwin') return macos;
  if (platform === 'linux') return linux;
  return null;
}

function unsupported() {
  return new Error(`controllo audio non disponibile su ${process.platform} `
    + `(supportate: ${AUDIO_PLATFORMS.join(', ')})`);
}

/**
 * Legge volume (0..100) e stato del muto di un canale.
 * @param {'speaker'|'mic'} [target]
 * @returns {Promise<{volume: number|null, muted: boolean|undefined}>}
 */
export async function readVolume(target = 'speaker') {
  if (process.platform === 'win32') return readVolumeWindows(target);
  const impl = adapter();
  if (!impl) throw unsupported();
  return impl.readVolume(target);
}

/**
 * Imposta il volume di un canale a un valore assoluto.
 * @param {'speaker'|'mic'} target
 * @param {number} percent 0..100
 */
export async function setVolume(target, percent) {
  if (process.platform === 'win32') {
    // Prima il processo persistente (millisecondi), poi lo script singolo.
    return withLevelServer(`VS ${flowOf(target)} ${clampPercent(percent)}`,
      () => runLevelScript(buildSetVolumeScript(target, percent), { what: `volume ${target}` }));
  }
  const impl = adapter();
  if (!impl) throw unsupported();
  return impl.setVolume(target, clampPercent(percent));
}

/**
 * Somma un delta al volume corrente, con limite a 0..100.
 * @param {'speaker'|'mic'} target
 * @param {number} delta -100..100
 */
export async function adjustVolume(target, delta) {
  if (process.platform === 'win32') {
    const d = Math.max(-100, Math.min(100, Number(delta) || 0));
    return withLevelServer(`VA ${flowOf(target)} ${d}`,
      () => runLevelScript(buildAdjustVolumeScript(target, delta), { what: `volume ${target}` }));
  }
  const impl = adapter();
  if (!impl) throw unsupported();
  // Fuori da Windows non esiste un comando "somma": si legge e si riscrive.
  const current = await impl.readVolume(target);
  return impl.setVolume(target, clampPercent((current.volume ?? 0) + Number(delta || 0)));
}

/**
 * Imposta o inverte il muto di un canale.
 * @param {'speaker'|'mic'} target
 * @param {boolean|'toggle'} value
 */
export async function setMute(target, value) {
  if (process.platform === 'win32') {
    return withLevelServer(`VM ${flowOf(target)} ${muteMode(value)}`,
      () => runLevelScript(buildMuteScript(target, value), { what: `muto ${target}` }));
  }
  const impl = adapter();
  if (!impl) throw unsupported();
  return impl.setMute(target, value);
}
