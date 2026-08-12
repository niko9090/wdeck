/**
 * Wdeck - client web PWA.
 *
 * Nessun framework, nessuna build step complessa: moduli ES nativi.
 * Il protocollo e' condiviso con l'host tramite /shared/protocol.mjs.
 */

import { ENDPOINTS, MSG } from '/shared/protocol.mjs';
import { iconSvg } from './icons.js';

const STORAGE = {
  token: 'wdeck.token',
  base: 'wdeck.base',
  profile: 'wdeck.profile',
  page: 'wdeck.page'
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
  profileSelect: el('profile-select'),
  pages: el('pages'),
  grid: el('grid'),
  statusText: el('status-text'),
  lastAction: el('last-action'),
  toast: el('toast'),
  btnSimulate: el('btn-simulate'),
  btnFullscreen: el('btn-fullscreen'),
  btnReload: el('btn-reload'),
  btnLogout: el('btn-logout')
};

const state = {
  base: localStorage.getItem(STORAGE.base) || location.origin,
  token: null,
  deck: null,
  hostState: null,
  profileId: null,
  pageId: null,
  simulate: false,
  socket: null,
  connected: false,
  retry: 0,
  requestSeq: 0,
  pending: new Map()
};

// ---------------------------------------------------------------- utilita'

function toast(message, kind = '') {
  ui.toast.textContent = message;
  ui.toast.className = `toast ${kind}`.trim();
  ui.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { ui.toast.hidden = true; }, 3200);
}

function tokenFromUrl() {
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  if (token) {
    localStorage.setItem(STORAGE.token, token);
    // ripulisce l'URL per non lasciare il token nella cronologia
    history.replaceState(null, '', location.pathname);
  }
  return token;
}

function setStatus(stateName, text) {
  ui.dot.dataset.state = stateName;
  ui.statusText.textContent = text;
}

async function api(path, { method = 'GET', body } = {}) {
  const url = `${state.base}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { 'x-wdeck-token': state.token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

// ---------------------------------------------------------------- gate

function showGate(message = '') {
  ui.app.hidden = true;
  ui.gate.hidden = false;
  ui.gateHost.value = state.base;
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
  state.base = base;
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
    localStorage.setItem(STORAGE.base, base);
    localStorage.setItem(STORAGE.token, data.token);
    state.token = data.token;
    ui.gate.hidden = true;
    ui.app.hidden = false;
    connect();
  } catch (err) {
    ui.gateError.textContent = `Host non raggiungibile: ${err.message}`;
  }
}

function saveManualToken() {
  const base = ui.gateHost.value.trim().replace(/\/+$/, '') || location.origin;
  const token = ui.gateToken.value.trim();
  if (!token) {
    ui.gateError.textContent = 'Inserisci un token.';
    return;
  }
  state.base = base;
  state.token = token;
  localStorage.setItem(STORAGE.base, base);
  localStorage.setItem(STORAGE.token, token);
  ui.gate.hidden = true;
  ui.app.hidden = false;
  connect();
}

// ---------------------------------------------------------------- WebSocket

function wsUrl() {
  const url = new URL(state.base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = ENDPOINTS.ws;
  url.search = '';
  return url.toString();
}

function connect() {
  if (state.socket) {
    try { state.socket.close(); } catch { /* ignora */ }
  }
  setStatus('connecting', 'connessione in corso...');

  const socket = new WebSocket(wsUrl());
  state.socket = socket;

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: MSG.auth, token: state.token }));
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
    state.connected = false;
    setStatus('offline', 'connessione persa');
    const delay = Math.min(1000 * 2 ** state.retry, 15000);
    state.retry += 1;
    setTimeout(() => { if (state.token) connect(); }, delay);
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

    case MSG.navigate:
      state.profileId = msg.activeProfile;
      state.pageId = msg.activePage;
      renderAll();
      break;

    case MSG.ack: {
      const pending = state.pending.get(msg.requestId);
      if (pending) {
        state.pending.delete(msg.requestId);
        finishPress(pending.element, msg.ok, msg.result);
      }
      break;
    }

    case MSG.event:
      if (msg.event === 'press') renderLastAction(msg.data);
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
    .join('');
}

function renderPages() {
  const profile = currentProfile();
  const page = currentPage();
  ui.pages.innerHTML = profile.pages
    .map((p) => `<button class="page-tab" role="tab" data-page="${p.id}" aria-selected="${p.id === page.id}">${escapeHtml(p.name)}</button>`)
    .join('');
}

function renderGrid() {
  const page = currentPage();
  if (!page) return;
  ui.grid.style.gridTemplateColumns = `repeat(${page.cols}, minmax(0, 1fr))`;
  ui.grid.style.gridTemplateRows = `repeat(${page.rows}, minmax(0, 1fr))`;

  const cells = new Map(page.buttons.map((b) => [`${b.row}:${b.col}`, b]));
  const parts = [];
  for (let row = 0; row < page.rows; row += 1) {
    for (let col = 0; col < page.cols; col += 1) {
      const button = cells.get(`${row}:${col}`);
      if (!button) {
        parts.push('<div class="deck-btn empty" aria-hidden="true"></div>');
        continue;
      }
      const style = [
        button.color ? `background:${button.color}` : '',
        button.textColor ? `color:${button.textColor}` : ''
      ].filter(Boolean).join(';');
      parts.push(
        `<button class="deck-btn" type="button" data-id="${button.id}" style="${style}" title="${escapeHtml(button.label || button.id)}">`
        + `<span class="type-tag">${escapeHtml(button.action.type)}</span>`
        + iconSvg(button.icon, button.action.type)
        + (state.deck.ui?.showLabels === false ? '' : `<span class="label">${escapeHtml(button.label)}</span>`)
        + '</button>'
      );
    }
  }
  ui.grid.innerHTML = parts.join('');
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

function renderLastAction(entry) {
  if (!entry) return;
  const status = entry.ok ? 'ok' : 'errore';
  const detail = entry.ok ? (entry.detail ?? '') : (entry.error?.message ?? '');
  ui.lastAction.textContent = `${entry.buttonId} [${entry.type}] ${status}${detail ? `: ${detail}` : ''}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// ---------------------------------------------------------------- interazione

function pressButton(element, { hold = false } = {}) {
  const buttonId = element.dataset.id;
  if (!buttonId) return;
  const requestId = `r${++state.requestSeq}`;
  element.classList.remove('ok', 'err');
  element.classList.add('pending');
  state.pending.set(requestId, { element, buttonId });

  const sent = send({
    type: MSG.press,
    buttonId,
    profileId: state.profileId,
    pageId: state.pageId,
    hold,
    dryRun: state.simulate,
    requestId
  });
  if (!sent) {
    state.pending.delete(requestId);
    element.classList.remove('pending');
    return;
  }
  if (navigator.vibrate) navigator.vibrate(hold ? 30 : 12);

  setTimeout(() => {
    if (state.pending.has(requestId)) {
      state.pending.delete(requestId);
      finishPress(element, false, { error: { message: 'nessuna risposta dall\'host' } });
    }
  }, 8000);
}

function finishPress(element, ok, result) {
  element.classList.remove('pending');
  element.classList.add(ok ? 'ok' : 'err');
  setTimeout(() => element.classList.remove('ok', 'err'), 700);
  if (!ok) toast(result?.error?.message ?? 'azione fallita', 'err');
}

function bindEvents() {
  ui.gatePair.addEventListener('click', pairWithPin);
  ui.gateTokenSave.addEventListener('click', saveManualToken);

  ui.profileSelect.addEventListener('change', () => {
    state.profileId = ui.profileSelect.value;
    state.pageId = null;
    localStorage.setItem(STORAGE.profile, state.profileId);
    renderAll();
    send({ type: MSG.navigate, profile: state.profileId });
  });

  ui.pages.addEventListener('click', (event) => {
    const tab = event.target.closest('.page-tab');
    if (!tab) return;
    state.pageId = tab.dataset.page;
    localStorage.setItem(STORAGE.page, state.pageId);
    renderAll();
    send({ type: MSG.navigate, profile: state.profileId, page: state.pageId });
  });

  let holdTimer = null;
  let held = false;

  ui.grid.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('.deck-btn:not(.empty)');
    if (!button) return;
    held = false;
    holdTimer = setTimeout(() => {
      held = true;
      pressButton(button, { hold: true });
    }, 650);
  });

  ui.grid.addEventListener('pointerup', (event) => {
    const button = event.target.closest('.deck-btn:not(.empty)');
    clearTimeout(holdTimer);
    if (!button || held) return;
    pressButton(button);
  });

  ui.grid.addEventListener('pointercancel', () => clearTimeout(holdTimer));
  ui.grid.addEventListener('contextmenu', (event) => event.preventDefault());

  ui.btnSimulate.addEventListener('click', () => {
    state.simulate = !state.simulate;
    ui.btnSimulate.setAttribute('aria-pressed', String(state.simulate));
    toast(state.simulate ? 'Modalita\' simulazione attiva' : 'Modalita\' simulazione disattivata');
  });

  ui.btnFullscreen.addEventListener('click', async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen().catch(() => toast('Schermo intero non disponibile', 'err'));
  });

  ui.btnReload.addEventListener('click', () => {
    send({ type: MSG.reload, requestId: `reload-${++state.requestSeq}` });
    toast('Richiesta ricarica di deck.json');
  });

  ui.btnLogout.addEventListener('click', () => {
    localStorage.removeItem(STORAGE.token);
    state.token = null;
    if (state.socket) state.socket.close();
    showGate('Token dimenticato.');
  });

  window.addEventListener('online', () => { if (state.token) connect(); });
}

// ---------------------------------------------------------------- avvio

function boot() {
  bindEvents();
  state.token = tokenFromUrl() ?? localStorage.getItem(STORAGE.token);
  state.profileId = localStorage.getItem(STORAGE.profile);
  state.pageId = localStorage.getItem(STORAGE.page);

  if (!state.token) {
    showGate();
    return;
  }
  ui.gate.hidden = true;
  ui.app.hidden = false;
  connect();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline non disponibile */ });
  });
}

boot();
