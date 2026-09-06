/**
 * La pagina "Novita'" del deck: una pagina di prova con un esempio di ogni
 * cosa che Wdeck sa fare, aggiornata A OGNI VERSIONE.
 *
 * L'utente l'ha chiesto esplicitamente ("devi tenerla aggiornata con le
 * novita' di ogni release"): quindi non e' piu' una pagina scritta a mano
 * nel suo deck.json, ma vive QUI, con un nome che porta la versione. All'avvio
 * l'host confronta il nome: se il deck ha una Novita' vecchia, la sostituisce
 * (pagina e sotto-pagina della cartella), lasciando intatto tutto il resto.
 * Chi non ha una pagina `novita` non se la vede comparire.
 *
 * Regola per chi aggiunge una funzione: metterne un esempio qui e alzare
 * NOVITA_VERSION. Il test `test/novita-sysinfo.test.mjs` valida le pagine
 * contro lo schema e il registro delle azioni, cosi' non si spedisce mai una
 * pagina che l'host rifiuterebbe.
 */

export const NOVITA_VERSION = '0.11';
export const NOVITA_PAGE_ID = 'novita';
export const NOVITA_FOLDER_ID = 'novita-cartella';

const BLU = '#1f6feb';
const VERDE = '#3fb950';
const GIALLO = '#c9a227';
const VIOLA = '#7c5cff';
const ARANCIO = '#e0603a';
const GRIGIO = '#2d3b55';

const notify = (message, title = 'Wdeck') => ({ type: 'notify', params: { title, message } });
const noop = () => ({ type: 'noop', params: {} });
const sysinfo = (metric) => ({ type: 'sysinfo', params: { metric } });

/** La pagina principale delle novita' (6 righe x 5 colonne). */
export function novitaPage() {
  return {
    id: NOVITA_PAGE_ID,
    name: `Novita' ${NOVITA_VERSION}`,
    rows: 6,
    cols: 5,
    groups: [
      { id: 'audio', label: 'Audio', color: BLU },
      { id: 'sistema', label: 'Sistema', color: VERDE }
    ],
    buttons: [
      // --- riga 0: cursori ---------------------------------------------
      { id: 'nv-vol-h', label: 'Volume', row: 0, col: 0, kind: 'slider', span: 2, color: BLU, min: 0, max: 100, step: 1, orientation: 'h', group: 'audio', action: { type: 'volume', params: { mode: 'set' } } },
      { id: 'nv-vol-v', label: 'Fader', row: 0, col: 2, kind: 'slider', color: BLU, min: 0, max: 100, step: 1, orientation: 'v', group: 'audio', action: { type: 'volume', params: { mode: 'set' } } },
      { id: 'nv-luce', label: 'Luce', row: 0, col: 3, kind: 'slider', color: GIALLO, min: 0, max: 100, step: 5, orientation: 'v', action: { type: 'brightness', params: { mode: 'set' } } },
      { id: 'nv-centrato', label: 'Centrato', row: 0, col: 4, kind: 'slider', color: VIOLA, min: -50, max: 50, step: 5, orientation: 'v', center: true, action: noop() },
      // --- riga 1: manopole e passi -------------------------------------
      { id: 'nv-manopola', label: 'Volume', row: 1, col: 0, kind: 'encoder', color: BLU, min: 0, max: 100, step: 2, group: 'audio', action: { type: 'volume', params: { mode: 'set' } } },
      { id: 'nv-jog', label: 'Scorri', row: 1, col: 1, kind: 'jog', color: GRIGIO, action: { type: 'mouse', params: { action: 'wheel' } } },
      { id: 'nv-zoom', label: 'Zoom', row: 1, col: 2, kind: 'stepper', color: VERDE, min: 0, max: 100, step: 1, action: { type: 'hotkey', params: { keys: 'ctrl++', keysBack: 'ctrl+-' } } },
      { id: 'nv-selettore', label: 'Scena', row: 1, col: 3, kind: 'selector', color: VIOLA, options: ['Lavoro', 'Gioco', 'Film'], action: noop() },
      { id: 'nv-timer', label: 'Pausa 5m', row: 1, col: 4, kind: 'timer', color: GIALLO, seconds: 300, action: notify('Tempo scaduto') },
      // --- riga 2: tavoletta, matrice, colore ---------------------------
      { id: 'nv-tavoletta', label: 'Puntatore', row: 2, col: 0, kind: 'xy', span: 2, color: ARANCIO, action: { type: 'mouse', params: { action: 'move' } } },
      { id: 'nv-matrice', label: 'Matrice', row: 2, col: 2, kind: 'pad', span: 2, color: GRIGIO, rows: 3, cols: 3, action: noop() },
      { id: 'nv-colore', label: 'Colore', row: 2, col: 4, kind: 'color', color: VIOLA, mode: 'kelvin', action: noop() },
      // --- riga 3: sola lettura, DATI VERI del PC (gruppo Sistema) ------
      { id: 'nv-quadrante', label: 'CPU', row: 3, col: 0, kind: 'gauge', color: VERDE, group: 'sistema', action: sysinfo('cpu') },
      { id: 'nv-livello', label: 'Memoria', row: 3, col: 1, kind: 'meter', color: VERDE, group: 'sistema', action: sysinfo('ram') },
      { id: 'nv-grafico', label: 'Rete', row: 3, col: 2, kind: 'chart', span: 2, color: BLU, group: 'sistema', min: 0, max: 100, action: sysinfo('netDown') },
      { id: 'nv-display', label: 'Ora', row: 3, col: 4, kind: 'display', color: GRIGIO, group: 'sistema', action: sysinfo('clock') },
      // --- riga 4: macro, momentaneo, scorciatoie, cartella --------------
      { id: 'nv-macro', label: 'Copia-incolla', row: 4, col: 0, kind: 'macro', color: ARANCIO, action: { type: 'sequence', params: { steps: [{ type: 'hotkey', params: { keys: 'ctrl+c' } }, { type: 'delay', params: { ms: 120 } }, { type: 'hotkey', params: { keys: 'ctrl+v' } }] } } },
      { id: 'nv-ptt', label: 'Parla', row: 4, col: 1, icon: 'mic', color: VERDE, action: { type: 'mic', params: { mute: false } }, releaseAction: { type: 'mic', params: { mute: true } } },
      { id: 'nv-punteggiatura', label: 'Ctrl +', row: 4, col: 2, color: GRIGIO, action: { type: 'hotkey', params: { keys: 'ctrl++' } } },
      { id: 'nv-hold', label: 'Tocca/Tieni', row: 4, col: 3, color: VIOLA, action: notify('Tocco breve'), holdAction: notify('Tenuto premuto') },
      { id: 'nv-cartella', label: 'Cartella', row: 4, col: 4, kind: 'folder', color: GIALLO, action: { type: 'navigate', params: { page: NOVITA_FOLDER_ID } } },
      // --- riga 5: novita' 0.11 ----------------------------------------
      { id: 'nv-notifica', label: 'Notifica', row: 5, col: 0, icon: 'bell', color: VIOLA, action: notify('Questa e\' una notifica di Windows, dal centro notifiche.') },
      { id: 'nv-disco', label: 'Disco', row: 5, col: 1, kind: 'gauge', color: VERDE, action: sysinfo('disk') },
      { id: 'nv-acceso', label: 'Acceso da', row: 5, col: 2, kind: 'display', color: GRIGIO, action: sysinfo('uptime') },
      { id: 'nv-blocco-note', label: 'Blocco note', row: 5, col: 3, icon: 'text', color: GRIGIO, action: { type: 'launch', params: { path: 'C:\\Windows\\System32\\notepad.exe' } } },
      { id: 'nv-desktop', label: 'Desktop', row: 5, col: 4, icon: 'window', color: GRIGIO, action: { type: 'hotkey', params: { keys: 'win+d' } } }
    ]
  };
}

/** Il contenuto della cartella di prova (si apre dal tasto "Cartella"). */
export function novitaFolderPage() {
  return {
    id: NOVITA_FOLDER_ID,
    name: 'Cartella',
    parent: NOVITA_PAGE_ID,
    rows: 2,
    cols: 3,
    buttons: [
      { id: 'nvc-ciao', label: 'Ciao', row: 0, col: 0, icon: 'heart', color: VIOLA, action: notify('Ciao dalla cartella') },
      { id: 'nvc-wdeck', label: 'Sito Wdeck', row: 0, col: 1, icon: 'globe', color: BLU, action: { type: 'url', params: { url: 'https://github.com/niko9090/wdeck' } } },
      { id: 'nvc-ora', label: 'Ora', row: 0, col: 2, kind: 'display', color: GRIGIO, action: sysinfo('clock') },
      { id: 'nvc-alto', label: 'Alto 2 righe', row: 1, col: 0, kind: 'slider', orientation: 'v', color: GIALLO, min: 0, max: 100, step: 5, action: { type: 'brightness', params: { mode: 'set' } } }
    ]
  };
}

// Il tile "alto 2 righe" ha bisogno di due righe: nella cartella (2 righe)
// parte dalla riga 0. Lo si sistema qui per non sbagliare i conti a mano.
export function novitaPages() {
  const folder = novitaFolderPage();
  const alto = folder.buttons.find((b) => b.id === 'nvc-alto');
  alto.row = 0;
  alto.col = 0;
  folder.buttons = folder.buttons.filter((b) => b.id !== 'nvc-ciao').map((b) => (b.id === 'nvc-wdeck' ? { ...b, col: 1 } : b));
  alto.spanRows = 2;
  folder.buttons.push({ id: 'nvc-ciao', label: 'Ciao', row: 1, col: 1, icon: 'heart', color: VIOLA, action: notify('Ciao dalla cartella') });
  return [novitaPage(), folder];
}

/**
 * Sostituisce nel deck (grezzo, come nel file) la pagina Novita' vecchia con
 * quella di questa versione. Non tocca nient'altro. Torna `changed: false`
 * se la pagina non c'e' o e' gia' quella giusta.
 * @param {object} raw deck.json cosi' com'e' su disco
 * @returns {{changed: boolean, deck: object, version: string}}
 */
export function ensureNovitaPage(raw) {
  const [main, folder] = novitaPages();
  let changed = false;
  const deck = JSON.parse(JSON.stringify(raw));
  for (const profile of deck.profiles ?? []) {
    if (!Array.isArray(profile.pages)) continue;
    const index = profile.pages.findIndex((p) => p?.id === NOVITA_PAGE_ID);
    if (index === -1) continue;
    if (profile.pages[index]?.name === main.name) continue;
    profile.pages[index] = main;
    profile.pages = profile.pages.filter((p) => p?.id !== NOVITA_FOLDER_ID);
    profile.pages.splice(index + 1, 0, folder);
    changed = true;
  }
  return { changed, deck, version: NOVITA_VERSION };
}
