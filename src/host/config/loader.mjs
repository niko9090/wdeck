/**
 * Caricamento di deck.json con validazione, normalizzazione, override
 * (CLI / variabili d'ambiente) e ricarica a caldo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { validateDeck, normalizeDeck, formatErrors } from './schema.mjs';

export class ConfigError extends Error {
  /**
   * @param {string} message
   * @param {Array<{path:string,message:string}>} errors
   */
  constructor(message, errors = []) {
    super(errors.length ? `${message}\n${formatErrors(errors)}` : message);
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

/**
 * Legge e valida un file deck.json.
 * @param {string} file
 * @param {{actionTypes?: string[], overrides?: object}} [options]
 * @returns {{deck: object, raw: object, warnings: Array<{path:string,message:string}>, file: string}}
 */
export function loadDeckFile(file, options = {}) {
  const resolved = path.resolve(file);
  let text;
  try {
    text = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    throw new ConfigError(`impossibile leggere il file di configurazione "${resolved}": ${err.message}`);
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`JSON non valido in "${resolved}": ${err.message}`);
  }

  const { valid, errors, warnings } = validateDeck(raw, { actionTypes: options.actionTypes });
  if (!valid) throw new ConfigError(`configurazione non valida in "${resolved}":`, errors);

  const deck = applyOverrides(normalizeDeck(raw), options.overrides ?? {});
  // `raw` e' il contenuto del file cosi' com'e': senza default espansi e senza
  // gli override di CLI e ambiente. E' la base giusta per riscriverlo.
  return { deck, raw, warnings, file: resolved };
}

/**
 * Applica override provenienti da CLI/env sul deck normalizzato.
 * @param {object} deck
 * @param {{port?: number, host?: string, token?: string, dryRun?: boolean, requireToken?: boolean}} overrides
 */
export function applyOverrides(deck, overrides = {}) {
  const merged = {
    ...deck,
    settings: {
      ...deck.settings,
      server: { ...deck.settings.server },
      security: { ...deck.settings.security },
      ui: { ...deck.settings.ui }
    }
  };
  if (overrides.port !== undefined) merged.settings.server.port = Number(overrides.port);
  if (overrides.host !== undefined) merged.settings.server.host = String(overrides.host);
  if (overrides.token !== undefined) merged.settings.security.token = String(overrides.token);
  if (overrides.dryRun !== undefined) merged.settings.security.dryRun = overrides.dryRun === true;
  if (overrides.requireToken !== undefined) merged.settings.security.requireToken = overrides.requireToken === true;
  return merged;
}

/** Legge gli override dalle variabili d'ambiente WDECK_*. */
export function envOverrides(env = process.env) {
  const out = {};
  if (env.WDECK_PORT) out.port = Number(env.WDECK_PORT);
  if (env.WDECK_HOST) out.host = env.WDECK_HOST;
  if (env.WDECK_TOKEN) out.token = env.WDECK_TOKEN;
  if (env.WDECK_DRY_RUN !== undefined) out.dryRun = /^(1|true|yes|on)$/i.test(env.WDECK_DRY_RUN);
  if (env.WDECK_REQUIRE_TOKEN !== undefined) out.requireToken = /^(1|true|yes|on)$/i.test(env.WDECK_REQUIRE_TOKEN);
  return out;
}

/**
 * Store di configurazione con ricarica a caldo.
 * Eventi: 'change' (nuovo deck), 'error' (ricarica fallita, deck precedente mantenuto).
 */
export class ConfigStore extends EventEmitter {
  /**
   * @param {{file: string, actionTypes?: string[], overrides?: object, logger?: object}} options
   */
  constructor({ file, actionTypes, overrides = {}, logger = console }) {
    super();
    this.file = path.resolve(file);
    this.actionTypes = actionTypes;
    this.overrides = overrides;
    this.logger = logger;
    this.deck = null;
    /** @type {object|null} contenuto del file cosi' com'e' su disco */
    this.rawDeck = null;
    this.warnings = [];
    this.watcher = null;
    this.debounce = null;
  }

  /** Carica (o ricarica) la configurazione. @returns {object} deck normalizzato */
  load() {
    const { deck, raw, warnings } = loadDeckFile(this.file, {
      actionTypes: this.actionTypes,
      overrides: this.overrides
    });
    this.deck = deck;
    this.rawDeck = raw;
    this.warnings = warnings;
    return deck;
  }

  /**
   * Copia del file cosi' com'e' su disco, senza default espansi e senza gli
   * override di CLI e ambiente.
   *
   * E' la base da cui riscrivere `deck.json`: partire dal deck normalizzato
   * scriverebbe nel file anche cio' che arriva da `--port`, `--token` o dalle
   * variabili WDECK_*, rendendo permanente qualcosa che l'utente aveva chiesto
   * solo per quell'avvio.
   * @returns {object}
   */
  snapshot() {
    if (!this.rawDeck) throw new Error('configurazione non ancora caricata: chiamare load()');
    return JSON.parse(JSON.stringify(this.rawDeck));
  }

  /** @returns {object} deck corrente (lancia se non ancora caricato) */
  get() {
    if (!this.deck) throw new Error('configurazione non ancora caricata: chiamare load()');
    return this.deck;
  }

  /**
   * Ricarica dal disco; in caso di errore mantiene la configurazione precedente.
   * @returns {{ok: boolean, deck?: object, error?: Error}}
   */
  reload() {
    try {
      const previous = this.deck;
      const deck = this.load();
      this.emit('change', deck, previous);
      return { ok: true, deck };
    } catch (err) {
      this.logger.error?.(`[wdeck] ricarica configurazione fallita: ${err.message}`);
      this.emit('error', err);
      return { ok: false, error: err };
    }
  }

  /** Attiva la sorveglianza del file (ricarica a caldo con debounce). */
  watch({ debounceMs = 250 } = {}) {
    if (this.watcher) return this.watcher;
    try {
      this.watcher = fs.watch(this.file, () => {
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => this.reload(), debounceMs);
      });
    } catch (err) {
      this.logger.warn?.(`[wdeck] impossibile sorvegliare ${this.file}: ${err.message}`);
      this.watcher = null;
    }
    return this.watcher;
  }

  /** Interrompe la sorveglianza. */
  close() {
    clearTimeout(this.debounce);
    this.debounce = null;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

/** @param {{file: string, actionTypes?: string[], overrides?: object, logger?: object}} options */
export function createConfigStore(options) {
  return new ConfigStore(options);
}
