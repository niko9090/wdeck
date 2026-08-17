/**
 * Esecuzione di comandi esterni e ricerca degli eseguibili nel PATH.
 *
 * Serve agli adattatori macOS e Linux, che non hanno l'equivalente di
 * PowerShell: li' ogni operazione passa da un piccolo comando di sistema
 * (`osascript`, `xdotool`, `pactl`, `xdg-open`). Gli argomenti sono sempre
 * passati come array, mai come riga di comando: non esiste una shell da
 * ingannare, quindi non esiste quoting da sbagliare.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Cerca un eseguibile nel PATH.
 * @param {string} name
 * @param {{env?: NodeJS.ProcessEnv, platform?: string}} [options]
 * @returns {string|null} percorso completo, oppure null se assente
 */
export function which(name, { env = process.env, platform = process.platform } = {}) {
  if (!name) return null;
  // Un percorso esplicito non va cercato: va solo verificato.
  if (name.includes('/') || name.includes('\\')) return fs.existsSync(name) ? name : null;

  const dirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  let suffixes = [''];
  if (platform === 'win32') {
    const pathext = (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean);
    // Se il nome porta gia' un'estensione (es. "node.exe") va provato cosi'
    // com'e', altrimenti diventerebbe "node.exe.EXE" e non verrebbe trovato.
    // '' come primo candidato copre anche un file esatto senza estensione.
    suffixes = path.extname(name) ? ['', ...pathext] : [...pathext, ''];
  }

  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const candidate = path.join(dir, name + suffix);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // percorso inesistente o non leggibile: si prova il successivo
      }
    }
  }
  return null;
}

/**
 * Primo eseguibile disponibile fra quelli indicati.
 * @param {string[]} names in ordine di preferenza
 * @param {{env?: NodeJS.ProcessEnv, platform?: string}} [options]
 * @returns {{name: string, path: string}|null}
 */
export function firstAvailable(names, options = {}) {
  for (const name of names) {
    const found = which(name, options);
    if (found) return { name, path: found };
  }
  return null;
}

/** Schemi di URL considerati sicuri da aprire con il gestore predefinito. */
const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp', 'ftps', 'sms', 'file']);

/**
 * Verifica che un URL abbia uno schema noto prima di passarlo a open/xdg-open.
 * Impedisce che un valore che inizia con "-" o con uno schema inatteso venga
 * scambiato per un flag o apra un gestore non voluto.
 * @param {string} url
 * @throws {Error} se lo schema manca o non e' fra quelli ammessi
 */
export function assertSafeUrl(url) {
  const value = String(url ?? '').trim();
  const match = value.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!match || !SAFE_URL_SCHEMES.has(match[1].toLowerCase())) {
    throw new Error(`URL non ammesso: "${url}" `
      + `(schema mancante o non supportato; ammessi: ${[...SAFE_URL_SCHEMES].join(', ')})`);
  }
  return value;
}

/**
 * Esegue un comando raccogliendone l'output.
 * @param {string} command
 * @param {string[]} [args]
 * @param {{timeoutMs?: number, input?: string, env?: object}} [options]
 * @returns {Promise<{code: number|null, stdout: string, stderr: string, timedOut: boolean}>}
 */
export function runCommand(command, args = [], { timeoutMs = 10000, input, env } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { env: env ?? process.env, windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer = null;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      // Se il figlio ignora SIGTERM la promise resterebbe pendente per sempre:
      // dopo una breve tregua si forza la chiusura con SIGKILL.
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gia' uscito */ } }, 2000);
    }, timeoutMs);

    const clearTimers = () => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); };

    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimers();
      if (err.code === 'ENOENT') {
        reject(new Error(`comando non trovato: "${command}" (installalo o aggiungilo al PATH)`));
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      clearTimers();
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut });
    });

    if (input !== undefined && child.stdin) {
      // Se il figlio e' gia' uscito, scrivere sullo stdin genera un EPIPE: senza
      // un listener 'error' diventerebbe un'eccezione non gestita capace di far
      // cadere l'host. Lo si assorbe: il comando e' comunque terminato.
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}

/**
 * Esegue un comando e pretende che finisca bene.
 * @param {string} command
 * @param {string[]} args
 * @param {{timeoutMs?: number, input?: string, what?: string}} [options]
 * @returns {Promise<string>} stdout
 */
export async function runChecked(command, args = [], { what, ...options } = {}) {
  const res = await runCommand(command, args, options);
  if (res.timedOut) throw new Error(`${what ?? command}: comando interrotto per timeout`);
  if (res.code !== 0) {
    throw new Error(`${what ?? command}: uscita ${res.code}${res.stderr ? ` - ${res.stderr.slice(0, 200)}` : ''}`);
  }
  return res.stdout;
}
