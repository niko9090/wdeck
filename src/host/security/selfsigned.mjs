/**
 * Generazione di un certificato X.509 autofirmato, senza dipendenze.
 *
 * Node sa generare una coppia di chiavi e sa firmare, ma non sa costruire un
 * certificato: quel pezzo di solito lo mette una libreria, oppure `openssl`
 * chiamato come processo esterno. Qui non si puo' fare ne' l'uno ne' l'altro -
 * il progetto non ha dipendenze, e openssl non e' installato ovunque - quindi
 * la struttura DER e' scritta a mano.
 *
 * Non e' tanto codice quanto sembra: un certificato e' una sequenza ASN.1 di
 * campi noti, e serve un solo tipo di firma (sha256WithRSAEncryption). Il
 * risultato e' verificabile con `new crypto.X509Certificate(pem)`, che Node
 * mette a disposizione: i test controllano soggetto, nomi alternativi, validita'
 * e firma con lo stesso parser che useranno i browser.
 *
 * Un certificato autofirmato **non e' fidato da nessuno**: il browser mostrera'
 * un avviso la prima volta. Serve a cifrare il traffico in LAN, non a
 * dimostrare l'identita' dell'host; e' comunque meglio del token che viaggia
 * in chiaro su una rete condivisa.
 */

import crypto from 'node:crypto';

// ------------------------------------------------------------------ DER

const TAG = {
  boolean: 0x01,
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  null: 0x05,
  oid: 0x06,
  utf8String: 0x0c,
  sequence: 0x30,
  set: 0x31,
  printableString: 0x13,
  ia5String: 0x16,
  utcTime: 0x17,
  generalizedTime: 0x18
};

/**
 * Codifica la lunghezza nella forma richiesta da DER.
 * Fino a 127 basta un byte; oltre, un byte di conteggio piu' i byte del valore.
 * @param {number} length
 * @returns {Buffer}
 */
export function encodeLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/**
 * Elemento DER: tag, lunghezza, contenuto.
 * @param {number} tag
 * @param {Buffer|Buffer[]} content
 * @returns {Buffer}
 */
export function der(tag, content) {
  const body = Array.isArray(content) ? Buffer.concat(content) : content;
  return Buffer.concat([Buffer.from([tag]), encodeLength(body.length), body]);
}

const sequence = (...parts) => der(TAG.sequence, parts.flat());
const set = (...parts) => der(TAG.set, parts.flat());

/** Elemento con tag di contesto costruito, es. `[0] { ... }`. */
const contextConstructed = (n, content) => der(0xa0 | n, content);

/** Elemento con tag di contesto primitivo, es. `[2] IA5String`. */
const contextPrimitive = (n, content) => der(0x80 | n, content);

/**
 * Codifica un OID nella forma DER.
 * I primi due numeri stanno in un byte solo (40*a + b), i successivi in base 128
 * con il bit alto acceso su tutti tranne l'ultimo byte.
 * @param {string} oid es. "1.2.840.113549.1.1.11"
 * @returns {Buffer}
 */
export function encodeOid(oid) {
  const parts = oid.split('.').map(Number);
  if (parts.length < 2) throw new Error(`OID non valido: "${oid}"`);
  const bytes = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk = [];
    let value = part;
    do {
      chunk.unshift(value & 0x7f);
      value >>= 7;
    } while (value > 0);
    for (let i = 0; i < chunk.length - 1; i += 1) chunk[i] |= 0x80;
    bytes.push(...chunk);
  }
  return der(TAG.oid, Buffer.from(bytes));
}

/**
 * Intero DER senza segno: se il primo byte ha il bit alto acceso serve uno zero
 * davanti, altrimenti il numero verrebbe letto come negativo.
 * @param {Buffer} buffer
 * @returns {Buffer}
 */
export function encodeUnsignedInteger(buffer) {
  let bytes = buffer;
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0x00 && (bytes[start + 1] & 0x80) === 0) start += 1;
  bytes = bytes.subarray(start);
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0x00]), bytes]);
  return der(TAG.integer, bytes);
}

/** Piccolo intero DER (versione, valori di enumerazione). */
const encodeSmallInteger = (n) => der(TAG.integer, Buffer.from([n]));

/**
 * Data nel formato UTCTime (`YYMMDDHHMMSSZ`).
 * Vale fino al 2049: oltre, lo standard richiede GeneralizedTime.
 * @param {Date} date
 * @returns {Buffer}
 */
export function encodeTime(date) {
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  const year = date.getUTCFullYear();
  const body = `${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

  if (year < 2050) {
    return der(TAG.utcTime, Buffer.from(`${pad(year % 100)}${body}`, 'ascii'));
  }
  return der(TAG.generalizedTime, Buffer.from(`${pad(year, 4)}${body}`, 'ascii'));
}

// ------------------------------------------------------------------ certificato

const OID = {
  sha256WithRsa: '1.2.840.113549.1.1.11',
  commonName: '2.5.4.3',
  organizationName: '2.5.4.10',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  extKeyUsage: '2.5.29.37',
  subjectAltName: '2.5.29.17',
  serverAuth: '1.3.6.1.5.5.7.3.1'
};

/** AlgorithmIdentifier per sha256WithRSAEncryption (parametri NULL). */
const signatureAlgorithm = () => sequence([encodeOid(OID.sha256WithRsa), der(TAG.null, Buffer.alloc(0))]);

/**
 * Nome X.501 con nome comune e organizzazione.
 * @param {{commonName: string, organization?: string}} spec
 */
function encodeName({ commonName, organization }) {
  const attribute = (oid, value) => set([sequence([encodeOid(oid), der(TAG.utf8String, Buffer.from(value, 'utf8'))])]);
  const parts = [attribute(OID.commonName, commonName)];
  if (organization) parts.push(attribute(OID.organizationName, organization));
  return sequence(parts);
}

/** Estensione X.509. */
const extension = (oid, value, critical = false) => sequence([
  encodeOid(oid),
  ...(critical ? [der(TAG.boolean, Buffer.from([0xff]))] : []),
  der(TAG.octetString, value)
]);

/**
 * Riconosce un indirizzo IPv4 e ne restituisce i quattro byte.
 * @param {string} value
 * @returns {Buffer|null}
 */
export function parseIPv4(value) {
  const match = String(value).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const bytes = match.slice(1).map(Number);
  if (bytes.some((b) => b > 255)) return null;
  return Buffer.from(bytes);
}

/**
 * subjectAltName: i nomi per cui il certificato vale.
 *
 * Senza questa estensione i browser moderni rifiutano il certificato a
 * prescindere dal nome comune, che dal 2017 non guardano piu'.
 * @param {string[]} names nomi DNS e indirizzi IP mescolati
 */
export function encodeAltNames(names) {
  const entries = [];
  for (const name of names) {
    const ip = parseIPv4(name);
    // [2] dNSName, [7] iPAddress: sono le due forme che servono in LAN.
    entries.push(ip ? contextPrimitive(7, ip) : contextPrimitive(2, Buffer.from(String(name), 'ascii')));
  }
  return sequence(entries);
}

/**
 * Genera una coppia di chiavi RSA e il certificato autofirmato corrispondente.
 * @param {{
 *   commonName?: string,
 *   organization?: string,
 *   altNames?: string[],
 *   days?: number,
 *   modulusLength?: number,
 *   notBefore?: Date
 * }} [options]
 * @returns {{key: string, cert: string, notBefore: Date, notAfter: Date, altNames: string[]}}
 */
export function generateSelfSigned({
  commonName = 'Wdeck Host',
  organization = 'Wdeck',
  altNames = ['localhost', '127.0.0.1'],
  days = 825,
  modulusLength = 2048,
  notBefore = new Date()
} = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength });

  // Lo SubjectPublicKeyInfo lo sa gia' produrre Node: e' l'unica parte del
  // certificato che non serve costruire a mano.
  const spki = publicKey.export({ type: 'spki', format: 'der' });

  // Un'ora di margine all'indietro: gli orologi in LAN non sono mai allineati,
  // e un certificato "non ancora valido" e' un errore difficile da capire.
  const from = new Date(notBefore.getTime() - 3600_000);
  const to = new Date(notBefore.getTime() + days * 86400_000);

  const names = [...new Set(altNames.filter(Boolean).map(String))];

  const tbs = sequence([
    contextConstructed(0, encodeSmallInteger(2)), // versione v3
    encodeUnsignedInteger(crypto.randomBytes(16)), // numero di serie
    signatureAlgorithm(),
    encodeName({ commonName, organization }), // emittente = soggetto: autofirmato
    sequence([encodeTime(from), encodeTime(to)]),
    encodeName({ commonName, organization }),
    spki,
    contextConstructed(3, sequence([
      // CA: false. Un certificato server non deve poter firmarne altri.
      extension(OID.basicConstraints, sequence([]), true),
      // digitalSignature + keyEncipherment: bit 0 e bit 2, 5 bit inutilizzati.
      extension(OID.keyUsage, der(TAG.bitString, Buffer.from([0x05, 0xa0])), true),
      extension(OID.extKeyUsage, sequence([encodeOid(OID.serverAuth)])),
      extension(OID.subjectAltName, encodeAltNames(names))
    ]))
  ]);

  const signature = crypto.sign('sha256', tbs, privateKey);
  const certificate = sequence([
    tbs,
    signatureAlgorithm(),
    // BIT STRING: il primo byte dice quanti bit finali non contano, qui nessuno.
    der(TAG.bitString, Buffer.concat([Buffer.from([0x00]), signature]))
  ]);

  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: toPem('CERTIFICATE', certificate),
    notBefore: from,
    notAfter: to,
    altNames: names
  };
}

/**
 * Incapsula un blocco DER nella forma PEM.
 * @param {string} label es. "CERTIFICATE"
 * @param {Buffer} data
 * @returns {string}
 */
export function toPem(label, data) {
  const body = data.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}
