import test from 'node:test';
import assert from 'node:assert/strict';
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
