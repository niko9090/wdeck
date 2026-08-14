/**
 * Limitazione della frequenza delle richieste.
 *
 * Serve a due cose diverse, con due tarature diverse:
 *
 *  - **pressioni**: un client impazzito (o un cursore trascinato da uno script)
 *    puo' chiedere decine di azioni al secondo, e ognuna su Windows e' un
 *    processo PowerShell. Il limite qui e' generoso: deve fermare l'abuso, non
 *    l'uso normale, e un deck si preme anche in fretta.
 *  - **tentativi di autenticazione**: un PIN di 4 cifre sono diecimila
 *    combinazioni, che senza limite si provano in pochi secondi. Qui il limite
 *    e' stretto e cresce di peso: e' l'unica cosa che rende il pairing con PIN
 *    difendibile su una rete condivisa.
 *
 * L'implementazione e' una finestra scorrevole: si tengono gli istanti dei
 * tentativi recenti e si contano quelli ancora dentro la finestra. Rispetto a
 * un contatore azzerato a intervalli fissi non ha il buco al cambio di
 * intervallo, dove passerebbe il doppio delle richieste consentite.
 */

/** Quante chiavi distinte tenere in memoria prima di dimenticare le piu' vecchie. */
export const MAX_KEYS = 2048;

/** Tarature predefinite. */
export const DEFAULT_LIMITS = Object.freeze({
  press: { windowMs: 10000, max: 60 },
  auth: { windowMs: 300000, max: 10 }
});

/**
 * Crea un limitatore a finestra scorrevole.
 * @param {{windowMs?: number, max?: number, now?: () => number}} [options]
 */
export function createRateLimiter({ windowMs = 10000, max = 60, now = Date.now } = {}) {
  /** @type {Map<string, number[]>} chiave -> istanti dei tentativi recenti */
  const hits = new Map();

  /** Toglie dalla chiave gli istanti usciti dalla finestra. */
  function prune(key, at) {
    const list = hits.get(key);
    if (!list) return [];
    const cutoff = at - windowMs;
    // Gli istanti sono in ordine crescente: basta tagliare la testa.
    let i = 0;
    while (i < list.length && list[i] <= cutoff) i += 1;
    const kept = i === 0 ? list : list.slice(i);
    if (kept.length === 0) hits.delete(key);
    else hits.set(key, kept);
    return kept;
  }

  return {
    windowMs,
    max,

    /**
     * Registra un tentativo e dice se e' consentito.
     * @param {string} key identita' del richiedente (dispositivo o indirizzo)
     * @returns {{allowed: boolean, remaining: number, retryAfterMs: number}}
     */
    check(key) {
      const at = now();
      const recent = prune(key, at);

      if (recent.length >= max) {
        // Il prossimo posto si libera quando esce il piu' vecchio dei tentativi.
        const retryAfterMs = Math.max(0, recent[0] + windowMs - at);
        return { allowed: false, remaining: 0, retryAfterMs };
      }

      recent.push(at);
      hits.set(key, recent);

      // Una tabella che cresce senza limite sarebbe un'altra via per esaurire la
      // memoria dell'host: oltre il tetto si dimentica la chiave meno recente.
      if (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value);

      return { allowed: true, remaining: max - recent.length, retryAfterMs: 0 };
    },

    /** Tentativi ancora dentro la finestra per una chiave. */
    count(key) {
      return prune(key, now()).length;
    },

    /** Azzera una chiave: usato dopo un'autenticazione riuscita. */
    reset(key) {
      hits.delete(key);
    },

    /** Azzera tutto. */
    clear() {
      hits.clear();
    },

    get size() {
      return hits.size;
    }
  };
}

/**
 * Identita' da usare come chiave del limitatore.
 *
 * Si preferisce il dispositivo autenticato all'indirizzo di rete: dietro un
 * NAT o un proxy tutti i telefoni di casa condividono lo stesso indirizzo, e
 * limitarli insieme punirebbe l'innocente per il vicino.
 * @param {{deviceId?: string|null, address?: string|null}} source
 * @returns {string}
 */
export function limiterKey({ deviceId, address } = {}) {
  if (deviceId) return `d:${deviceId}`;
  return `a:${normalizeAddress(address)}`;
}

/**
 * Normalizza un indirizzo remoto (`::ffff:192.168.1.5` -> `192.168.1.5`).
 * @param {string|null|undefined} address
 * @returns {string}
 */
export function normalizeAddress(address) {
  const raw = String(address ?? '').trim();
  if (raw === '') return 'sconosciuto';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

/**
 * Crea i due limitatori usati dall'host.
 * @param {{press?: object, auth?: object, enabled?: boolean, now?: () => number}} [config]
 */
export function createRateLimits(config = {}) {
  const enabled = config.enabled !== false;
  const press = { ...DEFAULT_LIMITS.press, ...(config.press ?? {}) };
  const auth = { ...DEFAULT_LIMITS.auth, ...(config.auth ?? {}) };

  return {
    enabled,
    press: createRateLimiter({ ...press, now: config.now }),
    auth: createRateLimiter({ ...auth, now: config.now }),

    /**
     * Controlla il limite delle pressioni.
     * @param {{deviceId?: string|null, address?: string|null}} source
     */
    checkPress(source) {
      if (!enabled) return { allowed: true, remaining: Infinity, retryAfterMs: 0 };
      return this.press.check(limiterKey(source));
    },

    /**
     * Controlla il limite dei tentativi di autenticazione.
     * @param {{address?: string|null}} source
     */
    checkAuth(source) {
      if (!enabled) return { allowed: true, remaining: Infinity, retryAfterMs: 0 };
      return this.auth.check(limiterKey({ address: source?.address }));
    },

    /** Dimentica i tentativi falliti dopo un accesso riuscito. */
    clearAuth(source) {
      this.auth.reset(limiterKey({ address: source?.address }));
    }
  };
}
