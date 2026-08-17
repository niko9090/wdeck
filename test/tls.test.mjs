/**
 * Certificato autofirmato e canale cifrato.
 *
 * Il certificato e' costruito a mano in DER: qui viene riletto con
 * `crypto.X509Certificate`, cioe' con lo stesso parser che useranno i browser,
 * e poi usato davvero da un server HTTPS con WebSocket sopra. Se la struttura
 * ASN.1 fosse sbagliata, nessuna delle due cose funzionerebbe.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  der,
  encodeAltNames,
  encodeLength,
  encodeOid,
  encodeTime,
  encodeUnsignedInteger,
  generateSelfSigned,
  parseIPv4,
  parseIPv6,
  toPem
} from '../src/host/security/selfsigned.mjs';
import { CERT_FILE, KEY_FILE, certificateUsable, ensureCertificate, loadTlsOptions } from '../src/host/security/tls.mjs';
import { createHost, buildUrls } from '../src/host/index.mjs';
import { ENDPOINTS } from '../shared/protocol.mjs';
import { connectWebSocket, waitForMessage } from '../src/host/ws/client.mjs';
import { rawDeck } from '../tools/fixtures.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {}, log() {} };

// Una chiave da 1024 bit non e' adatta all'uso vero, ma qui interessa la
// struttura del certificato, e generarne una da 2048 per ogni test costerebbe
// secondi di attesa a ogni lancio della suite.
const RAPIDO = { modulusLength: 1024 };

function tempDir(prefix = 'wdeck-tls-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** GET su HTTPS accettando un certificato autofirmato. */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { rejectUnauthorized: false }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    request.on('error', reject);
  });
}

// ------------------------------------------------------------------ DER

test('der: la lunghezza usa la forma breve sotto 128 e quella lunga sopra', () => {
  assert.deepEqual([...encodeLength(5)], [5]);
  assert.deepEqual([...encodeLength(127)], [127]);
  assert.deepEqual([...encodeLength(128)], [0x81, 128]);
  assert.deepEqual([...encodeLength(256)], [0x82, 0x01, 0x00]);
  assert.deepEqual([...encodeLength(65536)], [0x83, 0x01, 0x00, 0x00]);
});

test('der: un elemento e\' tag, lunghezza e contenuto', () => {
  assert.deepEqual([...der(0x04, Buffer.from([1, 2, 3]))], [0x04, 0x03, 1, 2, 3]);
});

test('der: gli OID seguono la codifica in base 128', () => {
  // sha256WithRSAEncryption, il valore piu' usato di questo modulo.
  assert.deepEqual(
    [...encodeOid('1.2.840.113549.1.1.11')],
    [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]
  );
  // commonName: due componenti corte, nessuna continuazione.
  assert.deepEqual([...encodeOid('2.5.4.3')], [0x06, 0x03, 0x55, 0x04, 0x03]);
  assert.throws(() => encodeOid('1'), /OID non valido/);
});

test('der: un intero con il bit alto acceso riceve uno zero davanti', () => {
  // Senza, verrebbe letto come negativo: e' il caso di meta' dei numeri di serie.
  assert.deepEqual([...encodeUnsignedInteger(Buffer.from([0x80]))], [0x02, 0x02, 0x00, 0x80]);
  assert.deepEqual([...encodeUnsignedInteger(Buffer.from([0x7f]))], [0x02, 0x01, 0x7f]);
  assert.deepEqual([...encodeUnsignedInteger(Buffer.from([0x00, 0x01]))], [0x02, 0x01, 0x01], 'gli zeri inutili si tolgono');
});

test('der: le date usano UTCTime fino al 2049 e GeneralizedTime dopo', () => {
  const utc = encodeTime(new Date(Date.UTC(2026, 7, 13, 9, 5, 3)));
  assert.equal(utc[0], 0x17);
  assert.equal(utc.subarray(2).toString('ascii'), '260813090503Z');

  const generalized = encodeTime(new Date(Date.UTC(2050, 0, 1, 0, 0, 0)));
  assert.equal(generalized[0], 0x18);
  assert.equal(generalized.subarray(2).toString('ascii'), '20500101000000Z');
});

test('der: parseIPv4 distingue un indirizzo da un nome', () => {
  assert.deepEqual([...parseIPv4('192.168.1.79')], [192, 168, 1, 79]);
  assert.equal(parseIPv4('localhost'), null);
  assert.equal(parseIPv4('999.1.1.1'), null);
  assert.equal(parseIPv4('192.168.1'), null);
});

test('der: i nomi alternativi distinguono DNS da indirizzo IP', () => {
  const encoded = encodeAltNames(['localhost', '127.0.0.1']);
  // [2] dNSName per il nome, [7] iPAddress per l'indirizzo.
  assert.ok(encoded.includes(Buffer.from([0x82, 0x09])), 'manca il dNSName');
  assert.ok(encoded.includes(Buffer.from([0x87, 0x04, 127, 0, 0, 1])), 'manca l\'iPAddress');
});

test('der: parseIPv6 riconosce le forme compresse', () => {
  const uno = parseIPv6('::1');
  assert.equal(uno.length, 16, 'un IPv6 sono sedici byte');
  assert.deepEqual([...uno.subarray(14)], [0, 1]);
  assert.deepEqual([...parseIPv6('2001:db8::').subarray(0, 4)], [0x20, 0x01, 0x0d, 0xb8]);
  assert.equal(parseIPv6('192.168.1.1'), null, 'un IPv4 non e\' un IPv6');
  assert.equal(parseIPv6('non-un-ip'), null);
  assert.equal(parseIPv6('1::2::3'), null, 'due "::" non sono ammessi');
});

test('der: un IPv6 letterale diventa un SAN iPAddress da sedici byte, non un dNSName', () => {
  const encoded = encodeAltNames(['::1']);
  // [7] iPAddress lungo 0x10 (16 byte), non [2] dNSName.
  assert.ok(encoded.includes(Buffer.from([0x87, 0x10])), 'manca l\'iPAddress IPv6');
});

test('der: toPem incapsula e va a capo ogni 64 caratteri', () => {
  const pem = toPem('CERTIFICATE', Buffer.alloc(100, 1));
  assert.match(pem, /^-----BEGIN CERTIFICATE-----\n/);
  assert.match(pem, /-----END CERTIFICATE-----\n$/);
  for (const line of pem.split('\n').slice(1, -2)) assert.ok(line.length <= 64);
});

// ------------------------------------------------------------------ certificato

test('certificato: e\' leggibile dal parser X.509 di Node', () => {
  const { cert } = generateSelfSigned({ ...RAPIDO, altNames: ['localhost', '127.0.0.1'] });
  const x509 = new crypto.X509Certificate(cert);
  assert.match(x509.subject, /CN=Wdeck Host/);
  assert.equal(x509.subject, x509.issuer, 'autofirmato: emittente e soggetto coincidono');
});

test('certificato: la firma e\' valida', () => {
  const { cert } = generateSelfSigned(RAPIDO);
  const x509 = new crypto.X509Certificate(cert);
  assert.equal(x509.verify(x509.publicKey), true);
});

test('certificato: vale per i nomi e gli indirizzi richiesti, e solo per quelli', () => {
  const { cert } = generateSelfSigned({ ...RAPIDO, altNames: ['localhost', '127.0.0.1', '192.168.1.79'] });
  const x509 = new crypto.X509Certificate(cert);

  assert.ok(x509.checkHost('localhost'));
  assert.ok(x509.checkIP('127.0.0.1'));
  assert.ok(x509.checkIP('192.168.1.79'));
  assert.equal(x509.checkHost('altro.example'), undefined);
  assert.equal(x509.checkIP('8.8.8.8'), undefined);
});

test('certificato: vale per un indirizzo IPv6 letterale', () => {
  // Prima della correzione un IPv6 finiva come dNSName: il certificato non
  // valeva per un client che si collega con l'indirizzo IPv6.
  const { cert } = generateSelfSigned({ ...RAPIDO, altNames: ['localhost', '::1', 'fe80::1'] });
  const x509 = new crypto.X509Certificate(cert);
  assert.ok(x509.checkIP('::1'), 'il certificato deve coprire ::1');
  assert.ok(x509.checkIP('fe80::1'));
  assert.equal(x509.checkIP('2001:db8::99'), undefined, 'e solo quelli richiesti');
  // E certificateUsable usa checkIP anche per gli host IPv6.
  assert.equal(certificateUsable(cert, { hosts: ['::1'] }).ok, true);
  assert.match(certificateUsable(cert, { hosts: ['2001:db8::99'] }).reason, /non copre/);
});

test('certificato: non e\' una CA', () => {
  // Un certificato server che potesse firmarne altri sarebbe molto peggio di un
  // certificato server.
  assert.equal(new crypto.X509Certificate(generateSelfSigned(RAPIDO).cert).ca, false);
});

test('certificato: la validita\' parte da prima di adesso e dura i giorni chiesti', () => {
  const adesso = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
  const { cert, notBefore, notAfter } = generateSelfSigned({ ...RAPIDO, days: 30, notBefore: adesso });

  // Un'ora di margine: gli orologi in LAN non sono allineati, e un certificato
  // "non ancora valido" e' un errore difficile da capire.
  assert.equal(adesso.getTime() - notBefore.getTime(), 3600_000);
  assert.equal(notAfter.getTime() - adesso.getTime(), 30 * 86400_000);

  const x509 = new crypto.X509Certificate(cert);
  assert.ok(Date.parse(x509.validTo) > Date.parse(x509.validFrom));
});

test('certificato: la chiave privata prodotta e\' utilizzabile', () => {
  const { key } = generateSelfSigned(RAPIDO);
  assert.equal(crypto.createPrivateKey(key).asymmetricKeyType, 'rsa');
});

// ------------------------------------------------------------------ archivio

test('tls: il certificato viene generato una volta e poi riusato', () => {
  const { dir, cleanup } = tempDir();
  try {
    const primo = ensureCertificate({ dir, hosts: ['localhost', '127.0.0.1'], logger: silent });
    assert.equal(primo.generated, true);
    assert.ok(fs.existsSync(path.join(dir, CERT_FILE)));
    assert.ok(fs.existsSync(path.join(dir, KEY_FILE)));

    const secondo = ensureCertificate({ dir, hosts: ['localhost', '127.0.0.1'], logger: silent });
    assert.equal(secondo.generated, false, 'non si rigenera a ogni avvio');
    assert.equal(secondo.cert, primo.cert);
  } finally {
    cleanup();
  }
});

test('tls: un indirizzo nuovo fa rigenerare il certificato', () => {
  const { dir, cleanup } = tempDir();
  try {
    ensureCertificate({ dir, hosts: ['localhost'], logger: silent });
    // Cambio rete, VPN, docking station: il certificato vecchio sarebbe inutile
    // proprio dove serve.
    const dopo = ensureCertificate({ dir, hosts: ['localhost', '10.0.0.5'], logger: silent });
    assert.equal(dopo.generated, true);
    assert.ok(new crypto.X509Certificate(dopo.cert).checkIP('10.0.0.5'));
  } finally {
    cleanup();
  }
});

test('tls: la chiave rigenerata mantiene i permessi 0600', () => {
  if (process.platform === 'win32') return; // la modalita' POSIX e' ignorata su Windows
  const { dir, cleanup } = tempDir();
  try {
    ensureCertificate({ dir, hosts: ['localhost'], logger: silent });
    // Un host nuovo forza la rigenerazione: la chiave viene riscritta sopra.
    ensureCertificate({ dir, hosts: ['localhost', '10.0.0.9'], logger: silent });
    const mode = fs.statSync(path.join(dir, KEY_FILE)).mode & 0o777;
    assert.equal(mode, 0o600, 'la chiave rigenerata non deve ereditare permessi piu\' larghi');
  } finally {
    cleanup();
  }
});

test('tls: certificateUsable riconosce scadenza e nomi mancanti', () => {
  const { cert, notAfter } = generateSelfSigned({ ...RAPIDO, altNames: ['localhost'], days: 30 });

  assert.equal(certificateUsable(cert, { hosts: ['localhost'] }).ok, true);
  assert.match(certificateUsable(cert, { hosts: ['altro.it'] }).reason, /non copre/);
  assert.match(certificateUsable(cert, { hosts: [], now: notAfter.getTime() }).reason, /scaduto/);
  assert.match(certificateUsable('non un certificato').reason, /illeggibile/);
});

test('tls: disattivato non genera nulla', () => {
  const { dir, cleanup } = tempDir();
  try {
    assert.equal(loadTlsOptions({ config: { enabled: false }, baseDir: dir, logger: silent }), null);
    assert.equal(loadTlsOptions({ baseDir: dir, logger: silent }), null);
    assert.equal(fs.existsSync(path.join(dir, '.wdeck-tls')), false);
  } finally {
    cleanup();
  }
});

test('tls: un certificato fornito dall\'utente viene usato al posto di quello generato', () => {
  const { dir, cleanup } = tempDir();
  try {
    const generato = generateSelfSigned({ ...RAPIDO, commonName: 'Il mio certificato' });
    fs.writeFileSync(path.join(dir, 'mio.crt'), generato.cert);
    fs.writeFileSync(path.join(dir, 'mio.key'), generato.key);

    const opzioni = loadTlsOptions({
      config: { enabled: true, certFile: 'mio.crt', keyFile: 'mio.key' },
      baseDir: dir,
      logger: silent
    });
    assert.equal(opzioni.selfSigned, false);
    assert.match(new crypto.X509Certificate(opzioni.cert).subject, /Il mio certificato/);
  } finally {
    cleanup();
  }
});

test('tls: indicare solo uno dei due file e\' un errore esplicito', () => {
  const { dir, cleanup } = tempDir();
  try {
    assert.throws(
      () => loadTlsOptions({ config: { enabled: true, certFile: 'solo.crt' }, baseDir: dir, logger: silent }),
      /certFile sia keyFile/
    );
    assert.throws(
      () => loadTlsOptions({ config: { enabled: true, certFile: 'a.crt', keyFile: 'b.key' }, baseDir: dir, logger: silent }),
      /file non trovato/
    );
  } finally {
    cleanup();
  }
});

// ------------------------------------------------------------------ host

test('tls: gli URL stampati usano lo schema giusto', () => {
  assert.deepEqual(buildUrls('127.0.0.1', 8899), ['http://127.0.0.1:8899/']);
  assert.deepEqual(buildUrls('127.0.0.1', 8899, 'https'), ['https://127.0.0.1:8899/']);
});

test('tls: l\'host serve davvero HTTPS e WSS', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-tls-host-'));
  const configFile = path.join(dir, 'deck.json');
  const deck = rawDeck();
  deck.settings.server.tls = { enabled: true, days: 30 };
  fs.writeFileSync(configFile, JSON.stringify(deck, null, 2));

  const host = createHost({
    configFile,
    overrides: { port: 0, host: '127.0.0.1', token: 'token-tls-di-test-1', dryRun: true },
    logger: silent,
    watch: false,
    tray: false
  });
  const info = await host.start();
  t.after(async () => {
    await host.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(info.tls, true);
  assert.equal(info.scheme, 'https');
  assert.ok(info.urls[0].startsWith('https://'), info.urls[0]);
  assert.ok(fs.existsSync(path.join(dir, '.wdeck-tls', CERT_FILE)), 'il certificato sta accanto alla configurazione');

  // Il certificato e' autofirmato: nessuna autorita' lo conosce, quindi qui va
  // detto esplicitamente di non pretenderlo. E' la stessa scelta che fa
  // l'utente accettando l'avviso del browser. `fetch` non lo permette, quindi
  // la richiesta passa dal modulo https.
  const risposta = await httpsGet(`https://127.0.0.1:${info.port}${ENDPOINTS.health}`);
  assert.equal(risposta.status, 200);
  assert.equal(JSON.parse(risposta.body).ok, true);

  const ws = await connectWebSocket(`wss://127.0.0.1:${info.port}${ENDPOINTS.ws}?token=token-tls-di-test-1`, {
    rejectUnauthorized: false
  });
  const hello = await waitForMessage(ws, (m) => m.type === 'hello', { label: 'hello su WSS' });
  assert.equal(hello.protocol, 1);

  const closed = new Promise((resolve) => ws.once('close', resolve));
  ws.on('error', () => {});
  ws.close(1000, 'fine');
  await closed;
});
