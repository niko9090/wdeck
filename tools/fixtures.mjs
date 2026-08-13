/**
 * Fixture condivise dalla suite di test.
 * (Fuori da test/ perche' il test runner di Node considera come test
 * qualunque file dentro una directory chiamata "test".)
 */

import { validateDeck, normalizeDeck } from '../src/host/config/schema.mjs';
import { createDefaultRegistry } from '../src/host/actions/handlers/index.mjs';
import { createState } from '../src/host/state.mjs';
import { createDispatcher } from '../src/host/actions/dispatcher.mjs';

/** Deck minimo ma valido, usato come base dei test. */
export function rawDeck(overrides = {}) {
  return {
    version: 1,
    name: 'Deck di test',
    defaultProfile: 'main',
    settings: {
      server: { host: '127.0.0.1', port: 8900 },
      security: {
        requireToken: true,
        token: 'token-di-test-123456',
        pin: '1234',
        dryRun: true,
        allowUrlSchemes: ['https'],
        allowedExtensions: ['.exe', '.ps1'],
        allowExec: ['C:\\Windows\\System32\\notepad.exe', 'scripts/examples/*'],
        maxSequenceSteps: 8
      }
    },
    profiles: [
      {
        id: 'main',
        name: 'Principale',
        defaultPage: 'home',
        pages: [
          {
            id: 'home',
            name: 'Home',
            rows: 2,
            cols: 3,
            buttons: [
              { id: 'play', label: 'Play', row: 0, col: 0, action: { type: 'media', params: { key: 'playpause' } } },
              { id: 'copy', label: 'Copia', row: 0, col: 1, action: { type: 'hotkey', params: { keys: 'ctrl+c' } } },
              { id: 'saluto', label: 'Testo', row: 0, col: 2, action: { type: 'text', params: { text: 'ciao' } } },
              { id: 'notepad', label: 'Notepad', row: 1, col: 0, action: { type: 'launch', params: { path: 'C:\\Windows\\System32\\notepad.exe' } } },
              { id: 'vietato', label: 'Vietato', row: 1, col: 1, action: { type: 'launch', params: { path: 'C:\\Windows\\System32\\cmd.exe' } } },
              { id: 'vai', label: 'Vai', row: 1, col: 2, action: { type: 'navigate', params: { page: 'due' } } }
            ]
          },
          {
            id: 'due',
            name: 'Seconda',
            rows: 1,
            cols: 2,
            buttons: [
              {
                id: 'combo',
                label: 'Combo',
                row: 0,
                col: 0,
                action: {
                  type: 'sequence',
                  params: {
                    steps: [
                      { type: 'media', params: { key: 'next' } },
                      { type: 'delay', params: { ms: 5 } }
                    ]
                  }
                }
              },
              { id: 'indietro', label: 'Indietro', row: 0, col: 1, action: { type: 'navigate', params: { page: 'home' } } }
            ]
          }
        ]
      }
    ],
    ...overrides
  };
}

/**
 * Deck normalizzato pronto all'uso.
 * @param {object} [overrides] porzioni di deck da sostituire
 * @param {{actionTypes?: string[]}} [options] tipi ammessi (per i test con handler finti)
 */
export function makeDeck(overrides, options = {}) {
  const raw = rawDeck(overrides);
  const result = validateDeck(raw, { actionTypes: options.actionTypes ?? createDefaultRegistry().types() });
  if (!result.valid) {
    throw new Error(`fixture non valida: ${JSON.stringify(result.errors)}`);
  }
  return normalizeDeck(raw);
}

/** Crea registry + state + dispatcher su un deck di test. */
export function makeDispatcher(options = {}) {
  const deck = options.deck ?? makeDeck();
  const registry = options.registry ?? createDefaultRegistry();
  const state = createState(deck);
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const dispatcher = createDispatcher({
    registry,
    state,
    getDeck: () => deck,
    baseDir: options.baseDir ?? process.cwd(),
    logger
  });
  return { deck, registry, state, dispatcher, logger };
}
