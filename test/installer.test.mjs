/**
 * Installazione su Windows: niente finestra del terminale, e un'icona vera.
 *
 * I due pezzi collaudati qui sono quelli che decidono se il programma sembra
 * un'applicazione o uno script: il campo dell'intestazione PE che dice a
 * Windows di non aprire una console, e il file .ico che le scorciatoie
 * mostrano. Sbagliarli non da' un errore - da' un programma che *funziona* ma
 * si comporta come non deve.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { impostaSottosistemaGrafico } from '../scripts/build-exe.mjs';
import { costruisciIco } from '../scripts/gen-ico.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Un PE finto ma con l'intestazione vera dove serve: basta a collaudare la
 * modifica senza tenersi in repository un eseguibile da 84 MB.
 */
function peFinto({ subsystem = 3, magic = 0x20b, firma = 'PE\0\0' } = {}) {
  const bin = Buffer.alloc(512);
  bin.write('MZ', 0, 'ascii');
  const pe = 0x80;
  bin.writeUInt32LE(pe, 0x3c);
  bin.write(firma, pe, 'ascii');
  bin.writeUInt16LE(magic, pe + 24);
  bin.writeUInt16LE(subsystem, pe + 24 + 68);
  return bin;
}

function scrivi(bin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-pe-'));
  const file = path.join(dir, 'finto.exe');
  fs.writeFileSync(file, bin);
  return { dir, file };
}

const sottosistemaDi = (file) => {
  const bin = fs.readFileSync(file);
  return bin.readUInt16LE(bin.readUInt32LE(0x3c) + 24 + 68);
};

// ---------------------------------------------------------------- console

test('finestra: da console (3) a grafico (2), e nient\'altro cambia', () => {
  const originale = peFinto({ subsystem: 3 });
  const { dir, file } = scrivi(originale);

  const esito = impostaSottosistemaGrafico(file);
  assert.equal(esito.cambiato, true);
  assert.equal(esito.da, 3);
  assert.equal(sottosistemaDi(file), 2, 'Windows aprirebbe ancora un terminale');

  // Due byte, non uno di piu': il codice eseguito deve restare identico.
  const modificato = fs.readFileSync(file);
  assert.equal(modificato.length, originale.length);
  let diversi = 0;
  for (let i = 0; i < originale.length; i += 1) if (originale[i] !== modificato[i]) diversi += 1;
  assert.ok(diversi <= 2, `modificati ${diversi} byte, attesi al massimo 2`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('finestra: applicarlo due volte non rompe niente', () => {
  const { dir, file } = scrivi(peFinto({ subsystem: 2 }));
  const esito = impostaSottosistemaGrafico(file);
  assert.equal(esito.cambiato, true, 'gia\' grafico e\' un successo, non un errore');
  assert.equal(sottosistemaDi(file), 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('finestra: un file che non e\' un eseguibile viene rifiutato', () => {
  const { dir, file } = scrivi(Buffer.from('questo non e\' un PE, e non deve diventarlo'));
  const esito = impostaSottosistemaGrafico(file);
  assert.equal(esito.cambiato, false);
  assert.match(esito.motivo, /eseguibile Windows/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('finestra: un sottosistema inatteso non si tocca', () => {
  // 9 e' Windows CE: non sappiamo cosa sia, quindi non ci si mette le mani.
  const { dir, file } = scrivi(peFinto({ subsystem: 9 }));
  const esito = impostaSottosistemaGrafico(file);
  assert.equal(esito.cambiato, false);
  assert.equal(sottosistemaDi(file), 9, 'lasciato com\'era');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- icona

test('icona: l\'ICO ha l\'intestazione che Windows si aspetta', () => {
  const misure = [16, 32, 256];
  const ico = costruisciIco(misure);

  assert.equal(ico.readUInt16LE(0), 0, 'campo riservato');
  assert.equal(ico.readUInt16LE(2), 1, '1 = icona (2 sarebbe un cursore)');
  assert.equal(ico.readUInt16LE(4), misure.length);

  misure.forEach((size, i) => {
    const p = 6 + i * 16;
    // 256 non entra in un byte: per convenzione ci va 0.
    assert.equal(ico.readUInt8(p), size >= 256 ? 0 : size, `larghezza della misura ${size}`);
    assert.equal(ico.readUInt8(p + 1), size >= 256 ? 0 : size, `altezza della misura ${size}`);
    assert.equal(ico.readUInt16LE(p + 6), 32, 'bit per pixel');
  });
});

test('icona: ogni voce punta a un PNG vero, dentro il file', () => {
  const misure = [16, 32, 256];
  const ico = costruisciIco(misure);
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  misure.forEach((size, i) => {
    const p = 6 + i * 16;
    const lunghezza = ico.readUInt32LE(p + 8);
    const offset = ico.readUInt32LE(p + 12);
    assert.ok(offset + lunghezza <= ico.length, `la misura ${size} punta fuori dal file`);
    assert.deepEqual(ico.subarray(offset, offset + 8), PNG, `la misura ${size} non e' un PNG`);
  });
});

// ---------------------------------------------------------------- installer

test('installer: lo script Inno esiste e dichiara cosa serve', () => {
  const iss = fs.readFileSync(path.join(ROOT, 'installer', 'wdeck.iss'), 'utf8');

  // Le tre cose che distinguono un'installazione vera da una cartella copiata.
  assert.match(iss, /\[Icons\]/, 'senza scorciatoie non c\'e\' icona da cliccare');
  assert.match(iss, /autodesktop/, 'manca l\'icona sul desktop');
  assert.match(iss, /userstartup/, 'manca l\'avvio automatico');
  assert.match(iss, /UninstallDisplayIcon/, 'manca la voce di disinstallazione');

  // Niente UAC: un deck non ha ragione di chiedere i diritti di amministratore.
  assert.match(iss, /PrivilegesRequired=lowest/);

  // La configurazione dell'utente non si tocca disinstallando: si rimuovono
  // solo i file estratti e i diari.
  // Solo le direttive, non i commenti: qui conta cosa fa, non cosa spiega.
  const daCancellare = iss
    .slice(iss.indexOf('[UninstallDelete]'), iss.indexOf('[Code]'))
    .split(/\r?\n/)
    .filter((r) => r.trim().startsWith('Type:'))
    .join('\n');

  assert.ok(daCancellare.length > 0, 'nessuna regola di pulizia');
  assert.ok(!/deck\.json/.test(daCancellare), 'la disinstallazione non deve toccare deck.json');
  assert.ok(!/icons/.test(daCancellare), 'le icone caricate dall\'utente restano sue');
  assert.match(daCancellare, /runtime/, 'i file estratti invece vanno via');
});

test('installer: i comandi sono dichiarati in package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.installer, 'node scripts/build-installer.mjs');
  assert.deepEqual(pkg.dependencies, {}, 'Inno Setup e\' un attrezzo, non una dipendenza');
});
