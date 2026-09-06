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
  // 600 ogni 10 s: una tavoletta o un cursore trascinato manda 8-16 messaggi
  // al secondo, e con 60 si bloccava dopo pochi secondi ("troppi comandi").
  // Il freno serve contro un client impazzito, non contro un dito.
  press: { windowMs: 10000, max: 600 },
  auth: { windowMs: 300000, max: 10 },
  // Tetto complessivo dei tentativi di accesso, sommati su tutti gli indirizzi.
  // Il limite per-indirizzo da solo non basta: chi ruota gli indirizzi IPv6 (un
  // /64 ne offre miliardi) avrebbe un secchiello nuovo per ognuno. Questo tetto,
  // non legato a nessuna chiave, mette un limite duro al brute force del PIN a
  // prescindere da quanti indirizzi l'attaccante controlli.
  authGlobal: { windowMs: 300000, max: 100 }
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
        // Anche una chiave bloccata va rinfrescata in coda: e' attiva, e non deve
        // essere sfrattata al posto di una dimenticata da tempo.
        if (hits.has(key)) {
          hits.delete(key);
          hits.set(key, recent);
        }
        return { allowed: false, remaining: 0, retryAfterMs };
      }

      recent.push(at);
      // delete + set porta la chiave in coda alla Map: l'ordine diventa quello di
      // ultimo accesso, non di primo inserimento.
      hits.delete(key);
      hits.set(key, recent);

      // Una tabella che cresce senza limite sarebbe un'altra via per esaurire la
      // memoria dell'host: oltre il tetto si dimentica la chiave usata meno di
      // recente (la testa della Map), non una attiva finita per caso in fondo.
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
 * Prefisso /64 di un indirizzo IPv6, cioe' i primi quattro gruppi canonizzati.
 *
 * A un dispositivo domestico l'operatore assegna un intero /64 (miliardi di
 * indirizzi): contarli separatamente vorrebbe dire regalare un secchiello a
 * ognuno. Contro il brute force conta la rete, non il singolo indirizzo.
 * @param {string} address
 * @returns {string}
 */
export function ipv6Prefix64(address) {
  const senzaZona = address.split('%')[0];
  let groups;
  if (senzaZona.includes('::')) {
    const [head, tail = ''] = senzaZona.split('::');
    const h = head === '' ? [] : head.split(':');
    const t = tail === '' ? [] : tail.split(':');
    const missing = Math.max(0, 8 - h.length - t.length);
    groups = [...h, ...Array(missing).fill('0'), ...t];
  } else {
    groups = senzaZona.split(':');
  }
  // Ogni gruppo canonizzato (via zeri iniziali) cosi' `2001:0db8` e `2001:db8`
  // finiscono nella stessa chiave.
  const prefix = groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16));
  while (prefix.length < 4) prefix.push('0');
  return prefix.join(':');
}

/**
 * Chiave del limitatore dei tentativi di accesso a partire dall'indirizzo.
 * Gli indirizzi IPv6 sono raggruppati per /64, quelli IPv4 restano interi.
 * @param {string|null|undefined} address
 * @returns {string}
 */
export function authAddressKey(address) {
  const norm = normalizeAddress(address);
  if (!norm.includes(':')) return `a:${norm}`;
  return `a:${ipv6Prefix64(norm)}/64`;
}

/**
 * Crea i due limitatori usati dall'host.
 * @param {{press?: object, auth?: object, enabled?: boolean, now?: () => number}} [config]
 */
export function createRateLimits(config = {}) {
  const enabled = config.enabled !== false;
  const press = { ...DEFAULT_LIMITS.press, ...(config.press ?? {}) };
  const auth = { ...DEFAULT_LIMITS.auth, ...(config.auth ?? {}) };
  // Il tetto globale segue la finestra dell'auth ma tiene il suo tetto di
  // tentativi; un'eventuale configurazione esplicita ha comunque la precedenza.
  const authGlobal = { ...DEFAULT_LIMITS.authGlobal, windowMs: auth.windowMs, ...(config.authGlobal ?? {}) };

  return {
    enabled,
    press: createRateLimiter({ ...press, now: config.now }),
    auth: createRateLimiter({ ...auth, now: config.now }),
    authGlobal: createRateLimiter({ ...authGlobal, now: config.now }),

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
     *
     * Devono passare due controlli: quello per-indirizzo (per /64 su IPv6) e il
     * tetto globale, che vale su tutti gli indirizzi insieme. Basta che uno dei
     * due sia pieno perche' il tentativo sia respinto.
     * @param {{address?: string|null}} source
     */
    checkAuth(source) {
      if (!enabled) return { allowed: true, remaining: Infinity, retryAfterMs: 0 };
      const perIndirizzo = this.auth.check(authAddressKey(source?.address));
      const globale = this.authGlobal.check('*');
      if (perIndirizzo.allowed && globale.allowed) return perIndirizzo;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(perIndirizzo.retryAfterMs, globale.retryAfterMs)
      };
    },

    /**
     * Dimentica i tentativi falliti di un indirizzo dopo un accesso riuscito.
     * Il tetto globale non si azzera: un successo occasionale non deve aprire la
     * strada al brute force da tutti gli altri indirizzi.
     */
    clearAuth(source) {
      this.auth.reset(authAddressKey(source?.address));
    }
  };
}
