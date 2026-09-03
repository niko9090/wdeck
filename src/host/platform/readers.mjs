/**
 * Letture di stato condivise fra gli handler.
 *
 * Sono raccolte qui, e non dentro i singoli handler, perche' la stessa lettura
 * serve a piu' azioni: il cursore del volume, il bottone del muto e il tasto
 * multimediale "mute" leggono tutti lo stesso endpoint audio. Passando da
 * `ctx.cached()` un giro di aggiornamento costa una sola lettura per canale,
 * anche con dieci controlli che ne dipendono.
 */

import { readVolume } from './audio.mjs';
import { readBrightnessFast as readBrightness } from './levelserver.mjs';

/**
 * Volume e stato del muto di un canale, riusando la lettura del giro corrente.
 * @param {{cached?: (key: string, fn: () => Promise<any>) => Promise<any>}} ctx
 * @param {'speaker'|'mic'} target
 * @returns {Promise<{volume?: number, muted?: boolean}>}
 */
export function readAudioLevel(ctx, target = 'speaker') {
  const run = () => readVolume(target);
  return ctx?.cached ? ctx.cached(`audio:${target}`, run) : run();
}

/**
 * Luminosita' dello schermo, riusando la lettura del giro corrente.
 * @param {{cached?: (key: string, fn: () => Promise<any>) => Promise<any>}} ctx
 * @returns {Promise<{brightness?: number, mode?: string}>}
 */
export function readBrightnessLevel(ctx) {
  const run = () => readBrightness();
  return ctx?.cached ? ctx.cached('brightness', run) : run();
}
