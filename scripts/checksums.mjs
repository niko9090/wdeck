/**
 * Scrive `release/SHA256SUMS.txt` con l'impronta di ogni file distribuibile.
 *
 * Non e' un adempimento burocratico: e' il file che l'aggiornamento automatico
 * scarica **prima** di fidarsi dell'eseguibile appena preso. Senza, l'host
 * rifiuta di sostituirsi, perche' scaricare un binario e metterlo al posto di
 * quello in uso senza sapere cosa sia non e' un aggiornamento.
 *
 * Formato identico a quello di `sha256sum`, cosi' si verifica anche a mano:
 *
 *   sha256sum -c SHA256SUMS.txt
 *
 *   node scripts/checksums.mjs
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'release');
const NOME = 'SHA256SUMS.txt';

/** Roba di lavorazione, non di consegna. */
const IGNORA = new Set([NOME, '.sea']);

function raccogli(dir, out = []) {
  for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORA.has(voce.name)) continue;
    const full = path.join(dir, voce.name);
    if (voce.isDirectory()) raccogli(full, out);
    else out.push(full);
  }
  return out;
}

function main() {
  if (!fs.existsSync(RELEASE)) {
    console.error('Niente da firmare: la cartella release/ non esiste.');
    console.error('Costruisci prima qualcosa: npm run exe, npm run firmware, npm run package.');
    process.exit(1);
  }

  const file = raccogli(RELEASE).sort();
  if (file.length === 0) {
    console.error('La cartella release/ e\' vuota.');
    process.exit(1);
  }

  const righe = file.map((f) => {
    const impronta = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    // Solo il nome del file: negli allegati di una release i percorsi non esistono.
    return `${impronta}  ${path.basename(f)}`;
  });

  const dest = path.join(RELEASE, NOME);
  fs.writeFileSync(dest, `${righe.join('\n')}\n`);

  for (const riga of righe) console.log(`  ${riga}`);
  console.log(`\n  ${file.length} file in ${path.relative(ROOT, dest)}`);
  console.log('\nIMPRONTE OK');
}

main();
