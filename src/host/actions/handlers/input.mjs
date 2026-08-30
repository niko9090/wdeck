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
  MOUSE_COMMANDS,
  SUPPORTED_PLATFORMS,
  planHotkey,
  planMediaKey,
  planMouse,
  planText,
  sendHotkey,
  sendMediaKey,
  sendMouse,
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
  fields: [
    {
      key: 'key',
      label: 'Tasto',
      type: 'select',
      help: 'comando multimediale da inviare',
      required: true,
      default: 'playpause',
      options: [
        { value: 'playpause', label: 'Play/Pausa' },
        { value: 'next', label: 'Successivo' },
        { value: 'prev', label: 'Precedente' },
        { value: 'stop', label: 'Stop' },
        { value: 'mute', label: 'Muto' },
        { value: 'volumeup', label: 'Alza volume' },
        { value: 'volumedown', label: 'Abbassa volume' }
      ]
    },
    { key: 'repeat', label: 'Ripetizioni', type: 'number', help: 'intero 1..20 (default 1)', min: 1, max: 20, step: 1, default: 1 }
  ],
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

/**
 * Traduce lo scatto di una manopola in una combinazione e in quante volte
 * mandarla. Senza `delta` non cambia niente: resta l'hotkey di sempre.
 *
 * `keysBack` esiste perche' una manopola gira in due versi mentre una
 * combinazione ne ha uno solo: e' la scorciatoia del verso "indietro"
 * (ctrl+meno per ctrl+piu', ctrl+z per ctrl+y). Se non c'e', la manopola
 * ripete la stessa combinazione in entrambi i versi.
 */
function resolveHotkey(params) {
  const repeat = params?.repeat ?? 1;
  if (params?.delta === undefined) return { keys: params?.keys, repeat };
  const d = Number(params.delta);
  const scatti = Math.min(20, Math.max(1, Math.round(Math.abs(d))));
  const indietro = d < 0 && params.keysBack;
  return { keys: indietro ? params.keysBack : params.keys, repeat: scatti };
}

export const hotkeyAction = {
  type: 'hotkey',
  title: 'Hotkey',
  description: 'Invia una combinazione di tasti, ad esempio "ctrl+shift+m" oppure "win+d". '
    + 'Su macOS "win" corrisponde al tasto Comando, su Linux al tasto Super. Su una manopola '
    + 'ogni scatto e\' un invio: con "Tasti all\'indietro" i due versi mandano combinazioni '
    + 'diverse (ctrl+piu\' girando in avanti, ctrl+meno tornando indietro).',
  platforms: [...SUPPORTED_PLATFORMS],
  category: 'input',
  paramsHelp: {
    keys: 'es. "ctrl+alt+del", "win+l", "f5"',
    keysBack: 'combinazione per il verso opposto della manopola (facoltativa)',
    repeat: 'intero 1..20 (default 1)',
    delta: 'scatti della manopola: quante volte inviare, il segno sceglie il verso'
  },
  fields: [
    { key: 'keys', label: 'Tasti', type: 'hotkey', help: 'es. "ctrl+alt+del", "win+l", "f5"', placeholder: 'ctrl+shift+m', required: true },
    { key: 'keysBack', label: 'Tasti all\'indietro', type: 'hotkey', help: 'usata quando la manopola gira dall\'altra parte', placeholder: 'ctrl+-' },
    { key: 'repeat', label: 'Ripetizioni', type: 'number', help: 'intero 1..20 (default 1)', min: 1, max: 20, step: 1, default: 1 }
  ],
  validate(params) {
    parseHotkey(params?.keys);
    if (params?.keysBack !== undefined && params.keysBack !== null && params.keysBack !== '') {
      parseHotkey(params.keysBack);
    }
    checkRepeat(params?.repeat);
    if (params?.delta !== undefined && !Number.isFinite(Number(params.delta))) {
      throw new Error('parametro "delta" non valido: atteso un numero');
    }
  },
  describe(params) {
    const { keys, repeat } = resolveHotkey(params);
    return `hotkey "${keys}"${repeat > 1 ? ` x${repeat}` : ''}`;
  },
  async run(params, ctx) {
    const { keys, repeat } = resolveHotkey(params);
    if (ctx.dryRun) {
      const plan = planHotkey(keys, { repeat });
      return { ok: true, simulated: true, detail: plan.description, script: plan.command, backend: plan.backend };
    }
    const out = await sendHotkey(keys, { repeat });
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
  fields: [
    { key: 'text', label: 'Testo', type: 'textarea', help: 'testo da digitare (max 2000 caratteri)', required: true }
  ],
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

/**
 * Decide che gesto fare davvero, mettendo insieme la configurazione del tasto
 * e cio' che il dito ha mandato in questo momento.
 *
 * L'ordine non e' arbitrario: la coppia x/y e il delta descrivono un GESTO
 * appena compiuto (una tavoletta toccata, una manopola girata) e devono avere
 * la precedenza sul `command` scritto una volta nell'editor. Chi ha appoggiato
 * il dito su una tavoletta si aspetta che il puntatore vada li', non che parta
 * il clic sinistro rimasto come valore predefinito.
 */
function resolveMouse(params) {
  if (params?.x !== undefined && params?.y !== undefined) {
    return { command: 'move', options: { x: Number(params.x), y: Number(params.y) } };
  }
  if (params?.delta !== undefined) {
    const d = Number(params.delta);
    // Una manopola non ha un verso scritto nell'editor: il segno dello scatto
    // e' il verso. Uno scatto nullo non e' un errore, semplicemente non scorre.
    return { command: d >= 0 ? 'scroll-up' : 'scroll-down', options: { notches: Math.abs(d) } };
  }
  return { command: params?.command, options: {} };
}

export const mouseAction = {
  type: 'mouse',
  title: 'Mouse',
  description: 'Esegue un clic (sinistro, destro, centrale), un doppio clic, uno scorrimento della '
    + 'rotellina o uno spostamento del puntatore. Su una manopola lo scatto diventa scorrimento '
    + '(il segno decide il verso); su una tavoletta il punto toccato diventa la posizione del '
    + 'puntatore sullo schermo principale. Per ora solo Windows.',
  platforms: ['win32'],
  category: 'input',
  paramsHelp: {
    command: MOUSE_COMMANDS.join(' | '),
    delta: 'scatti di rotellina, segno = verso (arriva da manopole e rotelle)',
    x: 'posizione orizzontale 0..100 (arriva dalle tavolette, insieme a y)',
    y: 'posizione verticale 0..100 con lo zero in basso (insieme a x)'
  },
  fields: [
    {
      key: 'command',
      label: 'Comando',
      type: 'select',
      required: true,
      default: 'left',
      options: [
        { value: 'left', label: 'Clic sinistro' },
        { value: 'right', label: 'Clic destro' },
        { value: 'middle', label: 'Clic centrale' },
        { value: 'double', label: 'Doppio clic' },
        { value: 'scroll-up', label: 'Scorri su' },
        { value: 'scroll-down', label: 'Scorri giu\'' },
        { value: 'move', label: 'Sposta il puntatore' }
      ]
    },
    { key: 'x', label: 'Posizione X', type: 'number', help: 'solo per "sposta": 0..100 da sinistra', min: 0, max: 100, step: 1 },
    { key: 'y', label: 'Posizione Y', type: 'number', help: 'solo per "sposta": 0..100 dal basso', min: 0, max: 100, step: 1 }
  ],
  validate(params) {
    const coppia = ['x', 'y'].filter((k) => params?.[k] !== undefined);
    // Mezza coppia sposterebbe il puntatore su un asse solo, in un punto che il
    // dito non ha mai toccato: meglio un errore che una posizione inventata.
    if (coppia.length === 1) throw new Error('parametri "x" e "y" vanno insieme: ne manca uno');
    for (const k of coppia) {
      const v = Number(params[k]);
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error(`parametro "${k}" non valido: atteso numero 0..100`);
    }
    if (params?.delta !== undefined && !Number.isFinite(Number(params.delta))) {
      throw new Error('parametro "delta" non valido: atteso un numero');
    }
    const { command } = resolveMouse(params);
    if (!MOUSE_COMMANDS.includes(command)) {
      throw new Error(`parametro "command" non valido: atteso uno fra ${MOUSE_COMMANDS.join(', ')}`);
    }
    if (command === 'move' && coppia.length !== 2) {
      throw new Error('"sposta il puntatore" richiede i parametri "x" e "y" (0..100)');
    }
  },
  describe(params) {
    const { command, options } = resolveMouse(params);
    if (command === 'move') return `mouse: sposta a ${Math.round(options.x ?? params?.x ?? 0)}%, ${Math.round(options.y ?? params?.y ?? 0)}%`;
    if (options.notches != null) return `mouse: ${command} x${Math.max(1, Math.round(options.notches))}`;
    return `mouse: ${command}`;
  },
  async run(params, ctx) {
    const { command, options } = resolveMouse(params);
    if (ctx.dryRun) {
      const plan = planMouse(command, options);
      return { ok: true, simulated: true, detail: plan.description, script: plan.command, backend: plan.backend };
    }
    const out = await sendMouse(command, options);
    return { ok: true, ...out };
  }
};

export default [mediaAction, hotkeyAction, textAction, mouseAction];
