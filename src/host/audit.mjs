/**
 * Registro persistente delle azioni eseguite.
 *
 * Wdeck esegue programmi sul PC su richiesta della rete locale. Se qualcosa va
 * storto - un'azione lanciata da un dispositivo che non doveva averla, uno
 * script eseguito a un'ora sospetta - senza un registro non c'e' modo di
 * ricostruire cosa e' successo: i log della console spariscono alla chiusura.
 *
 * Il formato e' JSONL, una riga per evento: si legge con `tail`, si filtra con
 * `grep`, e un file troncato a meta' per un arresto improvviso costa una riga
 * illeggibile, non l'intero registro.
 *
 * Non ci finiscono mai token, PIN o password: gli identificatori dei
 * dispositivi si', perche' servono proprio a capire chi ha fatto cosa.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Dimensione oltre la quale il file viene ruotato. */
export const DEFAULT_MAX_BYTES = 1024 * 1024;

/** Quante rotazioni conservare. */
export const DEFAULT_KEEP = 3;

/** Chiavi che non devono mai comparire nel registro. */
const REDACTED_KEYS = /^(token|pin|password|secret|authorization|apikey|api_key|accesstoken|refreshtoken)$/i;

/**
 * Copia un valore togliendo i campi sensibili.
 *
 * I parametri di un'azione sono liberi: una richiesta HTTP puo' portarsi
 * dietro un header di autorizzazione, un'integrazione una password. Registrarli
 * significherebbe scrivere segreti in chiaro in un file che nasce per essere
 * letto.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
export function redact(value, depth = 0) {
  if (depth > 4) return '[...]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = REDACTED_KEYS.test(key) ? '[omesso]' : redact(item, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}...` : value;
  return value;
}

/**
 * Crea il registro di audit.
 * @param {{
 *   file: string,
 *   enabled?: boolean,
 *   maxBytes?: number,
 *   keep?: number,
 *   logger?: object,
 *   now?: () => number
 * }} options
 */
export function createAuditLog({
  file,
  enabled = true,
  maxBytes = DEFAULT_MAX_BYTES,
  keep = DEFAULT_KEEP,
  logger = console,
  now = Date.now
}) {
  const target = path.resolve(file);
  let broken = false;

  /** true se il file termina con un a capo, cioe' l'ultima riga e' intera. */
  function endsWithNewline(name) {
    const handle = fs.openSync(name, 'r');
    try {
      const buffer = Buffer.alloc(1);
      const { size } = fs.fstatSync(handle);
      if (size === 0) return true;
      fs.readSync(handle, buffer, 0, 1, size - 1);
      return buffer[0] === 0x0a;
    } finally {
      fs.closeSync(handle);
    }
  }

  /** Sposta il file corrente in `.1`, facendo scalare i precedenti. */
  function rotate() {
    for (let i = keep - 1; i >= 1; i -= 1) {
      const from = `${target}.${i}`;
      const to = `${target}.${i + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    if (fs.existsSync(target)) fs.renameSync(target, `${target}.1`);
    // Oltre le rotazioni da conservare, il piu' vecchio si butta.
    const stale = `${target}.${keep + 1}`;
    if (fs.existsSync(stale)) fs.rmSync(stale, { force: true });
  }

  return {
    file: target,
    enabled,

    /**
     * Scrive un evento.
     *
     * Non lancia mai: un registro che non si riesce a scrivere e' un problema
     * da segnalare, non una ragione per far fallire l'azione che l'utente ha
     * chiesto.
     * @param {string} event tipo di evento
     * @param {object} [data] campi liberi, ripuliti dai segreti
     */
    write(event, data = {}) {
      if (!enabled || broken) return null;
      const entry = { at: now(), event, ...redact(data) };
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        let size = fs.existsSync(target) ? fs.statSync(target).size : 0;
        // Dopo la rotazione il file corrente non esiste piu': ripartire da zero
        // evita di andarlo a leggere per sapere come termina.
        if (size >= maxBytes) {
          rotate();
          size = 0;
        }

        // Se l'ultima riga e' rimasta a meta' (arresto improvviso durante una
        // scrittura), la nuova va su una riga sua: appesa di seguito andrebbe
        // persa insieme a quella rotta, invece di costare solo quella.
        const aCapo = size > 0 && !endsWithNewline(target) ? '\n' : '';
        fs.appendFileSync(target, `${aCapo}${JSON.stringify(entry)}\n`, 'utf8');
      } catch (err) {
        broken = true;
        logger.warn?.(`[wdeck] registro di audit non scrivibile (${target}): ${err.message}`);
        return null;
      }
      return entry;
    },

    /**
     * Ultime righe del registro, dalla piu' recente.
     * @param {{limit?: number, event?: string}} [options]
     * @returns {object[]}
     */
    tail({ limit = 100, event } = {}) {
      if (!fs.existsSync(target)) return [];
      let text;
      try {
        text = fs.readFileSync(target, 'utf8');
      } catch {
        return [];
      }
      const out = [];
      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
        const line = lines[i].trim();
        if (line === '') continue;
        try {
          const entry = JSON.parse(line);
          if (event && entry.event !== event) continue;
          out.push(entry);
        } catch {
          // Una riga troncata da un arresto improvviso costa se stessa, non il
          // resto del registro.
        }
      }
      return out;
    },

    /** Cancella il registro e le sue rotazioni. */
    clear() {
      for (const name of [target, ...Array.from({ length: keep + 1 }, (_, i) => `${target}.${i + 1}`)]) {
        if (fs.existsSync(name)) fs.rmSync(name, { force: true });
      }
      broken = false;
    }
  };
}

/**
 * Riduce l'esito di una pressione alla forma che finisce nel registro.
 * @param {object} entry voce prodotta dal dispatcher
 * @param {{deviceId?: string|null, address?: string|null}} [who]
 */
export function pressEntry(entry, who = {}) {
  return {
    buttonId: entry.buttonId,
    type: entry.type,
    label: entry.label ?? null,
    ok: entry.ok,
    dryRun: entry.dryRun === true,
    source: entry.source ?? null,
    durationMs: entry.durationMs ?? null,
    detail: entry.ok ? (entry.detail ?? null) : null,
    error: entry.ok ? null : (entry.error?.message ?? null),
    device: who.deviceId ?? entry.deviceId ?? null,
    address: who.address ?? entry.address ?? null
  };
}
