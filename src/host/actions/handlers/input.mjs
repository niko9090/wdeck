/** Azioni di input sintetico: tasti media, hotkey, digitazione testo. */

import { parseHotkey, resolveMediaKey, MEDIA_KEYS } from '../../platform/keys.mjs';
import { readAudioLevel } from '../../platform/readers.mjs';
import { buildKeyScript, buildTypeTextScript, runPowerShell } from '../../platform/windows.mjs';

/** Tasti media che corrispondono a una condizione leggibile dal sistema. */
const READABLE_MEDIA_KEYS = new Set(['mute', 'volumeup', 'volup', 'volumedown', 'voldown']);

export const mediaAction = {
  type: 'media',
  title: 'Tasti multimediali',
  description: 'Invia un tasto multimediale di sistema (play/pausa, brano precedente/successivo, volume, muto).',
  platforms: ['win32'],
  category: 'media',
  paramsHelp: { key: Object.keys(MEDIA_KEYS).join(' | '), repeat: 'intero 1..20 (default 1)' },
  validate(params) {
    resolveMediaKey(params?.key);
    const repeat = params?.repeat;
    if (repeat !== undefined && (!Number.isInteger(repeat) || repeat < 1 || repeat > 20)) {
      throw new Error('parametro "repeat" non valido: atteso intero fra 1 e 20');
    }
  },
  describe: (params) => `tasto media "${params?.key}"${params?.repeat > 1 ? ` x${params.repeat}` : ''}`,
  async run(params, ctx) {
    const keyCode = resolveMediaKey(params.key);
    const script = buildKeyScript([], keyCode, { repeat: params.repeat ?? 1 });
    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `invierebbe VK 0x${keyCode.toString(16)} (${params.key})`, script };
    }
    const res = await runPowerShell(script, { timeoutMs: 8000 });
    if (res.code !== 0) throw new Error(`PowerShell ha restituito ${res.code}: ${res.stderr || 'errore sconosciuto'}`);
    return { ok: true, detail: `inviato tasto media "${params.key}"` };
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
  description: 'Invia una combinazione di tasti, ad esempio "ctrl+shift+m" oppure "win+d".',
  platforms: ['win32'],
  category: 'input',
  paramsHelp: { keys: 'es. "ctrl+alt+del", "win+l", "f5"', repeat: 'intero 1..20 (default 1)' },
  validate(params) {
    parseHotkey(params?.keys);
    const repeat = params?.repeat;
    if (repeat !== undefined && (!Number.isInteger(repeat) || repeat < 1 || repeat > 20)) {
      throw new Error('parametro "repeat" non valido: atteso intero fra 1 e 20');
    }
  },
  describe: (params) => `hotkey "${params?.keys}"`,
  async run(params, ctx) {
    const hotkey = parseHotkey(params.keys);
    const script = buildKeyScript(hotkey.modifierCodes, hotkey.keyCode, { repeat: params.repeat ?? 1 });
    if (ctx.dryRun) {
      return {
        ok: true,
        simulated: true,
        detail: `invierebbe ${[...hotkey.modifiers, hotkey.key].join('+')}`,
        script
      };
    }
    const res = await runPowerShell(script, { timeoutMs: 8000 });
    if (res.code !== 0) throw new Error(`PowerShell ha restituito ${res.code}: ${res.stderr || 'errore sconosciuto'}`);
    return { ok: true, detail: `inviata hotkey "${params.keys}"` };
  }
};

export const textAction = {
  type: 'text',
  title: 'Digitazione testo',
  description: 'Digita un testo nella finestra attiva tramite SendKeys.',
  platforms: ['win32'],
  category: 'input',
  paramsHelp: { text: 'testo da digitare (max 2000 caratteri)' },
  validate(params) {
    const text = params?.text;
    if (typeof text !== 'string' || text.length === 0) throw new Error('parametro "text" mancante');
    if (text.length > 2000) throw new Error('parametro "text" troppo lungo (max 2000 caratteri)');
  },
  describe: (params) => `digita "${String(params?.text ?? '').slice(0, 40).replace(/\n/g, '\\n')}${String(params?.text ?? '').length > 40 ? '...' : ''}"`,
  async run(params, ctx) {
    const script = buildTypeTextScript(params.text);
    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `digiterebbe ${params.text.length} caratteri`, script };
    }
    const res = await runPowerShell(script, { timeoutMs: 10000 });
    if (res.code !== 0) throw new Error(`PowerShell ha restituito ${res.code}: ${res.stderr || 'errore sconosciuto'}`);
    return { ok: true, detail: `digitati ${params.text.length} caratteri` };
  }
};

export default [mediaAction, hotkeyAction, textAction];
