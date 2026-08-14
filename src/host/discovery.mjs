/**
 * Scoperta dell'host in rete locale (mDNS / Bonjour), senza dipendenze.
 *
 * Risolve un problema concreto: l'indirizzo dell'host cambia quando cambia
 * l'assegnazione DHCP, e un indirizzo numerico non si ricorda. Annunciando
 * `wdeck.local` si ottiene un indirizzo stabile che macOS, iOS, Windows 10+ e
 * Android recente sanno risolvere da soli, senza installare nulla.
 *
 * Vengono annunciati:
 *  - un record **A** per `<nome>.local`, che e' cio' che serve per digitare
 *    `http://wdeck.local:8899` nel browser;
 *  - il servizio **`_wdeck._tcp.local`** con PTR, SRV e TXT, che e' cio' che
 *    serve a un programma per trovare l'host senza sapere il nome.
 *
 * Il protocollo e' DNS su multicast: stessa struttura dei messaggi, indirizzo
 * 224.0.0.251:5353. Qui si scrive senza compressione dei nomi (permessa) e si
 * legge tenendone conto (obbligatorio, perche' chi interroga la usa).
 */

import dgram from 'node:dgram';
import os from 'node:os';

export const MDNS_ADDRESS = '224.0.0.251';
export const MDNS_PORT = 5353;

/** Nome del servizio annunciato. */
export const SERVICE_TYPE = '_wdeck._tcp.local';

/** Elenco dei servizi disponibili, interrogato dai browser di rete. */
const SERVICE_ENUM = '_services._dns-sd._udp.local';

const TYPE = { A: 1, PTR: 12, TXT: 16, SRV: 33, AAAA: 28, ANY: 255 };
const CLASS_IN = 1;
/** Bit "cache flush": dice ai client di sostituire i record precedenti. */
const FLUSH = 0x8000;

/** Durata dei record annunciati. */
export const TTL = 120;

// ------------------------------------------------------------------ codifica

/**
 * Codifica un nome DNS in etichette lunghezza+byte.
 * @param {string} name es. "wdeck.local"
 * @returns {Buffer}
 */
export function encodeName(name) {
  const parts = String(name).replace(/\.$/, '').split('.').filter(Boolean);
  const chunks = [];
  for (const part of parts) {
    const bytes = Buffer.from(part, 'utf8');
    if (bytes.length > 63) throw new Error(`etichetta DNS troppo lunga: "${part}"`);
    chunks.push(Buffer.from([bytes.length]), bytes);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

/**
 * Legge un nome, seguendo i puntatori di compressione.
 * @param {Buffer} buffer
 * @param {number} offset
 * @returns {{name: string, offset: number}} offset dopo il nome (non dopo il puntatore)
 */
export function decodeName(buffer, offset) {
  const parts = [];
  let cursor = offset;
  let after = null;
  let salti = 0;

  while (cursor < buffer.length) {
    const length = buffer[cursor];
    if (length === 0) {
      cursor += 1;
      break;
    }
    if ((length & 0xc0) === 0xc0) {
      // Puntatore: due byte, i primi due bit a 1 e gli altri 14 come offset.
      if (after === null) after = cursor + 2;
      cursor = ((length & 0x3f) << 8) | buffer[cursor + 1];
      salti += 1;
      // Un messaggio malevolo puo' contenere puntatori circolari: senza questo
      // limite il parser resterebbe in ciclo per sempre.
      if (salti > 32) throw new Error('nome DNS con troppi puntatori');
      continue;
    }
    parts.push(buffer.subarray(cursor + 1, cursor + 1 + length).toString('utf8'));
    cursor += 1 + length;
  }

  return { name: parts.join('.'), offset: after ?? cursor };
}

/**
 * Costruisce un record di risorsa.
 * @param {{name: string, type: number, data: Buffer, ttl?: number, flush?: boolean}} spec
 * @returns {Buffer}
 */
export function encodeRecord({ name, type, data, ttl = TTL, flush = false }) {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(CLASS_IN | (flush ? FLUSH : 0), 2);
  head.writeUInt32BE(ttl, 4);
  head.writeUInt16BE(data.length, 8);
  return Buffer.concat([encodeName(name), head, data]);
}

/** Dati di un record TXT: coppie chiave=valore, ciascuna con la sua lunghezza. */
export function encodeTxt(pairs) {
  const chunks = [];
  for (const [key, value] of Object.entries(pairs)) {
    const entry = Buffer.from(`${key}=${value}`, 'utf8').subarray(0, 255);
    chunks.push(Buffer.from([entry.length]), entry);
  }
  if (chunks.length === 0) chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

/** Dati di un record SRV: priorita', peso, porta, destinazione. */
export function encodeSrv({ priority = 0, weight = 0, port, target }) {
  const head = Buffer.alloc(6);
  head.writeUInt16BE(priority, 0);
  head.writeUInt16BE(weight, 2);
  head.writeUInt16BE(port, 4);
  return Buffer.concat([head, encodeName(target)]);
}

/** Dati di un record A: quattro byte dell'indirizzo. */
export function encodeA(address) {
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`indirizzo IPv4 non valido: "${address}"`);
  }
  return Buffer.from(parts);
}

/**
 * Compone un messaggio di risposta mDNS.
 * @param {Buffer[]} answers
 * @returns {Buffer}
 */
export function buildResponse(answers) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0); // id: sempre 0 in mDNS
  header.writeUInt16BE(0x8400, 2); // risposta autorevole
  header.writeUInt16BE(0, 4); // nessuna domanda
  header.writeUInt16BE(answers.length, 6);
  return Buffer.concat([header, ...answers]);
}

/**
 * Estrae le domande da un messaggio DNS.
 * @param {Buffer} buffer
 * @returns {Array<{name: string, type: number, unicast: boolean}>}
 */
export function parseQuestions(buffer) {
  if (buffer.length < 12) return [];
  const flags = buffer.readUInt16BE(2);
  // Bit QR a 1 significa "risposta": non c'e' nulla a cui rispondere.
  if (flags & 0x8000) return [];

  const count = buffer.readUInt16BE(4);
  const questions = [];
  let offset = 12;
  for (let i = 0; i < count && offset + 4 <= buffer.length; i += 1) {
    let name;
    try {
      ({ name, offset } = decodeName(buffer, offset));
    } catch {
      return questions;
    }
    if (offset + 4 > buffer.length) break;
    const type = buffer.readUInt16BE(offset);
    const klass = buffer.readUInt16BE(offset + 2);
    offset += 4;
    questions.push({ name, type, unicast: Boolean(klass & 0x8000) });
  }
  return questions;
}

/** Nome host valido per mDNS a partire da un nome libero. */
export function toLocalName(name) {
  const slug = String(name ?? 'wdeck')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'wdeck';
  return `${slug}.local`;
}

// ------------------------------------------------------------------ responder

/**
 * Avvia l'annuncio mDNS.
 * @param {{
 *   name?: string,
 *   port: number,
 *   addresses?: string[],
 *   txt?: object,
 *   logger?: object,
 *   scheme?: string
 * }} options
 */
export function createMdnsResponder({
  name = 'wdeck',
  port,
  addresses,
  txt = {},
  logger = console,
  scheme = 'http'
} = {}) {
  const hostname = toLocalName(name);
  const instance = `${hostname.replace(/\.local$/, '')}.${SERVICE_TYPE}`;
  const ips = addresses ?? lanIPv4();

  let socket = null;
  let running = false;

  /**
   * I record che descrivono l'host, pronti da spedire.
   * @param {number} [ttl] durata dichiarata: 0 significa "dimenticateli subito"
   */
  function records(ttl = TTL) {
    const answers = [
      encodeRecord({ name: SERVICE_TYPE, type: TYPE.PTR, data: encodeName(instance), ttl }),
      encodeRecord({ name: instance, type: TYPE.SRV, data: encodeSrv({ port, target: hostname }), ttl, flush: true }),
      encodeRecord({ name: instance, type: TYPE.TXT, data: encodeTxt({ path: '/', scheme, ...txt }), ttl, flush: true })
    ];
    for (const ip of ips) {
      answers.push(encodeRecord({ name: hostname, type: TYPE.A, data: encodeA(ip), ttl, flush: true }));
    }
    return answers;
  }

  /** Risponde a una domanda, se riguarda qualcosa che sappiamo. */
  function answersFor(question) {
    const asked = question.name.toLowerCase();
    const all = records();
    if (asked === SERVICE_TYPE || asked === SERVICE_ENUM) return all;
    if (asked === instance.toLowerCase()) return all;
    if (asked === hostname && (question.type === TYPE.A || question.type === TYPE.ANY)) {
      return all.filter((_, i) => i >= 3);
    }
    return [];
  }

  function send(answers, target) {
    if (answers.length === 0 || !socket) return;
    const message = buildResponse(answers);
    socket.send(message, target?.port ?? MDNS_PORT, target?.address ?? MDNS_ADDRESS, (err) => {
      if (err) logger.debug?.(`[wdeck] mDNS: invio fallito: ${err.message}`);
    });
  }

  return {
    hostname,
    instance,
    addresses: ips,
    get running() {
      return running;
    },

    /** Mette in ascolto e annuncia. */
    start() {
      if (running) return Promise.resolve(false);
      if (ips.length === 0) {
        logger.info?.('[wdeck] mDNS non avviato: nessun indirizzo di rete locale');
        return Promise.resolve(false);
      }

      return new Promise((resolve) => {
        socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        socket.on('error', (err) => {
          // Un'altra applicazione puo' avere gia' la porta 5353 (Bonjour su
          // Windows, avahi su Linux). Non e' un motivo per non partire: si
          // rinuncia all'annuncio e si va avanti.
          logger.warn?.(`[wdeck] mDNS non disponibile: ${err.message}`);
          try {
            socket.close();
          } catch { /* gia' chiuso */ }
          socket = null;
          running = false;
          resolve(false);
        });

        socket.on('message', (message, remote) => {
          let questions;
          try {
            questions = parseQuestions(message);
          } catch {
            return;
          }
          for (const question of questions) {
            const answers = answersFor(question);
            // Una domanda con il bit "unicast" chiede la risposta diretta.
            if (answers.length > 0) send(answers, question.unicast ? remote : null);
          }
        });

        socket.bind(MDNS_PORT, () => {
          try {
            socket.addMembership(MDNS_ADDRESS);
            socket.setMulticastTTL(255);
            socket.setMulticastLoopback(true);
          } catch (err) {
            logger.warn?.(`[wdeck] mDNS: impossibile unirsi al gruppo multicast: ${err.message}`);
          }
          running = true;
          // Due annunci a distanza di un secondo: il primo pacchetto UDP puo'
          // andare perso, e non c'e' ritrasmissione.
          send(records());
          const secondo = setTimeout(() => send(records()), 1000);
          if (typeof secondo.unref === 'function') secondo.unref();
          logger.info?.(`[wdeck] raggiungibile anche come ${scheme}://${hostname}:${port}/`);
          resolve(true);
        });
      });
    },

    /** Ritira l'annuncio e chiude. */
    stop() {
      if (!socket) return;
      try {
        // TTL 0: dice ai client di dimenticare subito questi record, invece di
        // tenerli per i due minuti previsti.
        send(records(0));
      } catch { /* la chiusura non deve fallire per un pacchetto */ }
      try {
        socket.close();
      } catch { /* gia' chiuso */ }
      socket = null;
      running = false;
    }
  };
}

/** Indirizzi IPv4 non di loopback della macchina. */
export function lanIPv4() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}
