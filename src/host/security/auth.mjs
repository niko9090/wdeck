/**
 * Autenticazione a token per client web e dispositivi.
 *
 * Esistono due generi di credenziale, con scopi diversi:
 *
 *  - il **token principale** (`settings.security.token`), quello stampato in
 *    console e messo negli URL: e' la chiave di casa, vale per tutto e non
 *    scade;
 *  - i **token per dispositivo**, uno per telefono o tablet, creati dal
 *    pairing con PIN. Si revocano uno alla volta, possono scadere, e nel file
 *    di configurazione ne resta solo l'impronta: chi legge `deck.json` non
 *    puo' ricavarli. Un telefono perso si toglie senza scollegare gli altri.
 *
 * Il token puo' essere fornito in querystring (`?token=`), nell'header
 * `x-wdeck-token` oppure come `Authorization: Bearer <token>`. Il confronto e'
 * sempre a tempo costante, anche contro le impronte dei dispositivi.
 */

import crypto from 'node:crypto';
import { TOKEN_HEADER, TOKEN_QUERY } from '../../../shared/protocol.mjs';

/** Genera un token casuale adatto all'uso in querystring. */
export function generateToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Impronta di un token, l'unica cosa che finisce in deck.json. */
export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/**
 * Confronto a tempo costante fra due stringhe.
 * @param {string} a
 * @param {string} b
 */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufA.length !== bufB.length) {
    // confronto fittizio per non far trapelare la lunghezza dal tempo di risposta
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Estrae il token da una richiesta HTTP (o da un URL di upgrade WebSocket).
 * @param {{headers?: Record<string,string|string[]|undefined>, url?: string}} req
 * @returns {string|null}
 */
export function extractToken(req) {
  const headers = req?.headers ?? {};

  const direct = headers[TOKEN_HEADER] ?? headers[TOKEN_HEADER.toUpperCase()];
  if (typeof direct === 'string' && direct.length > 0) return direct;

  const auth = headers.authorization ?? headers.Authorization;
  if (typeof auth === 'string' && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, '').trim();
  }

  if (typeof req?.url === 'string') {
    const qIndex = req.url.indexOf('?');
    if (qIndex !== -1) {
      const params = new URLSearchParams(req.url.slice(qIndex + 1));
      const fromQuery = params.get(TOKEN_QUERY);
      if (fromQuery) return fromQuery;
    }
  }

  return null;
}

/** Identificatore di un dispositivo: breve, leggibile, non indovinabile. */
export function generateDeviceId() {
  return `d-${crypto.randomBytes(5).toString('hex')}`;
}

/**
 * Normalizza una voce di dispositivo letta da deck.json.
 * @param {unknown} raw
 * @returns {{id: string, name: string, hash: string, createdAt: number, expiresAt: number|null}|null}
 */
export function normalizeDevice(raw) {
  if (typeof raw !== 'object' || raw === null) return null;
  const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : null;
  const hash = typeof raw.hash === 'string' && /^[0-9a-f]{64}$/i.test(raw.hash) ? raw.hash.toLowerCase() : null;
  if (!id || !hash) return null;
  return {
    id,
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name.slice(0, 64) : id,
    hash,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    expiresAt: Number.isFinite(raw.expiresAt) ? raw.expiresAt : null
  };
}

/** true se il dispositivo e' scaduto al momento indicato. */
export const isExpired = (device, at) => device.expiresAt !== null && device.expiresAt <= at;

/**
 * Crea il gestore di autenticazione.
 * @param {{
 *   token?: string,
 *   requireToken?: boolean,
 *   pin?: string,
 *   devices?: object[],
 *   deviceTokenDays?: number|null
 * }} config
 * @param {{onChange?: (state: {token: string, devices: object[]}) => void, now?: () => number}} [hooks]
 *   `onChange` viene chiamato quando token o dispositivi cambiano, per scriverli
 *   su disco. L'host lo collega a deck.json.
 */
export function createAuth(config = {}, hooks = {}) {
  const now = hooks.now ?? Date.now;
  const onChange = hooks.onChange ?? (() => {});

  let token = config.token && config.token.length > 0 ? config.token : generateToken();
  let requireToken = config.requireToken !== false;
  // Il PIN e' modificabile a caldo dalle impostazioni: le sessioni gia'
  // accoppiate continuano a funzionare, cambia solo cosa serve per accoppiarne
  // di nuove.
  let pin = config.pin ?? '';
  let generated = !(config.token && config.token.length > 0);
  let defaultDays = Number.isFinite(config.deviceTokenDays) && config.deviceTokenDays > 0
    ? config.deviceTokenDays
    : null;

  /** @type {Map<string, object>} id -> dispositivo */
  const devices = new Map();
  /** @type {Map<string, number>} id -> ultimo accesso (solo in memoria) */
  const lastSeen = new Map();

  function loadDevices(list) {
    devices.clear();
    for (const raw of Array.isArray(list) ? list : []) {
      const device = normalizeDevice(raw);
      if (device) devices.set(device.id, device);
    }
  }
  loadDevices(config.devices);

  /** Forma persistibile dei dispositivi (con impronta, senza token). */
  const serialize = () => [...devices.values()].map((d) => ({
    id: d.id,
    name: d.name,
    hash: d.hash,
    createdAt: d.createdAt,
    ...(d.expiresAt === null ? {} : { expiresAt: d.expiresAt })
  }));

  /**
   * Avvisa chi deve scrivere su disco.
   * @param {'devices'|'rotate'} reason cosa e' cambiato: solo la rotazione
   *   giustifica riscrivere il token principale nel file.
   */
  const notify = (reason) => onChange({ token, devices: serialize(), reason });

  const api = {
    /** true se il token era assente in configurazione ed e' stato generato. */
    get generated() {
      return generated;
    },
    /** true se l'autenticazione e' obbligatoria. */
    get required() {
      return requireToken;
    },
    /** Token principale (da mostrare in console / QR code). */
    get token() {
      return token;
    },
    /** true se il pairing tramite PIN e' abilitato. */
    get pinEnabled() {
      return typeof pin === 'string' && pin.length > 0;
    },
    /** Giorni di validita' predefiniti dei token per dispositivo (null = illimitati). */
    get deviceTokenDays() {
      return defaultDays;
    },

    /**
     * Sostituisce il PIN di pairing. Una stringa vuota disattiva il pairing.
     * @param {string} next
     */
    setPin(next) {
      pin = typeof next === 'string' ? next : '';
      return pin.length > 0;
    },

    /**
     * Riallinea il gestore alla configurazione appena riletta da disco.
     *
     * Serve a far valere una modifica fatta a mano in `deck.json` senza
     * riavviare l'host: un dispositivo cancellato dal file smette di poter
     * entrare. Il token principale viene adottato solo se non e' stato imposto
     * da `--token` o da `WDECK_TOKEN`, che valgono per quell'avvio soltanto.
     * @param {object} security blocco settings.security
     * @param {{allowTokenChange?: boolean}} [options]
     */
    syncFromConfig(security = {}, { allowTokenChange = true } = {}) {
      loadDevices(security.devices);
      pin = security.pin ?? '';
      if (security.requireToken !== undefined) requireToken = security.requireToken !== false;
      defaultDays = Number.isFinite(security.deviceTokenDays) && security.deviceTokenDays > 0
        ? security.deviceTokenDays
        : null;
      if (allowTokenChange && typeof security.token === 'string' && security.token.length > 0 && security.token !== token) {
        token = security.token;
        generated = false;
      }
    },

    /** Elenco pubblico dei dispositivi: nessuna impronta, nessun token. */
    listDevices() {
      const at = now();
      return [...devices.values()].map((d) => ({
        id: d.id,
        name: d.name,
        createdAt: d.createdAt,
        expiresAt: d.expiresAt,
        expired: isExpired(d, at),
        lastSeenAt: lastSeen.get(d.id) ?? null
      }));
    },

    /**
     * Verifica un token candidato.
     * @param {string|null|undefined} candidate
     * @returns {boolean}
     */
    verify(candidate) {
      return api.identify(candidate).ok;
    },

    /**
     * Verifica un token dicendo anche *chi* e'.
     * Serve ai limiti di frequenza, che contano per dispositivo, e all'audit.
     * @param {string|null|undefined} candidate
     * @returns {{ok: boolean, kind: 'none'|'master'|'device', device: object|null, reason?: string}}
     */
    identify(candidate) {
      if (!requireToken) return { ok: true, kind: 'none', device: null };
      if (typeof candidate !== 'string' || candidate.length === 0) {
        return { ok: false, kind: 'none', device: null, reason: 'token mancante' };
      }

      if (safeEqual(candidate, token)) return { ok: true, kind: 'master', device: null };

      const at = now();
      const digest = hashToken(candidate);
      for (const device of devices.values()) {
        if (!safeEqual(digest, device.hash)) continue;
        if (isExpired(device, at)) {
          return { ok: false, kind: 'device', device, reason: `token del dispositivo "${device.name}" scaduto` };
        }
        lastSeen.set(device.id, at);
        return { ok: true, kind: 'device', device };
      }
      return { ok: false, kind: 'none', device: null, reason: 'token non valido' };
    },

    /**
     * Verifica una richiesta HTTP/WS completa.
     * @param {{headers?: object, url?: string}} req
     * @returns {{ok: boolean, token: string|null, kind: string, device: object|null}}
     */
    verifyRequest(req) {
      const candidate = extractToken(req);
      const result = api.identify(candidate);
      return { ok: result.ok, token: candidate, kind: result.kind, device: result.device };
    },

    /**
     * Crea un token per un dispositivo.
     * @param {{name?: string, days?: number|null}} [spec]
     * @returns {{id: string, name: string, token: string, expiresAt: number|null}}
     */
    createDevice({ name, days } = {}) {
      const at = now();
      const value = generateToken();
      const validity = days === undefined ? defaultDays : days;
      const device = {
        id: generateDeviceId(),
        name: (typeof name === 'string' && name.trim() !== '' ? name.trim() : 'dispositivo').slice(0, 64),
        hash: hashToken(value),
        createdAt: at,
        expiresAt: Number.isFinite(validity) && validity > 0 ? at + validity * 86400000 : null
      };
      devices.set(device.id, device);
      notify('devices');
      return { id: device.id, name: device.name, token: value, expiresAt: device.expiresAt };
    },

    /**
     * Revoca un dispositivo.
     * @param {string} id
     * @returns {boolean} true se esisteva
     */
    revokeDevice(id) {
      if (!devices.delete(id)) return false;
      lastSeen.delete(id);
      notify('devices');
      return true;
    },

    /**
     * Toglie i dispositivi scaduti.
     * @returns {string[]} id rimossi
     */
    pruneExpired() {
      const at = now();
      const removed = [];
      for (const [id, device] of devices) {
        if (isExpired(device, at)) {
          devices.delete(id);
          lastSeen.delete(id);
          removed.push(id);
        }
      }
      if (removed.length > 0) notify('devices');
      return removed;
    },

    /**
     * Scambia un PIN valido con un token nuovo, dedicato a quel dispositivo.
     *
     * Prima il pairing restituiva il token principale: bastava un telefono
     * perso per doverlo cambiare a tutti. Ora ogni accoppiamento ha la sua
     * credenziale, revocabile da sola.
     * @param {string} candidatePin
     * @param {{name?: string, days?: number|null}} [spec]
     * @returns {{ok: boolean, token?: string, device?: object, reason?: string}}
     */
    pair(candidatePin, spec = {}) {
      if (!api.pinEnabled) return { ok: false, reason: 'pairing tramite PIN non abilitato' };
      if (typeof candidatePin !== 'string' || candidatePin.length === 0) {
        return { ok: false, reason: 'PIN mancante' };
      }
      if (!safeEqual(candidatePin, pin)) return { ok: false, reason: 'PIN errato' };

      const created = api.createDevice(spec);
      return { ok: true, token: created.token, device: { id: created.id, name: created.name, expiresAt: created.expiresAt } };
    },

    /**
     * Rigenera il token principale.
     *
     * I dispositivi accoppiati non vengono toccati, a meno di chiederlo:
     * ruotare la chiave di casa non deve buttare fuori chi ha gia' la sua.
     * @param {{revokeDevices?: boolean}} [options]
     * @returns {string} il nuovo token
     */
    rotate({ revokeDevices = false } = {}) {
      token = generateToken();
      generated = false;
      if (revokeDevices) {
        devices.clear();
        lastSeen.clear();
      }
      notify('rotate');
      return token;
    }
  };

  return api;
}
