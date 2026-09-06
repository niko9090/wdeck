import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDeck } from '../src/host/config/schema.mjs';
import { createDefaultRegistry } from '../src/host/actions/handlers/index.mjs';
import { NOVITA_PAGE_ID, NOVITA_FOLDER_ID, NOVITA_VERSION, ensureNovitaPage, novitaPages } from '../src/host/novita.mjs';
import { formatUptime, netRate, readMetric, sysinfoAction } from '../src/host/actions/handlers/sysinfo.mjs';
import { parseLevelOutput } from '../src/host/platform/levels.mjs';
import { rawDeck } from '../tools/fixtures.mjs';

const registry = createDefaultRegistry();

test('novita: le pagine passano la validazione con il registro vero (mai spedire una pagina rifiutata)', () => {
  const deck = rawDeck();
  deck.profiles[0].pages.push(...novitaPages());
  const r = validateDeck(deck, { actionTypes: registry.types() });
  assert.equal(r.valid, true, JSON.stringify(r.errors, null, 1));
  const [main, folder] = novitaPages();
  assert.equal(main.name, `Novita' ${NOVITA_VERSION}`);
  assert.equal(folder.parent, NOVITA_PAGE_ID);
  // il tasto cartella porta alla sotto-pagina, e i widget hanno una fonte dati
  assert.equal(main.buttons.find((b) => b.kind === 'folder').action.params.page, NOVITA_FOLDER_ID);
  for (const b of main.buttons.filter((b) => ['gauge', 'meter', 'chart', 'display'].includes(b.kind))) {
    assert.equal(b.action.type, 'sysinfo', `${b.id} senza dati`);
  }
});

test('novita: ensureNovitaPage sostituisce solo la pagina vecchia e aggiunge la cartella', () => {
  const deck = rawDeck();
  const altre = deck.profiles[0].pages.length;
  deck.profiles[0].pages.push({ id: 'novita', name: 'Novita 0.10.0', rows: 5, cols: 5, buttons: [] });
  const esito = ensureNovitaPage(deck);
  assert.equal(esito.changed, true);
  const pages = esito.deck.profiles[0].pages;
  assert.equal(pages.length, altre + 2);
  assert.equal(pages[altre].name, `Novita' ${NOVITA_VERSION}`);
  assert.equal(pages[altre + 1].id, NOVITA_FOLDER_ID);
  // il deck originale non e' stato toccato
  assert.equal(deck.profiles[0].pages[altre].name, 'Novita 0.10.0');
  // seconda volta: niente da fare
  assert.equal(ensureNovitaPage(esito.deck).changed, false);
  // senza pagina novita: niente da fare
  assert.equal(ensureNovitaPage(rawDeck()).changed, false);
});

test('sysinfo: readMetric con letture finte', async () => {
  const finto = async () => ({ cpu: 42, mem: { usedMb: 8192, totalMb: 32768, percent: 25 }, uptimeSec: 100, cores: 8 });
  assert.deepEqual(await readMetric('cpu', {}, { sysinfo: finto }), { level: 42, text: '42%' });
  assert.deepEqual(await readMetric('ram', {}, { sysinfo: finto }), { level: 25, text: '8.0/32 GB' });
  const disco = await readMetric('disk', {}, { statfs: () => ({ bsize: 4096, blocks: 250e9 / 4096, bavail: 75e9 / 4096 }) });
  assert.equal(disco.level, 70);
  assert.equal(disco.text, '75.0 GB liberi');
  assert.equal((await readMetric('clock', {}, { now: () => new Date(2026, 8, 6, 9, 5).getTime() })).text, '09:05');
  assert.equal((await readMetric('uptime', {}, { uptime: 3 * 86400 + 4 * 3600 })).text, '3g 4h');
  assert.equal(formatUptime(65 * 60), '1h 05m');
  await assert.rejects(readMetric('boh'), /metrica sconosciuta/);
});

test('sysinfo: la rete da due campioni dei contatori', async () => {
  assert.equal(netRate({ rx: 10, tx: 5, at: 1000 }, null), null);
  assert.deepEqual(netRate({ rx: 10e6, tx: 2e6, at: 11000 }, { rx: 0, tx: 0, at: 1000 }), { downMbps: 8, upMbps: 1.6 });
  let campione = { rx: 0, tx: 0 };
  let t = 0;
  const deps = { readCounters: async () => campione, now: () => t };
  const primo = await readMetric('netDown', {}, deps);
  assert.equal(primo.level, null, 'il primo campione non ha un prima');
  campione = { rx: 5e6, tx: 1e6 };
  t = 4000;
  assert.deepEqual(await readMetric('netDown', {}, deps), { level: 10, text: '10 Mbit/s' });
  assert.equal(sysinfoAction.readState.length >= 1, true);
});

test('parseLevelOutput: legge rx/tx anche con la virgola decimale di PowerShell', () => {
  assert.deepEqual(parseLevelOutput('rx=1,5E+09;tx=12345'), { rx: 1.5e9, tx: 12345 });
});

test('sysinfo: registrata, con readState e campi', () => {
  assert.ok(registry.has('sysinfo'));
  const spec = registry.describe?.('sysinfo') ?? registry.byCategory().flatMap((g) => g.actions).find((a) => a.type === 'sysinfo');
  assert.ok(spec, 'sysinfo nel registro');
  assert.throws(() => sysinfoAction.validate({ metric: 'x' }), /metric/);
});
