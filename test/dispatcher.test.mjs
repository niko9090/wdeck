import test from 'node:test';
import assert from 'node:assert/strict';

import { findButton, createDispatcher } from '../src/host/actions/dispatcher.mjs';
import { createDefaultRegistry } from '../src/host/actions/handlers/index.mjs';
import { makeDeck, makeDispatcher } from '../tools/fixtures.mjs';

// La fixture ha dryRun = true: nessun test tocca davvero il sistema.

test('dispatcher: findButton trova il bottone e il suo contesto', () => {
  const deck = makeDeck();
  const found = findButton(deck, { buttonId: 'combo' });
  assert.equal(found.button.id, 'combo');
  assert.equal(found.page.id, 'due');
  assert.equal(found.profile.id, 'main');

  assert.equal(findButton(deck, { buttonId: 'combo', pageId: 'home' }), null);
  assert.equal(findButton(deck, { buttonId: 'inesistente' }), null);
});

test('dispatcher: pressione in dry-run confermata senza eseguire nulla', async () => {
  const { dispatcher, state } = makeDispatcher();
  const result = await dispatcher.press({ buttonId: 'play', source: 'test' });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.type, 'media');
  assert.equal(result.buttonId, 'play');
  assert.equal(result.profileId, 'main');
  assert.equal(result.pageId, 'home');
  assert.match(result.description, /playpause/);
  assert.equal(result.result.simulated, true);
  assert.equal(state.pressCount, 1);
  assert.equal(state.lastAction.buttonId, 'play');
});

test('dispatcher: ogni azione della fixture e\' eseguibile in dry-run', async () => {
  const { dispatcher } = makeDispatcher();
  for (const buttonId of ['play', 'copy', 'saluto', 'notepad', 'vai', 'combo']) {
    const result = await dispatcher.press({ buttonId });
    assert.equal(result.ok, true, `${buttonId}: ${JSON.stringify(result.error)}`);
    assert.equal(result.dryRun, true);
    assert.ok(typeof result.description === 'string' && result.description.length > 0);
  }
});

test('dispatcher: bottone inesistente -> not_found', async () => {
  const { dispatcher } = makeDispatcher();
  const result = await dispatcher.press({ buttonId: 'fantasma' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'not_found');
});

test('dispatcher: buttonId mancante -> bad_request', async () => {
  const { dispatcher } = makeDispatcher();
  for (const buttonId of [undefined, '', 42, null]) {
    const result = await dispatcher.press({ buttonId });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'bad_request');
  }
});

test('dispatcher: tipo di azione sconosciuto -> unsupported_action', async () => {
  const { dispatcher } = makeDispatcher();
  const result = await dispatcher.execute({ type: 'teletrasporto' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'unsupported_action');
  assert.match(result.error.message, /azione sconosciuta/);
});

test('dispatcher: azione malformata -> bad_request', async () => {
  const { dispatcher } = makeDispatcher();
  for (const action of [null, 'media', 42, {}]) {
    const result = await dispatcher.execute(action);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'bad_request');
  }
});

test('dispatcher: parametri non validi -> bad_request con messaggio utile', async () => {
  const { dispatcher } = makeDispatcher();

  const media = await dispatcher.execute({ type: 'media', params: { key: 'inesistente' } });
  assert.equal(media.error.code, 'bad_request');
  assert.match(media.error.message, /tasto media non supportato/);

  const hotkey = await dispatcher.execute({ type: 'hotkey', params: { keys: 'ctrl+' } });
  assert.equal(hotkey.error.code, 'bad_request');

  const http = await dispatcher.execute({ type: 'http', params: { url: 'ftp://x/y' } });
  assert.equal(http.error.code, 'bad_request');

  const testo = await dispatcher.execute({ type: 'text', params: { text: 'x'.repeat(2001) } });
  assert.equal(testo.error.code, 'bad_request');
});

test('dispatcher: la whitelist blocca gli eseguibili anche in dry-run', async () => {
  const { dispatcher } = makeDispatcher();
  const result = await dispatcher.press({ buttonId: 'vietato' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'forbidden');
  assert.match(result.error.message, /allowExec/);
});

test('dispatcher: la whitelist consente i percorsi ammessi', async () => {
  const { dispatcher } = makeDispatcher();
  const result = await dispatcher.press({ buttonId: 'notepad' });
  assert.equal(result.ok, true);
  assert.match(result.result.detail, /notepad\.exe/i);
});

test('dispatcher: gli URL con schema non ammesso sono bloccati', async () => {
  const { dispatcher } = makeDispatcher();
  const ok = await dispatcher.execute({ type: 'url', params: { url: 'https://example.com' } });
  assert.equal(ok.ok, true);

  const ko = await dispatcher.execute({ type: 'url', params: { url: 'file:///C:/segreti.txt' } });
  assert.equal(ko.ok, false);
  assert.equal(ko.error.code, 'forbidden');
});

test('dispatcher: le sequence eseguono tutti i passi in ordine', async () => {
  const { dispatcher } = makeDispatcher();
  const result = await dispatcher.press({ buttonId: 'combo' });
  assert.equal(result.ok, true);
  assert.equal(result.result.steps.length, 2);
  assert.deepEqual(result.result.steps.map((s) => s.type), ['media', 'delay']);
  assert.ok(result.result.steps.every((s) => s.ok));
});

test('dispatcher: la sequence si ferma al primo errore', async () => {
  const { dispatcher } = makeDispatcher();
  const result = await dispatcher.execute({
    type: 'sequence',
    params: {
      steps: [
        { type: 'noop' },
        { type: 'media', params: { key: 'chissa' } },
        { type: 'noop' }
      ]
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.result.steps.length, 2);
  assert.match(result.result.detail, /interrotta al passo 1/);
});

test('dispatcher: continueOnError prosegue oltre i passi falliti', async () => {
  const { dispatcher } = makeDispatcher();
  const result = await dispatcher.execute({
    type: 'sequence',
    params: {
      continueOnError: true,
      steps: [
        { type: 'media', params: { key: 'chissa' } },
        { type: 'noop' }
      ]
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.steps.length, 2);
  assert.equal(result.result.steps[0].ok, false);
  assert.equal(result.result.steps[1].ok, true);
});

test('dispatcher: continueOnError riporta i passi falliti senza fingere successo', async () => {
  const { dispatcher } = makeDispatcher();
  const result = await dispatcher.execute({
    type: 'sequence',
    params: {
      continueOnError: true,
      steps: [
        { type: 'media', params: { key: 'chissa' } }, // fallisce
        { type: 'noop' },
        { type: 'media', params: { key: 'ancoraboh' } } // fallisce
      ]
    }
  });
  assert.equal(result.ok, true, 'con continueOnError la sequenza resta ok');
  assert.equal(result.result.failed, 2, 'deve contare i passi falliti');
  assert.match(result.result.detail, /2 errori su 3/, 'il riepilogo deve dichiarare gli errori');
  assert.deepEqual(result.result.failedSteps, [
    { index: 0, type: 'media' },
    { index: 2, type: 'media' }
  ]);
});

test('dispatcher: continueOnError senza errori non segnala nulla', async () => {
  const { dispatcher } = makeDispatcher();
  const result = await dispatcher.execute({
    type: 'sequence',
    params: {
      continueOnError: true,
      steps: [{ type: 'noop' }, { type: 'noop' }]
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.failed, undefined, 'senza errori non deve esserci il conteggio');
  assert.match(result.result.detail, /completata: 2 passi/);
});

test('dispatcher: singolo errore usa il singolare "errore"', async () => {
  const { dispatcher } = makeDispatcher();
  const result = await dispatcher.execute({
    type: 'sequence',
    params: {
      continueOnError: true,
      steps: [{ type: 'media', params: { key: 'chissa' } }, { type: 'noop' }]
    }
  });
  assert.equal(result.result.failed, 1);
  assert.match(result.result.detail, /1 errore su 2/);
});

test('dispatcher: la sequence rispetta maxSequenceSteps', async () => {
  const { dispatcher } = makeDispatcher();
  const steps = Array.from({ length: 9 }, () => ({ type: 'noop' })); // limite fixture = 8
  const result = await dispatcher.execute({ type: 'sequence', params: { steps } });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /sequenza troppo lunga/);
});

test('dispatcher: navigate aggiorna lo stato dell\'host', async () => {
  const { dispatcher, state } = makeDispatcher();
  state.setDryRun(false); // navigate non tocca il sistema operativo
  const result = await dispatcher.press({ buttonId: 'vai', dryRun: false });
  assert.equal(result.ok, true);
  assert.equal(state.activePageId, 'due');
  assert.equal(state.activeProfileId, 'main');
});

test('dispatcher: le azioni non supportate dalla piattaforma sono rifiutate fuori dal dry-run', async () => {
  const registry = createDefaultRegistry({
    extra: [{
      type: 'solo-altrove',
      title: 'Solo altrove',
      description: 'handler di test',
      platforms: ['piattaforma-inesistente'],
      async run(_params, ctx) {
        if (ctx.dryRun) return { ok: true, simulated: true, detail: 'simulata' };
        throw new Error('non deve mai essere eseguita fuori dal dry-run');
      }
    }]
  });
  const { dispatcher } = makeDispatcher({ registry });

  const dry = await dispatcher.execute({ type: 'solo-altrove' });
  assert.equal(dry.ok, true, 'in dry-run deve essere consentita');

  const real = await dispatcher.execute({ type: 'solo-altrove' }, { dryRun: false });
  assert.equal(real.ok, false);
  assert.equal(real.error.code, 'unsupported_action');
  assert.match(real.error.message, /dry-run/);
});

test('dispatcher: un handler che lancia produce un errore controllato', async () => {
  const registry = createDefaultRegistry({
    extra: [{
      type: 'esplode',
      title: 'Esplode',
      description: 'handler di test',
      platforms: ['*'],
      async run() {
        throw new Error('boom');
      }
    }]
  });
  const { dispatcher, state } = makeDispatcher({ registry });
  const result = await dispatcher.execute({ type: 'esplode' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'action_failed');
  assert.equal(result.error.message, 'boom');
  assert.equal(state.pressCount, 0);
});

test('dispatcher: hold usa holdAction quando presente', async () => {
  const deck = makeDeck();
  deck.profiles[0].pages[0].buttons[0].holdAction = { type: 'noop', params: {} };
  const { dispatcher } = makeDispatcher({ deck });

  const normale = await dispatcher.press({ buttonId: 'play' });
  assert.equal(normale.type, 'media');

  const lungo = await dispatcher.press({ buttonId: 'play', hold: true });
  assert.equal(lungo.type, 'noop');
});

test('dispatcher: la re-entry in execute e\' limitata da un tetto di profondita\'', async () => {
  // Un handler che rientra all'infinito in ctx.execute deve fermarsi al tetto
  // centrale del dispatcher invece di esaurire lo stack.
  const registry = createDefaultRegistry({
    extra: [{
      type: 'ricorsivo',
      title: 'Ricorsivo',
      description: 'handler di test',
      platforms: ['*'],
      async run(_params, ctx) {
        return ctx.execute({ type: 'ricorsivo' });
      }
    }]
  });
  const { dispatcher } = makeDispatcher({ registry });
  const result = await dispatcher.execute({ type: 'ricorsivo' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'bad_request');
  assert.match(result.error.message, /profondit/i);
});

test('dispatcher: un deck senza settings normalizzati non fa esplodere press()', async () => {
  // deck.settings assente: il contesto va costruito senza dereferenziare
  // security, e press() deve restituire un esito strutturato invece di
  // sollevare un TypeError sincrono fuori da press().
  const deck = makeDeck();
  delete deck.settings;
  const registry = createDefaultRegistry();
  const state = { dryRun: true, recordPress() {} };
  const dispatcher = createDispatcher({
    registry,
    state,
    getDeck: () => deck,
    baseDir: process.cwd(),
    logger: { info() {}, warn() {}, error() {} }
  });
  const result = await dispatcher.press({ buttonId: 'play' });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
});

test('dispatcher: misura la durata e registra la sorgente', async () => {
  const { dispatcher } = makeDispatcher();
  const result = await dispatcher.press({ buttonId: 'play', source: 'lite-ws' });
  assert.equal(result.source, 'lite-ws');
  assert.ok(Number.isFinite(result.durationMs) && result.durationMs >= 0);
});
