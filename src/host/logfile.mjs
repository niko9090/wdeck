/**
 * Log su file dell'host (`wdeck.log` accanto a deck.json).
 *
 * L'eseguibile gira senza console: quando non parte, muore o rifiuta
 * qualcosa, non c'e' NIENTE da leggere (solo il registro delle pressioni).
 * Qui ogni riga che andrebbe a console finisce anche su file, con data e
 * livello. Rotazione semplice: oltre 1 MB il file diventa `.1` e si riparte.
 * Un errore di scrittura non deve mai disturbare l'host: si ignora.
 */

import fs from 'node:fs';

const MAX_BYTES = 1024 * 1024;

function formatta(arg) {
  if (arg instanceof Error) return arg.stack || arg.message;
  if (typeof arg === 'string') return arg;
  try { return JSON.stringify(arg); } catch { return String(arg); }
}

/**
 * @param {{file: string|null, base?: object, quiet?: boolean, maxBytes?: number}} spec
 *   `quiet` toglie info/debug dalla console (come `--quiet`), non dal file.
 */
export function createFileLogger({ file, base = console, quiet = false, maxBytes = MAX_BYTES }) {
  function scrivi(level, args) {
    if (!file) return;
    try {
      let size = 0;
      try { size = fs.statSync(file).size; } catch { /* non esiste ancora */ }
      if (size > maxBytes) {
        try { fs.rmSync(`${file}.1`, { force: true }); fs.renameSync(file, `${file}.1`); } catch { /* si continua sul file pieno */ }
      }
      fs.appendFileSync(file, `${new Date().toISOString()} ${level.padEnd(5)} ${args.map(formatta).join(' ')}\n`);
    } catch { /* il log non deve mai fermare l'host */ }
  }

  const livello = (name, { console: aConsole = true } = {}) => (...args) => {
    if (aConsole) base[name]?.(...args);
    scrivi(name.toUpperCase(), args);
  };

  return {
    log: livello('log', { console: !quiet }),
    info: livello('info', { console: !quiet }),
    debug: livello('debug', { console: false }),
    warn: livello('warn'),
    error: livello('error'),
    file
  };
}
