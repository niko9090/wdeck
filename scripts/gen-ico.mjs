/**
 * Costruisce `installer/wdeck.ico` dalle stesse forme dell'icona della PWA.
 *
 * Serve per le scorciatoie del menu Start e del desktop, per l'icona
 * dell'installer e per quella nell'area di notifica: Windows vuole un `.ico`,
 * non un PNG. Il formato e' una tabella di voci seguita dalle immagini vere;
 * da Vista in poi ogni immagine puo' essere un PNG, quindi si riusa l'encoder
 * che il progetto ha gia' - nessuna dipendenza, nessun convertitore esterno.
 *
 *   node scripts/gen-ico.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { deckPainter, encodePng } from './gen-icons.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'installer', 'wdeck.ico');

/**
 * Le misure che Windows va a cercare: la lista piccola serve alla barra delle
 * applicazioni e all'area di notifica, la 256 all'anteprima grande in Esplora
 * risorse. Sotto i 32 pixel il bordo arrotondato mangia il disegno, quindi
 * li' si riduce il margine.
 */
const MISURE = [16, 20, 24, 32, 48, 64, 128, 256];

export function costruisciIco(misure = MISURE) {
  const immagini = misure.map((size) => ({
    size,
    png: encodePng(size, deckPainter(size, { padding: size <= 32 ? 0.06 : 0.14 }))
  }));

  const VOCE = 16;
  const intestazione = Buffer.alloc(6 + VOCE * immagini.length);
  intestazione.writeUInt16LE(0, 0); // riservato
  intestazione.writeUInt16LE(1, 2); // 1 = icona (2 sarebbe un cursore)
  intestazione.writeUInt16LE(immagini.length, 4);

  let offset = intestazione.length;
  immagini.forEach((img, i) => {
    const p = 6 + i * VOCE;
    // 256 non entra in un byte: per convenzione si scrive 0.
    intestazione.writeUInt8(img.size >= 256 ? 0 : img.size, p);
    intestazione.writeUInt8(img.size >= 256 ? 0 : img.size, p + 1);
    intestazione.writeUInt8(0, p + 2); // colori nella tavolozza: nessuna
    intestazione.writeUInt8(0, p + 3); // riservato
    intestazione.writeUInt16LE(1, p + 4); // piani
    intestazione.writeUInt16LE(32, p + 6); // bit per pixel
    intestazione.writeUInt32LE(img.png.length, p + 8);
    intestazione.writeUInt32LE(offset, p + 12);
    offset += img.png.length;
  });

  return Buffer.concat([intestazione, ...immagini.map((i) => i.png)]);
}

function main() {
  const ico = costruisciIco();
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.writeFileSync(DEST, ico);

  console.log(`  ${path.relative(ROOT, DEST)}`);
  console.log(`  ${MISURE.length} misure: ${MISURE.join(', ')}`);
  console.log(`  ${ico.length} byte`);
  console.log('\nICONA OK');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
