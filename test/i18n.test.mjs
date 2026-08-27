/**
 * Localizzazione, tema chiaro e pressione prolungata dall'editor.
 *
 * Il client non ha un test in browser, quindi qui si verifica cio' che si puo'
 * verificare da Node: il dizionario (che e' un modulo puro), la presenza degli
 * agganci nel codice e nel CSS, e la parte lato host - schema e salvataggio -
 * che sostiene le tre rifiniture.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LANGUAGES, dictionaries, language, setLanguage, t } from '../web/i18n.js';
import { validateDeck, normalizeDeck, DEFAULT_SETTINGS } from '../src/host/config/schema.mjs';
import { compactDeck } from '../src/host/config/writer.mjs';
import { rawDeck } from '../tools/fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ------------------------------------------------------------------ dizionario

test('i18n: le due lingue hanno esattamente le stesse chiavi', () => {
  const it = Object.keys(dictionaries.it).sort();
  const en = Object.keys(dictionaries.en).sort();
  // Una chiave presente solo in una lingua e' un testo che comparira' nella
  // lingua sbagliata senza che nessuno se ne accorga.
  assert.deepEqual(en, it);
});

test('i18n: nessuna traduzione e\' vuota', () => {
  for (const [lang, dict] of Object.entries(dictionaries)) {
    for (const [key, value] of Object.entries(dict)) {
      assert.ok(typeof value === 'string' && value.trim() !== '', `${lang}/${key} e' vuota`);
    }
  }
});

test('i18n: i segnaposto coincidono fra le due lingue', () => {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(dictionaries.it)) {
    assert.deepEqual(
      placeholders(dictionaries.en[key]),
      placeholders(dictionaries.it[key]),
      `i segnaposto di "${key}" non coincidono`
    );
  }
});

test('i18n: setLanguage sceglie fra le lingue disponibili', () => {
  assert.equal(setLanguage('en'), 'en');
  assert.equal(language(), 'en');
  assert.equal(setLanguage('it'), 'it');
  assert.equal(setLanguage('de'), 'it', 'una lingua assente ricade sull\'italiano');
});

test('i18n: con "auto" si segue il browser', () => {
  assert.equal(setLanguage('auto', 'en-GB'), 'en');
  assert.equal(setLanguage('auto', 'it-IT'), 'it');
  assert.equal(setLanguage('auto', 'fr-FR'), 'it', 'una lingua non tradotta ricade sull\'italiano');
  assert.equal(setLanguage(undefined, 'en-US'), 'en');
});

test('i18n: t restituisce il testo della lingua in uso', () => {
  setLanguage('it');
  assert.equal(t('sheet.save'), 'Salva');
  setLanguage('en');
  assert.equal(t('sheet.save'), 'Save');
});

test('i18n: t sostituisce i segnaposto', () => {
  setLanguage('it');
  assert.equal(t('status.clients', { n: 3 }), '3 client');
  assert.match(t('edit.saved', { label: 'Muto' }), /"Muto"/);
  setLanguage('en');
  assert.equal(t('status.clients', { n: 3 }), '3 clients');
});

test('i18n: una chiave sconosciuta torna com\'e\', senza rompere l\'interfaccia', () => {
  setLanguage('it');
  assert.equal(t('chiave.inesistente'), 'chiave.inesistente');
  assert.equal(t('status.clients'), '{n} client', 'senza valori i segnaposto restano visibili');
});

test('i18n: le lingue dichiarate sono quelle dei dizionari', () => {
  assert.deepEqual([...LANGUAGES].sort(), Object.keys(dictionaries).sort());
});

// ------------------------------------------------------------------ agganci nel client

test('i18n: il client non contiene piu\' messaggi utente scritti a mano', () => {
  const app = read('web/app.js');
  // Frasi che c'erano prima della localizzazione: se ricompaiono, qualcuno ha
  // aggiunto testo senza passare dal dizionario.
  for (const frase of [
    "'Modifica disattivata'",
    "'Token principale rigenerato'",
    "'Dispositivo revocato'",
    "'Nessun aggiornamento disponibile'",
    "'azione fallita'"
  ]) {
    assert.ok(!app.includes(frase), `testo non localizzato nel client: ${frase}`);
  }
});

test('i18n: le stringhe statiche di index.html sono marcate', () => {
  const html = read('web/index.html');
  for (const key of ['gate.subtitle', 'gate.pair', 'top.edit', 'top.settings', 'status.offline']) {
    assert.ok(html.includes(key), `manca l'aggancio ${key} in index.html`);
  }
});

test('i18n: i18n.js entra nella build e nella cache offline', () => {
  assert.ok(read('scripts/build-web.mjs').includes("'i18n.js'"), 'la build non verifica i18n.js');
  assert.ok(read('web/sw.js').includes("'./i18n.js'"), 'il service worker non lo mette in cache');
});

// ------------------------------------------------------------------ tema

test('tema: "light" ha una propria tavolozza, non solo "auto"', () => {
  const css = read('web/app.css');
  // Prima esisteva solo :root.theme-auto dentro prefers-color-scheme, quindi
  // ui.theme: "light" non aveva alcun effetto.
  assert.ok(css.includes(':root.theme-light'), 'manca la tavolozza del tema chiaro imposto');
  assert.ok(css.includes(':root.theme-auto'), 'manca la tavolozza del tema automatico');

  const chiaro = css.slice(css.indexOf(':root.theme-light'));
  assert.match(chiaro.slice(0, 300), /--bg:\s*#f2f4f8/, 'il tema chiaro deve cambiare lo sfondo');
});

test('tema: il client applica la classe giusta per ogni valore', () => {
  const app = read('web/app.js');
  assert.match(app, /classList\.toggle\('theme-light', uiConfig\.theme === 'light'\)/);
  assert.match(app, /classList\.toggle\('theme-auto', uiConfig\.theme === 'auto'\)/);
});

test('tema: lo schema accetta i tre valori e rifiuta gli altri', () => {
  for (const theme of ['dark', 'light', 'auto']) {
    const deck = rawDeck();
    deck.settings.ui = { theme };
    assert.equal(validateDeck(deck).valid, true, `tema ${theme}`);
  }
  const deck = rawDeck();
  deck.settings.ui = { theme: 'seppia' };
  assert.equal(validateDeck(deck).valid, false);
});

// ------------------------------------------------------------------ lingua nella configurazione

test('lingua: settings.ui.language accetta it, en e auto', () => {
  for (const value of ['it', 'en', 'auto']) {
    const deck = rawDeck();
    deck.settings.ui = { language: value };
    assert.equal(validateDeck(deck).valid, true, `lingua ${value}`);
  }
  const deck = rawDeck();
  deck.settings.ui = { language: 'de' };
  const result = validateDeck(deck);
  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /it \| en \| auto/);
});

test('lingua: il valore predefinito segue il browser', () => {
  assert.equal(DEFAULT_SETTINGS.ui.language, 'auto');
  assert.equal(normalizeDeck(rawDeck()).settings.ui.language, 'auto');
});

// ------------------------------------------------------------------ pressione prolungata

test('holdAction: l\'editor la offre e la salva', () => {
  const app = read('web/app.js');
  assert.ok(app.includes('ed-hold-type'), 'manca la scelta dell\'azione prolungata');
  assert.ok(app.includes('ed-hold-params'), 'mancano i parametri dell\'azione prolungata');
  assert.match(app, /holdAction,/, 'il controllo salvato deve portarsi dietro holdAction');
  assert.ok(app.includes('edit.holdParamsInvalid'), 'i parametri sbagliati devono essere segnalati');
});

test('holdAction: sopravvive al salvataggio su deck.json', () => {
  const deck = normalizeDeck(rawDeck());
  deck.profiles[0].pages[0].buttons[0].holdAction = { type: 'noop', params: { nota: 'x' } };

  const compatto = compactDeck(deck);
  assert.deepEqual(compatto.profiles[0].pages[0].buttons[0].holdAction, { type: 'noop', params: { nota: 'x' } });
});

test("releaseAction: l’editor la offre, la salva e rende il tasto momentaneo", () => {
  const app = read('web/app.js');
  assert.ok(app.includes('ed-release-type'), "manca la scelta dell’azione al rilascio");
  assert.ok(app.includes('ed-release-params'), "mancano i parametri dell’azione al rilascio");
  assert.match(app, /releaseAction,/, 'il controllo salvato deve portarsi dietro releaseAction');
  assert.ok(app.includes('gesture.momentary'), 'il gesto deve avere la modalita momentanea');
  assert.ok(app.includes('{ release: true }'), 'al rilascio va inviato il flag release');
  assert.ok(app.includes('edit.releaseParamsInvalid'), 'i parametri sbagliati devono essere segnalati');
});

test('releaseAction: sopravvive al salvataggio su deck.json', () => {
  const deck = normalizeDeck(rawDeck());
  deck.profiles[0].pages[0].buttons[0].releaseAction = { type: 'noop', params: { nota: 'x' } };
  const compatto = compactDeck(deck);
  assert.deepEqual(compatto.profiles[0].pages[0].buttons[0].releaseAction, { type: 'noop', params: { nota: 'x' } });
});

test('releaseAction: assente non lascia tracce nel file', () => {
  const compatto = compactDeck(normalizeDeck(rawDeck()));
  assert.equal('releaseAction' in compatto.profiles[0].pages[0].buttons[0], false);
});

test('releaseAction: viene validata come una qualunque azione', () => {
  const deck = rawDeck();
  deck.profiles[0].pages[0].buttons[0].releaseAction = { type: 'inesistente', params: {} };
  const result = validateDeck(deck, { actionTypes: ['media', 'hotkey', 'text', 'launch', 'navigate', 'sequence', 'delay', 'noop'] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path.includes('releaseAction')), JSON.stringify(result.errors));
});

test('hold e releaseAction: null vale "nessuna azione", non un errore', () => {
  // L’editor manda null quando l’azione viene tolta, e normalizeDeck la
  // restituisce null: rifiutarlo renderebbe non salvabile un deck appena letto.
  const deck = rawDeck();
  deck.profiles[0].pages[0].buttons[0].holdAction = null;
  deck.profiles[0].pages[0].buttons[0].releaseAction = null;
  const result = validateDeck(deck, { actionTypes: ['media', 'hotkey', 'text', 'launch', 'navigate', 'sequence', 'delay', 'noop'] });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('selezione: la pressione prolungata non deve selezionare il testo', () => {
  // Su touch il long press faceva partire la selezione dell’etichetta: maniglie
  // blu, tasto "afferrato", hold perso. Servono sia il CSS sia selectstart.
  const app = read('web/app.js');
  const css = read('web/app.css');
  assert.ok(app.includes("addEventListener('selectstart'"), 'la griglia deve annullare selectstart');
  assert.match(css, /\.grid \{[^}]*user-select: none/s, 'la griglia deve avere user-select: none');
});

test('holdAction: assente non lascia tracce nel file', () => {
  const compatto = compactDeck(normalizeDeck(rawDeck()));
  assert.equal('holdAction' in compatto.profiles[0].pages[0].buttons[0], false);
});

test('holdAction: viene validata come una qualunque azione', () => {
  const deck = rawDeck();
  deck.profiles[0].pages[0].buttons[0].holdAction = { type: 'inesistente', params: {} };
  const result = validateDeck(deck, { actionTypes: ['media', 'hotkey', 'text', 'launch', 'navigate', 'sequence', 'delay'] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path.includes('holdAction')), JSON.stringify(result.errors));
});
