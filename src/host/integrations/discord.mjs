/**
 * Integrazione con Discord.
 *
 * Due strade, con confini diversi che vale la pena conoscere prima di sceglierne
 * una:
 *
 *  - **webhook**: manda un messaggio in un canale. Funziona subito, serve solo
 *    l'URL del webhook che si crea dalle impostazioni del canale, e non
 *    richiede alcuna autorizzazione dell'utente.
 *  - **rpc**: parla con il client Discord in esecuzione sullo stesso computer,
 *    attraverso una named pipe (Windows) o un socket unix (macOS e Linux). Da
 *    li' si comandano microfono, cuffie e impostazioni voce - cioe' cio' che
 *    serve davvero durante una chiamata. **Richiede un'applicazione registrata
 *    su Discord e, per i comandi sulla voce, uno scope che Discord concede su
 *    richiesta**: senza, il client risponde con un errore esplicito che viene
 *    riportato tale e quale.
 *
 * Il trasporto RPC e' semplice: quattro byte di codice operativo, quattro di
 * lunghezza, entrambi little-endian, poi il JSON.
 */

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/** Codici operativi del trasporto RPC. */
export const RPC_OP = { handshake: 0, frame: 1, close: 2, ping: 3, pong: 4 };

/**
 * Percorsi dove Discord mette il proprio socket, in ordine di tentativo.
 * Ne apre uno per istanza in esecuzione, numerato da 0 a 9.
 * @param {{platform?: string, env?: object}} [options]
 * @returns {string[]}
 */
export function ipcPaths({ platform = process.platform, env = process.env } = {}) {
  const paths = [];
  if (platform === 'win32') {
    for (let i = 0; i < 10; i += 1) paths.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    return paths;
  }

  // Su macOS e Linux la cartella dipende dall'ambiente, e con Flatpak o Snap
  // il socket finisce in una sottocartella dedicata.
  const bases = [env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, '/tmp']
    .filter(Boolean)
    .flatMap((base) => [base, path.join(base, 'app', 'com.discordapp.Discord'), path.join(base, 'snap.discord')]);

  for (const base of bases) {
    for (let i = 0; i < 10; i += 1) paths.push(path.join(base, `discord-ipc-${i}`));
  }
  return paths;
}

/**
 * Costruisce un frame del trasporto RPC.
 * @param {number} op
 * @param {object} payload
 * @returns {Buffer}
 */
export function encodeFrame(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/**
 * Estrae i frame completi da un buffer accumulato.
 * @param {Buffer} buffer
 * @returns {{frames: Array<{op: number, data: object}>, rest: Buffer}}
 */
export function decodeFrames(buffer) {
  const frames = [];
  let cursor = 0;
  while (buffer.length - cursor >= 8) {
    const op = buffer.readInt32LE(cursor);
    const length = buffer.readInt32LE(cursor + 4);
    if (length < 0 || buffer.length - cursor - 8 < length) break;
    const raw = buffer.subarray(cursor + 8, cursor + 8 + length).toString('utf8');
    cursor += 8 + length;
    try {
      frames.push({ op, data: JSON.parse(raw) });
    } catch {
      // Un frame illeggibile non deve fermare quelli che seguono.
    }
  }
  return { frames, rest: buffer.subarray(cursor) };
}

/**
 * Apre la connessione al client Discord locale.
 * @param {{clientId: string, accessToken?: string, timeoutMs?: number}} config
 * @param {{paths?: string[]}} [deps]
 * @returns {Promise<object>}
 */
export async function connectDiscordRpc(config, { paths = ipcPaths() } = {}) {
  if (!config?.clientId) {
    throw new Error('Discord RPC non configurato: manca settings.integrations.discord.clientId');
  }
  const timeoutMs = config.timeoutMs ?? 5000;

  const socket = await firstReachable(paths);
  if (!socket) {
    throw new Error('Discord non in esecuzione su questo computer, oppure il suo canale locale non e\' raggiungibile');
  }

  let buffer = Buffer.alloc(0);
  const waiters = [];
  let closed = false;

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const parsed = decodeFrames(buffer);
    buffer = parsed.rest;
    for (const frame of parsed.frames) {
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        if (waiters[i].match(frame)) waiters.splice(i, 1)[0].resolve(frame);
      }
    }
  });
  socket.on('close', () => {
    closed = true;
    const err = new Error('Discord ha chiuso la connessione');
    for (const waiter of waiters.splice(0)) waiter.reject(err);
  });

  const waitFor = (match, label) => new Promise((resolve, reject) => {
    const waiter = { match, resolve, reject };
    waiters.push(waiter);
    const timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index !== -1) waiters.splice(index, 1);
      reject(new Error(`Discord: nessuna risposta a ${label} entro ${timeoutMs} ms`));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });

  socket.write(encodeFrame(RPC_OP.handshake, { v: 1, client_id: String(config.clientId) }));
  const ready = await waitFor((f) => f.data?.evt === 'READY' || f.data?.evt === 'ERROR', 'handshake');
  if (ready.data.evt === 'ERROR') {
    socket.destroy();
    throw new Error(`Discord ha rifiutato la connessione: ${ready.data.data?.message ?? 'motivo non indicato'}`);
  }

  let seq = 0;
  const api = {
    user: ready.data.data?.user?.username ?? null,

    /**
     * Invia un comando e attende la risposta corrispondente.
     * @param {string} cmd
     * @param {object} [args]
     */
    async command(cmd, args = {}) {
      if (closed) throw new Error('connessione Discord gia\' chiusa');
      seq += 1;
      const nonce = `wdeck-${seq}`;
      socket.write(encodeFrame(RPC_OP.frame, { cmd, args, nonce }));
      const frame = await waitFor((f) => f.data?.nonce === nonce, cmd);
      if (frame.data.evt === 'ERROR') {
        const message = frame.data.data?.message ?? 'comando rifiutato';
        // Il caso piu' frequente merita una spiegazione, non un codice.
        throw new Error(frame.data.data?.code === 4006
          ? `Discord: l'applicazione non ha il permesso per "${cmd}". `
            + 'I comandi sulla voce richiedono uno scope che Discord concede su richiesta.'
          : `Discord: ${message}`);
      }
      return frame.data.data ?? {};
    },

    close() {
      if (closed) return;
      closed = true;
      socket.destroy();
    }
  };

  // L'autenticazione serve alla maggior parte dei comandi; senza token si prova
  // lo stesso, cosi' chi ha solo bisogno di leggere non deve configurarla.
  if (config.accessToken) {
    await api.command('AUTHENTICATE', { access_token: config.accessToken });
  }
  return api;
}

/** Primo socket che accetta la connessione fra quelli indicati. */
function firstReachable(paths) {
  return new Promise((resolve) => {
    let index = 0;
    const tryNext = () => {
      if (index >= paths.length) {
        resolve(null);
        return;
      }
      const target = paths[index];
      index += 1;
      const socket = net.connect(target);
      socket.once('connect', () => resolve(socket));
      socket.once('error', () => {
        socket.destroy();
        tryNext();
      });
    };
    tryNext();
  });
}

/**
 * Manda un messaggio in un canale tramite webhook.
 * @param {{url: string}} config
 * @param {{content: string, username?: string}} message
 * @param {{fetchImpl?: Function}} [deps]
 */
export async function sendWebhook(config, { content, username }, { fetchImpl = fetch } = {}) {
  if (!config?.url) {
    throw new Error('Discord non configurato: manca settings.integrations.discord.url (URL del webhook)');
  }
  if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(config.url)) {
    throw new Error('l\'URL configurato non e\' un webhook di Discord');
  }

  const response = await fetchImpl(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: String(content).slice(0, 2000), ...(username ? { username } : {}) }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    throw new Error(`Discord ha risposto ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return { detail: 'messaggio inviato su Discord' };
}

/**
 * Traduce le impostazioni voce nella forma attesa dal comando RPC.
 * Funzione pura, cosi' da poter essere verificata senza Discord aperto.
 * @param {string} command `mute`, `unmute`, `toggle-mute`, `deafen`, ...
 * @param {{mute?: boolean, deaf?: boolean}} corrente
 * @returns {{mute?: boolean, deaf?: boolean}}
 */
export function voiceSettingsFor(command, corrente = {}) {
  switch (command) {
    case 'mute': return { mute: true };
    case 'unmute': return { mute: false };
    case 'toggle-mute': return { mute: !corrente.mute };
    case 'deafen': return { deaf: true };
    case 'undeafen': return { deaf: false };
    case 'toggle-deafen': return { deaf: !corrente.deaf };
    default: throw new Error(`comando voce sconosciuto: "${command}"`);
  }
}
