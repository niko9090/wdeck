/**
 * Aggiornamento dell'eseguibile.
 *
 * Qui si sovrascrive un binario sul PC di qualcun altro: i casi che contano non
 * sono quelli in cui va tutto bene, ma quelli in cui qualcosa non torna e il
 * programma deve **rifiutarsi** invece di proseguire. Un aggiornamento che
 * installa il file sbagliato e' peggio di un aggiornamento che non parte.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyUpdate,
  cleanupOldExe,
  downloadTo,
  FIRMA_ATTESA_SHA1,
  parseChecksums,
  restart,
  selfUpdateSupport,
  sha256File,
  SUFFISSO_VECCHIO,
  verificaFirmaWindows
} from '../src/host/update-apply.mjs';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-agg-'));
}

const sha = (testo) => crypto.createHash('sha256').update(testo).digest('hex');

/**
 * Finto `spawn` per la verifica Authenticode: restituisce lo stato e l'impronta
 * indicati senza chiamare PowerShell (la verifica scatta solo su win32, dove i
 * test girano su binari finti). Di default l'impronta e' quella attesa dal pin,
 * cosi' basta variare lo stato per collaudare i vari esiti.
 */
function firmaFinta(stato, impronta = FIRMA_ATTESA_SHA1) {
  return () => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setImmediate(() => {
      proc.stdout.emit('data', Buffer.from(`${stato}\r\n${impronta}\r\n`));
      proc.emit('close', stato === 'Valid' ? 0 : 1);
    });
    return proc;
  };
}

/** Finto GitHub: risponde con un eseguibile e le sue impronte. */
function finteRisposte({ contenuto = 'EXE NUOVO', impronta, nome = 'wdeck.exe' } = {}) {
  const somme = `${impronta ?? sha(contenuto)}  ${nome}\n`;
  return async (url) => {
    if (String(url).endsWith('SHA256SUMS.txt')) {
      return { ok: true, status: 200, text: async () => somme };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(Buffer.byteLength(contenuto)) },
      body: (async function* () { yield Buffer.from(contenuto); })()
    };
  };
}

const release = (extra = {}) => ({
  version: '9.9.9',
  asset: { name: 'wdeck.exe', url: 'https://example.invalid/wdeck.exe', size: 9 },
  checksums: { url: 'https://example.invalid/SHA256SUMS.txt' },
  ...extra
});

// ---------------------------------------------------------------- supporto

test('supporto: dai sorgenti non si aggiorna sostituendo file', () => {
  const esito = selfUpdateSupport({ isSea: false, platform: 'win32' });
  assert.equal(esito.supported, false);
  assert.match(esito.reason, /git pull/);
});

test('supporto: l\'eseguibile singolo esiste solo su Windows', () => {
  const esito = selfUpdateSupport({ isSea: true, platform: 'darwin' });
  assert.equal(esito.supported, false);
  assert.match(esito.reason, /Windows/);
});

test('supporto: dentro l\'exe su Windows si puo\'', () => {
  const esito = selfUpdateSupport({ isSea: true, platform: 'win32', execPath: 'C:\\W\\wdeck.exe' });
  assert.equal(esito.supported, true);
  assert.equal(esito.exePath, 'C:\\W\\wdeck.exe');
});

// ---------------------------------------------------------------- impronte

test('impronte: si legge il formato di sha256sum, percorsi compresi', () => {
  const mappa = parseChecksums([
    `${'a'.repeat(64)}  wdeck.exe`,
    `${'b'.repeat(64)} *release/firmware.bin`,
    'riga che non c\'entra niente',
    ''
  ].join('\n'));
  assert.equal(mappa.get('wdeck.exe'), 'a'.repeat(64));
  assert.equal(mappa.get('firmware.bin'), 'b'.repeat(64), 'il percorso va ignorato');
  assert.equal(mappa.size, 2);
});

test('impronte: sha256File legge davvero il contenuto', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'x.bin');
  fs.writeFileSync(file, 'contenuto');
  assert.equal(await sha256File(file), sha('contenuto'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- download

test('download: si rifiuta un indirizzo non cifrato', async () => {
  await assert.rejects(
    () => downloadTo('http://example.invalid/wdeck.exe', path.join(tempDir(), 'a.exe')),
    /non cifrato/
  );
});

test('download: l\'avanzamento viene riferito', async () => {
  const dir = tempDir();
  const dest = path.join(dir, 'scaricato.exe');
  const visti = [];
  await downloadTo('https://example.invalid/x', dest, {
    fetchImpl: finteRisposte({ contenuto: 'dodici byte' }),
    onProgress: (fatti, totale) => visti.push([fatti, totale])
  });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'dodici byte');
  assert.ok(visti.length > 0, 'nessun avanzamento riferito');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('download: un reindirizzamento verso http viene rifiutato', async () => {
  // Il primo salto e' https, ma reindirizza in chiaro: seguendo i redirect a
  // mano il secondo salto va rifiutato prima ancora di leggerne il corpo.
  const fetchImpl = async (url) => {
    if (/^https:\/\//i.test(url)) {
      return {
        ok: false,
        status: 302,
        headers: { get: (k) => (String(k).toLowerCase() === 'location' ? 'http://insicuro.invalid/wdeck.exe' : null) }
      };
    }
    throw new Error('non si sarebbe dovuto scaricare da http');
  };
  await assert.rejects(
    () => downloadTo('https://example.invalid/wdeck.exe', path.join(tempDir(), 'a.exe'), { fetchImpl }),
    /non cifrato/
  );
});

test('download: oltre la dimensione attesa ci si ferma', async () => {
  const dir = tempDir();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => '50' },
    body: (async function* () { yield Buffer.from('a'.repeat(500)); })()
  });
  await assert.rejects(
    () => downloadTo('https://example.invalid/x', path.join(dir, 'a.exe'), { fetchImpl, maxBytes: 100 }),
    /supera la dimensione/
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- sostituzione

test('aggiornamento: l\'exe viene sostituito e il vecchio resta da parte', async () => {
  const dir = tempDir();
  const exe = path.join(dir, 'wdeck.exe');
  fs.writeFileSync(exe, 'EXE VECCHIO');

  const esito = await applyUpdate({
    release: release(),
    exePath: exe,
    fetchImpl: finteRisposte({ contenuto: 'EXE NUOVO' }),
    spawnImpl: firmaFinta('Valid')
  });

  assert.equal(esito.ok, true);
  assert.equal(fs.readFileSync(exe, 'utf8'), 'EXE NUOVO');
  assert.equal(fs.readFileSync(`${exe}${SUFFISSO_VECCHIO}`, 'utf8'), 'EXE VECCHIO',
    'senza copia di sicurezza non si torna indietro');
  assert.equal(esito.sha256, sha('EXE NUOVO'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('aggiornamento: impronta diversa -> non si tocca nulla', async () => {
  const dir = tempDir();
  const exe = path.join(dir, 'wdeck.exe');
  fs.writeFileSync(exe, 'EXE VECCHIO');

  // Il file scaricato non e' quello che la release dichiara: e' il caso che
  // giustifica da solo l'esistenza della verifica.
  await assert.rejects(
    () => applyUpdate({
      release: release(),
      exePath: exe,
      fetchImpl: finteRisposte({ contenuto: 'ROBA DIVERSA', impronta: sha('EXE ATTESO') })
    }),
    /impronta diversa/
  );

  assert.equal(fs.readFileSync(exe, 'utf8'), 'EXE VECCHIO', 'l\'eseguibile in uso non va toccato');
  assert.equal(fs.existsSync(`${exe}${SUFFISSO_VECCHIO}`), false, 'nessuna copia a meta\' strada');
  assert.deepEqual(fs.readdirSync(dir), ['wdeck.exe'], 'niente file di scarto');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('aggiornamento: firma assente -> non si sostituisce nulla', { skip: process.platform !== 'win32' }, async () => {
  const dir = tempDir();
  const exe = path.join(dir, 'wdeck.exe');
  fs.writeFileSync(exe, 'EXE VECCHIO');

  // Impronta corretta del file (SHA-256) ma eseguibile non firmato: la verifica
  // deve bloccare tutto prima del rename, lasciando l'eseguibile in uso intatto.
  await assert.rejects(
    () => applyUpdate({
      release: release(),
      exePath: exe,
      fetchImpl: finteRisposte({ contenuto: 'EXE NUOVO' }),
      spawnImpl: firmaFinta('NotSigned', '')
    }),
    /firma non attesa/
  );

  assert.equal(fs.readFileSync(exe, 'utf8'), 'EXE VECCHIO', 'l\'eseguibile in uso non va toccato');
  assert.equal(fs.existsSync(`${exe}${SUFFISSO_VECCHIO}`), false, 'nessuna copia a meta\' strada');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('aggiornamento: un self-signed con l\'impronta attesa viene accettato', { skip: process.platform !== 'win32' }, async () => {
  const dir = tempDir();
  const exe = path.join(dir, 'wdeck.exe');
  fs.writeFileSync(exe, 'EXE VECCHIO');

  // Un certificato self-signed da' stato "UnknownError" (catena non fidata) ma
  // firma integra: col pinning, se l'impronta e' quella del progetto, va bene.
  const esito = await applyUpdate({
    release: release(),
    exePath: exe,
    fetchImpl: finteRisposte({ contenuto: 'EXE NUOVO' }),
    spawnImpl: firmaFinta('UnknownError')
  });
  assert.equal(esito.ok, true);
  assert.equal(fs.readFileSync(exe, 'utf8'), 'EXE NUOVO');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('aggiornamento: una firma di un altro certificato viene rifiutata', { skip: process.platform !== 'win32' }, async () => {
  const dir = tempDir();
  const exe = path.join(dir, 'wdeck.exe');
  fs.writeFileSync(exe, 'EXE VECCHIO');

  // Firma perfettamente valida, ma di un certificato che non e' il nostro: il
  // pin deve rifiutarla, altrimenti chiunque potrebbe firmare un aggiornamento.
  await assert.rejects(
    () => applyUpdate({
      release: release(),
      exePath: exe,
      fetchImpl: finteRisposte({ contenuto: 'EXE NUOVO' }),
      spawnImpl: firmaFinta('Valid', 'AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555')
    }),
    /firma non attesa/
  );
  assert.equal(fs.readFileSync(exe, 'utf8'), 'EXE VECCHIO', 'l\'eseguibile in uso non va toccato');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('firma: il pin accetta Valid e UnknownError con l\'impronta giusta, non gli altri', async () => {
  const buono = FIRMA_ATTESA_SHA1;
  assert.equal(await verificaFirmaWindows('x', { spawnImpl: firmaFinta('Valid', buono) }), 'Valid');
  assert.equal(await verificaFirmaWindows('x', { spawnImpl: firmaFinta('UnknownError', buono) }), 'UnknownError');
  await assert.rejects(() => verificaFirmaWindows('x', { spawnImpl: firmaFinta('HashMismatch', buono) }), /firma non attesa/);
  await assert.rejects(() => verificaFirmaWindows('x', { spawnImpl: firmaFinta('Valid', 'FF00') }), /firma non attesa/);
});

test('firma: senza pin (impronta vuota) si torna a pretendere Valid dal sistema', async () => {
  assert.equal(await verificaFirmaWindows('x', { spawnImpl: firmaFinta('Valid'), attesaSha1: '' }), 'Valid');
  await assert.rejects(
    () => verificaFirmaWindows('x', { spawnImpl: firmaFinta('UnknownError'), attesaSha1: '' }),
    /firma Authenticode non valida/
  );
});

test('aggiornamento: senza impronte pubblicate ci si ferma', async () => {
  const dir = tempDir();
  const exe = path.join(dir, 'wdeck.exe');
  fs.writeFileSync(exe, 'EXE VECCHIO');

  await assert.rejects(
    () => applyUpdate({
      release: release({ checksums: null }),
      exePath: exe,
      fetchImpl: finteRisposte()
    }),
    /SHA256SUMS/
  );
  assert.equal(fs.readFileSync(exe, 'utf8'), 'EXE VECCHIO');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('aggiornamento: un allegato che non e\' un eseguibile viene rifiutato', async () => {
  const dir = tempDir();
  const exe = path.join(dir, 'wdeck.exe');
  fs.writeFileSync(exe, 'EXE VECCHIO');
  await assert.rejects(
    () => applyUpdate({
      release: release({ asset: { name: 'wdeck-0.4.0.zip', url: 'https://example.invalid/a.zip' } }),
      exePath: exe,
      fetchImpl: finteRisposte()
    }),
    /non e' un eseguibile/
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('aggiornamento: senza allegato non si prova nemmeno', async () => {
  await assert.rejects(
    () => applyUpdate({ release: release({ asset: null }), exePath: 'C:\\W\\wdeck.exe' }),
    /non contiene un eseguibile/
  );
});

// ---------------------------------------------------------------- pulizia

test('pulizia: la copia della versione precedente viene tolta all\'avvio', () => {
  const dir = tempDir();
  const exe = path.join(dir, 'wdeck.exe');
  fs.writeFileSync(exe, 'nuovo');
  fs.writeFileSync(`${exe}${SUFFISSO_VECCHIO}`, 'vecchio');

  assert.equal(cleanupOldExe(exe), true);
  assert.equal(fs.existsSync(`${exe}${SUFFISSO_VECCHIO}`), false);
  assert.equal(cleanupOldExe(exe), false, 'la seconda volta non c\'e\' piu\' niente da togliere');
  assert.equal(fs.existsSync(exe), true, 'l\'eseguibile in uso non si tocca');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- riavvio

test('riavvio: si rilancia lo stesso eseguibile con gli stessi argomenti', () => {
  const chiamate = [];
  let uscito = null;
  restart('C:\\W\\wdeck.exe', ['--port', '9000'], {
    delayMs: 1,
    spawnImpl: (cmd, args, opts) => {
      chiamate.push({ cmd, args, opts });
      return { unref() {} };
    },
    exitImpl: (code) => { uscito = code; }
  });

  assert.equal(chiamate.length, 1);
  assert.equal(chiamate[0].cmd, 'C:\\W\\wdeck.exe');
  assert.deepEqual(chiamate[0].args, ['--port', '9000']);
  assert.equal(chiamate[0].opts.detached, true, 'staccato, altrimenti muore col padre');
  assert.equal(uscito, null, 'l\'uscita e\' differita, non immediata');
});
