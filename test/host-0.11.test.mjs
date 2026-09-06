import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { normalizeDeck, validateDeck } from '../src/host/config/schema.mjs';
import { compactDeck } from '../src/host/config/writer.mjs';
import { createAutoProfile, matchProfile, parseForeground } from '../src/host/autoprofile.mjs';
import { createFileLogger } from '../src/host/logfile.mjs';
import { pruneRuntimeDirs, pruneTrayScripts, runtimeLayout } from '../src/host/cleanup.mjs';
import { buildNotifyScript } from '../src/host/actions/handlers/productivity.mjs';
import { rawDeck } from '../tools/fixtures.mjs';

const validate = (deck) => validateDeck(deck);

// ------------------------------------------------------------------ schema

test('0.11 schema: spanRows occupa piu\' righe e non puo\' uscire dalla griglia', () => {
  const deck = rawDeck();
  const page = deck.profiles[0].pages[0];
  page.rows = 3;
  page.buttons = [page.buttons[0]]; // la pagina di prova e' piena: qui serve spazio sotto
  page.buttons[0].row = 0;
  page.buttons[0].col = 0;
  page.buttons[0].spanRows = 2;
  assert.equal(validate(deck).valid, true, JSON.stringify(validate(deck).errors));
  assert.equal(normalizeDeck(deck).profiles[0].pages[0].buttons[0].spanRows, 2);
  // sotto c'e' gia' un altro tasto: collisione
  const altro = { ...page.buttons[0], id: 'sotto', row: 1, spanRows: 1 };
  page.buttons.push(altro);
  const r = validate(deck);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /occupata/.test(e.message)));
  page.buttons.pop();
  page.buttons[0].spanRows = 4;
  assert.ok(validate(deck).errors.some((e) => e.path.endsWith('spanRows')));
});

test('0.11 schema: cartelle (parent) di un livello solo, stile per pagina, apps per profilo', () => {
  const deck = rawDeck();
  const profile = deck.profiles[0];
  const home = profile.pages[0].id;
  const dentro = { id: 'dentro', name: 'Dentro', rows: 2, cols: 2, parent: home, style: 'keycap', buttons: [] };
  profile.pages.push(dentro);
  profile.apps = ['obs64', 'Visual Studio Code'];
  let r = validate(deck);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
  const n = normalizeDeck(deck);
  assert.equal(n.profiles[0].pages.at(-1).parent, home);
  assert.equal(n.profiles[0].pages.at(-1).style, 'keycap');
  assert.equal(n.profiles[0].pages[0].parent, null);
  assert.deepEqual(n.profiles[0].apps, ['obs64', 'Visual Studio Code']);

  // due livelli: no
  profile.pages.push({ id: 'dentro2', name: 'x', rows: 1, cols: 1, parent: 'dentro', buttons: [] });
  r = validate(deck);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /un livello solo/.test(e.message)));
  profile.pages.pop();
  // madre inesistente
  dentro.parent = 'fantasma';
  assert.ok(validate(deck).errors.some((e) => /non trovata/.test(e.message)));
  dentro.parent = home;
  // stile sconosciuto
  dentro.style = 'barocco';
  assert.ok(validate(deck).errors.some((e) => e.path.endsWith('.style')));
  dentro.style = 'keycap';
  // apps: array di stringhe
  profile.apps = 'obs';
  assert.ok(validate(deck).errors.some((e) => e.path.endsWith('.apps')));
});

test('0.11 schema: le nuove impostazioni ui hanno default e limiti', () => {
  const n = normalizeDeck(rawDeck());
  assert.equal(n.settings.ui.autoProfile, true);
  assert.equal(n.settings.ui.dimAfterMin, 0);
  assert.equal(n.settings.ui.haptics, true);
  assert.equal(n.settings.ui.clickSound, false);
  assert.equal(n.settings.ui.flashOnDone, true);
  const deck = rawDeck();
  deck.settings.ui = { dimAfterMin: 999 };
  assert.ok(validate(deck).errors.some((e) => e.path === 'settings.ui.dimAfterMin'));
  deck.settings.ui = { haptics: 'si' };
  assert.ok(validate(deck).errors.some((e) => e.path === 'settings.ui.haptics'));
});

test('0.11 writer: compactDeck conserva spanRows, parent, style e apps', () => {
  const deck = rawDeck();
  const profile = deck.profiles[0];
  profile.apps = ['obs64'];
  profile.pages[0].buttons[0].spanRows = 2;
  profile.pages.push({ id: 'dentro', name: 'Dentro', rows: 2, cols: 2, parent: profile.pages[0].id, style: 'quaderno', buttons: [] });
  const out = compactDeck(deck);
  assert.deepEqual(out.profiles[0].apps, ['obs64']);
  assert.equal(out.profiles[0].pages[0].buttons[0].spanRows, 2);
  assert.equal(out.profiles[0].pages.at(-1).parent, profile.pages[0].id);
  assert.equal(out.profiles[0].pages.at(-1).style, 'quaderno');
  // niente campi vuoti
  const pulito = compactDeck(rawDeck());
  assert.equal('apps' in pulito.profiles[0], false);
  assert.equal('spanRows' in pulito.profiles[0].pages[0].buttons[0], false);
  assert.equal('parent' in pulito.profiles[0].pages[0], false);
});

// ------------------------------------------------------------- autoprofile

test('autoprofile: parseForeground e matchProfile (nome processo o pezzo di titolo)', () => {
  assert.deepEqual(parseForeground('1234|obs64|OBS 30.1 - Profilo: casa'), { pid: 1234, process: 'obs64', title: 'OBS 30.1 - Profilo: casa' });
  const profiles = [
    { id: 'base', apps: [] },
    { id: 'stream', apps: ['OBS64.exe'] },
    { id: 'codice', apps: ['Visual Studio Code'] }
  ];
  assert.equal(matchProfile(profiles, { process: 'obs64', title: 'OBS' })?.id, 'stream');
  assert.equal(matchProfile(profiles, { process: 'Code', title: 'app.js - Wdeck - Visual Studio Code' })?.id, 'codice');
  assert.equal(matchProfile(profiles, { process: 'chrome', title: 'YouTube' }), null);
  assert.equal(matchProfile(profiles, { process: '', title: '' }), null);
});

test('autoprofile: cambia profilo SOLO al cambio di finestra in primo piano', async () => {
  const navigazioni = [];
  const state = { activeProfileId: 'base', navigate(p, pg) { navigazioni.push([p, pg]); this.activeProfileId = p; } };
  let fg = '10|obs64|OBS';
  const deck = {
    settings: { ui: { autoProfile: true } },
    profiles: [{ id: 'base', defaultPage: 'h', apps: [] }, { id: 'stream', defaultPage: 's', apps: ['obs64'] }]
  };
  const auto = createAutoProfile({ state, getDeck: () => deck, logger: { info() {}, debug() {} }, readForeground: async () => fg });
  assert.equal(await auto.tick(), 'stream');
  assert.deepEqual(navigazioni, [['stream', 's']]);
  // l'utente torna a mano su "base" mentre OBS resta davanti: nessun braccio di ferro
  state.activeProfileId = 'base';
  assert.equal(await auto.tick(), null);
  assert.equal(navigazioni.length, 1);
  // cambia finestra (altro pid): si riapplica
  fg = '11|obs64|OBS';
  assert.equal(await auto.tick(), 'stream');
  // disattivato dalle impostazioni: fermo
  deck.settings.ui.autoProfile = false;
  fg = '12|obs64|OBS';
  assert.equal(await auto.tick(), null);
});

// ----------------------------------------------------------------- logfile

test('logfile: scrive con data e livello, ruota oltre il limite, non esplode senza file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-log-'));
  const file = path.join(dir, 'wdeck.log');
  const muto = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
  const logger = createFileLogger({ file, base: muto, maxBytes: 200 });
  logger.info('[wdeck] avvio', { porta: 1 });
  logger.warn('attenzione');
  const righe = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(righe.length, 2);
  assert.match(righe[0], /^\d{4}-\d\d-\d\dT.* INFO  \[wdeck\] avvio \{"porta":1\}$/);
  assert.match(righe[1], /WARN  attenzione$/);
  for (let i = 0; i < 20; i += 1) logger.error(`riga lunga numero ${i} ${'x'.repeat(30)}`);
  assert.ok(fs.existsSync(`${file}.1`), 'oltre il limite il file ruota in .1');
  assert.ok(fs.statSync(file).size < 400, 'e si riparte da un file piccolo');
  const senza = createFileLogger({ file: null, base: muto });
  senza.info('niente file');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ----------------------------------------------------------------- cleanup

test('cleanup: runtime/ tiene la versione in uso e la piu\' recente fra le altre', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-rt-'));
  const nomi = ['0.9.0-aaa', '0.10.0-bbb', '0.10.7-ccc', '0.10.8-ddd'];
  nomi.forEach((n, i) => {
    fs.mkdirSync(path.join(root, n));
    const t = new Date(Date.now() - (nomi.length - i) * 86400000);
    fs.utimesSync(path.join(root, n), t, t);
  });
  const tolte = pruneRuntimeDirs({ runtimeRoot: root, current: '0.10.8-ddd', logger: { info() {}, debug() {} } });
  assert.deepEqual(tolte.sort(), ['0.10.0-bbb', '0.9.0-aaa']);
  assert.deepEqual(fs.readdirSync(root).sort(), ['0.10.7-ccc', '0.10.8-ddd']);
  fs.rmSync(root, { recursive: true, force: true });
  assert.deepEqual(runtimeLayout('C:\\Users\\x\\AppData\\Local\\Wdeck\\runtime\\0.10.8-ddd'), { runtimeRoot: 'C:/Users/x/AppData/Local/Wdeck/runtime', current: '0.10.8-ddd' });
  assert.equal(runtimeLayout('E:/Users/x/Documents/Wdeck'), null);
});

test('cleanup: gli script della tray di host morti vengono tolti, quello vivo no', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-tray-'));
  fs.writeFileSync(path.join(dir, 'wdeck-tray-999999.ps1'), '');
  fs.writeFileSync(path.join(dir, `wdeck-tray-${process.pid}.ps1`), '');
  fs.writeFileSync(path.join(dir, 'altro.txt'), '');
  const tolti = pruneTrayScripts({ tmpDir: dir, ownPid: -1, logger: { debug() {} } });
  assert.deepEqual(tolti, ['wdeck-tray-999999.ps1']);
  assert.ok(fs.existsSync(path.join(dir, `wdeck-tray-${process.pid}.ps1`)), 'il processo vivo resta');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ notify

test('notify: notifica WinRT con ripiego sul fumetto, titolo e testo protetti', () => {
  const s = buildNotifyScript({ title: 'Wdeck', message: 'ciao <b>', sound: false });
  assert.match(s, /ToastNotificationManager/);
  assert.match(s, /SecurityElement\]::Escape/);
  assert.match(s, /<audio silent="true"\/>/);
  assert.match(s, /catch \{[\s\S]*NotifyIcon/);
  assert.doesNotMatch(s, /ciao <b>/, 'il testo viaggia in base64, non in chiaro nello script');
  assert.doesNotMatch(buildNotifyScript({ message: 'x', sound: true }), /audio silent/);
});
