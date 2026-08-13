/**
 * Azioni per programmi, giochi, browser e desktop remoti.
 *
 * Tutte passano dalla stessa whitelist delle altre azioni di sistema: un
 * bottone "gioco" o "RDP" non e' una scorciatoia per aggirare allowExec.
 */

import fs from 'node:fs';
import { checkExecutable, checkUrl } from '../../security/allowlist.mjs';
import { buildOpenUrlScript, focusPid, launchProcess, runPowerShell } from '../../platform/windows.mjs';

/** Percorsi tipici dei browser, provati in ordine quando manca "path". */
const BROWSERS = {
  chrome: {
    label: 'Google Chrome',
    candidates: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ],
    incognito: '--incognito'
  },
  edge: {
    label: 'Microsoft Edge',
    candidates: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ],
    incognito: '--inprivate'
  },
  firefox: {
    label: 'Mozilla Firefox',
    candidates: [
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
    ],
    incognito: '-private-window'
  }
};

/** Prima voce esistente fra i candidati, altrimenti null. */
function firstExisting(paths) {
  return paths.find((p) => fs.existsSync(p)) ?? null;
}

export const browserAction = {
  type: 'browser',
  title: 'Apri nel browser',
  description: 'Apre un indirizzo in un browser specifico, con la possibilita\' di scegliere il profilo, '
    + 'la finestra anonima, la nuova finestra o la modalita\' chiosco a schermo intero.',
  platforms: ['win32'],
  category: 'browser',
  paramsHelp: {
    url: 'indirizzo da aprire',
    browser: `${Object.keys(BROWSERS).join(' | ')} (default: browser di sistema)`,
    path: 'percorso dell\'eseguibile, se non e\' in una posizione standard',
    profile: 'nome della cartella profilo (Chrome/Edge), es. "Profile 2"',
    incognito: 'true per la finestra anonima',
    newWindow: 'true per forzare una nuova finestra',
    kiosk: 'true per lo schermo intero senza barre'
  },
  validate(params) {
    if (typeof params?.url !== 'string' || params.url.trim() === '') throw new Error('parametro "url" mancante');
    if (params?.browser !== undefined && !BROWSERS[params.browser] && !params?.path) {
      throw new Error(`browser non riconosciuto: "${params.browser}" (attesi ${Object.keys(BROWSERS).join(', ')}, oppure indicare "path")`);
    }
    for (const flag of ['incognito', 'newWindow', 'kiosk']) {
      if (params?.[flag] !== undefined && typeof params[flag] !== 'boolean') {
        throw new Error(`parametro "${flag}" non valido: atteso booleano`);
      }
    }
  },
  describe: (params) => `apre ${params?.url} in ${params?.browser ? BROWSERS[params.browser]?.label ?? params.browser : 'browser di sistema'}`,
  async run(params, ctx) {
    const check = checkUrl(params.url, ctx.security?.allowUrlSchemes ?? []);
    if (!check.allowed) {
      const err = new Error(`apertura URL bloccata: ${check.reason}`);
      err.code = 'forbidden';
      throw err;
    }

    // Senza browser specifico si delega al gestore predefinito di Windows.
    if (!params.browser && !params.path) {
      if (ctx.dryRun) return { ok: true, simulated: true, detail: `aprirebbe ${params.url} nel browser di sistema` };
      const res = await runPowerShell(buildOpenUrlScript(params.url), { timeoutMs: 10000 });
      if (res.code !== 0) throw new Error(`apertura non riuscita: ${res.stderr.slice(0, 200)}`);
      return { ok: true, detail: `aperto ${params.url}` };
    }

    const spec = BROWSERS[params.browser] ?? {};
    const exe = params.path ?? firstExisting(spec.candidates ?? []);
    if (!exe) {
      throw new Error(`${spec.label ?? params.browser} non trovato nei percorsi standard: indicare "path" nel bottone`);
    }

    const check2 = checkExecutable(exe, {
      allowExec: ctx.security?.allowExec ?? [],
      allowedExtensions: ctx.security?.allowedExtensions ?? [],
      baseDir: ctx.baseDir
    });
    if (!check2.allowed) {
      const err = new Error(`avvio browser bloccato dalla whitelist: ${check2.reason}`);
      err.code = 'forbidden';
      throw err;
    }

    const args = [];
    if (params.profile) args.push(`--profile-directory=${params.profile}`);
    if (params.incognito && spec.incognito) args.push(spec.incognito);
    if (params.kiosk) args.push('--kiosk');
    else if (params.newWindow) args.push('--new-window');
    args.push(params.url);

    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `eseguirebbe: ${check2.resolved} ${args.join(' ')}` };
    }
    const { pid } = await launchProcess({ path: check2.resolved, args });
    const focused = await focusPid(pid, { exePath: check2.resolved });
    return { ok: true, detail: `aperto ${params.url} in ${spec.label ?? exe}${focused ? ' - in primo piano' : ''}`, pid };
  }
};

export const gameAction = {
  type: 'game',
  title: 'Avvia gioco',
  description: 'Avvia un gioco tramite lo store che lo gestisce (Steam, Epic, GOG, Xbox) oppure tramite '
    + 'il percorso dell\'eseguibile. Con Steam basta l\'ID numerico che compare nell\'URL della pagina.',
  platforms: ['win32'],
  category: 'app',
  paramsHelp: {
    store: 'steam | epic | gog | xbox | exe',
    id: 'identificativo nello store (per Steam l\'AppID numerico)',
    path: 'percorso dell\'eseguibile, richiesto solo con store "exe"',
    args: 'array di stringhe passate al gioco (solo con "exe")'
  },
  validate(params) {
    const store = params?.store ?? 'steam';
    if (!['steam', 'epic', 'gog', 'xbox', 'exe'].includes(store)) {
      throw new Error(`parametro "store" non valido: "${store}"`);
    }
    if (store === 'exe') {
      if (typeof params?.path !== 'string' || !params.path.trim()) throw new Error('con store "exe" serve il parametro "path"');
    } else if (typeof params?.id !== 'string' && typeof params?.id !== 'number') {
      throw new Error(`con store "${store}" serve il parametro "id"`);
    }
  },
  describe(params) {
    const store = params?.store ?? 'steam';
    return store === 'exe' ? `avvia ${params.path}` : `avvia ${store} ${params.id}`;
  },
  async run(params, ctx) {
    const store = params?.store ?? 'steam';

    if (store === 'exe') {
      const check = checkExecutable(params.path, {
        allowExec: ctx.security?.allowExec ?? [],
        allowedExtensions: ctx.security?.allowedExtensions ?? [],
        baseDir: ctx.baseDir
      });
      if (!check.allowed) {
        const err = new Error(`avvio gioco bloccato dalla whitelist: ${check.reason}`);
        err.code = 'forbidden';
        throw err;
      }
      if (ctx.dryRun) return { ok: true, simulated: true, detail: `avvierebbe ${check.resolved}` };
      const { pid } = await launchProcess({ path: check.resolved, args: params.args ?? [] });
      await focusPid(pid, { timeoutMs: 8000, exePath: check.resolved });
      return { ok: true, detail: `avviato ${check.resolved}`, pid };
    }

    const uri = STORE_URIS[store](String(params.id));
    const check = checkUrl(uri, ctx.security?.allowUrlSchemes ?? []);
    if (!check.allowed) {
      const err = new Error(`avvio bloccato: lo schema "${check.scheme}" non e' in settings.security.allowUrlSchemes`);
      err.code = 'forbidden';
      throw err;
    }
    if (ctx.dryRun) return { ok: true, simulated: true, detail: `aprirebbe ${uri}` };
    const res = await runPowerShell(buildOpenUrlScript(uri), { timeoutMs: 10000 });
    if (res.code !== 0) throw new Error(`avvio gioco non riuscito: ${res.stderr.slice(0, 200)}`);
    return { ok: true, detail: `avvio richiesto a ${store}: ${params.id}`, uri };
  }
};

/** Schemi URI ufficiali dei vari store. */
const STORE_URIS = {
  steam: (id) => `steam://rungameid/${id}`,
  epic: (id) => `com.epicgames.launcher://apps/${id}?action=launch&silent=true`,
  gog: (id) => `goggalaxy://openGameView/${id}`,
  xbox: (id) => `shell:appsFolder\\${id}`
};

export const rdpAction = {
  type: 'rdp',
  title: 'Desktop remoto',
  description: 'Apre una connessione Desktop remoto (mstsc) verso un altro PC, a schermo intero o in '
    + 'finestra. Le credenziali restano quelle salvate in Windows: Wdeck non le gestisce.',
  platforms: ['win32'],
  category: 'remote',
  paramsHelp: {
    host: 'nome o indirizzo del PC remoto, con porta opzionale (es. "pc-studio:3389")',
    file: 'percorso di un file .rdp gia' + '\' configurato (alternativa a "host")',
    fullscreen: 'true per aprire a schermo intero',
    width: 'larghezza in pixel (con fullscreen false)',
    height: 'altezza in pixel (con fullscreen false)',
    admin: 'true per la sessione di amministrazione (/admin)'
  },
  validate(params) {
    if (!params?.host && !params?.file) throw new Error('rdp richiede "host" oppure "file"');
    if (params?.host !== undefined && typeof params.host !== 'string') throw new Error('parametro "host" non valido');
    for (const key of ['width', 'height']) {
      if (params?.[key] !== undefined) {
        const n = Number(params[key]);
        if (!Number.isInteger(n) || n < 200 || n > 10000) throw new Error(`parametro "${key}" non valido: 200..10000`);
      }
    }
  },
  describe: (params) => `desktop remoto verso ${params?.host ?? params?.file}`,
  async run(params, ctx) {
    const mstsc = 'C:\\Windows\\System32\\mstsc.exe';
    const check = checkExecutable(mstsc, {
      allowExec: ctx.security?.allowExec ?? [],
      allowedExtensions: ctx.security?.allowedExtensions ?? [],
      baseDir: ctx.baseDir
    });
    if (!check.allowed) {
      const err = new Error(`desktop remoto bloccato: aggiungere "${mstsc}" a settings.security.allowExec`);
      err.code = 'forbidden';
      throw err;
    }

    const args = [];
    if (params.file) args.push(params.file);
    else args.push(`/v:${params.host}`);
    if (params.admin) args.push('/admin');
    if (params.fullscreen) args.push('/f');
    else {
      if (params.width) args.push(`/w:${params.width}`);
      if (params.height) args.push(`/h:${params.height}`);
    }

    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `eseguirebbe: mstsc ${args.join(' ')}` };
    }
    const { pid } = await launchProcess({ path: check.resolved, args });
    await focusPid(pid, { timeoutMs: 6000, exePath: check.resolved });
    return { ok: true, detail: `connessione avviata verso ${params.host ?? params.file}`, pid };
  }
};

export default [browserAction, gameAction, rdpAction];
