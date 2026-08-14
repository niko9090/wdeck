/**
 * Azioni di input sintetico: tasti media, hotkey, digitazione testo.
 *
 * Gli handler non sanno su quale sistema stanno girando: parlano con la
 * facciata `platform/input.mjs`, che sceglie PowerShell su Windows, osascript
 * su macOS e xdotool/ydotool su Linux.
 */

import { MEDIA_KEYS, parseHotkey, resolveMediaKey } from '../../platform/keys.mjs';
import { readAudioLevel } from '../../platform/readers.mjs';
import {
  SUPPORTED_PLATFORMS,
  planHotkey,
  planMediaKey,
  planText,
  sendHotkey,
  sendMediaKey,
  typeText
} from '../../platform/input.mjs';

/** Tasti media che corrispondono a una condizione leggibile dal sistema. */
const READABLE_MEDIA_KEYS = new Set(['mute', 'volumeup', 'volup', 'volumedown', 'voldown']);

/** Validazione condivisa del parametro "repeat". */
function checkRepeat(repeat) {
  if (repeat !== undefined && (!Number.isInteger(repeat) || repeat < 1 || repeat > 20)) {
    throw new Error('parametro "repeat" non valido: atteso intero fra 1 e 20');
  }
}

export const mediaAction = {
  type: 'media',
  title: 'Tasti multimediali',
  description: 'Invia un comando multimediale di sistema (play/pausa, brano precedente/successivo, '
    + 'volume, muto). Su Windows usa i tasti virtuali, su macOS osascript, su Linux playerctl '
    + 'con ripiego sul tasto multimediale.',
  platforms: [...SUPPORTED_PLATFORMS],
  category: 'media',
  paramsHelp: { key: Object.keys(MEDIA_KEYS).join(' | '), repeat: 'intero 1..20 (default 1)' },
  validate(params) {
    resolveMediaKey(params?.key);
    checkRepeat(params?.repeat);
  },
  describe: (params) => `tasto media "${params?.key}"${params?.repeat > 1 ? ` x${params.repeat}` : ''}`,
  async run(params, ctx) {
    const repeat = params.repeat ?? 1;
    if (ctx.dryRun) {
      const plan = planMediaKey(params.key, { repeat });
      return { ok: true, simulated: true, detail: plan.description, script: plan.command, backend: plan.backend };
    }
    const out = await sendMediaKey(params.key, { repeat });
    return { ok: true, ...out };
  },

  /**
   * Il tasto "mute" e' un interruttore e puo' dire in che posizione si trova;
   * i tasti di volume mostrano il livello. Gli altri (play, next, prev) non
   * hanno uno stato leggibile senza sapere quale programma sta suonando.
   */
  async readState(params, ctx) {
    const key = String(params?.key ?? '').trim().toLowerCase();
    if (!READABLE_MEDIA_KEYS.has(key)) return null;
    const out = await readAudioLevel(ctx, 'speaker');
    return {
      on: key === 'mute' ? out.muted === true : null,
      level: out.volume ?? null,
      text: key === 'mute' && out.muted ? 'muto' : null
    };
  }
};

export const hotkeyAction = {
  type: 'hotkey',
  title: 'Hotkey',
  description: 'Invia una combinazione di tasti, ad esempio "ctrl+shift+m" oppure "win+d". '
    + 'Su macOS "win" corrisponde al tasto Comando, su Linux al tasto Super.',
  platforms: [...SUPPORTED_PLATFORMS],
  category: 'input',
  paramsHelp: { keys: 'es. "ctrl+alt+del", "win+l", "f5"', repeat: 'intero 1..20 (default 1)' },
  validate(params) {
    parseHotkey(params?.keys);
    checkRepeat(params?.repeat);
  },
  describe: (params) => `hotkey "${params?.keys}"`,
  async run(params, ctx) {
    const repeat = params.repeat ?? 1;
    if (ctx.dryRun) {
      const plan = planHotkey(params.keys, { repeat });
      return { ok: true, simulated: true, detail: plan.description, script: plan.command, backend: plan.backend };
    }
    const out = await sendHotkey(params.keys, { repeat });
    return { ok: true, ...out };
  }
};

export const textAction = {
  type: 'text',
  title: 'Digitazione testo',
  description: 'Digita un testo nella finestra attiva: SendKeys su Windows, osascript su macOS, '
    + 'xdotool/ydotool su Linux.',
  platforms: [...SUPPORTED_PLATFORMS],
  category: 'input',
  paramsHelp: { text: 'testo da digitare (max 2000 caratteri)' },
  validate(params) {
    const text = params?.text;
    if (typeof text !== 'string' || text.length === 0) throw new Error('parametro "text" mancante');
    if (text.length > 2000) throw new Error('parametro "text" troppo lungo (max 2000 caratteri)');
  },
  describe: (params) => `digita "${String(params?.text ?? '').slice(0, 40).replace(/\n/g, '\\n')}${String(params?.text ?? '').length > 40 ? '...' : ''}"`,
  async run(params, ctx) {
    if (ctx.dryRun) {
      const plan = planText(params.text);
      return { ok: true, simulated: true, detail: plan.description, script: plan.command, backend: plan.backend };
    }
    const out = await typeText(params.text);
    return { ok: true, ...out };
  }
};

export default [mediaAction, hotkeyAction, textAction];
