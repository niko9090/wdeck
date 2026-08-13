#!/usr/bin/env node
/**
 * Guardia del vincolo "zero dipendenze runtime".
 *
 * Il progetto usa solo moduli built-in di Node: WebSocket, TLS, MQTT, QR e
 * mDNS sono implementati qui dentro. Questo script fallisce se qualcuno
 * aggiunge una dipendenza runtime o se un sorgente importa un pacchetto che
 * non sia un modulo interno di Node.
 *
 * Uso: node scripts/check-deps.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED = ['bin', 'src', 'shared', 'scripts', 'tools', 'test'];

// Alcuni moduli interni esistono solo con il prefisso "node:" e per questo non
// compaiono in builtinModules: vanno elencati a mano.
const PREFIX_ONLY = ['node:test', 'node:test/reporters', 'node:sea', 'node:sqlite'];

const BUILTIN = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`), ...PREFIX_ONLY]);
const problems = [];

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const runtimeDeps = Object.keys(pkg.dependencies ?? {});
if (runtimeDeps.length > 0) problems.push(`package.json dichiara dipendenze runtime: ${runtimeDeps.join(', ')}`);

const devDeps = Object.keys(pkg.devDependencies ?? {});
if (devDeps.length > 0) problems.push(`package.json dichiara dipendenze di sviluppo: ${devDeps.join(', ')}`);

/** Elenca ricorsivamente i sorgenti JavaScript di una cartella. */
function sources(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.(mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:^|[\s;])(?:import\s[^'"]*from\s*|import\s*|export\s[^'"]*from\s*)['"]([^'"]+)['"]/gm;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

for (const dir of SCANNED) {
  for (const file of sources(path.join(ROOT, dir))) {
    const code = fs.readFileSync(file, 'utf8');
    const specifiers = [
      ...[...code.matchAll(IMPORT_RE)].map((m) => m[1]),
      ...[...code.matchAll(REQUIRE_RE)].map((m) => m[1])
    ];
    for (const spec of specifiers) {
      // Percorsi relativi e assoluti sono codice del progetto, non pacchetti.
      if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) continue;
      if (BUILTIN.has(spec)) continue;
      problems.push(`${path.relative(ROOT, file)} importa il pacchetto esterno "${spec}"`);
    }
  }
}

if (problems.length > 0) {
  console.error('\nVincolo "zero dipendenze" violato:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  process.exit(1);
}

console.log('ok: zero dipendenze runtime, nessun import esterno nei sorgenti');
