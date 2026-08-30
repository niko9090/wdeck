/**
 * Dispatcher: risolve il bottone premuto, valida i parametri dell'azione,
 * applica la modalita' dry-run e invoca l'handler registrato.
 */

import { ERROR_CODES } from '../../../shared/protocol.mjs';
import { READONLY_KINDS } from '../config/schema.mjs';

/**
 * Cerca un bottone nel deck.
 * @param {object} deck deck normalizzato
 * @param {{buttonId: string, profileId?: string, pageId?: string}} query
 * @returns {{button: object, profile: object, page: object}|null}
 */
export function findButton(deck, { buttonId, profileId, pageId }) {
  for (const profile of deck.profiles) {
    if (profileId && profile.id !== profileId) continue;
    for (const page of profile.pages) {
      if (pageId && page.id !== pageId) continue;
      const button = page.buttons.find((b) => b.id === buttonId);
      if (button) return { button, profile, page };
    }
  }
  return null;
}

const errorPayload = (err) => ({
  code: err?.code && typeof err.code === 'string' ? err.code : ERROR_CODES.actionFailed,
  message: err?.message ? String(err.message) : 'errore sconosciuto'
});

/**
 * Tetto alla profondita' di re-entry in execute(): una sequence che rientra
 * in execute, o un handler che chiama ctx.execute a catena, non deve poter
 * ricorrere all'infinito. Il guard e' centrale nel dispatcher, cosi' vale per
 * qualunque via di rientro, non solo per il controllo di tipo delle sequence.
 */
const MAX_EXECUTE_DEPTH = 20;

/**
 * @param {{
 *   registry: import('./registry.mjs').ActionRegistry,
 *   state: import('../state.mjs').HostState,
 *   getDeck: () => object,
 *   baseDir: string,
 *   logger?: {info: Function, warn: Function, error: Function, debug?: Function}
 * }} deps
 */
export function createDispatcher({ registry, state, getDeck, baseDir, logger = console }) {
  /**
   * Esegue una singola azione (usata anche dai passi di una sequence).
   * @param {{type: string, params?: object}} action
   * @param {object} [overrides] campi di contesto da sovrascrivere
   */
  async function execute(action, overrides = {}) {
    const deck = getDeck();
    const dryRun = overrides.dryRun ?? state.dryRun;
    const depth = overrides.depth ?? 0;
    const started = Date.now();

    if (depth > MAX_EXECUTE_DEPTH) {
      return {
        ok: false,
        type: typeof action?.type === 'string' ? action.type : null,
        dryRun,
        error: {
          code: ERROR_CODES.badRequest,
          message: `profondita' massima di esecuzione superata (${MAX_EXECUTE_DEPTH}): possibile ricorsione`
        },
        durationMs: 0
      };
    }

    if (typeof action !== 'object' || action === null || typeof action.type !== 'string') {
      return {
        ok: false,
        type: null,
        dryRun,
        error: { code: ERROR_CODES.badRequest, message: 'azione non valida: atteso oggetto con "type"' },
        durationMs: 0
      };
    }

    let handler;
    try {
      handler = registry.get(action.type);
    } catch (err) {
      return {
        ok: false,
        type: action.type,
        dryRun,
        error: { code: ERROR_CODES.unsupportedAction, message: err.message },
        durationMs: 0
      };
    }

    const params = action.params ?? {};
    const ctx = {
      dryRun,
      baseDir,
      security: deck.settings?.security,
      deck,
      state,
      logger,
      source: overrides.source ?? 'internal',
      execute: (step, inner = {}) => execute(step, { ...overrides, ...inner, dryRun, depth: depth + 1 }),
      ...overrides
    };
    ctx.dryRun = dryRun;

    let description = action.type;
    try {
      handler.validate(params);
      description = handler.describe(params);
    } catch (err) {
      return {
        ok: false,
        type: action.type,
        description,
        dryRun,
        error: { code: ERROR_CODES.badRequest, message: err.message },
        durationMs: Date.now() - started
      };
    }

    if (!dryRun && !registry.supportsPlatform(action.type)) {
      return {
        ok: false,
        type: action.type,
        description,
        dryRun,
        error: {
          code: ERROR_CODES.unsupportedAction,
          message: `l'azione "${action.type}" e' supportata solo su ${handler.platforms.join(', ')} `
            + `(piattaforma corrente: ${process.platform}). Usare la modalita' dry-run per provarla.`
        },
        durationMs: Date.now() - started
      };
    }

    try {
      const result = await handler.run(params, ctx);
      return {
        ok: result?.ok !== false,
        type: action.type,
        description,
        dryRun,
        detail: result?.detail ?? null,
        result: result ?? null,
        error: result?.ok === false ? (result.error ?? { code: ERROR_CODES.actionFailed, message: result.detail ?? 'azione fallita' }) : null,
        durationMs: Date.now() - started
      };
    } catch (err) {
      logger.warn?.(`[wdeck] azione "${action.type}" fallita: ${err.message}`);
      return {
        ok: false,
        type: action.type,
        description,
        dryRun,
        error: errorPayload(err),
        durationMs: Date.now() - started
      };
    }
  }

  /**
   * Gestisce la pressione di un bottone (o il trascinamento di uno slider).
   * @param {{buttonId: string, profileId?: string, pageId?: string, source?: string, dryRun?: boolean, hold?: boolean, value?: number, deviceId?: string|null, address?: string|null}} req
   */
  async function press(req) {
    const deck = getDeck();
    const buttonId = req?.buttonId;
    if (typeof buttonId !== 'string' || buttonId === '') {
      return { ok: false, buttonId: null, error: { code: ERROR_CODES.badRequest, message: 'campo "buttonId" mancante' } };
    }

    const found = findButton(deck, {
      buttonId,
      profileId: req.profileId,
      pageId: req.pageId
    });
    if (!found) {
      return {
        ok: false,
        buttonId,
        error: { code: ERROR_CODES.notFound, message: `bottone non trovato: "${buttonId}"` }
      };
    }

    // Tre azioni possibili sullo stesso bottone: hold (dopo la soglia),
    // release (al rilascio, per i bottoni momentanei) e quella normale.
    // Un quadrante, un livello, un grafico o un display non si premono: mostrano
    // lo stato che l'host gia' pubblica. Eseguire l'azione qui sarebbe un
    // effetto invisibile e inatteso, quindi si rifiuta con un motivo chiaro.
    if (READONLY_KINDS.includes(found.button.kind)) {
      return {
        ok: false,
        buttonId,
        error: {
          code: ERROR_CODES.badRequest,
          message: `il comando "${buttonId}" e' di sola lettura (${found.button.kind}): non accetta pressioni`
        }
      };
    }

    let action = found.button.action;
    if (req.hold && found.button.holdAction) action = found.button.holdAction;
    else if (req.release && found.button.releaseAction) action = found.button.releaseAction;

    // Uno slider manda il valore trascinato: diventa un parametro dell'azione,
    // cosi' gli handler non devono sapere nulla del trasporto.
    if (req.value !== undefined) {
      const value = Number(req.value);
      if (!Number.isFinite(value)) {
        return {
          ok: false,
          buttonId,
          error: { code: ERROR_CODES.badRequest, message: `campo "value" non numerico: ${req.value}` }
        };
      }
      action = { ...action, params: { ...(action.params ?? {}), value } };
    }

    // Una manopola o una rotella non hanno una posizione: mandano uno SCARTO.
    // L'handler riceve `delta` e decide se sommarlo a uno stato suo o
    // trasformarlo in un comando ripetuto.
    if (req.delta !== undefined) {
      const delta = Number(req.delta);
      if (!Number.isFinite(delta)) {
        return {
          ok: false,
          buttonId,
          error: { code: ERROR_CODES.badRequest, message: `campo "delta" non numerico: ${req.delta}` }
        };
      }
      action = { ...action, params: { ...(action.params ?? {}), delta } };
    }

    // La tavoletta a due assi manda la coppia in un messaggio solo: due
    // messaggi separati darebbero uno stato intermedio che non e' mai esistito.
    if (req.x !== undefined || req.y !== undefined) {
      const x = Number(req.x);
      const y = Number(req.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return {
          ok: false,
          buttonId,
          error: { code: ERROR_CODES.badRequest, message: 'la tavoletta vuole "x" e "y" numerici insieme' }
        };
      }
      action = { ...action, params: { ...(action.params ?? {}), x, y } };
    }

    const outcome = await execute(action, {
      source: req.source ?? 'api',
      dryRun: req.dryRun ?? state.dryRun,
      button: found.button
    });

    const entry = {
      ok: outcome.ok,
      buttonId,
      profileId: found.profile.id,
      pageId: found.page.id,
      label: found.button.label,
      type: outcome.type,
      description: outcome.description,
      dryRun: outcome.dryRun,
      detail: outcome.detail,
      result: outcome.result ?? null,
      error: outcome.error,
      durationMs: outcome.durationMs,
      source: req.source ?? 'api',
      // Chi ha premuto: serve al registro di audit, che senza un "chi" non
      // risponderebbe alla domanda per cui esiste.
      deviceId: req.deviceId ?? null,
      address: req.address ?? null
    };
    state.recordPress(entry);
    return entry;
  }

  return { execute, press, findButton: (q) => findButton(getDeck(), q) };
}
