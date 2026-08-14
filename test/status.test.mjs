/**
 * Stato reale dei controlli: normalizzazione, letture condivise, backoff,
 * eventi di variazione e forma lite del messaggio.
 *
 * Gli handler usati qui sono finti apposta: le letture vere passano da
 * PowerShell o da un servizio esterno, e un test non deve dipendere ne'
 * dall'uno ne' dall'altro.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStatusTracker, normalizeStatus, sameStatus, FAILURE_BACKOFF_MS } from '../src/host/status.mjs';
import { createRegistry } from '../src/host/actions/registry.mjs';
import { createState } from '../src/host/state.mjs';
import { toLiteStates } from '../shared/protocol.mjs';
import { makeDeck } from '../tools/fixtures.mjs';
import { obsStatusFrom } from '../src/host/actions/handlers/integrations.mjs';

/** Tipi ammessi nelle fixture di questo file: i due handler finti qui sotto. */
const TIPI = ['finto', 'noop'];

/** Deck con due bottoni che dichiarano uno stato e uno che non lo dichiara. */
function statusDeck({ status } = {}) {
  return makeDeck({
    profiles: [{
      id: 'main',
      name: 'Principale',
      defaultPage: 'home',
      pages: [{
        id: 'home',
        name: 'Home',
        rows: 1,
        cols: 3,
        buttons: [
          { id: 'muto', label: 'Muto', row: 0, col: 0, action: { type: 'finto', params: { canale: 'a' } }, ...(status === undefined ? {} : { status }) },
          { id: 'altro', label: 'Altro', row: 0, col: 1, action: { type: 'finto', params: { canale: 'b' } } },
          { id: 'senza', label: 'Senza', row: 0, col: 2, action: { type: 'noop', params: {} } }
        ]
      }]
    }]
  }, { actionTypes: TIPI });
}

/** Registro con un handler "finto" pilotabile dal test. */
function fakeRegistry(readState) {
  const registry = createRegistry();
  registry.register({
    type: 'finto',
    title: 'Finto',
    description: 'handler di prova',
    platforms: ['*'],
    async run() { return { ok: true }; },
    readState
  });
  registry.register({
    type: 'noop',
    title: 'Noop',
    description: 'senza stato',
    platforms: ['*'],
    async run() { return { ok: true }; }
  });
  return registry;
}

function makeTracker(readState, options = {}) {
  const deck = options.deck ?? statusDeck();
  const registry = fakeRegistry(readState);
  const state = createState(deck);
  state.dryRun = false;
  const tracker = createStatusTracker({
    registry,
    state,
    getDeck: () => (options.getDeck ? options.getDeck() : deck),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    ...options.tracker
  });
  return { tracker, state, deck, registry };
}

// ------------------------------------------------------------------ normalizzazione

test('status: normalizeStatus tiene solo i campi significativi', () => {
  assert.deepEqual(normalizeStatus({ on: true, level: 42.6, text: 'muto' }), { on: true, level: 43, text: 'muto' });
  assert.deepEqual(normalizeStatus({ on: false }), { on: false, level: null, text: null });
  assert.deepEqual(normalizeStatus({ level: 0 }), { on: null, level: 0, text: null });
});

test('status: normalizeStatus scarta cio\' che non e\' uno stato', () => {
  assert.equal(normalizeStatus(null), null);
  assert.equal(normalizeStatus(undefined), null);
  assert.equal(normalizeStatus('acceso'), null);
  assert.equal(normalizeStatus({}), null);
  assert.equal(normalizeStatus({ on: 'si' }), null, 'on non booleano non e\' uno stato');
});

test('status: normalizeStatus tronca le etichette lunghe', () => {
  const entry = normalizeStatus({ text: 'x'.repeat(200) });
  assert.equal(entry.text.length, 64);
});

test('status: sameStatus confronta anche l\'errore', () => {
  assert.equal(sameStatus({ on: true, level: 1, text: null }, { on: true, level: 1, text: null }), true);
  assert.equal(sameStatus({ on: true, level: 1, text: null }, { on: false, level: 1, text: null }), false);
  assert.equal(sameStatus({ on: null, error: 'x' }, { on: null, error: 'y' }), false);
});

// ------------------------------------------------------------------ selezione dei controlli

test('status: interroga solo i controlli della pagina attiva che dichiarano readState', async () => {
  const { tracker } = makeTracker(async () => ({ on: true }));
  const targets = tracker.targets().map((t) => t.buttonId);
  assert.deepEqual(targets.sort(), ['altro', 'muto'], 'noop non dichiara readState');
});

test('status: "status": false esclude il controllo dalle letture', async () => {
  const { tracker } = makeTracker(async () => ({ on: true }), { deck: statusDeck({ status: false }) });
  assert.deepEqual(tracker.targets().map((t) => t.buttonId), ['altro']);
});

test('status: in dry-run non viene letto nulla dal sistema', async () => {
  let letture = 0;
  const { tracker, state } = makeTracker(async () => { letture += 1; return { on: true }; });
  state.dryRun = true;
  const changes = await tracker.refresh();
  assert.deepEqual(changes, {});
  assert.equal(letture, 0, 'dry-run significa non toccare il sistema, nemmeno per leggere');
});

// ------------------------------------------------------------------ letture e variazioni

test('status: la prima lettura pubblica lo stato di ogni controllo', async () => {
  const { tracker } = makeTracker(async (params) => ({ on: params.canale === 'a' }));
  const changes = await tracker.refresh();
  assert.equal(changes.muto.on, true);
  assert.equal(changes.altro.on, false);
  assert.equal(tracker.snapshot().muto.on, true);
});

test('status: una lettura identica non produce alcuna variazione', async () => {
  const { tracker } = makeTracker(async () => ({ on: true }));
  await tracker.refresh();
  const seconda = await tracker.refresh({ force: true });
  assert.deepEqual(seconda, {}, 'nessun broadcast se nulla e\' cambiato');
});

test('status: emette "change" solo quando lo stato cambia davvero', async () => {
  let acceso = true;
  const { tracker } = makeTracker(async () => ({ on: acceso }));
  const eventi = [];
  tracker.on('change', (snapshot, changed) => eventi.push(changed));

  await tracker.refresh();
  await tracker.refresh({ force: true });
  acceso = false;
  await tracker.refresh({ force: true });

  assert.equal(eventi.length, 2, 'un evento per la prima lettura e uno per il cambio');
  assert.equal(eventi[1].muto.on, false);
});

test('status: ctx.cached mette in comune le letture identiche dello stesso giro', async () => {
  let letture = 0;
  const { tracker } = makeTracker(async (params, ctx) => {
    const value = await ctx.cached('audio', async () => { letture += 1; return 70; });
    return { level: value, on: params.canale === 'a' };
  });
  await tracker.refresh();
  assert.equal(letture, 1, 'due bottoni, una sola lettura del sistema');
  assert.equal(tracker.snapshot().altro.level, 70);
});

test('status: readState che restituisce null cancella lo stato precedente', async () => {
  let presente = true;
  const { tracker } = makeTracker(async () => (presente ? { on: true } : null));
  await tracker.refresh();
  presente = false;
  const changes = await tracker.refresh({ force: true });
  assert.equal(changes.muto, null);
  assert.equal(tracker.snapshot().muto, undefined);
});

// ------------------------------------------------------------------ errori e backoff

test('status: una lettura fallita diventa uno stato in errore, non un\'eccezione', async () => {
  const { tracker } = makeTracker(async () => { throw new Error('OBS non raggiungibile'); });
  const changes = await tracker.refresh();
  assert.match(changes.muto.error, /OBS non raggiungibile/);
  assert.equal(changes.muto.on, null);
});

test('status: dopo un errore la chiave resta in pausa', async () => {
  let letture = 0;
  let ora = 1000;
  const { tracker } = makeTracker(
    async () => { letture += 1; throw new Error('spento'); },
    { tracker: { now: () => ora } }
  );

  await tracker.refresh();
  assert.equal(letture, 2, 'primo giro: entrambi i controlli');

  await tracker.refresh();
  assert.equal(letture, 2, 'secondo giro: nessuna nuova lettura, sono in pausa');

  ora += FAILURE_BACKOFF_MS + 1;
  await tracker.refresh();
  assert.equal(letture, 4, 'scaduta la pausa si riprova');
});

test('status: prune dimentica i controlli spariti dalla configurazione', async () => {
  let deck = statusDeck();
  const { tracker } = makeTracker(async () => ({ on: true }), { deck, getDeck: () => deck });
  await tracker.refresh();
  assert.ok(tracker.snapshot().muto);

  deck = makeDeck({
    profiles: [{
      id: 'main',
      name: 'Principale',
      defaultPage: 'home',
      pages: [{ id: 'home', name: 'Home', rows: 1, cols: 1, buttons: [{ id: 'altro', label: 'Altro', row: 0, col: 0, action: { type: 'noop', params: {} } }] }]
    }]
  }, { actionTypes: TIPI });
  tracker.prune();
  assert.equal(tracker.snapshot().muto, undefined, 'il bottone rimosso sparisce dallo stato');
  assert.ok(tracker.snapshot().altro, 'il bottone rimasto conserva il proprio stato');
});

// ------------------------------------------------------------------ forma lite

test('status: toLiteStates riduce lo stato a id -> 0/1', () => {
  const lite = toLiteStates({
    muto: { on: true, level: 30, text: 'muto' },
    volume: { on: null, level: 42, text: null },
    rotto: { on: null, error: 'x' }
  });
  assert.deepEqual(lite, { muto: 1 });
});

test('status: toLiteStates regge una mappa vuota o assente', () => {
  assert.deepEqual(toLiteStates({}), {});
  assert.deepEqual(toLiteStates(undefined), {});
});

// ------------------------------------------------------------------ traduzione OBS

test('status: obsStatusFrom riconosce la scena in onda', () => {
  const data = { scene: { currentProgramSceneName: 'Gameplay' } };
  assert.deepEqual(obsStatusFrom('scene', { scene: 'Gameplay' }, data), { on: true, text: 'Gameplay' });
  assert.deepEqual(obsStatusFrom('scene', { scene: 'Pausa' }, data), { on: false, text: 'Gameplay' });
});

test('status: obsStatusFrom distingue registrazione, pausa e diretta', () => {
  const data = {
    record: { outputActive: true, outputPaused: false },
    stream: { outputActive: false },
    cam: { outputActive: true }
  };
  assert.equal(obsStatusFrom('toggle-record', {}, data).on, true);
  assert.equal(obsStatusFrom('pause-record', {}, data).on, false);
  assert.equal(obsStatusFrom('toggle-stream', {}, data).on, false);
  assert.equal(obsStatusFrom('virtual-cam', {}, data).on, true);
});

test('status: obsStatusFrom riporta il muto delle sorgenti', () => {
  assert.equal(obsStatusFrom('toggle-mute', { source: 'Mic' }, { mute: { inputMuted: true } }).on, true);
  assert.equal(obsStatusFrom('toggle-mute', { source: 'Mic' }, {}), null, 'senza risposta non si inventa uno stato');
});

test('status: obsStatusFrom non inventa stati per i comandi che non ne hanno', () => {
  assert.equal(obsStatusFrom('replay', {}, {}), null);
  assert.equal(obsStatusFrom('comando-inesistente', {}, {}), null);
});
