/**
 * Hub WebSocket: gestisce i client "full" (PWA) e i client "lite" (ESP32),
 * l'autenticazione, il broadcast dello stato e l'inoltro delle pressioni.
 */

import {
  ENDPOINTS,
  ERROR_CODES,
  MSG,
  LITE_MSG,
  LITE_FIELDS,
  PROTOCOL_VERSION,
  LITE_PROTOCOL_VERSION,
  toLitePage
} from '../../../shared/protocol.mjs';
import { publicDeck } from './api.mjs';

const AUTH_TIMEOUT_MS = 8000;
const MAX_MESSAGE_BYTES = 64 * 1024;

/**
 * @param {object} host istanza creata da createHost()
 */
export function createHub(host) {
  const { auth, state, dispatcher, configStore, logger } = host;

  /** @type {Set<import('../ws/connection.mjs').WebSocketConnection>} */
  const fullClients = new Set();
  /** @type {Set<import('../ws/connection.mjs').WebSocketConnection>} */
  const liteClients = new Set();

  const F = LITE_FIELDS;

  const liteStatePayload = () => ({
    [F.type]: LITE_MSG.state,
    [F.version]: LITE_PROTOCOL_VERSION,
    [F.profile]: state.activeProfileId,
    [F.page]: state.activePageId,
    [F.dryRun]: state.dryRun ? 1 : 0,
    [F.timestamp]: Date.now()
  });

  function broadcastFull(message) {
    const text = JSON.stringify(message);
    for (const conn of fullClients) {
      if (conn.data.authenticated) conn.send(text);
    }
  }

  function broadcastLite(message) {
    const text = JSON.stringify(message);
    for (const conn of liteClients) conn.send(text);
  }

  // ---- eventi di stato -> broadcast ----
  state.on('state', (snapshot) => {
    broadcastFull({ type: MSG.state, state: snapshot });
    broadcastLite(liteStatePayload());
  });
  state.on('press', (entry) => {
    broadcastFull({ type: MSG.event, event: 'press', data: entry });
  });
  state.on('navigate', (snapshot) => {
    broadcastFull({ type: MSG.navigate, activeProfile: snapshot.activeProfile, activePage: snapshot.activePage });
    broadcastLite({
      [F.type]: LITE_MSG.navigate,
      [F.profile]: state.activeProfileId,
      [F.page]: state.activePageId
    });
  });
  state.on('deck', (deck) => {
    broadcastFull({ type: MSG.deck, deck: publicDeck(deck), state: state.snapshot() });
    broadcastLite(liteStatePayload());
  });

  function parseMessage(raw) {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    if (text.length > MAX_MESSAGE_BYTES) throw new Error('messaggio troppo grande');
    return JSON.parse(text);
  }

  // ------------------------------------------------------------------
  // client "full" (PWA)
  // ------------------------------------------------------------------
  function handleFull(conn, req) {
    fullClients.add(conn);
    conn.data.authenticated = false;

    const { ok: preAuthenticated } = auth.verifyRequest(req);

    conn.send({
      type: MSG.hello,
      protocol: PROTOCOL_VERSION,
      name: configStore.get().settings.server.publicName,
      requiresToken: auth.required,
      authenticated: preAuthenticated
    });

    const authTimer = setTimeout(() => {
      if (!conn.data.authenticated) conn.close(1008, 'autenticazione non completata');
    }, AUTH_TIMEOUT_MS);
    if (typeof authTimer.unref === 'function') authTimer.unref();

    function completeAuth() {
      conn.data.authenticated = true;
      clearTimeout(authTimer);
      state.addClient(conn);
      conn.send({ type: MSG.authOk, protocol: PROTOCOL_VERSION });
      conn.send({ type: MSG.deck, deck: publicDeck(configStore.get()), state: state.snapshot() });
      conn.send({ type: MSG.state, state: state.snapshot() });
    }

    if (preAuthenticated) completeAuth();

    conn.on('message', async (raw) => {
      let msg;
      try {
        msg = parseMessage(raw);
      } catch (err) {
        conn.send({ type: MSG.error, code: ERROR_CODES.badRequest, message: `messaggio non valido: ${err.message}` });
        return;
      }

      if (!conn.data.authenticated) {
        if (msg.type !== MSG.auth) {
          conn.send({ type: MSG.error, code: ERROR_CODES.unauthorized, message: 'autenticazione richiesta' });
          return;
        }
        if (!auth.verify(msg.token)) {
          conn.send({ type: MSG.error, code: ERROR_CODES.unauthorized, message: 'token non valido' });
          conn.close(1008, 'token non valido');
          return;
        }
        completeAuth();
        return;
      }

      switch (msg.type) {
        case MSG.ping:
          conn.send({ type: MSG.pong, requestId: msg.requestId ?? null, ts: Date.now() });
          break;

        case MSG.press: {
          const result = await dispatcher.press({
            buttonId: msg.buttonId,
            profileId: msg.profileId,
            pageId: msg.pageId,
            hold: msg.hold === true,
            dryRun: state.dryRun || msg.dryRun === true,
            source: 'ws'
          });
          conn.send({ type: MSG.ack, requestId: msg.requestId ?? null, ok: result.ok, result });
          break;
        }

        case MSG.navigate: {
          try {
            const applied = state.navigate(msg.profile, msg.page);
            conn.send({ type: MSG.ack, requestId: msg.requestId ?? null, ok: true, result: applied });
          } catch (err) {
            conn.send({ type: MSG.error, code: ERROR_CODES.badRequest, message: err.message, requestId: msg.requestId ?? null });
          }
          break;
        }

        case MSG.reload: {
          const result = host.reload();
          conn.send({
            type: MSG.ack,
            requestId: msg.requestId ?? null,
            ok: result.ok,
            result: result.ok ? { reloaded: true } : { error: result.error.message }
          });
          break;
        }

        case MSG.auth:
          conn.send({ type: MSG.authOk, protocol: PROTOCOL_VERSION });
          break;

        default:
          conn.send({ type: MSG.error, code: ERROR_CODES.badRequest, message: `tipo messaggio sconosciuto: "${msg.type}"` });
      }
    });

    conn.on('close', () => {
      clearTimeout(authTimer);
      fullClients.delete(conn);
      state.removeClient(conn);
    });
  }

  // ------------------------------------------------------------------
  // client "lite" (ESP32): token obbligatorio gia' nell'handshake
  // ------------------------------------------------------------------
  function handleLite(conn) {
    liteClients.add(conn);
    conn.data.authenticated = true;
    state.addClient(conn);

    conn.send({
      [F.type]: LITE_MSG.hello,
      [F.version]: LITE_PROTOCOL_VERSION,
      [F.profile]: state.activeProfileId,
      [F.page]: state.activePageId,
      [F.dryRun]: state.dryRun ? 1 : 0
    });
    conn.send(liteStatePayload());

    conn.on('message', async (raw) => {
      let msg;
      try {
        msg = parseMessage(raw);
      } catch {
        conn.send({ [F.type]: LITE_MSG.error, [F.message]: 'json' });
        return;
      }

      switch (msg[F.type]) {
        case LITE_MSG.ping:
          conn.send({ [F.type]: LITE_MSG.pong, [F.timestamp]: Date.now() });
          break;

        case LITE_MSG.press: {
          const result = await dispatcher.press({
            buttonId: msg[F.id],
            dryRun: state.dryRun,
            source: 'lite-ws'
          });
          conn.send({
            [F.type]: LITE_MSG.ack,
            [F.id]: msg[F.id] ?? null,
            [F.ok]: result.ok ? 1 : 0,
            [F.message]: (result.ok ? (result.detail ?? '') : (result.error?.message ?? '')).slice(0, 120)
          });
          break;
        }

        case LITE_MSG.navigate: {
          try {
            state.navigate(msg[F.profile], msg[F.page]);
            conn.send({ [F.type]: LITE_MSG.ack, [F.ok]: 1 });
          } catch (err) {
            conn.send({ [F.type]: LITE_MSG.error, [F.message]: err.message.slice(0, 120) });
          }
          break;
        }

        default:
          conn.send({ [F.type]: LITE_MSG.error, [F.message]: 'tipo sconosciuto' });
      }
    });

    conn.on('close', () => {
      liteClients.delete(conn);
      state.removeClient(conn);
    });
  }

  /**
   * Layout lite della pagina attiva (usato anche dal test di conformita').
   */
  function liteLayout(profileId = state.activeProfileId, pageId = state.activePageId) {
    const deck = configStore.get();
    const profile = deck.profiles.find((p) => p.id === profileId) ?? deck.profiles[0];
    const page = profile.pages.find((p) => p.id === pageId) ?? profile.pages[0];
    return toLitePage(page, { profileId: profile.id, dryRun: state.dryRun, pages: profile.pages.map((p) => p.id) });
  }

  return {
    routes: {
      [ENDPOINTS.ws]: handleFull,
      [ENDPOINTS.wsLite]: handleLite
    },
    /** Verifica del token in fase di upgrade: obbligatoria solo per il canale lite. */
    verifyUpgrade(req, pathname) {
      if (pathname === ENDPOINTS.wsLite) {
        const { ok } = auth.verifyRequest(req);
        if (!ok) return { ok: false, status: 401, message: 'token mancante o non valido' };
      }
      return { ok: true };
    },
    fullClients,
    liteClients,
    liteLayout,
    broadcastFull,
    broadcastLite,
    close() {
      for (const conn of [...fullClients, ...liteClients]) conn.close(1001, 'server in chiusura');
      fullClients.clear();
      liteClients.clear();
      logger.debug?.('[wdeck] hub WebSocket chiuso');
    }
  };
}
