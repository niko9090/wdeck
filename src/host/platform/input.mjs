/**
 * Facciata dell'input sintetico: sceglie l'adattatore della piattaforma.
 *
 * Gli handler (`media`, `hotkey`, `text`, `url`) parlano solo con questo
 * modulo e non sanno piu' su quale sistema stanno girando. Il percorso Windows
 * e' rimasto identico a prima - le stesse funzioni di `windows.mjs`, gli stessi
 * script PowerShell - perche' era gia' collaudato e non c'era ragione di
 * riscriverlo per fare posto agli altri due.
 *
 * Ogni operazione ha una coppia `plan*` / `send*`: la prima descrive cosa
 * verrebbe fatto (serve al dry-run, ed e' pura), la seconda lo fa davvero.
 */

import * as linux from './linux.mjs';
import * as macos from './macos.mjs';
import { buildKeyOps, buildKeyScript, buildMouseOps, buildMouseScript, buildOpenUrlScript, buildTypeTextScript, encodeKeyOps, MOUSE_COMMANDS, runPowerShell } from './windows.mjs';
import { keyServerEnabled, sendKeyOps } from './keyserver.mjs';
import { parseHotkey, resolveMediaKey, VK } from './keys.mjs';
import { buildMacKeyScript } from './keymaps.mjs';
import { buildXdotoolKeyArgs } from './keymaps.mjs';

/** Piattaforme su cui l'input sintetico e' implementato. */
export const SUPPORTED_PLATFORMS = Object.freeze(['win32', 'darwin', 'linux']);

/**
 * Invia una sequenza di tasti su Windows. Prova prima il key server persistente
 * (veloce: nessuna ricompilazione); se non c'e' o fallisce, ricade sul PowerShell
 * a colpo singolo, cosi' la pressione va a buon fine comunque.
 * @param {number[]} modifierCodes
 * @param {number} keyCode
 * @param {number} repeat
 */
async function inviaTastiWindows(modifierCodes, keyCode, repeat) {
  if (keyServerEnabled()) {
    try {
      await sendKeyOps(encodeKeyOps(buildKeyOps(modifierCodes, keyCode, { repeat })));
      return;
    } catch {
      // il processo persistente non e' disponibile: si prosegue col metodo classico
    }
  }
  const res = await runPowerShell(buildKeyScript(modifierCodes, keyCode, { repeat }), { timeoutMs: 8000 });
  if (res.code !== 0) throw new Error(`PowerShell ha restituito ${res.code}: ${res.stderr || 'errore sconosciuto'}`);
}

/**
 * Nome dell'adattatore per una piattaforma.
 * @param {string} [platform]
 * @returns {'windows'|'macos'|'linux'|null}
 */
export function backendFor(platform = process.platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  return null;
}

function requireBackend(platform = process.platform) {
  const backend = backendFor(platform);
  if (!backend) {
    throw new Error(`piattaforma non supportata per l'input sintetico: ${platform} `
      + `(supportate: ${SUPPORTED_PLATFORMS.join(', ')})`);
  }
  return backend;
}

// ------------------------------------------------------------------ hotkey

/**
 * Descrive la pressione di una combinazione, senza eseguirla.
 * @param {string} spec es. "ctrl+shift+m"
 * @param {{repeat?: number, platform?: string}} [options]
 * @returns {{backend: string, description: string, command: string|null}}
 */
export function planHotkey(spec, { repeat = 1, platform = process.platform } = {}) {
  const backend = requireBackend(platform);
  const hotkey = parseHotkey(spec);
  const combo = [...hotkey.modifiers, hotkey.key].join('+');

  if (backend === 'windows') {
    return {
      backend,
      description: `invierebbe ${combo}`,
      command: buildKeyScript(hotkey.modifierCodes, hotkey.keyCode, { repeat })
    };
  }
  if (backend === 'macos') {
    return {
      backend,
      description: `invierebbe ${combo} via osascript`,
      command: buildMacKeyScript({ modifiers: hotkey.modifiers, key: hotkey.key, repeat })
    };
  }
  // Il dry-run mostra lo strumento che verrebbe davvero usato: su Wayland
  // sendHotkey passa da ydotool, altrove da xdotool.
  const wayland = linux.isWayland();
  const command = wayland
    ? `ydotool ${linux.buildYdotoolKeyArgs({ modifiers: hotkey.modifiers, key: hotkey.key, repeat }).join(' ')}`
    : `xdotool ${buildXdotoolKeyArgs({ modifiers: hotkey.modifiers, key: hotkey.key, repeat }).join(' ')}`;
  return {
    backend,
    description: `invierebbe ${combo} via ${wayland ? 'ydotool' : 'xdotool'}`,
    command
  };
}

/**
 * Preme una combinazione di tasti.
 * @param {string} spec
 * @param {{repeat?: number}} [options]
 */
export async function sendHotkey(spec, { repeat = 1 } = {}) {
  const backend = requireBackend();
  const hotkey = parseHotkey(spec);

  if (backend === 'windows') {
    await inviaTastiWindows(hotkey.modifierCodes, hotkey.keyCode, repeat);
    return { detail: `inviata hotkey "${spec}"` };
  }
  const adapter = backend === 'macos' ? macos : linux;
  await adapter.sendKey({ modifiers: hotkey.modifiers, key: hotkey.key, repeat });
  return { detail: `inviata hotkey "${spec}"` };
}

// ------------------------------------------------------------------ tasti media

/**
 * Descrive un comando multimediale, senza eseguirlo.
 * @param {string} key
 * @param {{repeat?: number, platform?: string}} [options]
 */
export function planMediaKey(key, { repeat = 1, platform = process.platform } = {}) {
  const backend = requireBackend(platform);
  const keyCode = resolveMediaKey(key);

  if (backend === 'windows') {
    return {
      backend,
      description: `invierebbe VK 0x${keyCode.toString(16)} (${key})`,
      command: buildKeyScript([], keyCode, { repeat })
    };
  }
  const adapter = backend === 'macos' ? macos : linux;
  return { backend, description: adapter.describeMediaKey(key), command: null };
}

/**
 * Esegue un comando multimediale.
 * @param {string} key
 * @param {{repeat?: number}} [options]
 */
export async function sendMediaKey(key, { repeat = 1 } = {}) {
  const backend = requireBackend();
  const keyCode = resolveMediaKey(key);

  if (backend === 'windows') {
    await inviaTastiWindows([], keyCode, repeat);
    return { detail: `inviato tasto media "${key}"` };
  }

  // macOS e Linux non hanno un equivalente di keybd_event per i tasti
  // multimediali: la ripetizione si ottiene invocando piu' volte il comando.
  const adapter = backend === 'macos' ? macos : linux;
  const times = Math.max(1, Math.min(20, Number(repeat) || 1));
  let last = null;
  for (let i = 0; i < times; i += 1) {
    last = await adapter.sendMediaKey(key);
  }
  return { detail: last?.detail ?? `inviato comando media "${key}"`, ...last };
}

// ------------------------------------------------------------------ mouse

/** Descrizioni leggibili dei comandi del mouse. */
const MOUSE_LABELS = {
  left: 'clic sinistro', right: 'clic destro', middle: 'clic centrale',
  double: 'doppio clic', 'scroll-up': 'scorri su', 'scroll-down': 'scorri giu\'',
  move: 'sposta il puntatore'
};

/** Etichetta leggibile, con gli scatti o il punto quando ci sono. */
function describeMouse(command, { notches, x, y } = {}) {
  const base = MOUSE_LABELS[command] ?? command;
  if (command === 'move') return `mouse: ${base} a ${Math.round(x ?? 0)}%, ${Math.round(y ?? 0)}%`;
  if (notches != null && Math.abs(notches) > 1) return `mouse: ${base} x${Math.round(Math.abs(notches))}`;
  return `mouse: ${base}`;
}

/**
 * Descrive un comando del mouse senza eseguirlo.
 * @param {string} command
 * @param {{platform?: string, notches?: number, x?: number, y?: number}} [options]
 */
export function planMouse(command, { platform = process.platform, ...rest } = {}) {
  const backend = requireBackend(platform);
  const description = describeMouse(command, rest);
  if (backend === 'windows') {
    return { backend, description, command: buildMouseScript(command, rest) };
  }
  return { backend, description, command: null };
}

/**
 * Esegue un comando del mouse (clic, doppio clic, rotellina, spostamento).
 * Per ora solo Windows.
 * @param {string} command
 * @param {{notches?: number, x?: number, y?: number}} [options]
 */
export async function sendMouse(command, options = {}) {
  const backend = requireBackend();
  if (backend !== 'windows') {
    throw new Error('l\'azione mouse e\' disponibile solo su Windows');
  }
  const detail = describeMouse(command, options);
  if (keyServerEnabled()) {
    try {
      await sendKeyOps(encodeKeyOps(buildMouseOps(command, options)));
      return { detail };
    } catch {
      // il processo persistente non e' disponibile: si prosegue col colpo singolo
    }
  }
  const res = await runPowerShell(buildMouseScript(command, options), { timeoutMs: 8000 });
  if (res.code !== 0) throw new Error(`PowerShell ha restituito ${res.code}: ${res.stderr || 'errore sconosciuto'}`);
  return { detail };
}

export { MOUSE_COMMANDS };

// ------------------------------------------------------------------ testo

/**
 * Descrive la digitazione di un testo, senza eseguirla.
 * @param {string} text
 * @param {{platform?: string}} [options]
 */
export function planText(text, { platform = process.platform } = {}) {
  const backend = requireBackend(platform);
  const description = `digiterebbe ${String(text).length} caratteri`;
  if (backend === 'windows') return { backend, description, command: buildTypeTextScript(text) };
  if (backend === 'macos') return { backend, description: `${description} via osascript`, command: null };
  return { backend, description: `${description} via xdotool/ydotool`, command: null };
}

/**
 * Digita un testo nella finestra attiva.
 * @param {string} text
 */
export async function typeText(text) {
  const backend = requireBackend();
  if (backend === 'windows') {
    const res = await runPowerShell(buildTypeTextScript(text), { timeoutMs: 10000 });
    if (res.code !== 0) throw new Error(`PowerShell ha restituito ${res.code}: ${res.stderr || 'errore sconosciuto'}`);
    return { detail: `digitati ${text.length} caratteri` };
  }
  const adapter = backend === 'macos' ? macos : linux;
  await adapter.typeText(text);
  return { detail: `digitati ${text.length} caratteri` };
}

// ------------------------------------------------------------------ URL

/**
 * Descrive l'apertura di un URL, senza eseguirla.
 * @param {string} url
 * @param {{platform?: string}} [options]
 */
export function planUrl(url, { platform = process.platform } = {}) {
  const backend = requireBackend(platform);
  const strumento = { windows: 'Start-Process', macos: 'open', linux: 'xdg-open' }[backend];
  return { backend, description: `aprirebbe ${url} con ${strumento}`, command: backend === 'windows' ? buildOpenUrlScript(url) : null };
}

/**
 * Apre un URL con l'applicazione predefinita di sistema.
 * @param {string} url
 */
export async function openUrl(url) {
  const backend = requireBackend();
  if (backend === 'windows') {
    const res = await runPowerShell(buildOpenUrlScript(url), { timeoutMs: 10000 });
    if (res.code !== 0) throw new Error(`apertura URL fallita: ${res.stderr || `exit ${res.code}`}`);
    return { detail: `aperto ${url}` };
  }
  const adapter = backend === 'macos' ? macos : linux;
  await adapter.openUrl(url);
  return { detail: `aperto ${url}` };
}

export { VK, parseHotkey, resolveMediaKey };
