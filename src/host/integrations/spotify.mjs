/**
 * Integrazione con Spotify, tramite la Web API.
 *
 * Perche' la Web API e non i tasti multimediali: i tasti agiscono su qualunque
 * lettore abbia il fuoco, e su un PC con piu' schede aperte non si sa mai su
 * quale finiranno. La Web API parla con l'account, quindi comanda Spotify anche
 * se sta suonando sul telefono o su un altoparlante in un'altra stanza - che e'
 * poi il caso in cui un deck serve davvero.
 *
 * Serve una registrazione dell'applicazione su Spotify e un refresh token
 * ottenuto una volta sola (la procedura e' in docs/ADDING-ACTIONS.md). Il
 * refresh token non scade: da quello si ricava un access token valido un'ora,
 * che viene tenuto in memoria finche' vale.
 */

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

/** Access token in memoria, uno per client id. Non finisce mai su disco. */
const cache = new Map();

/**
 * Ottiene un access token valido, riusando quello in cache finche' e' buono.
 * @param {{clientId: string, clientSecret: string, refreshToken: string}} config
 * @param {{now?: () => number, fetchImpl?: Function}} [deps]
 * @returns {Promise<string>}
 */
export async function accessToken(config, { now = Date.now, fetchImpl = fetch } = {}) {
  for (const campo of ['clientId', 'clientSecret', 'refreshToken']) {
    if (!config?.[campo]) {
      throw new Error(`Spotify non configurato: manca settings.integrations.spotify.${campo}`);
    }
  }

  const cached = cache.get(config.clientId);
  // Un minuto di margine: un token che scade mentre la richiesta e' in volo
  // produrrebbe un 401 inspiegabile.
  if (cached && cached.expiresAt - 60_000 > now()) return cached.token;

  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: config.refreshToken }).toString(),
    signal: AbortSignal.timeout(8000)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Spotify ha rifiutato il rinnovo del token: ${body.error_description ?? body.error ?? response.status}`);
  }

  cache.set(config.clientId, {
    token: body.access_token,
    expiresAt: now() + (Number(body.expires_in) || 3600) * 1000
  });
  return body.access_token;
}

/** Svuota la cache dei token: usato dai test. */
export const forgetTokens = () => cache.clear();

/**
 * Chiamata autenticata alla Web API.
 * @param {object} config
 * @param {{method?: string, path: string, body?: object, query?: object}} request
 * @param {{fetchImpl?: Function}} [deps]
 * @returns {Promise<object|null>} null quando la risposta e' vuota (204)
 */
export async function spotifyRequest(config, { method = 'GET', path, body, query }, { fetchImpl = fetch } = {}) {
  const token = await accessToken(config, { fetchImpl });
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const response = await fetchImpl(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000)
  });

  if (response.status === 204) return null;
  if (response.status === 404) {
    throw new Error('Spotify: nessun dispositivo attivo. Fai partire la riproduzione da qualche parte e riprova.');
  }
  const text = await response.text();
  if (!response.ok) {
    let dettaglio = text.slice(0, 200);
    try {
      dettaglio = JSON.parse(text).error?.message ?? dettaglio;
    } catch { /* la risposta puo' non essere JSON */ }
    throw new Error(`Spotify ha risposto ${response.status}: ${dettaglio}`);
  }
  return text === '' ? null : JSON.parse(text);
}

/** Stato corrente della riproduzione, o null se non c'e' nulla in corso. */
export async function playerState(config, deps) {
  const state = await spotifyRequest(config, { path: '/me/player' }, deps);
  if (!state) return null;
  return {
    playing: state.is_playing === true,
    volume: state.device?.volume_percent ?? null,
    shuffle: state.shuffle_state === true,
    repeat: state.repeat_state ?? 'off',
    device: state.device?.name ?? null,
    track: state.item?.name ?? null,
    artist: (state.item?.artists ?? []).map((a) => a.name).join(', ') || null
  };
}

/**
 * Comandi esposti come azione del deck.
 * Ognuno dice quale chiamata fare; `needsState` marca quelli che devono prima
 * sapere cosa sta succedendo.
 */
export const SPOTIFY_COMMANDS = {
  play: { label: 'riprendi', build: () => ({ method: 'PUT', path: '/me/player/play' }) },
  pause: { label: 'pausa', build: () => ({ method: 'PUT', path: '/me/player/pause' }) },
  playpause: { label: 'riproduci o metti in pausa', needsState: true },
  next: { label: 'brano successivo', build: () => ({ method: 'POST', path: '/me/player/next' }) },
  previous: { label: 'brano precedente', build: () => ({ method: 'POST', path: '/me/player/previous' }) },
  volume: {
    label: 'volume',
    needs: 'value',
    build: (params) => ({
      method: 'PUT',
      path: '/me/player/volume',
      query: { volume_percent: Math.max(0, Math.min(100, Math.round(Number(params.value)))) }
    })
  },
  shuffle: { label: 'riproduzione casuale', needsState: true },
  repeat: {
    label: 'ripetizione',
    build: (params) => ({
      method: 'PUT',
      path: '/me/player/repeat',
      query: { state: ['off', 'context', 'track'].includes(params.mode) ? params.mode : 'context' }
    })
  },
  transfer: {
    label: 'sposta la riproduzione',
    needs: 'device',
    build: (params) => ({ method: 'PUT', path: '/me/player', body: { device_ids: [params.device], play: true } })
  },
  play_uri: {
    label: 'riproduci un contesto',
    needs: 'uri',
    build: (params) => ({
      method: 'PUT',
      path: '/me/player/play',
      body: params.uri.includes(':track:') ? { uris: [params.uri] } : { context_uri: params.uri }
    })
  }
};

/**
 * Esegue un comando.
 * @param {object} config
 * @param {string} command
 * @param {object} params
 * @param {object} [deps]
 * @returns {Promise<{detail: string, state?: object}>}
 */
export async function runSpotifyCommand(config, command, params = {}, deps) {
  const spec = SPOTIFY_COMMANDS[command];
  if (!spec) throw new Error(`comando Spotify sconosciuto: "${command}"`);

  if (command === 'playpause') {
    const state = await playerState(config, deps);
    const target = state?.playing ? 'pause' : 'play';
    await spotifyRequest(config, { method: 'PUT', path: `/me/player/${target}` }, deps);
    return { detail: target === 'play' ? 'Spotify: riproduzione ripresa' : 'Spotify: in pausa' };
  }

  if (command === 'shuffle') {
    const state = await playerState(config, deps);
    const next = params.value === undefined ? !state?.shuffle : params.value === true;
    await spotifyRequest(config, { method: 'PUT', path: '/me/player/shuffle', query: { state: next } }, deps);
    return { detail: `Spotify: riproduzione casuale ${next ? 'attiva' : 'disattivata'}` };
  }

  await spotifyRequest(config, spec.build(params), deps);
  return { detail: `Spotify: ${spec.label}` };
}
