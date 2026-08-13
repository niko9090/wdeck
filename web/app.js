/**
 * Wdeck - client web PWA.
 *
 * Nessun framework, nessuna build step complessa: moduli ES nativi.
 * Il protocollo e' condiviso con l'host tramite /shared/protocol.mjs.
 */

import { ENDPOINTS, MSG } from '/shared/protocol.mjs';
import { CUSTOM_PREFIX, ICONS, iconMarkup, iconSvg, isCustomIcon } from './icons.js';

const STORAGE = {
  hosts: 'wdeck.hosts',
  active: 'wdeck.active',
  profile: 'wdeck.profile',
  page: 'wdeck.page',
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
  dot: el('status-dot'),
  dryBadge: el('dry-badge'),
  update: el('btn-update'),
  profileSelect: el('profile-select'),
  hosts: el('hosts'),
  pages: el('pages'),
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
  /** ultimo livello noto di ogni slider, per non farlo saltare al re-render */
  levels: new Map(),
  /** stato reale dei controlli letto dall'host: id -> {on, level, text} */
  statuses: {},
  /** cursore attualmente sotto il dito: non va riallineato dall'host */
  draggingId: null,
  update: null
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
  ui.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { ui.toast.hidden = true; }, kind === 'err' ? 5200 : 3200);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function setStatus(stateName, text) {
  ui.dot.dataset.state = stateName;
  ui.statusText.textContent = text;
}

async function api(path, { method = 'GET', body, base = baseUrl(), authToken = token() } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { 'x-wdeck-token': authToken } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

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
    .join('') + '<button class="host-tab add" type="button" data-host-add="1" title="Aggiungi un computer">+</button>';
}

// ---------------------------------------------------------------- gate

function showGate(message = '') {
  ui.app.hidden = true;
  ui.gate.hidden = false;
  ui.gateHost.value = activeHost()?.base ?? location.origin;
  ui.gateError.textContent = message;
}

async function pairWithPin() {
  const base = ui.gateHost.value.trim().replace(/\/+$/, '') || location.origin;
  const pin = ui.gatePin.value.trim();
  ui.gateError.textContent = '';
  if (!pin) {
    ui.gateError.textContent = 'Inserisci il PIN mostrato dall\'host.';
    return;
  }
  try {
    const res = await fetch(`${base}${ENDPOINTS.pair}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (!res.ok || !data.token) {
      ui.gateError.textContent = data?.error?.message ?? 'Pairing rifiutato.';
      return;
    }
    await finishPairing(base, data.token);
  } catch (err) {
    ui.gateError.textContent = `Host non raggiungibile: ${err.message}`;
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
    ui.gateError.textContent = 'Inserisci un token.';
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
  if (!token()) {
    showGate();
    return;
  }
  if (state.socket) {
    try { state.socket.close(); } catch { /* ignora */ }
  }
  setStatus('connecting', 'connessione in corso...');

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
    setStatus('offline', 'connessione persa');
    renderHosts();
    const delay = Math.min(1000 * 2 ** state.retry, 15000);
    state.retry += 1;
    setTimeout(() => { if (token() && socket === state.socket) connect(); }, delay);
  });

  socket.addEventListener('error', () => setStatus('offline', 'errore di connessione'));
}

function handleMessage(msg) {
  switch (msg.type) {
    case MSG.hello:
      ui.deckName.textContent = msg.name ?? 'Wdeck';
      break;

    case MSG.authOk:
      state.connected = true;
      state.retry = 0;
      setStatus('online', 'connesso');
      renderHosts();
      checkUpdate();
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
      break;

    case MSG.error:
      if (msg.code === 'unauthorized') {
        showGate('Token non valido o scaduto. Esegui di nuovo il pairing.');
      } else {
        toast(msg.message ?? 'errore', 'err');
      }
      break;

    default:
      break;
  }
}

function send(message) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    toast('Non connesso all\'host', 'err');
    return false;
  }
  state.socket.send(JSON.stringify(message));
  return true;
}

// ---------------------------------------------------------------- stato/rendering

function applyState(hostState) {
  state.hostState = hostState;
  if (!state.profileId) state.profileId = hostState.activeProfile;
  if (!state.pageId) state.pageId = hostState.activePage;
  ui.dryBadge.hidden = !hostState.dryRun;
}

function applyTheme(uiConfig) {
  if (!uiConfig) return;
  if (uiConfig.accent) document.documentElement.style.setProperty('--accent', uiConfig.accent);
  document.documentElement.classList.toggle('theme-auto', uiConfig.theme === 'auto');
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
}

function renderProfiles() {
  const profile = currentProfile();
  ui.profileSelect.innerHTML = state.deck.profiles
    .map((p) => `<option value="${p.id}"${p.id === profile.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`)
    .join('')
    // In modifica il menu dei profili diventa anche la via per crearli e
    // rinominarli: non serve un altro bottone nella barra, gia' affollata.
    + (state.editing ? '<option value="__gestisci__">Gestisci profili...</option>' : '');
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
function renderGrid() {
  const page = currentPage();
  if (!page) return;

  const signature = JSON.stringify([state.profileId, page.id, state.editing, page.buttons]);
  if (ui.grid.dataset.signature === signature) return;
  ui.grid.dataset.signature = signature;

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
      parts.push(button.kind === 'slider' ? sliderHtml(button) : buttonHtml(button));
    }
  }
  ui.grid.innerHTML = parts.join('');
  applyStatuses();
}

function buttonHtml(button) {
  const style = [
    button.color ? `background:${button.color}` : '',
    button.textColor ? `color:${button.textColor}` : '',
    button.span > 1 ? `grid-column:span ${button.span}` : ''
  ].filter(Boolean).join(';');
  return `<button class="deck-btn" type="button" data-id="${button.id}" style="${style}" title="${escapeHtml(button.label || button.id)}">`
    + `<span class="type-tag">${escapeHtml(button.action.type)}</span>`
    + controlIcon(button)
    + (state.deck.ui?.showLabels === false ? '' : `<span class="label">${escapeHtml(button.label)}</span>`)
    + (button.confirm ? '<span class="confirm-tag" title="chiede conferma">!</span>' : '')
    + '</button>';
}

function sliderHtml(button) {
  const min = button.min ?? 0;
  const max = button.max ?? 100;
  const value = state.levels.get(button.id) ?? Math.round((min + max) / 2);
  const percent = Math.round(((value - min) / (max - min)) * 100);
  const style = [
    button.color ? `--slider-accent:${button.color}` : '',
    `grid-column:span ${button.span ?? 2}`
  ].filter(Boolean).join(';');
  return `<div class="deck-slider" data-id="${button.id}" data-min="${min}" data-max="${max}" data-step="${button.step ?? 1}" style="${style}"`
    + ` role="slider" tabindex="0" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" aria-label="${escapeHtml(button.label || button.id)}">`
    + `<div class="slider-fill" style="width:${percent}%"></div>`
    + '<div class="slider-content">'
    + controlIcon(button)
    + `<span class="slider-label">${escapeHtml(button.label)}</span>`
    + `<span class="slider-value">${value}</span>`
    + '</div></div>';
}

function renderStatus() {
  if (!state.hostState) return;
  ui.dryBadge.hidden = !state.hostState.dryRun;
  const parts = [
    state.connected ? 'connesso' : 'non connesso',
    `${state.hostState.clients} client`,
    `${state.hostState.pressCount} pressioni`
  ];
  ui.statusText.textContent = parts.join(' - ');
  if (state.hostState.lastAction) renderLastAction(state.hostState.lastAction);
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
function pressButton(element, { hold = false, value } = {}) {
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
    ...(value !== undefined ? { value } : {}),
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
    toast(result?.error?.message ?? 'azione fallita', 'err');
    return;
  }

  // Un'azione che non apre finestre (script, notifiche, comandi remoti) non
  // da' alcun segno di vita sul telefono: qui il suo esito diventa visibile.
  const inner = result?.result ?? {};
  const output = String(inner.stdout ?? '').trim();
  if (output) toast(output.slice(0, 300), 'ok');
  else if (result?.dryRun) toast(`simulato: ${result.description ?? ''}`, '');
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
  const percent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  element.querySelector('.slider-fill').style.width = `${percent}%`;
  element.querySelector('.slider-value').textContent = Math.round(value);
  element.setAttribute('aria-valuenow', String(Math.round(value)));
}

/** Chiede conferma per le azioni marcate `confirm` in deck.json. */
function confirmPress(button) {
  return new Promise((resolve) => {
    openSheet({
      title: 'Confermi?',
      body: `<p class="sheet-text">Stai per eseguire <strong>${escapeHtml(button.label || button.id)}</strong> `
        + `(azione <code>${escapeHtml(button.action.type)}</code>) sul computer <strong>${escapeHtml(activeHost()?.name ?? '')}</strong>.</p>`,
      actions: [
        { label: 'Annulla', kind: 'ghost', onClick: () => { closeSheet(); resolve(false); } },
        { label: 'Esegui', kind: 'danger', onClick: () => { closeSheet(); resolve(true); } }
      ],
      onClose: () => resolve(false)
    });
  });
}

// ---------------------------------------------------------------- pannello modale

let sheetCloseHandler = null;

function openSheet({ title, body, actions = [], onClose = null }) {
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
}

function closeSheet({ silent = true } = {}) {
  ui.sheet.hidden = true;
  const handler = sheetCloseHandler;
  sheetCloseHandler = null;
  if (!silent && handler) handler();
}

// ---------------------------------------------------------------- editor

async function loadActions() {
  if (state.actionGroups) return state.actionGroups;
  const res = await api(ENDPOINTS.actions);
  if (!res.ok) {
    toast('Impossibile leggere le azioni disponibili', 'err');
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

/** Griglia di scelta dell'icona: glifi inclusi, icone caricate, caricamento. */
function iconPickerHtml(selected, customIcons) {
  const choice = (value, inner, title) => '<button type="button" class="icon-choice'
    + `${value === (selected ?? '') ? ' selected' : ''}" data-icon="${escapeHtml(value)}" title="${escapeHtml(title)}">${inner}</button>`;

  const builtin = Object.keys(ICONS)
    .map((name) => choice(name, iconSvg(name), name))
    .join('');
  const custom = customIcons
    .map((icon) => choice(`${CUSTOM_PREFIX}${icon.name}`,
      `<img src="${customIconUrl(icon.name)}" alt="" />`, icon.name))
    .join('');

  return `
    <div class="icon-picker" id="ed-icons">
      ${choice('', '<span class="icon-auto">auto</span>', 'icona predefinita dell\'azione')}
      ${builtin}
      ${custom}
    </div>
    <div class="icon-upload">
      <label class="btn ghost small" for="ed-icon-file">Carica un'icona...</label>
      <input id="ed-icon-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden />
      <span class="sheet-hint" id="ed-icon-msg">PNG, JPEG, WebP, GIF o SVG, massimo 192 KB.</span>
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
    if (choice) select(choice);
  });

  el('ed-icon-file')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const message = el('ed-icon-msg');
    message.textContent = 'caricamento...';

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
        message.textContent = res.data?.error?.message ?? 'caricamento rifiutato';
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
      message.textContent = `"${saved}" caricata.`;
    } catch (err) {
      message.textContent = `caricamento fallito: ${err.message}`;
    }
  });
}

/** Apre l'editor di un bottone esistente o di una cella vuota. */
async function editButton(buttonId, cell) {
  const [groups, customIcons] = await Promise.all([loadActions(), loadCustomIcons()]);
  const page = currentPage();
  const existing = page.buttons.find((b) => b.id === buttonId) ?? null;
  const [row, col] = cell ? cell.split(':').map(Number) : [existing.row, existing.col];

  const draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
      id: uniqueSlug(`btn-${Math.random().toString(36).slice(2, 8)}`, allButtonIds(state.deck)),
      label: 'Nuovo',
      row,
      col,
      kind: 'button',
      icon: null,
      color: '#2d3b55',
      action: { type: 'noop', params: {} }
    };

  const options = groups
    .map((g) => `<optgroup label="${escapeHtml(g.label)}">`
      + g.actions.map((a) => `<option value="${a.type}"${a.type === draft.action.type ? ' selected' : ''}>${escapeHtml(a.title)}</option>`).join('')
      + '</optgroup>')
    .join('');

  const allActions = groups.flatMap((g) => g.actions);

  openSheet({
    title: existing ? 'Modifica controllo' : 'Nuovo controllo',
    body: `
      <label class="field"><span>Etichetta</span><input id="ed-label" type="text" maxlength="48" value="${escapeHtml(draft.label)}" /></label>
      <label class="field"><span>Azione</span><select id="ed-type" class="select wide">${options}</select></label>
      <p id="ed-desc" class="sheet-hint"></p>
      <label class="field"><span>Parametri (JSON)</span><textarea id="ed-params" rows="5" spellcheck="false">${escapeHtml(JSON.stringify(draft.action.params ?? {}, null, 2))}</textarea></label>
      <p id="ed-help" class="sheet-hint"></p>

      <h3 class="sheet-section">Icona</h3>
      ${iconPickerHtml(draft.icon, customIcons)}

      <div class="field-row">
        <label class="field"><span>Tipo</span><select id="ed-kind" class="select">
          <option value="button"${draft.kind !== 'slider' ? ' selected' : ''}>Pulsante</option>
          <option value="slider"${draft.kind === 'slider' ? ' selected' : ''}>Cursore</option>
        </select></label>
        <label class="field"><span>Colore</span><input id="ed-color" type="color" value="${draft.color ?? '#2d3b55'}" /></label>
        <label class="field"><span>Larghezza</span><input id="ed-span" type="number" min="1" max="12" value="${draft.span ?? 1}" /></label>
      </div>
      <label class="field checkbox"><input id="ed-confirm" type="checkbox"${draft.confirm ? ' checked' : ''} /><span>Chiedi conferma prima di eseguire</span></label>
      <label class="field checkbox"><input id="ed-status" type="checkbox"${draft.status === false ? '' : ' checked'} /><span>Mostra lo stato reale letto dal computer</span></label>
    `,
    actions: [
      ...(existing ? [{ label: 'Elimina', kind: 'danger', onClick: () => removeButton(existing.id) }] : []),
      { label: 'Annulla', kind: 'ghost', onClick: () => closeSheet() },
      { label: 'Salva', kind: 'primary', onClick: () => saveButtonDraft(draft, existing) }
    ]
  });

  bindIconPicker({ onPick: (value) => { draft.icon = value; } });

  const typeSelect = el('ed-type');
  const describe = () => {
    const spec = allActions.find((a) => a.type === typeSelect.value);
    el('ed-desc').textContent = spec?.description ?? '';
    el('ed-help').innerHTML = spec && Object.keys(spec.paramsHelp ?? {}).length
      ? Object.entries(spec.paramsHelp).map(([k, v]) => `<code>${escapeHtml(k)}</code>: ${escapeHtml(v)}`).join('<br />')
      : 'Questa azione non richiede parametri.';
    if (spec?.control === 'slider') el('ed-kind').value = 'slider';

    // Spuntare "mostra lo stato" su un'azione che non sa dichiararlo non
    // farebbe nulla: meglio disattivare la casella che lasciarla senza effetto.
    const statusBox = el('ed-status');
    statusBox.disabled = spec ? spec.reportsState !== true : false;
    statusBox.closest('.field').classList.toggle('disabled', statusBox.disabled);
  };
  typeSelect.addEventListener('change', describe);
  describe();
}

async function saveButtonDraft(draft, existing) {
  let params;
  try {
    params = JSON.parse(el('ed-params').value || '{}');
  } catch (err) {
    toast(`Parametri non validi: ${err.message}`, 'err');
    return;
  }

  const kind = el('ed-kind').value;
  const next = {
    ...draft,
    label: el('ed-label').value.trim(),
    kind,
    icon: draft.icon || null,
    color: el('ed-color').value,
    span: Math.max(1, Number(el('ed-span').value) || 1),
    confirm: el('ed-confirm').checked,
    status: el('ed-status').checked,
    action: { type: el('ed-type').value, params }
  };
  if (kind === 'slider') {
    next.min = draft.min ?? 0;
    next.max = draft.max ?? 100;
    next.step = draft.step ?? 1;
    if (!draft.span) next.span = Math.max(2, next.span);
  }

  const deck = cloneDeck();
  const page = findPage(findProfile(deck, state.profileId), currentPage().id);
  if (existing) {
    const index = page.buttons.findIndex((b) => b.id === existing.id);
    page.buttons[index] = next;
  } else {
    page.buttons.push(next);
  }
  await persistDeck(deck, `"${next.label}" salvato`);
}

async function removeButton(buttonId) {
  const deck = cloneDeck();
  const page = findPage(findProfile(deck, state.profileId), currentPage().id);
  page.buttons = page.buttons.filter((b) => b.id !== buttonId);
  await persistDeck(deck, 'controllo eliminato');
}

/**
 * Sposta un controllo in un'altra cella della stessa pagina.
 *
 * Non si controlla qui se la cella e' libera: la sovrapposizione la rileva
 * l'host, che e' l'unico a vedere la configurazione intera, e la risposta
 * arriva come messaggio di errore.
 * @param {string} buttonId
 * @param {{row: number, col: number}} target
 */
async function moveButton(buttonId, target) {
  const deck = cloneDeck();
  const page = findPage(findProfile(deck, state.profileId), currentPage().id);
  const button = page.buttons.find((b) => b.id === buttonId);
  if (!button) return false;
  if (button.row === target.row && button.col === target.col) return false;
  button.row = target.row;
  button.col = target.col;
  return persistDeck(deck, 'controllo spostato', { quiet: true });
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
    title: `Pagina "${page.name}"`,
    body: `
      <label class="field"><span>Nome</span><input id="pg-name" type="text" maxlength="64" value="${escapeHtml(page.name)}" /></label>
      <div class="field-row">
        <label class="field"><span>Righe</span><input id="pg-rows" type="number" min="1" max="8" value="${page.rows}" /></label>
        <label class="field"><span>Colonne</span><input id="pg-cols" type="number" min="1" max="12" value="${page.cols}" /></label>
      </div>
      <p class="sheet-hint">Rimpicciolire la griglia si puo' solo se nessun controllo resta fuori: altrimenti l'host rifiuta il salvataggio e dice quale.</p>
      <div class="field-row">
        <button class="btn ghost" type="button" id="pg-left"${index === 0 ? ' disabled' : ''}>&larr; Sposta</button>
        <button class="btn ghost" type="button" id="pg-right"${index === profile.pages.length - 1 ? ' disabled' : ''}>Sposta &rarr;</button>
      </div>
      <label class="field checkbox"><input id="pg-default" type="checkbox"${isDefault ? ' checked disabled' : ''} /><span>Pagina iniziale del profilo</span></label>
      ${isLast ? '<p class="sheet-hint">E\' l\'unica pagina del profilo: per toglierla, elimina il profilo.</p>' : ''}
    `,
    actions: [
      ...(isLast ? [] : [{ label: 'Elimina', kind: 'danger', onClick: () => removePage(page.id) }]),
      { label: 'Annulla', kind: 'ghost', onClick: () => closeSheet() },
      { label: 'Salva', kind: 'primary', onClick: () => savePage(page.id) }
    ]
  });

  el('pg-left').addEventListener('click', () => movePage(page.id, -1));
  el('pg-right').addEventListener('click', () => movePage(page.id, 1));
}

async function savePage(pageId) {
  const deck = cloneDeck();
  const profile = findProfile(deck, state.profileId);
  const page = findPage(profile, pageId);
  page.name = el('pg-name').value.trim() || page.id;
  page.rows = Math.max(1, Math.min(8, Number(el('pg-rows').value) || page.rows));
  page.cols = Math.max(1, Math.min(12, Number(el('pg-cols').value) || page.cols));
  if (el('pg-default').checked) profile.defaultPage = page.id;
  await persistDeck(deck, `pagina "${page.name}" salvata`);
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
  if (await persistDeck(deck, 'pagina aggiunta')) goToPage(id);
}

async function removePage(pageId) {
  const deck = cloneDeck();
  const profile = findProfile(deck, state.profileId);
  if (profile.pages.length <= 1) {
    toast('Un profilo deve avere almeno una pagina', 'err');
    return;
  }
  profile.pages = profile.pages.filter((p) => p.id !== pageId);
  if (profile.defaultPage === pageId) profile.defaultPage = profile.pages[0].id;
  if (await persistDeck(deck, 'pagina eliminata')) goToPage(profile.pages[0].id);
}

async function movePage(pageId, delta) {
  const deck = cloneDeck();
  const profile = findProfile(deck, state.profileId);
  const index = profile.pages.findIndex((p) => p.id === pageId);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= profile.pages.length) return;
  const [page] = profile.pages.splice(index, 1);
  profile.pages.splice(target, 0, page);
  await persistDeck(deck, 'pagine riordinate');
}

// ------------------------------------------------- profili

/** Pannello di gestione dei profili. */
function editProfiles() {
  const deck = state.deck;
  const rows = deck.profiles.map((p) => `
    <div class="host-row">
      <span>${escapeHtml(p.name)}<small>${p.pages.length} pagine${p.id === deck.defaultProfile ? ' - iniziale' : ''}</small></span>
      <span class="row-actions">
        ${p.id === deck.defaultProfile ? '' : `<button class="btn ghost small" type="button" data-profile-default="${p.id}">Iniziale</button>`}
        <button class="btn ghost small" type="button" data-profile-rename="${p.id}">Rinomina</button>
        ${deck.profiles.length > 1 ? `<button class="btn ghost small danger" type="button" data-profile-remove="${p.id}">Elimina</button>` : ''}
      </span>
    </div>`).join('');

  openSheet({
    title: 'Profili',
    body: `
      <div class="host-list">${rows}</div>
      <label class="field"><span>Nome del nuovo profilo</span><input id="pr-name" type="text" maxlength="64" placeholder="es. Streaming" /></label>
      <button class="btn" type="button" id="pr-add">Aggiungi profilo</button>
      <p class="sheet-hint">Un profilo nuovo nasce con una pagina vuota della stessa dimensione di quella attuale.</p>
    `,
    actions: [{ label: 'Chiudi', kind: 'ghost', onClick: () => closeSheet() }]
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
  if (await persistDeck(deck, `profilo "${name}" creato`)) switchProfile(id);
}

async function removeProfile(profileId) {
  const deck = cloneDeck();
  if (deck.profiles.length <= 1) {
    toast('Deve restare almeno un profilo', 'err');
    return;
  }
  deck.profiles = deck.profiles.filter((p) => p.id !== profileId);
  if (deck.defaultProfile === profileId) deck.defaultProfile = deck.profiles[0].id;
  const saved = await persistDeck(deck, 'profilo eliminato');
  if (saved && state.profileId === profileId) switchProfile(deck.profiles[0].id);
}

async function setDefaultProfile(profileId) {
  const deck = cloneDeck();
  deck.defaultProfile = profileId;
  await persistDeck(deck, 'profilo iniziale aggiornato');
}

function renameProfile(profileId) {
  const profile = findProfile(state.deck, profileId);
  openSheet({
    title: `Rinomina "${profile.name}"`,
    body: `<label class="field"><span>Nome</span><input id="pr-rename" type="text" maxlength="64" value="${escapeHtml(profile.name)}" /></label>`,
    actions: [
      { label: 'Annulla', kind: 'ghost', onClick: () => editProfiles() },
      {
        label: 'Salva',
        kind: 'primary',
        onClick: async () => {
          const deck = cloneDeck();
          findProfile(deck, profileId).name = el('pr-rename').value.trim() || profileId;
          await persistDeck(deck, 'profilo rinominato');
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
    const detail = (res.data.errors ?? []).slice(0, 3).map((e) => `${e.path}: ${e.message}`).join(' | ');
    toast(detail || res.data?.error?.message || 'salvataggio rifiutato', 'err');
    return false;
  }
  if (!quiet) closeSheet();
  toast(successMessage, 'ok');
  return true;
}

// ---------------------------------------------------------------- impostazioni

async function openSettings() {
  const res = await api(ENDPOINTS.settings);
  const settings = res.data?.settings ?? {};
  const update = state.update;

  openSheet({
    title: 'Impostazioni',
    body: `
      <h3 class="sheet-section">Accesso</h3>
      <label class="field"><span>PIN di pairing (4-12 cifre)</span>
        <input id="set-pin" type="text" inputmode="numeric" maxlength="12" placeholder="${settings.security?.pinConfigured ? `configurato (${settings.security.pinLength} cifre)` : 'nessun PIN'}" />
      </label>
      <p class="sheet-hint">Lascia vuoto per non cambiarlo. Il PIN serve solo ad associare nuovi dispositivi: quelli gia' associati restano collegati.</p>

      <h3 class="sheet-section">Computer collegati</h3>
      <div class="host-list">${state.hosts.map((h) => `
        <div class="host-row">
          <span>${escapeHtml(h.name)}<small>${escapeHtml(h.base)}</small></span>
          <button class="btn ghost small" type="button" data-forget="${h.id}">Rimuovi</button>
        </div>`).join('') || '<p class="sheet-hint">Nessun computer salvato.</p>'}
      </div>
      <button class="btn" type="button" id="set-add-host">Aggiungi un altro computer</button>

      <h3 class="sheet-section">Aggiornamenti</h3>
      <p class="sheet-hint" id="set-update">${update?.available
    ? `Disponibile la versione ${escapeHtml(update.latest?.version ?? '')} (in uso la ${escapeHtml(update.current ?? '')}).`
    : `Versione in uso: ${escapeHtml(update?.current ?? '-')}. Nessun aggiornamento disponibile.`}</p>
      <button class="btn" type="button" id="set-check-update">Controlla ora</button>
    `,
    actions: [
      { label: 'Chiudi', kind: 'ghost', onClick: () => closeSheet() },
      { label: 'Salva', kind: 'primary', onClick: saveSettings }
    ]
  });

  el('set-add-host').addEventListener('click', () => {
    closeSheet();
    showGate('Inserisci indirizzo e PIN del computer da aggiungere.');
  });
  el('set-check-update').addEventListener('click', () => checkUpdate({ force: true }));
  for (const btn of ui.sheetBody.querySelectorAll('[data-forget]')) {
    btn.addEventListener('click', () => forgetHost(btn.dataset.forget));
  }
}

async function saveSettings() {
  const pin = el('set-pin').value.trim();
  if (!pin) {
    closeSheet();
    return;
  }
  const res = await api(ENDPOINTS.settings, { method: 'POST', body: { pin } });
  if (!res.ok) {
    toast(res.data?.error?.message ?? 'impostazioni rifiutate', 'err');
    return;
  }
  closeSheet();
  toast('PIN aggiornato', 'ok');
}

function forgetHost(id) {
  state.hosts = state.hosts.filter((h) => h.id !== id);
  saveHosts();
  closeSheet();
  if (id === state.activeHostId) {
    state.activeHostId = state.hosts[0]?.id ?? null;
    if (state.activeHostId) switchHost(state.activeHostId);
    else showGate('Nessun computer collegato.');
  }
  renderHosts();
}

// ---------------------------------------------------------------- aggiornamenti

async function checkUpdate({ force = false } = {}) {
  const res = await api(`${ENDPOINTS.update}${force ? '?check=1' : ''}`);
  if (!res.ok) return;
  showUpdate(res.data.update);
  if (force && !res.data.update?.available) toast('Nessun aggiornamento disponibile', 'ok');
}

function showUpdate(status) {
  state.update = status;
  ui.update.hidden = !status?.available;
  if (status?.available) {
    ui.update.textContent = `v${status.latest.version} disponibile`;
    ui.update.title = `Sei alla versione ${status.current}. Tocca per aprire la pagina del rilascio.`;
  }
}

// ---------------------------------------------------------------- interazione

function bindEvents() {
  ui.gatePair.addEventListener('click', pairWithPin);
  ui.gateTokenSave.addEventListener('click', saveManualToken);

  ui.hosts.addEventListener('click', (event) => {
    const add = event.target.closest('[data-host-add]');
    if (add) {
      showGate('Inserisci indirizzo e PIN del computer da aggiungere.');
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

  ui.btnEdit.addEventListener('click', () => {
    state.editing = !state.editing;
    ui.btnEdit.setAttribute('aria-pressed', String(state.editing));
    renderProfiles();
    renderPages();
    renderGrid();
    toast(state.editing
      ? 'Modifica attiva: tocca un controllo per cambiarlo, trascinalo per spostarlo, tocca una cella vuota per aggiungerne uno'
      : 'Modifica disattivata');
  });

  ui.btnSimulate.addEventListener('click', () => {
    state.simulate = !state.simulate;
    ui.btnSimulate.setAttribute('aria-pressed', String(state.simulate));
    toast(state.simulate ? 'Modalita\' simulazione attiva' : 'Modalita\' simulazione disattivata');
  });

  ui.btnFullscreen.addEventListener('click', async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen().catch(() => toast('Schermo intero non disponibile', 'err'));
  });

  ui.btnSettings.addEventListener('click', openSettings);
  ui.update.addEventListener('click', () => {
    if (state.update?.latest?.url) window.open(state.update.latest.url, '_blank', 'noopener');
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

/** Evidenzia la cella su cui il controllo verrebbe rilasciato. */
function highlightDropCell(clientX, clientY) {
  clearDropCell();
  const cell = cellAt(clientX, clientY);
  if (!cell) return;
  const target = ui.grid.querySelector(`[data-empty="${cell.row}:${cell.col}"]`);
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
    const slider = event.target.closest('.deck-slider');
    const button = event.target.closest('.deck-btn:not(.empty)');
    const empty = event.target.closest('.deck-btn.empty');

    if (state.editing) {
      const control = button ?? slider;
      if (control) {
        // Un tocco apre l'editor, un trascinamento sposta: quale dei due sia
        // si capisce solo al rilascio, quindi qui si registra soltanto l'inizio.
        control.setPointerCapture?.(event.pointerId);
        gesture = { kind: 'edit-move', element: control, startX: event.clientX, startY: event.clientY, moved: false };
      } else if (empty) {
        editButton(null, empty.dataset.empty);
      }
      return;
    }

    if (slider) {
      slider.setPointerCapture?.(event.pointerId);
      state.draggingId = slider.dataset.id;
      gesture = { kind: 'slider', element: slider, startX: event.clientX, startY: event.clientY, lastSent: 0 };
      applySliderFromPointer(slider, event.clientX);
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

      // Con un'azione di hold configurata bisogna attendere per capire quale
      // delle due l'utente voleva; senza, si parte subito.
      if (spec?.holdAction) {
        gesture.holdTimer = setTimeout(() => {
          gesture.fired = true;
          runPress(button, spec, { hold: true });
        }, 550);
      } else {
        gesture.fired = true;
        runPress(button, spec);
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
      applySliderFromPointer(gesture.element, event.clientX);
      return;
    }
    // Oltre i 12 px in orizzontale il gesto e' uno swipe, non una pressione:
    // l'eventuale hold in attesa va annullato.
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
      clearHold();
      if (gesture.kind === 'button' && !gesture.fired) {
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

    if (gesture.kind === 'slider') {
      sendSliderValue(gesture.element, { final: true });
      state.draggingId = null;
    } else if (gesture.kind === 'button' && !gesture.fired) {
      const spec = gesture.spec;
      gesture.element.classList.remove('pending');
      runPress(gesture.element, spec);
    } else if (gesture.kind === 'swipe' && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      stepPage(dx < 0 ? 1 : -1);
    }
    gesture = null;
  };

  ui.grid.addEventListener('pointerup', endGesture);
  ui.grid.addEventListener('pointercancel', () => {
    if (gesture?.element) gesture.element.classList.remove('pending', 'dragging');
    clearHold();
    clearDropCell();
    state.draggingId = null;
    gesture = null;
  });
  ui.grid.addEventListener('contextmenu', (event) => event.preventDefault());

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

/** Converte la posizione orizzontale del dito nel valore dello slider. */
function applySliderFromPointer(slider, clientX) {
  const rect = slider.getBoundingClientRect();
  const min = Number(slider.dataset.min);
  const max = Number(slider.dataset.max);
  const step = Number(slider.dataset.step) || 1;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const raw = min + ratio * (max - min);
  const value = Math.round(raw / step) * step;

  updateSliderVisual(slider, value);
  state.levels.set(slider.dataset.id, value);
  sendSliderValue(slider);
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
  ui.sheet.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) closeSheet({ silent: false });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ui.sheet.hidden) closeSheet({ silent: false });
    if (ui.sheet.hidden && !state.editing) {
      if (event.key === 'ArrowRight') stepPage(1);
      if (event.key === 'ArrowLeft') stepPage(-1);
    }
  });
}

// ---------------------------------------------------------------- avvio

function boot() {
  bindEvents();
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
}

boot();
