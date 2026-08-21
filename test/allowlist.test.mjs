import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkExecutable, checkUrl, globToRegExp, normalizeForCompare } from '../src/host/security/allowlist.mjs';

const BASE = process.platform === 'win32' ? 'C:\\progetti\\wdeck' : '/progetti/wdeck';
const abs = (p) => (process.platform === 'win32' ? `C:\\${p.replace(/\//g, '\\')}` : `/${p}`);

test('allowlist: normalizeForCompare uniforma i separatori', () => {
  assert.equal(normalizeForCompare('a/b/../c'), normalizeForCompare('a/c'));
  assert.ok(!normalizeForCompare('a\\b').includes('\\'));
});

test('allowlist: globToRegExp gestisce * e **', () => {
  assert.ok(globToRegExp('/app/*.exe').test('/app/tool.exe'));
  assert.ok(!globToRegExp('/app/*.exe').test('/app/sub/tool.exe'));
  assert.ok(globToRegExp('/app/**').test('/app/sub/tool.exe'));
  assert.ok(globToRegExp('/app/**/*.ps1').test('/app/a/b/x.ps1'));
  assert.ok(!globToRegExp('/app/*').test('/altro/tool.exe'));
});

test('allowlist: whitelist vuota blocca tutto', () => {
  const result = checkExecutable(abs('windows/system32/notepad.exe'), { allowExec: [], baseDir: BASE });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /allowExec/);
});

test('allowlist: percorso esatto consentito', () => {
  const target = abs('windows/system32/notepad.exe');
  const result = checkExecutable(target, { allowExec: [target], baseDir: BASE });
  assert.equal(result.allowed, true);
  assert.equal(result.resolved, path.normalize(target));
});

test('allowlist: un nome nudo si risolve su un eseguibile whitelisted', () => {
  // "notepad.exe" (senza cartella) deve mappare sull'entry whitelisted, come
  // nella finestra Esegui, invece di cercarlo nella cartella del deck.
  const full = abs('windows/system32/notepad.exe');
  const result = checkExecutable('notepad.exe', { allowExec: [full], allowedExtensions: ['.exe'], baseDir: BASE });
  assert.equal(result.allowed, true);
  assert.equal(result.resolved, full);
});

test('allowlist: un nome nudo non whitelisted resta bloccato', () => {
  const result = checkExecutable('chrome.exe', {
    allowExec: [abs('windows/system32/notepad.exe')],
    allowedExtensions: ['.exe'],
    baseDir: BASE
  });
  assert.equal(result.allowed, false);
});

test('allowlist: un pattern glob non viene confuso con un nome nudo', () => {
  // Il basename del pattern "scripts/examples/*" e' "*", non deve mai fare match
  // per nome con un eseguibile qualsiasi.
  const result = checkExecutable('tool.exe', {
    allowExec: ['scripts/examples/*'],
    allowedExtensions: ['.exe'],
    baseDir: BASE
  });
  assert.equal(result.allowed, false);
});

test('allowlist: percorso non elencato bloccato', () => {
  const result = checkExecutable(abs('windows/system32/cmd.exe'), {
    allowExec: [abs('windows/system32/notepad.exe')],
    baseDir: BASE
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /non compare/);
});

test('allowlist: pattern glob consentito', () => {
  const result = checkExecutable(abs('strumenti/build/run.exe'), {
    allowExec: [abs('strumenti/**')],
    baseDir: BASE
  });
  assert.equal(result.allowed, true);
});

test('allowlist: i percorsi relativi sono risolti rispetto a baseDir', () => {
  const result = checkExecutable('scripts/examples/hello.ps1', {
    allowExec: ['scripts/examples/*'],
    allowedExtensions: ['.ps1'],
    baseDir: BASE
  });
  assert.equal(result.allowed, true);
  assert.equal(result.resolved, path.resolve(BASE, 'scripts/examples/hello.ps1'));
});

test('allowlist: il path traversal non aggira la whitelist', () => {
  const result = checkExecutable('scripts/examples/../../../windows/system32/cmd.exe', {
    allowExec: ['scripts/examples/*'],
    allowedExtensions: ['.exe'],
    baseDir: BASE
  });
  assert.equal(result.allowed, false);
});

test('allowlist: un symlink dentro una cartella consentita non fa evadere la whitelist', () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-allow-')));
  const consentita = path.join(base, 'consentita');
  fs.mkdirSync(consentita);
  const vietato = path.join(base, 'vietato.exe');
  fs.writeFileSync(vietato, 'x');
  const link = path.join(consentita, 'innocuo.exe');

  try {
    fs.symlinkSync(vietato, link);
  } catch {
    // Su Windows la creazione di symlink richiede un privilegio che il runner
    // dei test potrebbe non avere: in quel caso il test non si applica.
    fs.rmSync(base, { recursive: true, force: true });
    return;
  }

  try {
    // Un file reale dentro la cartella consentita passa.
    const reale = path.join(consentita, 'reale.exe');
    fs.writeFileSync(reale, 'x');
    assert.equal(
      checkExecutable(reale, { allowExec: [path.join(consentita, '**')], baseDir: base }).allowed,
      true
    );

    // Il symlink no: la sua destinazione reale sta fuori dalla cartella.
    const result = checkExecutable(link, { allowExec: [path.join(consentita, '**')], baseDir: base });
    assert.equal(result.allowed, false, 'il symlink punta a un binario fuori dalla whitelist');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('allowlist: estensioni non ammesse bloccate prima della whitelist', () => {
  const result = checkExecutable(abs('tmp/script.vbs'), {
    allowExec: [abs('tmp/**')],
    allowedExtensions: ['.exe', '.ps1'],
    baseDir: BASE
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /estensione/);
});

test('allowlist: percorso mancante o vuoto', () => {
  assert.equal(checkExecutable('', { allowExec: ['**'] }).allowed, false);
  assert.equal(checkExecutable(undefined, { allowExec: ['**'] }).allowed, false);
  assert.equal(checkExecutable(42, { allowExec: ['**'] }).allowed, false);
});

test('allowlist: schemi URL', () => {
  assert.equal(checkUrl('https://example.com', ['http', 'https']).allowed, true);
  assert.equal(checkUrl('HTTPS://ESEMPIO.IT', ['https']).allowed, true);
  assert.equal(checkUrl('ms-settings:display', ['ms-settings']).allowed, true);

  const file = checkUrl('file:///C:/segreti.txt', ['http', 'https']);
  assert.equal(file.allowed, false);
  assert.match(file.reason, /schema "file" non ammesso/);

  assert.equal(checkUrl('example.com', ['http']).allowed, false);
  assert.equal(checkUrl('', ['http']).allowed, false);
  assert.equal(checkUrl('https://example.com', []).allowed, false);
});
