/** Azioni di sistema: avvio programmi, apertura URL, esecuzione script. */

import fs from 'node:fs';
import { checkExecutable, checkUrl } from '../../security/allowlist.mjs';
import { focusPid, launchProcess, runScript, resolveScriptRunner } from '../../platform/windows.mjs';
import { SUPPORTED_PLATFORMS, openUrl, planUrl } from '../../platform/input.mjs';

function assertArgs(args) {
  if (args === undefined) return [];
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    throw new Error('parametro "args" non valido: atteso array di stringhe');
  }
  if (args.length > 32) throw new Error('parametro "args" troppo lungo (max 32 elementi)');
  return args;
}

export const launchAction = {
  type: 'launch',
  title: 'Avvia programma',
  description: 'Avvia un eseguibile. Il percorso deve comparire nella whitelist settings.security.allowExec.',
  platforms: ['*'],
  category: 'app',
  paramsHelp: {
    path: 'percorso eseguibile',
    args: 'array di stringhe (opzionale)',
    cwd: 'directory di lavoro (opzionale)',
    foreground: 'true (default) porta la finestra in primo piano dopo l\'avvio'
  },
  advanced: true,
  fields: [
    {
      key: 'path',
      label: 'Eseguibile',
      type: 'text',
      suggest: 'scripts',
      help: 'percorso eseguibile (deve essere in allowExec) o uno script aggiunto dal tray',
      placeholder: 'C:\\Windows\\notepad.exe',
      required: true
    },
    {
      key: 'cwd',
      label: 'Directory di lavoro',
      type: 'text',
      help: 'directory di lavoro (opzionale)'
    },
    {
      key: 'foreground',
      label: 'In primo piano',
      type: 'toggle',
      help: 'porta la finestra in primo piano dopo l\'avvio',
      default: true
    }
  ],
  validate(params) {
    if (typeof params?.path !== 'string' || params.path.trim() === '') throw new Error('parametro "path" mancante');
    assertArgs(params?.args);
    if (params?.foreground !== undefined && typeof params.foreground !== 'boolean') {
      throw new Error('parametro "foreground" non valido: atteso booleano');
    }
  },
  describe: (params) => `avvia ${params?.path}${params?.args?.length ? ` ${params.args.join(' ')}` : ''}`,
  async run(params, ctx) {
    const check = checkExecutable(params.path, {
      allowExec: ctx.security?.allowExec ?? [],
      allowedExtensions: ctx.security?.allowedExtensions ?? [],
      baseDir: ctx.baseDir
    });
    if (!check.allowed) {
      const err = new Error(`avvio bloccato dalla whitelist: ${check.reason}`);
      err.code = 'forbidden';
      throw err;
    }
    const args = params.args ?? [];
    if (ctx.dryRun) {
      return {
        ok: true,
        simulated: true,
        detail: `avvierebbe ${check.resolved}${args.length ? ` ${args.join(' ')}` : ''}`,
        resolved: check.resolved
      };
    }
    if (!fs.existsSync(check.resolved)) throw new Error(`eseguibile non trovato: ${check.resolved}`);
    const { pid } = await launchProcess({ path: check.resolved, args, cwd: params.cwd });
    // Senza questo passaggio Windows apre la finestra dietro al browser: il
    // foreground lock impedisce a un processo senza focus di prendersi il focus.
    const focused = params.foreground === false ? false : await focusPid(pid, { exePath: check.resolved });
    return {
      ok: true,
      detail: `avviato ${check.resolved} (pid ${pid})${focused ? ' - in primo piano' : ''}`,
      pid,
      focused
    };
  }
};

export const urlAction = {
  type: 'url',
  title: 'Apri URL',
  description: 'Apre un URL con l\'applicazione predefinita di sistema (Start-Process su Windows, '
    + '"open" su macOS, xdg-open su Linux). Lo schema deve essere in settings.security.allowUrlSchemes.',
  platforms: [...SUPPORTED_PLATFORMS],
  category: 'browser',
  paramsHelp: { url: 'URL completo, es. https://example.com' },
  fields: [
    {
      key: 'url',
      label: 'URL',
      type: 'text',
      help: 'URL completo (lo schema deve essere in allowUrlSchemes)',
      placeholder: 'https://example.com',
      required: true
    }
  ],
  validate(params) {
    if (typeof params?.url !== 'string' || params.url.trim() === '') throw new Error('parametro "url" mancante');
  },
  describe: (params) => `apre ${params?.url}`,
  async run(params, ctx) {
    const check = checkUrl(params.url, ctx.security?.allowUrlSchemes ?? []);
    if (!check.allowed) {
      const err = new Error(`apertura URL bloccata: ${check.reason}`);
      err.code = 'forbidden';
      throw err;
    }
    if (ctx.dryRun) {
      const plan = planUrl(params.url);
      return { ok: true, simulated: true, detail: `${plan.description} (schema ${check.scheme})`, backend: plan.backend };
    }
    const out = await openUrl(params.url);
    return { ok: true, ...out };
  }
};

export const scriptAction = {
  type: 'script',
  title: 'Esegui script',
  description: 'Esegue uno script .ps1/.bat/.cmd/.py/.mjs e restituisce stdout/stderr troncati. '
    + 'Il percorso deve comparire nella whitelist settings.security.allowExec.',
  platforms: ['*'],
  category: 'script',
  paramsHelp: {
    path: 'percorso dello script',
    args: 'array di stringhe (opzionale)',
    cwd: 'directory di lavoro (opzionale)',
    timeoutMs: 'intero 1000..120000 (default 30000)'
  },
  advanced: true,
  fields: [
    {
      key: 'path',
      label: 'Script',
      type: 'text',
      suggest: 'scripts',
      help: 'percorso dello script .ps1/.bat/.cmd/.py/.mjs (o uno aggiunto dal tray)',
      required: true
    },
    {
      key: 'cwd',
      label: 'Directory di lavoro',
      type: 'text',
      help: 'directory di lavoro (opzionale)'
    },
    {
      key: 'timeoutMs',
      label: 'Timeout (ms)',
      type: 'number',
      help: 'intero 1000..120000',
      min: 1000,
      max: 120000,
      step: 1,
      default: 30000
    }
  ],
  validate(params) {
    if (typeof params?.path !== 'string' || params.path.trim() === '') throw new Error('parametro "path" mancante');
    assertArgs(params?.args);
    if (params?.timeoutMs !== undefined) {
      const t = Number(params.timeoutMs);
      if (!Number.isInteger(t) || t < 1000 || t > 120000) {
        throw new Error('parametro "timeoutMs" non valido: atteso intero fra 1000 e 120000');
      }
    }
  },
  describe: (params) => `esegue ${params?.path}${params?.args?.length ? ` ${params.args.join(' ')}` : ''}`,
  async run(params, ctx) {
    const check = checkExecutable(params.path, {
      allowExec: ctx.security?.allowExec ?? [],
      allowedExtensions: ctx.security?.allowedExtensions ?? [],
      baseDir: ctx.baseDir
    });
    if (!check.allowed) {
      const err = new Error(`esecuzione bloccata dalla whitelist: ${check.reason}`);
      err.code = 'forbidden';
      throw err;
    }
    const args = params.args ?? [];
    const runner = resolveScriptRunner(check.resolved, args);
    if (ctx.dryRun) {
      return {
        ok: true,
        simulated: true,
        detail: `eseguirebbe: ${runner.command} ${runner.argv.join(' ')}`,
        resolved: check.resolved
      };
    }
    if (!fs.existsSync(check.resolved)) throw new Error(`script non trovato: ${check.resolved}`);
    const res = await runScript({
      path: check.resolved,
      args,
      cwd: params.cwd,
      timeoutMs: params.timeoutMs ?? 30000
    });
    if (res.timedOut) throw new Error(`script interrotto per timeout: ${check.resolved}`);
    if (res.code !== 0) {
      throw new Error(`script terminato con codice ${res.code}: ${res.stderr || res.stdout || 'nessun output'}`);
    }
    return { ok: true, detail: `eseguito ${check.resolved}`, stdout: res.stdout, stderr: res.stderr, exitCode: res.code };
  }
};

export default [launchAction, urlAction, scriptAction];
