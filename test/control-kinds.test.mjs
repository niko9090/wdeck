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

// -------------------------------------------------- lo swipe sopra un cursore

test('cursore: solo quello verticale cede il gesto allo swipe fra pagine', () => {
  // Un cursore verticale che si prende anche i trascinamenti orizzontali
  // intrappola il dito: sfogliare le pagine diventa impossibile appena il deck
  // ne contiene uno. Quello orizzontale invece deve tenerseli, e' il suo gesto.
  const app = leggi('web/app.js');
  const sorgente = app.match(/function sliderBecomesSwipe\([\s\S]*?\n\}/);
  assert.ok(sorgente, 'il client deve dichiarare sliderBecomesSwipe');
  // eslint-disable-next-line no-new-func -- si esegue la funzione del client cosi' com'e'
  const diventaSwipe = new Function(`${sorgente[0]}\nreturn sliderBecomesSwipe;`)();

  // Verticale: di lato e' uno swipe, in su e in giu' resta una regolazione.
  assert.equal(diventaSwipe(true, 40, 3), true, 'verticale, trascinato di lato');
  assert.equal(diventaSwipe(true, -40, 3), true, 'verticale, di lato all’indietro');
  assert.equal(diventaSwipe(true, 3, 40), false, 'verticale, tirato in su');
  assert.equal(diventaSwipe(true, 30, 45), false, 'verticale, piu’ in alto che di lato');
  // La soglia: il tremolio del dito non deve far scappare la pagina.
  assert.equal(diventaSwipe(true, 12, 0), false, 'dodici pixel non bastano');
  assert.equal(diventaSwipe(true, 13, 0), true, 'oltre la soglia');
  // Orizzontale: non cede mai.
  for (const [dx, dy] of [[40, 3], [-40, 3], [3, 40], [200, 0]]) {
    assert.equal(diventaSwipe(false, dx, dy), false, `orizzontale ${dx},${dy}`);
  }
});

test('cursore: alla pressione il valore si disegna ma non si spedisce', () => {
  // Se partisse subito, un dito appoggiato su un cursore verticale per
  // sfogliare le pagine avrebbe gia' cambiato il volume del PC prima ancora di
  // essersi mosso — e la rinuncia al gesto non potrebbe piu' rimediare.
  const app = leggi('web/app.js');
  assert.match(
    app,
    /applySliderFromPointer\(slider, event\.clientX, event\.clientY, \{ send: false \}\)/,
    'il pointerdown sul cursore deve disegnare senza spedire'
  );
  assert.match(app, /function abandonSlider\(/, 'serve la rinuncia che rimette il valore com’era');
  assert.match(
    app,
    /function applySliderFromPointer\(slider, clientX, clientY, \{ send = true \} = \{\}\)/,
    'applySliderFromPointer deve accettare send'
  );
});

test('cursore: sotto al dito la transizione e’ tolta', () => {
  // Ammorbidire ogni movimento significa che il riempimento insegue il dito con
  // 90 ms di ritardo: in un trascinamento veloce non lo raggiunge mai e il
  // cursore sembra lento e scollato dalla mano.
  const css = leggi('web/app.css');
  assert.match(css, /\.deck-slider\.live \.slider-fill\s*\{[^}]*transition:\s*none/,
    'serve una regola che tolga la transizione mentre si trascina');
  const app = leggi('web/app.js');
  assert.match(app, /slider\.classList\.add\('live'\)/, 'la classe va messa alla pressione');
  assert.match(app, /classList\.remove\('live'\)/, 'e tolta al rilascio');
});

test('cursore: dopo il rilascio l’host non puo’ riportarlo indietro', () => {
  // L'host legge il livello vero a intervalli: alzando il volume da 20 a 100 e
  // togliendo il dito, la lettura partita PRIMA del cambiamento arriva dopo il
  // rilascio e riporterebbe il cursore a 80.
  const app = leggi('web/app.js');
  const sorgente = app.match(/function levelIsHeld\([\s\S]*?\n\}/);
  assert.ok(sorgente, 'il client deve dichiarare levelIsHeld');
  const durata = app.match(/const LEVEL_HOLD_MS = (\d+);/);
  assert.ok(durata, 'serve una durata dichiarata per la difesa del livello');
  assert.ok(Number(durata[1]) >= 500, 'meno di mezzo secondo non copre il giro dell’host');

  const stato = { draggingId: null, levelHold: new Map() };
  // eslint-disable-next-line no-new-func -- si esegue la funzione del client cosi' com'e'
  const held = new Function('state', `${sorgente[0]}\nreturn levelIsHeld;`)(stato);

  assert.equal(held('vol'), false, 'un cursore che nessuno tocca segue l’host');
  stato.draggingId = 'vol';
  assert.equal(held('vol'), true, 'col dito sopra comanda l’utente');
  assert.equal(held('altro'), false, 'la difesa vale solo per quel comando');

  stato.draggingId = null;
  stato.levelHold.set('vol', Date.now() + 1000);
  assert.equal(held('vol'), true, 'subito dopo il rilascio comanda ancora l’utente');
  stato.levelHold.set('vol', Date.now() - 1);
  assert.equal(held('vol'), false, 'scaduta la difesa si torna ad ascoltare il PC');
  assert.equal(stato.levelHold.has('vol'), false, 'la scadenza va tolta dalla mappa');
});

// ------------------------------------------------- banner dell'aggiornamento

test('aggiornamento: non si propone una versione gia’ in esecuzione', () => {
  // L'host calcola `available` PRIMA di aggiornarsi e la risposta resta in
  // memoria nel client: dopo l'aggiornamento il banner continuava a proporre la
  // versione appena installata, e il distintivo — che mostra la versione
  // proposta accanto a quella in esecuzione — faceva vedere due versioni
  // uguali vicino al nome dell'app.
  const app = leggi('web/app.js');
  const sorgenti = [
    app.match(/function compareVersions\([\s\S]*?\n\}/),
    app.match(/function updateWorthShowing\([\s\S]*?\n\}/)
  ];
  assert.ok(sorgenti[0], 'il client deve dichiarare compareVersions');
  assert.ok(sorgenti[1], 'il client deve dichiarare updateWorthShowing');

  const stato = { version: null };
  // eslint-disable-next-line no-new-func -- si eseguono le funzioni del client cosi' come sono
  const vale = new Function('state', `${sorgenti[0][0]}\n${sorgenti[1][0]}\nreturn updateWorthShowing;`)(stato);

  const stat = (available, latest, current) => ({ available, current, latest: { version: latest } });

  stato.version = '0.9.0';
  assert.equal(vale(stat(true, '0.10.0', '0.9.0')), true, 'una versione piu’ nuova si propone');

  // Il caso del bug: l'host si e' aggiornato, lo stato in memoria e' vecchio.
  stato.version = '0.10.0';
  assert.equal(vale(stat(true, '0.10.0', '0.9.0')), false, 'la versione gia’ in esecuzione non si propone');
  assert.equal(vale(stat(true, '0.9.0', '0.9.0')), false, 'ne’ una piu’ vecchia');

  // 0.10.0 e' piu' nuova di 0.9.0: il confronto e' per numero, non per testo.
  assert.ok(new Function(`${sorgenti[0][0]}\nreturn compareVersions;`)()('0.10.0', '0.9.0') > 0,
    '0.10.0 deve risultare piu’ nuova di 0.9.0');

  stato.version = null;
  assert.equal(vale(stat(false, '0.11.0', '0.10.0')), false, 'senza available non si propone nulla');
  assert.equal(vale({ available: true, current: '0.10.0' }), false, 'senza la versione proposta non si propone nulla');
});


// -------------------------------- il client vecchio rimasto in cache (Ctrl+R)

/**
 * Monta `checkClientFreshness`/`freshnessRun` del client con tutto cio' che
 * toccano sostituito da finte, compresi l'orologio (per provare il freno fra
 * due controlli) e la risposta di /api/health (che cambia quando l'host si
 * aggiorna). Restituisce la funzione e il diario di quello che e' successo.
 */
function bancoFreschezza({ mine, editing = false, gia = null }) {
  const app = leggi('web/app.js');
  const wrapper = app.match(/async function checkClientFreshness\([\s\S]*?\n\}/);
  const corpo = app.match(/async function freshnessRun\([\s\S]*?\n\}\n/);
  assert.ok(wrapper, 'il client deve dichiarare checkClientFreshness');
  assert.ok(corpo, 'il client deve dichiarare freshnessRun');

  const diario = { ricariche: 0, toast: [], cacheTolte: 0, disiscrizioni: 0, health: 0 };
  const sessione = new Map();
  if (gia) sessione.set('wdeck.stale', gia);
  const state = { version: null, update: null, editing };
  const banco = {
    diario, sessione, state,
    orologio: 1_700_000_000_000,
    /** risposta di /api/health: la si cambia per simulare l'host aggiornato */
    salute: { ok: true, data: { buildId: mine, version: '0.10.0' } }
  };

  const ambiente = {
    state,
    Date: { now: () => banco.orologio },
    document: { querySelector: () => ({ content: mine }) },
    ENDPOINTS: { health: '/api/health' },
    api: async () => { diario.health += 1; return banco.salute; },
    renderVersion: () => {},
    showUpdate: () => {},
    checkUpdate: () => {},
    maybeWhatsNew: () => {},
    toast: (testo) => diario.toast.push(testo),
    t: (chiave) => chiave,
    sessionStorage: {
      getItem: (k) => (sessione.has(k) ? sessione.get(k) : null),
      setItem: (k, v) => sessione.set(k, v),
      removeItem: (k) => sessione.delete(k)
    },
    window: { caches: true },
    caches: {
      keys: async () => ['wdeck-shell-vecchia'],
      delete: async () => { diario.cacheTolte += 1; return true; }
    },
    navigator: {
      serviceWorker: {
        getRegistration: async () => ({ unregister: async () => { diario.disiscrizioni += 1; } })
      }
    },
    location: { reload: () => { diario.ricariche += 1; } }
  };

  const nomi = Object.keys(ambiente);
  // eslint-disable-next-line no-new-func -- si esegue il codice del client cosi' com'e'
  const fabbrica = new Function(...nomi, `
    let freshnessBusy = false;
    let lastFreshness = 0;
    let staleReloadPending = false;
    let lastAutoCheck = 0;
    ${wrapper[0]}
    ${corpo[0]}
    return checkClientFreshness;
  `);
  banco.check = fabbrica(...nomi.map((n) => ambiente[n]));
  return banco;
}

test('client stantio: si ricontrolla a ogni collegamento, non una volta sola', async () => {
  // IL difetto segnalato dall'utente: l'host si aggiorna MENTRE il client e'
  // aperto. Il primo controllo (host ancora vecchio) dice "tutto a posto"; poi
  // l'host riparte con una build nuova e il client si ricollega. Finche' il
  // controllo era uno solo per caricamento, nessuno se ne accorgeva piu' e
  // restava una pagina vecchia: l'utente doveva fare Ctrl+R a mano, in mezzo a
  // due versioni.
  const banco = bancoFreschezza({ mine: 'build-A' });

  await banco.check();
  assert.equal(banco.diario.health, 1, 'primo collegamento: si controlla');
  assert.equal(banco.diario.ricariche, 0, 'client allineato: nessuna ricarica');

  // L'host si aggiorna e riparte; il client si ricollega piu' tardi.
  banco.salute = { ok: true, data: { buildId: 'build-B', version: '0.10.1' } };
  banco.orologio += 30_000;
  await banco.check();

  assert.equal(banco.diario.health, 2, 'alla riconnessione si ricontrolla');
  assert.equal(banco.diario.ricariche, 1, 'build diversa: il client si ricarica da solo');
  assert.ok(banco.diario.cacheTolte > 0, 'prima svuota la cache del guscio');
  assert.equal(banco.diario.disiscrizioni, 1, 'e disiscrive il service worker vecchio');
  assert.equal(banco.sessione.get('wdeck.stale'), 'build-B', 'segna il tentativo');
});

test('client stantio: le riconnessioni a raffica non moltiplicano i controlli', async () => {
  const banco = bancoFreschezza({ mine: 'build-A' });
  await banco.check();
  banco.orologio += 1_000; // meno di 5 secondi: l'host sta ancora ripartendo
  await banco.check();
  assert.equal(banco.diario.health, 1, 'il freno evita una raffica di controlli');
  banco.orologio += 6_000;
  await banco.check();
  assert.equal(banco.diario.health, 2, 'ma passato il freno si ricontrolla');
});

test('client stantio: nessuna ricarica a sorpresa mentre si modifica il deck', async () => {
  const banco = bancoFreschezza({ mine: 'build-A', editing: true });
  banco.salute = { ok: true, data: { buildId: 'build-B', version: '0.10.1' } };
  await banco.check();
  assert.equal(banco.diario.ricariche, 0, 'in modifica non si ricarica');
  assert.ok(banco.diario.toast.includes('update.reloadReady'), 'ma si avvisa');
  assert.equal(banco.sessione.has('wdeck.stale'), false,
    'e non si consuma il tentativo: la ricarica va fatta uscendo dalla modifica');
});

test('client stantio: sulla stessa build non si ricarica una seconda volta', async () => {
  const banco = bancoFreschezza({ mine: 'build-A', gia: 'build-B' });
  banco.salute = { ok: true, data: { buildId: 'build-B', version: '0.10.1' } };
  await banco.check();
  assert.equal(banco.diario.ricariche, 0, 'nessun ciclo di ricariche');
  assert.ok(banco.diario.toast.includes('update.reloadReady'), 'si avvisa e basta');
});

test('client stantio: host irraggiungibile non provoca ricariche', async () => {
  const banco = bancoFreschezza({ mine: 'build-A' });
  banco.salute = { ok: false };
  await banco.check();
  assert.equal(banco.diario.ricariche, 0, 'senza risposta non si conclude nulla');
});

test('setEditing rimanda la ricarica segnata durante la modifica', () => {
  // Il rinvio serve a qualcosa solo se qualcuno lo riprende: uscendo dalla
  // modifica il client deve rifare il controllo (col freno azzerato).
  const app = leggi('web/app.js');
  const setEditing = app.match(/function setEditing\([\s\S]*?\n\}/)[0];
  assert.match(setEditing, /staleReloadPending/, 'setEditing deve riprendere la ricarica rimandata');
  assert.match(setEditing, /lastFreshness = 0/, 'e azzerare il freno, altrimenti il controllo viene saltato');
  assert.match(setEditing, /checkClientFreshness\(\)/);
});
