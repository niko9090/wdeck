/**
 * Avvio dell'eseguibile singolo (Node SEA).
 *
 * Node incorpora **un solo script**, e lo esegue come CommonJS: Wdeck invece e'
 * una quarantina di moduli ESM che si importano fra loro. Il ponte fra le due
 * cose e' qui: i sorgenti viaggiano dentro l'exe come *asset*, questo script li
 * riversa su disco una volta sola e poi importa l'host vero.
 *
 * La cartella di lavoro e' `%LOCALAPPDATA%\Wdeck` (l'equivalente sugli altri
 * sistemi), scelta per una ragione precisa: la configurazione dell'utente non
 * deve stare dentro i file estratti, altrimenti il primo aggiornamento se la
 * porterebbe via. I moduli stanno in `runtime/<impronta>/` e sono usa e getta;
 * `deck.json` sta un livello sopra e non viene mai toccato.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sea = require('node:sea');
const { pathToFileURL } = require('node:url');

/** Cartella dati dell'utente, quella che sopravvive agli aggiornamenti. */
function dataHome() {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
}

/**
 * Dove vivono i file. Calcolato quando serve e non all'import: gli asset
 * esistono solo dentro l'eseguibile, e leggerli altrove sarebbe un errore.
 */
function layout() {
  const manifest = JSON.parse(sea.getAsset('MANIFEST', 'utf8'));
  const home = path.join(dataHome(), 'Wdeck');
  return { manifest, home, runtimeDir: path.join(home, 'runtime', manifest.stamp) };
}

/**
 * Estrae i moduli solo se mancano o se l'exe e' cambiato. L'impronta e' nel
 * nome della cartella, quindi due versioni possono convivere e un exe vecchio
 * continua a trovare i propri file.
 */
function extract({ manifest, runtimeDir }) {
  const marker = path.join(runtimeDir, '.wdeck-runtime');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === manifest.stamp) return;

  const staging = `${runtimeDir}.tmp-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  for (const file of manifest.files) {
    const dest = path.join(staging, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(sea.getAsset(file)));
  }
  fs.writeFileSync(path.join(staging, '.wdeck-runtime'), manifest.stamp);

  // Rinomina atomica: un'estrazione interrotta a meta' non lascia mai una
  // cartella che sembra buona ma non lo e'.
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(runtimeDir), { recursive: true });
  fs.renameSync(staging, runtimeDir);
}

/** Alla prima esecuzione mette una configurazione di partenza, poi mai piu'. */
function seedConfig(home) {
  const configFile = path.join(home, 'deck.json');
  if (!fs.existsSync(configFile)) {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(configFile, Buffer.from(sea.getAsset('deck.default.json')));
  }
  return configFile;
}

/**
 * Dentro un SEA `process.argv` non ha la forma [node, script, ...] che
 * `parseArgs` si aspetta: senza normalizzarla, il primo argomento dell'utente
 * verrebbe scartato dallo `slice(2)`. Funzione pura, cosi' e' collaudabile
 * senza costruire un eseguibile.
 *
 * @param {string[]} argv    process.argv com'e' arrivato
 * @param {string} execPath  process.execPath
 * @param {string} configFile  configurazione da usare se l'utente non ne indica una
 * @returns {string[]} il nuovo process.argv
 */
function normalizeArgs(argv, execPath, configFile) {
  const given = argv.slice(1).filter((a) => a !== execPath);
  const args = given.includes('--config') ? given : ['--config', configFile, ...given];
  return [execPath, execPath, ...args];
}

function main() {
  const paths = layout();
  extract(paths);
  const configFile = seedConfig(paths.home);
  process.argv = normalizeArgs(process.argv, process.execPath, configFile);

  const entry = path.join(paths.runtimeDir, 'bin', 'wdeck.mjs');
  return import(pathToFileURL(entry).href);
}

module.exports = { dataHome, normalizeArgs };

// Fuori da un eseguibile questo file e' solo una libreria: gli asset non
// esistono e avviare non avrebbe senso. Cosi' i test possono importarlo.
if (sea.isSea()) {
  main().catch((err) => {
    console.error(`\n[wdeck] avvio fallito:\n${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}
