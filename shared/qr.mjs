/**
 * Generatore di QR code, scritto qui perche' non si possono usare pacchetti.
 *
 * Serve a una cosa sola ma importante: far accoppiare un telefono inquadrando
 * lo schermo, invece di digitare un indirizzo e un PIN. E' l'unico modo per cui
 * "aprire Wdeck sul telefono" diventa un gesto e non una procedura.
 *
 * L'implementazione segue ISO/IEC 18004 nella sola parte che serve: modalita'
 * byte, versioni 1..10, tutti e quattro i livelli di correzione. Sono
 * abbondanti: un URL con token sta in una versione 4-5, e oltre la 10 il codice
 * diventa comunque troppo fitto per essere inquadrato da lontano.
 *
 * Il modulo e' condiviso fra host e client web: l'host lo usa per stampare il
 * QR nel terminale, il client per mostrarlo a schermo.
 */

// ------------------------------------------------------------------ tabelle

/** Livelli di correzione, con il valore a 2 bit usato nelle informazioni di formato. */
export const ECC_LEVELS = Object.freeze({
  L: { bits: 0b01, name: 'L' },
  M: { bits: 0b00, name: 'M' },
  Q: { bits: 0b11, name: 'Q' },
  H: { bits: 0b10, name: 'H' }
});

/**
 * Struttura dei blocchi per versione e livello:
 * `[codeword di correzione per blocco, blocchi gruppo 1, dati per blocco gruppo 1,
 *   blocchi gruppo 2, dati per blocco gruppo 2]`.
 *
 * I numeri vengono dalle tabelle 13-22 della norma. Non si controllano a
 * occhio: `totalCodewords()` li ricava dalla geometria della versione, e un
 * test verifica che le due strade portino allo stesso numero per ognuna delle
 * quaranta combinazioni. Un errore di trascrizione qui non passa.
 */
const BLOCKS = {
  1: { L: [7, 1, 19, 0, 0], M: [10, 1, 16, 0, 0], Q: [13, 1, 13, 0, 0], H: [17, 1, 9, 0, 0] },
  2: { L: [10, 1, 34, 0, 0], M: [16, 1, 28, 0, 0], Q: [22, 1, 22, 0, 0], H: [28, 1, 16, 0, 0] },
  3: { L: [15, 1, 55, 0, 0], M: [26, 1, 44, 0, 0], Q: [18, 2, 17, 0, 0], H: [22, 2, 13, 0, 0] },
  4: { L: [20, 1, 80, 0, 0], M: [18, 2, 32, 0, 0], Q: [26, 2, 24, 0, 0], H: [16, 4, 9, 0, 0] },
  5: { L: [26, 1, 108, 0, 0], M: [24, 2, 43, 0, 0], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
  6: { L: [18, 2, 68, 0, 0], M: [16, 4, 27, 0, 0], Q: [24, 4, 19, 0, 0], H: [28, 4, 15, 0, 0] },
  7: { L: [20, 2, 78, 0, 0], M: [18, 4, 31, 0, 0], Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
  8: { L: [24, 2, 97, 0, 0], M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
  9: { L: [30, 2, 116, 0, 0], M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
  10: { L: [18, 2, 68, 2, 69], M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] }
};

/** Versione massima gestita da questo modulo. */
export const MAX_VERSION = 10;

/** Dimensione del lato, in moduli, per una versione. */
export const sizeOf = (version) => 17 + 4 * version;

/**
 * Codeword totali (dati + correzione) di una versione.
 *
 * Ricavate dalla geometria invece che da una tabella: e' cio' che permette di
 * verificare la tabella dei blocchi invece di doversi fidare.
 * @param {number} version
 * @returns {number}
 */
export function totalCodewords(version) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    modules -= (25 * align - 10) * align - 55;
    if (version >= 7) modules -= 36;
  }
  return Math.floor(modules / 8);
}

/**
 * Posizioni dei centri dei pattern di allineamento.
 * @param {number} version
 * @returns {number[]}
 */
export function alignmentPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = sizeOf(version);
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let pos = size - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  return positions;
}

// ------------------------------------------------------------------ campo di Galois

// GF(256) con polinomio 0x11d, quello usato dai QR code.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/**
 * Polinomio generatore per `degree` codeword di correzione:
 * il prodotto di (x - alfa^i) per i da 0 a degree-1.
 *
 * I coefficienti sono restituiti dal grado piu' alto al piu' basso, cioe'
 * nell'ordine in cui li elenca la norma e in cui li vuole la divisione qui
 * sotto: il primo e' sempre 1.
 * @param {number} degree
 * @returns {Uint8Array}
 */
export function generatorPolynomial(degree) {
  // Durante il calcolo conviene tenere l'indice uguale al grado; alla fine si
  // rovescia, cosi' chi legge il risultato trova per primo il termine di testa.
  let poly = Uint8Array.from([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= gfMul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly.reverse();
}

/**
 * Codeword di correzione di Reed-Solomon per un blocco di dati.
 * @param {Uint8Array|number[]} data
 * @param {number} count quante codeword produrre
 * @returns {Uint8Array}
 */
export function reedSolomon(data, count) {
  const generator = generatorPolynomial(count);
  const remainder = new Uint8Array(count);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[count - 1] = 0;
    for (let i = 0; i < count; i += 1) remainder[i] ^= gfMul(generator[i + 1], factor);
  }
  return remainder;
}

// ------------------------------------------------------------------ codifica dei dati

/** Capacita' in byte di dati per versione e livello. */
export function dataCapacity(version, level) {
  const [ec, n1, d1, n2, d2] = BLOCKS[version][level];
  const dataCodewords = n1 * d1 + n2 * d2;
  // Il conto deve tornare con la geometria: se non torna, la tabella e' sbagliata.
  if (dataCodewords + ec * (n1 + n2) !== totalCodewords(version)) {
    throw new Error(`tabella dei blocchi incoerente per la versione ${version}, livello ${level}`);
  }
  // 4 bit di modalita' + 8 o 16 bit di lunghezza.
  const overheadBits = 4 + (version < 10 ? 8 : 16);
  return dataCodewords - Math.ceil(overheadBits / 8);
}

/**
 * Versione piu' piccola che contiene i dati.
 * @param {number} byteLength
 * @param {'L'|'M'|'Q'|'H'} level
 * @returns {number}
 */
export function chooseVersion(byteLength, level) {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    if (byteLength <= dataCapacity(version, level)) return version;
  }
  throw new Error(`testo troppo lungo per un QR code fino alla versione ${MAX_VERSION} `
    + `(${byteLength} byte, massimo ${dataCapacity(MAX_VERSION, level)})`);
}

/** Accumulatore di bit, scritti dal piu' significativo. */
class BitWriter {
  constructor() {
    this.bits = [];
  }

  put(value, length) {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >> i) & 1);
    return this;
  }

  get length() {
    return this.bits.length;
  }

  /** Completa fino al multiplo di 8 e restituisce i byte. */
  toBytes() {
    const bits = [...this.bits];
    while (bits.length % 8 !== 0) bits.push(0);
    const bytes = new Uint8Array(bits.length / 8);
    for (let i = 0; i < bytes.length; i += 1) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i * 8 + j];
      bytes[i] = byte;
    }
    return bytes;
  }
}

/**
 * Codeword finali (dati + correzione, interlacciate) per un testo.
 * @param {string} text
 * @param {{version: number, level: 'L'|'M'|'Q'|'H'}} spec
 * @returns {Uint8Array}
 */
export function encodeCodewords(text, { version, level }) {
  const payload = new TextEncoder().encode(text);
  const [ecPerBlock, n1, d1, n2, d2] = BLOCKS[version][level];
  const dataCodewords = n1 * d1 + n2 * d2;

  const writer = new BitWriter();
  writer.put(0b0100, 4); // modalita' byte
  writer.put(payload.length, version < 10 ? 8 : 16);
  for (const byte of payload) writer.put(byte, 8);

  // Terminatore: fino a 4 bit di zeri, se c'e' spazio.
  const capacityBits = dataCodewords * 8;
  writer.put(0, Math.min(4, capacityBits - writer.length));

  const bytes = writer.toBytes();
  const data = new Uint8Array(dataCodewords);
  data.set(bytes.subarray(0, dataCodewords));
  // Riempimento alternato, come prescrive la norma.
  for (let i = bytes.length; i < dataCodewords; i += 1) {
    data[i] = (i - bytes.length) % 2 === 0 ? 0xec : 0x11;
  }

  // Divisione in blocchi e correzione per ciascuno.
  const blocks = [];
  let offset = 0;
  for (const [count, size] of [[n1, d1], [n2, d2]]) {
    for (let i = 0; i < count; i += 1) {
      const block = data.subarray(offset, offset + size);
      offset += size;
      blocks.push({ data: block, ec: reedSolomon(block, ecPerBlock) });
    }
  }

  // Interlacciamento: un codeword per blocco a giro, prima i dati poi la
  // correzione. Serve a distribuire i danni fra i blocchi.
  const out = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of blocks) out.push(block.ec[i]);
  }
  return Uint8Array.from(out);
}

// ------------------------------------------------------------------ matrice

/** Le otto maschere previste dalla norma. */
export const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0
];

/**
 * Informazioni di formato: livello e maschera, protetti da un codice BCH(15,5)
 * e mescolati con una maschera fissa perche' non risultino mai tutti zeri.
 * @param {'L'|'M'|'Q'|'H'} level
 * @param {number} mask 0..7
 * @returns {number} 15 bit
 */
export function formatBits(level, mask) {
  const data = (ECC_LEVELS[level].bits << 3) | mask;
  let value = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((value >> i) & 1) value ^= 0x537 << (i - 10);
  }
  return ((data << 10) | value) ^ 0x5412;
}

/**
 * Informazioni di versione (solo dalla 7 in su), BCH(18,6).
 * @param {number} version
 * @returns {number} 18 bit
 */
export function versionBits(version) {
  let value = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((value >> i) & 1) value ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | value;
}

/** Matrice vuota con i soli pattern di servizio. */
function buildFunctionMatrix(version) {
  const size = sizeOf(version);
  const modules = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  const set = (row, col, value) => {
    if (row >= 0 && row < size && col >= 0 && col < size) modules[row][col] = value;
  };

  // Tre occhi di ricerca, con il loro bordo chiaro.
  for (const [r, c] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let i = -1; i <= 7; i += 1) {
      for (let j = -1; j <= 7; j += 1) {
        const bordo = i === -1 || i === 7 || j === -1 || j === 7;
        const anello = (i === 0 || i === 6 || j === 0 || j === 6);
        const centro = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        set(r + i, c + j, bordo ? 0 : (anello || centro ? 1 : 0));
      }
    }
  }

  // Pattern di temporizzazione.
  for (let i = 8; i < size - 8; i += 1) {
    modules[6][i] = i % 2 === 0 ? 1 : 0;
    modules[i][6] = i % 2 === 0 ? 1 : 0;
  }

  // Pattern di allineamento, tranne dove si sovrappongono agli occhi.
  const positions = alignmentPositions(version);
  for (const r of positions) {
    for (const c of positions) {
      const suOcchio = (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (suOcchio) continue;
      for (let i = -2; i <= 2; i += 1) {
        for (let j = -2; j <= 2; j += 1) {
          const anello = Math.max(Math.abs(i), Math.abs(j));
          set(r + i, c + j, anello === 1 ? 0 : 1);
        }
      }
    }
  }

  // Aree riservate alle informazioni di formato e versione: marcate occupate.
  for (let i = 0; i <= 8; i += 1) {
    if (modules[8][i] === -1) modules[8][i] = 0;
    if (modules[i][8] === -1) modules[i][8] = 0;
  }
  for (let i = 0; i < 8; i += 1) {
    if (modules[8][size - 1 - i] === -1) modules[8][size - 1 - i] = 0;
    if (modules[size - 1 - i][8] === -1) modules[size - 1 - i][8] = 0;
  }
  modules[size - 8][8] = 1; // modulo scuro, sempre acceso

  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const r = Math.floor(i / 3);
      const c = i % 3;
      modules[size - 11 + c][r] = 0;
      modules[r][size - 11 + c] = 0;
    }
  }

  return modules;
}

/** Copia della matrice con l'indicazione di quali moduli sono di servizio. */
function functionMask(version) {
  const base = buildFunctionMatrix(version);
  return base.map((row) => Int8Array.from(row, (v) => (v === -1 ? 0 : 1)));
}

/**
 * Scrive le codeword nella matrice seguendo il percorso a zig-zag.
 * @param {Int8Array[]} modules
 * @param {Int8Array[]} reserved
 * @param {Uint8Array} codewords
 */
function placeCodewords(modules, reserved, codewords) {
  const size = modules.length;
  let bit = 0;
  const nextBit = () => {
    const index = bit >> 3;
    const value = index < codewords.length ? (codewords[index] >> (7 - (bit & 7))) & 1 : 0;
    bit += 1;
    return value;
  };

  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    // La colonna 6 e' quella di temporizzazione: il percorso la salta.
    const rightCol = right <= 6 ? right - 1 : right;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [rightCol, rightCol - 1]) {
        if (reserved[row][col]) continue;
        modules[row][col] = nextBit();
      }
    }
    upward = !upward;
  }
}

/** Applica la maschera ai soli moduli di dati. */
function applyMask(modules, reserved, mask) {
  const rule = MASKS[mask];
  const size = modules.length;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!reserved[row][col] && rule(row, col)) modules[row][col] ^= 1;
    }
  }
}

/** Scrive le informazioni di formato nelle due posizioni previste. */
function drawFormat(modules, level, mask) {
  const size = modules.length;
  const bits = formatBits(level, mask);
  const bit = (i) => (bits >> i) & 1;

  for (let i = 0; i <= 5; i += 1) modules[8][i] = bit(i);
  modules[8][7] = bit(6);
  modules[8][8] = bit(7);
  modules[7][8] = bit(8);
  for (let i = 9; i <= 14; i += 1) modules[14 - i][8] = bit(i);

  for (let i = 0; i <= 7; i += 1) modules[size - 1 - i][8] = bit(i);
  for (let i = 8; i <= 14; i += 1) modules[8][size - 15 + i] = bit(i);
  modules[size - 8][8] = 1;
}

/** Scrive le informazioni di versione (dalla 7 in su). */
function drawVersion(modules, version) {
  if (version < 7) return;
  const size = modules.length;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i += 1) {
    const value = (bits >> i) & 1;
    const r = Math.floor(i / 3);
    const c = i % 3;
    modules[size - 11 + c][r] = value;
    modules[r][size - 11 + c] = value;
  }
}

/**
 * Penalita' di una matrice: piu' e' bassa, piu' il codice e' leggibile.
 * Le quattro regole sono quelle della norma.
 * @param {Int8Array[]} modules
 * @returns {number}
 */
export function penalty(modules) {
  const size = modules.length;
  let score = 0;

  // Regola 1: sequenze di cinque o piu' moduli dello stesso colore.
  const runs = (get) => {
    for (let a = 0; a < size; a += 1) {
      let run = 1;
      for (let b = 1; b < size; b += 1) {
        if (get(a, b) === get(a, b - 1)) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          run = 1;
        }
      }
    }
  };
  runs((r, c) => modules[r][c]);
  runs((c, r) => modules[r][c]);

  // Regola 2: blocchi 2x2 dello stesso colore.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }
  }

  // Regola 3: sequenze che somigliano a un occhio di ricerca.
  const pattern = [1, 0, 1, 1, 1, 0, 1];
  const hasPattern = (get, a, b) => {
    for (let i = 0; i < 7; i += 1) if (get(a, b + i) !== pattern[i]) return false;
    const primaChiara = [b - 4, b - 3, b - 2, b - 1].every((x) => x < 0 || get(a, x) === 0);
    const dopoChiara = [b + 7, b + 8, b + 9, b + 10].every((x) => x >= size || get(a, x) === 0);
    return primaChiara || dopoChiara;
  };
  for (let a = 0; a < size; a += 1) {
    for (let b = 0; b <= size - 7; b += 1) {
      if (hasPattern((x, y) => modules[x][y], a, b)) score += 40;
      if (hasPattern((x, y) => modules[y][x], a, b)) score += 40;
    }
  }

  // Regola 4: sbilanciamento fra moduli scuri e chiari.
  let dark = 0;
  for (const row of modules) for (const v of row) dark += v;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * Genera la matrice di un QR code.
 * @param {string} text
 * @param {{level?: 'L'|'M'|'Q'|'H', version?: number, mask?: number}} [options]
 * @returns {{modules: Int8Array[], size: number, version: number, level: string, mask: number}}
 */
export function encodeQr(text, { level = 'M', version, mask } = {}) {
  if (typeof text !== 'string' || text === '') throw new Error('testo mancante per il QR code');
  if (!ECC_LEVELS[level]) throw new Error(`livello di correzione sconosciuto: "${level}"`);

  const byteLength = new TextEncoder().encode(text).length;
  const chosen = version ?? chooseVersion(byteLength, level);
  if (chosen < 1 || chosen > MAX_VERSION) throw new Error(`versione fuori intervallo: ${chosen}`);
  if (byteLength > dataCapacity(chosen, level)) {
    throw new Error(`testo troppo lungo per la versione ${chosen} livello ${level}`);
  }

  const codewords = encodeCodewords(text, { version: chosen, level });
  const reserved = functionMask(chosen);

  /** Costruisce la matrice completa con una maschera data. */
  const build = (m) => {
    const modules = buildFunctionMatrix(chosen).map((row) => Int8Array.from(row, (v) => (v === -1 ? 0 : v)));
    placeCodewords(modules, reserved, codewords);
    applyMask(modules, reserved, m);
    drawFormat(modules, level, m);
    drawVersion(modules, chosen);
    return modules;
  };

  if (mask !== undefined) {
    return { modules: build(mask), size: sizeOf(chosen), version: chosen, level, mask };
  }

  // Si provano tutte e otto le maschere e si tiene quella che rende il codice
  // piu' facile da leggere. E' l'unico punto in cui la norma chiede di scegliere.
  let best = null;
  for (let m = 0; m < 8; m += 1) {
    const modules = build(m);
    const score = penalty(modules);
    if (!best || score < best.score) best = { modules, score, mask: m };
  }
  return { modules: best.modules, size: sizeOf(chosen), version: chosen, level, mask: best.mask };
}

// ------------------------------------------------------------------ resa

/**
 * QR come SVG, pronto da mettere in una pagina.
 * @param {string} text
 * @param {{level?: string, scale?: number, margin?: number, dark?: string, light?: string}} [options]
 * @returns {string}
 */
export function qrSvg(text, { level = 'M', scale = 6, margin = 4, dark = '#000000', light = '#ffffff' } = {}) {
  const { modules, size } = encodeQr(text, { level });
  const total = (size + margin * 2) * scale;

  // Un solo path per tutti i moduli scuri: molto piu' leggero di un rettangolo
  // per modulo, e i lettori guardano il contrasto, non il markup.
  const parts = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules[row][col]) parts.push(`M${(col + margin) * scale} ${(row + margin) * scale}h${scale}v${scale}h-${scale}z`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code">`
    + `<rect width="${total}" height="${total}" fill="${light}"/>`
    + `<path fill="${dark}" d="${parts.join('')}"/>`
    + '</svg>';
}

/**
 * QR disegnato con caratteri a blocchi, per il terminale.
 *
 * Ogni riga di testo contiene due righe di moduli usando i mezzi blocchi: senza
 * questo accorgimento il codice verrebbe schiacciato in verticale dalle celle
 * del terminale, che sono alte circa il doppio della loro larghezza, e i lettori
 * farebbero fatica.
 * @param {string} text
 * @param {{level?: string, margin?: number}} [options]
 * @returns {string}
 */
export function qrText(text, { level = 'M', margin = 4 } = {}) {
  const { modules, size } = encodeQr(text, { level });
  const at = (row, col) => {
    const r = row - margin;
    const c = col - margin;
    return r >= 0 && r < size && c >= 0 && c < size ? modules[r][c] : 0;
  };

  const width = size + margin * 2;
  const height = size + margin * 2;
  const lines = [];
  for (let row = 0; row < height; row += 2) {
    let line = '';
    for (let col = 0; col < width; col += 1) {
      const alto = at(row, col);
      const basso = row + 1 < height ? at(row + 1, col) : 0;
      // Chiaro = pieno, scuro = vuoto: nei terminali il testo e' chiaro su
      // fondo scuro, e un lettore ha bisogno che i moduli "scuri" del codice
      // siano quelli che riflettono meno luce sullo schermo.
      if (alto && basso) line += ' ';
      else if (alto) line += '▄';
      else if (basso) line += '▀';
      else line += '█';
    }
    lines.push(line);
  }
  return lines.join('\n');
}
