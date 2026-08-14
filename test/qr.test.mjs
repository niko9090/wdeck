/**
 * Generatore di QR code e scoperta mDNS.
 *
 * Il QR e' scritto da zero, quindi va verificato contro qualcosa di esterno e
 * non solo contro se stesso. Qui si usano tre ancoraggi indipendenti:
 *
 *  1. il **polinomio generatore** di Reed-Solomon, i cui coefficienti sono
 *     elencati nella norma;
 *  2. le **codeword di correzione** dell'esempio della norma (`01234567` in
 *     versione 1 livello M);
 *  3. la **coerenza fra tabella dei blocchi e geometria**: le codeword totali
 *     si ricavano dalla dimensione della versione, e devono coincidere con la
 *     somma dei blocchi per tutte e quaranta le combinazioni.
 *
 * Il resto sono invarianti di struttura: occhi di ricerca, temporizzazione,
 * modulo scuro, informazioni di formato.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_VERSION,
  alignmentPositions,
  chooseVersion,
  dataCapacity,
  encodeQr,
  formatBits,
  generatorPolynomial,
  penalty,
  qrSvg,
  qrText,
  reedSolomon,
  sizeOf,
  totalCodewords,
  versionBits
} from '../shared/qr.mjs';
import {
  buildResponse,
  decodeName,
  encodeA,
  encodeName,
  encodeRecord,
  encodeSrv,
  encodeTxt,
  parseQuestions,
  toLocalName
} from '../src/host/discovery.mjs';

/** Logaritmi in GF(256), per confrontare il generatore con la norma. */
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
}

// ------------------------------------------------------------------ Reed-Solomon

test('qr: il polinomio generatore coincide con quello della norma', () => {
  // Coefficienti del generatore di grado 10, dal grado piu' alto al piu' basso.
  assert.deepEqual(
    [...generatorPolynomial(10)].map((c) => LOG[c]),
    [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45]
  );
  assert.deepEqual([...generatorPolynomial(7)].map((c) => LOG[c]), [0, 87, 229, 146, 149, 238, 102, 21]);
});

test('qr: le codeword di correzione coincidono con l\'esempio della norma', () => {
  // "01234567" in versione 1 livello M, dopo codifica e riempimento.
  const dati = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
  assert.deepEqual(
    [...reedSolomon(dati, 10)],
    [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]
  );
});

// ------------------------------------------------------------------ tabelle

test('qr: la tabella dei blocchi e\' coerente con la geometria di ogni versione', () => {
  // dataCapacity() confronta la somma dei blocchi con le codeword ricavate
  // dalla dimensione: un errore di trascrizione nella tabella fa fallire qui.
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    for (const level of ['L', 'M', 'Q', 'H']) {
      assert.doesNotThrow(() => dataCapacity(version, level), `versione ${version} livello ${level}`);
    }
  }
});

test('qr: le codeword totali seguono le dimensioni note delle versioni', () => {
  const attese = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346 };
  for (const [version, totale] of Object.entries(attese)) {
    assert.equal(totalCodewords(Number(version)), totale, `versione ${version}`);
  }
});

test('qr: il lato cresce di quattro moduli per versione', () => {
  assert.equal(sizeOf(1), 21);
  assert.equal(sizeOf(2), 25);
  assert.equal(sizeOf(10), 57);
});

test('qr: i pattern di allineamento stanno dove previsto', () => {
  assert.deepEqual(alignmentPositions(1), [], 'la versione 1 non ne ha');
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
});

test('qr: si sceglie la versione piu\' piccola che contiene i dati', () => {
  assert.equal(chooseVersion(10, 'M'), 1);
  assert.ok(chooseVersion(100, 'M') > chooseVersion(10, 'M'));
  assert.throws(() => chooseVersion(10000, 'M'), /troppo lungo/);
});

// ------------------------------------------------------------------ formato

test('qr: le informazioni di formato usano la maschera fissa della norma', () => {
  // Livello M, maschera 0: i cinque bit di dati sono zero, quindi anche il
  // codice BCH e' zero e resta la sola maschera 0x5412.
  assert.equal(formatBits('M', 0), 0x5412);
  assert.equal(formatBits('L', 0), 0x77c4);
});

test('qr: ogni combinazione di livello e maschera ha un formato distinto', () => {
  const visti = new Set();
  for (const level of ['L', 'M', 'Q', 'H']) {
    for (let mask = 0; mask < 8; mask += 1) {
      const bits = formatBits(level, mask);
      assert.ok(bits >= 0 && bits <= 0x7fff, 'il formato deve stare in 15 bit');
      assert.ok(!visti.has(bits), `formato duplicato per ${level}/${mask}`);
      visti.add(bits);
    }
  }
  assert.equal(visti.size, 32);
});

test('qr: le informazioni di versione contengono la versione nei bit alti', () => {
  assert.equal(versionBits(7) >> 12, 7);
  assert.equal(versionBits(10) >> 12, 10);
  assert.ok(versionBits(7) <= 0x3ffff, 'devono stare in 18 bit');
});

// ------------------------------------------------------------------ matrice

test('qr: la matrice ha gli occhi di ricerca ai tre angoli', () => {
  const { modules, size } = encodeQr('https://esempio.it');
  const occhio = (r, c) => modules[r][c] === 1 && modules[r + 1][c + 1] === 0
    && modules[r + 2][c + 2] === 1 && modules[r + 6][c + 6] === 1;

  assert.ok(occhio(0, 0), 'occhio in alto a sinistra');
  assert.ok(occhio(0, size - 7), 'occhio in alto a destra');
  assert.ok(occhio(size - 7, 0), 'occhio in basso a sinistra');
});

test('qr: i separatori attorno agli occhi sono chiari', () => {
  const { modules, size } = encodeQr('https://esempio.it');
  for (let i = 0; i < 8; i += 1) {
    assert.equal(modules[7][i], 0, `separatore orizzontale in ${i}`);
    assert.equal(modules[i][7], 0, `separatore verticale in ${i}`);
    assert.equal(modules[size - 8][i], 0);
  }
});

test('qr: i pattern di temporizzazione si alternano', () => {
  const { modules, size } = encodeQr('https://esempio.it');
  for (let i = 8; i < size - 8; i += 1) {
    assert.equal(modules[6][i], i % 2 === 0 ? 1 : 0, `temporizzazione orizzontale in ${i}`);
    assert.equal(modules[i][6], i % 2 === 0 ? 1 : 0, `temporizzazione verticale in ${i}`);
  }
});

test('qr: il modulo scuro obbligatorio e\' acceso', () => {
  const { modules, size } = encodeQr('https://esempio.it');
  assert.equal(modules[size - 8][8], 1);
});

test('qr: le due copie delle informazioni di formato coincidono', () => {
  const { modules, size, level, mask } = encodeQr('https://esempio.it');
  const bits = formatBits(level, mask);
  for (let i = 0; i <= 5; i += 1) {
    assert.equal(modules[8][i], (bits >> i) & 1, `copia 1, bit ${i}`);
    assert.equal(modules[size - 1 - i][8], (bits >> i) & 1, `copia 2, bit ${i}`);
  }
});

test('qr: la maschera scelta e\' quella con la penalita\' piu\' bassa', () => {
  const testo = 'https://192.168.1.79:8899/?token=abcdefghijklmnop';
  const automatica = encodeQr(testo);
  for (let m = 0; m < 8; m += 1) {
    const forzata = encodeQr(testo, { mask: m });
    assert.ok(
      penalty(automatica.modules) <= penalty(forzata.modules),
      `la maschera ${m} sarebbe stata migliore di quella scelta (${automatica.mask})`
    );
  }
});

test('qr: testi diversi producono matrici diverse', () => {
  const a = encodeQr('https://esempio.it/uno');
  const b = encodeQr('https://esempio.it/due');
  assert.notEqual(JSON.stringify(a.modules), JSON.stringify(b.modules));
});

test('qr: lo stesso testo produce sempre la stessa matrice', () => {
  const a = encodeQr('https://esempio.it');
  const b = encodeQr('https://esempio.it');
  assert.deepEqual(JSON.stringify(a.modules), JSON.stringify(b.modules));
});

test('qr: un URL con token entra in una versione leggibile da lontano', () => {
  const { version } = encodeQr('http://192.168.1.79:8899/?token=' + 'a'.repeat(32));
  assert.ok(version <= 6, `versione ${version}: troppo fitta da inquadrare`);
});

test('qr: i testi non validi vengono rifiutati', () => {
  assert.throws(() => encodeQr(''), /testo mancante/);
  assert.throws(() => encodeQr('x', { level: 'Z' }), /livello di correzione sconosciuto/);
  assert.throws(() => encodeQr('x', { version: 99 }), /versione fuori intervallo/);
});

test('qr: l\'accento e i caratteri non ASCII passano da UTF-8', () => {
  assert.doesNotThrow(() => encodeQr('citta\' perche\' cosi\''));
  const { version } = encodeQr('à'.repeat(50));
  assert.ok(version >= 3, 'ogni carattere accentato occupa due byte');
});

// ------------------------------------------------------------------ resa

test('qr: l\'SVG e\' completo e proporzionato', () => {
  const svg = qrSvg('https://esempio.it', { scale: 4, margin: 4 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  const [, width, height] = svg.match(/width="(\d+)" height="(\d+)"/);
  assert.equal(width, height, 'un QR e\' sempre quadrato');
});

test('qr: la resa a caratteri usa due righe di moduli per riga di testo', () => {
  const testo = qrText('https://esempio.it', { margin: 2 });
  const righe = testo.split('\n');
  const { size } = encodeQr('https://esempio.it');
  assert.equal(righe.length, Math.ceil((size + 4) / 2));
  assert.equal(righe[0].length, size + 4);
});

// ------------------------------------------------------------------ mDNS

test('mdns: i nomi sono codificati in etichette lunghezza+byte', () => {
  assert.deepEqual([...encodeName('wdeck.local')], [5, 119, 100, 101, 99, 107, 5, 108, 111, 99, 97, 108, 0]);
  assert.deepEqual([...encodeName('')], [0]);
  assert.throws(() => encodeName(`${'x'.repeat(64)}.local`), /troppo lunga/);
});

test('mdns: la lettura di un nome segue i puntatori di compressione', () => {
  const buffer = Buffer.concat([
    Buffer.alloc(12), // intestazione fittizia
    encodeName('wdeck.local'), // a offset 12
    Buffer.from([0x03, 0x61, 0x62, 0x63, 0xc0, 0x0c]) // "abc" + puntatore a 12
  ]);
  assert.equal(decodeName(buffer, 12).name, 'wdeck.local');

  const compresso = decodeName(buffer, 12 + 13);
  assert.equal(compresso.name, 'abc.wdeck.local');
  assert.equal(compresso.offset, 12 + 13 + 6, 'l\'offset riprende dopo il puntatore');
});

test('mdns: un puntatore circolare non blocca il parser', () => {
  // Un pacchetto malevolo puo' puntare a se stesso: senza limite, ciclo infinito.
  const buffer = Buffer.concat([Buffer.alloc(12), Buffer.from([0xc0, 0x0c])]);
  assert.throws(() => decodeName(buffer, 12), /troppi puntatori/);
});

test('mdns: le domande di un messaggio vengono estratte', () => {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4); // una domanda
  const question = Buffer.concat([encodeName('_wdeck._tcp.local'), Buffer.alloc(4)]);
  question.writeUInt16BE(12, question.length - 4); // PTR
  question.writeUInt16BE(1, question.length - 2); // IN

  const domande = parseQuestions(Buffer.concat([header, question]));
  assert.equal(domande.length, 1);
  assert.equal(domande[0].name, '_wdeck._tcp.local');
  assert.equal(domande[0].type, 12);
  assert.equal(domande[0].unicast, false);
});

test('mdns: una risposta non viene scambiata per una domanda', () => {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2); // bit QR: e' una risposta
  header.writeUInt16BE(1, 4);
  assert.deepEqual(parseQuestions(Buffer.concat([header, encodeName('x.local'), Buffer.alloc(4)])), []);
  assert.deepEqual(parseQuestions(Buffer.alloc(4)), [], 'un messaggio troppo corto non e\' una domanda');
});

test('mdns: i record hanno la forma prevista', () => {
  const record = encodeRecord({ name: 'wdeck.local', type: 1, data: encodeA('192.168.1.79'), ttl: 120, flush: true });
  const dopoNome = encodeName('wdeck.local').length;
  assert.equal(record.readUInt16BE(dopoNome), 1, 'tipo A');
  assert.equal(record.readUInt16BE(dopoNome + 2), 0x8001, 'classe IN con cache flush');
  assert.equal(record.readUInt32BE(dopoNome + 4), 120);
  assert.equal(record.readUInt16BE(dopoNome + 8), 4, 'un indirizzo IPv4 sono quattro byte');
});

test('mdns: un indirizzo non valido viene rifiutato', () => {
  assert.throws(() => encodeA('999.1.1.1'), /non valido/);
  assert.throws(() => encodeA('192.168.1'), /non valido/);
});

test('mdns: SRV porta priorita\', peso, porta e destinazione', () => {
  const srv = encodeSrv({ port: 8899, target: 'wdeck.local' });
  assert.equal(srv.readUInt16BE(0), 0);
  assert.equal(srv.readUInt16BE(2), 0);
  assert.equal(srv.readUInt16BE(4), 8899);
  assert.equal(decodeName(srv, 6).name, 'wdeck.local');
});

test('mdns: TXT scrive coppie chiave=valore con la loro lunghezza', () => {
  const txt = encodeTxt({ path: '/', version: '0.3.0' });
  assert.equal(txt[0], 6);
  assert.equal(txt.subarray(1, 7).toString(), 'path=/');
  assert.equal(txt[7], 13);
  assert.equal(txt.subarray(8, 21).toString(), 'version=0.3.0');
});

test('mdns: una risposta dichiara quante risposte contiene', () => {
  const answers = [
    encodeRecord({ name: 'a.local', type: 1, data: encodeA('10.0.0.1') }),
    encodeRecord({ name: 'b.local', type: 1, data: encodeA('10.0.0.2') })
  ];
  const message = buildResponse(answers);
  assert.equal(message.readUInt16BE(2), 0x8400, 'risposta autorevole');
  assert.equal(message.readUInt16BE(4), 0, 'nessuna domanda');
  assert.equal(message.readUInt16BE(6), 2);
});

test('mdns: il nome host e\' ripulito in una forma valida', () => {
  assert.equal(toLocalName('Wdeck Host'), 'wdeck-host.local');
  assert.equal(toLocalName('PC di Nicolò'), 'pc-di-nicolo.local');
  assert.equal(toLocalName('---'), 'wdeck.local');
  assert.equal(toLocalName(undefined), 'wdeck.local');
  assert.ok(toLocalName('x'.repeat(100)).length <= 38);
});
