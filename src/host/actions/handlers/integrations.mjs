/**
 * Integrazioni con servizi esterni: OBS Studio, Home Assistant, Philips Hue.
 *
 * Nessuna di queste azioni porta con se' credenziali: password e token stanno
 * in deck.json sotto settings.integrations e vengono lette dal contesto, cosi'
 * un deck puo' essere condiviso senza esportare i propri segreti.
 */

import crypto from 'node:crypto';
import { connectWebSocket, waitForMessage } from '../../ws/client.mjs';

/** Legge la configurazione di un'integrazione da settings.integrations. */
function integrationConfig(ctx, name) {
  return ctx.deck?.settings?.integrations?.[name] ?? {};
}

/**
 * Calcola la risposta al challenge di autenticazione di obs-websocket v5:
 * base64(sha256(base64(sha256(password + salt)) + challenge)).
 * @param {string} password
 * @param {string} salt
 * @param {string} challenge
 * @returns {string}
 */
export function obsAuthResponse(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}

/** Codici del protocollo obs-websocket v5 usati qui. */
const OBS_OP = { hello: 0, identify: 1, identified: 2, request: 6, requestResponse: 7 };

/**
 * Apre una connessione a OBS, esegue una richiesta e chiude.
 *
 * OBS mantiene una sola sessione per connessione e le richieste sono rare
 * (una per pressione): tenere aperto un socket permanente aggiungerebbe
 * riconnessioni e stato da gestire senza alcun guadagno percepibile.
 * @param {{url: string, password?: string}} config
 * @param {{requestType: string, requestData?: object}} request
 * @returns {Promise<object>}
 */
export async function obsRequest(config, request) {
  const url = config.url ?? 'ws://127.0.0.1:4455';
  let conn;
  try {
    conn = await connectWebSocket(url, { timeoutMs: 5000 });
  } catch (err) {
    throw new Error(`OBS non raggiungibile su ${url}: ${err.message} `
      + '(server WebSocket attivo in OBS da Strumenti > Impostazioni server WebSocket?)');
  }

  const send = (msg) => conn.send(JSON.stringify(msg));
  try {
    const hello = await waitForMessage(conn, (msg) => msg?.op === OBS_OP.hello, { timeoutMs: 5000, label: 'hello di OBS' });
    const auth = hello.d?.authentication;
    if (auth && !config.password) {
      throw new Error('OBS richiede una password: impostare settings.integrations.obs.password in deck.json');
    }

    send({
      op: OBS_OP.identify,
      d: {
        rpcVersion: 1,
        ...(auth ? { authentication: obsAuthResponse(config.password, auth.salt, auth.challenge) } : {})
      }
    });
    await waitForMessage(conn, (msg) => msg?.op === OBS_OP.identified, { timeoutMs: 5000, label: 'identificazione OBS' });

    const requestId = `wdeck-${crypto.randomUUID()}`;
    send({
      op: OBS_OP.request,
      d: { requestId, requestType: request.requestType, requestData: request.requestData ?? {} }
    });
    const response = await waitForMessage(
      conn,
      (msg) => msg?.op === OBS_OP.requestResponse && msg.d?.requestId === requestId,
      { timeoutMs: 8000, label: `risposta a ${request.requestType}` }
    );

    const status = response.d?.requestStatus;
    if (!status?.result) {
      throw new Error(`OBS ha rifiutato "${request.requestType}": ${status?.comment ?? `codice ${status?.code}`}`);
    }
    return response.d?.responseData ?? {};
  } finally {
    conn.close();
  }
}

/** Richieste OBS esposte come comandi del deck. */
const OBS_COMMANDS = {
  scene: {
    label: 'cambia scena',
    needs: 'scene',
    build: (params) => ({ requestType: 'SetCurrentProgramScene', requestData: { sceneName: params.scene } })
  },
  'start-record': { label: 'avvia registrazione', build: () => ({ requestType: 'StartRecord' }) },
  'stop-record': { label: 'ferma registrazione', build: () => ({ requestType: 'StopRecord' }) },
  'toggle-record': { label: 'avvia/ferma registrazione', build: () => ({ requestType: 'ToggleRecord' }) },
  'pause-record': { label: 'pausa registrazione', build: () => ({ requestType: 'ToggleRecordPause' }) },
  'start-stream': { label: 'avvia diretta', build: () => ({ requestType: 'StartStream' }) },
  'stop-stream': { label: 'ferma diretta', build: () => ({ requestType: 'StopStream' }) },
  'toggle-stream': { label: 'avvia/ferma diretta', build: () => ({ requestType: 'ToggleStream' }) },
  'toggle-mute': {
    label: 'muto sorgente audio',
    needs: 'source',
    build: (params) => ({ requestType: 'ToggleInputMute', requestData: { inputName: params.source } })
  },
  'toggle-source': {
    label: 'mostra/nascondi sorgente',
    needs: 'source',
    build: (params) => ({
      requestType: 'SetSceneItemEnabled',
      requestData: { sceneName: params.scene, sceneItemId: params.itemId, sceneItemEnabled: params.enabled !== false }
    })
  },
  'virtual-cam': { label: 'webcam virtuale on/off', build: () => ({ requestType: 'ToggleVirtualCam' }) },
  replay: { label: 'salva replay', build: () => ({ requestType: 'SaveReplayBuffer' }) }
};

export const obsAction = {
  type: 'obs',
  title: 'OBS Studio',
  description: 'Controlla OBS via obs-websocket v5 (incluso in OBS 28 e successivi): cambio scena, '
    + 'registrazione, diretta, muto delle sorgenti, replay. Va abilitato in OBS da Strumenti > '
    + 'Impostazioni server WebSocket.',
  platforms: ['*'],
  category: 'streaming',
  paramsHelp: {
    command: Object.keys(OBS_COMMANDS).join(' | '),
    scene: 'nome della scena (per "scene" e "toggle-source")',
    source: 'nome della sorgente audio o dell\'elemento di scena',
    itemId: 'id numerico dell\'elemento di scena (per "toggle-source")'
  },
  validate(params) {
    const spec = OBS_COMMANDS[params?.command];
    if (!spec) throw new Error(`parametro "command" non valido: atteso uno fra ${Object.keys(OBS_COMMANDS).join(', ')}`);
    if (spec.needs && !params?.[spec.needs]) {
      throw new Error(`il comando "${params.command}" richiede il parametro "${spec.needs}"`);
    }
  },
  describe: (params) => `OBS: ${OBS_COMMANDS[params?.command]?.label ?? params?.command}${params?.scene ? ` "${params.scene}"` : ''}`,
  async run(params, ctx) {
    const spec = OBS_COMMANDS[params.command];
    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `invierebbe a OBS: ${spec.label}` };
    }
    const config = integrationConfig(ctx, 'obs');
    const data = await obsRequest(config, spec.build(params));
    return { ok: true, detail: `OBS: ${spec.label}`, data };
  }
};

export const homeAssistantAction = {
  type: 'homeassistant',
  title: 'Home Assistant',
  description: 'Chiama un servizio di Home Assistant (accendi luci, attiva scene, esegui automazioni). '
    + 'URL e token vanno in settings.integrations.homeassistant.',
  platforms: ['*'],
  category: 'smarthome',
  paramsHelp: {
    service: 'servizio nel formato dominio.servizio, es. "light.turn_on"',
    entity: 'entita\' su cui agire, es. "light.salotto"',
    data: 'oggetto con i parametri aggiuntivi del servizio'
  },
  validate(params) {
    if (typeof params?.service !== 'string' || !/^[a-z_]+\.[a-z_]+$/.test(params.service)) {
      throw new Error('parametro "service" non valido: atteso "dominio.servizio", es. "light.turn_on"');
    }
    if (params?.data !== undefined && (typeof params.data !== 'object' || params.data === null || Array.isArray(params.data))) {
      throw new Error('parametro "data" non valido: atteso oggetto');
    }
  },
  describe: (params) => `Home Assistant: ${params?.service}${params?.entity ? ` su ${params.entity}` : ''}`,
  async run(params, ctx) {
    const config = integrationConfig(ctx, 'homeassistant');
    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `chiamerebbe ${params.service}${params.entity ? ` su ${params.entity}` : ''}` };
    }
    if (!config.url || !config.token) {
      throw new Error('Home Assistant non configurato: servono settings.integrations.homeassistant.url e .token');
    }

    const [domain, service] = params.service.split('.');
    const response = await fetch(`${String(config.url).replace(/\/+$/, '')}/api/services/${domain}/${service}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(params.entity ? { entity_id: params.entity } : {}), ...(params.data ?? {}) }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      throw new Error(`Home Assistant ha risposto ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    return { ok: true, detail: `${params.service} eseguito${params.entity ? ` su ${params.entity}` : ''}` };
  }
};

export const hueAction = {
  type: 'hue',
  title: 'Philips Hue',
  description: 'Accende, spegne o regola luci e gruppi Hue tramite il bridge locale. Bridge e username '
    + 'vanno in settings.integrations.hue.',
  platforms: ['*'],
  category: 'smarthome',
  paramsHelp: {
    target: 'light | group (default light)',
    id: 'numero della luce o del gruppo sul bridge',
    on: 'true | false | "toggle"',
    brightness: 'luminosita\' 0..100',
    hue: 'tonalita\' 0..65535',
    saturation: 'saturazione 0..254',
    scene: 'id della scena da attivare (solo con target "group")'
  },
  validate(params) {
    if (params?.id === undefined) throw new Error('parametro "id" mancante');
    if (params?.target !== undefined && !['light', 'group'].includes(params.target)) {
      throw new Error('parametro "target" non valido: atteso "light" o "group"');
    }
    if (params?.on !== undefined && ![true, false, 'toggle'].includes(params.on)) {
      throw new Error('parametro "on" non valido: atteso true, false o "toggle"');
    }
    if (params?.brightness !== undefined) {
      const b = Number(params.brightness);
      if (!Number.isFinite(b) || b < 0 || b > 100) throw new Error('parametro "brightness" non valido: 0..100');
    }
  },
  describe(params) {
    const what = `${params?.target ?? 'light'} ${params?.id}`;
    if (params?.on === 'toggle') return `Hue: inverte ${what}`;
    if (params?.on === false) return `Hue: spegne ${what}`;
    return `Hue: regola ${what}`;
  },
  async run(params, ctx) {
    const config = integrationConfig(ctx, 'hue');
    if (ctx.dryRun) return { ok: true, simulated: true, detail: this.describe(params) };
    if (!config.bridge || !config.username) {
      throw new Error('Hue non configurato: servono settings.integrations.hue.bridge e .username');
    }

    const target = params.target ?? 'light';
    const base = `http://${config.bridge}/api/${config.username}`;
    const endpoint = target === 'group' ? `${base}/groups/${params.id}/action` : `${base}/lights/${params.id}/state`;

    let on = params.on;
    if (on === 'toggle') {
      // Il bridge non ha un "inverti": va letto lo stato attuale e rispedito.
      const stateUrl = target === 'group' ? `${base}/groups/${params.id}` : `${base}/lights/${params.id}`;
      const current = await fetch(stateUrl, { signal: AbortSignal.timeout(5000) });
      if (!current.ok) throw new Error(`bridge Hue non raggiungibile: ${current.status}`);
      const json = await current.json();
      on = !(target === 'group' ? json?.state?.any_on : json?.state?.on);
    }

    const body = {};
    if (on !== undefined) body.on = on;
    if (params.brightness !== undefined) body.bri = Math.round((Number(params.brightness) / 100) * 254);
    if (params.hue !== undefined) body.hue = Number(params.hue);
    if (params.saturation !== undefined) body.sat = Number(params.saturation);
    if (params.scene !== undefined) body.scene = params.scene;

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`bridge Hue ha risposto ${response.status}`);
    const result = await response.json();
    const failed = Array.isArray(result) ? result.filter((r) => r.error) : [];
    if (failed.length) throw new Error(`Hue: ${failed[0].error?.description ?? 'comando rifiutato'}`);
    return { ok: true, detail: `Hue ${target} ${params.id}: comando applicato` };
  }
};

export default [obsAction, homeAssistantAction, hueAction];
