/**
 * Azioni per MQTT, Spotify e Discord.
 *
 * Sostituiscono altrettanti usi dell'azione `stub`, che confermava la pressione
 * senza fare nulla. Come le altre integrazioni, non portano credenziali nei
 * parametri: URL, password e token stanno in `settings.integrations` e vengono
 * letti dal contesto, cosi' un deck si puo' condividere senza esportare i propri
 * segreti.
 */

import { connectMqtt } from '../../integrations/mqtt.mjs';
import { SPOTIFY_COMMANDS, playerState, runSpotifyCommand } from '../../integrations/spotify.mjs';
import { connectDiscordRpc, sendWebhook, voiceSettingsFor } from '../../integrations/discord.mjs';

/** Legge la configurazione di un'integrazione da settings.integrations. */
const integrationConfig = (ctx, name) => ctx.deck?.settings?.integrations?.[name] ?? {};

// ------------------------------------------------------------------ MQTT

export const mqttAction = {
  type: 'mqtt',
  title: 'MQTT',
  description: 'Pubblica un messaggio su un broker MQTT: e\' il modo con cui parla mezza domotica '
    + '(Home Assistant, Zigbee2MQTT, Tasmota, ESPHome). Broker e credenziali vanno in '
    + 'settings.integrations.mqtt.',
  platforms: ['*'],
  category: 'smarthome',
  paramsHelp: {
    topic: 'topic su cui pubblicare, es. "casa/salotto/luce/set"',
    payload: 'contenuto del messaggio (default stringa vuota)',
    qos: '0 o 1 (default 0)',
    retain: 'true per lasciare il messaggio sul broker',
    stateTopic: 'topic da leggere per lo stato del controllo (opzionale)',
    onValue: 'valore che significa "acceso" sul topic di stato (default "ON")'
  },
  fields: [
    { key: 'topic', label: 'Topic', type: 'text', required: true, help: 'Topic su cui pubblicare', placeholder: 'casa/salotto/luce/set' },
    { key: 'payload', label: 'Messaggio', type: 'text', help: 'Contenuto del messaggio (default stringa vuota)' },
    {
      key: 'qos',
      label: 'QoS',
      type: 'select',
      default: 0,
      options: [
        { value: 0, label: '0' },
        { value: 1, label: '1' }
      ]
    },
    { key: 'retain', label: 'Retain', type: 'toggle', help: 'Lascia il messaggio sul broker' },
    { key: 'stateTopic', label: 'Topic di stato', type: 'text', help: 'Topic da leggere per lo stato del controllo (opzionale)' },
    { key: 'onValue', label: 'Valore "acceso"', type: 'text', help: 'Valore che significa "acceso" sul topic di stato', default: 'ON' }
  ],
  validate(params) {
    if (typeof params?.topic !== 'string' || params.topic.trim() === '') {
      throw new Error('parametro "topic" mancante');
    }
    if (/[+#]/.test(params.topic)) {
      throw new Error('il topic di pubblicazione non puo\' contenere i caratteri jolly + e #');
    }
    if (params.qos !== undefined && ![0, 1].includes(params.qos)) {
      throw new Error('parametro "qos" non valido: 0 oppure 1');
    }
    if (params.payload !== undefined && typeof params.payload !== 'string' && typeof params.payload !== 'number') {
      throw new Error('parametro "payload" non valido: atteso testo o numero');
    }
  },
  describe: (params) => `MQTT: pubblica su "${params?.topic}"${params?.payload !== undefined ? ` = ${params.payload}` : ''}`,
  async run(params, ctx) {
    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `pubblicherebbe su "${params.topic}"` };
    }
    const config = integrationConfig(ctx, 'mqtt');
    const client = await connectMqtt(config);
    try {
      await client.publish({
        topic: params.topic,
        payload: params.payload === undefined ? '' : String(params.payload),
        qos: params.qos ?? 0,
        retain: params.retain === true
      });
      return { ok: true, detail: `MQTT: pubblicato su "${params.topic}"` };
    } finally {
      client.close();
    }
  },

  /** Stato letto dal topic indicato, se ce n'e' uno. */
  async readState(params, ctx) {
    if (!params?.stateTopic) return null;
    const config = integrationConfig(ctx, 'mqtt');
    const acceso = String(params.onValue ?? 'ON');

    const leggi = async () => {
      const client = await connectMqtt(config);
      try {
        return await client.subscribeOnce(params.stateTopic, { ms: 3000 });
      } finally {
        client.close();
      }
    };
    const message = ctx?.cached
      ? await ctx.cached(`mqtt:${params.stateTopic}`, leggi)
      : await leggi();

    const valore = String(message.payload).trim();
    return {
      on: valore.toLowerCase() === acceso.toLowerCase(),
      level: Number.isFinite(Number(valore)) ? Math.round(Number(valore)) : null,
      text: valore.length <= 12 ? valore : null
    };
  }
};

// ------------------------------------------------------------------ Spotify

export const spotifyAction = {
  type: 'spotify',
  title: 'Spotify',
  description: 'Comanda Spotify tramite la Web API: riproduzione, brano, volume, casuale, ripetizione, '
    + 'spostamento su un altro dispositivo. A differenza dei tasti multimediali agisce sull\'account, '
    + 'quindi funziona anche se la musica sta suonando sul telefono o su un altoparlante.',
  platforms: ['*'],
  category: 'media',
  paramsHelp: {
    command: Object.keys(SPOTIFY_COMMANDS).join(' | '),
    value: 'volume 0..100 (per "volume"), true/false per "shuffle"',
    mode: 'off | context | track (per "repeat")',
    device: 'id del dispositivo (per "transfer")',
    uri: 'URI Spotify (per "play_uri"), es. spotify:playlist:...'
  },
  fields: [
    {
      key: 'command',
      label: 'Comando',
      type: 'select',
      required: true,
      options: [
        { value: 'play', label: 'Riprendi' },
        { value: 'pause', label: 'Pausa' },
        { value: 'playpause', label: 'Riproduci o metti in pausa' },
        { value: 'next', label: 'Brano successivo' },
        { value: 'previous', label: 'Brano precedente' },
        { value: 'volume', label: 'Volume' },
        { value: 'shuffle', label: 'Riproduzione casuale' },
        { value: 'repeat', label: 'Ripetizione' },
        { value: 'transfer', label: 'Sposta la riproduzione' },
        { value: 'play_uri', label: 'Riproduci un contesto' }
      ]
    },
    { key: 'value', label: 'Volume', type: 'number', help: 'Volume 0..100 (per "volume")', min: 0, max: 100, step: 1 },
    {
      key: 'mode',
      label: 'Ripetizione',
      type: 'select',
      help: 'Modalita\' di ripetizione (per "repeat")',
      options: [
        { value: 'off', label: 'Spenta' },
        { value: 'context', label: 'Contesto' },
        { value: 'track', label: 'Brano' }
      ]
    },
    { key: 'device', label: 'Dispositivo', type: 'text', help: 'Id del dispositivo (per "transfer")' },
    { key: 'uri', label: 'URI', type: 'text', help: 'URI Spotify (per "play_uri")', placeholder: 'spotify:playlist:...' }
  ],
  validate(params) {
    const spec = SPOTIFY_COMMANDS[params?.command];
    if (!spec) {
      throw new Error(`parametro "command" non valido: atteso uno fra ${Object.keys(SPOTIFY_COMMANDS).join(', ')}`);
    }
    if (spec.needs && params?.[spec.needs] === undefined) {
      throw new Error(`il comando "${params.command}" richiede il parametro "${spec.needs}"`);
    }
    if (params.command === 'volume') {
      const value = Number(params.value);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error('parametro "value" non valido: atteso numero fra 0 e 100');
      }
    }
  },
  // Il volume di Spotify e' un valore continuo: l'editor lo offre come cursore.
  control: 'slider',
  describe: (params) => `Spotify: ${SPOTIFY_COMMANDS[params?.command]?.label ?? params?.command}`,
  async run(params, ctx) {
    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `invierebbe a Spotify: ${SPOTIFY_COMMANDS[params.command].label}` };
    }
    const config = integrationConfig(ctx, 'spotify');
    const out = await runSpotifyCommand(config, params.command, params);
    return { ok: true, ...out };
  },

  /** Stato della riproduzione: in ascolto, volume, brano corrente. */
  async readState(params, ctx) {
    const config = integrationConfig(ctx, 'spotify');
    if (!config.clientId || !config.refreshToken) return null;

    const leggi = () => playerState(config);
    const state = ctx?.cached ? await ctx.cached('spotify:player', leggi) : await leggi();
    if (!state) return null;

    if (params?.command === 'volume') return { on: null, level: state.volume, text: null };
    if (params?.command === 'shuffle') return { on: state.shuffle, level: null, text: null };
    return {
      on: ['play', 'pause', 'playpause'].includes(params?.command) ? state.playing : null,
      level: null,
      text: state.track ? state.track.slice(0, 24) : null
    };
  }
};

// ------------------------------------------------------------------ Discord

/** Comandi che passano dal canale locale del client Discord. */
const DISCORD_VOICE = ['mute', 'unmute', 'toggle-mute', 'deafen', 'undeafen', 'toggle-deafen'];

export const discordAction = {
  type: 'discord',
  title: 'Discord',
  description: 'Manda un messaggio in un canale tramite webhook, oppure comanda microfono e cuffie del '
    + 'client Discord in esecuzione sul computer. Webhook e clientId vanno in '
    + 'settings.integrations.discord.',
  platforms: ['*'],
  category: 'streaming',
  paramsHelp: {
    command: `message | ${DISCORD_VOICE.join(' | ')}`,
    content: 'testo del messaggio (per "message", max 2000 caratteri)',
    username: 'nome mostrato al posto di quello del webhook (opzionale)'
  },
  fields: [
    {
      key: 'command',
      label: 'Comando',
      type: 'select',
      required: true,
      options: [
        { value: 'message', label: 'Manda messaggio' },
        { value: 'mute', label: 'Microfono muto' },
        { value: 'unmute', label: 'Microfono attivo' },
        { value: 'toggle-mute', label: 'Inverti microfono' },
        { value: 'deafen', label: 'Cuffie mute' },
        { value: 'undeafen', label: 'Cuffie attive' },
        { value: 'toggle-deafen', label: 'Inverti cuffie' }
      ]
    },
    { key: 'content', label: 'Messaggio', type: 'textarea', help: 'Testo del messaggio (per "message", max 2000 caratteri)' },
    { key: 'username', label: 'Nome mostrato', type: 'text', help: 'Nome mostrato al posto di quello del webhook (opzionale)' }
  ],
  validate(params) {
    const command = params?.command;
    if (command !== 'message' && !DISCORD_VOICE.includes(command)) {
      throw new Error(`parametro "command" non valido: atteso uno fra message, ${DISCORD_VOICE.join(', ')}`);
    }
    if (command === 'message') {
      if (typeof params.content !== 'string' || params.content.trim() === '') {
        throw new Error('il comando "message" richiede il parametro "content"');
      }
      if (params.content.length > 2000) throw new Error('parametro "content" troppo lungo (max 2000 caratteri)');
    }
  },
  describe(params) {
    if (params?.command === 'message') return `Discord: manda "${String(params.content ?? '').slice(0, 30)}"`;
    return `Discord: ${params?.command}`;
  },
  async run(params, ctx) {
    const config = integrationConfig(ctx, 'discord');

    if (params.command === 'message') {
      if (ctx.dryRun) return { ok: true, simulated: true, detail: 'manderebbe un messaggio su Discord' };
      const out = await sendWebhook(config, { content: params.content, username: params.username });
      return { ok: true, ...out };
    }

    if (ctx.dryRun) return { ok: true, simulated: true, detail: `imposterebbe la voce: ${params.command}` };

    const rpc = await connectDiscordRpc(config);
    try {
      const corrente = await rpc.command('GET_VOICE_SETTINGS');
      const patch = voiceSettingsFor(params.command, corrente);
      const applicato = await rpc.command('SET_VOICE_SETTINGS', patch);
      return {
        ok: true,
        detail: `Discord: microfono ${applicato.mute ? 'muto' : 'attivo'}, cuffie ${applicato.deaf ? 'mute' : 'attive'}`,
        muted: applicato.mute === true,
        deafened: applicato.deaf === true
      };
    } finally {
      rpc.close();
    }
  },

  /** Stato di microfono e cuffie, quando il comando riguarda la voce. */
  async readState(params, ctx) {
    if (!DISCORD_VOICE.includes(params?.command)) return null;
    const config = integrationConfig(ctx, 'discord');
    if (!config.clientId) return null;

    const leggi = async () => {
      const rpc = await connectDiscordRpc(config);
      try {
        return await rpc.command('GET_VOICE_SETTINGS');
      } finally {
        rpc.close();
      }
    };
    const settings = ctx?.cached ? await ctx.cached('discord:voice', leggi) : await leggi();

    const suCuffie = params.command.includes('deafen');
    const acceso = suCuffie ? settings.deaf === true : settings.mute === true;
    return { on: acceso, level: null, text: acceso ? (suCuffie ? 'sordo' : 'muto') : null };
  }
};

export default [mqttAction, spotifyAction, discordAction];
