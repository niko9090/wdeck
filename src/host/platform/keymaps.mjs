/**
 * Traduzione dei nomi di tasto Wdeck nei dialetti di macOS e X11.
 *
 * Modulo puro, senza I/O: e' la parte degli adattatori che si puo' verificare
 * su qualunque sistema, compresa la macchina Windows su cui il progetto e'
 * nato. Gli adattatori veri (`macos.mjs`, `linux.mjs`) si limitano a lanciare
 * i comandi costruiti qui.
 *
 * I nomi in ingresso sono quelli gia' normalizzati da `keys.mjs`
 * (`parseHotkey` risolve gli alias: `cmd` e `super` diventano entrambi `win`).
 */

/**
 * Virtual key code di macOS per i tasti che non sono un carattere.
 * Sono i valori storici di Carbon, ancora usati da `System Events`.
 */
export const MAC_KEY_CODES = Object.freeze({
  enter: 36,
  tab: 48,
  space: 49,
  backspace: 51,
  esc: 53,
  capslock: 57,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97,
  f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
  f13: 105, f14: 107, f15: 113, f16: 106, f17: 64, f18: 79, f19: 80, f20: 90,
  home: 115,
  pageup: 116,
  delete: 117,
  end: 119,
  pagedown: 121,
  left: 123,
  right: 124,
  down: 125,
  up: 126
});

/** Nome del modificatore nella sintassi `using {...}` di AppleScript. */
export const MAC_MODIFIERS = Object.freeze({
  ctrl: 'control down',
  alt: 'option down',
  shift: 'shift down',
  win: 'command down'
});

/** Keysym X11 per i tasti che non sono un carattere (nomi di `xdotool`). */
export const X11_KEYSYMS = Object.freeze({
  enter: 'Return',
  tab: 'Tab',
  space: 'space',
  backspace: 'BackSpace',
  esc: 'Escape',
  capslock: 'Caps_Lock',
  home: 'Home',
  end: 'End',
  pageup: 'Prior',
  pagedown: 'Next',
  insert: 'Insert',
  delete: 'Delete',
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
  printscreen: 'Print',
  pause: 'Pause',
  numlock: 'Num_Lock',
  scrolllock: 'Scroll_Lock',
  apps: 'Menu',
  volumemute: 'XF86AudioMute',
  volumedown: 'XF86AudioLowerVolume',
  volumeup: 'XF86AudioRaiseVolume',
  medianext: 'XF86AudioNext',
  mediaprev: 'XF86AudioPrev',
  mediastop: 'XF86AudioStop',
  mediaplaypause: 'XF86AudioPlay',
  browserback: 'XF86Back',
  browserforward: 'XF86Forward'
});

/** Nome del modificatore per `xdotool key`. */
export const X11_MODIFIERS = Object.freeze({
  ctrl: 'ctrl',
  alt: 'alt',
  shift: 'shift',
  win: 'super'
});

/** true se il nome e' un singolo carattere digitabile. */
const isCharKey = (name) => /^[a-z0-9]$/.test(name);

/**
 * Come macOS deve premere un tasto.
 * @param {string} name nome normalizzato (es. "a", "f5", "left")
 * @returns {{kind: 'char'|'code', value: string|number}}
 * @throws {Error} se il tasto non e' rappresentabile su macOS
 */
export function macKey(name) {
  const key = String(name ?? '').trim().toLowerCase();
  if (isCharKey(key)) return { kind: 'char', value: key };
  if (Object.hasOwn(MAC_KEY_CODES, key)) return { kind: 'code', value: MAC_KEY_CODES[key] };
  throw new Error(`tasto non supportato su macOS: "${name}"`);
}

/**
 * Keysym X11 di un tasto.
 * @param {string} name
 * @returns {string}
 * @throws {Error} se il tasto non e' rappresentabile
 */
export function x11Key(name) {
  const key = String(name ?? '').trim().toLowerCase();
  if (isCharKey(key)) return key;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) return key.toUpperCase();
  if (Object.hasOwn(X11_KEYSYMS, key)) return X11_KEYSYMS[key];
  throw new Error(`tasto non supportato su X11: "${name}"`);
}

/** Protegge una stringa da inserire fra virgolette in AppleScript. */
export function escapeAppleScript(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * AppleScript che preme una combinazione di tasti nell'applicazione attiva.
 * @param {{modifiers?: string[], key: string, repeat?: number}} spec
 * @returns {string}
 */
export function buildMacKeyScript({ modifiers = [], key, repeat = 1 }) {
  const times = Math.max(1, Math.min(20, Number(repeat) || 1));
  const target = macKey(key);
  const using = modifiers
    .map((m) => MAC_MODIFIERS[m])
    .filter(Boolean);

  const suffix = using.length ? ` using {${using.join(', ')}}` : '';
  const press = target.kind === 'char'
    ? `keystroke "${escapeAppleScript(target.value)}"${suffix}`
    : `key code ${target.value}${suffix}`;

  const lines = ['tell application "System Events"'];
  for (let i = 0; i < times; i += 1) {
    lines.push(`  ${press}`);
    if (i < times - 1) lines.push('  delay 0.04');
  }
  lines.push('end tell');
  return lines.join('\n');
}

/**
 * AppleScript che digita un testo nell'applicazione attiva.
 * @param {string} text
 * @returns {string}
 */
export function buildMacTypeScript(text) {
  return [
    'tell application "System Events"',
    `  keystroke "${escapeAppleScript(text)}"`,
    'end tell'
  ].join('\n');
}

/**
 * Argomenti di `xdotool key` per una combinazione di tasti.
 * @param {{modifiers?: string[], key: string, repeat?: number}} spec
 * @returns {string[]}
 */
export function buildXdotoolKeyArgs({ modifiers = [], key, repeat = 1 }) {
  const times = Math.max(1, Math.min(20, Number(repeat) || 1));
  const parts = [
    ...modifiers.map((m) => X11_MODIFIERS[m]).filter(Boolean),
    x11Key(key)
  ];
  // --clearmodifiers evita che un tasto rimasto premuto dall'utente si sommi
  // alla combinazione inviata.
  return ['key', '--clearmodifiers', '--repeat', String(times), '--repeat-delay', '40', parts.join('+')];
}

/**
 * Argomenti di `xdotool type` per digitare un testo.
 * `--` chiude le opzioni: un testo che inizia con "-" non diventa un flag.
 * @param {string} text
 * @returns {string[]}
 */
export function buildXdotoolTypeArgs(text) {
  return ['type', '--clearmodifiers', '--delay', '12', '--', String(text)];
}
