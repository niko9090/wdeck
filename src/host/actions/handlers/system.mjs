/** Azioni di sistema: avvio programmi, apertura URL, esecuzione script. */

import fs from 'node:fs';
import { checkExecutable, checkUrl } from '../../security/allowlist.mjs';
import { buildOpenUrlScript, launchProcess, runPowerShell, runScript, resolveScriptRunner } from '../../platform/windows.mjs';

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
  paramsHelp: { path: 'percorso eseguibile', args: 'array di stringhe (opzionale)', cwd: 'directory di lavoro (opzionale)' },
  validate(params) {
    if (typeof params?.path !== 'string' || params.path.trim() === '') throw new Error('parametro "path" mancante');
    assertArgs(params?.args);
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
    return { ok: true, detail: `avviato ${check.resolved} (pid ${pid})`, pid };
  }
};

export const urlAction = {
  type: 'url',
  title: 'Apri URL',
  description: 'Apre un URL con l\'applicazione predefinita di sistema. Lo schema deve essere in settings.security.allowUrlSchemes.',
  platforms: ['win32'],
  paramsHelp: { url: 'URL completo, es. https://example.com' },
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
      return { ok: true, simulated: true, detail: `aprirebbe ${params.url} (schema ${check.scheme})` };
    }
    const res = await runPowerShell(buildOpenUrlScript(params.url), { timeoutMs: 10000 });
    if (res.code !== 0) throw new Error(`apertura URL fallita: ${res.stderr || `exit ${res.code}`}`);
    return { ok: true, detail: `aperto ${params.url}` };
  }
};

export const scriptAction = {
  type: 'script',
  title: 'Esegui script',
  description: 'Esegue uno script .ps1/.bat/.cmd/.py/.mjs e restituisce stdout/stderr troncati. '
    + 'Il percorso deve comparire nella whitelist settings.security.allowExec.',
  platforms: ['*'],
  paramsHelp: {
    path: 'percorso dello script',
    args: 'array di stringhe (opzionale)',
    cwd: 'directory di lavoro (opzionale)',
    timeoutMs: 'intero 1000..120000 (default 30000)'
  },
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
