/**
 * Stato reale dei controlli.
 *
 * Uno Stream Deck si distingue da un telecomando perche' il bottone del muto
 * *sa* di essere muto. Qui l'host interroga periodicamente il sistema (o i
 * servizi collegati) e riporta ai client la condizione corrente di ogni
 * controllo che sappia dichiararla.
 *
 * Un handler partecipa dichiarando `readState(params, ctx)`, che restituisce
 * `{ on?: boolean, level?: number, text?: string }` oppure `null` se lo stato
 * non e' determinabile. Chi non la dichiara non viene mai interrogato, quindi
 * l'aggiunta e' a costo zero per le azioni che non hanno uno stato.
 *
 * Tre accorgimenti tengono basso il costo delle letture, che su Windows sono
 * processi PowerShell:
 *   - si interrogano solo i controlli della pagina che i client stanno
 *     guardando, e solo mentre almeno un client e' collegato;
 *   - `ctx.cached(chiave, fn)` mette in comune le letture identiche all'interno
 *     dello stesso giro (dieci bottoni volume = una sola lettura);
 *   - una lettura fallita mette la sua chiave in pausa (backoff), cosi' un
 *     servizio spento non viene interrogato ogni pochi secondi.
 */

import { EventEmitter } from 'node:events';

/** Ogni quanto rileggere lo stato, quando ci sono client collegati. */
export const DEFAULT_INTERVAL_MS = 8000;

/** Attesa dopo una pressione prima di rileggere: il sistema deve applicarla. */
export const AFTER_PRESS_DELAY_MS = 250;

/** Pausa imposta a una chiave dopo una lettura fallita. */
export const FAILURE_BACKOFF_MS = 60000;

/**
 * Normalizza il valore restituito da un handler.
 * @param {unknown} raw
 * @returns {{on: boolean|null, level: number|null, text: string|null}|null}
 */
export function normalizeStatus(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const on = typeof raw.on === 'boolean' ? raw.on : null;
  const level = Number.isFinite(Number(raw.level)) && raw.level !== null && raw.level !== ''
    ? Math.round(Number(raw.level))
    : null;
  const text = typeof raw.text === 'string' && raw.text !== '' ? raw.text.slice(0, 64) : null;
  if (on === null && level === null && text === null) return null;
  return { on, level, text };
}

/** Confronto stabile fra due voci di stato (evita broadcast inutili). */
export function sameStatus(a, b) {
  if (!a || !b) return a === b;
  return a.on === b.on && a.level === b.level && a.text === b.text && a.error === b.error;
}

export class StatusTracker extends EventEmitter {
  /**
   * @param {{
   *   registry: object,
   *   state: object,
   *   getDeck: () => object,
   *   baseDir?: string,
   *   logger?: object,
   *   intervalMs?: number,
   *   enabled?: boolean,
   *   now?: () => number
   * }} deps
   */
  constructor({ registry, state, getDeck, baseDir = process.cwd(), logger = console, intervalMs, enabled = true, now = Date.now }) {
    super();
    this.registry = registry;
    this.state = state;
    this.getDeck = getDeck;
    this.baseDir = baseDir;
    this.logger = logger;
    this.intervalMs = Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_INTERVAL_MS;
    this.enabled = enabled !== false;
    this.now = now;

    /** @type {Map<string, {on: boolean|null, level: number|null, text: string|null, error?: string, at: number}>} */
    this.statuses = new Map();
    /** @type {Map<string, number>} chiave di lettura -> istante di fine pausa */
    this.backoff = new Map();
    this.timer = null;
    this.running = false;
    this.pendingPress = null;
  }

  /**
   * Controlli della pagina attiva che dichiarano uno stato leggibile.
   * @returns {Array<{buttonId: string, type: string, params: object}>}
   */
  targets() {
    const deck = this.getDeck();
    const profile = deck.profiles.find((p) => p.id === this.state.activeProfileId) ?? deck.profiles[0];
    if (!profile) return [];
    const page = profile.pages.find((p) => p.id === this.state.activePageId) ?? profile.pages[0];
    if (!page) return [];

    const out = [];
    for (const button of page.buttons ?? []) {
      if (button.status === false) continue;
      const action = button.action;
      if (!action?.type || !this.registry.has(action.type)) continue;
      const handler = this.registry.get(action.type);
      if (typeof handler.readState !== 'function') continue;
      out.push({ buttonId: button.id, type: action.type, params: action.params ?? {} });
    }
    return out;
  }

  /** Istantanea serializzabile, inviata ai client. */
  snapshot() {
    return Object.fromEntries(this.statuses);
  }

  /** Cancella lo stato dei controlli che non esistono piu' dopo una ricarica. */
  prune() {
    const deck = this.getDeck();
    const known = new Set();
    for (const profile of deck.profiles) {
      for (const page of profile.pages) {
        for (const button of page.buttons ?? []) known.add(button.id);
      }
    }
    let changed = false;
    for (const id of [...this.statuses.keys()]) {
      if (!known.has(id)) {
        this.statuses.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit('change', this.snapshot());
  }

  /**
   * Interroga i controlli visibili e pubblica le variazioni.
   * @param {{only?: string[], force?: boolean}} [options]
   * @returns {Promise<Record<string, object>>} le sole voci cambiate
   */
  async refresh(options = {}) {
    if (!this.enabled) return {};
    // In dry-run l'host non tocca il sistema: nemmeno per leggere. E' la stessa
    // promessa che vale per le azioni, e rende i test riproducibili ovunque.
    if (this.state.dryRun) return {};
    if (this.running && !options.force) return {};

    this.running = true;
    const changes = {};
    try {
      const cache = new Map();
      const deck = this.getDeck();
      const ctx = {
        dryRun: false,
        reading: true,
        baseDir: this.baseDir,
        security: deck.settings.security,
        deck,
        state: this.state,
        logger: this.logger,
        source: 'status',
        /**
         * Esegue `fn` una volta sola per chiave all'interno di questo giro.
         * @param {string} key
         * @param {() => Promise<unknown>} fn
         */
        cached: (key, fn) => {
          if (!cache.has(key)) cache.set(key, fn());
          return cache.get(key);
        }
      };

      const wanted = options.only ? new Set(options.only) : null;
      const targets = this.targets().filter((t) => !wanted || wanted.has(t.buttonId));

      await Promise.all(targets.map(async (target) => {
        const handler = this.registry.get(target.type);
        const backoffKey = `${target.type}:${JSON.stringify(target.params)}`;
        const until = this.backoff.get(backoffKey) ?? 0;
        if (until > this.now() && !options.force) return;

        let entry;
        try {
          entry = normalizeStatus(await handler.readState(target.params, ctx));
          this.backoff.delete(backoffKey);
        } catch (err) {
          this.backoff.set(backoffKey, this.now() + FAILURE_BACKOFF_MS);
          entry = { on: null, level: null, text: null, error: String(err?.message ?? err).slice(0, 160) };
        }

        const previous = this.statuses.get(target.buttonId);
        if (entry === null) {
          if (previous !== undefined) {
            this.statuses.delete(target.buttonId);
            changes[target.buttonId] = null;
          }
          return;
        }
        const next = { ...entry, at: this.now() };
        if (previous && sameStatus(previous, next)) return;
        this.statuses.set(target.buttonId, next);
        changes[target.buttonId] = next;
      }));
    } finally {
      this.running = false;
    }

    if (Object.keys(changes).length > 0) this.emit('change', this.snapshot(), changes);
    return changes;
  }

  /**
   * Rilegge lo stato dopo una pressione, lasciando al sistema il tempo di
   * applicarla. Le pressioni ravvicinate collassano in una sola lettura.
   */
  scheduleAfterPress() {
    if (!this.enabled || this.pendingPress) return;
    this.pendingPress = setTimeout(() => {
      this.pendingPress = null;
      this.refresh({ force: true }).catch(() => {});
    }, AFTER_PRESS_DELAY_MS);
    if (typeof this.pendingPress.unref === 'function') this.pendingPress.unref();
  }

  /** Avvia il ciclo periodico. Non fa nulla se e' gia' attivo o disabilitato. */
  start() {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => {
      // Nessuno sta guardando: niente processi da avviare.
      if (this.state.clients.size === 0) return;
      this.refresh().catch((err) => this.logger.debug?.(`[wdeck] lettura stato fallita: ${err.message}`));
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** Ferma il ciclo periodico e le letture in attesa. */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.pendingPress) clearTimeout(this.pendingPress);
    this.pendingPress = null;
  }
}

/** @param {ConstructorParameters<typeof StatusTracker>[0]} deps */
export function createStatusTracker(deps) {
  return new StatusTracker(deps);
}
