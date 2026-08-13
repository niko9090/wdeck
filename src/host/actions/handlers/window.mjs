/**
 * Azioni su finestre e desktop virtuali.
 *
 * Sono le azioni che risolvono il problema piu' fastidioso di un deck remoto:
 * dal telefono si lancia qualcosa e poi sul PC la finestra resta dietro alle
 * altre. Qui c'e' sia il "porta in primo piano" esplicito sia lo spostamento
 * fra desktop virtuali per numero o per nome.
 */

import {
  buildDesktopSwitchScript,
  readDesktops,
  resolveDesktopTarget
} from '../../platform/desktops.mjs';
import { buildFocusWindowScript, runPowerShell } from '../../platform/windows.mjs';
import { buildKeyScript } from '../../platform/windows.mjs';
import { parseHotkey } from '../../platform/keys.mjs';

export const focusAction = {
  type: 'focus',
  title: 'Porta in primo piano',
  description: 'Attiva la finestra di un programma gia' + '\' aperto, cercandolo per nome di processo '
    + 'o per titolo. Se il programma non e\' in esecuzione l\'azione fallisce: per avviarlo usare "launch".',
  platforms: ['win32'],
  category: 'window',
  paramsHelp: {
    process: 'nome del processo, es. "chrome" o "Code" (ammette * come jolly)',
    title: 'porzione del titolo della finestra, es. "Posta in arrivo"'
  },
  validate(params) {
    if (!params?.process && !params?.title) {
      throw new Error('focus richiede almeno uno fra "process" e "title"');
    }
    for (const key of ['process', 'title']) {
      if (params[key] !== undefined && typeof params[key] !== 'string') {
        throw new Error(`parametro "${key}" non valido: atteso stringa`);
      }
    }
  },
  describe: (params) => `porta in primo piano ${params?.process ?? ''}${params?.title ? ` "${params.title}"` : ''}`.trim(),
  async run(params, ctx) {
    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `cercherebbe la finestra ${params.process ?? params.title}` };
    }
    const res = await runPowerShell(buildFocusWindowScript(params), { timeoutMs: 10000 });
    if (res.stdout.includes('focus:ok')) {
      return { ok: true, detail: `finestra attivata: ${params.process ?? params.title}` };
    }
    if (res.stdout.includes('focus:none')) {
      throw new Error(`nessuna finestra corrisponde a ${params.process ?? params.title} (il programma e' in esecuzione?)`);
    }
    throw new Error(`attivazione finestra non riuscita: ${res.stderr.slice(0, 200) || 'Windows ha rifiutato il cambio di focus'}`);
  }
};

export const desktopAction = {
  type: 'desktop',
  title: 'Desktop virtuale',
  description: 'Passa a un desktop virtuale indicato per numero (1, 2, 3...) o per nome, oppure si '
    + 'sposta di uno a destra/sinistra. I nomi sono quelli assegnati in Windows con "Rinomina".',
  platforms: ['win32'],
  category: 'window',
  paramsHelp: {
    index: 'numero del desktop, 1-based',
    name: 'nome del desktop assegnato in Windows',
    direction: '"next" | "prev" (alternativa a index/name)'
  },
  validate(params) {
    const hasTarget = params?.index !== undefined || params?.name !== undefined;
    const hasDirection = params?.direction !== undefined;
    if (!hasTarget && !hasDirection) {
      throw new Error('desktop richiede "index", "name" oppure "direction"');
    }
    if (hasDirection && !['next', 'prev'].includes(params.direction)) {
      throw new Error('parametro "direction" non valido: atteso "next" o "prev"');
    }
    if (params?.index !== undefined && (!Number.isInteger(params.index) || params.index < 1)) {
      throw new Error('parametro "index" non valido: atteso intero >= 1');
    }
  },
  describe(params) {
    if (params?.direction) return `desktop ${params.direction === 'next' ? 'successivo' : 'precedente'}`;
    return `desktop ${params?.name ?? params?.index}`;
  },
  async run(params, ctx) {
    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `passerebbe al ${this.describe(params)}` };
    }

    if (params.direction) {
      const delta = params.direction === 'next' ? 1 : -1;
      const res = await runPowerShell(buildDesktopSwitchScript(delta), { timeoutMs: 8000 });
      if (res.code !== 0) throw new Error(`cambio desktop fallito: ${res.stderr.slice(0, 200)}`);
      return { ok: true, detail: `spostato al desktop ${params.direction === 'next' ? 'successivo' : 'precedente'}` };
    }

    const info = await readDesktops();
    const targetIndex = resolveDesktopTarget(params, info);
    if (info.index === -1) throw new Error('desktop attivo non identificabile dal registro di Windows');
    const delta = targetIndex - info.index;
    if (delta === 0) {
      return { ok: true, detail: `gia' sul desktop ${info.names[targetIndex] ?? targetIndex + 1}` };
    }
    const res = await runPowerShell(buildDesktopSwitchScript(delta), { timeoutMs: 5000 + Math.abs(delta) * 1000 });
    if (res.code !== 0) throw new Error(`cambio desktop fallito: ${res.stderr.slice(0, 200)}`);
    return {
      ok: true,
      detail: `desktop attivo: ${info.names[targetIndex] ?? targetIndex + 1}`,
      index: targetIndex + 1,
      name: info.names[targetIndex]
    };
  }
};

export const windowCommandAction = {
  type: 'window',
  title: 'Comando finestra',
  description: 'Comandi rapidi sulle finestre: mostra il desktop, minimizza tutto, chiudi la finestra '
    + 'attiva, affiancala a destra o sinistra, passa alla finestra successiva.',
  platforms: ['win32'],
  category: 'window',
  paramsHelp: { command: 'show-desktop | minimize-all | close | snap-left | snap-right | maximize | switch' },
  validate(params) {
    if (!WINDOW_COMMANDS[params?.command]) {
      throw new Error(`parametro "command" non valido: atteso uno fra ${Object.keys(WINDOW_COMMANDS).join(', ')}`);
    }
  },
  describe: (params) => `finestra: ${WINDOW_COMMANDS[params?.command]?.label ?? params?.command}`,
  async run(params, ctx) {
    const spec = WINDOW_COMMANDS[params.command];
    const hotkey = parseHotkey(spec.keys);
    const script = buildKeyScript(hotkey.modifierCodes, hotkey.keyCode);
    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `invierebbe ${spec.keys} (${spec.label})`, script };
    }
    const res = await runPowerShell(script, { timeoutMs: 8000 });
    if (res.code !== 0) throw new Error(`comando finestra fallito: ${res.stderr.slice(0, 200)}`);
    return { ok: true, detail: spec.label };
  }
};

/** Comandi finestra realizzati con le scorciatoie native di Windows. */
const WINDOW_COMMANDS = {
  'show-desktop': { keys: 'win+d', label: 'mostra il desktop' },
  'minimize-all': { keys: 'win+m', label: 'minimizza tutte le finestre' },
  close: { keys: 'alt+f4', label: 'chiude la finestra attiva' },
  'snap-left': { keys: 'win+left', label: 'affianca a sinistra' },
  'snap-right': { keys: 'win+right', label: 'affianca a destra' },
  maximize: { keys: 'win+up', label: 'massimizza' },
  switch: { keys: 'alt+tab', label: 'finestra successiva' }
};

export default [focusAction, desktopAction, windowCommandAction];
