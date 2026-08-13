/**
 * API REST dell'host.
 * Tutte le rotte tranne /api/health e /api/pair richiedono un token valido.
 */

import { ENDPOINTS, ERROR_CODES, PROTOCOL_VERSION, LITE_PROTOCOL_VERSION, LITE_FIELDS, toLitePage } from '../../../shared/protocol.mjs';
import { CATEGORIES } from '../actions/registry.mjs';
import { normalizeAddress } from '../security/ratelimit.mjs';
import {
  ICON_TYPES as ICON_FORMATS,
  MAX_ICONS as MAX_ICON_COUNT,
  MAX_ICON_BYTES as MAX_ICON_BYTES_PER_FILE
} from '../icons.mjs';

const MAX_BODY = 64 * 1024;

/**
 * Limite piu' alto per il caricamento delle icone: un PNG da 192 KB diventa
 * circa 256 KB una volta codificato in base64.
 */
const MAX_ICON_BODY = 384 * 1024;

/** Invia una risposta JSON. */
export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

/** Invia un errore JSON uniforme. */
export function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } });
}

/**
 * Legge e interpreta il corpo JSON della richiesta.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<object>}
 */
export function readJsonBody(req, { limit = MAX_BODY } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('corpo della richiesta troppo grande'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw === '') return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return reject(Object.assign(new Error('atteso oggetto JSON'), { status: 400 }));
        }
        return resolve(parsed);
      } catch (err) {
        return reject(Object.assign(new Error(`JSON non valido: ${err.message}`), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Versione pubblica del deck: rimuove qualunque dato sensibile
 * (token, PIN, whitelist dei percorsi eseguibili).
 * @param {object} deck
 */
export function publicDeck(deck) {
  return {
    version: deck.version,
    name: deck.name,
    defaultProfile: deck.defaultProfile,
    ui: deck.settings.ui,
    // Le integrazioni contengono password e token: al client serve solo sapere
    // quali sono configurate, per poter mostrare o meno le relative azioni.
    integrations: Object.fromEntries(
      Object.entries(deck.settings.integrations ?? {}).map(([name, config]) => [name, { configured: Object.keys(config ?? {}).length > 0 }])
    ),
    profiles: deck.profiles
  };
}

/**
 * Crea il router REST.
 * @param {object} host istanza creata da createHost()
 */
export function createApiRouter(host) {
  const { auth, state, dispatcher, registry, configStore, version } = host;

  /** Indirizzo del richiedente, usato come identita' per i limiti. */
  const addressOf = (req) => normalizeAddress(req.socket?.remoteAddress);

  const requireAuth = (req, res) => {
    const { ok } = auth.verifyRequest(req);
    if (!ok) {
      // Anche un token sbagliato e' un tentativo di indovinare: va contato,
      // altrimenti il limite sul PIN si aggira provando direttamente i token.
      host.limits.checkAuth({ address: addressOf(req) });
      sendError(res, 401, ERROR_CODES.unauthorized, 'token mancante o non valido');
      return false;
    }
    return true;
  };

  /**
   * Applica un limite e, se superato, risponde 429.
   * @returns {boolean} true se la richiesta puo' proseguire
   */
  const allow = (res, result, what) => {
    if (result.allowed) return true;
    const seconds = Math.ceil(result.retryAfterMs / 1000);
    res.setHeader('Retry-After', String(Math.max(1, seconds)));
    sendError(res, 429, ERROR_CODES.rateLimited,
      `troppi ${what}: riprova fra ${Math.max(1, seconds)} secondi`);
    return false;
  };

  const routes = {
    [`GET ${ENDPOINTS.health}`]: (req, res) => {
      sendJson(res, 200, {
        ok: true,
        name: configStore.get().settings.server.publicName,
        deckName: configStore.get().name,
        version,
        protocol: PROTOCOL_VERSION,
        liteProtocol: LITE_PROTOCOL_VERSION,
        platform: process.platform,
        requiresToken: auth.required,
        pinPairing: auth.pinEnabled,
        dryRun: state.dryRun,
        uptimeMs: Date.now() - state.startedAt
      });
    },

    [`POST ${ENDPOINTS.pair}`]: async (req, res) => {
      const address = addressOf(req);
      // Il controllo viene prima della lettura del PIN: e' proprio il tentativo
      // a dover essere contato, riuscito o no.
      if (!allow(res, host.limits.checkAuth({ address }), 'tentativi di accesso')) {
        host.logger.warn?.(`[wdeck] pairing bloccato dal limite: ${address}`);
        host.audit.write('rate-limited', { what: 'pair', address });
        return;
      }

      const body = await readJsonBody(req);
      const result = auth.pair(body.pin, { name: body.name, days: body.days });
      if (!result.ok) {
        host.audit.write('pair-failed', { address, reason: result.reason ?? null });
        sendError(res, 401, ERROR_CODES.unauthorized, result.reason ?? 'pairing rifiutato');
        return;
      }
      // Chi ha dimostrato di conoscere il PIN non e' un attaccante: i suoi
      // tentativi precedenti non devono pesare sui prossimi accessi.
      host.limits.clearAuth({ address });
      host.audit.write('pair', { address, device: result.device.id, name: result.device.name });
      host.logger.info?.(`[wdeck] pairing riuscito da ${address}: "${result.device.name}" (${result.device.id})`);
      // Il token viaggia una volta sola: dopo, di lui resta la sola impronta.
      sendJson(res, 200, { ok: true, token: result.token, device: result.device });
    },

    [`GET ${ENDPOINTS.deck}`]: (req, res) => {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, {
        ok: true,
        protocol: PROTOCOL_VERSION,
        deck: publicDeck(configStore.get()),
        state: state.snapshot()
      });
    },

    [`GET ${ENDPOINTS.state}`]: (req, res) => {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, { ok: true, state: state.snapshot() });
    },

    [`GET ${ENDPOINTS.status}`]: async (req, res, url) => {
      if (!requireAuth(req, res)) return;
      // ?refresh=1 forza una rilettura dal sistema invece di usare la cache.
      if (url.searchParams.get('refresh') === '1') {
        await host.status.refresh({ force: true });
      }
      sendJson(res, 200, { ok: true, states: host.status.snapshot() });
    },

    [`GET ${ENDPOINTS.actions}`]: (req, res) => {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, {
        ok: true,
        actions: registry.list(),
        categories: CATEGORIES,
        // Raggruppate lato host: l'editor le mostra cosi' come arrivano,
        // senza dover conoscere l'ordine delle categorie.
        groups: registry.byCategory(),
        platform: process.platform
      });
    },

    [`POST ${ENDPOINTS.save}`]: async (req, res) => {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      if (!body.deck) {
        sendError(res, 400, ERROR_CODES.badRequest, 'campo "deck" mancante');
        return;
      }
      const result = host.saveDeck(body.deck);
      if (!result.ok) {
        sendJson(res, 400, { ok: false, error: { code: ERROR_CODES.badRequest, message: result.message }, errors: result.errors });
        return;
      }
      sendJson(res, 200, { ok: true, deck: publicDeck(result.deck), state: state.snapshot(), backup: result.backup });
    },

    [`GET ${ENDPOINTS.settings}`]: (req, res) => {
      if (!requireAuth(req, res)) return;
      const deck = configStore.get();
      sendJson(res, 200, {
        ok: true,
        settings: {
          server: deck.settings.server,
          ui: deck.settings.ui,
          tray: deck.settings.tray,
          updates: deck.settings.updates,
          // Del blocco sicurezza si espone la forma, mai i valori.
          security: {
            requireToken: deck.settings.security.requireToken,
            pinConfigured: Boolean(deck.settings.security.pin),
            pinLength: deck.settings.security.pin ? String(deck.settings.security.pin).length : 0,
            dryRun: deck.settings.security.dryRun,
            allowExec: deck.settings.security.allowExec,
            allowUrlSchemes: deck.settings.security.allowUrlSchemes
          }
        }
      });
    },

    [`POST ${ENDPOINTS.settings}`]: async (req, res) => {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      const result = host.updateSettings(body);
      if (!result.ok) {
        sendError(res, 400, ERROR_CODES.badRequest, result.message);
        return;
      }
      sendJson(res, 200, { ok: true, changed: result.changed });
    },

    [`GET ${ENDPOINTS.audit}`]: (req, res, url) => {
      if (!requireAuth(req, res)) return;
      const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit')) || 100));
      sendJson(res, 200, {
        ok: true,
        enabled: host.audit.enabled,
        file: host.audit.file,
        entries: host.audit.tail({ limit, event: url.searchParams.get('event') ?? undefined })
      });
    },

    // ---------------- dispositivi accoppiati ----------------

    [`GET ${ENDPOINTS.devices}`]: (req, res) => {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, {
        ok: true,
        devices: auth.listDevices(),
        deviceTokenDays: auth.deviceTokenDays,
        // Il chiamante deve sapere se sta usando il token principale o quello
        // di un dispositivo: revocare il proprio si puo', ma va detto prima.
        current: auth.verifyRequest(req).device?.id ?? null
      });
    },

    [`POST ${ENDPOINTS.devices}`]: async (req, res) => {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      if (body.days !== undefined && body.days !== null
        && (!Number.isInteger(body.days) || body.days < 1 || body.days > 3650)) {
        sendError(res, 400, ERROR_CODES.badRequest, 'parametro "days" non valido: intero fra 1 e 3650, oppure null');
        return;
      }
      const created = auth.createDevice({ name: body.name, days: body.days });
      host.audit.write('device-created', { device: created.id, name: created.name, address: addressOf(req) });
      host.logger.info?.(`[wdeck] nuovo dispositivo "${created.name}" (${created.id})`);
      // Il token si vede una volta sola: dopo, di lui resta solo l'impronta.
      sendJson(res, 200, { ok: true, device: created });
    },

    [`DELETE ${ENDPOINTS.devices}`]: (req, res, url) => {
      if (!requireAuth(req, res)) return;
      const id = url.searchParams.get('id');
      if (!auth.revokeDevice(id)) {
        sendError(res, 404, ERROR_CODES.notFound, `dispositivo sconosciuto: "${id}"`);
        return;
      }
      host.audit.write('device-revoked', { device: id, address: addressOf(req) });
      host.logger.info?.(`[wdeck] dispositivo revocato: ${id}`);
      host.hub?.disconnectRevoked?.();
      sendJson(res, 200, { ok: true, revoked: id, devices: auth.listDevices() });
    },

    [`POST ${ENDPOINTS.tokenRotate}`]: async (req, res) => {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req);
      const revokeDevices = body.revokeDevices === true;
      const next = auth.rotate({ revokeDevices });
      host.audit.write('token-rotated', { revokeDevices, address: addressOf(req) });
      host.logger.warn?.(`[wdeck] token principale rigenerato${revokeDevices ? ' e dispositivi revocati' : ''}`);
      host.hub?.disconnectRevoked?.();
      // Il nuovo token viaggia una volta sola, in risposta a chi lo ha chiesto.
      sendJson(res, 200, { ok: true, token: next, revokedDevices: revokeDevices });
    },

    // ---------------- icone personalizzate ----------------

    [`GET ${ENDPOINTS.icons}`]: (req, res) => {
      if (!requireAuth(req, res)) return;
      const deck = configStore.get();
      sendJson(res, 200, {
        ok: true,
        icons: host.icons.list().map((icon) => ({
          ...icon,
          usedBy: host.icons.usedBy(deck, icon.name)
        })),
        limits: { maxBytes: MAX_ICON_BYTES_PER_FILE, maxCount: MAX_ICON_COUNT, formats: ICON_FORMATS }
      });
    },

    [`POST ${ENDPOINTS.icons}`]: async (req, res) => {
      if (!requireAuth(req, res)) return;
      const body = await readJsonBody(req, { limit: MAX_ICON_BODY });
      try {
        const saved = host.icons.save({ name: body.name, content: body.content });
        sendJson(res, 200, { ok: true, icon: saved });
      } catch (err) {
        sendError(res, 400, ERROR_CODES.badRequest, err.message);
      }
    },

    [`DELETE ${ENDPOINTS.icons}`]: (req, res, url) => {
      if (!requireAuth(req, res)) return;
      const name = url.searchParams.get('name');
      const usedBy = host.icons.usedBy(configStore.get(), name);
      if (usedBy.length > 0 && url.searchParams.get('force') !== '1') {
        sendJson(res, 409, {
          ok: false,
          error: {
            code: ERROR_CODES.badRequest,
            message: `l'icona "${name}" e' usata da ${usedBy.length} controllo/i: ripeti con force=1 per eliminarla comunque`
          },
          usedBy
        });
        return;
      }
      if (!host.icons.remove(name)) {
        sendError(res, 404, ERROR_CODES.notFound, `icona sconosciuta: "${name}"`);
        return;
      }
      sendJson(res, 200, { ok: true, removed: name, usedBy });
    },

    [`GET ${ENDPOINTS.iconFile}`]: (req, res, url) => {
      if (!requireAuth(req, res)) return;
      const icon = host.icons.read(url.searchParams.get('name'));
      if (!icon) {
        sendError(res, 404, ERROR_CODES.notFound, 'icona non trovata');
        return;
      }
      res.writeHead(200, {
        'Content-Type': icon.contentType,
        'Content-Length': icon.buffer.length,
        // Un'icona caricata dall'utente puo' essere sostituita in qualunque
        // momento con lo stesso nome: la cache va rivalidata.
        'Cache-Control': 'no-cache',
        // Difesa in profondita' sugli SVG, che sono gia' ripuliti al caricamento.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(icon.buffer);
    },

    [`GET ${ENDPOINTS.update}`]: async (req, res, url) => {
      if (!requireAuth(req, res)) return;
      const status = url.searchParams.get('check') === '1'
        ? await host.updates.check({ force: true })
        : host.updates.status;
      sendJson(res, 200, { ok: true, update: status });
    },

    [`POST ${ENDPOINTS.press}`]: async (req, res) => {
      if (!requireAuth(req, res)) return;
      if (!allow(res, host.limits.checkPress({ address: addressOf(req) }), 'comandi')) return;
      const body = await readJsonBody(req);
      const chi = auth.verifyRequest(req);
      const result = await dispatcher.press({
        buttonId: body.buttonId,
        profileId: body.profileId,
        pageId: body.pageId,
        hold: body.hold === true,
        value: body.value,
        // il client puo' solo rendere l'esecuzione piu' prudente, mai meno
        dryRun: state.dryRun || body.dryRun === true,
        source: 'rest',
        deviceId: chi.device?.id ?? null,
        address: addressOf(req)
      });
      sendJson(res, result.ok ? 200 : statusForError(result.error), { ok: result.ok, result });
    },

    [`POST ${ENDPOINTS.reload}`]: (req, res) => {
      if (!requireAuth(req, res)) return;
      const result = host.reload();
      if (!result.ok) {
        sendError(res, 400, ERROR_CODES.badRequest, result.error.message);
        return;
      }
      sendJson(res, 200, { ok: true, deck: publicDeck(result.deck), state: state.snapshot() });
    },

    // ---------------- protocollo lite (ESP32) ----------------

    [`GET ${ENDPOINTS.liteDeck}`]: (req, res, url) => {
      if (!requireAuth(req, res)) return;
      const deck = configStore.get();
      const profileId = url.searchParams.get('profile') ?? state.activeProfileId;
      const profile = deck.profiles.find((p) => p.id === profileId);
      if (!profile) {
        sendError(res, 404, ERROR_CODES.notFound, `profilo sconosciuto: "${profileId}"`);
        return;
      }
      const pageId = url.searchParams.get('page') ?? (profileId === state.activeProfileId ? state.activePageId : profile.defaultPage);
      const page = profile.pages.find((p) => p.id === pageId);
      if (!page) {
        sendError(res, 404, ERROR_CODES.notFound, `pagina sconosciuta: "${pageId}"`);
        return;
      }
      sendJson(res, 200, toLitePage(page, {
        profileId: profile.id,
        dryRun: state.dryRun,
        pages: profile.pages.map((p) => p.id)
      }));
    },

    [`GET ${ENDPOINTS.liteState}`]: (req, res) => {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, liteState(state));
    },

    [`POST ${ENDPOINTS.litePress}`]: async (req, res) => {
      if (!requireAuth(req, res)) return;
      if (!allow(res, host.limits.checkPress({ address: addressOf(req) }), 'comandi')) return;
      const body = await readJsonBody(req);
      const buttonId = body[LITE_FIELDS.id];
      const result = await dispatcher.press({
        buttonId,
        dryRun: state.dryRun,
        source: 'lite-rest',
        deviceId: auth.verifyRequest(req).device?.id ?? null,
        address: addressOf(req)
      });
      sendJson(res, result.ok ? 200 : statusForError(result.error), {
        [LITE_FIELDS.version]: LITE_PROTOCOL_VERSION,
        [LITE_FIELDS.id]: buttonId ?? null,
        [LITE_FIELDS.ok]: result.ok ? 1 : 0,
        [LITE_FIELDS.message]: result.ok ? (result.detail ?? '') : (result.error?.message ?? ''),
        [LITE_FIELDS.dryRun]: result.dryRun ? 1 : 0
      });
    }
  };

  /** Stato compatto per i dispositivi lite. */
  function liteState(s) {
    return {
      [LITE_FIELDS.version]: LITE_PROTOCOL_VERSION,
      [LITE_FIELDS.profile]: s.activeProfileId,
      [LITE_FIELDS.page]: s.activePageId,
      [LITE_FIELDS.dryRun]: s.dryRun ? 1 : 0,
      [LITE_FIELDS.timestamp]: Date.now()
    };
  }

  function statusForError(error) {
    switch (error?.code) {
      case ERROR_CODES.notFound: return 404;
      case ERROR_CODES.badRequest: return 400;
      case ERROR_CODES.forbidden: return 403;
      case ERROR_CODES.unauthorized: return 401;
      case ERROR_CODES.unsupportedAction: return 501;
      default: return 500;
    }
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @returns {Promise<boolean>} true se la richiesta e' stata gestita
   */
  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;

    const key = `${req.method} ${url.pathname}`;
    const route = routes[key];
    if (!route) {
      const methodMismatch = Object.keys(routes).some((k) => k.endsWith(` ${url.pathname}`));
      if (methodMismatch) sendError(res, 405, ERROR_CODES.badRequest, `metodo non ammesso per ${url.pathname}`);
      else sendError(res, 404, ERROR_CODES.notFound, `endpoint sconosciuto: ${url.pathname}`);
      return true;
    }

    try {
      await route(req, res, url);
    } catch (err) {
      host.logger.error?.(`[wdeck] errore API ${key}: ${err.message}`);
      if (!res.headersSent) {
        sendError(res, err.status ?? 500, ERROR_CODES.internal, err.message);
      }
    }
    return true;
  };
}

export { MAX_BODY };
