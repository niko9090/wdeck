/**
 * I tipi di comando: un deck non e' fatto di soli pulsanti.
 *
 * Qui si verifica cio' che sostiene manopole, rotelle, tavolette e quadranti:
 * l'elenco dei tipi, i campi che ogni tipo pretende, la larghezza predefinita,
 * il rifiuto delle pressioni sui comandi di sola lettura e i due messaggi
 * nuovi del protocollo (scarto e coppia).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTROL_KINDS, READONLY_KINDS, DELTA_KINDS, PAIR_KINDS, UI_STYLES,
  defaultSpan, validateDeck, normalizeDeck, DEFAULT_SETTINGS
} from '../src/host/config/schema.mjs';
import { compactDeck } from '../src/host/config/writer.mjs';
import { rawDeck } from '../tools/fixtures.mjs';
import { readFileSync } from 'node:fs';

const leggi = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

const TIPI = ['noop', 'media', 'hotkey', 'text', 'launch', 'navigate', 'sequence', 'delay'];

/** Deck con un solo controllo, del tipo e con i campi indicati. */
function conControllo(extra) {
  const deck = rawDeck();
  const page = deck.profiles[0].pages[0];
  page.buttons = [{
    id: 'prova',
    label: 'Prova',
    row: 0,
    col: 0,
    action: { type: 'noop', params: {} },
    ...extra
  }];
  return deck;
}

const esito = (deck) => validateDeck(deck, { actionTypes: TIPI });
const errori = (deck) => esito(deck).errors.map((e) => e.path + ': ' + e.message).join(' | ');

// ------------------------------------------------------------------ elenco

test('kinds: i quattro insiemi non si sovrappongono e stanno nell\u2019elenco', () => {
  for (const gruppo of [READONLY_KINDS, DELTA_KINDS, PAIR_KINDS]) {
    for (const k of gruppo) assert.ok(CONTROL_KINDS.includes(k), `"${k}" non e' un kind valido`);
  }
  for (const k of DELTA_KINDS) assert.equal(READONLY_KINDS.includes(k), false, `"${k}" non puo' essere anche di sola lettura`);
  for (const k of PAIR_KINDS) assert.equal(DELTA_KINDS.includes(k), false, `"${k}" non puo' mandare sia coppia sia scarto`);
});

test('kinds: un tipo inventato viene rifiutato', () => {
  const r = esito(conControllo({ kind: 'manopolone' }));
  assert.equal(r.valid, false);
  assert.ok(errori(conControllo({ kind: 'manopolone' })).includes('kind'));
});

// ------------------------------------------------------------------ larghezza

test('span: cursori, tavolette, matrici e grafici valgono due celle', () => {
  for (const k of ['slider', 'xy', 'pad', 'chart']) assert.equal(defaultSpan(k), 2, k);
  for (const k of ['button', 'encoder', 'jog', 'display']) assert.equal(defaultSpan(k), 1, k);
});

test('span: il cursore verticale vale una cella sola', () => {
  // In verticale la larghezza non serve: serve l'altezza, che la griglia da'
  // gia'. Due celle lo renderebbero una lastra larga e bassa.
  assert.equal(defaultSpan('slider', 'v'), 1);
  assert.equal(defaultSpan('slider', 'h'), 2);
  assert.equal(defaultSpan('slider'), 2, 'senza orientamento resta orizzontale');
  const deck = conControllo({ kind: 'slider', orientation: 'v' });
  assert.equal(esito(deck).valid, true, errori(deck));
  assert.equal(normalizeDeck(deck).profiles[0].pages[0].buttons[0].span, 1);
});

test('span: la larghezza predefinita e\u2019 la stessa in validazione e a runtime', () => {
  // Se i due valori divergessero, un controllo passerebbe il controllo di
  // sovrapposizione e poi sfonderebbe la griglia a runtime.
  const deck = conControllo({ kind: 'xy' });
  assert.equal(esito(deck).valid, true, errori(deck));
  assert.equal(normalizeDeck(deck).profiles[0].pages[0].buttons[0].span, defaultSpan('xy'));
});

// ------------------------------------------------------------------ intervalli

test('encoder: ammette decimali e negativi (0.5 gradi, -5 EV)', () => {
  const deck = conControllo({ kind: 'encoder', min: -5, max: 5, step: 0.3 });
  assert.equal(esito(deck).valid, true, errori(deck));
});

test('intervallo: max deve superare min, e il passo deve essere positivo', () => {
  assert.equal(esito(conControllo({ kind: 'slider', min: 10, max: 10 })).valid, false);
  assert.equal(esito(conControllo({ kind: 'encoder', step: 0 })).valid, false);
});

// ------------------------------------------------------------------ campi per tipo

test('selector: senza almeno due opzioni non e\u2019 un selettore', () => {
  assert.equal(esito(conControllo({ kind: 'selector' })).valid, false);
  assert.equal(esito(conControllo({ kind: 'selector', options: ['Solo'] })).valid, false);
  const ok = conControllo({ kind: 'selector', options: ['Auto', 'Manuale', 'Fermo'] });
  assert.equal(esito(ok).valid, true, errori(ok));
  assert.deepEqual(normalizeDeck(ok).profiles[0].pages[0].buttons[0].options, ['Auto', 'Manuale', 'Fermo']);
});

test('pad, timer, color: hanno valori predefiniti sensati', () => {
  const norm = (extra) => normalizeDeck(conControllo(extra)).profiles[0].pages[0].buttons[0];
  const pad = norm({ kind: 'pad' });
  assert.equal(pad.rows, 4);
  assert.equal(pad.cols, 4);
  assert.equal(norm({ kind: 'timer' }).seconds, 1500);
  assert.equal(norm({ kind: 'color' }).mode, 'kelvin');
});

test('slider: orientamento e centro sono normalizzati', () => {
  const b = normalizeDeck(conControllo({ kind: 'slider', orientation: 'v', center: true })).profiles[0].pages[0].buttons[0];
  assert.equal(b.orientation, 'v');
  assert.equal(b.center, true);
  assert.equal(esito(conControllo({ kind: 'slider', orientation: 'diagonale' })).valid, false);
});

test('i campi di un tipo non finiscono addosso agli altri', () => {
  // Un pulsante non deve portarsi dietro min/max/options: il file resta pulito
  // e il client non deve indovinare cosa e' inerte.
  const b = normalizeDeck(conControllo({ kind: 'button' })).profiles[0].pages[0].buttons[0];
  for (const k of ['min', 'max', 'step', 'options', 'rows', 'cols', 'seconds', 'mode', 'orientation']) {
    assert.equal(k in b, false, `un pulsante non deve avere "${k}"`);
  }
});

// ------------------------------------------------------------------ sola lettura

test('sola lettura: niente hold, niente rilascio, niente conferma', () => {
  for (const kind of READONLY_KINDS) {
    assert.equal(esito(conControllo({ kind, holdAction: { type: 'noop', params: {} } })).valid, false, kind);
    assert.equal(esito(conControllo({ kind, releaseAction: { type: 'noop', params: {} } })).valid, false, kind);
    assert.equal(esito(conControllo({ kind, confirm: true })).valid, false, kind);
    assert.equal(esito(conControllo({ kind })).valid, true, kind);
  }
});

// ------------------------------------------------------------------ salvataggio

test('i campi dei tipi nuovi sopravvivono al salvataggio su deck.json', () => {
  const deck = normalizeDeck(conControllo({
    kind: 'encoder', min: 15, max: 30, step: 0.5
  }));
  const b = compactDeck(deck).profiles[0].pages[0].buttons[0];
  assert.equal(b.kind, 'encoder');
  assert.equal(b.min, 15);
  assert.equal(b.step, 0.5);

  const sel = compactDeck(normalizeDeck(conControllo({ kind: 'selector', options: ['A', 'B'] })))
    .profiles[0].pages[0].buttons[0];
  assert.deepEqual(sel.options, ['A', 'B']);
});


// ------------------------------------------------------------------ client
//
// Il client non ha un test in browser: qui si verifica che gli agganci ci
// siano, cioe' che ogni tipo dichiarato dall'host abbia un pezzo di markup,
// uno stile e - dove serve - un gesto.

test('client: ogni kind ha il suo markup e il suo stile', () => {
  const app = leggi('web/app.js');
  const css = leggi('web/app.css');
  for (const kind of CONTROL_KINDS) {
    if (kind === 'button' || kind === 'slider') continue;   // hanno il markup storico
    assert.ok(app.includes(`case '${kind}':`), `manca il markup del tipo "${kind}"`);
    assert.match(css, new RegExp(`\\.ctl-${kind}[\\s.,{:]`), `manca lo stile del tipo "${kind}"`);
  }
});

test('client: ogni kind ha nome e spiegazione nelle due lingue', () => {
  const i18n = leggi('web/i18n.js');
  for (const kind of CONTROL_KINDS) {
    const nome = (i18n.match(new RegExp(`'edit\\.kindName\\.${kind}'`, 'g')) ?? []).length;
    const aiuto = (i18n.match(new RegExp(`'edit\\.kindHint\\.${kind}'`, 'g')) ?? []).length;
    assert.equal(nome, 2, `"${kind}" deve avere un nome in italiano e in inglese`);
    assert.equal(aiuto, 2, `"${kind}" deve avere una spiegazione in italiano e in inglese`);
  }
});

test('client: manopole e rotelle mandano scarti, la tavoletta una coppia', () => {
  const app = leggi('web/app.js');
  assert.ok(app.includes('function rotateCtl'), 'manca il gesto della manopola');
  assert.match(app, /pressButton\(gesture\.element, \{ delta: verso \}\)/, 'la rotella deve mandare uno scarto');
  assert.match(app, /delta !== undefined \? \{ delta \}/, 'il client deve saper inviare delta');
  assert.match(app, /x !== undefined && y !== undefined \? \{ x, y \}/, 'x e y devono viaggiare insieme');
});

test('client: i comandi di sola lettura non fanno partire un gesto', () => {
  const app = leggi('web/app.js');
  // Il ramo deve esserci PRIMA di qualunque invio: un quadrante toccato deve
  // lasciar passare lo swipe fra pagine, non premere.
  assert.match(app, /READONLY_KINDS\.includes\(kind\)[\s\S]{0,200}kind: 'swipe'/);
});

test('client: l\u2019elenco dei tipi di sola lettura e\u2019 lo stesso dell\u2019host', () => {
  const app = leggi('web/app.js');
  const riga = app.match(/const READONLY_KINDS = \[(.*?)\]/s);
  assert.ok(riga, 'il client deve dichiarare i tipi di sola lettura');
  const nelClient = riga[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
  assert.deepEqual(nelClient, READONLY_KINDS, 'host e client devono essere d\u2019accordo su cosa non si preme');
});

test('client: la larghezza predefinita e’ la stessa dell’host, verticale compreso', () => {
  // Se le due funzioni divergono, l'editor salva uno span che l'host non si
  // aspetta: il controllo passa la validazione e poi sfonda la griglia.
  const app = leggi('web/app.js');
  const sorgente = app.match(/function kindDefaultSpan\([\s\S]*?\n\}/);
  assert.ok(sorgente, 'il client deve dichiarare kindDefaultSpan');
  // eslint-disable-next-line no-new-func -- si esegue la funzione del client cosi' com'e'
  const clientSpan = new Function(`${sorgente[0]}\nreturn kindDefaultSpan;`)();
  for (const kind of CONTROL_KINDS) {
    for (const orientation of ['h', 'v', undefined]) {
      assert.equal(
        clientSpan(kind, orientation ?? 'h'),
        defaultSpan(kind, orientation),
        `${kind} (${orientation ?? 'senza orientamento'})`
      );
    }
  }
});

// ------------------------------------------------------------------ stili

test('stile: e\u2019 un\u2019impostazione separata dal chiaro/scuro', () => {
  assert.equal(DEFAULT_SETTINGS.ui.style, 'default');
  assert.ok(UI_STYLES.includes('default'));
  const deck = rawDeck();
  deck.settings = { ...(deck.settings ?? {}), ui: { style: 'inventato' } };
  assert.equal(validateDeck(deck, { actionTypes: TIPI }).valid, false);
  deck.settings.ui.style = 'console';
  assert.equal(validateDeck(deck, { actionTypes: TIPI }).valid, true);
});

test('stile: ogni stile dichiarato ha davvero i suoi token nel CSS', () => {
  const css = leggi('web/app.css');
  for (const stile of UI_STYLES) {
    if (stile === 'default') continue;
    assert.ok(css.includes(`[data-style='${stile}']`), `lo stile "${stile}" non ha token nel CSS`);
  }
});

test('stile: ogni stile porta il proprio carattere', () => {
  // Il carattere e' un token come i colori. Sono pile di caratteri di SISTEMA:
  // il deck si apre da una rete locale che puo' non avere internet, e un
  // carattere che non arriva e' una pagina che salta all'occhio.
  const css = leggi('web/app.css');
  assert.match(css, /^\s*--font:/m, 'manca il carattere predefinito sul :root');
  for (const stile of UI_STYLES) {
    if (stile === 'default') continue;
    const blocco = css.split(`[data-style='${stile}'] {`)[1]?.split('}')[0] ?? '';
    assert.match(blocco, /--font:/, `lo stile "${stile}" non dichiara il proprio carattere`);
  }
  // Nessun @font-face: se un giorno se ne imbarca uno, va anche messo nella
  // cache del service worker, altrimenti la prima apertura offline lo perde.
  if (css.includes('@font-face')) {
    assert.match(leggi('web/sw.js'), /fonts\//, 'un carattere imbarcato va anche nella cache di sw.js');
  }
});

test('stile: ogni stile ha un nome nelle due lingue', () => {
  const i18n = leggi('web/i18n.js');
  for (const stile of UI_STYLES) {
    const chiave = 'settings.style' + stile.charAt(0).toUpperCase() + stile.slice(1);
    const quante = (i18n.match(new RegExp(`'${chiave}'`, 'g')) ?? []).length;
    assert.equal(quante, 2, `lo stile "${stile}" deve avere un nome in italiano e in inglese`);
  }
});
