/**
 * Adattatore Linux.
 *
 * Su Linux non esiste un'unica via ufficiale come PowerShell o osascript: ogni
 * operazione ha due o tre strumenti diffusi, e quale sia disponibile dipende
 * dalla distribuzione e dal server grafico. Qui si sceglie il primo presente
 * nel PATH, in ordine di preferenza, e se non c'e' nulla l'errore dice
 * esattamente cosa installare invece di fallire in modo oscuro.
 *
 * | operazione | preferito | ripiego |
 * |---|---|---|
 * | tasti e testo | `xdotool` (X11) | `ydotool` (anche Wayland, richiede il demone) |
 * | volume | `pactl` (PipeWire/PulseAudio) | `amixer` (ALSA) |
 * | riproduzione | `playerctl` (MPRIS) | tasto multimediale via `xdotool` |
 * | URL | `xdg-open` | `gio open` |
 */

import { firstAvailable, runCommand } from './exec.mjs';
import { buildXdotoolKeyArgs, buildXdotoolTypeArgs, x11Key, X11_MODIFIERS } from './keymaps.mjs';

export const isLinux = () => process.platform === 'linux';

/** Sotto Wayland xdotool non riesce a iniettare eventi nelle altre finestre. */
export const isWayland = (env = process.env) => String(env.XDG_SESSION_TYPE ?? '').toLowerCase() === 'wayland'
  || Boolean(env.WAYLAND_DISPLAY);

/**
 * Sceglie lo strumento di input disponibile.
 * @param {{env?: object}} [options]
 * @returns {{name: 'xdotool'|'ydotool', path: string}}
 * @throws {Error} se non ce n'e' nessuno
 */
export function pickInputTool({ env = process.env } = {}) {
  // Su Wayland xdotool esiste ma non funziona sulle finestre altrui: ydotool,
  // che passa da /dev/uinput, e' l'unico che ci arriva davvero.
  const order = isWayland(env) ? ['ydotool', 'xdotool'] : ['xdotool', 'ydotool'];
  const found = firstAvailable(order, { env });
  if (!found) {
    throw new Error('input sintetico non disponibile: installa "xdotool" (sessione X11) '
      + 'oppure "ydotool" con il suo demone (sessione Wayland)');
  }
  return found;
}

/**
 * Argomenti di `ydotool` per una combinazione di tasti.
 * ydotool usa i nomi dei tasti del kernel (`KEY_LEFTCTRL+KEY_A`).
 * @param {{modifiers?: string[], key: string, repeat?: number}} spec
 * @returns {string[]}
 */
export function buildYdotoolKeyArgs({ modifiers = [], key, repeat = 1 }) {
  const times = Math.max(1, Math.min(20, Number(repeat) || 1));
  const codes = [
    ...modifiers.map((m) => YDOTOOL_MODIFIERS[m]).filter(Boolean),
    ydotoolKey(key)
  ];
  // ydotool vuole pressione e rilascio espliciti: :1 preme, :0 rilascia.
  const sequence = [
    ...codes.map((c) => `${c}:1`),
    ...[...codes].reverse().map((c) => `${c}:0`)
  ];
  const args = ['key'];
  for (let i = 0; i < times; i += 1) args.push(...sequence);
  return args;
}

/** Modificatori nella nomenclatura dei tasti del kernel Linux. */
export const YDOTOOL_MODIFIERS = Object.freeze({
  ctrl: 'KEY_LEFTCTRL',
  alt: 'KEY_LEFTALT',
  shift: 'KEY_LEFTSHIFT',
  win: 'KEY_LEFTMETA'
});

/** Tasti del kernel che non seguono la regola "KEY_" + nome maiuscolo. */
const YDOTOOL_ALIASES = Object.freeze({
  enter: 'KEY_ENTER',
  esc: 'KEY_ESC',
  backspace: 'KEY_BACKSPACE',
  pageup: 'KEY_PAGEUP',
  pagedown: 'KEY_PAGEDOWN',
  printscreen: 'KEY_SYSRQ',
  capslock: 'KEY_CAPSLOCK',
  numlock: 'KEY_NUMLOCK',
  scrolllock: 'KEY_SCROLLLOCK',
  apps: 'KEY_COMPOSE',
  volumemute: 'KEY_MUTE',
  volumeup: 'KEY_VOLUMEUP',
  volumedown: 'KEY_VOLUMEDOWN',
  medianext: 'KEY_NEXTSONG',
  mediaprev: 'KEY_PREVIOUSSONG',
  mediastop: 'KEY_STOPCD',
  mediaplaypause: 'KEY_PLAYPAUSE'
});

/**
 * Nome del tasto nella nomenclatura del kernel Linux.
 * @param {string} name
 * @returns {string}
 */
export function ydotoolKey(name) {
  const key = String(name ?? '').trim().toLowerCase();
  if (Object.hasOwn(YDOTOOL_ALIASES, key)) return YDOTOOL_ALIASES[key];
  if (/^[a-z0-9]$/.test(key)) return `KEY_${key.toUpperCase()}`;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) return `KEY_${key.toUpperCase()}`;
  if (/^[a-z]+$/.test(key)) return `KEY_${key.toUpperCase()}`;
  throw new Error(`tasto non supportato da ydotool: "${name}"`);
}

/**
 * Preme una combinazione di tasti.
 * @param {{modifiers?: string[], key: string, repeat?: number}} spec
 */
export async function sendKey(spec) {
  const tool = pickInputTool();
  const args = tool.name === 'xdotool' ? buildXdotoolKeyArgs(spec) : buildYdotoolKeyArgs(spec);
  const res = await runCommand(tool.path, args, { timeoutMs: 8000 });
  if (res.code !== 0) throw new Error(`${tool.name}: ${res.stderr || `uscita ${res.code}`}`);
  return res.stdout;
}

/**
 * Digita un testo nella finestra attiva.
 * @param {string} text
 */
export async function typeText(text) {
  const tool = pickInputTool();
  const args = tool.name === 'xdotool' ? buildXdotoolTypeArgs(text) : ['type', String(text)];
  const res = await runCommand(tool.path, args, { timeoutMs: 20000 });
  if (res.code !== 0) throw new Error(`${tool.name}: ${res.stderr || `uscita ${res.code}`}`);
  return res.stdout;
}

/**
 * Apre un URL con l'applicazione predefinita.
 * @param {string} url
 */
export async function openUrl(url) {
  const opener = firstAvailable(['xdg-open', 'gio']);
  if (!opener) throw new Error('apertura URL non disponibile: installa "xdg-utils" (xdg-open)');
  const args = opener.name === 'gio' ? ['open', String(url)] : [String(url)];
  const res = await runCommand(opener.path, args, { timeoutMs: 10000 });
  if (res.code !== 0) throw new Error(`apertura URL fallita: ${res.stderr || `uscita ${res.code}`}`);
  return res.stdout;
}

/** Destinazione PulseAudio/PipeWire corrispondente al canale logico. */
const sinkOf = (target) => (target === 'mic' ? '@DEFAULT_SOURCE@' : '@DEFAULT_SINK@');
const kindOf = (target) => (target === 'mic' ? 'source' : 'sink');

/**
 * Estrae la prima percentuale dall'output di `pactl get-sink-volume`.
 * L'output elenca un valore per canale ("front-left: 32768 / 50% / ..."):
 * a Wdeck serve un numero solo, e i canali sono quasi sempre allineati.
 * @param {string} stdout
 * @returns {number|null}
 */
export function parsePactlVolume(stdout) {
  const match = String(stdout).match(/(\d{1,3})%/);
  if (!match) return null;
  return Math.max(0, Math.min(100, Number(match[1])));
}

/**
 * Legge volume e stato del muto di un canale.
 * @param {'speaker'|'mic'} [target]
 * @returns {Promise<{volume: number|null, muted: boolean|undefined}>}
 */
export async function readVolume(target = 'speaker') {
  const pactl = firstAvailable(['pactl']);
  if (pactl) {
    const kind = kindOf(target);
    const volume = await runCommand(pactl.path, [`get-${kind}-volume`, sinkOf(target)], { timeoutMs: 6000 });
    const mute = await runCommand(pactl.path, [`get-${kind}-mute`, sinkOf(target)], { timeoutMs: 6000 });
    if (volume.code !== 0) throw new Error(`pactl: ${volume.stderr || `uscita ${volume.code}`}`);
    return {
      volume: parsePactlVolume(volume.stdout),
      muted: mute.code === 0 ? /yes/i.test(mute.stdout) : undefined
    };
  }

  const amixer = firstAvailable(['amixer']);
  if (!amixer) throw new Error('controllo volume non disponibile: installa "pactl" (PipeWire/PulseAudio) o "amixer" (ALSA)');
  const res = await runCommand(amixer.path, ['get', target === 'mic' ? 'Capture' : 'Master'], { timeoutMs: 6000 });
  if (res.code !== 0) throw new Error(`amixer: ${res.stderr || `uscita ${res.code}`}`);
  return { volume: parsePactlVolume(res.stdout), muted: /\[off\]/.test(res.stdout) };
}

/**
 * Imposta il volume di un canale a un valore assoluto.
 * @param {'speaker'|'mic'} target
 * @param {number} percent 0..100
 */
export async function setVolume(target, percent) {
  const value = Math.max(0, Math.min(100, Math.round(Number(percent)) || 0));
  const pactl = firstAvailable(['pactl']);
  if (pactl) {
    const res = await runCommand(pactl.path, [`set-${kindOf(target)}-volume`, sinkOf(target), `${value}%`], { timeoutMs: 6000 });
    if (res.code !== 0) throw new Error(`pactl: ${res.stderr || `uscita ${res.code}`}`);
    return readVolume(target);
  }
  const amixer = firstAvailable(['amixer']);
  if (!amixer) throw new Error('controllo volume non disponibile: installa "pactl" o "amixer"');
  const res = await runCommand(amixer.path, ['set', target === 'mic' ? 'Capture' : 'Master', `${value}%`], { timeoutMs: 6000 });
  if (res.code !== 0) throw new Error(`amixer: ${res.stderr || `uscita ${res.code}`}`);
  return readVolume(target);
}

/**
 * Imposta o inverte il muto di un canale.
 * @param {'speaker'|'mic'} target
 * @param {boolean|'toggle'} value
 */
export async function setMute(target, value) {
  const argument = value === 'toggle' ? 'toggle' : (value ? '1' : '0');
  const pactl = firstAvailable(['pactl']);
  if (pactl) {
    const res = await runCommand(pactl.path, [`set-${kindOf(target)}-mute`, sinkOf(target), argument], { timeoutMs: 6000 });
    if (res.code !== 0) throw new Error(`pactl: ${res.stderr || `uscita ${res.code}`}`);
    return readVolume(target);
  }
  const amixer = firstAvailable(['amixer']);
  if (!amixer) throw new Error('controllo volume non disponibile: installa "pactl" o "amixer"');
  const state = value === 'toggle' ? 'toggle' : (value ? 'mute' : 'unmute');
  const res = await runCommand(amixer.path, ['set', target === 'mic' ? 'Capture' : 'Master', state], { timeoutMs: 6000 });
  if (res.code !== 0) throw new Error(`amixer: ${res.stderr || `uscita ${res.code}`}`);
  return readVolume(target);
}

/** Comando `playerctl` corrispondente a ciascuna chiave logica di `media`. */
const PLAYERCTL_COMMANDS = Object.freeze({
  playpause: 'play-pause',
  play: 'play',
  pause: 'pause',
  next: 'next',
  prev: 'previous',
  previous: 'previous',
  stop: 'stop'
});

/** Tasto X11 equivalente, quando playerctl non c'e'. */
const MEDIA_KEYSYMS = Object.freeze({
  playpause: 'mediaplaypause',
  play: 'mediaplaypause',
  pause: 'mediaplaypause',
  next: 'medianext',
  prev: 'mediaprev',
  previous: 'mediaprev',
  stop: 'mediastop'
});

/**
 * Esegue un comando dell'azione `media`.
 * @param {string} key
 */
export async function sendMediaKey(key) {
  const name = String(key ?? '').trim().toLowerCase();

  if (name === 'mute') {
    const out = await setMute('speaker', 'toggle');
    return { detail: out.muted ? 'audio silenziato' : 'audio riattivato', ...out };
  }
  if (name === 'volumeup' || name === 'volup' || name === 'volumedown' || name === 'voldown') {
    const current = await readVolume('speaker');
    const delta = name.startsWith('volumeu') || name === 'volup' ? 6 : -6;
    const out = await setVolume('speaker', (current.volume ?? 50) + delta);
    return { detail: `volume ${out.volume}%`, ...out };
  }

  const playerctl = firstAvailable(['playerctl']);
  if (playerctl && PLAYERCTL_COMMANDS[name]) {
    const res = await runCommand(playerctl.path, [PLAYERCTL_COMMANDS[name]], { timeoutMs: 6000 });
    if (res.code !== 0) throw new Error(`playerctl: ${res.stderr || `uscita ${res.code}`}`);
    return { detail: `playerctl ${PLAYERCTL_COMMANDS[name]}` };
  }

  // Senza playerctl resta il tasto multimediale: quasi tutti gli ambienti
  // desktop lo intercettano e lo inoltrano al lettore in primo piano.
  const keysym = MEDIA_KEYSYMS[name];
  if (!keysym) throw new Error(`comando di riproduzione non supportato: "${key}"`);
  await sendKey({ modifiers: [], key: keysym });
  return { detail: `tasto multimediale ${x11Key(keysym)}` };
}

/**
 * Il testo dell'operazione che verrebbe eseguita, mostrato in dry-run.
 * @param {string} key
 */
export function describeMediaKey(key) {
  const name = String(key ?? '').trim().toLowerCase();
  if (['mute', 'volumeup', 'volup', 'volumedown', 'voldown'].includes(name)) {
    return `pactl/amixer: controllo volume (${name})`;
  }
  return `playerctl ${PLAYERCTL_COMMANDS[name] ?? name} (o tasto multimediale se assente)`;
}

export { X11_MODIFIERS };
