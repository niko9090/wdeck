import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkExecutable } from '../src/host/security/allowlist.mjs';
import { listScripts, ensureScriptsDir, SCRIPT_EXTS } from '../src/host/scripts.mjs';
import { readSystemInfo } from '../src/host/platform/desktop.mjs';

function tempBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wdeck-scripts-'));
}

test('allowlist: un file nella cartella scripts e\' autorizzato anche con allowExec vuota', () => {
  const base = tempBase();
  const dir = ensureScriptsDir(base);
  const file = path.join(dir, 'mio.ps1');
  fs.writeFileSync(file, 'Write-Output ok');
  const r = checkExecutable(file, { allowExec: [], baseDir: base });
  assert.equal(r.allowed, true, r.reason);
});

test('allowlist: nella cartella scripts un\'estensione non ammessa viene rifiutata', () => {
  const base = tempBase();
  const dir = ensureScriptsDir(base);
  const file = path.join(dir, 'nota.txt');
  fs.writeFileSync(file, 'ciao');
  const r = checkExecutable(file, { allowExec: [], baseDir: base });
  assert.equal(r.allowed, false);
});

test('allowlist: fuori dalla cartella scripts serve ancora la whitelist', () => {
  const base = tempBase();
  const fuori = path.join(base, 'altrove.ps1');
  fs.writeFileSync(fuori, 'x');
  const r = checkExecutable(fuori, { allowExec: [], baseDir: base });
  assert.equal(r.allowed, false);
});

test('listScripts: elenca solo le estensioni note, in ordine; cartella assente -> []', () => {
  const base = tempBase();
  assert.deepEqual(listScripts(base), []); // niente cartella ancora
  const dir = ensureScriptsDir(base);
  fs.writeFileSync(path.join(dir, 'b.bat'), '');
  fs.writeFileSync(path.join(dir, 'a.ps1'), '');
  fs.writeFileSync(path.join(dir, 'note.txt'), ''); // ignorato
  const names = listScripts(base).map((s) => s.name);
  assert.deepEqual(names, ['a.ps1', 'b.bat']);
});

test('SCRIPT_EXTS include i tipi comuni', () => {
  for (const e of ['.ps1', '.bat', '.cmd', '.exe']) assert.ok(SCRIPT_EXTS.includes(e));
});

test('readSystemInfo: restituisce numeri sensati', async () => {
  const info = await readSystemInfo();
  assert.equal(typeof info.host, 'string');
  assert.ok(info.cpu >= 0 && info.cpu <= 100);
  assert.ok(info.mem.totalMb > 0);
  assert.ok(info.mem.percent >= 0 && info.mem.percent <= 100);
  assert.ok(info.cores >= 1);
});
