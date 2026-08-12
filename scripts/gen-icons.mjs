#!/usr/bin/env node
/**
 * Genera le icone PNG della PWA senza dipendenze esterne
 * (encoder PNG minimale basato su zlib).
 *
 * Uso: node scripts/gen-icons.mjs
 * Output: web/icons/icon-192.png, icon-512.png, icon-maskable-512.png
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'web', 'icons');

// ---------------------------------------------------------------- PNG encoder

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * @param {number} size
 * @param {(x:number,y:number)=>[number,number,number,number]} painter
 * @returns {Buffer} contenuto PNG
 */
function encodePng(size, painter) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filtro "none"
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = painter(x, y);
      const p = rowStart + 1 + x * 4;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------------------------------------------------------------- disegno

const BG = [18, 21, 28, 255];
const ACCENT = [76, 141, 255, 255];
const ACCENT_DIM = [42, 60, 96, 255];
const LIGHT = [231, 236, 243, 255];

/** true se (x,y) e' dentro un rettangolo con angoli arrotondati. */
function inRoundedRect(x, y, rx, ry, w, h, radius) {
  if (x < rx || y < ry || x >= rx + w || y >= ry + h) return false;
  const dx = Math.min(x - rx, rx + w - 1 - x);
  const dy = Math.min(y - ry, ry + h - 1 - y);
  if (dx >= radius || dy >= radius) return true;
  const cx = dx < radius ? radius : dx;
  const cy = dy < radius ? radius : dy;
  return (cx - dx) ** 2 + (cy - dy) ** 2 <= radius ** 2;
}

/**
 * Icona "deck": griglia 3x3 di tasti, quello centrale acceso.
 * @param {number} size
 * @param {{padding?: number, fullBleed?: boolean}} [options]
 */
function deckPainter(size, { padding = 0.14, fullBleed = false } = {}) {
  const margin = Math.round(size * padding);
  const gap = Math.max(2, Math.round(size * 0.035));
  const inner = size - margin * 2;
  const cell = Math.floor((inner - gap * 2) / 3);
  const radius = Math.max(2, Math.round(cell * 0.22));
  const outerRadius = Math.round(size * 0.22);

  return (x, y) => {
    const insideCard = fullBleed || inRoundedRect(x, y, 0, 0, size, size, outerRadius);
    if (!insideCard) return [0, 0, 0, 0];

    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const cx = margin + col * (cell + gap);
        const cy = margin + row * (cell + gap);
        if (inRoundedRect(x, y, cx, cy, cell, cell, radius)) {
          if (row === 1 && col === 1) return LIGHT;
          return (row + col) % 2 === 0 ? ACCENT : ACCENT_DIM;
        }
      }
    }
    return BG;
  };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const targets = [
    { file: 'icon-192.png', size: 192, options: { padding: 0.14 } },
    { file: 'icon-512.png', size: 512, options: { padding: 0.14 } },
    { file: 'icon-maskable-512.png', size: 512, options: { padding: 0.26, fullBleed: true } }
  ];

  for (const { file, size, options } of targets) {
    const png = encodePng(size, deckPainter(size, options));
    fs.writeFileSync(path.join(OUT_DIR, file), png);
    console.log(`generata ${path.relative(ROOT, path.join(OUT_DIR, file))} (${size}x${size}, ${png.length} byte)`);
  }
}

main();
