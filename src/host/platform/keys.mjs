/**
 * Mappa dei tasti virtuali Windows e parsing delle hotkey.
 * Modulo puro (nessun I/O) cosi' da poter essere testato su qualunque piattaforma.
 */

/** Codici Virtual-Key usati dall'host. */
export const VK = Object.freeze({
  backspace: 0x08,
  tab: 0x09,
  enter: 0x0d,
  shift: 0x10,
  ctrl: 0x11,
  alt: 0x12,
  pause: 0x13,
  capslock: 0x14,
  esc: 0x1b,
  space: 0x20,
  pageup: 0x21,
  pagedown: 0x22,
  end: 0x23,
  home: 0x24,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  printscreen: 0x2c,
  insert: 0x2d,
  delete: 0x2e,
  win: 0x5b,
  rwin: 0x5c,
  apps: 0x5d,
  numlock: 0x90,
  scrolllock: 0x91,
  // multimedia
  volumemute: 0xad,
  volumedown: 0xae,
  volumeup: 0xaf,
  medianext: 0xb0,
  mediaprev: 0xb1,
  mediastop: 0xb2,
  mediaplaypause: 0xb3,
  browserback: 0xa6,
  browserforward: 0xa7
});

/** Alias accettati nelle stringhe hotkey. */
export const KEY_ALIASES = Object.freeze({
  control: 'ctrl',
  ctl: 'ctrl',
  cmd: 'win',
  windows: 'win',
  super: 'win',
  meta: 'win',
  return: 'enter',
  escape: 'esc',
  del: 'delete',
  ins: 'insert',
  pgup: 'pageup',
  pgdn: 'pagedown',
  pgdown: 'pagedown',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  spacebar: 'space',
  prtsc: 'printscreen'
});

/** Nomi dei tasti considerati modificatori. */
export const MODIFIERS = Object.freeze(['ctrl', 'alt', 'shift', 'win']);

/** Chiavi logiche accettate dall'azione `media`. */
export const MEDIA_KEYS = Object.freeze({
  playpause: VK.mediaplaypause,
  play: VK.mediaplaypause,
  pause: VK.mediaplaypause,
  next: VK.medianext,
  prev: VK.mediaprev,
  previous: VK.mediaprev,
  stop: VK.mediastop,
  mute: VK.volumemute,
  volumeup: VK.volumeup,
  volup: VK.volumeup,
  volumedown: VK.volumedown,
  voldown: VK.volumedown
});

/**
 * Risolve il nome di un tasto singolo nel suo Virtual-Key code.
 * @param {string} name
 * @returns {number|null} null se il nome non e' riconosciuto
 */
export function resolveKey(name) {
  const raw = String(name ?? '').trim().toLowerCase();
  if (!raw) return null;
  const key = KEY_ALIASES[raw] ?? raw;

  if (Object.hasOwn(VK, key)) return VK[key];
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) return 0x6f + Number(key.slice(1));
  if (/^[a-z0-9]$/.test(key)) return key.toUpperCase().charCodeAt(0);
  if (Object.hasOwn(MEDIA_KEYS, key)) return MEDIA_KEYS[key];
  return null;
}

/**
 * Analizza una stringa hotkey del tipo "ctrl+shift+m".
 * @param {string} spec
 * @returns {{modifiers: string[], key: string, modifierCodes: number[], keyCode: number}}
 * @throws {Error} se la stringa non e' valida
 */
export function parseHotkey(spec) {
  if (typeof spec !== 'string' || spec.trim() === '') {
    throw new Error('hotkey vuota: attesa una stringa tipo "ctrl+shift+m"');
  }
  const parts = spec.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) throw new Error(`hotkey non valida: "${spec}"`);

  const modifiers = [];
  let key = null;

  for (const part of parts) {
    const name = KEY_ALIASES[part] ?? part;
    if (MODIFIERS.includes(name)) {
      if (!modifiers.includes(name)) modifiers.push(name);
      continue;
    }
    if (key !== null) throw new Error(`hotkey non valida: "${spec}" contiene piu' di un tasto non modificatore`);
    key = name;
  }

  if (key === null) throw new Error(`hotkey non valida: "${spec}" non contiene un tasto finale`);
  const keyCode = resolveKey(key);
  if (keyCode === null) throw new Error(`tasto sconosciuto: "${key}"`);

  return {
    modifiers,
    key,
    modifierCodes: modifiers.map((m) => VK[m]),
    keyCode
  };
}

/**
 * Risolve la chiave logica di un'azione media nel suo Virtual-Key code.
 * @param {string} key
 * @returns {number}
 * @throws {Error} se la chiave non e' supportata
 */
export function resolveMediaKey(key) {
  const name = String(key ?? '').trim().toLowerCase();
  if (!Object.hasOwn(MEDIA_KEYS, name)) {
    throw new Error(`tasto media non supportato: "${key}" (ammessi: ${Object.keys(MEDIA_KEYS).join(', ')})`);
  }
  return MEDIA_KEYS[name];
}
