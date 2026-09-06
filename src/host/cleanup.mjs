/**
 * Pulizia di cio' che si accumula sul disco senza che nessuno se ne accorga.
 *
 * - `runtime/<versione-impronta>/`: l'eseguibile estrae li' i propri moduli a
 *   ogni versione e non toglie mai quelli vecchi (39 cartelle e 39 MB dopo un
 *   mese di aggiornamenti). Si tengono la cartella in uso e la piu' recente
 *   fra le altre (per tornare indietro), via il resto.
 * - `%TEMP%\wdeck-tray-<pid>.ps1`: lo script dell'icona nella barra resta
 *   quando l'host viene chiuso senza `stop()` (Ctrl+C, arresto del PC). Si
 *   tolgono quelli il cui host non esiste piu'.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Vero se un processo con quel pid esiste (anche se non nostro). */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * @param {{runtimeRoot: string, current: string, keepOthers?: number, logger?: object}} spec
 * @returns {string[]} le cartelle eliminate
 */
export function pruneRuntimeDirs({ runtimeRoot, current, keepOthers = 1, logger = console }) {
  let entries = [];
  try {
    entries = fs.readdirSync(runtimeRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
  const altre = entries
    .map((e) => e.name)
    .filter((name) => name !== current)
    .map((name) => {
      let mtime = 0;
      try { mtime = fs.statSync(path.join(runtimeRoot, name)).mtimeMs; } catch { /* sparita */ }
      return { name, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
  const daTogliere = altre.slice(keepOthers)
    // le cartelle di estrazione a meta' (.tmp-<pid>) di un processo ancora vivo si lasciano stare
    .filter(({ name }) => {
      const m = name.match(/\.tmp-(\d+)$/);
      return !(m && alive(Number(m[1])));
    });
  const tolte = [];
  for (const { name } of daTogliere) {
    try {
      fs.rmSync(path.join(runtimeRoot, name), { recursive: true, force: true });
      tolte.push(name);
    } catch (err) {
      logger.debug?.(`[wdeck] runtime/${name} non eliminata: ${err.message}`);
    }
  }
  if (tolte.length) logger.info?.(`[wdeck] pulizia: tolte ${tolte.length} versioni vecchie da runtime/`);
  return tolte;
}

/**
 * @param {{tmpDir: string, ownPid?: number, logger?: object}} spec
 * @returns {string[]} i file eliminati
 */
export function pruneTrayScripts({ tmpDir, ownPid = process.pid, logger = console }) {
  let files = [];
  try {
    files = fs.readdirSync(tmpDir).filter((f) => /^wdeck-tray-\d+\.ps1$/.test(f));
  } catch {
    return [];
  }
  const tolti = [];
  for (const f of files) {
    const pid = Number(f.match(/(\d+)/)[1]);
    if (pid === ownPid || alive(pid)) continue;
    try {
      fs.unlinkSync(path.join(tmpDir, f));
      tolti.push(f);
    } catch { /* in uso o gia' sparito */ }
  }
  if (tolti.length) logger.debug?.(`[wdeck] pulizia: tolti ${tolti.length} script della tray abbandonati`);
  return tolti;
}

/**
 * Deduce dalla cartella dei moduli in esecuzione dove sta `runtime/` e qual
 * e' la versione in uso. Fuori dall'eseguibile (sviluppo) non c'e' nulla da
 * pulire e torna null.
 * @param {string} projectRoot
 */
export function runtimeLayout(projectRoot) {
  const m = String(projectRoot).replace(/\\/g, '/').match(/^(.*\/runtime)\/([^/]+)\/?$/);
  if (!m) return null;
  return { runtimeRoot: m[1], current: m[2] };
}
