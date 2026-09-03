/**
 * "Level server": volume e luminosita' senza riavviare PowerShell ogni volta.
 *
 * Ogni comando volume/luminosita' avviava un PowerShell nuovo e ricompilava
 * con `Add-Type` il ponte C# verso Core Audio (o DDC/CI + gamma): dal registro
 * dell'host, 2-7 secondi per pressione, e fino a 12 con i comandi accodati da
 * un cursore trascinato. Qui il processo resta acceso (`psworker.mjs`), compila
 * una volta sola e poi esegue ogni comando in pochi millisecondi.
 *
 * Protocollo (una riga per comando, solo parole chiave e numeri):
 *   VR <flow>            legge volume e muto           -> volume=..;muted=..
 *   VS <flow> <pct>      imposta il volume 0..100
 *   VA <flow> <delta>    somma un delta -100..100
 *   VM <flow> <0|1|2>    muto off / on / inverti
 *   BR                   legge la luminosita'          -> brightness=..;mode=..
 *   BS <pct>             imposta la luminosita'
 *   BA <delta>           somma un delta
 * `flow` e' il canale Core Audio: 0 = altoparlanti, 1 = microfono.
 *
 * Le funzioni PowerShell che fanno il lavoro (`LEVEL_FUNCTIONS`) sono le STESSE
 * usate dagli script a colpo singolo di `levels.mjs`: una sola logica, due
 * modi di eseguirla. Se il server non parte o non risponde, `withLevelServer`
 * ripiega sullo script singolo e il comando arriva comunque.
 */

import { PowerShellWorker, workerLoop } from './psworker.mjs';
import {
  AUDIO_PREAMBLE, DDC_PREAMBLE, LEVEL_FUNCTIONS,
  buildReadBrightnessScript, buildReadVolumeScript, flowOf, parseLevelOutput, runLevelScript
} from './levels.mjs';
import { isWindows } from './windows.mjs';

const INV = '[Globalization.CultureInfo]::InvariantCulture';

/** Il ciclo del processo: da una riga di comando a una riga di risposta. */
const HANDLER = [
  '    switch ($p[1]) {',
  '      "VR" { $r = Wdeck-VolOut ([int]$p[2]) }',
  `      "VS" { $r = Wdeck-VolSet ([int]$p[2]) ([double]::Parse($p[3], ${INV})) }`,
  `      "VA" { $r = Wdeck-VolAdjust ([int]$p[2]) ([double]::Parse($p[3], ${INV})) }`,
  '      "VM" { $r = Wdeck-VolMute ([int]$p[2]) ([int]$p[3]) }',
  '      "BR" { $r = Wdeck-BriRead }',
  '      "BS" { $r = Wdeck-BriSet ([int]$p[2]) }',
  `      "BA" { $r = Wdeck-BriAdjust ([double]::Parse($p[2], ${INV})) }`,
  '      default { throw "comando sconosciuto: " + $p[1] }',
  '    }'
].join('\n');

/** Script di avvio completo: i due ponti C#, le funzioni, il ciclo. */
export function levelBootstrap() {
  return [AUDIO_PREAMBLE, DDC_PREAMBLE, LEVEL_FUNCTIONS, workerLoop(HANDLER)].join('\n');
}

let server = null;

/** Vero se il level server e' utilizzabile (Windows e non disattivato). */
export function levelServerEnabled() {
  return isWindows() && process.env.WDECK_LEVELSERVER !== '0';
}

function instance() {
  if (!server) {
    server = new PowerShellWorker({
      name: 'level server',
      bootstrap: levelBootstrap(),
      // La compilazione dei tre ponti C# all'avvio e' lenta quanto un comando
      // singolo di prima: fino a 30 s la prima volta, poi mai piu'.
      readyMs: 30000,
      // La luminosita' via WMI/DDC puo' impiegare un secondo per monitor.
      jobMs: 15000
    });
  }
  return server;
}

/**
 * Esegue un comando sul processo persistente.
 * Lancia se non disponibile; un errore DEL COMANDO (es. "nessun metodo di
 * controllo luminosita'") arriva con `remote: true`, cosi' chi chiama non lo
 * confonde con un processo che non funziona.
 * @param {string} command
 * @returns {Promise<{volume?: number, muted?: boolean, brightness?: number, mode?: string}>}
 */
export async function levelCommand(command) {
  if (!levelServerEnabled()) throw new Error('level server non disponibile');
  return parseLevelOutput(await instance().run(command));
}

/**
 * Prova il processo persistente; se e' lui a non funzionare, ripiega sulla
 * via lenta. Un errore restituito dal comando invece viene rilanciato subito:
 * rifarlo con lo script singolo darebbe lo stesso errore, con 3 secondi in piu'.
 * @template T
 * @param {string} command
 * @param {() => Promise<T>} fallback
 * @returns {Promise<T>}
 */
export async function withLevelServer(command, fallback) {
  if (levelServerEnabled()) {
    try {
      return await levelCommand(command);
    } catch (err) {
      if (err?.remote) throw new Error(err.message.replace(/^level server:\s*/, ''));
      // processo assente, bloccato o morto: si passa oltre
    }
  }
  return fallback();
}

/** Legge volume e muto di un canale (veloce, con ripiego). */
export function readVolumeFast(target = 'speaker') {
  return withLevelServer(`VR ${flowOf(target)}`,
    () => runLevelScript(buildReadVolumeScript(target), { what: `volume ${target}` }));
}

/** Legge la luminosita' (veloce, con ripiego). */
export function readBrightnessFast() {
  return withLevelServer('BR',
    () => runLevelScript(buildReadBrightnessScript(), { what: 'luminosita\'', timeoutMs: 30000 }));
}

/**
 * Avvia il processo in anticipo, senza aspettarlo: cosi' la compilazione
 * avviene all'avvio dell'host e non alla prima pressione dell'utente.
 */
export function warmLevelServer() {
  if (!levelServerEnabled()) return;
  instance().start().catch(() => { /* si riprovera' al primo comando */ });
}

/** Ferma il processo persistente (da chiamare alla chiusura dell'host). */
export function stopLevelServer() {
  if (server) { server.stop(); server = null; }
}
