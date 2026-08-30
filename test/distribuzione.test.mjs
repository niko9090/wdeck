/**
 * Distribuzione: eseguibile singolo Windows e binari del firmware ESP32.
 *
 * Qui non si costruisce nulla - un exe da 84 MB e una compilazione xtensa non
 * stanno in una suite di test - ma si collauda la logica che decide *come*
 * l'eseguibile parte. E' il punto piu' fragile di tutta la catena: se sbaglia,
 * il sintomo e' un exe che non si avvia, e a quel punto non c'e' piu' un errore
 * leggibile da nessuna parte.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Importabile fuori da un eseguibile solo perche' l'avvio e' dietro isSea().
const { normalizeArgs, dataHome } = require(path.join(ROOT, 'scripts', 'sea-entry.cjs'));

// build-exe.mjs esegue main() solo se lanciato come script: importarlo qui
// espone le funzioni di firma senza costruire nulla.
const { costruisciArgomentiFirma, firmaEseguibile } = await import(
  pathToFileURL(path.join(ROOT, 'scripts', 'build-exe.mjs')).href
);

const EXE = 'C:\\Wdeck\\wdeck.exe';
const CONFIG = 'C:\\Users\\tizio\\AppData\\Local\\Wdeck\\deck.json';

test('avvio exe: senza --config usa la configurazione della cartella dati', () => {
  const argv = normalizeArgs([EXE], EXE, CONFIG);
  assert.deepEqual(argv, [EXE, EXE, '--config', CONFIG]);
  // parseArgs fa slice(2): e' quello che deve restare.
  assert.deepEqual(argv.slice(2), ['--config', CONFIG]);
});

test('avvio exe: il primo argomento dell\'utente non viene mangiato', () => {
  // Il difetto classico: dentro un SEA argv non ha la forma [node, script, ...]
  // e uno slice(2) ingenuo si porta via "--dry-run".
  const argv = normalizeArgs([EXE, '--dry-run', '--port', '9000'], EXE, CONFIG);
  assert.deepEqual(argv.slice(2), ['--config', CONFIG, '--dry-run', '--port', '9000']);
});

test('avvio exe: un --config dell\'utente vince su quello predefinito', () => {
  const argv = normalizeArgs([EXE, '--config', 'D:\\mio.json'], EXE, CONFIG);
  assert.deepEqual(argv.slice(2), ['--config', 'D:\\mio.json']);
  assert.equal(argv.filter((a) => a === '--config').length, 1, 'un solo --config');
});

test('avvio exe: il percorso dell\'eseguibile ripetuto non diventa un argomento', () => {
  // Alcune forme di avvio ripetono execPath in argv[1]: se restasse, finirebbe
  // a parseArgs come posizionale e la CLI rifiuterebbe di partire.
  const argv = normalizeArgs([EXE, EXE, '--quiet'], EXE, CONFIG);
  assert.deepEqual(argv.slice(2), ['--config', CONFIG, '--quiet']);
});

test('avvio exe: la cartella dati e\' un percorso assoluto', () => {
  const home = dataHome();
  assert.ok(path.isAbsolute(home), `atteso assoluto, ricevuto ${home}`);
});

test('avvio exe: il ponte resta importabile dove node:sea non esiste', () => {
  // Il progetto gira dalla 20.10, ma node:sea e' arrivato nella 20.12: senza
  // guardia, importare questo file su una 20.10 esplode. La CI l'ha scoperto al
  // primo giro proprio perche' prova entrambe le versioni.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'sea-entry.cjs'), 'utf8');
  assert.match(src, /try \{\s*sea = require\('node:sea'\);\s*\} catch/,
    'require(node:sea) deve stare dentro un try/catch');
  assert.match(src, /if \(sea\.isSea\(\)\)/, 'l\'avvio deve restare dietro isSea()');
});

test('firma: costruisce gli argomenti di signtool da un PFX', () => {
  const args = costruisciArgomentiFirma('C:\\x\\wdeck.exe', {
    pfx: 'C:\\c\\cert.pfx', password: 'segreta', timestamp: 'http://ts.example'
  });
  assert.deepEqual(args, [
    'sign', '/fd', 'SHA256', '/tr', 'http://ts.example', '/td', 'SHA256',
    '/f', 'C:\\c\\cert.pfx', '/p', 'segreta', 'C:\\x\\wdeck.exe'
  ]);
});

test('firma: un\'impronta nel deposito e\' l\'alternativa al PFX', () => {
  const args = costruisciArgomentiFirma('w.exe', { thumbprint: 'AB12CD34' });
  assert.ok(args.includes('/sha1'));
  assert.equal(args[args.indexOf('/sha1') + 1], 'AB12CD34');
  assert.ok(!args.includes('/f'), 'senza PFX non deve esserci /f');
  assert.equal(args[args.length - 1], 'w.exe');
  // La marca temporale c'e' sempre: senza, la firma scadrebbe col certificato.
  assert.ok(args.includes('/tr'));
});

test('firma: senza certificato gli argomenti non si costruiscono', () => {
  assert.throws(() => costruisciArgomentiFirma('w.exe', {}), /certificato/);
});

test('firma: senza certificato configurato la build avverte ma non firma', () => {
  // env vuoto: nessun WDECK_SIGN_*, quindi non si tocca signtool.
  const esito = firmaEseguibile('w.exe', {});
  assert.equal(esito.firmato, false);
  assert.match(esito.motivo, /certificato/);
});

test('distribuzione: gli script di build sono sintatticamente validi', () => {
  // Sono fuori dalla suite normale (nessuno li importa): senza questo controllo
  // un errore di battitura si scoprirebbe solo al momento di distribuire.
  for (const file of ['build-exe.mjs', 'build-firmware.mjs', 'sea-entry.cjs']) {
    execFileSync(process.execPath, ['--check', path.join(ROOT, 'scripts', file)]);
  }
});

test('distribuzione: i comandi sono dichiarati in package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.exe, 'node scripts/build-exe.mjs');
  assert.equal(pkg.scripts.firmware, 'node scripts/build-firmware.mjs');
  // postject e' uno strumento da banco, non una dipendenza: il vincolo regge.
  assert.deepEqual(pkg.dependencies, {});
  assert.deepEqual(pkg.devDependencies, {});
});

test('firmware: gli ambienti sono letti da platformio.ini, non ricopiati', () => {
  const ini = fs.readFileSync(path.join(ROOT, 'firmware', 'esp32', 'platformio.ini'), 'utf8');
  const envs = [...ini.matchAll(/^\[env:([^\]]+)\]/gm)].map((m) => m[1]);
  assert.ok(envs.length >= 3, `attesi almeno 3 ambienti, trovati ${envs.length}`);

  // Un ambiente inesistente deve fermarsi subito, elencando quelli veri, senza
  // arrivare a invocare PlatformIO.
  let uscita;
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-firmware.mjs'), 'scheda-che-non-esiste'],
      { encoding: 'utf8', stdio: 'pipe' });
    assert.fail('doveva fallire');
  } catch (err) {
    uscita = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  for (const env of envs) assert.match(uscita, new RegExp(env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('firmware: il codice del tocco e\' condizionato al display che ce l\'ha', () => {
  // L'ambiente esp32s3-st7789 non ha TOUCH_CS, e TFT_eSPI genera getTouch()
  // solo quando c'e': senza guardia non compilava affatto.
  const main = fs.readFileSync(path.join(ROOT, 'firmware', 'esp32', 'src', 'main.cpp'), 'utf8');
  const guardia = main.indexOf('#ifdef TOUCH_CS');
  const chiamata = main.indexOf('tft.getTouch(');
  assert.ok(guardia !== -1, 'manca la guardia #ifdef TOUCH_CS');
  assert.ok(chiamata > guardia, 'tft.getTouch() e\' chiamata fuori dalla guardia');
  assert.match(main, /#else[\s\S]*static void handleTouch\(\) \{\}/,
    'senza touch handleTouch deve esistere lo stesso, altrimenti loop() non compila');
});

// ------------------------------------------------------------------ caratteri

test('caratteri: gli stili usano caratteri imbarcati, non solo quelli di sistema', () => {
  // Il difetto: Bahnschrift esiste solo su Windows, SF Pro solo su Apple, Iowan
  // Old Style solo su Apple. Dal telefono TUTTI gli stili ripiegavano sullo
  // stesso carattere di sistema, e i "mondi" si vedevano identici.
  const css = fs.readFileSync(path.join(ROOT, 'web', 'app.css'), 'utf8');
  const dichiarati = [...css.matchAll(/@font-face\s*\{[^}]*?font-family:\s*'([^']+)'[^}]*?url\('\.\/fonts\/([^']+)'/gs)]
    .map((m) => ({ famiglia: m[1], file: m[2] }));
  assert.ok(dichiarati.length >= 7, 'servono le regole font-face dei caratteri imbarcati');

  for (const { file } of dichiarati) {
    assert.ok(fs.existsSync(path.join(ROOT, 'web', 'fonts', file)), `manca web/fonts/${file}`);
  }

  // Nessuna rete: Wdeck si apre su una LAN che puo' non avere internet.
  assert.doesNotMatch(css, /url\(\s*['"]?https?:/i, 'nessun carattere da scaricare da internet');
  assert.doesNotMatch(css, /@import/i, 'nessun @import verso l\'esterno');

  // Ogni stile deve NOMINARE PER PRIMO un carattere imbarcato: e' l'unico modo
  // perche' si veda davvero diverso su un telefono.
  const famiglie = new Set(dichiarati.map((d) => d.famiglia));
  const stili = [...css.matchAll(/:root\[data-style='([a-z]+)'\]\s*\{([^}]*)\}/g)];
  const conFont = stili.filter(([, , corpo]) => /--font:/.test(corpo));
  assert.ok(conFont.length >= 6, 'ogni stile deve ridefinire il carattere');
  for (const [, nome, corpo] of conFont) {
    const primo = corpo.match(/--font:\s*"([^"]+)"/);
    assert.ok(primo, `lo stile ${nome} deve cominciare la pila con un carattere fra virgolette`);
    assert.ok(famiglie.has(primo[1]), `lo stile ${nome} comincia con "${primo[1]}", che non e' imbarcato`);
  }

  // I file devono finire nel guscio del service worker (altrimenti offline si
  // perde lo stile) e nell'elenco che fa fallire la build se ne manca uno.
  const sw = fs.readFileSync(path.join(ROOT, 'web', 'sw.js'), 'utf8');
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-web.mjs'), 'utf8');
  for (const { file } of dichiarati) {
    assert.ok(sw.includes(`./fonts/${file}`), `sw.js non mette in cache ${file}`);
    assert.ok(build.includes(`fonts/${file}`), `build-web.mjs non pretende ${file}`);
  }

  // La licenza OFL va distribuita coi caratteri.
  assert.ok(fs.existsSync(path.join(ROOT, 'web', 'fonts', 'LICENSE.txt')), 'manca la licenza dei caratteri');
});
