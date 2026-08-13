/**
 * Integrazioni MQTT, Spotify e Discord.
 *
 * Le tre parlano con servizi che qui non ci sono, quindi si prova cio' che si
 * puo' provare davvero:
 *
 *  - **MQTT**: i pacchetti sono costruiti byte per byte, e un broker finto
 *    scritto su un socket TCP permette un giro completo di connessione,
 *    pubblicazione e lettura di stato. E' il protocollo, non un finto.
 *  - **Spotify**: il trasporto e' HTTP, quindi si sostituisce `fetch` e si
 *    verifica quali chiamate vengono fatte e come viene gestito il token.
 *  - **Discord**: il trasporto RPC e' un formato binario, verificabile da solo;
 *    la scelta dei percorsi e la logica delle impostazioni voce sono funzioni
 *    pure.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';

import {
  PACKET,
  buildConnect,
  buildPublish,
  buildSubscribe,
  connectMqtt,
  decodeVarInt,
  encodeVarInt,
  parsePackets,
  resolveTarget,
  topicMatches
} from '../src/host/integrations/mqtt.mjs';
import {
  SPOTIFY_COMMANDS,
  accessToken,
  forgetTokens,
  playerState,
  runSpotifyCommand
} from '../src/host/integrations/spotify.mjs';
import { decodeFrames, encodeFrame, ipcPaths, voiceSettingsFor } from '../src/host/integrations/discord.mjs';
import { createDefaultRegistry } from '../src/host/actions/handlers/index.mjs';
import { makeDispatcher } from '../tools/fixtures.mjs';

// ------------------------------------------------------------------ MQTT: pacchetti

test('mqtt: la lunghezza variabile segue la codifica del protocollo', () => {
  assert.deepEqual([...encodeVarInt(0)], [0x00]);
  assert.deepEqual([...encodeVarInt(127)], [0x7f]);
  assert.deepEqual([...encodeVarInt(128)], [0x80, 0x01]);
  assert.deepEqual([...encodeVarInt(16383)], [0xff, 0x7f]);
  assert.deepEqual([...encodeVarInt(16384)], [0x80, 0x80, 0x01]);
  assert.throws(() => encodeVarInt(268435456), /fuori intervallo/);
});

test('mqtt: la lunghezza variabile si rilegge uguale', () => {
  for (const value of [0, 1, 127, 128, 300, 16383, 16384, 2097151]) {
    assert.equal(decodeVarInt(encodeVarInt(value)).value, value, `valore ${value}`);
  }
  assert.equal(decodeVarInt(Buffer.from([0x80])), null, 'byte insufficienti');
});

test('mqtt: CONNECT dichiara protocollo, versione e credenziali', () => {
  const packet = buildConnect({ clientId: 'wdeck', username: 'utente', password: 'segreto' });
  assert.equal(packet[0] >> 4, PACKET.connect);
  assert.equal(packet.subarray(4, 8).toString(), 'MQTT');
  assert.equal(packet[8], 4, 'MQTT 3.1.1');
  // Flag: nome utente (0x80), password (0x40), sessione pulita (0x02).
  assert.equal(packet[9], 0xc2);
  assert.ok(packet.includes(Buffer.from('utente')));
});

test('mqtt: CONNECT senza credenziali non le dichiara', () => {
  const packet = buildConnect({ clientId: 'wdeck' });
  assert.equal(packet[9], 0x02);
});

test('mqtt: PUBLISH porta topic, QoS e ritenzione nei bit giusti', () => {
  const semplice = buildPublish({ topic: 'casa/luce', payload: 'ON' });
  assert.equal(semplice[0], (PACKET.publish << 4) | 0);
  assert.ok(semplice.includes(Buffer.from('casa/luce')));
  assert.ok(semplice.includes(Buffer.from('ON')));

  const conQos = buildPublish({ topic: 'x', payload: 'y', qos: 1, retain: true, packetId: 7 });
  assert.equal(conQos[0] & 0x0f, 0b0011, 'QoS 1 piu' + ' ritenzione');
});

test('mqtt: SUBSCRIBE ha il flag obbligatorio 0x02', () => {
  const packet = buildSubscribe({ packetId: 3, topic: 'casa/#' });
  assert.equal(packet[0], (PACKET.subscribe << 4) | 0x02);
});

test('mqtt: il topic non puo\' mancare', () => {
  assert.throws(() => buildPublish({ topic: '' }), /topic MQTT mancante/);
});

test('mqtt: i pacchetti si estraggono anche se arrivano spezzati', () => {
  const uno = buildPublish({ topic: 'a', payload: '1' });
  const due = buildPublish({ topic: 'b', payload: '2' });
  const insieme = Buffer.concat([uno, due]);

  // Un pacchetto incompleto resta nel resto, in attesa del resto dei byte.
  const parziale = parsePackets(insieme.subarray(0, uno.length + 2));
  assert.equal(parziale.packets.length, 1);
  assert.equal(parziale.packets[0].topic, 'a');
  assert.equal(parziale.rest.length, 2);

  const completo = parsePackets(insieme);
  assert.deepEqual(completo.packets.map((p) => p.topic), ['a', 'b']);
  assert.equal(completo.rest.length, 0);
});

test('mqtt: il broker si ricava da URL oppure da host e porta', () => {
  assert.deepEqual(resolveTarget({ url: 'mqtt://broker.local' }), { host: 'broker.local', port: 1883, tls: false });
  assert.deepEqual(resolveTarget({ url: 'mqtts://broker.local' }), { host: 'broker.local', port: 8883, tls: true });
  assert.deepEqual(resolveTarget({ url: 'mqtt://broker.local:1884' }), { host: 'broker.local', port: 1884, tls: false });
  assert.deepEqual(resolveTarget({ host: '10.0.0.5' }), { host: '10.0.0.5', port: 1883, tls: false });
  assert.deepEqual(resolveTarget({}), { host: '127.0.0.1', port: 1883, tls: false });
});

test('mqtt: i caratteri jolly dei filtri funzionano come nel protocollo', () => {
  assert.equal(topicMatches('casa/+/luce', 'casa/salotto/luce'), true);
  assert.equal(topicMatches('casa/+/luce', 'casa/salotto/cucina/luce'), false);
  assert.equal(topicMatches('casa/#', 'casa/salotto/luce'), true);
  assert.equal(topicMatches('casa/#', 'giardino/luce'), false);
  assert.equal(topicMatches('casa/luce', 'casa/luce'), true);
  assert.equal(topicMatches('casa/luce', 'casa/luce/stato'), false);
});

// ------------------------------------------------------------------ MQTT: giro completo

/**
 * Broker finto: parla il protocollo vero su un socket TCP.
 * Accetta la connessione, conferma le iscrizioni e rimanda un messaggio.
 */
function fakeBroker({ stateValue = 'ON' } = {}) {
  const ricevuti = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const { packets, rest } = parsePackets(buffer);
      buffer = rest;
      for (const packet of packets) {
        ricevuti.push(packet);
        if (packet.type === PACKET.connect) {
          socket.write(Buffer.from([PACKET.connack << 4, 2, 0, 0]));
        } else if (packet.type === PACKET.subscribe) {
          const id = Buffer.alloc(2);
          // L'identificativo sta subito dopo l'intestazione di due byte.
          id.writeUInt16BE(1, 0);
          socket.write(Buffer.concat([Buffer.from([PACKET.suback << 4, 3]), id, Buffer.from([0])]));
          socket.write(buildPublish({ topic: 'casa/luce/stato', payload: stateValue }));
        }
      }
    });
  });
  return {
    ricevuti,
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    // I socket ancora aperti terrebbero vivo il server, e con lui il processo
    // dei test: vanno chiusi a mano.
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(resolve);
    })
  };
}

/** Attende che una condizione diventi vera, senza bloccare all'infinito. */
async function attendi(condizione, { ms = 3000, cosa = 'la condizione attesa' } = {}) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (condizione()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timeout: ${cosa} non si e' verificata entro ${ms} ms`);
}

test('mqtt: connessione e pubblicazione contro un broker che parla il protocollo', async (t) => {
  const broker = fakeBroker();
  const port = await broker.listen();
  t.after(() => broker.close());

  const client = await connectMqtt({ host: '127.0.0.1', port, clientId: 'wdeck-test' });
  await client.publish({ topic: 'casa/luce/set', payload: 'ON' });

  // Con QoS 0 il broker non conferma nulla: la pubblicazione e' partita, ma
  // puo' non essere ancora arrivata quando la riga dopo la cerca.
  await attendi(() => broker.ricevuti.some((p) => p.type === PACKET.publish), { cosa: 'la pubblicazione' });
  client.close();

  const connect = broker.ricevuti.find((p) => p.type === PACKET.connect);
  const publish = broker.ricevuti.find((p) => p.type === PACKET.publish);
  assert.ok(connect, 'il broker deve ricevere un CONNECT');
  assert.equal(publish.topic, 'casa/luce/set');
  assert.equal(publish.payload.toString(), 'ON');
});

test('mqtt: la lettura dello stato si iscrive e attende il messaggio', async (t) => {
  const broker = fakeBroker({ stateValue: 'ON' });
  const port = await broker.listen();
  t.after(() => broker.close());

  const client = await connectMqtt({ host: '127.0.0.1', port });
  const message = await client.subscribeOnce('casa/luce/stato');
  client.close();

  assert.equal(message.topic, 'casa/luce/stato');
  assert.equal(message.payload, 'ON');
});

test('mqtt: un broker che rifiuta la connessione produce un messaggio spiegato', async (t) => {
  const server = net.createServer((socket) => {
    socket.on('data', () => socket.write(Buffer.from([PACKET.connack << 4, 2, 0, 4])));
  });
  const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  t.after(() => new Promise((r) => server.close(r)));

  await assert.rejects(
    () => connectMqtt({ host: '127.0.0.1', port }),
    /nome utente o password errati/
  );
});

test('mqtt: un broker irraggiungibile non blocca l\'host', async () => {
  await assert.rejects(
    () => connectMqtt({ host: '127.0.0.1', port: 1, timeoutMs: 1500 }),
    /broker MQTT/
  );
});

// ------------------------------------------------------------------ Spotify

const spotifyConfig = { clientId: 'id-1', clientSecret: 'segreto', refreshToken: 'refresh-1' };

/** `fetch` finto che registra le chiamate e risponde a comando. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET', body: options.body });
    for (const [pattern, response] of routes) {
      if (String(url).includes(pattern)) {
        const value = typeof response === 'function' ? response() : response;
        return {
          ok: value.status === undefined || value.status < 400,
          status: value.status ?? 200,
          json: async () => value.json ?? {},
          text: async () => (value.text !== undefined ? value.text : JSON.stringify(value.json ?? {}))
        };
      }
    }
    throw new Error(`chiamata non prevista dal test: ${url}`);
  };
  return { impl, calls };
}

test('spotify: il token viene rinnovato dal refresh token e riusato finche\' vale', async () => {
  forgetTokens();
  const { impl, calls } = fakeFetch([['accounts.spotify.com', { json: { access_token: 'abc', expires_in: 3600 } }]]);

  assert.equal(await accessToken(spotifyConfig, { fetchImpl: impl }), 'abc');
  assert.equal(await accessToken(spotifyConfig, { fetchImpl: impl }), 'abc');
  assert.equal(calls.length, 1, 'il secondo accesso usa il token in cache');
});

test('spotify: un token scaduto viene rinnovato', async () => {
  forgetTokens();
  let contatore = 0;
  const { impl } = fakeFetch([['accounts.spotify.com', () => ({ json: { access_token: `t${++contatore}`, expires_in: 3600 } })]]);

  let ora = 1_000_000;
  assert.equal(await accessToken(spotifyConfig, { fetchImpl: impl, now: () => ora }), 't1');
  ora += 3600_000;
  assert.equal(await accessToken(spotifyConfig, { fetchImpl: impl, now: () => ora }), 't2');
});

test('spotify: senza configurazione l\'errore dice cosa manca', async () => {
  forgetTokens();
  await assert.rejects(() => accessToken({ clientId: 'x' }), /manca settings\.integrations\.spotify\.clientSecret/);
  await assert.rejects(() => accessToken({}), /clientId/);
});

test('spotify: playerState riduce la risposta ai campi che servono', async () => {
  forgetTokens();
  const { impl } = fakeFetch([
    ['accounts.spotify.com', { json: { access_token: 'abc', expires_in: 3600 } }],
    ['/me/player', {
      json: {
        is_playing: true,
        shuffle_state: false,
        repeat_state: 'context',
        device: { name: 'Salotto', volume_percent: 42 },
        item: { name: 'Brano', artists: [{ name: 'Tizio' }, { name: 'Caio' }] }
      }
    }]
  ]);

  const state = await playerState(spotifyConfig, { fetchImpl: impl });
  assert.deepEqual(state, {
    playing: true, volume: 42, shuffle: false, repeat: 'context',
    device: 'Salotto', track: 'Brano', artist: 'Tizio, Caio'
  });
});

test('spotify: playpause guarda lo stato prima di decidere', async () => {
  forgetTokens();
  const { impl, calls } = fakeFetch([
    ['accounts.spotify.com', { json: { access_token: 'abc', expires_in: 3600 } }],
    ['/me/player/pause', { status: 204 }],
    ['/me/player', { json: { is_playing: true, device: {}, item: null } }]
  ]);

  const out = await runSpotifyCommand(spotifyConfig, 'playpause', {}, { fetchImpl: impl });
  assert.match(out.detail, /in pausa/);
  assert.ok(calls.some((c) => c.url.includes('/me/player/pause') && c.method === 'PUT'));
});

test('spotify: il volume viaggia come parametro di query', async () => {
  forgetTokens();
  const { impl, calls } = fakeFetch([
    ['accounts.spotify.com', { json: { access_token: 'abc', expires_in: 3600 } }],
    ['/me/player/volume', { status: 204 }]
  ]);

  await runSpotifyCommand(spotifyConfig, 'volume', { value: 35 }, { fetchImpl: impl });
  assert.ok(calls.some((c) => c.url.includes('volume_percent=35')), calls.map((c) => c.url).join(' '));
});

test('spotify: "nessun dispositivo attivo" e\' spiegato, non un 404', async () => {
  forgetTokens();
  const { impl } = fakeFetch([
    ['accounts.spotify.com', { json: { access_token: 'abc', expires_in: 3600 } }],
    ['/me/player/next', { status: 404 }]
  ]);

  await assert.rejects(
    () => runSpotifyCommand(spotifyConfig, 'next', {}, { fetchImpl: impl }),
    /nessun dispositivo attivo/
  );
});

test('spotify: un comando sconosciuto viene rifiutato', async () => {
  await assert.rejects(() => runSpotifyCommand(spotifyConfig, 'rewind'), /comando Spotify sconosciuto/);
});

// ------------------------------------------------------------------ Discord

test('discord: i frame RPC hanno intestazione little-endian e corpo JSON', () => {
  const frame = encodeFrame(0, { v: 1, client_id: '123' });
  assert.equal(frame.readInt32LE(0), 0);
  assert.equal(frame.readInt32LE(4), frame.length - 8);
  assert.deepEqual(JSON.parse(frame.subarray(8).toString()), { v: 1, client_id: '123' });
});

test('discord: i frame si estraggono anche se arrivano spezzati', () => {
  const insieme = Buffer.concat([encodeFrame(1, { a: 1 }), encodeFrame(1, { b: 2 })]);

  const parziale = decodeFrames(insieme.subarray(0, insieme.length - 3));
  assert.equal(parziale.frames.length, 1);
  assert.deepEqual(parziale.frames[0].data, { a: 1 });

  const completo = decodeFrames(insieme);
  assert.deepEqual(completo.frames.map((f) => f.data), [{ a: 1 }, { b: 2 }]);
  assert.equal(completo.rest.length, 0);
});

test('discord: un frame illeggibile non ferma quelli che seguono', () => {
  const rotto = Buffer.concat([Buffer.alloc(8), Buffer.from('{non json')]);
  rotto.writeInt32LE(1, 0);
  rotto.writeInt32LE(9, 4);
  const { frames } = decodeFrames(Buffer.concat([rotto, encodeFrame(1, { ok: true })]));
  assert.deepEqual(frames.map((f) => f.data), [{ ok: true }]);
});

test('discord: i percorsi del canale locale dipendono dal sistema', () => {
  const windows = ipcPaths({ platform: 'win32' });
  assert.equal(windows.length, 10);
  assert.ok(windows[0].includes('discord-ipc-0'));

  const linux = ipcPaths({ platform: 'linux', env: { XDG_RUNTIME_DIR: '/run/user/1000' } });
  // path.join usa il separatore del sistema su cui gira il test, non quello
  // del sistema simulato: il confronto deve tenerne conto.
  assert.ok(linux.includes(path.join('/run/user/1000', 'discord-ipc-0')));
  // Con Flatpak o Snap il socket finisce in una sottocartella dedicata.
  assert.ok(linux.some((p) => p.includes('com.discordapp.Discord')));
  assert.ok(linux.some((p) => p.includes('snap.discord')));
});

test('discord: le impostazioni voce si ricavano dal comando e dallo stato', () => {
  assert.deepEqual(voiceSettingsFor('mute'), { mute: true });
  assert.deepEqual(voiceSettingsFor('unmute'), { mute: false });
  assert.deepEqual(voiceSettingsFor('toggle-mute', { mute: false }), { mute: true });
  assert.deepEqual(voiceSettingsFor('toggle-mute', { mute: true }), { mute: false });
  assert.deepEqual(voiceSettingsFor('toggle-deafen', { deaf: false }), { deaf: true });
  assert.throws(() => voiceSettingsFor('spegni-tutto'), /comando voce sconosciuto/);
});

// ------------------------------------------------------------------ azioni

test('azioni: mqtt, spotify e discord sono registrate e descritte', () => {
  const registry = createDefaultRegistry();
  for (const type of ['mqtt', 'spotify', 'discord']) {
    const handler = registry.get(type);
    assert.ok(handler.title.length > 0, `${type}: manca il titolo`);
    assert.ok(handler.description.length > 0, `${type}: manca la descrizione`);
    assert.equal(handler.stub, undefined, `${type} non deve essere un segnaposto`);
    assert.equal(typeof handler.readState, 'function', `${type}: deve saper leggere il proprio stato`);
  }
});

test('azioni: i parametri sbagliati sono rifiutati prima di toccare la rete', () => {
  const registry = createDefaultRegistry();
  assert.throws(() => registry.get('mqtt').validate({}), /"topic" mancante/);
  assert.throws(() => registry.get('mqtt').validate({ topic: 'casa/#' }), /caratteri jolly/);
  assert.throws(() => registry.get('mqtt').validate({ topic: 'a', qos: 5 }), /"qos" non valido/);
  assert.throws(() => registry.get('spotify').validate({ command: 'balla' }), /"command" non valido/);
  assert.throws(() => registry.get('spotify').validate({ command: 'volume' }), /richiede il parametro "value"/);
  assert.throws(() => registry.get('spotify').validate({ command: 'volume', value: 300 }), /fra 0 e 100/);
  assert.throws(() => registry.get('discord').validate({ command: 'message' }), /richiede il parametro "content"/);
  assert.throws(() => registry.get('discord').validate({ command: 'balla' }), /"command" non valido/);
});

test('azioni: in dry-run non viene contattato nessun servizio', async () => {
  const { dispatcher } = makeDispatcher();
  for (const [type, params] of [
    ['mqtt', { topic: 'casa/luce/set', payload: 'ON' }],
    ['spotify', { command: 'playpause' }],
    ['discord', { command: 'message', content: 'ciao' }]
  ]) {
    const result = await dispatcher.execute({ type, params }, { dryRun: true });
    assert.equal(result.ok, true, `${type}: ${result.error?.message}`);
    assert.equal(result.result.simulated, true);
  }
});
