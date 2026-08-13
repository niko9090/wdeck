/**
 * Autenticazione a token per client web e dispositivi.
 *
 * - il token puo' essere fornito in querystring (?token=), nell'header
 *   x-wdeck-token oppure come `Authorization: Bearer <token>`;
 * - il confronto e' a tempo costante;
 * - il pairing tramite PIN permette a un client nuovo di ottenere il token
 *   senza doverlo digitare a mano.
 */

import crypto from 'node:crypto';
import { TOKEN_HEADER, TOKEN_QUERY } from '../../../shared/protocol.mjs';

/** Genera un token casuale adatto all'uso in querystring. */
export function generateToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
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

/**
 * Crea il gestore di autenticazione.
 * @param {{token?: string, requireToken?: boolean, pin?: string}} config
 */
export function createAuth(config = {}) {
  let token = config.token && config.token.length > 0 ? config.token : generateToken();
  const requireToken = config.requireToken !== false;
  // Il PIN e' modificabile a caldo dalle impostazioni: le sessioni gia'
  // accoppiate continuano a funzionare, cambia solo cosa serve per accoppiarne
  // di nuove.
  let pin = config.pin ?? '';
  const generated = !(config.token && config.token.length > 0);

  return {
    /** true se il token era assente in configurazione ed e' stato generato. */
    generated,
    /** true se l'autenticazione e' obbligatoria. */
    get required() {
      return requireToken;
    },
    /** Token corrente (da mostrare in console / QR code). */
    get token() {
      return token;
    },
    /** true se il pairing tramite PIN e' abilitato. */
    get pinEnabled() {
      return typeof pin === 'string' && pin.length > 0;
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
     * Verifica un token candidato.
     * @param {string|null|undefined} candidate
     * @returns {boolean}
     */
    verify(candidate) {
      if (!requireToken) return true;
      if (typeof candidate !== 'string' || candidate.length === 0) return false;
      return safeEqual(candidate, token);
    },

    /**
     * Verifica una richiesta HTTP/WS completa.
     * @param {{headers?: object, url?: string}} req
     * @returns {{ok: boolean, token: string|null}}
     */
    verifyRequest(req) {
      const candidate = extractToken(req);
      return { ok: this.verify(candidate), token: candidate };
    },

    /**
     * Scambia un PIN valido con il token corrente (pairing).
     * @param {string} candidatePin
     * @returns {{ok: boolean, token?: string, reason?: string}}
     */
    pair(candidatePin) {
      if (!this.pinEnabled) return { ok: false, reason: 'pairing tramite PIN non abilitato' };
      if (typeof candidatePin !== 'string' || candidatePin.length === 0) {
        return { ok: false, reason: 'PIN mancante' };
      }
      if (!safeEqual(candidatePin, pin)) return { ok: false, reason: 'PIN errato' };
      return { ok: true, token };
    },

    /** Ruota il token (usato dai test e dal comando di rigenerazione). */
    rotate() {
      token = generateToken();
      return token;
    }
  };
}
