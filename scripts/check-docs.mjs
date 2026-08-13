#!/usr/bin/env node
/**
 * Verifica che la documentazione esista, sia coerente con il codice e non
 * contenga riferimenti rotti.
 *
 * Controlla:
 *   1. presenza dei documenti obbligatori;
 *   2. README: quickstart, sezioni chiave, comandi realmente esistenti;
 *   3. PROTOCOL.md: ogni endpoint, campo e messaggio del protocollo documentato;
 *   4. ROADMAP.md: le tre sezioni completo / stub / mancante, non vuote;
 *   5. ogni azione registrata e' documentata;
 *   6. CHANGELOG allineato alla versione di package.json;
 *   7. nessun link relativo rotto nei documenti;
 *   8. repository git inizializzato.
 *
 * Uso: npm run check:docs   (oppure: node scripts/check-docs.mjs)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENDPOINTS, LITE_FIELDS, LITE_MSG, MSG } from '../shared/protocol.mjs';
import { createDefaultRegistry } from '../src/host/actions/handlers/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));

// ------------------------------------------------------------------
console.log('\nWdeck - verifica della documentazione\n');

console.log('1) Documenti obbligatori');
const required = [
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'docs/PROTOCOL.md',
  'docs/ROADMAP.md',
  'docs/ADDING-ACTIONS.md',
  'firmware/esp32/README.md',
  'schema/deck.schema.json',
  'deck.json'
];
for (const file of required) check(`presente ${file}`, exists(file));

if (failures.length > 0) {
  console.log('\nDocumenti mancanti: verifica interrotta.');
  process.exit(1);
}

const readme = read('README.md');
const protocol = read('docs/PROTOCOL.md');
const roadmap = read('docs/ROADMAP.md');
const actionsDoc = read('docs/ADDING-ACTIONS.md');
const changelog = read('CHANGELOG.md');
const pkg = JSON.parse(read('package.json'));

// ------------------------------------------------------------------
console.log('\n2) README');
check('contiene una sezione Quickstart', /##\s*Quickstart/i.test(readme));
check('il quickstart cita npm install', /npm install/.test(readme));
check('il quickstart cita npm start', /npm start/.test(readme));
check('documenta la configurazione deck.json', /deck\.json/.test(readme));
check('contiene una sezione sulla sicurezza', /##\s*Sicurezza/i.test(readme));
check('contiene una sezione sull\'architettura', /##\s*Architettura/i.test(readme));
check('contiene la tabella dei comandi', /##\s*Comandi/i.test(readme));
check('rimanda a docs/PROTOCOL.md', readme.includes('docs/PROTOCOL.md'));
check('rimanda a docs/ROADMAP.md', readme.includes('docs/ROADMAP.md'));
check('rimanda a docs/ADDING-ACTIONS.md', readme.includes('docs/ADDING-ACTIONS.md'));
check('descrive i tre componenti (host, client web, ESP32)',
  /host/i.test(readme) && /PWA|client web/i.test(readme) && /ESP32/i.test(readme));

const scriptsCitati = [...readme.matchAll(/npm run ([a-z:0-9-]+)/g)].map((m) => m[1]);
const scriptsMancanti = [...new Set(scriptsCitati)].filter((s) => !(s in pkg.scripts));
check('tutti gli "npm run" citati nel README esistono', scriptsMancanti.length === 0, scriptsMancanti.join(', '));

for (const comando of ['test', 'smoke', 'build', 'test:esp32']) {
  check(`il README cita "npm run ${comando}" o equivalente`,
    readme.includes(`npm run ${comando}`) || (comando === 'test' && readme.includes('npm test')));
}

// ------------------------------------------------------------------
console.log('\n3) docs/PROTOCOL.md');
for (const [nome, endpoint] of Object.entries(ENDPOINTS)) {
  check(`documenta l'endpoint ${endpoint} (${nome})`, protocol.includes(endpoint));
}
for (const [nome, tipo] of Object.entries(MSG)) {
  check(`documenta il messaggio full "${tipo}" (${nome})`, new RegExp(`\`${tipo}\``).test(protocol));
}
for (const [nome, chiave] of Object.entries(LITE_FIELDS)) {
  check(`documenta il campo lite "${chiave}" (${nome})`,
    new RegExp(`\\|\\s*${nome}\\s*\\|\\s*\`${chiave}\``).test(protocol));
}
for (const [nome, tipo] of Object.entries(LITE_MSG)) {
  check(`documenta il messaggio lite "${tipo}" (${nome})`,
    new RegExp(`\\|\\s*${nome}\\s*\\|\\s*\`${tipo}\``).test(protocol));
}
check('spiega l\'autenticazione a token', /x-wdeck-token/.test(protocol) && /Bearer/.test(protocol));
check('spiega il pairing con PIN', /\/api\/pair/.test(protocol) && /pin/i.test(protocol));
check('contiene almeno un esempio di sessione WebSocket', /client ->/.test(protocol) && /host   <-/.test(protocol));
check('documenta la politica di versioning', /versioning|Compatibilita'/i.test(protocol));

// ------------------------------------------------------------------
console.log('\n4) docs/ROADMAP.md');
/** Estrae il corpo di una sezione di secondo livello (fino al successivo "## "). */
const sezione = (titolo) => {
  const lines = roadmap.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${titolo}\\b`, 'i').test(l));
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
};
const completo = sezione('Completo');
const stub = sezione('Stub');
const mancante = sezione('Mancante');

check('esiste la sezione "Completo"', completo.length > 0);
check('esiste la sezione "Stub"', stub.length > 0);
check('esiste la sezione "Mancante"', mancante.length > 0);
check('la sezione "Completo" elenca almeno 5 voci', (completo.match(/^\s*[-|]/gm) ?? []).length >= 5, `${(completo.match(/^\s*[-|]/gm) ?? []).length} voci`);
check('la sezione "Stub" elenca almeno 3 voci', (stub.match(/^\s*[-|]/gm) ?? []).length >= 3);
check('la sezione "Mancante" elenca almeno 5 voci', (mancante.match(/^\s*[-|]/gm) ?? []).length >= 5);
check('dichiara i prossimi passi', /Prossimi passi/i.test(roadmap));
check('dichiara la versione di riferimento', roadmap.includes(pkg.version));
check('dichiara quali piattaforme sono coperte e quali limiti restano',
  /macOS/.test(roadmap) && /Linux/.test(roadmap) && /macOS|Linux/.test(mancante));
check('dichiara che il firmware non e\' provato su hardware', /hardware/i.test(stub));

// ------------------------------------------------------------------
console.log('\n5) Azioni documentate');
const registry = createDefaultRegistry();
for (const tipo of registry.types()) {
  check(`l'azione "${tipo}" e' documentata in ADDING-ACTIONS.md`, new RegExp(`\`${tipo}\``).test(actionsDoc));
  check(`l'azione "${tipo}" e' citata nel README`, new RegExp(`\`${tipo}\``).test(readme));
}
check('ADDING-ACTIONS spiega il contratto degli handler', /validate|describe/.test(actionsDoc) && /ctx\.dryRun/.test(actionsDoc));
check('ADDING-ACTIONS spiega come registrare un handler', /extraHandlers|builtinHandlers/.test(actionsDoc));

// ------------------------------------------------------------------
console.log('\n6) CHANGELOG');
check(`contiene la versione corrente ${pkg.version}`, changelog.includes(pkg.version));
check('rimanda alla roadmap', changelog.includes('docs/ROADMAP.md'));
check('dichiara i limiti noti', /Note|Limit/i.test(changelog));

// ------------------------------------------------------------------
console.log('\n7) Link relativi');
const documenti = [
  ['README.md', readme],
  ['docs/PROTOCOL.md', protocol],
  ['docs/ROADMAP.md', roadmap],
  ['docs/ADDING-ACTIONS.md', actionsDoc],
  ['CHANGELOG.md', changelog],
  ['firmware/esp32/README.md', read('firmware/esp32/README.md')]
];

const rotti = [];
for (const [file, contenuto] of documenti) {
  const dir = path.dirname(path.join(ROOT, file));
  for (const match of contenuto.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (target === '' || /^(https?:|mailto:)/.test(target)) continue;
    if (!fs.existsSync(path.resolve(dir, target))) rotti.push(`${file} -> ${target}`);
  }
}
check('nessun link relativo rotto', rotti.length === 0, rotti.join('; '));

// ------------------------------------------------------------------
console.log('\n8) Repository');
check('repository git inizializzato', exists('.git'));
check('.gitignore esclude node_modules e dist', /node_modules/.test(read('.gitignore')) && /dist/.test(read('.gitignore')));

// ------------------------------------------------------------------
console.log(`\nRisultato: ${passed} verifiche superate, ${failures.length} fallite`);
if (failures.length > 0) {
  console.log('Verifiche fallite:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('DOCUMENTAZIONE OK\n');
