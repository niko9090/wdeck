/**
 * Adattatore macOS.
 *
 * Tutto passa da `osascript`, che su macOS e' l'equivalente di PowerShell su
 * Windows: e' preinstallato, non richiede nulla da compilare e sa fare sia
 * l'input sintetico (tramite System Events) sia il controllo del volume.
 *
 * Un avvertimento che vale la pena conoscere prima di provarlo: l'input
 * sintetico su macOS richiede che l'applicazione che lancia l'host (Terminale,
 * iTerm, o il processo `node` stesso) abbia il permesso **Accessibilita'** in
 * Impostazioni di Sistema > Privacy e sicurezza. Senza quel permesso osascript
 * risponde con l'errore -1719 e qui viene tradotto in un messaggio esplicito.
 */

import { runCommand } from './exec.mjs';
import {
  buildMacKeyScript,
  buildMacTypeScript,
  escapeAppleScript
} from './keymaps.mjs';

export const isMacOS = () => process.platform === 'darwin';

/** Applicazioni interrogate per i comandi di riproduzione, in ordine. */
export const MAC_PLAYERS = Object.freeze(['Spotify', 'Music', 'TV']);

/** Comando AppleScript per ciascuna chiave logica dell'azione `media`. */
const MAC_PLAYER_COMMANDS = Object.freeze({
  playpause: { default: 'playpause' },
  play: { default: 'play' },
  pause: { default: 'pause' },
  next: { default: 'next track' },
  prev: { default: 'previous track' },
  previous: { default: 'previous track' },
  // Spotify non conosce "stop": la pausa e' l'equivalente piu' vicino.
  stop: { default: 'stop', Spotify: 'pause' }
});

/**
 * Esegue uno script AppleScript.
 * @param {string} script
 * @param {{timeoutMs?: number, what?: string}} [options]
 * @returns {Promise<string>} stdout
 */
export async function runOsascript(script, { timeoutMs = 10000, what = 'osascript' } = {}) {
  const res = await runCommand('osascript', ['-e', script], { timeoutMs });
  if (res.timedOut) throw new Error(`${what}: comando interrotto per timeout`);
  if (res.code !== 0) {
    const message = res.stderr || `uscita ${res.code}`;
    if (/-1719|not allowed|assistive/i.test(message)) {
      throw new Error(`${what}: macOS ha negato l'input sintetico. Concedi il permesso `
        + 'Accessibilita\' all\'applicazione che avvia Wdeck in Impostazioni di Sistema > '
        + 'Privacy e sicurezza > Accessibilita\'.');
    }
    throw new Error(`${what}: ${message.slice(0, 240)}`);
  }
  return res.stdout;
}

/**
 * Preme una combinazione di tasti.
 * @param {{modifiers?: string[], key: string, repeat?: number}} spec
 */
export function sendKey(spec) {
  return runOsascript(buildMacKeyScript(spec), { what: 'invio tasti' });
}

/**
 * Digita un testo nell'applicazione attiva.
 * @param {string} text
 */
export function typeText(text) {
  return runOsascript(buildMacTypeScript(text), { what: 'digitazione testo', timeoutMs: 15000 });
}

/**
 * Apre un URL con l'applicazione predefinita.
 * @param {string} url
 */
export async function openUrl(url) {
  const res = await runCommand('open', [String(url)], { timeoutMs: 10000 });
  if (res.code !== 0) throw new Error(`apertura URL fallita: ${res.stderr || `uscita ${res.code}`}`);
  return res.stdout;
}

/**
 * AppleScript che inoltra un comando di riproduzione al primo lettore attivo.
 * Funzione pura, cosi' da poter essere verificata senza un Mac.
 * @param {string} key chiave logica dell'azione `media`
 * @returns {string}
 */
export function buildMacPlayerScript(key) {
  const spec = MAC_PLAYER_COMMANDS[key];
  if (!spec) throw new Error(`comando di riproduzione non supportato su macOS: "${key}"`);

  const lines = [
    'tell application "System Events" to set attivi to name of every process'
  ];
  MAC_PLAYERS.forEach((app, index) => {
    const command = spec[app] ?? spec.default;
    lines.push(`${index === 0 ? 'if' : 'else if'} attivi contains "${app}" then`);
    lines.push(`  tell application "${app}" to ${command}`);
  });
  lines.push('else');
  lines.push(`  error "nessun lettore multimediale attivo (${MAC_PLAYERS.join(', ')})"`);
  lines.push('end if');
  return lines.join('\n');
}

/**
 * Legge volume (0..100) e stato del muto di un canale.
 *
 * `get volume settings` espone `output muted` ma non l'equivalente per
 * l'ingresso: per il microfono lo stato del muto resta indefinito, e viene
 * riportato come tale invece di essere inventato.
 * @param {'speaker'|'mic'} [target]
 * @returns {Promise<{volume: number, muted: boolean|undefined}>}
 */
export async function readVolume(target = 'speaker') {
  const field = target === 'mic' ? 'input volume' : 'output volume';
  const out = await runOsascript(
    `set s to get volume settings\nreturn (${field} of s as text) & ";" & (output muted of s as text)`,
    { what: 'lettura volume' }
  );
  const [rawVolume, rawMuted] = String(out).split(';');
  return {
    volume: Math.max(0, Math.min(100, Math.round(Number(rawVolume)) || 0)),
    muted: target === 'mic' ? undefined : String(rawMuted).trim() === 'true'
  };
}

/**
 * Imposta il volume di un canale.
 * @param {'speaker'|'mic'} target
 * @param {number} percent 0..100
 */
export async function setVolume(target, percent) {
  const value = Math.max(0, Math.min(100, Math.round(Number(percent)) || 0));
  const field = target === 'mic' ? 'input volume' : 'output volume';
  await runOsascript(`set volume ${field} ${value}`, { what: 'volume' });
  return readVolume(target);
}

/**
 * Imposta o inverte il muto dell'uscita audio.
 * @param {'speaker'|'mic'} target
 * @param {boolean|'toggle'} value
 */
export async function setMute(target, value) {
  if (target === 'mic') {
    // Silenziare l'ingresso equivale a portarne il livello a zero: e' l'unica
    // via da AppleScript, e non e' reversibile da sola (il livello precedente
    // andrebbe ricordato), quindi si dichiara il limite invece di fingere.
    throw new Error('microfono: su macOS il muto non e\' pilotabile via osascript, usare "value": 0');
  }
  let next = value;
  if (value === 'toggle') next = !(await readVolume('speaker')).muted;
  await runOsascript(`set volume ${next ? 'with' : 'without'} output muted`, { what: 'muto' });
  return readVolume('speaker');
}

/**
 * Esegue un comando dell'azione `media`.
 * I tasti di volume passano dal controllo assoluto, che su macOS e' l'unico
 * modo affidabile: non esiste un equivalente di `keybd_event` per i tasti
 * multimediali senza codice nativo.
 * @param {string} key
 */
export async function sendMediaKey(key) {
  const name = String(key ?? '').trim().toLowerCase();
  if (name === 'mute') {
    const out = await setMute('speaker', 'toggle');
    return { detail: out.muted ? 'audio silenziato' : 'audio riattivato', ...out };
  }
  if (name === 'volumeup' || name === 'volup') {
    const current = await readVolume('speaker');
    const out = await setVolume('speaker', current.volume + 6);
    return { detail: `volume ${out.volume}%`, ...out };
  }
  if (name === 'volumedown' || name === 'voldown') {
    const current = await readVolume('speaker');
    const out = await setVolume('speaker', current.volume - 6);
    return { detail: `volume ${out.volume}%`, ...out };
  }
  await runOsascript(buildMacPlayerScript(name), { what: `comando "${name}"` });
  return { detail: `comando "${name}" inviato al lettore attivo` };
}

/**
 * Il testo dell'operazione che verrebbe eseguita, mostrato in dry-run.
 * @param {string} key
 */
export function describeMediaKey(key) {
  const name = String(key ?? '').trim().toLowerCase();
  if (['mute', 'volumeup', 'volup', 'volumedown', 'voldown'].includes(name)) {
    return `osascript: controllo volume (${name})`;
  }
  return `osascript: "${name}" al primo lettore attivo fra ${MAC_PLAYERS.join(', ')}`;
}

export { escapeAppleScript };
