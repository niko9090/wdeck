/**
 * Client MQTT 3.1.1 minimo, costruito su `net` e `tls`.
 *
 * MQTT e' il modo con cui parla mezza domotica: Home Assistant, Zigbee2MQTT,
 * Tasmota, ESPHome. Con un'azione `mqtt` un bottone del deck puo' accendere
 * qualunque cosa sia gia' collegata al broker di casa, senza passare da
 * un'integrazione dedicata per ogni marca.
 *
 * Il protocollo e' semplice quanto basta per stare in un file: un'intestazione
 * di due byte, una lunghezza a lunghezza variabile, e un corpo che dipende dal
 * tipo di pacchetto. Qui sono implementati CONNECT, PUBLISH, SUBSCRIBE,
 * PINGREQ e DISCONNECT, cioe' tutto cio' che serve a mandare un comando e a
 * leggere uno stato.
 *
 * La connessione e' breve per scelta: si apre, si fa cio' che serve, si chiude.
 * Tenere un socket permanente vorrebbe dire gestire riconnessioni, code e
 * sessioni persistenti per un guadagno che non si vede - i comandi di un deck
 * sono rari e isolati.
 */

import net from 'node:net';
import tls from 'node:tls';

/** Tipi di pacchetto MQTT (nibble alto del primo byte). */
export const PACKET = {
  connect: 1,
  connack: 2,
  publish: 3,
  puback: 4,
  subscribe: 8,
  suback: 9,
  pingreq: 12,
  pingresp: 13,
  disconnect: 14
};

/** Motivi di rifiuto restituiti da CONNACK. */
const CONNACK_REASONS = {
  0: 'connessione accettata',
  1: 'versione del protocollo non supportata dal broker',
  2: 'identificativo client rifiutato',
  3: 'broker non disponibile',
  4: 'nome utente o password errati',
  5: 'non autorizzato'
};

/**
 * Codifica un intero nella forma a lunghezza variabile di MQTT:
 * sette bit per byte, il bit alto segnala che il numero continua.
 * @param {number} value
 * @returns {Buffer}
 */
export function encodeVarInt(value) {
  if (value < 0 || value > 268435455) throw new Error(`lunghezza MQTT fuori intervallo: ${value}`);
  const bytes = [];
  let remaining = value;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

/**
 * Legge un intero a lunghezza variabile.
 * @param {Buffer} buffer
 * @param {number} offset
 * @returns {{value: number, offset: number}|null} null se i byte non bastano
 */
export function decodeVarInt(buffer, offset = 0) {
  let value = 0;
  let multiplier = 1;
  let cursor = offset;
  for (let i = 0; i < 4; i += 1) {
    if (cursor >= buffer.length) return null;
    const byte = buffer[cursor];
    cursor += 1;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return { value, offset: cursor };
    multiplier *= 128;
  }
  throw new Error('lunghezza MQTT malformata');
}

/** Stringa MQTT: due byte di lunghezza piu' i byte UTF-8. */
export function encodeString(text) {
  const bytes = Buffer.from(String(text ?? ''), 'utf8');
  const head = Buffer.alloc(2);
  head.writeUInt16BE(bytes.length, 0);
  return Buffer.concat([head, bytes]);
}

/** Assembla un pacchetto: tipo, flag, corpo. */
function packet(type, flags, body) {
  return Buffer.concat([Buffer.from([(type << 4) | flags]), encodeVarInt(body.length), body]);
}

/**
 * Pacchetto CONNECT.
 * @param {{clientId?: string, username?: string, password?: string, keepAlive?: number, clean?: boolean}} spec
 * @returns {Buffer}
 */
export function buildConnect({ clientId = 'wdeck', username, password, keepAlive = 30, clean = true } = {}) {
  let flags = clean ? 0x02 : 0x00;
  if (username) flags |= 0x80;
  if (password) flags |= 0x40;

  const head = Buffer.alloc(4);
  head.writeUInt8(flags, 0);
  head.writeUInt16BE(keepAlive, 1);

  const parts = [
    encodeString('MQTT'),
    Buffer.from([4]), // livello di protocollo 4 = MQTT 3.1.1
    head.subarray(0, 3),
    encodeString(clientId)
  ];
  if (username) parts.push(encodeString(username));
  if (password) parts.push(encodeString(password));
  return packet(PACKET.connect, 0, Buffer.concat(parts));
}

/**
 * Pacchetto PUBLISH.
 * @param {{topic: string, payload?: string|Buffer, qos?: number, retain?: boolean, packetId?: number}} spec
 * @returns {Buffer}
 */
export function buildPublish({ topic, payload = '', qos = 0, retain = false, packetId = 1 }) {
  if (typeof topic !== 'string' || topic === '') throw new Error('topic MQTT mancante');
  const body = [encodeString(topic)];
  if (qos > 0) {
    const id = Buffer.alloc(2);
    id.writeUInt16BE(packetId, 0);
    body.push(id);
  }
  body.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8'));
  return packet(PACKET.publish, (qos << 1) | (retain ? 1 : 0), Buffer.concat(body));
}

/**
 * Pacchetto SUBSCRIBE.
 * @param {{packetId?: number, topic: string, qos?: number}} spec
 * @returns {Buffer}
 */
export function buildSubscribe({ packetId = 1, topic, qos = 0 }) {
  const id = Buffer.alloc(2);
  id.writeUInt16BE(packetId, 0);
  // Il flag 0x02 e' obbligatorio sui pacchetti SUBSCRIBE.
  return packet(PACKET.subscribe, 0x02, Buffer.concat([id, encodeString(topic), Buffer.from([qos])]));
}

/** Pacchetto DISCONNECT. */
export const buildDisconnect = () => packet(PACKET.disconnect, 0, Buffer.alloc(0));

/** Pacchetto PINGREQ. */
export const buildPing = () => packet(PACKET.pingreq, 0, Buffer.alloc(0));

/**
 * Estrae i pacchetti completi da un buffer accumulato.
 * @param {Buffer} buffer
 * @returns {{packets: object[], rest: Buffer}}
 */
export function parsePackets(buffer) {
  const packets = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const first = buffer[cursor];
    const header = decodeVarInt(buffer, cursor + 1);
    if (!header) break;
    const total = header.offset + header.value;
    if (total > buffer.length) break;

    const type = first >> 4;
    const flags = first & 0x0f;
    const body = buffer.subarray(header.offset, total);
    const parsed = { type, flags };

    if (type === PACKET.connack) {
      parsed.sessionPresent = Boolean(body[0] & 1);
      parsed.returnCode = body[1];
    } else if (type === PACKET.publish) {
      const topicLength = body.readUInt16BE(0);
      parsed.topic = body.subarray(2, 2 + topicLength).toString('utf8');
      const qos = (flags >> 1) & 0x03;
      let offset = 2 + topicLength;
      if (qos > 0) {
        parsed.packetId = body.readUInt16BE(offset);
        offset += 2;
      }
      parsed.qos = qos;
      parsed.retain = Boolean(flags & 1);
      parsed.payload = body.subarray(offset);
    } else if (type === PACKET.puback || type === PACKET.suback) {
      parsed.packetId = body.readUInt16BE(0);
      if (type === PACKET.suback) parsed.granted = body[2];
    }

    packets.push(parsed);
    cursor = total;
  }

  return { packets, rest: buffer.subarray(cursor) };
}

/**
 * Apre una connessione a un broker MQTT.
 * @param {{
 *   url?: string,
 *   host?: string,
 *   port?: number,
 *   tls?: boolean,
 *   username?: string,
 *   password?: string,
 *   clientId?: string,
 *   timeoutMs?: number,
 *   rejectUnauthorized?: boolean
 * }} config
 * @returns {Promise<object>} connessione con publish(), subscribeOnce(), close()
 */
export function connectMqtt(config = {}) {
  const target = resolveTarget(config);
  const timeoutMs = config.timeoutMs ?? 6000;

  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const waiters = [];
    let closed = false;
    let nextPacketId = 1;

    const socket = target.tls
      ? tls.connect({
        host: target.host,
        port: target.port,
        rejectUnauthorized: config.rejectUnauthorized !== false,
        servername: target.host
      })
      : net.connect({ host: target.host, port: target.port });

    const fail = (err) => {
      if (closed) return;
      closed = true;
      for (const waiter of waiters.splice(0)) waiter.reject(err);
      socket.destroy();
      reject(err);
    };

    const timer = setTimeout(() => fail(new Error(`broker MQTT non raggiungibile: timeout su ${target.host}:${target.port}`)), timeoutMs);

    socket.on('error', (err) => {
      clearTimeout(timer);
      fail(new Error(`broker MQTT ${target.host}:${target.port}: ${err.message}`));
    });

    socket.on('close', () => {
      const err = new Error('connessione MQTT chiusa dal broker');
      for (const waiter of waiters.splice(0)) waiter.reject(err);
      closed = true;
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let parsed;
      try {
        parsed = parsePackets(buffer);
      } catch (err) {
        fail(err);
        return;
      }
      buffer = parsed.rest;
      for (const message of parsed.packets) {
        for (let i = waiters.length - 1; i >= 0; i -= 1) {
          if (waiters[i].match(message)) {
            waiters.splice(i, 1)[0].resolve(message);
          }
        }
      }
    });

    /** Attende il primo pacchetto che soddisfa il predicato. */
    const waitFor = (match, { label = 'risposta del broker', ms = timeoutMs } = {}) => new Promise((res, rej) => {
      const waiter = { match, resolve: res, reject: rej };
      waiters.push(waiter);
      const t = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index !== -1) waiters.splice(index, 1);
        rej(new Error(`MQTT: nessuna ${label} entro ${ms} ms`));
      }, ms);
      if (typeof t.unref === 'function') t.unref();
    });

    const onConnected = async () => {
      // L'attesa va registrata **prima** di scrivere: un broker sulla stessa
      // macchina puo' rispondere nello stesso giro di eventi, e una risposta
      // arrivata prima del suo ascoltatore andrebbe persa per sempre.
      const attesaConnack = waitFor((m) => m.type === PACKET.connack, { label: 'conferma di connessione' });
      socket.write(buildConnect({
        clientId: config.clientId ?? `wdeck-${Math.random().toString(36).slice(2, 10)}`,
        username: config.username,
        password: config.password
      }));

      try {
        const connack = await attesaConnack;
        if (connack.returnCode !== 0) {
          throw new Error(`broker MQTT ha rifiutato la connessione: ${CONNACK_REASONS[connack.returnCode] ?? `codice ${connack.returnCode}`}`);
        }
      } catch (err) {
        clearTimeout(timer);
        fail(err);
        return;
      }

      clearTimeout(timer);
      resolve({
        host: target.host,
        port: target.port,

        /**
         * Pubblica un messaggio.
         * Con QoS 1 si attende la conferma: e' l'unico modo per sapere che il
         * broker lo ha davvero preso in carico.
         */
        async publish({ topic, payload, qos = 0, retain = false }) {
          const packetId = nextPacketId;
          nextPacketId = (nextPacketId % 65535) + 1;
          const attesa = qos > 0
            ? waitFor((m) => m.type === PACKET.puback && m.packetId === packetId, { label: 'conferma di pubblicazione' })
            : null;
          socket.write(buildPublish({ topic, payload, qos, retain, packetId }));
          if (attesa) await attesa;
          return { topic, qos, retain };
        },

        /**
         * Si iscrive a un topic e attende il primo messaggio.
         * Serve a leggere lo stato: sui broker di domotica i messaggi di stato
         * sono quasi sempre "retained", quindi arrivano subito.
         */
        async subscribeOnce(topic, { ms = timeoutMs } = {}) {
          const packetId = nextPacketId;
          nextPacketId = (nextPacketId % 65535) + 1;

          // Entrambe le attese vanno predisposte prima di iscriversi: un
          // messaggio "retained" arriva subito dopo la conferma, spesso nello
          // stesso pacchetto TCP, e chi lo aspettasse dopo lo perderebbe.
          const attesaConferma = waitFor((m) => m.type === PACKET.suback && m.packetId === packetId, { label: 'conferma di iscrizione' });
          const attesaMessaggio = waitFor((m) => m.type === PACKET.publish && topicMatches(topic, m.topic), {
            label: `messaggio su "${topic}"`,
            ms
          });
          socket.write(buildSubscribe({ packetId, topic }));

          const suback = await attesaConferma;
          if (suback.granted > 2) throw new Error(`il broker ha rifiutato l'iscrizione a "${topic}"`);

          const message = await attesaMessaggio;
          return { topic: message.topic, payload: message.payload.toString('utf8'), retain: message.retain };
        },

        close() {
          if (closed) return;
          closed = true;
          try {
            socket.write(buildDisconnect());
          } catch { /* il socket puo' essere gia' caduto */ }
          socket.end();
        }
      });
    };

    socket.on(target.tls ? 'secureConnect' : 'connect', onConnected);
  });
}

/**
 * Ricava host, porta e cifratura dalla configurazione.
 * @param {object} config
 * @returns {{host: string, port: number, tls: boolean}}
 */
export function resolveTarget(config = {}) {
  if (config.url) {
    const url = new URL(config.url);
    const secure = url.protocol === 'mqtts:' || url.protocol === 'ssl:' || url.protocol === 'tls:';
    return {
      host: url.hostname,
      port: Number(url.port) || (secure ? 8883 : 1883),
      tls: secure
    };
  }
  const secure = config.tls === true;
  return {
    host: config.host ?? '127.0.0.1',
    port: Number(config.port) || (secure ? 8883 : 1883),
    tls: secure
  };
}

/**
 * Confronta un filtro di iscrizione con un topic ricevuto.
 * `+` sostituisce un livello, `#` tutti quelli che restano.
 * @param {string} filter
 * @param {string} topic
 * @returns {boolean}
 */
export function topicMatches(filter, topic) {
  const f = String(filter).split('/');
  const t = String(topic).split('/');
  for (let i = 0; i < f.length; i += 1) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}
