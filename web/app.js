/**
 * Wdeck - client web PWA.
 *
 * Nessun framework, nessuna build step complessa: moduli ES nativi.
 * Il protocollo e' condiviso con l'host tramite /shared/protocol.mjs.
 */

import { ENDPOINTS, MSG } from '/shared/protocol.mjs';
import { CUSTOM_PREFIX, EMOJI_PREFIX, ICONS, iconMarkup, iconSvg, isEmojiIcon } from './icons.js';
import { language, setLanguage, t } from './i18n.js';
import { PRESETS, PRESET_CATEGORIES } from './presets.js';
import { WHATSNEW } from './whatsnew.js';

const STORAGE = {
  hosts: 'wdeck.hosts',
  active: 'wdeck.active',
  profile: 'wdeck.profile',
  page: 'wdeck.page',
  // segna che il benvenuto al primo avvio e' gia' stato mostrato
  welcomed: 'wdeck.welcomed',
  // chiavi della versione precedente, lette una volta sola per non perdere
  // il pairing di chi aggiorna da una versione con un solo host
  legacyToken: 'wdeck.token',
  legacyBase: 'wdeck.base'
};

const el = (id) => document.getElementById(id);

const ui = {
  gate: el('gate'),
  gateHost: el('gate-host'),
  gatePin: el('gate-pin'),
  gatePair: el('gate-pair'),
  gateToken: el('gate-token'),
  gateTokenSave: el('gate-token-save'),
  gateError: el('gate-error'),
  app: el('app'),
  deckName: el('deck-name'),
  version: el('app-version'),
  dot: el('status-dot'),
  dryBadge: el('dry-badge'),
  update: el('btn-update'),
  banner: el('update-banner'),
  bannerText: el('ub-text'),
  profileSelect: el('profile-select'),
  hosts: el('hosts'),
  pages: el('pages'),
  groupLegend: el('group-legend'),
  grid: el('grid'),
  statusText: el('status-text'),
  lastAction: el('last-action'),
  toast: el('toast'),
  sheet: el('sheet'),
  sheetTitle: el('sheet-title'),
  sheetBody: el('sheet-body'),
  sheetFoot: el('sheet-foot'),
  btnEdit: el('btn-edit'),
  btnSimulate: el('btn-simulate'),
  btnFullscreen: el('btn-fullscreen'),
  btnSettings: el('btn-settings')
};

const state = {
  /** @type {Array<{id: string, base: string, token: string, name: string}>} */
  hosts: [],
  activeHostId: null,
  deck: null,
  hostState: null,
  profileId: null,
  pageId: null,
  simulate: false,
  editing: false,
  socket: null,
  connected: false,
  retry: 0,
  requestSeq: 0,
  pending: new Map(),
  /** azioni disponibili sull'host, caricate alla prima apertura dell'editor */
  actionGroups: null,
  /** icone caricate dall'utente su questo host, lette all'apertura dell'editor */
  customIcons: null,
  /** script aggiunti dall'utente (cartella scripts), per i suggerimenti nell'editor */
  scripts: null,
  /** ultimo livello noto di ogni slider, per non farlo saltare al re-render */
  levels: new Map(),
  /** stato reale dei controlli letto dall'host: id -> {on, level, text} */
  statuses: {},
  /** cursore attualmente sotto il dito: non va riallineato dall'host */
  draggingId: null,
  update: null,
  /** versione dell'host in esecuzione, mostrata nella barra in alto */
  version: null,
  /** true finche' ha senso ritentare la connessione (falso dopo un token scaduto) */
  shouldReconnect: true,
  /** timer del prossimo tentativo di riconnessione, cancellabile */
  reconnectTimer: null
};

const activeHost = () => state.hosts.find((h) => h.id === state.activeHostId) ?? null;
const baseUrl = () => activeHost()?.base ?? location.origin;
const token = () => activeHost()?.token ?? null;

/**
 * URL di un'icona caricata dall'utente.
 * Il token viaggia in querystring perche' un tag <img> non puo' portare header.
 */
const customIconUrl = (name) => `${baseUrl()}${ENDPOINTS.iconFile}?name=${encodeURIComponent(name)}`
  + `&token=${encodeURIComponent(token() ?? '')}`;

/** Markup dell'icona di un controllo, glifo incluso o file caricato. */
const controlIcon = (button) => iconMarkup(button.icon, button.action?.type, customIconUrl);

// ---------------------------------------------------------------- utilita'

function toast(message, kind = '') {
  ui.toast.textContent = message;
  ui.toast.className = `toast ${kind}`.trim();
  // Gli errori interrompono il lettore di schermo (assertive); il resto attende
  // una pausa (polite): un toast informativo non deve tagliare la parola.
  const urgent = kind === 'err';
  ui.toast.setAttribute('role', urgent ? 'alert' : 'status');
  ui.toast.setAttribute('aria-live', urgent ? 'assertive' : 'polite');
  ui.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { ui.toast.hidden = true; }, kind === 'err' ? 5200 : 3200);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

/**
 * Colore CSS accettato in un attributo `style`.
 *
 * Il deck arriva dall'host: un valore libero potrebbe chiudere lo `style` e
 * iniettare altro. Si consentono solo `#rgb`/`#rrggbb(aa)` e i nomi CSS
 * semplici (sole lettere); tutto il resto diventa stringa vuota.
 */
function cssColor(value) {
  const v = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) || /^[a-zA-Z]+$/.test(v) ? v : '';
}

function setStatus(stateName, text) {
  ui.dot.dataset.state = stateName;
  ui.statusText.textContent = text;
}

async function api(path, { method = 'GET', body, base = baseUrl(), authToken = token() } = {}) {
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'x-wdeck-token': authToken } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    // Connessione caduta o host irraggiungibile: la fetch rigetta invece di
    // rispondere. Si restituisce un esito uniforme (status 0) cosi' chi chiama
    // gestisce l'errore come un normale `!res.ok` senza dover try/catch.
    return { status: 0, ok: false, data: {} };
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

/** Vero quando l'esito indica un problema di rete, non una risposta dell'host. */
const isOffline = (res) => res.status === 0;

// ---------------------------------------------------------------- computer salvati

/** Carica la lista dei computer, migrando l'eventuale pairing singolo precedente. */
function loadHosts() {
  let hosts = [];
  try {
    hosts = JSON.parse(localStorage.getItem(STORAGE.hosts) ?? '[]');
  } catch {
    hosts = [];
  }
  if (!Array.isArray(hosts)) hosts = [];

  const legacyToken = localStorage.getItem(STORAGE.legacyToken);
  if (legacyToken && hosts.length === 0) {
    hosts.push({
      id: `h${Date.now()}`,
      base: localStorage.getItem(STORAGE.legacyBase) || location.origin,
      token: legacyToken,
      name: 'Questo PC'
    });
    localStorage.removeItem(STORAGE.legacyToken);
  }

  state.hosts = hosts;
  state.activeHostId = localStorage.getItem(STORAGE.active) ?? hosts[0]?.id ?? null;
  if (!state.hosts.some((h) => h.id === state.activeHostId)) {
    state.activeHostId = hosts[0]?.id ?? null;
  }
}

function saveHosts() {
  localStorage.setItem(STORAGE.hosts, JSON.stringify(state.hosts));
  if (state.activeHostId) localStorage.setItem(STORAGE.active, state.activeHostId);
}

/** Aggiunge (o aggiorna) un computer e vi si collega. */
function upsertHost({ base, token: hostToken, name }) {
  const normalized = base.replace(/\/+$/, '');
  const existing = state.hosts.find((h) => h.base === normalized);
  if (existing) {
    existing.token = hostToken;
    if (name) existing.name = name;
    state.activeHostId = existing.id;
  } else {
    const entry = { id: `h${Date.now()}`, base: normalized, token: hostToken, name: name || normalized };
    state.hosts.push(entry);
    state.activeHostId = entry.id;
  }
  saveHosts();
}

function switchHost(id) {
  if (id === state.activeHostId) return;
  state.activeHostId = id;
  state.deck = null;
  state.hostState = null;
  state.profileId = null;
  state.pageId = null;
  state.levels.clear();
  state.statuses = {};
  state.actionGroups = null;
  state.customIcons = null;
  saveHosts();
  renderHosts();
  ui.grid.innerHTML = '';
  connect();
}

function renderHosts() {
  // Con un solo computer la barra e' rumore: compare da due in su.
  if (state.hosts.length < 2) {
    ui.hosts.hidden = true;
    ui.hosts.innerHTML = '';
    return;
  }
  ui.hosts.hidden = false;
  ui.hosts.innerHTML = state.hosts
    .map((h) => `<button class="host-tab" type="button" role="tab" data-host="${h.id}" aria-selected="${h.id === state.activeHostId}">`
      + `<span class="host-dot"${h.id === state.activeHostId && state.connected ? ' data-on="1"' : ''}></span>${escapeHtml(h.name)}</button>`)
    .join('') + `<button class="host-tab add" type="button" data-host-add="1" title="${t('top.addComputer')}">+</button>`;
}

// ---------------------------------------------------------------- gate

function showGate(message = '') {
  ui.app.hidden = true;
  ui.gate.hidden = false;
  ui.gateHost.value = activeHost()?.base ?? location.origin;
  ui.gateError.textContent = message;
}

/**
 * Nome con cui questo dispositivo si presenta all'host.
 *
 * Non c'e' modo di leggere il nome vero del telefono da una pagina web: si
 * ricava dallo user agent, che almeno distingue un Android da un iPad da un PC.
 */
function deviceName() {
  const ua = navigator.userAgent ?? '';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Telefono Android' : 'Tablet Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'PC Windows';
  if (/Linux/i.test(ua)) return 'PC Linux';
  return 'Browser';
}

async function pairWithPin() {
  const base = ui.gateHost.value.trim().replace(/\/+$/, '') || location.origin;
  const pin = ui.gatePin.value.trim();
  ui.gateError.textContent = '';
  if (!pin) {
    ui.gateError.textContent = t('gate.pinMissing');
    return;
  }
  try {
    const res = await fetch(`${base}${ENDPOINTS.pair}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Il nome serve a riconoscere questo dispositivo nell'elenco dell'host,
      // per poterlo revocare da solo se un giorno va perso.
      body: JSON.stringify({ pin, name: deviceName() })
    });
    const data = await res.json();
    if (!res.ok || !data.token) {
      ui.gateError.textContent = data?.error?.message ?? t('gate.rejected');
      return;
    }
    await finishPairing(base, data.token);
  } catch (err) {
    ui.gateError.textContent = t('gate.unreachable', { message: err.message });
  }
}

/** Chiede all'host il proprio nome, cosi' le schede dei computer sono leggibili. */
async function finishPairing(base, hostToken) {
  let name = base;
  try {
    const health = await api(ENDPOINTS.health, { base, authToken: hostToken });
    if (health.ok) name = health.data.name || health.data.deckName || base;
  } catch {
    // il nome e' un dettaglio: se l'host non risponde si usa l'indirizzo
  }
  upsertHost({ base, token: hostToken, name });
  ui.gatePin.value = '';
  ui.gate.hidden = true;
  ui.app.hidden = false;
  renderHosts();
  connect();
}

function saveManualToken() {
  const base = ui.gateHost.value.trim().replace(/\/+$/, '') || location.origin;
  const manual = ui.gateToken.value.trim();
  if (!manual) {
    ui.gateError.textContent = t('gate.tokenMissing');
    return;
  }
  finishPairing(base, manual);
}

// ---------------------------------------------------------------- WebSocket

function wsUrl() {
  const url = new URL(baseUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = ENDPOINTS.ws;
  url.search = '';
  return url.toString();
}

function connect() {
  // Un tentativo in coda (backoff o evento 'online') non deve accavallarsi a
  // questo: si annulla prima di aprire un socket nuovo.
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;

  if (!token()) {
    showGate();
    return;
  }
  state.shouldReconnect = true;
  if (state.socket) {
    try { state.socket.close(); } catch { /* ignora */ }
  }
  setStatus('connecting', t('status.connecting'));

  const socket = new WebSocket(wsUrl());
  state.socket = socket;

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: MSG.auth, token: token() }));
  });

  socket.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handleMessage(msg);
  });

  socket.addEventListener('close', () => {
    if (socket !== state.socket) return;
    state.connected = false;
    setStatus('offline', t('status.lost'));
    renderHosts();
    // Dopo un token scaduto (showGate da 'unauthorized') non ha senso ritentare:
    // si continuerebbe a battere sull'host che ci ha appena respinti.
    if (!state.shouldReconnect) return;
    const delay = Math.min(1000 * 2 ** state.retry, 15000);
    state.retry += 1;
    state.reconnectTimer = setTimeout(() => {
      if (state.shouldReconnect && token() && socket === state.socket) connect();
    }, delay);
  });

  socket.addEventListener('error', () => setStatus('offline', t('status.error')));
}

function handleMessage(msg) {
  switch (msg.type) {
    case MSG.hello:
      ui.deckName.textContent = msg.name ?? 'Wdeck';
      break;

    case MSG.authOk:
      state.connected = true;
      state.retry = 0;
      setStatus('online', t('status.online'));
      renderHosts();
      autoCheckUpdate();
      checkClientFreshness();
      // Deep-link dalla tray: "#settings" apre le impostazioni, "#update" apre
      // le impostazioni e avvia l'aggiornamento con la barra di avanzamento
      // (cosi' dalla tray si vede la finestra che scarica e installa). Si azzera
      // l'ancora subito, cosi' una riconnessione non la riapre.
      if (location.hash === '#settings' || location.hash === '#update') {
        const vuoleUpdate = location.hash === '#update';
        try { history.replaceState(null, '', location.pathname + location.search); } catch { /* history non disponibile */ }
        if (vuoleUpdate) openUpdateFlow();
        else openSettings();
      }
      break;

    case MSG.deck:
      state.deck = msg.deck;
      if (msg.state) applyState(msg.state);
      applyTheme(msg.deck.ui);
      renderAll();
      break;

    case MSG.state:
      applyState(msg.state);
      renderStatus();
      break;

    case MSG.status:
      state.statuses = msg.states ?? {};
      applyStatuses();
      break;

    case MSG.navigate:
      state.profileId = msg.activeProfile;
      state.pageId = msg.activePage;
      renderAll();
      break;

    case MSG.ack: {
      const pending = state.pending.get(msg.requestId);
      if (pending) {
        state.pending.delete(msg.requestId);
        finishPress(pending, msg.ok, msg.result);
      }
      break;
    }

    case MSG.event:
      if (msg.event === 'press') renderLastAction(msg.data);
      if (msg.event === 'update') showUpdate(msg.data);
      if (msg.event === 'update-progress') renderUpdateProgress(msg.data);
      break;

    case MSG.error:
      if (msg.code === 'unauthorized') {
        state.shouldReconnect = false;
        showGate(t('gate.expired'));
      } else {
        toast(msg.message ?? t('action.error'), 'err');
      }
      break;

    default:
      break;
  }
}

function send(message) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    toast(t('status.notConnected'), 'err');
    return false;
  }
  state.socket.send(JSON.stringify(message));
  return true;
}

// ---------------------------------------------------------------- stato/rendering

function applyState(hostState) {
  state.hostState = hostState;
  // Gli id ripristinati da localStorage possono appartenere a un altro host
  // (piu' computer, stessa app): se non esistono in questo deck vanno scartati,
  // altrimenti finirebbero in un messaggio di navigate verso un profilo/pagina
  // sconosciuti a questo host.
  if (state.deck) {
    if (state.profileId && !state.deck.profiles.some((p) => p.id === state.profileId)) {
      state.profileId = null;
      state.pageId = null;
    }
    if (state.pageId) {
      const profile = state.deck.profiles.find((p) => p.id === state.profileId);
      if (profile && !profile.pages.some((p) => p.id === state.pageId)) state.pageId = null;
    }
  }
  if (!state.profileId) state.profileId = hostState.activeProfile;
  if (!state.pageId) state.pageId = hostState.activePage;
  ui.dryBadge.hidden = !hostState.dryRun;
}

/**
 * Applica tema, accento e lingua dichiarati dall'host.
 *
 * `light` impone il tema chiaro, `auto` lo segue solo se il sistema lo chiede,
 * `dark` (o niente) lascia quello scuro. Prima esisteva solo `auto`, quindi
 * chi scriveva `"theme": "light"` non otteneva nulla.
 */
function applyTheme(uiConfig) {
  if (!uiConfig) return;
  const root = document.documentElement;

  // Lo stile viene prima dell'accento: uno stile porta il proprio accento nei
  // token, e un accento scelto a mano deve poterlo comunque scavalcare.
  root.dataset.style = uiConfig.style && uiConfig.style !== 'default' ? uiConfig.style : '';
  if (!root.dataset.style) root.removeAttribute('data-style');

  if (uiConfig.accent) root.style.setProperty('--accent', uiConfig.accent);
  else root.style.removeProperty('--accent');

  root.classList.toggle('theme-auto', uiConfig.theme === 'auto');
  root.classList.toggle('theme-light', uiConfig.theme === 'light');

  const scelta = setLanguage(uiConfig.language ?? 'auto');
  if (document.documentElement.lang !== scelta) {
    document.documentElement.lang = scelta;
    applyStaticTexts();
  }
}

/** Traduce le parti dell'interfaccia scritte direttamente in index.html. */
function applyStaticTexts() {
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle);
  }
  for (const node of document.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  }
  ui.statusText.textContent = state.connected ? t('status.online') : t('status.offline');
}

function currentProfile() {
  if (!state.deck) return null;
  return state.deck.profiles.find((p) => p.id === state.profileId) ?? state.deck.profiles[0];
}

function currentPage() {
  const profile = currentProfile();
  if (!profile) return null;
  return profile.pages.find((p) => p.id === state.pageId) ?? profile.pages[0];
}

function renderAll() {
  if (!state.deck) return;
  renderProfiles();
  renderPages();
  renderGrid();
  renderStatus();
  // Il benvenuto si valuta una volta sola, quando il deck e' pronto.
  if (!state.welcomeChecked) {
    state.welcomeChecked = true;
    maybeWelcome();
  }
}

/** Attiva o disattiva la modalita' modifica e ridisegna cio' che cambia. */
function setEditing(value) {
  state.editing = Boolean(value);
  ui.btnEdit.setAttribute('aria-pressed', String(state.editing));
  renderProfiles();
  renderPages();
  renderGrid();
  toast(t(state.editing ? 'edit.on' : 'edit.off'));
}

/** Prima cella libera della pagina corrente, in "riga:colonna". */
function firstEmptyCell(page) {
  const occupate = new Set((page.buttons ?? []).map((b) => `${b.row}:${b.col}`));
  for (let r = 0; r < page.rows; r += 1) {
    for (let c = 0; c < page.cols; c += 1) {
      if (!occupate.has(`${r}:${c}`)) return `${r}:${c}`;
    }
  }
  return '0:0';
}

/**
 * Benvenuto al primo avvio: appare solo a chi non l'ha ancora visto e ha un
 * deck ancora vuoto. Offre di creare il primo pulsante (che apre la libreria
 * dei preset) invece di lasciare l'utente davanti a una griglia muta.
 */
function maybeWelcome() {
  try {
    if (localStorage.getItem(STORAGE.welcomed)) return;
  } catch { return; }
  const profile = currentProfile();
  const vuoto = profile && profile.pages.every((pg) => (pg.buttons ?? []).length === 0);
  // Chi ha gia' dei pulsanti non e' un nuovo arrivato: si segna e basta.
  const segna = () => { try { localStorage.setItem(STORAGE.welcomed, '1'); } catch { /* storage non disponibile */ } };
  if (!vuoto) { segna(); return; }

  openSheet({
    title: t('welcome.title'),
    body: `<p class="sheet-text">${t('welcome.body')}</p>`,
    actions: [
      { label: t('welcome.later'), kind: 'ghost', onClick: () => { segna(); closeSheet(); } },
      { label: t('welcome.start'), kind: 'primary', onClick: () => {
        segna();
        closeSheet();
        if (!state.editing) setEditing(true);
        const page = currentPage();
        if (page) choosePreset(firstEmptyCell(page));
      } }
    ],
    onClose: segna
  });
}

function renderProfiles() {
  const profile = currentProfile();
  ui.profileSelect.innerHTML = state.deck.profiles
    .map((p) => `<option value="${p.id}"${p.id === profile.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`)
    .join('')
    // In modifica il menu dei profili diventa anche la via per crearli e
    // rinominarli: non serve un altro bottone nella barra, gia' affollata.
    + (state.editing ? `<option value="__gestisci__">${t('profile.manage')}</option>` : '');
}

function renderPages() {
  const profile = currentProfile();
  const page = currentPage();
  ui.pages.innerHTML = profile.pages
    .map((p) => `<button class="page-tab" role="tab" data-page="${p.id}" aria-selected="${p.id === page.id}">`
      + `${escapeHtml(p.name)}${state.editing ? '<span class="page-edit" title="Modifica la pagina">&#9998;</span>' : ''}</button>`)
    .join('')
    + (state.editing ? '<button class="page-tab add" type="button" data-page-add="1" title="Aggiungi una pagina">+</button>' : '');
}

/**
 * Disegna la griglia della pagina attiva.
 *
 * La firma della pagina evita di ricostruire il DOM quando nulla e' cambiato:
 * ogni ricostruzione azzera le animazioni in corso e fa "sfarfallare" la
 * griglia a ogni messaggio di stato, che e' quello che rendeva l'interfaccia
 * a scatti nella prima versione.
 */
/** Colore di ogni gruppo della pagina corrente: id -> hex. */
let currentGroupColors = new Map();
/** Timer delle pagine dinamiche (finestre/app/widget), da fermare al cambio pagina. */
let dynTimer = null;
function clearDynTimer() { if (dynTimer) { clearInterval(dynTimer); dynTimer = null; } }

function renderGrid() {
  const page = currentPage();
  if (!page) return;

  // Le pagine dinamiche (finestre/app/widget) prendono i tile dall'host e hanno
  // un rendering e un ciclo di aggiornamento propri.
  if (page.source) { renderDynamicPage(page); return; }
  clearDynTimer();
  ui.grid.classList.remove('dynamic');

  const signature = JSON.stringify([state.profileId, page.id, state.editing, page.buttons, page.groups]);
  if (ui.grid.dataset.signature === signature) return;
  ui.grid.dataset.signature = signature;

  currentGroupColors = new Map((page.groups ?? []).map((g) => [g.id, g.color]));

  ui.grid.style.gridTemplateColumns = `repeat(${page.cols}, minmax(0, 1fr))`;
  ui.grid.style.gridTemplateRows = `repeat(${page.rows}, minmax(0, 1fr))`;
  ui.grid.classList.toggle('editing', state.editing);

  const occupied = new Map();
  for (const button of page.buttons) {
    const span = button.span ?? 1;
    for (let offset = 0; offset < span; offset += 1) occupied.set(`${button.row}:${button.col + offset}`, button);
  }

  const parts = [];
  for (let row = 0; row < page.rows; row += 1) {
    for (let col = 0; col < page.cols; col += 1) {
      const button = occupied.get(`${row}:${col}`);
      if (!button) {
        parts.push(`<button class="deck-btn empty" type="button" data-empty="${row}:${col}"${state.editing ? '' : ' aria-hidden="true" tabindex="-1"'}>${state.editing ? '+' : ''}</button>`);
        continue;
      }
      // Le celle successive a quella iniziale sono gia' coperte dallo span.
      if (button.col !== col) continue;
      parts.push(controlHtml(button));
    }
  }
  ui.grid.innerHTML = parts.join('');
  applyStatuses();
  renderGroupLegend(page);
}

/**
 * Legenda dei gruppi: sotto le pagine mostra un "chip" colorato con la label di
 * ogni gruppo, cosi' si riconosce a colpo d'occhio a cosa serve ogni colore.
 */
function renderGroupLegend(page) {
  if (!ui.groupLegend) return;
  const groups = page.groups ?? [];
  if (!groups.length) {
    ui.groupLegend.hidden = true;
    ui.groupLegend.innerHTML = '';
    return;
  }
  ui.groupLegend.hidden = false;
  ui.groupLegend.innerHTML = groups.map((g) =>
    `<span class="group-chip" style="--group-color:${cssColor(g.color) || 'var(--accent)'}">`
    + `<span class="group-dot"></span>${escapeHtml(g.label)}</span>`
  ).join('');
}

// ------------------------------------------------- pagine dinamiche

/**
 * Rendering di una pagina dinamica (finestre/app/widget): i tile arrivano
 * dall'host. Si allestisce una sola volta per pagina (guardia sulla signature) e
 * si avvia il ciclo di aggiornamento; il timer si ferma cambiando pagina.
 */
function renderDynamicPage(page) {
  const signature = `dyn:${state.profileId}:${page.id}:${page.source}`;
  if (ui.grid.dataset.signature === signature) return;
  ui.grid.dataset.signature = signature;
  clearDynTimer();

  ui.grid.classList.add('dynamic');
  ui.grid.classList.remove('editing');
  ui.grid.style.gridTemplateColumns = '';
  ui.grid.style.gridTemplateRows = '';
  renderGroupLegend(page); // le pagine dinamiche non hanno gruppi: nasconde la legenda
  ui.grid.innerHTML = `<div class="dyn-msg">${escapeHtml(t('dyn.loading'))}</div>`;

  if (page.source === 'windows') setupWindowsPage();
  else if (page.source === 'apps') setupAppsPage();
  else if (page.source === 'widgets') setupWidgetsPage();
}

/** Messaggio a tutta pagina (caricamento, vuoto, errore). */
function dynMessage(text) {
  return `<div class="dyn-msg">${escapeHtml(text)}</div>`;
}

/** Un tile dinamico che, toccato, esegue un'azione lato host. */
function dynTile({ action, arg, label, sub, icon, color }) {
  const style = color ? ` style="--group-color:${cssColor(color)}"` : '';
  return `<button class="deck-btn dyn-tile" type="button" data-dyn-action="${action}" data-dyn-arg="${escapeHtml(String(arg))}"${style}>`
    + `<span class="dyn-ico">${iconMarkup(icon)}</span>`
    + `<span class="label">${escapeHtml(label)}</span>`
    + (sub ? `<span class="dyn-sub">${escapeHtml(sub)}</span>` : '')
    + '</button>';
}

/** Pagina "Finestre": elenco delle finestre aperte, aggiornato ogni 3s. */
function setupWindowsPage() {
  let lastKey = '';
  const load = async () => {
    const res = await api(ENDPOINTS.windows);
    if (!res.ok) { setDynHtml(dynMessage(t('dyn.error')), 'err'); return; }
    if (res.data.platform !== 'win32') { setDynHtml(dynMessage(t('dyn.winOnly'))); lastKey = 'winonly'; return; }
    const wins = res.data.windows ?? [];
    const key = wins.map((w) => `${w.handle}:${w.title}`).join('|');
    if (key === lastKey) return; // nessun cambiamento: niente re-render (no sfarfallio)
    lastKey = key;
    if (!wins.length) { setDynHtml(dynMessage(t('dyn.noWindows'))); return; }
    setDynHtml(wins.map((w) => dynTile({
      action: 'focus-window', arg: w.handle, label: w.title, sub: w.process, icon: 'emoji:🪟'
    })).join(''));
  };
  load();
  dynTimer = setInterval(() => { if (currentPage()?.source === 'windows') load(); }, 3000);
}

/** Pagina "App": scorciatoie del menu Start; caricata una volta (cambiano di rado). */
function setupAppsPage() {
  const load = async () => {
    const res = await api(ENDPOINTS.apps);
    if (!res.ok) { setDynHtml(dynMessage(t('dyn.error')), 'err'); return; }
    if (res.data.platform !== 'win32') { setDynHtml(dynMessage(t('dyn.winOnly'))); return; }
    const apps = res.data.apps ?? [];
    if (!apps.length) { setDynHtml(dynMessage(t('dyn.noApps'))); return; }
    setDynHtml(apps.map((a) => dynTile({
      action: 'launch-app', arg: a.path, label: a.name, icon: 'emoji:🚀'
    })).join(''));
  };
  load();
}

/** Pagina "Widget": orologio (dal vivo) + stato del PC (CPU/memoria/uptime). */
function setupWidgetsPage() {
  let info = null;
  const widget = (icon, big, sub) =>
    `<div class="deck-btn widget-tile"><span class="dyn-ico">${iconMarkup(icon)}</span>`
    + `<span class="widget-big">${escapeHtml(big)}</span><span class="dyn-sub">${escapeHtml(sub)}</span></div>`;
  const draw = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const dateStr = now.toLocaleDateString();
    const tiles = [widget('emoji:🕒', `${hh}:${mm}:${ss}`, dateStr)];
    if (info) {
      tiles.push(widget('emoji:💻', info.host, `CPU ${info.cpu}%`));
      tiles.push(widget('emoji:🧠', `${info.mem.percent}%`, `${info.mem.usedMb} / ${info.mem.totalMb} MB`));
      tiles.push(widget('emoji:⏱️', formatUptime(info.uptimeSec), t('dyn.uptime')));
    }
    setDynHtml(tiles.join(''));
  };
  const refresh = async () => {
    const res = await api(ENDPOINTS.sysinfo);
    if (res.ok) info = res.data.info;
    draw();
  };
  refresh();
  let ticks = 0;
  dynTimer = setInterval(() => {
    if (currentPage()?.source !== 'widgets') return;
    ticks += 1;
    if (ticks % 5 === 0) refresh(); // stato PC ogni ~5s
    else draw(); // orologio ogni secondo
  }, 1000);
}

/** Sostituisce il contenuto della griglia dinamica (con eventuale stato d'errore). */
function setDynHtml(html, cls = '') {
  ui.grid.innerHTML = html;
  ui.grid.classList.toggle('dyn-error', cls === 'err');
}

/** "acceso da 3g 4h 12m" a partire dai secondi di uptime. */
function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}g ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Esegue l'azione di un tile dinamico (focus finestra / avvio app). */
async function runDynTile(element) {
  const action = element.dataset.dynAction;
  const arg = element.dataset.dynArg;
  element.classList.add('active');
  let res;
  if (action === 'focus-window') res = await api(ENDPOINTS.windows, { method: 'POST', body: { handle: arg } });
  else if (action === 'launch-app') res = await api(ENDPOINTS.apps, { method: 'POST', body: { path: arg } });
  setTimeout(() => element.classList.remove('active'), 200);
  if (res && !res.ok) toast(res.data?.error?.message || t('dyn.actionFailed'), 'err');
}

/** Colore del gruppo di un tile (hex) o null se non ne ha uno valido. */
function groupColorOf(button) {
  return button.group ? (currentGroupColors.get(button.group) || null) : null;
}
/** Attributo `data-group` (con la variabile colore va nello style del tile). */
function groupData(button) {
  return groupColorOf(button) ? ` data-group="${escapeHtml(button.group)}"` : '';
}
/** Frammento di stile `--group-color:#hex` da unire allo style del tile (o ''). */
function groupColorVar(button) {
  const color = groupColorOf(button);
  return color ? `--group-color:${cssColor(color)}` : '';
}

function buttonHtml(button) {
  const bg = cssColor(button.color);
  const fg = cssColor(button.textColor);
  const style = [
    bg ? `background:${bg}` : '',
    fg ? `color:${fg}` : '',
    button.span > 1 ? `grid-column:span ${Number(button.span) || 1}` : '',
    groupColorVar(button)
  ].filter(Boolean).join(';');
  return `<button class="deck-btn" type="button" data-id="${escapeHtml(button.id)}" data-row="${button.row}" data-col="${button.col}"${groupData(button)} style="${style}" title="${escapeHtml(button.label || button.id)}">`
    + `<span class="type-tag">${escapeHtml(button.action?.type)}</span>`
    + controlIcon(button)
    + (state.deck.ui?.showLabels === false ? '' : `<span class="label">${escapeHtml(button.label)}</span>`)
    + (button.confirm ? '<span class="confirm-tag" title="chiede conferma">!</span>' : '')
    + removeBadge()
    + '</button>';
}

/**
 * Geometria della barra piena, per tutte e quattro le combinazioni di
 * orientamento e origine. Vive in una funzione sola perche' il markup iniziale
 * e l'aggiornamento durante il trascinamento devono disegnare la STESSA cosa:
 * due formule separate divergono al primo ritocco e il cursore "salta" di
 * qualche pixel appena lo si tocca.
 *
 * Non centrato: la barra parte dal fondo (sinistra, o basso in verticale).
 * Centrato: parte dalla meta' e cresce nei due versi — e' il modo giusto di
 * mostrare un bilanciamento o una correzione, dove lo zero sta in mezzo e il
 * segno conta quanto il valore.
 * @returns {string} le proprieta' CSS da mettere sul .slider-fill
 */
function sliderFillStyle(value, { min, max, vertical, center }) {
  const ratio = max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  const pos = ratio * 100;
  const origine = center ? 50 : 0;
  const inizio = Math.min(origine, pos);
  const lunghezza = Math.abs(pos - origine);
  return vertical
    ? `top:auto;bottom:${inizio}%;left:0;right:0;height:${lunghezza}%;width:auto`
    : `left:${inizio}%;right:auto;top:0;bottom:0;width:${lunghezza}%;height:auto`;
}

function sliderHtml(button) {
  const min = button.min ?? 0;
  const max = button.max ?? 100;
  const vertical = button.orientation === 'v';
  const center = button.center === true;
  const value = state.levels.get(button.id) ?? Math.round((min + max) / 2);
  const accent = cssColor(button.color);
  const style = [
    accent ? `--slider-accent:${accent}` : '',
    `grid-column:span ${Number(button.span) || kindDefaultSpan('slider', button.orientation)}`,
    groupColorVar(button)
  ].filter(Boolean).join(';');
  const classi = ['deck-slider', vertical ? 'vert' : '', center ? 'centered' : ''].filter(Boolean).join(' ');
  return `<div class="${classi}" data-id="${escapeHtml(button.id)}" data-row="${button.row}" data-col="${button.col}"${groupData(button)} data-min="${min}" data-max="${max}" data-step="${button.step ?? 1}"`
    + ` data-orientation="${vertical ? 'v' : 'h'}"${center ? ' data-center="1"' : ''} style="${style}"`
    + ` role="slider" tabindex="0" aria-orientation="${vertical ? 'vertical' : 'horizontal'}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" aria-label="${escapeHtml(button.label || button.id)}">`
    + `<div class="slider-fill" style="${sliderFillStyle(value, { min, max, vertical, center })}"></div>`
    + (center ? '<div class="slider-zero"></div>' : '')
    + '<div class="slider-content">'
    + controlIcon(button)
    + `<span class="slider-label">${escapeHtml(button.label)}</span>`
    + `<span class="slider-value">${arrotonda(value, button.step ?? 1)}</span>`
    + '</div>'
    + removeBadge()
    + '</div>';
}

/* ------------------------------------------------------------------ comandi

   Un deck non e' fatto di soli pulsanti: ci sono manopole che girano, rotelle
   che scorrono, tavolette a due assi e quadranti che leggono soltanto.

   Ogni tipo e' un pezzo di markup e un comportamento; l'aspetto arriva sempre
   dai token del tema (--ctl-surf, --ctl-edge, --ctl-accent...), mai da colori
   scritti qui. Cosi' un tema nuovo non tocca una riga di comportamento.       */

/** Comandi che mostrano lo stato dell'host e non accettano pressioni. */
const READONLY_KINDS = ['gauge', 'meter', 'chart', 'display'];

/**
 * I tipi di comando offerti dall'editor, raggruppati per COME si comandano.
 * L'ordine e' quello che serve a chi sceglie: prima i piu' comuni.
 */
const KIND_GROUPS = [
  { key: 'press', kinds: ['button', 'folder', 'macro', 'timer', 'pad', 'selector'] },
  { key: 'drag', kinds: ['slider', 'xy', 'color'] },
  { key: 'turn', kinds: ['encoder', 'jog', 'stepper'] },
  { key: 'read', kinds: READONLY_KINDS }
];

function kindOptions(scelto) {
  return KIND_GROUPS.map((g) =>
    `<optgroup label="${escapeHtml(t(`edit.kindGroup.${g.key}`))}">`
    + g.kinds.map((k) =>
      `<option value="${k}"${k === scelto ? ' selected' : ''}>${escapeHtml(t(`edit.kindName.${k}`))}</option>`).join('')
    + '</optgroup>').join('');
}

/** Campi che solo alcuni tipi hanno: intervallo, opzioni, righe, secondi... */
function kindFieldsHtml(kind, draft) {
  const num = (id, label, value, extra = '') =>
    `<label class="field"><span>${escapeHtml(label)}</span><input id="${id}" type="number" ${extra} value="${value}" /></label>`;
  const righe = [];

  if (['slider', 'encoder', 'stepper', 'gauge', 'meter'].includes(kind)) {
    righe.push('<div class="field-row">'
      + num('ed-min', t('edit.min'), draft.min ?? 0, 'step="any"')
      + num('ed-max', t('edit.max'), draft.max ?? 100, 'step="any"')
      + (['gauge', 'meter'].includes(kind) ? '' : num('ed-step', t('edit.step'), draft.step ?? 1, 'step="any" min="0"'))
      + '</div>');
  }
  if (kind === 'slider') {
    righe.push(`<div class="field-row">
      <label class="field"><span>${t('edit.orientation')}</span><select id="ed-orientation" class="select">
        <option value="h"${(draft.orientation ?? 'h') === 'h' ? ' selected' : ''}>${t('edit.orientationH')}</option>
        <option value="v"${draft.orientation === 'v' ? ' selected' : ''}>${t('edit.orientationV')}</option>
      </select></label>
      <label class="field checkbox"><input id="ed-center" type="checkbox"${draft.center ? ' checked' : ''} /><span>${t('edit.center')}</span></label>
    </div>`);
  }
  if (kind === 'selector') {
    righe.push(`<label class="field"><span>${t('edit.options')}</span>`
      + `<input id="ed-options" type="text" value="${escapeHtml((draft.options ?? []).join(', '))}" placeholder="Auto, Manuale, Fermo" /></label>`);
  }
  if (kind === 'pad') {
    righe.push('<div class="field-row">'
      + num('ed-rows', t('edit.padRows'), draft.rows ?? 4, 'min="1" max="8"')
      + num('ed-cols', t('edit.padCols'), draft.cols ?? 4, 'min="1" max="8"')
      + '</div>');
  }
  if (kind === 'timer') {
    righe.push(num('ed-seconds', t('edit.seconds'), draft.seconds ?? 1500, 'min="1" max="86400"'));
  }
  if (kind === 'color') {
    righe.push(`<label class="field"><span>${t('edit.colorMode')}</span><select id="ed-mode" class="select">
      <option value="kelvin"${(draft.mode ?? 'kelvin') === 'kelvin' ? ' selected' : ''}>${t('edit.colorKelvin')}</option>
      <option value="rgb"${draft.mode === 'rgb' ? ' selected' : ''}>${t('edit.colorRgb')}</option>
    </select></label>`);
  }
  return righe.join('');
}

/** Legge dal form i campi del tipo scelto. */
function readKindFields(kind) {
  const numero = (id, fallback) => {
    const v = Number(el(id)?.value);
    return Number.isFinite(v) ? v : fallback;
  };
  const out = {};
  if (['slider', 'encoder', 'stepper', 'gauge', 'meter'].includes(kind)) {
    out.min = numero('ed-min', 0);
    out.max = numero('ed-max', 100);
    if (!['gauge', 'meter'].includes(kind)) out.step = Math.max(0.001, numero('ed-step', 1));
  }
  if (kind === 'slider') {
    out.orientation = el('ed-orientation')?.value === 'v' ? 'v' : 'h';
    out.center = el('ed-center')?.checked === true;
  }
  if (kind === 'selector') {
    out.options = String(el('ed-options')?.value ?? '')
      .split(',').map((o) => o.trim()).filter(Boolean).slice(0, 8);
  }
  if (kind === 'pad') {
    out.rows = Math.min(8, Math.max(1, Math.round(numero('ed-rows', 4))));
    out.cols = Math.min(8, Math.max(1, Math.round(numero('ed-cols', 4))));
  }
  if (kind === 'timer') out.seconds = Math.min(86400, Math.max(1, Math.round(numero('ed-seconds', 1500))));
  if (kind === 'color') out.mode = el('ed-mode')?.value === 'rgb' ? 'rgb' : 'kelvin';
  return out;
}

/** Larghezza predefinita in celle: la stessa che usa l'host (`defaultSpan`). */
function kindDefaultSpan(kind, orientation = 'h') {
  if (kind === 'slider') return orientation === 'v' ? 1 : 2;
  return ['xy', 'pad', 'chart'].includes(kind) ? 2 : 1;
}

/** Instrada un controllo al suo markup. */
function controlHtml(button) {
  const kind = button.kind ?? 'button';
  if (kind === 'slider') return sliderHtml(button);
  if (kind === 'button') return buttonHtml(button);
  return ctlHtml(button, kind);
}

/** Valore corrente di un controllo: quello reale se c'e', altrimenti il centro. */
function ctlValue(button) {
  const min = button.min ?? 0;
  const max = button.max ?? 100;
  const stored = state.levels.get(button.id);
  return typeof stored === 'number' ? stored : Math.round((min + max) / 2);
}

/** Frazione 0..1 di un valore dentro il suo intervallo. */
function ctlFraction(button, value) {
  const min = button.min ?? 0;
  const max = button.max ?? 100;
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/** mm:ss da un numero di secondi. */
function mmss(secondi) {
  const s = Math.max(0, Math.round(secondi));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function ctlHtml(button, kind) {
  const accent = cssColor(button.color);
  const fg = cssColor(button.textColor);
  const style = [
    accent ? `--ctl-accent:${accent}` : '',
    fg ? `color:${fg}` : '',
    button.span > 1 ? `grid-column:span ${Number(button.span) || 1}` : '',
    groupColorVar(button)
  ].filter(Boolean).join(';');

  const readonly = READONLY_KINDS.includes(kind);

  return `<div class="deck-ctl ctl-${kind}" data-id="${escapeHtml(button.id)}" data-kind="${kind}"`
    + ` data-row="${button.row}" data-col="${button.col}"${groupData(button)} style="${style}"`
    // Un comando che si preme e' un bottone anche per chi usa la tastiera o un
    // lettore di schermo; uno di sola lettura e' un'immagine di stato.
    + (readonly
      ? ` role="img" aria-label="${escapeHtml(button.label || button.id)}"`
      : ` role="button" tabindex="0" aria-label="${escapeHtml(button.label || button.id)}"`)
    + ` title="${escapeHtml(button.label || button.id)}">`
    + ctlInner(button, kind)
    + '</div>';
}

/** Contenuto di un controllo: si ridisegna da solo quando il valore cambia. */
function ctlInner(button, kind) {
  const label = state.deck.ui?.showLabels === false ? '' : `<span class="ctl-label">${escapeHtml(button.label)}</span>`;
  return ctlBody(button, kind, label)
    + (button.confirm ? '<span class="confirm-tag" title="chiede conferma">!</span>' : '')
    + removeBadge();
}

/**
 * Ridisegna il solo contenuto di un controllo.
 *
 * Ricostruire tutta la griglia a ogni scatto di manopola azzererebbe le
 * animazioni e farebbe sfarfallare il resto della pagina; qui cambia soltanto
 * l'interno del comando toccato.
 */
function refreshCtl(element) {
  const spec = currentPage()?.buttons.find((b) => b.id === element.dataset.id);
  if (!spec) return;
  element.innerHTML = ctlInner(spec, element.dataset.kind);
}

function ctlBody(button, kind, label) {
  const value = ctlValue(button);
  const frazione = ctlFraction(button, value);
  const stato = state.statuses?.[button.id];

  switch (kind) {
    // --- girano e mandano scatti -------------------------------------------
    case 'encoder':
      return '<span class="enc-wrap">'
        + `<span class="enc-ring" style="--v:${frazione}"></span>`
        + `<span class="enc"><span class="enc-mark" style="transform:rotate(${frazione * 300 - 150}deg)"></span></span>`
        + '</span>' + label
        + `<span class="ctl-value">${escapeHtml(String(value))}</span>`;

    case 'jog':
      // Una rotella non ha ne' inizio ne' fine: nessun valore da mostrare.
      return '<span class="jog"></span>' + label;

    case 'stepper':
      return '<span class="st-row">'
        + '<button class="st-btn" type="button" data-step-dir="-1" tabindex="-1" aria-label="-">&minus;</button>'
        + `<span class="st-val">${escapeHtml(String(value))}</span>`
        + '<button class="st-btn" type="button" data-step-dir="1" tabindex="-1" aria-label="+">+</button>'
        + '</span>' + label;

    // --- si trascinano ------------------------------------------------------
    case 'xy':
      return '<span class="xy">'
        + '<span class="xy-h"></span><span class="xy-v"></span><span class="xy-puck"></span>'
        + '</span>' + label;

    case 'color':
      return label + `<span class="sp sp-${escapeHtml(button.mode ?? 'kelvin')}"><span class="sp-knob"></span></span>`;

    // --- si premono ---------------------------------------------------------
    case 'selector': {
      const scelto = stato?.text ?? ctlPick(button.id) ?? (button.options ?? [])[0];
      return '<span class="sg">'
        + (button.options ?? []).map((o) =>
          `<button class="sg-opt" type="button" tabindex="-1" data-opt="${escapeHtml(o)}"`
          + ` aria-selected="${o === scelto}">${escapeHtml(o)}</button>`).join('')
        + '</span>' + label;
    }

    case 'pad': {
      const rows = button.rows ?? 4;
      const cols = button.cols ?? 4;
      const celle = [];
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          celle.push(`<button class="pd-cell" type="button" tabindex="-1" data-cell="${r},${c}" aria-label="${r + 1}-${c + 1}"></button>`);
        }
      }
      return `<span class="pd" style="--pd-cols:${cols}">${celle.join('')}</span>` + label;
    }

    case 'timer': {
      const totale = button.seconds ?? 1500;
      const rimasti = ctlTimer(button.id)?.left ?? totale;
      return `<span class="rg" style="--v:${totale ? rimasti / totale : 0}"><span>${mmss(rimasti)}</span></span>` + label;
    }

    case 'folder':
      return '<span class="fl"><i></i><i></i><i></i><i></i></span>' + label;

    case 'macro': {
      const passi = Math.max(2, Math.min(8, button.action?.params?.steps?.length ?? 4));
      return controlIcon(button) + label + `<span class="mc">${'<i></i>'.repeat(passi)}</span>`;
    }

    // --- leggono e basta ----------------------------------------------------
    case 'gauge': {
      const livello = typeof stato?.level === 'number' ? ctlFraction(button, stato.level) : 0;
      const testo = stato?.text ?? (typeof stato?.level === 'number' ? String(stato.level) : '--');
      return `<span class="gg"><span class="gg-arc"></span><span class="gg-nd" style="--v:${livello}"></span></span>`
        + label + `<span class="ctl-value">${escapeHtml(testo)}</span>`;
    }

    case 'meter': {
      const livello = typeof stato?.level === 'number' ? ctlFraction(button, stato.level) : 0;
      return `<span class="mt"><i style="--l:${livello}"></i><i style="--l:${livello * 0.86}"></i></span>` + label;
    }

    case 'chart':
      return `<span class="sk">${sparkSvg(stato?.series)}</span>` + label;

    case 'display':
      return `<span class="rd-big">${escapeHtml(stato?.text ?? '--')}</span>`
        + `<span class="rd-sub">${escapeHtml(button.label ?? '')}</span>`;

    default:
      return controlIcon(button) + label;
  }
}

/** Opzione scelta di un selettore, finche' l'host non dice la sua. */
const ctlPicks = new Map();
function ctlPick(id) { return ctlPicks.get(id); }

/** Stato locale dei timer: {left, running, tick}. */
const ctlTimers = new Map();
function ctlTimer(id) { return ctlTimers.get(id); }

/**
 * Grafico da una serie di numeri mandata dall'host. Senza serie disegna una
 * linea piatta: un grafico vuoto deve sembrare "nessun dato", non rotto.
 */
function sparkSvg(series) {
  const dati = Array.isArray(series) ? series.filter((n) => typeof n === 'number' && Number.isFinite(n)) : [];
  if (dati.length < 2) return '<svg viewBox="0 0 100 40" preserveAspectRatio="none"><path class="sk-line" d="M0 20 L100 20"></path></svg>';
  const max = Math.max(...dati);
  const min = Math.min(...dati, 0);
  const scala = max - min || 1;
  const punti = dati.map((n, i) => [(i / (dati.length - 1)) * 100, 38 - ((n - min) / scala) * 34]);
  const d = punti.map((pt, i) => `${i ? 'L' : 'M'}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(' ');
  const ultimo = punti[punti.length - 1];
  return '<svg viewBox="0 0 100 40" preserveAspectRatio="none">'
    + `<path class="sk-area" d="${d} L100 40 L0 40 Z"></path>`
    + `<path class="sk-line" d="${d}"></path>`
    + `<circle class="sk-dot" cx="${ultimo[0].toFixed(1)}" cy="${ultimo[1].toFixed(1)}" r="2"></circle>`
    + '</svg>';
}

/**
 * "x" di eliminazione mostrata su ogni tile in modalita' modifica: dà a
 * aggiungere/eliminare un comando proprio, separato dall'editor dell'azione.
 */
function removeBadge() {
  if (!state.editing) return '';
  return `<span class="tile-remove" data-remove="1" title="${t('edit.remove')}" aria-label="${t('edit.remove')}">&#10005;</span>`;
}

function renderStatus() {
  if (!state.hostState) return;
  ui.dryBadge.hidden = !state.hostState.dryRun;
  const parts = [
    state.connected ? t('status.online') : t('status.offline'),
    t('status.clients', { n: state.hostState.clients }),
    t('status.presses', { n: state.hostState.pressCount })
  ];
  ui.statusText.textContent = parts.join(' - ');
  if (state.hostState.lastAction) renderLastAction(state.hostState.lastAction);
}

/** Mostra nella barra in alto la versione dell'host attualmente in esecuzione. */
function renderVersion() {
  const v = state.version || state.update?.current || '';
  if (!ui.version) return;
  ui.version.textContent = v ? `v${v}` : '';
  ui.version.hidden = !v;
}

/**
 * Applica alla griglia lo stato reale letto dall'host.
 *
 * Non ridisegna nulla: tocca solo gli attributi dei controlli gia' presenti.
 * Ricostruire la griglia a ogni aggiornamento di stato (uno ogni pochi
 * secondi) azzererebbe le animazioni e farebbe sfarfallare i bottoni.
 */
function applyStatuses() {
  for (const element of ui.grid.querySelectorAll('[data-id]')) {
    applyStatusTo(element, state.statuses[element.dataset.id]);
  }
}

function applyStatusTo(element, entry) {
  if (!entry || entry.error || typeof entry.on !== 'boolean') delete element.dataset.on;
  else element.dataset.on = entry.on ? '1' : '0';

  // Un quadrante, un livello, un grafico o un display SONO lo stato: quando
  // arriva un dato nuovo il loro contenuto va rifatto, non solo decorato.
  if (READONLY_KINDS.includes(element.dataset.kind)) {
    refreshCtl(element);
    return;
  }

  setStateTag(element, entry?.error ? '!' : (entry?.text ?? ''));

  // Il livello reale allinea il cursore, tranne mentre il dito lo sta muovendo:
  // vedersi scappare via il cursore sotto le dita e' peggio di un valore vecchio.
  if (typeof entry?.level === 'number' && state.draggingId !== element.dataset.id) {
    state.levels.set(element.dataset.id, entry.level);
    updateSliderVisual(element, entry.level);
  }
}

/** Etichetta breve dello stato ("muto", "LIVE", nome della scena in onda). */
function setStateTag(element, text) {
  let tag = element.querySelector('.state-tag');
  if (!text) {
    tag?.remove();
    return;
  }
  if (!tag) {
    tag = document.createElement('span');
    tag.className = 'state-tag';
    element.appendChild(tag);
  }
  tag.textContent = text;
}

function renderLastAction(entry) {
  if (!entry) return;
  const status = entry.ok ? 'ok' : 'errore';
  const detail = entry.ok ? (entry.detail ?? '') : (entry.error?.message ?? '');
  ui.lastAction.textContent = `${entry.buttonId} [${entry.type}] ${status}${detail ? `: ${detail}` : ''}`;
}

// ---------------------------------------------------------------- pressione

/**
 * Invia la pressione di un bottone.
 *
 * Il feedback visivo viene applicato subito da chi chiama (al pointerdown):
 * aspettare la risposta dell'host per illuminare il tasto lo faceva sembrare
 * lento anche quando l'azione partiva in pochi millisecondi.
 */
function pressButton(element, { hold = false, release = false, value, delta, x, y } = {}) {
  const buttonId = element.dataset.id;
  if (!buttonId) return;
  const requestId = `r${++state.requestSeq}`;
  state.pending.set(requestId, { element, buttonId });

  const sent = send({
    type: MSG.press,
    buttonId,
    profileId: state.profileId,
    pageId: state.pageId,
    hold,
    release,
    ...(value !== undefined ? { value } : {}),
    // Una manopola manda uno scarto, la tavoletta una coppia: vedi
    // docs/PROTOCOL.md, "Valore, scarto, coppia".
    ...(delta !== undefined ? { delta } : {}),
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
    dryRun: state.simulate,
    requestId
  });
  if (!sent) {
    state.pending.delete(requestId);
    element.classList.remove('pending');
    return;
  }

  setTimeout(() => {
    if (state.pending.has(requestId)) {
      state.pending.delete(requestId);
      finishPress({ element, buttonId }, false, { error: { message: 'nessuna risposta dall\'host' } });
    }
  }, 12000);
}

function finishPress(pending, ok, result) {
  const { element } = pending;
  element.classList.remove('pending');
  element.classList.add(ok ? 'ok' : 'err');
  setTimeout(() => element.classList.remove('ok', 'err'), 700);

  if (!ok) {
    toast(result?.error?.message ?? t('action.failed'), 'err');
    return;
  }

  // Un'azione che non apre finestre (script, notifiche, comandi remoti) non
  // da' alcun segno di vita sul telefono: qui il suo esito diventa visibile.
  const inner = result?.result ?? {};
  const output = String(inner.stdout ?? '').trim();
  if (output) toast(output.slice(0, 300), 'ok');
  else if (result?.dryRun) toast(t('action.simulated', { description: result.description ?? '' }), '');
  else if (inner.detail) toast(inner.detail, 'ok');

  // Gli handler di livello rispondono con il valore reale: allinea lo slider.
  if (typeof inner.level === 'number') {
    state.levels.set(pending.buttonId, inner.level);
    updateSliderVisual(element, inner.level);
  }
}

function updateSliderVisual(element, value) {
  if (!element.classList.contains('deck-slider')) return;
  const min = Number(element.dataset.min);
  const max = Number(element.dataset.max);
  element.querySelector('.slider-fill').style.cssText = sliderFillStyle(value, {
    min,
    max,
    vertical: element.dataset.orientation === 'v',
    center: element.dataset.center === '1'
  });
  element.querySelector('.slider-value').textContent = arrotonda(value, Number(element.dataset.step) || 1);
  element.setAttribute('aria-valuenow', String(value));
}

/**
 * Mostra tanti decimali quanti ne ha il passo. Da quando min/max/step sono
 * numeri veri (un termostato 15..30 a scatti di 0.5) arrotondare all'intero
 * mostrerebbe "21" per tre scatti di fila.
 */
function arrotonda(value, step) {
  const decimali = String(step).includes('.') ? String(step).split('.')[1].length : 0;
  return Number(value).toFixed(Math.min(3, decimali));
}

/** Chiede conferma per le azioni marcate `confirm` in deck.json. */
function confirmPress(button) {
  return new Promise((resolve) => {
    openSheet({
      title: t('sheet.confirmTitle'),
      body: `<p class="sheet-text">${t('sheet.confirmBody', {
        label: escapeHtml(button.label || button.id),
        type: escapeHtml(button.action.type),
        host: escapeHtml(activeHost()?.name ?? '')
      })}</p>`,
      actions: [
        { label: t('sheet.cancel'), kind: 'ghost', onClick: () => { closeSheet(); resolve(false); } },
        { label: t('sheet.run'), kind: 'danger', onClick: () => { closeSheet(); resolve(true); } }
      ],
      onClose: () => resolve(false)
    });
  });
}

// ---------------------------------------------------------------- pannello modale

let sheetCloseHandler = null;
// Vero solo se l'ultima pressione dentro il pannello e' iniziata sullo sfondo o
// sulla X: evita che il pannello si chiuda per il "click" sintetico di una
// pressione partita altrove (vedi bindSheet).
let sheetDownOnClose = false;
/** Elemento a cui restituire il focus alla chiusura del pannello. */
let sheetLastFocus = null;

/** Elementi che possono ricevere il focus dentro il pannello, in ordine. */
function sheetFocusables() {
  const card = ui.sheet.querySelector('.sheet-card');
  if (!card) return [];
  return Array.from(card.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => element.offsetParent !== null || element === document.activeElement);
}

function openSheet({ title, body, actions = [], onClose = null }) {
  // Il pannello si riusa: solo a una vera apertura si ricorda chi aveva il
  // focus, cosi' concatenare due pannelli non perde il grilletto originale.
  if (ui.sheet.hidden) sheetLastFocus = document.activeElement;
  // All'apertura nessuna pressione e' ancora iniziata sullo sfondo: cosi' un
  // "click" sintetico subito dopo l'apertura non chiude il pannello.
  sheetDownOnClose = false;
  ui.sheetTitle.textContent = title;
  ui.sheetBody.innerHTML = body;
  ui.sheetFoot.innerHTML = '';
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${action.kind ?? ''}`.trim();
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    ui.sheetFoot.appendChild(btn);
  }
  sheetCloseHandler = onClose;
  ui.sheet.hidden = false;

  // Un pannello modale deve prendere il focus, altrimenti Tab resta sulla
  // pagina sotto e la tastiera fisica non lo raggiunge mai. MA il focus va sul
  // CONTENITORE, non sul primo campo di testo: su touch, mettere il focus su un
  // input fa comparire (e a volte subito sparire) la tastiera a schermo prima
  // ancora che l'utente decida di scrivere. Cosi' la tastiera appare solo quando
  // si tocca davvero un campo.
  const card = ui.sheet.querySelector('.sheet-card');
  if (card) {
    card.tabIndex = -1;
    card.focus();
  } else {
    el('sheet-close')?.focus();
  }
}

function closeSheet({ silent = true } = {}) {
  ui.sheet.hidden = true;
  const handler = sheetCloseHandler;
  sheetCloseHandler = null;
  const restore = sheetLastFocus;
  sheetLastFocus = null;
  if (restore && typeof restore.focus === 'function') restore.focus();
  if (!silent && handler) handler();
}

// ---------------------------------------------------------------- editor

async function loadActions() {
  if (state.actionGroups) return state.actionGroups;
  const res = await api(ENDPOINTS.actions);
  if (!res.ok) {
    toast(isOffline(res) ? t('net.unreachable') : t('action.noActions'), 'err');
    return [];
  }
  state.actionGroups = res.data.groups ?? [];
  return state.actionGroups;
}

/** Elenco delle icone caricate dall'utente su questo host. */
async function loadCustomIcons({ force = false } = {}) {
  if (state.customIcons && !force) return state.customIcons;
  const res = await api(ENDPOINTS.icons);
  state.customIcons = res.ok ? (res.data.icons ?? []) : [];
  return state.customIcons;
}

/** Elenco degli script aggiunti dall'utente (cartella scripts), per i suggerimenti. */
async function loadScripts({ force = false } = {}) {
  if (state.scripts && !force) return state.scripts;
  const res = await api(ENDPOINTS.scripts);
  state.scripts = res.ok ? (res.data.scripts ?? []) : [];
  return state.scripts;
}

/** Copia di lavoro del deck: l'editor non modifica mai quella ricevuta. */
const cloneDeck = () => JSON.parse(JSON.stringify(state.deck));

const findProfile = (deck, id) => deck.profiles.find((p) => p.id === id);
const findPage = (profile, id) => profile?.pages.find((p) => p.id === id);

/** Genera uno slug valido a partire da un testo libero. */
function slugify(text, fallback = 'nuovo') {
  const slug = String(text ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return /^[a-z0-9]/.test(slug) ? slug : `${fallback}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Rende unico uno slug rispetto a quelli gia' in uso. */
function uniqueSlug(base, taken) {
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}-${i}`.slice(0, 32);
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 32);
}

/** Tutti gli id di bottone del deck: servono a non crearne di duplicati. */
function allButtonIds(deck) {
  return deck.profiles.flatMap((p) => p.pages.flatMap((g) => g.buttons.map((b) => b.id)));
}

// ------------------------------------------------- scelta dell'icona

/** Emoji piu' utili per un deck: audio, media, sistema, app, avvisi. */
const EMOJI_PALETTE = [
  '🔊', '🔇', '🔉', '▶️', '⏸️', '⏭️', '⏮️', '⏹️', '🎵', '🎧',
  '🎬', '📷', '🎤', '🎮', '🖥️', '💻', '📁', '🌐', '🔒', '🔓',
  '⚡', '💡', '🔔', '🔕', '⭐', '❤️', '✅', '❌', '➕', '➖',
  '🏠', '⚙️', '🔍', '📧', '📅', '🗑️', '🖼️', '🎨', '🚀', '☀️',
  '🌙', '🔥', '💬', '📣', '🎥', '🖨️', '⌨️', '🖱️', '🔗', '📌'
];

/** Griglia di scelta dell'icona: glifi inclusi, emoji, icone caricate, caricamento. */
function iconPickerHtml(selected, customIcons) {
  const choice = (value, inner, title) => '<button type="button" class="icon-choice'
    + `${value === (selected ?? '') ? ' selected' : ''}" data-icon="${escapeHtml(value)}" title="${escapeHtml(title)}">${inner}</button>`;

  const builtin = Object.keys(ICONS)
    .map((name) => choice(name, iconSvg(name), name))
    .join('');
  const emojis = EMOJI_PALETTE
    .map((e) => choice(`${EMOJI_PREFIX}${e}`, `<span class="icon-emoji">${escapeHtml(e)}</span>`, e))
    .join('');
  const custom = customIcons
    .map((icon) => choice(`${CUSTOM_PREFIX}${icon.name}`,
      `<img src="${customIconUrl(icon.name)}" alt="" />`, icon.name))
    .join('');

  // Emoji personalizzata gia' scelta ma fuori dalla tavolozza: la si rimette nel campo.
  const emojiCorrente = isEmojiIcon(selected) ? selected.slice(EMOJI_PREFIX.length) : '';

  return `
    <div class="icon-picker" id="ed-icons">
      ${choice('', `<span class="icon-auto">${t('edit.iconAuto')}</span>`, t('edit.iconDefault'))}
      ${builtin}
      ${emojis}
      ${custom}
    </div>
    <div class="icon-emoji-row">
      <input id="ed-emoji" type="text" maxlength="8" inputmode="text" value="${escapeHtml(emojiCorrente)}" placeholder="${t('edit.iconEmoji')}" aria-label="${t('edit.iconEmoji')}" />
      <span class="sheet-hint">${t('edit.iconEmojiHint')}</span>
    </div>
    <div class="icon-upload">
      <label class="btn ghost small" for="ed-icon-file">${t('edit.iconUpload')}</label>
      <input id="ed-icon-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden />
      <span class="sheet-hint" id="ed-icon-msg">${t('edit.iconFormats')}</span>
    </div>`;
}

/**
 * Collega la griglia delle icone: selezione e caricamento di un file.
 * @param {{onPick: (value: string|null) => void}} handlers
 */
function bindIconPicker({ onPick }) {
  const picker = el('ed-icons');
  if (!picker) return;

  const select = (element) => {
    for (const other of picker.querySelectorAll('.icon-choice')) other.classList.remove('selected');
    element.classList.add('selected');
    onPick(element.dataset.icon || null);
  };

  picker.addEventListener('click', (event) => {
    const choice = event.target.closest('.icon-choice');
    if (choice) {
      select(choice);
      const campo = el('ed-emoji');
      if (campo && !choice.dataset.icon?.startsWith(EMOJI_PREFIX)) campo.value = '';
    }
  });

  // Campo emoji libero: qualunque emoji digitata diventa l'icona, deselezionando
  // la griglia (la scelta ora e' il testo, non un pulsante).
  el('ed-emoji')?.addEventListener('input', (event) => {
    const val = event.target.value.trim();
    for (const other of picker.querySelectorAll('.icon-choice')) other.classList.remove('selected');
    onPick(val ? `${EMOJI_PREFIX}${val}` : null);
  });

  el('ed-icon-file')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const message = el('ed-icon-msg');
    message.textContent = t('edit.iconUploading');

    try {
      const content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('file illeggibile'));
        reader.readAsDataURL(file);
      });
      const name = uniqueSlug(
        slugify(file.name.replace(/\.[^.]+$/, ''), 'icona'),
        (await loadCustomIcons()).map((i) => i.name)
      );
      const res = await api(ENDPOINTS.icons, { method: 'POST', body: { name, content } });
      if (!res.ok) {
        message.textContent = res.data?.error?.message ?? t('edit.rejected');
        return;
      }

      // La lista va riletta: l'icona nuova deve comparire subito nella griglia.
      const saved = res.data.icon.name;
      await loadCustomIcons({ force: true });
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'icon-choice';
      button.dataset.icon = `${CUSTOM_PREFIX}${saved}`;
      button.title = saved;
      button.innerHTML = `<img src="${customIconUrl(saved)}" alt="" />`;
      picker.appendChild(button);
      select(button);
      message.textContent = t('edit.iconUploaded', { name: saved });
    } catch (err) {
      message.textContent = t('edit.iconFailed', { message: err.message });
    }
  });
}

/** Apre l'editor di un bottone esistente o di una cella vuota. */
// ---------------------------------------------------------------- form guidato

// I due editor d'azione aperti nel pannello (pressione normale e prolungata):
// li teniamo qui perche' il salvataggio, che e' una funzione a parte, deve
// poterne leggere i parametri correnti.
let edMainCtl = null;
let edHoldCtl = null;
let edReleaseCtl = null;

/**
 * Opzioni dinamiche per i campi che puntano al deck stesso: l'elenco dei
 * profili o delle pagine, che non e' fisso ma dipende da cosa ha configurato
 * l'utente. Cosi' "vai alla pagina" e' un menu' a tendina, non un id da sapere.
 */
function dynamicFieldOptions(type) {
  const deck = state.deck;
  if (!deck) return [];
  if (type === 'profile') return (deck.profiles ?? []).map((p) => ({ value: p.id, label: p.name || p.id }));
  const prof = (deck.profiles ?? []).find((p) => p.id === state.profileId) ?? (deck.profiles ?? [])[0];
  return (prof?.pages ?? []).map((pg) => ({ value: pg.id, label: pg.name || pg.id }));
}

const HOTKEY_MODS = { Control: 'ctrl', Shift: 'shift', Alt: 'alt', Meta: 'win' };
const HOTKEY_MOD_ORDER = ['ctrl', 'shift', 'alt', 'win'];

/**
 * Cattura una combinazione di tasti in un campo "hotkey" ASPETTANDO il rilascio.
 *
 * Il problema di prima: si registrava al primo tasto NON modificatore premuto,
 * quindi una combinazione premuta anche solo di poco scaglionata (o la lettera
 * un istante prima dei modificatori) veniva troncata al primo tasto. Ora si
 * tiene premuta tutta la combinazione: il campo mostra dal vivo cosa si sta
 * componendo e registra il combo PIU' COMPLETO quando si lasciano i tasti.
 */
function bindHotkeyCapture(input, setParam) {
  const down = new Set(); // tasti attualmente premuti (modificatori + tasto)
  let best = ''; // combo con piu' tasti visto durante questa pressione
  let recording = false;

  const nameOf = (event) => {
    if (event.key in HOTKEY_MODS) return HOTKEY_MODS[event.key];
    return event.key === ' ' ? 'space' : event.key.toLowerCase();
  };
  const isMod = (n) => HOTKEY_MOD_ORDER.includes(n);
  // Compone "ctrl+shift+s" dai tasti premuti; serve un tasto non modificatore.
  const compose = () => {
    const mods = HOTKEY_MOD_ORDER.filter((m) => down.has(m));
    const main = [...down].find((n) => !isMod(n));
    return main ? { combo: [...mods, main].join('+'), full: true } : { combo: mods.join('+'), full: false };
  };

  const savedPlaceholder = input.placeholder;
  input.addEventListener('focus', () => {
    recording = true; down.clear(); best = '';
    input.dataset.recording = '1';
    input.value = '';
    input.placeholder = t('edit.hotkeyRecording');
  });
  input.addEventListener('blur', () => {
    recording = false; delete input.dataset.recording;
    input.placeholder = savedPlaceholder;
    input.value = best || input.value; // se non ha completato, tiene il valore vecchio
  });
  input.addEventListener('keydown', (event) => {
    if (!recording) return;
    event.preventDefault();
    down.add(nameOf(event));
    const { combo, full } = compose();
    // "best" = combo con almeno un tasto vero e piu' tasti di quello precedente,
    // cosi' rilasci scaglionati non lo accorciano.
    if (full && combo.split('+').length >= (best ? best.split('+').length : 0)) best = combo;
    input.value = combo; // anteprima dal vivo
  });
  input.addEventListener('keyup', (event) => {
    if (!recording) return;
    event.preventDefault();
    down.delete(nameOf(event));
    if (down.size === 0 && best) { // tutto rilasciato: registra il combo completo
      setParam(best);
      input.value = best;
    }
  });
}

/**
 * Costruisce il controllo di un singolo campo (etichetta + input) a partire
 * dallo schema dichiarato dall'azione, e lo collega all'oggetto `params`:
 * ogni modifica scrive nella chiave giusta, senza toccare le altre (cosi' i
 * parametri avanzati messi a mano nel JSON non vengono cancellati).
 */
function buildFieldControl(field, params, onSync) {
  const wrap = document.createElement('label');
  wrap.className = field.type === 'toggle' ? 'field checkbox' : 'field';
  const current = params[field.key] ?? field.default ?? (field.type === 'toggle' ? false : '');

  const setParam = (val) => {
    if (val === '' || val === undefined || val === null) delete params[field.key];
    else params[field.key] = val;
    onSync?.();
  };

  let input;
  switch (field.type) {
    case 'number':
      input = document.createElement('input');
      input.type = 'number';
      if (field.min != null) input.min = String(field.min);
      if (field.max != null) input.max = String(field.max);
      if (field.step != null) input.step = String(field.step);
      input.value = current === '' ? '' : String(current);
      input.addEventListener('input', () => setParam(input.value === '' ? '' : Number(input.value)));
      break;
    case 'toggle':
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(current);
      input.addEventListener('change', () => { params[field.key] = input.checked; onSync?.(); });
      break;
    case 'textarea':
      input = document.createElement('textarea');
      input.rows = 3;
      input.spellcheck = false;
      input.value = current ?? '';
      if (field.placeholder) input.placeholder = field.placeholder;
      input.addEventListener('input', () => setParam(input.value));
      break;
    case 'select':
    case 'profile':
    case 'page': {
      input = document.createElement('select');
      input.className = 'select wide';
      const opts = field.type === 'select' ? (field.options ?? []) : dynamicFieldOptions(field.type);
      // Le opzioni possono avere valori tipati (booleani, numeri: es. mute=true,
      // qos=1). Il DOM li rende stringa, quindi al cambio si risale al valore
      // originale confrontando la forma stringa, per non salvare "true" al posto
      // di true. Un sentinello distingue "nessuna scelta" da un valore vuoto.
      const NIENTE = '__none__';
      if (!field.required) input.appendChild(new Option(t('edit.optNone'), NIENTE));
      for (const o of opts) input.appendChild(new Option(o.label, String(o.value)));

      let effettivo = current;
      if ((effettivo === '' || effettivo == null) && field.required && opts.length) {
        // un campo obbligatorio parte dalla prima opzione, cosi' un pulsante
        // salvato senza toccarlo non nasce gia' invalido
        effettivo = opts[0].value;
        setParam(effettivo);
      }
      input.value = (effettivo === '' || effettivo == null) ? NIENTE : String(effettivo);

      input.addEventListener('change', () => {
        if (input.value === NIENTE) { setParam(''); return; }
        const scelto = opts.find((o) => String(o.value) === input.value);
        setParam(scelto ? scelto.value : input.value);
      });
      break;
    }
    case 'hotkey':
      input = document.createElement('input');
      input.type = 'text';
      input.placeholder = field.placeholder ?? 'es. ctrl+shift+m';
      input.value = current ?? '';
      input.readOnly = true; // si compila premendo i tasti, non digitando
      bindHotkeyCapture(input, setParam);
      break;
    default:
      input = document.createElement('input');
      input.type = 'text';
      if (field.placeholder) input.placeholder = field.placeholder;
      input.value = current ?? '';
      input.addEventListener('input', () => setParam(input.value));
      // Campo che suggerisce gli script aggiunti dal tray: un datalist con i
      // percorsi disponibili, cosi' si scelgono invece di scriverli a mano.
      if (field.suggest === 'scripts' && Array.isArray(state.scripts) && state.scripts.length) {
        const listId = `scripts-${field.key}`;
        const dl = document.createElement('datalist');
        dl.id = listId;
        for (const s of state.scripts) {
          const opt = document.createElement('option');
          opt.value = s.path;
          opt.label = s.name;
          dl.appendChild(opt);
        }
        input.setAttribute('list', listId);
        wrap.appendChild(dl);
      }
  }

  const labelSpan = document.createElement('span');
  labelSpan.textContent = field.required ? `${field.label} *` : field.label;
  if (field.type === 'toggle') {
    wrap.append(input, labelSpan);
  } else {
    wrap.append(labelSpan, input);
  }
  if (field.help) {
    const help = document.createElement('span');
    help.className = 'field-help';
    help.textContent = field.help;
    wrap.appendChild(help);
  }
  return wrap;
}

/**
 * Disegna il form guidato di un'azione dentro `container`, seminando i valori
 * di default per un pulsante nuovo. Se l'azione non ha campi semplici mostra
 * una nota che rimanda alla modalita' avanzata.
 */
function renderActionFields(container, spec, params, onSync) {
  container.innerHTML = '';
  if (!spec) return;
  const fields = Array.isArray(spec.fields) ? spec.fields : [];
  if (fields.length === 0) {
    const nota = document.createElement('p');
    nota.className = 'sheet-hint';
    nota.textContent = spec.advanced ? t('edit.advancedOnly') : t('edit.noParams');
    container.appendChild(nota);
    return;
  }
  for (const field of fields) {
    // I default vanno scritti subito, non solo quando l'utente tocca il campo:
    // un pulsante nuovo salvato senza toccare nulla deve comunque avere i suoi
    // parametri, altrimenti l'host lo rifiuta.
    if (params[field.key] === undefined && field.default !== undefined) params[field.key] = field.default;
    container.appendChild(buildFieldControl(field, params, onSync));
  }
  if (spec.advanced) {
    const nota = document.createElement('p');
    nota.className = 'sheet-hint';
    nota.textContent = t('edit.advancedExtra');
    container.appendChild(nota);
  }
}

/**
 * Collega un editor d'azione: menu' del tipo, form guidato, interruttore
 * "Avanzato" che rivela il JSON. Il JSON e il form restano sincronizzati; la
 * fonte autorevole al salvataggio e' il JSON solo se il pannello e' aperto.
 */
function wireActionEditor({ typeSelect, fieldsBox, advToggle, advBox, textarea, allActions, initialParams }) {
  let params = initialParams && typeof initialParams === 'object' && !Array.isArray(initialParams)
    ? { ...initialParams }
    : {};
  const spec = () => allActions.find((a) => a.type === typeSelect.value) ?? null;
  const syncTextarea = () => { textarea.value = JSON.stringify(params, null, 2); };
  const rebuild = () => { renderActionFields(fieldsBox, spec(), params, syncTextarea); syncTextarea(); };

  advToggle?.addEventListener('click', () => {
    const mostra = advBox.hidden;
    advBox.hidden = !mostra;
    advToggle.setAttribute('aria-expanded', String(mostra));
  });
  textarea.addEventListener('change', () => {
    try {
      const parsed = JSON.parse(textarea.value || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        params = parsed;
        rebuild();
      }
    } catch { /* JSON incompleto: si lascia stare, il salvataggio segnalera' l'errore */ }
  });
  typeSelect.addEventListener('change', () => {
    // cambiata azione, i vecchi parametri non c'entrano piu': si riparte pulito
    params = {};
    rebuild();
  });

  rebuild();

  return {
    readParams() {
      if (advBox && !advBox.hidden) return JSON.parse(textarea.value || '{}');
      return params;
    }
  };
}

/**
 * Galleria dei preset mostrata quando si aggiunge un bottone nuovo. Si sceglie
 * un modello pronto (che apre l'editor gia' compilato) oppure "vuoto" per
 * partire da zero. Pensata per chi non sa da dove cominciare.
 */
function choosePreset(cell) {
  const tile = (p) => `<button type="button" class="preset-tile" data-preset="${escapeHtml(p.id)}">
      <span class="preset-ico">${iconMarkup(p.icon)}</span>
      <span class="preset-name">${escapeHtml(t(`preset.${p.id}`))}</span>
    </button>`;
  // Raggruppati per categoria: con tanti preset una griglia unica sarebbe un muro.
  const sezioni = PRESET_CATEGORIES.map((cat) => {
    const voci = PRESETS.filter((p) => p.category === cat.id);
    if (!voci.length) return '';
    return `<h3 class="sheet-section">${escapeHtml(t(cat.label))}</h3>
      <div class="preset-grid">${voci.map(tile).join('')}</div>`;
  }).join('');
  openSheet({
    title: t('preset.title'),
    body: `
      <p class="sheet-hint">${t('preset.hint')}</p>
      ${sezioni}
      <button type="button" class="btn ghost" id="preset-blank">${t('preset.blank')}</button>
    `,
    actions: [{ label: t('sheet.cancel'), kind: 'ghost', onClick: () => closeSheet() }]
  });
  el('preset-blank')?.addEventListener('click', () => editButton(null, cell));
  for (const btn of ui.sheetBody.querySelectorAll('[data-preset]')) {
    btn.addEventListener('click', () => {
      const p = PRESETS.find((x) => x.id === btn.dataset.preset);
      if (p) editButton(null, cell, { ...p, label: t(`preset.${p.id}`) });
    });
  }
}

async function editButton(buttonId, cell, seed = null) {
  const [groups, customIcons] = await Promise.all([loadActions(), loadCustomIcons(), loadScripts()]);
  const page = currentPage();
  if (!page) return;
  const existing = page.buttons.find((b) => b.id === buttonId) ?? null;
  // Il bottone potrebbe essere stato spostato o eliminato tra il disegno della
  // griglia e il tocco: senza cella di destinazione non c'e' nulla da aprire.
  if (!existing && !cell) {
    toast(t('edit.vanished'), 'err');
    return;
  }
  const [row, col] = cell ? cell.split(':').map(Number) : [existing.row, existing.col];

  const draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
      id: uniqueSlug(`btn-${Math.random().toString(36).slice(2, 8)}`, allButtonIds(state.deck)),
      // Da un preset arrivano etichetta, icona e azione gia' pronte; senza
      // preset si parte da un bottone vuoto.
      label: seed?.label ?? 'Nuovo',
      row,
      col,
      kind: seed?.kind ?? 'button',
      icon: seed?.icon ?? null,
      color: seed?.color ?? '#2d3b55',
      action: seed?.action ? JSON.parse(JSON.stringify(seed.action)) : { type: 'noop', params: {} },
      ...(seed?.holdAction ? { holdAction: JSON.parse(JSON.stringify(seed.holdAction)) } : {}),
      ...(seed?.releaseAction ? { releaseAction: JSON.parse(JSON.stringify(seed.releaseAction)) } : {})
    };

  const options = groups
    .map((g) => `<optgroup label="${escapeHtml(g.label)}">`
      + g.actions.map((a) => `<option value="${a.type}"${a.type === draft.action.type ? ' selected' : ''}>${escapeHtml(a.title)}</option>`).join('')
      + '</optgroup>')
    .join('');

  const allActions = groups.flatMap((g) => g.actions);

  // Le azioni della pressione prolungata sono le stesse, piu' la voce "nessuna":
  // configurarla richiedeva finora di scrivere holdAction a mano in deck.json.
  const holdOptions = `<option value="">${escapeHtml(t('edit.holdNone'))}</option>`
    + groups.map((g) => `<optgroup label="${escapeHtml(g.label)}">`
      + g.actions.map((a) => `<option value="${a.type}"${a.type === draft.holdAction?.type ? ' selected' : ''}>${escapeHtml(a.title)}</option>`).join('')
      + '</optgroup>').join('');

  // Azione al rilascio: trasforma il bottone in "momentaneo" (push-to-talk).
  const releaseOptions = `<option value="">${escapeHtml(t('edit.releaseNone'))}</option>`
    + groups.map((g) => `<optgroup label="${escapeHtml(g.label)}">`
      + g.actions.map((a) => `<option value="${a.type}"${a.type === draft.releaseAction?.type ? ' selected' : ''}>${escapeHtml(a.title)}</option>`).join('')
      + '</optgroup>').join('');

  openSheet({
    title: t(existing ? 'edit.editControl' : 'edit.newControl'),
    body: `
      <label class="field"><span>${t('edit.label')}</span><input id="ed-label" type="text" maxlength="48" value="${escapeHtml(draft.label)}" /></label>
      <label class="field"><span>${t('edit.action')}</span><select id="ed-type" class="select wide">${options}</select></label>
      <p id="ed-desc" class="sheet-hint"></p>
      <div id="ed-fields" class="ed-fields"></div>
      <button type="button" class="btn ghost small ed-adv-toggle" id="ed-adv-toggle" aria-expanded="false">${t('edit.advanced')}</button>
      <div id="ed-adv" hidden>
        <label class="field"><span>${t('edit.paramsJson')}</span><textarea id="ed-params" rows="5" spellcheck="false">${escapeHtml(JSON.stringify(draft.action.params ?? {}, null, 2))}</textarea></label>
      </div>
      <button type="button" class="btn ghost small" id="ed-test">${t('edit.test')}</button>
      <p id="ed-test-result" class="sheet-hint" role="status" aria-live="polite"></p>

      <h3 class="sheet-section">${t('edit.icon')}</h3>
      ${iconPickerHtml(draft.icon, customIcons)}

      <h3 class="sheet-section">${t('edit.hold')}</h3>
      <p class="sheet-hint">${t('edit.holdHint')}</p>
      <p id="ed-hold-conflict" class="sheet-hint warn" hidden>${t('edit.holdIgnored')}</p>
      <label class="field"><span>${t('edit.action')}</span><select id="ed-hold-type" class="select wide">${holdOptions}</select></label>
      <div id="ed-hold-params-field">
        <div id="ed-hold-fields" class="ed-fields"></div>
        <button type="button" class="btn ghost small ed-adv-toggle" id="ed-hold-adv-toggle" aria-expanded="false">${t('edit.advanced')}</button>
        <div id="ed-hold-adv" hidden>
          <label class="field"><span>${t('edit.paramsJson')}</span><textarea id="ed-hold-params" rows="3" spellcheck="false">${escapeHtml(JSON.stringify(draft.holdAction?.params ?? {}, null, 2))}</textarea></label>
        </div>
      </div>

      <h3 class="sheet-section">${t('edit.release')}</h3>
      <p class="sheet-hint">${t('edit.releaseHint')}</p>
      <label class="field"><span>${t('edit.action')}</span><select id="ed-release-type" class="select wide">${releaseOptions}</select></label>
      <div id="ed-release-params-field">
        <div id="ed-release-fields" class="ed-fields"></div>
        <button type="button" class="btn ghost small ed-adv-toggle" id="ed-release-adv-toggle" aria-expanded="false">${t('edit.advanced')}</button>
        <div id="ed-release-adv" hidden>
          <label class="field"><span>${t('edit.paramsJson')}</span><textarea id="ed-release-params" rows="3" spellcheck="false">${escapeHtml(JSON.stringify(draft.releaseAction?.params ?? {}, null, 2))}</textarea></label>
        </div>
      </div>

      <div class="field-row">
        <label class="field"><span>${t('edit.kind')}</span><select id="ed-kind" class="select wide">${kindOptions(draft.kind ?? 'button')}</select></label>
        <label class="field"><span>${t('edit.color')}</span><input id="ed-color" type="color" value="${draft.color ?? '#2d3b55'}" /></label>
        <label class="field"><span>${t('edit.textColor')}</span><input id="ed-text-color" type="color" value="${draft.textColor ?? '#ffffff'}" /></label>
        <label class="field"><span>${t('edit.width')}</span><input id="ed-span" type="number" min="1" max="12" value="${draft.span ?? 1}" /></label>
      </div>
      <div id="ed-kind-fields" class="ed-fields"></div>
      <p id="ed-kind-hint" class="sheet-hint"></p>
      <label class="field checkbox"><input id="ed-confirm" type="checkbox"${draft.confirm ? ' checked' : ''} /><span>${t('edit.confirm')}</span></label>
      <label class="field checkbox"><input id="ed-status" type="checkbox"${draft.status === false ? '' : ' checked'} /><span>${t('edit.showStatus')}</span></label>
      <label class="field"><span>${t('edit.group')}</span><select id="ed-group" class="select wide">
        <option value="">${t('edit.groupNone')}</option>
        ${(page.groups ?? []).map((g) => `<option value="${escapeHtml(g.id)}"${draft.group === g.id ? ' selected' : ''}>${escapeHtml(g.label)}</option>`).join('')}
      </select></label>
      <p class="sheet-hint">${t('edit.groupHint')}</p>
    `,
    // L'eliminazione NON sta piu' qui: si fa dalla "x" sul tile in modifica,
    // cosi' l'editor riguarda solo cosa fa il pulsante, non la sua esistenza.
    actions: [
      { label: t('sheet.cancel'), kind: 'ghost', onClick: () => closeSheet() },
      { label: t('sheet.save'), kind: 'primary', onClick: () => saveButtonDraft(draft, existing) }
    ]
  });

  bindIconPicker({ onPick: (value) => { draft.icon = value; } });

  // Editor guidato dell'azione principale: form dai campi dichiarati, con il
  // JSON sotto l'interruttore "Avanzato".
  const typeSelect = el('ed-type');
  edMainCtl = wireActionEditor({
    typeSelect,
    fieldsBox: el('ed-fields'),
    advToggle: el('ed-adv-toggle'),
    advBox: el('ed-adv'),
    textarea: el('ed-params'),
    allActions,
    initialParams: draft.action.params
  });

  // Stesso editor per la pressione prolungata; i suoi campi hanno senso solo
  // quando un'azione e' scelta.
  const holdSelect = el('ed-hold-type');
  edHoldCtl = wireActionEditor({
    typeSelect: holdSelect,
    fieldsBox: el('ed-hold-fields'),
    advToggle: el('ed-hold-adv-toggle'),
    advBox: el('ed-hold-adv'),
    textarea: el('ed-hold-params'),
    allActions,
    initialParams: draft.holdAction?.params
  });
  const aggiornaHold = () => {
    el('ed-hold-params-field').hidden = holdSelect.value === '';
  };
  holdSelect.addEventListener('change', aggiornaHold);
  aggiornaHold();

  const releaseSelect = el('ed-release-type');
  edReleaseCtl = wireActionEditor({
    typeSelect: releaseSelect,
    fieldsBox: el('ed-release-fields'),
    advToggle: el('ed-release-adv-toggle'),
    advBox: el('ed-release-adv'),
    textarea: el('ed-release-params'),
    allActions,
    initialParams: draft.releaseAction?.params
  });
  const aggiornaRelease = () => {
    const attiva = releaseSelect.value !== '';
    el('ed-release-params-field').hidden = !attiva;
    // Con un'azione al rilascio il bottone diventa momentaneo: la pressione
    // prolungata non scatterebbe mai, quindi si dice chiaro invece di
    // lasciare due impostazioni che si contraddicono in silenzio.
    el('ed-hold-conflict').hidden = !(attiva && holdSelect.value !== '');
  };
  releaseSelect.addEventListener('change', aggiornaRelease);
  holdSelect.addEventListener('change', aggiornaRelease);
  aggiornaRelease();

  // "Prova": esegue l'azione in dry-run e mostra cosa farebbe, senza salvarla
  // ne' toccare il sistema. Utile a chi non sa cosa fa un'azione e per
  // controllare i parametri prima di salvare.
  el('ed-test')?.addEventListener('click', () => testAction());

  // La descrizione dell'azione e le opzioni che dipendono dal tipo (cursore,
  // stato reale) restano gestite a parte dal form dei parametri.
  const describe = () => {
    const spec = allActions.find((a) => a.type === typeSelect.value);
    el('ed-desc').textContent = spec?.description ?? '';
    if (spec?.control === 'slider') el('ed-kind').value = 'slider';

    // Spuntare "mostra lo stato" su un'azione che non sa dichiararlo non
    // farebbe nulla: meglio disattivare la casella che lasciarla senza effetto.
    const statusBox = el('ed-status');
    statusBox.disabled = spec ? spec.reportsState !== true : false;
    statusBox.closest('.field').classList.toggle('disabled', statusBox.disabled);
  };
  typeSelect.addEventListener('change', describe);
  describe();

  // Il tipo di comando decide quali campi hanno senso: cambiarlo ridisegna
  // solo quel pezzo di form, senza perdere il resto di cio' che si stava
  // scrivendo.
  const kindSelect = el('ed-kind');
  const aggiornaKind = () => {
    const kind = kindSelect.value;
    el('ed-kind-fields').innerHTML = kindFieldsHtml(kind, draft);
    el('ed-kind-hint').textContent = t(`edit.kindHint.${kind}`);
    // Un comando di sola lettura non si preme: le azioni di pressione
    // prolungata e di rilascio non scatterebbero mai.
    const readonly = READONLY_KINDS.includes(kind);
    for (const id of ['ed-hold-type', 'ed-release-type', 'ed-confirm']) {
      const campo = el(id);
      if (!campo) continue;
      campo.disabled = readonly;
      campo.closest('.field')?.classList.toggle('disabled', readonly);
    }
  };
  kindSelect.addEventListener('change', aggiornaKind);
  aggiornaKind();
}

async function saveButtonDraft(draft, existing) {
  // I parametri arrivano dal form guidato; se il pannello "Avanzato" e' aperto
  // la fonte diventa il JSON, che qui puo' lanciare se malformato.
  let params;
  try {
    params = edMainCtl.readParams();
  } catch (err) {
    toast(t('edit.paramsInvalid', { message: err.message }), 'err');
    return;
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) params = {};

  const holdType = el('ed-hold-type').value;
  let holdAction = null;
  if (holdType !== '') {
    let holdParams;
    try {
      holdParams = edHoldCtl.readParams();
    } catch (err) {
      toast(t('edit.holdParamsInvalid', { message: err.message }), 'err');
      return;
    }
    if (!holdParams || typeof holdParams !== 'object' || Array.isArray(holdParams)) holdParams = {};
    holdAction = { type: holdType, params: holdParams };
  }

  const releaseType = el('ed-release-type').value;
  let releaseAction = null;
  if (releaseType !== '') {
    let releaseParams;
    try {
      releaseParams = edReleaseCtl.readParams();
    } catch (err) {
      toast(t('edit.releaseParamsInvalid', { message: err.message }), 'err');
      return;
    }
    if (!releaseParams || typeof releaseParams !== 'object' || Array.isArray(releaseParams)) releaseParams = {};
    releaseAction = { type: releaseType, params: releaseParams };
  }

  const kind = el('ed-kind').value;
  const perTipo = readKindFields(kind);
  const readonly = READONLY_KINDS.includes(kind);
  if (kind === 'selector' && perTipo.options.length < 2) {
    toast(t('edit.optionsTooFew'), 'err');
    return;
  }
  const next = {
    ...draft,
    label: el('ed-label').value.trim(),
    kind,
    icon: draft.icon || null,
    color: el('ed-color').value,
    textColor: el('ed-text-color').value,
    span: Math.max(1, Number(el('ed-span').value) || 1),
    status: el('ed-status').checked,
    group: el('ed-group')?.value || null,
    // Un comando di sola lettura non puo' avere azioni di pressione: l'host le
    // rifiuterebbe, e un'impostazione inerte e' peggio di un errore.
    holdAction: readonly ? null : holdAction,
    releaseAction: readonly ? null : releaseAction,
    confirm: readonly ? false : el('ed-confirm').checked,
    action: { type: el('ed-type').value, params }
  };
  Object.assign(next, perTipo);

  // I campi degli altri tipi vanno via: un pulsante non deve portarsi dietro
  // l'intervallo di un cursore.
  for (const campo of ['min', 'max', 'step', 'orientation', 'center', 'options', 'rows', 'cols', 'seconds', 'mode']) {
    if (!(campo in perTipo)) delete next[campo];
  }
  if (!draft.span) next.span = Math.max(kindDefaultSpan(kind, perTipo.orientation), next.span);

  const currentId = currentPage()?.id;
  const deck = cloneDeck();
  const page = currentId ? findPage(findProfile(deck, state.profileId), currentId) : null;
  if (!page) {
    toast(t('edit.vanished'), 'err');
    return;
  }
  const index = existing ? page.buttons.findIndex((b) => b.id === existing.id) : -1;
  // Se il bottone e' sparito tra apertura e salvataggio (index -1) lo si
  // aggiunge in coda invece di scrivere in buttons[-1], che creerebbe una
  // proprieta' "-1" ignorata dall'host.
  if (existing && index !== -1) page.buttons[index] = next;
  else page.buttons.push(next);
  await persistDeck(deck, t('edit.saved', { label: next.label }));
}

/**
 * Esegue l'azione in corso di modifica in dry-run e mostra sotto il pulsante
 * cosa farebbe. Non salva e non tocca il sistema: l'host forza il dry-run.
 */
async function testAction() {
  const box = el('ed-test-result');
  const type = el('ed-type')?.value;
  if (!type) return;
  let params;
  try {
    params = edMainCtl.readParams();
  } catch (err) {
    if (box) { box.textContent = t('edit.paramsInvalid', { message: err.message }); box.className = 'sheet-hint err'; }
    return;
  }
  if (box) { box.textContent = t('edit.testing'); box.className = 'sheet-hint'; }
  const res = await api(ENDPOINTS.actionTest, { method: 'POST', body: { type, params } });
  if (!box) return;
  if (!res.ok) {
    const msg = res.data?.result?.error?.message ?? res.data?.error?.message ?? t('edit.testFailed');
    box.textContent = t('edit.testFailed') + ' ' + msg;
    box.className = 'sheet-hint err';
    return;
  }
  // In dry-run l'host restituisce la descrizione di cosa farebbe, piu' l'even-
  // tuale dettaglio (comando simulato).
  const r = res.data.result ?? {};
  const testo = r.result?.detail ?? r.detail ?? r.description ?? t('edit.testOk');
  box.textContent = `✓ ${testo}`;
  box.className = 'sheet-hint ok';
}

async function removeButton(buttonId) {
  const deck = cloneDeck();
  const page = findPage(findProfile(deck, state.profileId), currentPage().id);
  page.buttons = page.buttons.filter((b) => b.id !== buttonId);
  await persistDeck(deck, t('edit.removed'));
}

/** Chiede conferma prima di eliminare un tile dalla "x" in modifica. */
function confirmRemoveTile(buttonId) {
  const button = currentPage()?.buttons.find((b) => b.id === buttonId);
  if (!button) return;
  openSheet({
    title: t('edit.removeTitle'),
    body: `<p class="sheet-text">${t('edit.removeBody', { label: escapeHtml(button.label || button.id) })}</p>`,
    actions: [
      { label: t('sheet.cancel'), kind: 'ghost', onClick: () => closeSheet() },
      { label: t('sheet.delete'), kind: 'danger', onClick: () => { closeSheet(); removeButton(buttonId); } }
    ]
  });
}

/**
 * Sposta un controllo in un'altra cella della stessa pagina.
 *
 * Se la cella di arrivo e' occupata da un altro tile i due si SCAMBIANO di
 * posto: cosi' si puo' riordinare anche una pagina piena, non solo trascinare
 * verso le caselle vuote (era la causa del "non riesco a spostare i pulsanti").
 * @param {string} buttonId
 * @param {{row: number, col: number}} target
 */
async function moveButton(buttonId, target) {
  const deck = cloneDeck();
  const page = findPage(findProfile(deck, state.profileId), currentPage().id);
  const button = page.buttons.find((b) => b.id === buttonId);
  if (!button) return false;
  if (button.row === target.row && button.col === target.col) return false;

  // Chi occupa la cella di arrivo (tenendo conto della larghezza/span).
  const occupant = page.buttons.find((b) => {
    if (b.id === button.id) return false;
    if (b.row !== target.row) return false;
    const span = Number(b.span) || 1;
    return target.col >= b.col && target.col < b.col + span;
  });

  if (occupant) {
    // Scambio: l'altro tile prende la vecchia posizione di questo.
    occupant.row = button.row;
    occupant.col = button.col;
  }
  button.row = target.row;
  button.col = target.col;
  return persistDeck(deck, t('edit.moved'), { quiet: true });
}

// ------------------------------------------------- pagine

/** Pannello di gestione di una pagina. */
function editPage(pageId) {
  const profile = currentProfile();
  const page = findPage(profile, pageId) ?? currentPage();
  const isLast = profile.pages.length <= 1;
  const index = profile.pages.findIndex((p) => p.id === page.id);
  const isDefault = profile.defaultPage === page.id;

  openSheet({
    title: t('page.title', { name: page.name }),
    body: `
      <label class="field"><span>${t('page.name')}</span><input id="pg-name" type="text" maxlength="64" value="${escapeHtml(page.name)}" /></label>
      <label class="field"><span>${t('page.type')}</span><select id="pg-source" class="select wide">
        <option value=""${!page.source ? ' selected' : ''}>${t('page.typeNormal')}</option>
        <option value="windows"${page.source === 'windows' ? ' selected' : ''}>${t('page.typeWindows')}</option>
        <option value="apps"${page.source === 'apps' ? ' selected' : ''}>${t('page.typeApps')}</option>
        <option value="widgets"${page.source === 'widgets' ? ' selected' : ''}>${t('page.typeWidgets')}</option>
      </select></label>
      <p class="sheet-hint">${t('page.typeHint')}</p>
      <div class="field-row">
        <label class="field"><span>${t('page.rows')}</span><input id="pg-rows" type="number" min="1" max="8" value="${page.rows}" /></label>
        <label class="field"><span>${t('page.cols')}</span><input id="pg-cols" type="number" min="1" max="12" value="${page.cols}" /></label>
      </div>
      <p class="sheet-hint">${t('page.resizeHint')}</p>
      <div class="field-row">
        <button class="btn ghost" type="button" id="pg-left"${index === 0 ? ' disabled' : ''}>${t('page.moveLeft')}</button>
        <button class="btn ghost" type="button" id="pg-right"${index === profile.pages.length - 1 ? ' disabled' : ''}>${t('page.moveRight')}</button>
      </div>
      <label class="field checkbox"><input id="pg-default" type="checkbox"${isDefault ? ' checked disabled' : ''} /><span>${t('page.default')}</span></label>
      ${isLast ? `<p class="sheet-hint">${t('page.onlyOne')}</p>` : ''}

      <h3 class="sheet-section">${t('page.groups')}</h3>
      <p class="sheet-hint">${t('page.groupsHint')}</p>
      <div id="pg-groups" class="pg-groups"></div>
      <button class="btn ghost small" type="button" id="pg-add-group">${t('page.addGroup')}</button>
    `,
    actions: [
      ...(isLast ? [] : [{ label: t('sheet.delete'), kind: 'danger', onClick: () => removePage(page.id) }]),
      { label: t('sheet.cancel'), kind: 'ghost', onClick: () => closeSheet() },
      { label: t('sheet.save'), kind: 'primary', onClick: () => savePage(page.id) }
    ]
  });

  el('pg-left').addEventListener('click', () => movePage(page.id, -1));
  el('pg-right').addEventListener('click', () => movePage(page.id, 1));

  // Sezione gruppi: righe editabili (colore + label + elimina), con "aggiungi".
  const groupsBox = el('pg-groups');
  const addGroupRow = (group) => {
    const row = document.createElement('div');
    row.className = 'pg-group-row';
    row.dataset.id = group?.id ?? uniqueSlug('gruppo', pageGroupIds());
    row.innerHTML = `
      <input type="color" class="pg-group-color" value="${group?.color ?? '#4c8dff'}" />
      <input type="text" class="pg-group-label" maxlength="32" placeholder="${t('page.groupLabelPh')}" value="${escapeHtml(group?.label ?? '')}" />
      <button type="button" class="icon-btn pg-group-del" title="${t('edit.remove')}">&#10005;</button>`;
    row.querySelector('.pg-group-del').addEventListener('click', () => row.remove());
    groupsBox.appendChild(row);
  };
  // id gia' presenti fra le righe, per generarne di nuovi senza collisioni.
  function pageGroupIds() {
    return [...groupsBox.querySelectorAll('.pg-group-row')].map((r) => r.dataset.id);
  }
  (page.groups ?? []).forEach((g) => addGroupRow(g));
  el('pg-add-group').addEventListener('click', () => addGroupRow(null));
}

async function savePage(pageId) {
  const deck = cloneDeck();
  const profile = findProfile(deck, state.profileId);
  const page = findPage(profile, pageId);
  page.name = el('pg-name').value.trim() || page.id;
  page.rows = Math.max(1, Math.min(8, Number(el('pg-rows').value) || page.rows));
  page.cols = Math.max(1, Math.min(12, Number(el('pg-cols').value) || page.cols));
  const src = el('pg-source')?.value;
  if (src) page.source = src; else delete page.source;
  if (el('pg-default').checked) profile.defaultPage = page.id;

  // Gruppi: si leggono le righe della sezione; una riga senza label si scarta.
  const groups = [];
  for (const row of document.querySelectorAll('#pg-groups .pg-group-row')) {
    const label = row.querySelector('.pg-group-label').value.trim();
    if (!label) continue;
    groups.push({ id: row.dataset.id, label, color: row.querySelector('.pg-group-color').value });
  }
  page.groups = groups;
  // I bottoni che puntavano a un gruppo ora rimosso perdono il riferimento,
  // altrimenti la validazione dell'host rifiuterebbe il deck.
  const validGroupIds = new Set(groups.map((g) => g.id));
  for (const b of page.buttons) if (b.group && !validGroupIds.has(b.group)) b.group = null;

  await persistDeck(deck, t('page.saved', { name: page.name }));
}

async function addPage() {
  const deck = cloneDeck();
  const profile = findProfile(deck, state.profileId);
  const model = findPage(profile, state.pageId) ?? profile.pages[0];
  const id = uniqueSlug('pagina', profile.pages.map((p) => p.id));
  profile.pages.push({
    id,
    name: `Pagina ${profile.pages.length + 1}`,
    rows: model?.rows ?? 3,
    cols: model?.cols ?? 5,
    buttons: []
  });
  if (await persistDeck(deck, t('page.added'))) goToPage(id);
}

async function removePage(pageId) {
  const deck = cloneDeck();
  const profile = findProfile(deck, state.profileId);
  if (profile.pages.length <= 1) {
    toast(t('page.needsOne'), 'err');
    return;
  }
  profile.pages = profile.pages.filter((p) => p.id !== pageId);
  if (profile.defaultPage === pageId) profile.defaultPage = profile.pages[0].id;
  if (await persistDeck(deck, t('page.removed'))) goToPage(profile.pages[0].id);
}

async function movePage(pageId, delta) {
  const deck = cloneDeck();
  const profile = findProfile(deck, state.profileId);
  const index = profile.pages.findIndex((p) => p.id === pageId);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= profile.pages.length) return;
  const [page] = profile.pages.splice(index, 1);
  profile.pages.splice(target, 0, page);
  await persistDeck(deck, t('page.reordered'));
}

// ------------------------------------------------- profili

/** Pannello di gestione dei profili. */
function editProfiles() {
  const deck = state.deck;
  const rows = deck.profiles.map((p) => `
    <div class="host-row">
      <span>${escapeHtml(p.name)}<small>${t('profile.pages', { n: p.pages.length })}${p.id === deck.defaultProfile ? ` - ${t('profile.isDefault')}` : ''}</small></span>
      <span class="row-actions">
        ${p.id === deck.defaultProfile ? '' : `<button class="btn ghost small" type="button" data-profile-default="${p.id}">${t('profile.setDefault')}</button>`}
        <button class="btn ghost small" type="button" data-profile-rename="${p.id}">${t('profile.rename')}</button>
        ${deck.profiles.length > 1 ? `<button class="btn ghost small danger" type="button" data-profile-remove="${p.id}">${t('sheet.delete')}</button>` : ''}
      </span>
    </div>`).join('');

  openSheet({
    title: t('profile.title'),
    body: `
      <div class="host-list">${rows}</div>
      <label class="field"><span>${t('profile.newName')}</span><input id="pr-name" type="text" maxlength="64" placeholder="Streaming" /></label>
      <button class="btn" type="button" id="pr-add">${t('profile.add')}</button>
      <p class="sheet-hint">${t('profile.addHint')}</p>
    `,
    actions: [{ label: t('sheet.close'), kind: 'ghost', onClick: () => closeSheet() }]
  });

  el('pr-add').addEventListener('click', () => addProfile(el('pr-name').value));
  for (const button of ui.sheetBody.querySelectorAll('[data-profile-remove]')) {
    button.addEventListener('click', () => removeProfile(button.dataset.profileRemove));
  }
  for (const button of ui.sheetBody.querySelectorAll('[data-profile-default]')) {
    button.addEventListener('click', () => setDefaultProfile(button.dataset.profileDefault));
  }
  for (const button of ui.sheetBody.querySelectorAll('[data-profile-rename]')) {
    button.addEventListener('click', () => renameProfile(button.dataset.profileRename));
  }
}

async function addProfile(rawName) {
  const deck = cloneDeck();
  const name = String(rawName ?? '').trim() || `Profilo ${deck.profiles.length + 1}`;
  const id = uniqueSlug(slugify(name, 'profilo'), deck.profiles.map((p) => p.id));
  const model = currentPage();
  deck.profiles.push({
    id,
    name,
    defaultPage: 'home',
    pages: [{ id: 'home', name: 'Principale', rows: model?.rows ?? 3, cols: model?.cols ?? 5, buttons: [] }]
  });
  if (await persistDeck(deck, t('profile.created', { name }))) switchProfile(id);
}

async function removeProfile(profileId) {
  const deck = cloneDeck();
  if (deck.profiles.length <= 1) {
    toast(t('profile.needsOne'), 'err');
    return;
  }
  deck.profiles = deck.profiles.filter((p) => p.id !== profileId);
  if (deck.defaultProfile === profileId) deck.defaultProfile = deck.profiles[0].id;
  const saved = await persistDeck(deck, t('profile.removed'));
  if (saved && state.profileId === profileId) switchProfile(deck.profiles[0].id);
}

async function setDefaultProfile(profileId) {
  const deck = cloneDeck();
  deck.defaultProfile = profileId;
  await persistDeck(deck, t('profile.defaultUpdated'));
}

function renameProfile(profileId) {
  const profile = findProfile(state.deck, profileId);
  openSheet({
    title: t('profile.renameTitle', { name: profile.name }),
    body: `<label class="field"><span>${t('page.name')}</span><input id="pr-rename" type="text" maxlength="64" value="${escapeHtml(profile.name)}" /></label>`,
    actions: [
      { label: t('sheet.cancel'), kind: 'ghost', onClick: () => editProfiles() },
      {
        label: t('sheet.save'),
        kind: 'primary',
        onClick: async () => {
          const deck = cloneDeck();
          findProfile(deck, profileId).name = el('pr-rename').value.trim() || profileId;
          await persistDeck(deck, t('profile.renamed'));
        }
      }
    ]
  });
}

/** Passa a un profilo, sincronizzando host e memoria locale. */
function switchProfile(profileId) {
  state.profileId = profileId;
  state.pageId = null;
  localStorage.setItem(STORAGE.profile, profileId);
  renderAll();
  send({ type: MSG.navigate, profile: profileId });
}

/** Invia il deck modificato all'host, che lo valida e lo scrive su disco. */
async function persistDeck(deck, successMessage, { quiet = false } = {}) {
  const res = await api(ENDPOINTS.save, { method: 'POST', body: { deck } });
  if (!res.ok) {
    if (isOffline(res)) {
      toast(t('net.unreachable'), 'err');
      return false;
    }
    const detail = (res.data.errors ?? []).slice(0, 3).map((e) => `${e.path}: ${e.message}`).join(' | ');
    toast(detail || res.data?.error?.message || t('edit.rejected'), 'err');
    return false;
  }
  if (!quiet) closeSheet();
  toast(successMessage, 'ok');
  return true;
}

// ---------------------------------------------------------------- impostazioni

/**
 * Contenuto della sezione "Aggiornamenti" del pannello impostazioni. Estratto in
 * una funzione perche' va **ridisegnato dopo un controllo**: prima il pulsante
 * "Scarica e installa" era scritto una volta all'apertura del pannello, quindi
 * premendo "Controlla ora" l'aggiornamento veniva trovato ma il pulsante non
 * compariva finche' non si richiudeva e riapriva le impostazioni.
 */
function updateSectionInner() {
  const update = state.update;
  const disponibile = update?.available;
  const puoInstallare = disponibile && state.selfUpdate?.supported;
  return `
    <h3 class="sheet-section">${t('settings.updates')}</h3>
    <p class="sheet-hint" id="set-update">${disponibile
    ? t('settings.updateAvailable', { version: escapeHtml(update.latest?.version || '?'), current: escapeHtml(update.current || '-') })
    : t('settings.updateNone', { current: escapeHtml(update?.current || '-') })}</p>
    <button class="btn" type="button" id="set-check-update">${t('settings.checkNow')}</button>
    ${puoInstallare
    ? `<button class="btn primary" type="button" id="set-apply-update">${t('settings.installUpdate')}</button>
       <p class="sheet-hint">${t('settings.installHint')}</p>`
    : disponibile && state.selfUpdate?.reason
      ? `<p class="sheet-hint">${escapeHtml(state.selfUpdate.reason)}</p>`
      : ''}
  `;
}

/** Ridisegna la sezione aggiornamenti e ricollega i suoi pulsanti. */
function refreshUpdateSection() {
  const box = el('set-update-box');
  if (!box) return;
  box.innerHTML = updateSectionInner();
  bindUpdateSection();
}

/** Collega "Controlla ora" (che poi ridisegna) e "Scarica e installa". */
function bindUpdateSection() {
  el('set-check-update')?.addEventListener('click', async () => {
    const btn = el('set-check-update');
    if (btn) btn.disabled = true;
    await checkUpdate({ force: true });
    refreshUpdateSection();
  });
  el('set-apply-update')?.addEventListener('click', applyUpdate);
}

async function openSettings() {
  const res = await api(ENDPOINTS.settings);
  // Senza host raggiungibile il pannello si aprirebbe vuoto e ingannevole:
  // meglio dirlo e non aprirlo.
  if (isOffline(res)) {
    toast(t('net.unreachable'), 'err');
    return;
  }
  const settings = res.data?.settings ?? {};

  const temaAttuale = state.deck?.ui?.theme ?? 'dark';
  const stileAttuale = state.deck?.ui?.style ?? 'default';
  const linguaAttuale = state.deck?.ui?.language ?? 'auto';
  const opzione = (value, selected, label) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`;

  openSheet({
    title: t('settings.title'),
    body: `
      <h3 class="sheet-section">${t('settings.access')}</h3>
      <label class="field"><span>${t('settings.pin')}</span>
        <input id="set-pin" type="text" inputmode="numeric" maxlength="12" placeholder="${settings.security?.pinConfigured ? t('settings.pinConfigured', { n: settings.security.pinLength }) : t('settings.pinNone')}" />
      </label>
      <p class="sheet-hint">${t('settings.pinHint')}</p>

      <h3 class="sheet-section">${t('settings.appearance')}</h3>
      <div class="field-row">
        <label class="field"><span>${t('settings.theme')}</span><select id="set-theme" class="select">
          ${opzione('dark', temaAttuale, t('settings.themeDark'))}
          ${opzione('light', temaAttuale, t('settings.themeLight'))}
          ${opzione('auto', temaAttuale, t('settings.themeAuto'))}
        </select></label>
        <label class="field"><span>${t('settings.language')}</span><select id="set-language" class="select">
          ${opzione('auto', linguaAttuale, t('settings.languageAuto'))}
          ${opzione('it', linguaAttuale, 'Italiano')}
          ${opzione('en', linguaAttuale, 'English')}
        </select></label>
      </div>
      <label class="field"><span>${t('settings.style')}</span><select id="set-style" class="select wide">
        ${opzione('default', stileAttuale, t('settings.styleDefault'))}
        ${opzione('keycap', stileAttuale, t('settings.styleKeycap'))}
        ${opzione('ceramica', stileAttuale, t('settings.styleCeramica'))}
        ${opzione('console', stileAttuale, t('settings.styleConsole'))}
        ${opzione('quaderno', stileAttuale, t('settings.styleQuaderno'))}
        ${opzione('strumento', stileAttuale, t('settings.styleStrumento'))}
        ${opzione('oscura', stileAttuale, t('settings.styleOscura'))}
      </select></label>
      <p class="sheet-hint">${t('settings.styleHint')}</p>

      <h3 class="sheet-section">${t('settings.computers')}</h3>
      <div class="host-list">${state.hosts.map((h) => `
        <div class="host-row">
          <span>${escapeHtml(h.name)}<small>${escapeHtml(h.base)}</small></span>
          <button class="btn ghost small" type="button" data-forget="${h.id}">${t('settings.remove')}</button>
        </div>`).join('') || `<p class="sheet-hint">${t('settings.noComputers')}</p>`}
      </div>
      <button class="btn" type="button" id="set-add-host">${t('settings.addComputer')}</button>

      <h3 class="sheet-section">${t('settings.pairTitle')}</h3>
      <p class="sheet-hint">${t('settings.pairHint')}</p>
      <div class="qr-box" id="set-qr"><button class="btn" type="button" id="set-qr-show">${t('settings.showQr')}</button></div>

      <h3 class="sheet-section">${t('settings.devices')}</h3>
      <div class="host-list" id="set-devices"><p class="sheet-hint">${t('settings.qrGenerating')}</p></div>
      <p class="sheet-hint">${t('settings.devicesHint')}</p>

      <h3 class="sheet-section">${t('settings.token')}</h3>
      <p class="sheet-hint">${t('settings.tokenHint')}</p>
      <button class="btn ghost" type="button" id="set-rotate">${t('settings.rotate')}</button>

      <div id="set-update-box">${updateSectionInner()}</div>
    `,
    actions: [
      { label: t('sheet.close'), kind: 'ghost', onClick: () => closeSheet() },
      { label: t('sheet.save'), kind: 'primary', onClick: saveSettings }
    ]
  });

  el('set-add-host').addEventListener('click', () => {
    closeSheet();
    showGate(t('gate.addHost'));
  });
  bindUpdateSection();
  el('set-rotate').addEventListener('click', rotateHostToken);
  el('set-qr-show').addEventListener('click', showPairingQr);
  renderDevices();
  for (const btn of ui.sheetBody.querySelectorAll('[data-forget]')) {
    btn.addEventListener('click', () => forgetHost(btn.dataset.forget));
  }
}

/**
 * Mostra il QR di accoppiamento.
 *
 * Non viene caricato all'apertura delle impostazioni ma solo su richiesta:
 * ogni chiamata crea un token nuovo, e non ha senso crearne uno ogni volta che
 * qualcuno apre il pannello per cambiare il PIN.
 */
async function showPairingQr() {
  const box = el('set-qr');
  box.innerHTML = `<p class="sheet-hint">${t('settings.qrGenerating')}</p>`;
  const res = await api(`${ENDPOINTS.pairQr}?name=${encodeURIComponent('accoppiato con QR')}`);
  if (!res.ok) {
    box.innerHTML = `<p class="sheet-hint">${escapeHtml(res.data?.error?.message ?? t('settings.qrUnavailable'))}</p>`;
    return;
  }
  // res.data.svg e' l'SVG del QR generato dall'host autenticato: e' output
  // fidato (non input dell'utente) e va inserito cosi' com'e'. Tutto cio' che
  // e' testo (url, mdns) resta comunque passato da escapeHtml.
  box.innerHTML = `<div class="qr">${res.data.svg}</div>`
    + `<p class="sheet-hint">${escapeHtml(res.data.url.replace(/token=[^&]+/, 'token=...'))}</p>`
    + (res.data.mdns ? `<p class="sheet-hint">${t('settings.qrOr', { url: `<code>${escapeHtml(res.data.mdns)}</code>` })}</p>` : '');
  renderDevices();
}

/** Elenco dei dispositivi accoppiati sull'host attivo. */
async function renderDevices() {
  const box = el('set-devices');
  if (!box) return;
  const res = await api(ENDPOINTS.devices);
  if (!res.ok) {
    box.innerHTML = `<p class="sheet-hint">${isOffline(res) ? t('net.unreachable') : t('settings.devicesUnavailable')}</p>`;
    return;
  }

  const devices = res.data.devices ?? [];
  if (devices.length === 0) {
    box.innerHTML = `<p class="sheet-hint">${t('settings.devicesNone')}</p>`;
    return;
  }

  box.innerHTML = devices.map((d) => {
    const scadenza = d.expiresAt ? new Date(d.expiresAt).toLocaleDateString(language()) : t('settings.noExpiry');
    const nota = d.id === res.data.current ? ` - ${t('settings.thisDevice')}` : '';
    return `<div class="host-row">
      <span>${escapeHtml(d.name)}<small>${d.expired ? t('settings.expired') : scadenza}${nota}</small></span>
      <button class="btn ghost small danger" type="button" data-revoke="${d.id}">${t('settings.revoke')}</button>
    </div>`;
  }).join('');

  for (const button of box.querySelectorAll('[data-revoke]')) {
    button.addEventListener('click', () => revokeDevice(button.dataset.revoke));
  }
}

async function revokeDevice(id) {
  const res = await api(`${ENDPOINTS.devices}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    toast(isOffline(res) ? t('net.unreachable') : (res.data?.error?.message ?? t('settings.revokeRejected')), 'err');
    return;
  }
  toast(t('settings.revoked'), 'ok');
  renderDevices();
}

/** Rigenera il token principale e aggiorna quello salvato qui. */
async function rotateHostToken() {
  const res = await api(ENDPOINTS.tokenRotate, { method: 'POST', body: {} });
  if (!res.ok) {
    toast(isOffline(res) ? t('net.unreachable') : (res.data?.error?.message ?? t('settings.rotateRejected')), 'err');
    return;
  }
  // Se questo client stava usando proprio il token principale, deve adottare
  // il nuovo subito: altrimenti si scollegherebbe da solo.
  const host = activeHost();
  if (host && res.data.token) {
    host.token = res.data.token;
    saveHosts();
  }
  toast(t('settings.rotated'), 'ok');
}

async function saveSettings() {
  const pin = el('set-pin').value.trim();
  const patch = {};
  if (pin) patch.pin = pin;

  const ui = {};
  const tema = el('set-theme').value;
  const stile = el('set-style')?.value ?? 'default';
  const lingua = el('set-language').value;
  if (tema !== (state.deck?.ui?.theme ?? 'dark')) ui.theme = tema;
  if (stile !== (state.deck?.ui?.style ?? 'default')) ui.style = stile;
  if (lingua !== (state.deck?.ui?.language ?? 'auto')) ui.language = lingua;
  if (Object.keys(ui).length > 0) patch.ui = ui;

  if (Object.keys(patch).length === 0) {
    closeSheet();
    return;
  }

  const res = await api(ENDPOINTS.settings, { method: 'POST', body: patch });
  if (!res.ok) {
    toast(isOffline(res) ? t('net.unreachable') : (res.data?.error?.message ?? t('settings.rejected')), 'err');
    return;
  }
  closeSheet();
  toast(t(pin && !patch.ui ? 'settings.pinUpdated' : 'settings.saved'), 'ok');
}

function forgetHost(id) {
  state.hosts = state.hosts.filter((h) => h.id !== id);
  saveHosts();
  closeSheet();
  if (id === state.activeHostId) {
    state.activeHostId = state.hosts[0]?.id ?? null;
    if (state.activeHostId) switchHost(state.activeHostId);
    else showGate(t('gate.noHost'));
  }
  renderHosts();
}

// ---------------------------------------------------------------- aggiornamenti

// Una volta sola per caricamento: evita che una riconnessione mentre si sta
// modificando il deck faccia scattare una ricarica a sorpresa.
let freshnessChecked = false;

/**
 * Si accorge se questa pagina e' una copia vecchia rimasta in cache. Il service
 * worker della PWA serve l'app anche quando l'host e' stato aggiornato, quindi
 * un client puo' restare indietro all'infinito senza dirlo (era esattamente il
 * sintomo "versione vuota, nessun aggiornamento, esattamente come prima").
 *
 * Confronta l'impronta di build del client caricato (dal <meta wdeck-build>,
 * che riflette la copia in cache) con quella dell'host, letta da /api/health -
 * che il service worker non intercetta mai, quindi arriva sempre fresca. Se non
 * coincidono, pulisce la cache e ricarica **una volta sola**: il client stantio
 * si aggiorna da se' invece di mostrare una versione vecchia.
 */
async function checkClientFreshness() {
  if (freshnessChecked) return;
  freshnessChecked = true;

  const mine = document.querySelector('meta[name="wdeck-build"]')?.content ?? '';
  if (!mine) return; // build non marcata (sviluppo): niente da confrontare

  let hostBuild;
  let hostVersion;
  try {
    const res = await api(ENDPOINTS.health);
    if (!res.ok || !res.data?.buildId) return;
    hostBuild = res.data.buildId;
    hostVersion = res.data.version;
    if (hostVersion) { state.version = hostVersion; renderVersion(); }
  } catch {
    return; // host non raggiungibile: si riprovera' al prossimo collegamento
  }

  // Se l'host ha una versione diversa da quella su cui si basa il banner, ci
  // siamo appena aggiornati: il banner mostrerebbe ancora "disponibile" perche'
  // il controllo automatico e' limitato a uno ogni 10 minuti. Un controllo
  // fresco (togliendo il freno) lo azzera se ora siamo all'ultima versione.
  // Va fatto SEMPRE (anche prima dell'eventuale auto-guarigione della cache):
  // se la ricarica non parte, e' l'unico modo di aggiornare il banner.
  if (hostVersion && state.update && state.update.current && state.update.current !== hostVersion) {
    lastAutoCheck = 0;
    checkUpdate({ quiet: true });
  }

  if (hostBuild === mine) {
    try { sessionStorage.removeItem('wdeck.stale'); } catch { /* storage assente */ }
    // Client allineato all'host: e' il momento buono per raccontare le novita'
    // se veniamo da un aggiornamento (versione cambiata da quella vista prima).
    maybeWhatsNew(hostVersion);
    return;
  }

  // Disallineati: la pagina e' vecchia. Ci si guarisce una sola volta per ogni
  // build dell'host; se dopo la ricarica e' ancora diversa (caso raro) ci si
  // limita ad avvisare, per non entrare in un ciclo di ricariche.
  let gia = false;
  try { gia = sessionStorage.getItem('wdeck.stale') === hostBuild; } catch { /* storage assente */ }
  if (gia) {
    toast(t('update.reloadReady'), '');
    return;
  }
  try { sessionStorage.setItem('wdeck.stale', hostBuild); } catch { /* storage assente */ }

  toast(t('update.refreshing'), '');
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('wdeck-shell-')).map((k) => caches.delete(k)));
    }
    const reg = await navigator.serviceWorker?.getRegistration?.();
    await reg?.unregister?.();
  } catch { /* se la pulizia fallisce si ricarica lo stesso: meglio che restare vecchi */ }
  location.reload();
}

/**
 * Controllo aggiornamenti.
 * - `force`: chiede all'host una verifica FRESCA su GitHub (`?check=1`) invece
 *   dello stato periodico (che si aggiorna solo ogni 6 ore).
 * - `quiet`: fa comunque la verifica fresca ma senza i messaggi a schermo; e' il
 *   controllo automatico all'apertura, che deve accorgersi degli aggiornamenti
 *   e mostrare il banner senza infastidire con un toast a ogni collegamento.
 */
/**
 * Flusso di aggiornamento aperto dalla tray (deep-link "#update"): apre le
 * impostazioni, fa un controllo fresco e, se c'e' una versione nuova
 * installabile, avvia subito l'aggiornamento con la barra di avanzamento. Cosi'
 * chi lo lancia dall'icona vicino all'orologio vede la finestra che scarica e
 * installa, e capisce se sta procedendo.
 */
async function openUpdateFlow() {
  await openSettings();
  await checkUpdate({ force: true });
  refreshUpdateSection();
  if (state.update?.available && state.selfUpdate?.supported) applyUpdate();
  else if (!state.update?.available) toast(t('settings.upToDate', { current: state.update?.current || '-' }), 'ok');
}

// Ultimo controllo automatico: evita di interrogare GitHub a ogni riconnessione
// (una caduta di rete non deve tradursi in una raffica di richieste).
let lastAutoCheck = 0;

/**
 * Controllo automatico all'apertura/riconnessione: verifica fresca ma silenziosa,
 * al massimo una volta ogni 10 minuti. Cosi' aprendo l'app il banner compare da
 * solo se c'e' un aggiornamento, senza aspettare il controllo periodico (6 ore)
 * ne' costringere a premere "Controlla ora".
 */
function autoCheckUpdate() {
  const ora = Date.now();
  if (ora - lastAutoCheck < 10 * 60 * 1000) return;
  lastAutoCheck = ora;
  checkUpdate({ quiet: true });
}

async function checkUpdate({ force = false, quiet = false } = {}) {
  const fresco = force || quiet;
  const res = await api(`${ENDPOINTS.update}${fresco ? '?check=1' : ''}`);
  if (!res.ok) {
    // Il controllo automatico resta silenzioso; quello chiesto a mano no.
    if (force) toast(isOffline(res) ? t('net.unreachable') : t('settings.checkFailed'), 'err');
    return;
  }
  state.selfUpdate = res.data.selfUpdate ?? null;
  const update = res.data.update;
  showUpdate(update);
  if (!force) return;

  // Tre esiti distinti: il controllo puo' FALLIRE (GitHub irraggiungibile o a
  // corto di richieste), trovare un aggiornamento, oppure confermare che si e'
  // gia' all'ultima versione. Prima un controllo fallito veniva mostrato come
  // "sei aggiornato": una bugia. E il messaggio non diceva mai a che versione si
  // era. Ora ognuno dei tre casi ha il suo messaggio, con la versione in chiaro.
  // `|| '-'` e non `?? '-'`: anche una versione vuota (host che non l'ha
  // riportata) deve ricadere sul trattino, non lasciare il messaggio monco.
  const corrente = update?.current || '-';
  if (update?.error) {
    toast(`${t('settings.checkFailed')} ${update.error}`.trim(), 'err');
  } else if (update?.available) {
    toast(t('settings.updateAvailable', { version: update.latest?.version ?? '?', current: corrente }), 'ok');
  } else {
    toast(t('settings.upToDate', { current: corrente }), 'ok');
  }
}

/** Dimensione in byte resa leggibile: 84 MB invece di 88080384. */
function formatBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return `${num} B`;
  const kib = num / 1024;
  if (kib < 1024) return `${kib.toFixed(0)} KB`;
  return `${(kib / 1024).toFixed(1)} MB`;
}

/**
 * Scarica e installa la versione nuova. Prima chiede conferma con un pannello
 * in stile (non l'alert grezzo del browser), poi lo trasforma in una finestra
 * di avanzamento: l'host riferisce ogni fase via WebSocket e qui diventa una
 * barra. Da qui in poi l'host si sostituisce e riparte, quindi vale la pena
 * saperlo prima e vederlo mentre accade.
 */
function applyUpdate() {
  const versione = state.update?.latest?.version ?? '';
  openSheet({
    title: t('settings.installTitle'),
    body: `<p class="sheet-text">${t('settings.installConfirm', { version: escapeHtml(versione) })}</p>`,
    actions: [
      { label: t('sheet.cancel'), kind: 'ghost', onClick: () => closeSheet() },
      { label: t('settings.installUpdate'), kind: 'primary', onClick: () => startUpdate(versione) }
    ]
  });
}

/** Passa il pannello dalla conferma alla barra di avanzamento e lancia il POST. */
async function startUpdate(versione) {
  // Il pannello diventa una finestra di caricamento: niente pulsanti su cui
  // cliccare mentre scarica, solo la barra e la fase in corso.
  openSheet({
    title: t('settings.installTitle'),
    body: `
      <p class="sheet-text" id="upd-phase">${t('settings.installing')}</p>
      <div class="update-bar"><div class="update-bar-fill" id="upd-fill"></div></div>
      <p class="sheet-hint" id="upd-detail"></p>
    `
  });

  const res = await api(ENDPOINTS.updateApply, { method: 'POST' });
  if (!res.ok) {
    // La riga della firma non integra o l'impronta diversa arrivano qui: si
    // torna alla conferma, spiegando cosa non ha funzionato.
    openSheet({
      title: t('settings.installTitle'),
      body: `<p class="sheet-text">${escapeHtml(res.data?.error?.message ?? res.data?.message ?? t('settings.installFailed'))}</p>`,
      actions: [
        { label: t('sheet.close'), kind: 'ghost', onClick: () => closeSheet() },
        { label: t('settings.installUpdate'), kind: 'primary', onClick: () => startUpdate(versione) }
      ]
    });
    return;
  }

  // 200 = binario sostituito: l'host sta per ripartire. Portiamo la barra a
  // fondo corsa, poi chiudiamo il pannello: la riconnessione automatica
  // ricarica il deck da sola quando il nuovo processo e' su.
  renderUpdateProgress({ phase: 'riavvio' });
  toast(t('settings.installed', { version: res.data.version ?? versione }), 'ok');
  setTimeout(() => {
    if (el('upd-fill')) closeSheet(); // solo se e' ancora il pannello di avanzamento
  }, 2500);
}

/**
 * Disegna l'avanzamento dell'aggiornamento dentro il pannello aperto.
 * Riceve le fasi cosi' come le manda l'host in `update-apply.mjs`.
 * @param {{phase: string, done?: number, total?: number}} avanzamento
 */
function renderUpdateProgress({ phase, done, total } = {}) {
  const fill = el('upd-fill');
  const fase = el('upd-phase');
  const dettaglio = el('upd-detail');
  if (!fill || !fase) return; // il pannello di avanzamento non e' aperto

  let percento = null;
  let testo = '';
  let nota = '';
  switch (phase) {
    case 'download':
      percento = 3;
      testo = t('settings.updDownloading');
      if (total) nota = formatBytes(total);
      break;
    case 'progresso':
      percento = total ? Math.min(90, Math.round((done / total) * 90)) : null;
      testo = t('settings.updDownloading');
      nota = total ? `${formatBytes(done)} / ${formatBytes(total)}` : formatBytes(done);
      break;
    case 'verifica':
      percento = 93; testo = t('settings.updVerifying'); break;
    case 'firma':
      percento = 96; testo = t('settings.updSigning'); break;
    case 'sostituzione':
      percento = 99; testo = t('settings.updInstalling'); break;
    case 'riavvio':
      percento = 100; testo = t('settings.updRestarting'); break;
    default:
      break;
  }
  if (percento != null) fill.style.width = `${percento}%`;
  if (testo) fase.textContent = testo;
  if (dettaglio) dettaglio.textContent = nota;
}

function showUpdate(status) {
  state.update = status;
  if (status?.current && !state.version) { state.version = status.current; renderVersion(); }
  ui.update.hidden = !status?.available;
  if (status?.available) {
    ui.update.textContent = `v${status.latest.version}`;
    ui.update.title = t('settings.updateAvailable', { version: status.latest.version, current: status.current });
  }
  renderUpdateBanner(status);
}

/**
 * Banner di nuova versione in cima all'app. Compare quando c'e' un
 * aggiornamento, si chiude con la X e resta chiuso finche' l'app non viene
 * riaperta (dismiss in sessionStorage) o finche' non arriva una versione ancora
 * piu' nuova. Non e' invadente: una riga che si puo' ignorare.
 */
function renderUpdateBanner(status) {
  if (!ui.banner) return;
  const versione = status?.available ? status.latest?.version : null;
  let chiuso = null;
  try { chiuso = sessionStorage.getItem('wdeck.updbanner'); } catch { /* storage assente */ }
  if (!versione || chiuso === versione) {
    ui.banner.hidden = true;
    return;
  }
  ui.bannerText.textContent = t('banner.available', { version: versione });
  // "Aggiorna" ha senso solo se questa installazione sa sostituirsi da sola.
  el('ub-apply').hidden = !state.selfUpdate?.supported;
  ui.banner.hidden = false;
}

/**
 * Rende leggibili le note di rilascio (dal corpo della release GitHub, testo di
 * fonte esterna: si scappa sempre l'HTML e si applica solo una formattazione
 * minima sul testo gia' neutralizzato). Titoli, elenchi puntati e grassetto.
 */
function renderNotes(testo) {
  const righe = escapeHtml(String(testo ?? '').trim()).split(/\r?\n/);
  const out = [];
  let inLista = false;
  const chiudiLista = () => { if (inLista) { out.push('</ul>'); inLista = false; } };
  for (const riga of righe) {
    const t2 = riga.trim();
    if (!t2) { chiudiLista(); continue; }
    const h = /^#{1,6}\s+(.*)$/.exec(t2);
    const li = /^[-*]\s+(.*)$/.exec(t2);
    if (h) { chiudiLista(); out.push(`<h4>${bold(h[1])}</h4>`); }
    else if (li) { if (!inLista) { out.push('<ul>'); inLista = true; } out.push(`<li>${bold(li[1])}</li>`); }
    else { chiudiLista(); out.push(`<p>${bold(t2)}</p>`); }
  }
  chiudiLista();
  return out.join('');
  function bold(s) { return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>'); }
}

/** Mostra le note della versione disponibile, con l'opzione di aggiornare. */
function showReleaseNotes() {
  const latest = state.update?.latest;
  if (!latest) return;
  openSheet({
    title: t('banner.notesTitle', { version: latest.version }),
    body: `<div class="release-notes">${latest.notes ? renderNotes(latest.notes) : `<p class="sheet-hint">${t('banner.noNotes')}</p>`}</div>`,
    actions: [
      { label: t('sheet.close'), kind: 'ghost', onClick: () => closeSheet() },
      ...(state.selfUpdate?.supported
        ? [{ label: t('banner.update'), kind: 'primary', onClick: () => { closeSheet(); applyUpdate(); } }]
        : [])
    ]
  });
}

/**
 * Dopo un aggiornamento, mostra una volta le novita' della nuova versione.
 * Confronta la versione dell'host con l'ultima vista su questo dispositivo:
 * alla prima installazione tace (c'e' gia' il benvenuto), poi appare solo quando
 * la versione e' cambiata e abbiamo qualcosa da raccontare per quella versione.
 */
function maybeWhatsNew(hostVersion) {
  if (!hostVersion) return;
  let last = null;
  try {
    last = localStorage.getItem('wdeck.lastVersion');
    localStorage.setItem('wdeck.lastVersion', hostVersion);
  } catch { return; }
  if (!last || last === hostVersion) return;
  const punti = WHATSNEW[hostVersion];
  if (!punti?.length) return;
  openSheet({
    title: t('whatsnew.title', { version: hostVersion }),
    body: `<ul class="whatsnew-list">${punti.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`,
    actions: [{ label: t('whatsnew.ok'), kind: 'primary', onClick: () => closeSheet() }]
  });
}

// ---------------------------------------------------------------- interazione

function bindEvents() {
  ui.gatePair.addEventListener('click', pairWithPin);
  ui.gateTokenSave.addEventListener('click', saveManualToken);

  ui.hosts.addEventListener('click', (event) => {
    const add = event.target.closest('[data-host-add]');
    if (add) {
      showGate(t('gate.addHost'));
      return;
    }
    const tab = event.target.closest('.host-tab');
    if (tab?.dataset.host) switchHost(tab.dataset.host);
  });

  ui.profileSelect.addEventListener('change', () => {
    if (ui.profileSelect.value === '__gestisci__') {
      ui.profileSelect.value = state.profileId;
      editProfiles();
      return;
    }
    switchProfile(ui.profileSelect.value);
  });

  ui.pages.addEventListener('click', (event) => {
    if (event.target.closest('[data-page-add]')) {
      addPage();
      return;
    }
    const tab = event.target.closest('.page-tab');
    if (!tab?.dataset.page) return;
    // In modifica la matita sulla scheda apre le impostazioni della pagina;
    // il resto della scheda continua a cambiare pagina, come sempre.
    if (state.editing && event.target.closest('.page-edit')) {
      editPage(tab.dataset.page);
      return;
    }
    goToPage(tab.dataset.page);
  });

  bindGrid();
  bindSheet();

  ui.btnEdit.addEventListener('click', () => setEditing(!state.editing));

  ui.btnSimulate.addEventListener('click', () => {
    state.simulate = !state.simulate;
    ui.btnSimulate.setAttribute('aria-pressed', String(state.simulate));
    toast(t(state.simulate ? 'sim.on' : 'sim.off'));
  });

  ui.btnFullscreen.addEventListener('click', async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen().catch(() => toast(t('fullscreen.unavailable'), 'err'));
  });

  ui.btnSettings.addEventListener('click', openSettings);
  ui.update.addEventListener('click', () => showReleaseNotes());

  // Banner di nuova versione: aggiorna, mostra le novita', oppure chiudi.
  el('ub-apply')?.addEventListener('click', () => applyUpdate());
  el('ub-notes')?.addEventListener('click', () => showReleaseNotes());
  el('ub-close')?.addEventListener('click', () => {
    const versione = state.update?.latest?.version;
    if (versione) { try { sessionStorage.setItem('wdeck.updbanner', versione); } catch { /* storage assente */ } }
    if (ui.banner) ui.banner.hidden = true;
  });

  window.addEventListener('online', () => { if (token()) connect(); });
}

/** Passa a una pagina della griglia, aggiornando host e memoria locale. */
function goToPage(pageId, { animate = null } = {}) {
  if (!pageId || pageId === currentPage()?.id) return;
  state.pageId = pageId;
  localStorage.setItem(STORAGE.page, pageId);
  if (animate) {
    ui.grid.classList.add(animate === 'left' ? 'slide-from-right' : 'slide-from-left');
    setTimeout(() => ui.grid.classList.remove('slide-from-right', 'slide-from-left'), 220);
  }
  renderAll();
  send({ type: MSG.navigate, profile: state.profileId, page: pageId });
}

/** Passa alla pagina precedente o successiva del profilo (usato dallo swipe). */
function stepPage(delta) {
  const profile = currentProfile();
  const page = currentPage();
  if (!profile || !page) return;
  const index = profile.pages.findIndex((p) => p.id === page.id);
  const next = profile.pages[index + delta];
  if (!next) {
    ui.grid.classList.add('bump');
    setTimeout(() => ui.grid.classList.remove('bump'), 200);
    return;
  }
  goToPage(next.id, { animate: delta > 0 ? 'left' : 'right' });
}

/**
 * Cella della griglia sotto un punto dello schermo.
 *
 * Si ricava dalla geometria della griglia invece che da elementFromPoint,
 * perche' durante il trascinamento il dito e' sopra il controllo trascinato,
 * non sotto di esso.
 * @returns {{row: number, col: number}|null}
 */
function cellAt(clientX, clientY) {
  const page = currentPage();
  if (!page) return null;
  const rect = ui.grid.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  const col = Math.floor(((clientX - rect.left) / rect.width) * page.cols);
  const row = Math.floor(((clientY - rect.top) / rect.height) * page.rows);
  if (row < 0 || col < 0 || row >= page.rows || col >= page.cols) return null;
  return { row, col };
}

/** Evidenzia la cella su cui il controllo verrebbe rilasciato (vuota o tile). */
function highlightDropCell(clientX, clientY) {
  clearDropCell();
  const cell = cellAt(clientX, clientY);
  if (!cell) return;
  const target = ui.grid.querySelector(`[data-empty="${cell.row}:${cell.col}"]`)
    ?? ui.grid.querySelector(`[data-row="${cell.row}"][data-col="${cell.col}"]`);
  if (target) target.classList.add('drop-target');
}

function clearDropCell() {
  for (const element of ui.grid.querySelectorAll('.drop-target')) element.classList.remove('drop-target');
}

function bindGrid() {
  /** Gesto in corso: distingue pressione, hold e trascinamento. */
  let gesture = null;

  const clearHold = () => {
    if (gesture?.holdTimer) clearTimeout(gesture.holdTimer);
  };

  ui.grid.addEventListener('pointerdown', async (event) => {
    // Tile di una pagina dinamica (finestre/app): scatta al rilascio come i
    // pulsanti, cosi' lo swipe orizzontale sopra di essi cambia comunque pagina.
    const dyn = event.target.closest('.dyn-tile');
    if (dyn) {
      gesture = { kind: 'dyn', element: dyn, startX: event.clientX, startY: event.clientY, fired: false };
      dyn.classList.add('pending');
      return;
    }

    const slider = event.target.closest('.deck-slider');
    const ctl = event.target.closest('.deck-ctl');
    const button = event.target.closest('.deck-btn:not(.empty):not(.dyn-tile):not(.widget-tile)');
    const empty = event.target.closest('.deck-btn.empty');

    if (state.editing) {
      const control = button ?? slider ?? ctl;
      // La "x" sul tile elimina il comando: gesto a parte, non apre l'editor
      // ne' fa partire un trascinamento.
      if (control && event.target.closest('.tile-remove')) {
        event.preventDefault();
        confirmRemoveTile(control.dataset.id);
        return;
      }
      if (control) {
        // Un tocco apre l'editor, un trascinamento sposta: quale dei due sia
        // si capisce solo al rilascio, quindi qui si registra soltanto l'inizio.
        control.setPointerCapture?.(event.pointerId);
        gesture = { kind: 'edit-move', element: control, startX: event.clientX, startY: event.clientY, moved: false };
      } else if (empty) {
        choosePreset(empty.dataset.empty);
      }
      return;
    }

    if (slider) {
      slider.setPointerCapture?.(event.pointerId);
      state.draggingId = slider.dataset.id;
      gesture = {
        kind: 'slider',
        element: slider,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastSent: 0,
        // Un cursore VERTICALE si regola in verticale: un trascinamento
        // orizzontale sopra di lui e' uno swipe fra pagine, non una
        // regolazione. Per poterlo restituire allo swipe serve ricordare da
        // quale valore si era partiti.
        vertical: slider.dataset.orientation === 'v',
        startValue: state.levels.get(slider.dataset.id)
          ?? Number(slider.getAttribute('aria-valuenow'))
      };
      // Il valore si vede subito (il riscontro sotto al dito dev'essere
      // immediato) ma NON si manda ancora: se il gesto si rivela uno swipe, il
      // PC non deve aver gia' cambiato il volume. Parte al primo movimento
      // vero, o al rilascio se e' stato solo un tocco.
      applySliderFromPointer(slider, event.clientX, event.clientY, { send: false });
      return;
    }

    // Manopole, rotelle, tavolette, matrici, selettori: ognuno ha il suo gesto,
    // ma tutti passano di qui perche' lo swipe fra pagine deve continuare a
    // funzionare anche sopra di loro.
    if (ctl) {
      const kind = ctl.dataset.kind;
      // I comandi di sola lettura non si premono: lasciano passare lo swipe.
      if (READONLY_KINDS.includes(kind)) {
        gesture = { kind: 'swipe', startX: event.clientX, startY: event.clientY };
        return;
      }
      const spec = currentPage().buttons.find((b) => b.id === ctl.dataset.id);
      ctl.setPointerCapture?.(event.pointerId);
      gesture = {
        kind: 'ctl',
        ctlKind: kind,
        element: ctl,
        spec,
        // Il sotto-elemento toccato: "+"/"-", un'opzione, una cella della matrice.
        sub: event.target.closest('[data-step-dir],[data-opt],[data-cell]'),
        startX: event.clientX,
        startY: event.clientY,
        angle: null,
        moved: false
      };
      if (kind === 'xy' || kind === 'color') {
        state.draggingId = ctl.dataset.id;
        applyCtlDrag(gesture, event);
      } else {
        ctl.classList.add('pending');
      }
      return;
    }

    if (button) {
      const spec = currentPage().buttons.find((b) => b.id === button.dataset.id);
      gesture = {
        kind: 'button',
        element: button,
        spec,
        startX: event.clientX,
        startY: event.clientY,
        fired: false,
        holdTimer: null
      };
      button.classList.add('pending');

      // Si aspetta sempre il rilascio prima di premere: cosi' uno swipe
      // orizzontale sul bottone scorre le pagine invece di premerlo. Il rilascio
      // segue il tocco quasi subito (e il bottone si "abbassa" gia' ora, come
      // riscontro), quindi la reattivita' resta buona. Con un'azione di hold si
      // fa partire quella dopo la soglia, come prima.
      // Bottone MOMENTANEO: con un'azione al rilascio configurata il tasto
      // cambia natura - l'azione normale parte subito alla pressione e quella
      // di rilascio quando si alza il dito. E' il push-to-talk (smuta ora,
      // rimuta dopo) e non ha senso farlo scattare al rilascio come gli altri.
      if (spec?.releaseAction) {
        gesture.momentary = true;
        gesture.fired = true;
        runPress(button, spec);
        return;
      }

      if (spec?.holdAction) {
        gesture.holdTimer = setTimeout(() => {
          gesture.fired = true;
          runPress(button, spec, { hold: true });
        }, 550);
      }
      return;
    }

    // Trascinamento su una zona vuota: cambio pagina.
    gesture = { kind: 'swipe', startX: event.clientX, startY: event.clientY };
  });

  ui.grid.addEventListener('pointermove', (event) => {
    if (!gesture) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;

    if (gesture.kind === 'edit-move') {
      if (!gesture.moved && Math.hypot(dx, dy) > 10) {
        gesture.moved = true;
        gesture.element.classList.add('dragging');
      }
      if (gesture.moved) highlightDropCell(event.clientX, event.clientY);
      return;
    }

    if (gesture.kind === 'slider') {
      // Cursore verticale: oltre i 12 px in orizzontale il gesto cambia natura
      // e diventa uno swipe fra pagine. Il valore sfiorato alla pressione va
      // RIMESSO com'era, altrimenti sfogliare le pagine sposterebbe di nascosto
      // il cursore da cui e' partito il dito.
      if (sliderBecomesSwipe(gesture.vertical, dx, dy)) {
        abandonSlider(gesture);
        gesture.kind = 'swipe';
        return;
      }
      applySliderFromPointer(gesture.element, event.clientX, event.clientY);
      return;
    }

    if (gesture.kind === 'ctl') {
      const k = gesture.ctlKind;
      // Manopola e rotella leggono l'ANGOLO del dito attorno al centro: e' il
      // solo modo per cui girare in tondo e trascinare di lato fanno lo stesso.
      if (k === 'encoder' || k === 'jog') { rotateCtl(gesture, event); return; }
      if (k === 'xy' || k === 'color') { gesture.moved = true; applyCtlDrag(gesture, event); return; }
      // Gli altri sono pressioni: oltre i 12 px in orizzontale il gesto e' uno
      // swipe fra pagine, non un tocco.
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
        gesture.element.classList.remove('pending');
        gesture.kind = 'swipe';
      }
      return;
    }
    // Oltre i 12 px in orizzontale il gesto e' uno swipe, non una pressione:
    // l'eventuale hold in attesa va annullato.
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
      clearHold();
      if ((gesture.kind === 'button' || gesture.kind === 'dyn') && !gesture.fired) {
        gesture.element.classList.remove('pending');
        gesture.kind = 'swipe';
      }
    }
  });

  const endGesture = (event) => {
    if (!gesture) return;
    clearHold();
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;

    if (gesture.kind === 'edit-move') {
      const element = gesture.element;
      const moved = gesture.moved;
      element.classList.remove('dragging');
      clearDropCell();
      gesture = null;
      if (!moved) editButton(element.dataset.id);
      else {
        const cell = cellAt(event.clientX, event.clientY);
        if (cell) moveButton(element.dataset.id, cell);
      }
      return;
    }

    if (gesture.kind === 'ctl') {
      finishCtlGesture(gesture);
      state.draggingId = null;
      gesture = null;
      return;
    }

    if (gesture.kind === 'slider') {
      sendSliderValue(gesture.element, { final: true });
      state.draggingId = null;
    } else if (gesture.kind === 'button' && gesture.momentary) {
      gesture.element.classList.remove('pending');
      runPress(gesture.element, gesture.spec, { release: true });
    } else if (gesture.kind === 'button' && !gesture.fired) {
      const spec = gesture.spec;
      gesture.element.classList.remove('pending');
      runPress(gesture.element, spec);
    } else if (gesture.kind === 'dyn' && !gesture.fired) {
      gesture.element.classList.remove('pending');
      runDynTile(gesture.element);
    } else if (gesture.kind === 'swipe' && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      stepPage(dx < 0 ? 1 : -1);
    }
    gesture = null;
  };

  ui.grid.addEventListener('pointerup', endGesture);
  ui.grid.addEventListener('pointercancel', () => {
    // Se il gesto viene annullato dal sistema (chiamata in arrivo, gesto di
    // sistema) un bottone momentaneo resterebbe "premuto" per sempre: il
    // microfono aperto, la luce accesa. Il rilascio va mandato lo stesso.
    if (gesture?.kind === 'button' && gesture.momentary) {
      runPress(gesture.element, gesture.spec, { release: true });
    }
    if (gesture?.element) gesture.element.classList.remove('pending', 'dragging');
    clearHold();
    clearDropCell();
    state.draggingId = null;
    gesture = null;
  });
  ui.grid.addEventListener('contextmenu', (event) => event.preventDefault());

  // Tenendo premuto un tasto, il browser (soprattutto su touch) fa partire la
  // selezione del testo dell'etichetta: compare la maniglia blu, il tasto
  // sembra "afferrato" e il gesto di hold si perde. Sul deck non c'e' niente
  // da selezionare, quindi la selezione si annulla in partenza. Serve sia
  // questo sia `user-select: none` in CSS: da solo il CSS non basta su tutti
  // i motori, e da solo questo non copre il doppio tap.
  ui.grid.addEventListener('selectstart', (event) => event.preventDefault());

  // Tastiera sui comandi: Invio e barra spaziatrice premono, le frecce girano
  // manopole e passo-passo. Senza, meta' dei comandi sarebbe raggiungibile col
  // Tab ma inservibile.
  ui.grid.addEventListener('keydown', (event) => {
    const ctl = event.target.closest?.('.deck-ctl');
    if (!ctl || state.editing) return;
    const kind = ctl.dataset.kind;
    if (READONLY_KINDS.includes(kind)) return;
    const spec = currentPage()?.buttons.find((b) => b.id === ctl.dataset.id);
    if (!spec) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (kind === 'timer') toggleTimer(ctl, spec);
      else runPress(ctl, spec);
      return;
    }

    const verso = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    if (!verso) return;
    if (kind === 'encoder' || kind === 'stepper') {
      event.preventDefault();
      const passo = spec.step ?? 1;
      const prossimo = Math.min(spec.max ?? 100, Math.max(spec.min ?? 0, ctlValue(spec) + verso * passo));
      state.levels.set(spec.id, prossimo);
      refreshCtl(ctl);
      pressButton(ctl, { delta: verso * passo });
    } else if (kind === 'jog') {
      event.preventDefault();
      pressButton(ctl, { delta: verso });
    }
  });

  // Uno slider con role="slider" e tabindex="0" deve rispondere alle frecce:
  // senza questo la tastiera non lo puo' regolare (WCAG 2.1.1) e le frecce
  // finirebbero per cambiare pagina. stopPropagation impedisce alla navigazione
  // globale di scattare mentre lo slider ha il focus.
  ui.grid.addEventListener('keydown', (event) => {
    const slider = event.target.closest('.deck-slider');
    if (!slider || state.editing) return;
    const min = Number(slider.dataset.min);
    const max = Number(slider.dataset.max);
    const step = Number(slider.dataset.step) || 1;
    const current = state.levels.get(slider.dataset.id) ?? Math.round((min + max) / 2);
    let next = current;
    switch (event.key) {
      case 'ArrowRight': case 'ArrowUp': next = current + step; break;
      case 'ArrowLeft': case 'ArrowDown': next = current - step; break;
      case 'Home': next = min; break;
      case 'End': next = max; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    next = clampNum(next, min, max);
    if (next === current) return;
    state.levels.set(slider.dataset.id, next);
    updateSliderVisual(slider, next);
    sendSliderValue(slider, { final: true });
  });

  // Lo swipe funziona anche partendo dai bordi della pagina, non solo dalla griglia.
  let edge = null;
  ui.pages.addEventListener('pointerdown', (event) => { edge = event.clientX; });
  ui.pages.addEventListener('pointerup', (event) => {
    if (edge === null) return;
    const dx = event.clientX - edge;
    edge = null;
    if (Math.abs(dx) > 70) stepPage(dx < 0 ? 1 : -1);
  });
}

/** Esegue la pressione, interponendo la conferma se il bottone la richiede. */
async function runPress(element, spec, options = {}) {
  if (spec?.confirm) {
    element.classList.remove('pending');
    const confirmed = await confirmPress(spec);
    if (!confirmed) return;
    element.classList.add('pending');
  }
  if (navigator.vibrate) navigator.vibrate(options.hold ? 30 : 12);
  pressButton(element, options);
}

/* --------------------------------------------------------- gesti dei comandi

   Tre famiglie: quelli che GIRANO (manopola, rotella) leggono l'angolo del dito
   e mandano scatti; quelli che si TRASCINANO (tavoletta, striscia colore)
   mandano posizioni; quelli che si PREMONO (passo-passo, selettore, matrice,
   timer, cartella, macro) scattano al rilascio come i pulsanti.              */

/** Angolo in gradi del dito rispetto al centro dell'elemento. */
function angleFromCenter(element, event) {
  const rect = element.getBoundingClientRect();
  return Math.atan2(event.clientY - (rect.top + rect.height / 2),
    event.clientX - (rect.left + rect.width / 2)) * 180 / Math.PI;
}

/** Manopola e rotella: dall'angolo agli scatti. */
function rotateCtl(gesture, event) {
  const perno = gesture.element.querySelector('.enc, .jog') ?? gesture.element;
  const a = angleFromCenter(perno, event);
  if (gesture.angle === null) { gesture.angle = a; return; }

  let d = a - gesture.angle;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  // Sotto la soglia non succede nulla: senza, il minimo tremolio del dito
  // sparerebbe decine di messaggi al secondo verso l'host.
  if (Math.abs(d) < 8) return;
  gesture.angle = a;
  gesture.moved = true;

  const spec = gesture.spec;
  const verso = d > 0 ? 1 : -1;

  if (gesture.ctlKind === 'jog') {
    // Una rotella non ha un valore: manda solo scatti, all'infinito.
    pressButton(gesture.element, { delta: verso });
    gesture.element.querySelector('.jog')?.style.setProperty('--rot', `${(gesture.rot = (gesture.rot ?? 0) + d)}deg`);
    return;
  }

  const passo = spec?.step ?? 1;
  const min = spec?.min ?? 0;
  const max = spec?.max ?? 100;
  const attuale = ctlValue(spec);
  const prossimo = Math.min(max, Math.max(min, Math.round((attuale + verso * passo) / passo) * passo));
  if (prossimo === attuale) return;
  state.levels.set(spec.id, prossimo);
  refreshCtl(gesture.element);
  pressButton(gesture.element, { delta: verso * passo });
}

/** Tavoletta e striscia colore: dalla posizione del dito ai valori. */
function applyCtlDrag(gesture, event) {
  const element = gesture.element;
  const now = Date.now();

  if (gesture.ctlKind === 'xy') {
    const area = element.querySelector('.xy');
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const fx = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const fy = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    area.style.setProperty('--x', fx);
    area.style.setProperty('--y', fy);
    gesture.pending = { x: Math.round(fx * 100), y: Math.round((1 - fy) * 100) };
  } else {
    const barra = element.querySelector('.sp');
    if (!barra) return;
    const rect = barra.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    barra.style.setProperty('--v', f);
    const min = gesture.spec?.min ?? 0;
    const max = gesture.spec?.max ?? 100;
    gesture.pending = { value: Math.round(min + f * (max - min)) };
  }

  // Stessa regola dello slider: al piu' un messaggio ogni 120 ms mentre il dito
  // si muove, e uno definitivo al rilascio.
  if (now - (gesture.lastSent ?? 0) < 120) return;
  gesture.lastSent = now;
  pressButton(element, gesture.pending);
}

/** Chiude il gesto di un comando: ognuno conclude a modo suo. */
function finishCtlGesture(gesture) {
  const element = gesture.element;
  const spec = gesture.spec;
  element.classList.remove('pending');

  switch (gesture.ctlKind) {
    case 'xy':
    case 'color':
      // Il valore definitivo parte sempre, anche se l'ultimo era stato scartato
      // dal limitatore: altrimenti il PC resterebbe a un passo dalla posizione.
      if (gesture.pending) pressButton(element, gesture.pending);
      return;

    case 'jog':
      return;

    case 'encoder':
      // Un tocco senza rotazione e' la pressione dell'albero: la seconda azione
      // della manopola.
      if (!gesture.moved) runPress(element, spec);
      return;

    case 'stepper': {
      const dir = Number(gesture.sub?.dataset.stepDir);
      if (!dir) return;
      const passo = spec?.step ?? 1;
      const min = spec?.min ?? 0;
      const max = spec?.max ?? 100;
      const prossimo = Math.min(max, Math.max(min, ctlValue(spec) + dir * passo));
      state.levels.set(spec.id, prossimo);
      refreshCtl(element);
      pressButton(element, { delta: dir * passo });
      return;
    }

    case 'selector': {
      const scelta = gesture.sub?.dataset.opt;
      if (scelta === undefined) return;
      ctlPicks.set(spec.id, scelta);
      refreshCtl(element);
      // Il selettore manda l'INDICE dell'opzione come valore: e' l'unico dato
      // che serve all'host e passa dal campo che esiste gia'.
      pressButton(element, { value: (spec.options ?? []).indexOf(scelta) });
      return;
    }

    case 'pad': {
      const cella = gesture.sub?.dataset.cell;
      if (!cella) return;
      const [riga, colonna] = cella.split(',').map(Number);
      // La cella e' un indirizzo a due numeri: e' esattamente la coppia della
      // tavoletta, quindi non serve un campo nuovo.
      pressButton(element, { x: colonna, y: riga });
      return;
    }

    case 'timer': {
      if (gesture.moved) return;
      toggleTimer(element, spec);
      return;
    }

    default:
      // Cartella e macro: pressione normale, con la conferma se richiesta.
      if (!gesture.moved) runPress(element, spec);
  }
}

/**
 * Avvia o ferma un conto alla rovescia.
 *
 * Il tempo scorre nel client (l'host non ha bisogno di saperlo secondo per
 * secondo) e l'azione parte una volta sola, quando arriva a zero.
 */
function toggleTimer(element, spec) {
  const id = spec.id;
  const totale = spec.seconds ?? 1500;
  const corrente = ctlTimers.get(id);

  if (corrente?.tick) {
    clearInterval(corrente.tick);
    ctlTimers.set(id, { left: corrente.left, tick: null });
    refreshCtl(element);
    return;
  }

  let rimasti = corrente?.left ?? totale;
  if (rimasti <= 0) rimasti = totale;
  const tick = setInterval(() => {
    const voce = ctlTimers.get(id);
    if (!voce) return;
    voce.left -= 1;
    // Il tile puo' essere stato ridisegnato: si ricerca ogni volta.
    const vivo = ui.grid.querySelector(`.deck-ctl[data-id="${CSS.escape(id)}"]`);
    if (!vivo) { clearInterval(tick); ctlTimers.delete(id); return; }
    if (voce.left <= 0) {
      clearInterval(tick);
      ctlTimers.set(id, { left: 0, tick: null });
      refreshCtl(vivo);
      runPress(vivo, spec);
      return;
    }
    refreshCtl(vivo);
  }, 1000);

  ctlTimers.set(id, { left: rimasti, tick });
  refreshCtl(element);
}

/**
 * Converte la posizione del dito nel valore del cursore.
 *
 * In verticale si misura DAL BASSO: alzare il dito alza il valore, come su un
 * fader vero. Misurarlo dall'alto (come fanno le coordinate dello schermo)
 * darebbe un cursore che scende quando lo si tira su.
 */
/**
 * Un trascinamento iniziato su un cursore e' in realta' uno swipe fra pagine?
 *
 * Solo il cursore VERTICALE puo' cedere il gesto. Quello orizzontale si regola
 * proprio trascinando di lato: e' esattamente il movimento dello swipe, e non
 * c'e' modo di distinguerli. Li' vince il cursore — il dito e' partito da
 * sopra di lui, e chi tocca un cursore vuole regolarlo.
 */
function sliderBecomesSwipe(vertical, dx, dy) {
  if (!vertical) return false;
  return Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy);
}

/**
 * Rinuncia al gesto sul cursore e lo rimette com'era.
 *
 * Serve quando un trascinamento iniziato su un cursore verticale si rivela uno
 * swipe fra pagine: il valore era gia' stato disegnato sotto al dito, ma non e'
 * mai stato spedito (vedi `send: false` alla pressione), quindi basta ridisegnarlo
 * per non lasciare traccia del gesto sbagliato.
 */
function abandonSlider(gesture) {
  const slider = gesture.element;
  if (Number.isFinite(gesture.startValue)) {
    state.levels.set(slider.dataset.id, gesture.startValue);
    updateSliderVisual(slider, gesture.startValue);
  }
  // Senza rilasciare la cattura il cursore resta destinatario di ogni movimento
  // successivo: gli eventi arrivano lo stesso alla griglia (risalgono), ma il
  // dito resterebbe "attaccato" a un comando che non sta piu' comandando.
  if (gesture.pointerId !== undefined) slider.releasePointerCapture?.(gesture.pointerId);
  state.draggingId = null;
}

function applySliderFromPointer(slider, clientX, clientY, { send = true } = {}) {
  const rect = slider.getBoundingClientRect();
  const min = Number(slider.dataset.min);
  const max = Number(slider.dataset.max);
  const step = Number(slider.dataset.step) || 1;
  const ratio = slider.dataset.orientation === 'v'
    ? Math.max(0, Math.min(1, (rect.bottom - clientY) / rect.height))
    : Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const raw = min + ratio * (max - min);
  // Il passo va contato DA min, non da zero: con min=15 e step=0.5 partire da
  // zero produrrebbe una scala sfasata rispetto agli estremi.
  const value = clampNum(min + Math.round((raw - min) / step) * step, min, max);

  updateSliderVisual(slider, value);
  state.levels.set(slider.dataset.id, value);
  if (send) sendSliderValue(slider);
}

/** Limita un numero all'intervallo, togliendo la sporcizia della virgola mobile. */
function clampNum(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value * 1e6) / 1e6));
}

/**
 * Invia il valore dello slider limitando la frequenza.
 *
 * Ogni valore intermedio farebbe partire uno script PowerShell sull'host:
 * durante un trascinamento sarebbero decine al secondo. Si spedisce al piu'
 * ogni 120 ms, piu' un invio finale garantito al rilascio del dito.
 */
function sendSliderValue(slider, { final = false } = {}) {
  const now = Date.now();
  const last = Number(slider.dataset.lastSent || 0);
  if (!final && now - last < 120) return;
  slider.dataset.lastSent = String(now);
  pressButton(slider, { value: state.levels.get(slider.dataset.id) });
}

function bindSheet() {
  // Chiudere il pannello richiede che il dito/mouse sia sceso E risalito sullo
  // sfondo. Senza, un pannello aperto da una pressione su touch si chiuderebbe
  // subito: la pressione parte sul bottone del deck, il pannello si apre sotto
  // al dito, e il "click" sintetico del rilascio cade sullo sfondo. Era il caso
  // "la conferma non resta visibile se non tengo premuto".
  ui.sheet.addEventListener('pointerdown', (event) => {
    sheetDownOnClose = !!event.target.closest('[data-close]');
  });
  ui.sheet.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]') && sheetDownOnClose) closeSheet({ silent: false });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ui.sheet.hidden) {
      closeSheet({ silent: false });
      return;
    }
    // Tab intrappolato nel pannello: senza questo il focus scivola sulla pagina
    // sotto, che per un dialogo modale non deve accadere.
    if (event.key === 'Tab' && !ui.sheet.hidden) {
      const list = sheetFocusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    // Le frecce cambiano pagina solo quando non c'e' un pannello aperto e il
    // focus non e' su uno slider (che le usa per regolarsi).
    if (ui.sheet.hidden && !state.editing && !document.activeElement?.classList?.contains('deck-slider')) {
      if (event.key === 'ArrowRight') stepPage(1);
      if (event.key === 'ArrowLeft') stepPage(-1);
    }
  });
}

// ---------------------------------------------------------------- avvio

function boot() {
  // Prima di tutto la lingua: il gate compare anche senza essersi collegati,
  // e resterebbe in italiano fino al primo deck ricevuto.
  setLanguage('auto');
  document.documentElement.lang = language();
  bindEvents();
  applyStaticTexts();
  loadHosts();

  // Un token nell'URL (link stampato dall'host) vale come pairing immediato.
  const params = new URLSearchParams(location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    history.replaceState(null, '', location.pathname);
    finishPairing(location.origin, urlToken);
    return;
  }

  state.profileId = localStorage.getItem(STORAGE.profile);
  state.pageId = localStorage.getItem(STORAGE.page);

  if (!token()) {
    showGate();
    return;
  }
  ui.gate.hidden = true;
  ui.app.hidden = false;
  renderHosts();
  connect();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline non disponibile */ });
  });
  // Il service worker avvisa quando una build nuova ha rimpiazzato lo shell:
  // senza ricaricare si continuerebbe a usare il vecchio app.js gia' in memoria.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'wdeck-shell-updated') toast(t('update.reloadReady'), '');
  });
}

boot();
