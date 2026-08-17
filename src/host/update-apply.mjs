/**
 * Aggiornamento dell'eseguibile: scarica, verifica e sostituisce.
 *
 * Vale **solo per `wdeck.exe`**. Chi gira dai sorgenti aggiorna con `git pull`,
 * e un programma che riscrive i file di un checkout altrui sarebbe una pessima
 * idea. Fuori da un eseguibile singolo questo modulo dice di no e spiega perche'.
 *
 * Tre cautele, perche' qui si sovrascrive un binario sul PC di qualcun altro:
 *
 *  1. **Non parte da solo.** Il controllo periodico si limita a segnalare; a
 *     scaricare si comincia solo su richiesta esplicita. Un programma che si
 *     sostituisce da se' mentre esegue comandi e' esattamente cio' che questo
 *     progetto non vuole essere.
 *  2. **Impronta verificata.** Il file scaricato deve corrispondere allo
 *     SHA-256 pubblicato in `SHA256SUMS.txt` accanto alla release. Senza, ci si
 *     fiderebbe soltanto del TLS e di chi ha accesso al repository.
 *  3. **Il vecchio non si butta.** Diventa `wdeck.exe.vecchio`: se la versione
 *     nuova non parte, si rinomina indietro e si e' di nuovo in piedi.
 *
 * Su Windows un eseguibile in esecuzione non si puo' cancellare, ma si puo'
 * **rinominare**: e' su questo che si regge la sostituzione a caldo.
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Suffisso della copia tenuta da parte per poter tornare indietro. */
export const SUFFISSO_VECCHIO = '.vecchio';

/** Il file di impronte che accompagna la release. */
export const FILE_IMPRONTE = 'SHA256SUMS.txt';

/**
 * Siamo dentro un eseguibile singolo? `node:sea` esiste dalla 20.12 e il
 * progetto gira dalla 20.10, quindi la domanda va posta con prudenza.
 * @returns {boolean}
 */
function dentroUnEseguibile() {
  try {
    return createRequire(import.meta.url)('node:sea').isSea();
  } catch {
    return false;
  }
}

/**
 * Dice se questo processo puo' sostituire se stesso, e se no perche'.
 *
 * @param {{platform?: string, isSea?: boolean, execPath?: string}} [ambiente]
 * @returns {{supported: boolean, reason: string|null, exePath: string|null}}
 */
export function selfUpdateSupport(ambiente = {}) {
  const platform = ambiente.platform ?? process.platform;
  const execPath = ambiente.execPath ?? process.execPath;
  let isSea = ambiente.isSea;
  if (isSea === undefined) isSea = dentroUnEseguibile();

  if (!isSea) {
    return {
      supported: false,
      exePath: null,
      reason: 'Wdeck sta girando dai sorgenti: si aggiorna con "git pull", non sostituendo un file.'
    };
  }
  if (platform !== 'win32') {
    return {
      supported: false,
      exePath: null,
      reason: 'L\'eseguibile singolo esiste solo per Windows.'
    };
  }
  return { supported: true, reason: null, exePath: execPath };
}

/**
 * Legge un file di impronte nel formato di `sha256sum`: "<impronta>  <nome>".
 * @param {string} testo
 * @returns {Map<string, string>} nome del file -> impronta in minuscolo
 */
export function parseChecksums(testo) {
  const out = new Map();
  for (const riga of String(testo).split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(riga.trim());
    if (m) out.set(path.basename(m[2]), m[1].toLowerCase());
  }
  return out;
}

/**
 * Calcola lo SHA-256 di un file senza caricarlo tutto in memoria.
 * @param {string} file
 * @returns {Promise<string>}
 */
export async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * Scarica un URL su disco, riferendo l'avanzamento.
 *
 * @param {string} url
 * @param {string} dest
 * @param {{onProgress?: (fatti: number, totale: number) => void, fetchImpl?: Function, timeoutMs?: number, maxBytes?: number}} [options]
 */
export async function downloadTo(url, dest, { onProgress, fetchImpl = fetch, timeoutMs = 300000, maxBytes = 0 } = {}) {
  // I reindirizzamenti si seguono a mano (redirect: 'manual') per poter rifiutare
  // ogni salto che non resti su https: con redirect: 'follow' i salti intermedi
  // sfuggirebbero al controllo e si potrebbe finire a scaricare in chiaro.
  let corrente = url;
  let risposta;
  for (let salti = 0; salti < 10; salti += 1) {
    if (!/^https:\/\//i.test(corrente)) {
      throw new Error(`rifiuto di scaricare da un indirizzo non cifrato: ${corrente}`);
    }
    risposta = await fetchImpl(corrente, {
      headers: { 'User-Agent': 'wdeck-update' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs)
    });
    const location = risposta.status >= 300 && risposta.status < 400
      ? risposta.headers?.get?.('location')
      : null;
    if (!location) break;
    corrente = new URL(location, corrente).toString();
  }
  if (!risposta.ok) throw new Error(`il download ha risposto ${risposta.status}`);

  const totale = Number(risposta.headers?.get?.('content-length') ?? 0);
  let fatti = 0;
  // `fetch` restituisce un ReadableStream del web; altre implementazioni danno
  // gia' qualcosa di iterabile. Si distinguono da getReader().
  const corpo = risposta.body;
  if (!corpo) throw new Error('risposta senza corpo');
  const sorgente = typeof corpo.getReader === 'function'
    ? Readable.fromWeb(corpo)
    : Readable.from(corpo);
  sorgente.on('data', (chunk) => {
    fatti += chunk.length;
    // Un tetto ai byte scaricati impedisce che un server malevolo (o un asset
    // sbagliato) riempia il disco: superata la soglia si interrompe subito.
    if (maxBytes && fatti > maxBytes) {
      sorgente.destroy(new Error(`il download supera la dimensione attesa (${maxBytes} byte): interrotto`));
      return;
    }
    onProgress?.(fatti, totale);
  });

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline(sorgente, fs.createWriteStream(dest));
  return { bytes: fatti };
}

/**
 * Impronta SHA-1 del certificato con cui Wdeck firma le proprie release: il
 * "pin". L'aggiornamento automatico si fida **solo** di questo certificato,
 * confrontandone l'impronta, invece di chiedere al sistema se la catena e'
 * attendibile. Cosi' un certificato self-signed (che nessun PC conosce) va bene
 * lo stesso, senza doverlo installare come radice fidata su ogni macchina - ma
 * un binario firmato da chiunque altro, o non firmato, viene rifiutato.
 *
 * Se un giorno il certificato cambia, qui va messa la nuova impronta e le
 * versioni pubblicate con quella nuova; i client sulle versioni vecchie non
 * potranno aggiornarsi da soli alla nuova (e' il prezzo del pinning) e andranno
 * reinstallati a mano una volta.
 */
export const FIRMA_ATTESA_SHA1 = '7BD743F7006625EB92FB055687DEB63EED9284B2';

/**
 * Verifica la firma Authenticode di un eseguibile su Windows.
 *
 * Con un'impronta attesa (`attesaSha1`, di default quella del progetto) si fa
 * **certificate pinning**: la firma deve essere integra e appartenere a quel
 * preciso certificato. Un self-signed risulta `UnknownError` (catena non
 * fidata) ma con firma intatta: va bene, perche' ci fidiamo dell'impronta, non
 * della catena. Un file manomesso risulta `HashMismatch` ed e' rifiutato.
 *
 * Senza impronta attesa si torna al comportamento severo: si pretende `Valid`,
 * cioe' una firma pienamente fidata dal sistema (utile con un certificato vero).
 *
 * Il percorso non si concatena mai in una stringa di comando: passa in una
 * variabile d'ambiente e si legge con `-LiteralPath`.
 *
 * @param {string} exePath
 * @param {{spawnImpl?: Function, attesaSha1?: string}} [options]
 * @returns {Promise<string>} risolve con lo stato della firma se accettata
 */
export function verificaFirmaWindows(exePath, { spawnImpl = spawn, attesaSha1 = FIRMA_ATTESA_SHA1 } = {}) {
  return new Promise((resolve, reject) => {
    const figlio = spawnImpl('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '$f = Get-AuthenticodeSignature -LiteralPath $Env:WDECK_EXE_DA_VERIFICARE; '
        + 'Write-Output $f.Status; Write-Output $f.SignerCertificate.Thumbprint'
    ], {
      env: { ...process.env, WDECK_EXE_DA_VERIFICARE: exePath },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    figlio.stdout?.on('data', (d) => { out += d; });
    figlio.stderr?.on('data', (d) => { err += d; });
    figlio.on('error', reject);
    figlio.on('close', (code) => {
      const righe = out.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
      const stato = righe[0] ?? '';
      const impronta = (righe[1] ?? '').toUpperCase();
      const atteso = String(attesaSha1 ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');

      if (atteso) {
        // Firma integra: `Valid` (fidata dal sistema) o `UnknownError` (catena
        // non fidata ma firma non manomessa, tipico di un self-signed). Un
        // `HashMismatch` o `NotSigned` non passano di qui.
        const integra = stato === 'Valid' || stato === 'UnknownError';
        if (impronta === atteso && integra) return resolve(stato);
        return reject(new Error(
          `firma non attesa (stato ${stato || 'ignoto'}, impronta ${impronta || 'assente'}): aggiornamento annullato`
        ));
      }

      if (stato === 'Valid') return resolve(stato);
      return reject(new Error(`firma Authenticode non valida (${stato || err.trim() || `uscita ${code}`}): aggiornamento annullato`));
    });
  });
}

/**
 * Toglie la copia di sicurezza lasciata da un aggiornamento precedente.
 *
 * Va chiamata all'avvio: mentre la versione nuova gira, la vecchia non serve
 * piu' - e se fosse la vecchia a girare, il file da cancellare sarebbe in uso e
 * la cancellazione fallirebbe da sola, senza danni.
 *
 * @param {string} exePath
 * @returns {boolean} true se ha ripulito qualcosa
 */
export function cleanupOldExe(exePath) {
  const vecchio = `${exePath}${SUFFISSO_VECCHIO}`;
  try {
    if (!fs.existsSync(vecchio)) return false;
    fs.rmSync(vecchio, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Scarica la release indicata e mette il nuovo eseguibile al posto di quello in
 * esecuzione. **Non riavvia**: chi chiama decide quando, perche' riavviare
 * significa interrompere chi sta usando il deck in quel momento.
 *
 * @param {object} spec
 * @param {{version: string, asset: {name: string, url: string, size?: number}|null, checksums?: {url: string}|null}} spec.release
 * @param {string} spec.exePath
 * @param {(fase: string, dettaglio?: object) => void} [spec.onProgress]
 * @param {Function} [spec.fetchImpl]
 * @param {Function} [spec.spawnImpl] iniettabile per la verifica della firma nei test
 * @returns {Promise<{ok: true, version: string, exePath: string, backup: string, sha256: string}>}
 */
export async function applyUpdate({ release, exePath, onProgress, fetchImpl = fetch, spawnImpl = spawn, attesaSha1 = FIRMA_ATTESA_SHA1 }) {
  if (!release?.asset?.url) throw new Error('la release non contiene un eseguibile da scaricare');
  if (!/\.exe$/i.test(release.asset.name ?? '')) {
    throw new Error(`l'allegato "${release.asset.name}" non e' un eseguibile`);
  }

  const cartella = path.dirname(exePath);
  const scaricato = path.join(cartella, `.wdeck-nuovo-${process.pid}.exe`);

  try {
    onProgress?.('download', { name: release.asset.name, size: release.asset.size ?? 0 });
    // Se la release dichiara una dimensione, si concede un piccolo margine e non
    // un byte di piu': oltre quel tetto il download si interrompe.
    const maxBytes = release.asset.size ? release.asset.size + 65536 : 0;
    await downloadTo(release.asset.url, scaricato, {
      fetchImpl,
      maxBytes,
      onProgress: (fatti, totale) => onProgress?.('progresso', { fatti, totale })
    });

    // --- verifica dell'impronta -------------------------------------------
    // Senza impronta pubblicata non si prosegue: scaricare un eseguibile e
    // metterlo al posto di quello in uso senza sapere cosa sia non e' un
    // aggiornamento, e' un salto nel vuoto.
    if (!release.checksums?.url) {
      throw new Error(`la release non pubblica ${FILE_IMPRONTE}: impossibile verificare cosa si e' scaricato`);
    }
    onProgress?.('verifica');
    const risposta = await fetchImpl(release.checksums.url, {
      headers: { 'User-Agent': 'wdeck-update' },
      signal: AbortSignal.timeout(30000)
    });
    if (!risposta.ok) throw new Error(`impronte non scaricabili (${risposta.status})`);
    const attese = parseChecksums(await risposta.text());
    const attesa = attese.get(release.asset.name);
    if (!attesa) throw new Error(`${FILE_IMPRONTE} non elenca ${release.asset.name}`);

    const trovata = await sha256File(scaricato);
    if (trovata !== attesa) {
      throw new Error(`impronta diversa da quella pubblicata: atteso ${attesa.slice(0, 16)}..., ottenuto ${trovata.slice(0, 16)}...`);
    }

    // --- verifica della firma Authenticode (solo Windows) -----------------
    // Difesa in profondita' oltre allo SHA-256: prima di rimpiazzare il binario
    // in uso si pretende una firma valida. Un eseguibile non firmato viene
    // rifiutato qui, senza toccare nulla.
    if (process.platform === 'win32') {
      onProgress?.('firma');
      await verificaFirmaWindows(scaricato, { spawnImpl, attesaSha1 });
    }

    // --- sostituzione ------------------------------------------------------
    // Un eseguibile in uso non si cancella ma si rinomina: e' il solo modo di
    // fare questo scambio su Windows senza un secondo processo.
    const backup = `${exePath}${SUFFISSO_VECCHIO}`;
    onProgress?.('sostituzione');
    fs.rmSync(backup, { force: true });
    fs.renameSync(exePath, backup);
    try {
      fs.renameSync(scaricato, exePath);
    } catch (err) {
      fs.renameSync(backup, exePath); // rimettiamo le cose com'erano
      throw err;
    }

    return { ok: true, version: release.version, exePath, backup, sha256: trovata };
  } finally {
    fs.rmSync(scaricato, { force: true });
  }
}

/**
 * Riavvia l'eseguibile con gli stessi argomenti e lascia morire questo processo.
 * @param {string} exePath
 * @param {string[]} [args]
 * @param {{delayMs?: number, spawnImpl?: Function, exitImpl?: Function}} [options]
 */
export function restart(exePath, args = process.argv.slice(2), { delayMs = 500, spawnImpl = spawn, exitImpl } = {}) {
  const figlio = spawnImpl(exePath, args, { detached: true, stdio: 'ignore' });
  figlio.unref?.();
  const uscita = exitImpl ?? ((code) => process.exit(code));
  const t = setTimeout(() => uscita(0), delayMs);
  t.unref?.();
  return figlio;
}
