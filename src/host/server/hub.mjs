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
  toLitePage,
  toLiteStates
} from '../../../shared/protocol.mjs';
import { publicDeck } from './api.mjs';
import { normalizeAddress } from '../security/ratelimit.mjs';
import { extractToken } from '../security/auth.mjs';

const AUTH_TIMEOUT_MS = 8000;
const MAX_MESSAGE_BYTES = 64 * 1024;

/**
 * @param {object} host istanza creata da createHost()
 */
export function createHub(host) {
  const { auth, state, dispatcher, configStore, logger } = host;
  const statusSnapshot = () => host.status?.snapshot() ?? {};

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

  /**
   * Stato dei bottoni nella forma lite: id -> 0/1, nient'altro.
   * Un ESP32 non ha spazio per livelli ed etichette, ma puo' disegnare
   * diversamente un bottone acceso.
   */
  const liteStatusPayload = () => ({
    [F.type]: LITE_MSG.status,
    [F.version]: LITE_PROTOCOL_VERSION,
    [F.states]: toLiteStates(statusSnapshot())
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
    // Il limite e' in byte: `text.length` conta unita' UTF-16, quindi un
    // messaggio con caratteri multibyte poteva superare il tetto reale.
    if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) throw new Error('messaggio troppo grande');
    return JSON.parse(text);
  }

  // ------------------------------------------------------------------
  // client "full" (PWA)
  // ------------------------------------------------------------------
  function handleFull(conn, req) {
    fullClients.add(conn);
    conn.data.authenticated = false;
    conn.data.address = normalizeAddress(req.socket?.remoteAddress);
    // Il token usato resta sulla connessione per poterlo rivalutare quando un
    // dispositivo viene revocato: senza, una revoca non scollegherebbe nessuno.
    conn.data.token = extractToken(req);

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
      conn.send({ type: MSG.status, states: statusSnapshot() });
      // Anche lo stato degli aggiornamenti viaggia subito. Un client rimasto
      // aperto mentre l'host si aggiornava ha ancora in memoria la proposta di
      // una versione che ormai sta girando: il banner "disponibile" resterebbe
      // finche' qualcuno non gli dice che non c'e' piu' niente da installare.
      // Dirglielo al ricollegamento vale anche per i client vecchi in cache,
      // che questo evento lo capiscono da sempre.
      const aggiornamenti = host.updates?.status;
      if (aggiornamenti) conn.send({ type: MSG.event, event: 'update', data: aggiornamenti });
      // Il primo client collegato trova la cache vuota: una lettura subito, cosi'
      // i bottoni a due stati partono gia' con l'aspetto giusto.
      host.status?.refresh({ force: true }).catch(() => {});
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
        // Su un canale aperto si potrebbero provare token a raffica senza mai
        // riaprire la connessione: il limite vale anche qui.
        const attempt = host.limits.checkAuth({ address: conn.data.address });
        if (!attempt.allowed) {
          conn.send({
            type: MSG.error,
            code: ERROR_CODES.rateLimited,
            message: `troppi tentativi di accesso: riprova fra ${Math.max(1, Math.ceil(attempt.retryAfterMs / 1000))} secondi`
          });
          conn.close(1008, 'troppi tentativi');
          return;
        }
        const identity = auth.identify(msg.token);
        if (!identity.ok) {
          conn.send({ type: MSG.error, code: ERROR_CODES.unauthorized, message: identity.reason ?? 'token non valido' });
          conn.close(1008, 'token non valido');
          return;
        }
        conn.data.token = msg.token;
        conn.data.deviceId = identity.device?.id ?? null;
        host.limits.clearAuth({ address: conn.data.address });
        completeAuth();
        return;
      }

      switch (msg.type) {
        case MSG.ping:
          conn.send({ type: MSG.pong, requestId: msg.requestId ?? null, ts: Date.now() });
          break;

        case MSG.press: {
          const limit = host.limits.checkPress({ address: conn.data.address });
          if (!limit.allowed) {
            conn.send({
              type: MSG.error,
              code: ERROR_CODES.rateLimited,
              message: `troppi comandi: riprova fra ${Math.max(1, Math.ceil(limit.retryAfterMs / 1000))} secondi`,
              requestId: msg.requestId ?? null
            });
            break;
          }
          // Come per il caso navigate: un rifiuto della dispatch non deve
          // diventare una unhandledRejection capace di far cadere il processo.
          try {
            const result = await dispatcher.press({
              buttonId: msg.buttonId,
              profileId: msg.profileId,
              pageId: msg.pageId,
              hold: msg.hold === true,
              release: msg.release === true,
              delta: msg.delta,
              x: msg.x,
              y: msg.y,
              value: msg.value,
              dryRun: state.dryRun || msg.dryRun === true,
              source: 'ws',
              deviceId: conn.data.deviceId ?? null,
              address: conn.data.address
            });
            conn.send({ type: MSG.ack, requestId: msg.requestId ?? null, ok: result.ok, result });
          } catch (err) {
            conn.send({ type: MSG.error, code: ERROR_CODES.internal, message: err.message, requestId: msg.requestId ?? null });
          }
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
  function handleLite(conn, req) {
    liteClients.add(conn);
    conn.data.authenticated = true;
    conn.data.address = normalizeAddress(req?.socket?.remoteAddress);
    conn.data.token = extractToken(req ?? {});
    state.addClient(conn);

    conn.send({
      [F.type]: LITE_MSG.hello,
      [F.version]: LITE_PROTOCOL_VERSION,
      [F.profile]: state.activeProfileId,
      [F.page]: state.activePageId,
      [F.dryRun]: state.dryRun ? 1 : 0
    });
    conn.send(liteStatePayload());
    conn.send(liteStatusPayload());
    host.status?.refresh({ force: true }).catch(() => {});

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
          const limit = host.limits.checkPress({ address: conn.data.address });
          if (!limit.allowed) {
            conn.send({ [F.type]: LITE_MSG.error, [F.error]: ERROR_CODES.rateLimited, [F.message]: 'troppi comandi' });
            break;
          }
          // Anche qui: un throw della dispatch va intercettato, altrimenti
          // diventa una unhandledRejection che puo' abbattere il processo.
          try {
            const result = await dispatcher.press({
              buttonId: msg[F.id],
              dryRun: state.dryRun,
              source: 'lite-ws',
              deviceId: conn.data.deviceId ?? null,
              address: conn.data.address
            });
            conn.send({
              [F.type]: LITE_MSG.ack,
              [F.id]: msg[F.id] ?? null,
              [F.ok]: result.ok ? 1 : 0,
              [F.message]: (result.ok ? (result.detail ?? '') : (result.error?.message ?? '')).slice(0, 120)
            });
          } catch (err) {
            conn.send({ [F.type]: LITE_MSG.error, [F.message]: (err.message ?? 'errore').slice(0, 120) });
          }
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

    /** Rimanda a tutti i client il deck aggiornato (usato dopo un salvataggio). */
    broadcastDeck() {
      broadcastFull({ type: MSG.deck, deck: publicDeck(configStore.get()), state: state.snapshot() });
      broadcastLite(liteStatePayload());
    },

    /**
     * Rimanda a tutti i client lo stato reale dei controlli.
     * @param {Record<string, object>} snapshot stato completo
     * @param {Record<string, object|null>} [changes] sole voci cambiate
     */
    broadcastStatus(snapshot, changes) {
      broadcastFull({ type: MSG.status, states: snapshot, changed: changes ?? null });
      broadcastLite(liteStatusPayload());
    },

    /**
     * Scollega i client il cui token non e' piu' valido.
     *
     * Va chiamata dopo una revoca o una rotazione: senza, un dispositivo
     * revocato resterebbe collegato e capace di premere bottoni fino a quando
     * non chiude lui la connessione, che e' esattamente cio' che la revoca
     * dovrebbe impedire.
     * @returns {number} quanti client sono stati scollegati
     */
    disconnectRevoked() {
      let chiusi = 0;
      for (const conn of [...fullClients, ...liteClients]) {
        if (!conn.data.authenticated) continue;
        if (auth.identify(conn.data.token).ok) continue;
        conn.close(1008, 'credenziale revocata');
        chiusi += 1;
      }
      if (chiusi > 0) logger.warn?.(`[wdeck] ${chiusi} client scollegati: credenziale non piu' valida`);
      return chiusi;
    },

    /** Segnala a tutti i client che esiste una versione piu' recente. */
    broadcastUpdate(status) {
      broadcastFull({ type: MSG.event, event: 'update', data: status });
    },

    /**
     * Riferisce l'avanzamento di un aggiornamento in corso, fase per fase, cosi'
     * il client puo' mostrare una barra invece di un'attesa muta. Va ai soli
     * client "full": e' l'app da cui si e' chiesto l'aggiornamento a volerlo
     * vedere, non i telecomandi.
     * @param {{phase: string, done?: number, total?: number, version?: string}} avanzamento
     */
    broadcastUpdateProgress(avanzamento) {
      broadcastFull({ type: MSG.event, event: 'update-progress', data: avanzamento });
    },

    close() {
      for (const conn of [...fullClients, ...liteClients]) conn.close(1001, 'server in chiusura');
      fullClients.clear();
      liteClients.clear();
      logger.debug?.('[wdeck] hub WebSocket chiuso');
    }
  };
}
