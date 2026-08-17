/**
 * Costruisce `release/wdeck.exe`: un eseguibile singolo che non richiede
 * Node.js sul PC di destinazione.
 *
 * Come funziona: Node 20+ sa incorporare uno script dentro una copia di se
 * stesso (Single Executable Application). Lo script incorporato e'
 * `scripts/sea-entry.cjs`, e i moduli dell'host viaggiano con lui come asset.
 *
 * L'unico pezzo che Node non fa da solo e' scrivere il blob dentro il binario:
 * lo fa `postject`, strumento ufficiale del progetto Node.js, scaricato al
 * volo da `npx`. E' un attrezzo da banco di lavoro, non una dipendenza: non
 * finisce in package.json e l'host non lo importa mai. Il vincolo di zero
 * dipendenze a runtime resta intatto, ed e' verificato da `check:deps`.
 *
 *   node scripts/build-exe.mjs
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** Cartelle e file che devono finire dentro l'eseguibile. */
const INCLUDE = ['bin', 'src', 'shared', 'schema', path.join('dist', 'web')];
const INCLUDE_FILES = ['package.json'];

/** Il fusibile che Node cerca dentro il binario per sapere dove sta il blob. */
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

/**
 * Dice a Windows che questo programma non ha bisogno di un terminale.
 *
 * `node.exe` e' compilato come applicazione a console: chi lo lancia con un
 * doppio clic si vede aprire una finestra nera che resta li' finche' il
 * programma vive. Wdeck ha la sua icona nell'area di notifica e non ha niente
 * da dire a un terminale, quindi quella finestra e' solo un fastidio.
 *
 * Nell'intestazione PE un campo di due byte distingue le due cose: 3 significa
 * console, 2 significa interfaccia grafica. Si cambia quello, e nient'altro:
 * il codice eseguito e' identico.
 *
 * @param {string} file
 * @returns {{cambiato: boolean, motivo?: string, da?: number}}
 */
export function impostaSottosistemaGrafico(file) {
  const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2;
  const IMAGE_SUBSYSTEM_WINDOWS_CUI = 3;

  const bin = fs.readFileSync(file);
  if (bin.toString('ascii', 0, 2) !== 'MZ') return { cambiato: false, motivo: 'non e\' un eseguibile Windows' };

  const pe = bin.readUInt32LE(0x3c);
  if (bin.toString('ascii', pe, pe + 4) !== 'PE\0\0') return { cambiato: false, motivo: 'intestazione PE non trovata' };

  // L'intestazione opzionale comincia dopo i 24 byte di quella di file; il
  // campo Subsystem sta 68 byte piu' avanti, uguale in PE32 e PE32+.
  const opzionale = pe + 24;
  const magic = bin.readUInt16LE(opzionale);
  if (magic !== 0x10b && magic !== 0x20b) return { cambiato: false, motivo: `formato sconosciuto (0x${magic.toString(16)})` };

  const posizione = opzionale + 68;
  const attuale = bin.readUInt16LE(posizione);
  if (attuale === IMAGE_SUBSYSTEM_WINDOWS_GUI) return { cambiato: true, da: attuale };
  if (attuale !== IMAGE_SUBSYSTEM_WINDOWS_CUI) {
    return { cambiato: false, motivo: `sottosistema inatteso: ${attuale}` };
  }

  bin.writeUInt16LE(IMAGE_SUBSYSTEM_WINDOWS_GUI, posizione);
  fs.writeFileSync(file, bin);
  return { cambiato: true, da: attuale };
}

/**
 * Costruisce gli argomenti di `signtool sign`. Funzione pura: niente I/O, cosi'
 * la si puo' collaudare senza un certificato e senza Windows.
 *
 * La firma usa SHA-256 e una marca temporale RFC 3161: senza la marca, la
 * firma scadrebbe con il certificato, e un exe legittimo diventerebbe invalido
 * il giorno dopo. Il certificato arriva o da un file `.pfx` (con la sua
 * password) o dall'impronta di uno gia' nel deposito di Windows.
 *
 * @param {string} exe percorso dell'eseguibile da firmare
 * @param {{pfx?: string, password?: string, thumbprint?: string, timestamp?: string}} opts
 * @returns {string[]}
 */
export function costruisciArgomentiFirma(exe, opts = {}) {
  const { pfx, password, thumbprint, timestamp = 'http://timestamp.digicert.com' } = opts;
  const args = ['sign', '/fd', 'SHA256', '/tr', timestamp, '/td', 'SHA256'];
  if (pfx) {
    args.push('/f', pfx);
    if (password) args.push('/p', password);
  } else if (thumbprint) {
    args.push('/sha1', thumbprint);
  } else {
    throw new Error('nessun certificato: imposta WDECK_SIGN_PFX o WDECK_SIGN_THUMBPRINT');
  }
  args.push(exe);
  return args;
}

/**
 * Trova `signtool.exe`. Non sta nel PATH per conto suo: lo installa il Windows
 * SDK sotto `Windows Kits\10\bin\<versione>\x64`. Si prende la versione piu'
 * recente, oppure il percorso indicato a mano da `WDECK_SIGNTOOL`.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string|null}
 */
function trovaSigntool(env = process.env) {
  if (env.WDECK_SIGNTOOL) return env.WDECK_SIGNTOOL;
  const basi = [
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Windows Kits', '10', 'bin')
  ];
  for (const base of basi) {
    if (!fs.existsSync(base)) continue;
    const versioni = fs.readdirSync(base).filter((n) => /^\d/.test(n)).sort().reverse();
    for (const v of versioni) {
      const p = path.join(base, v, 'x64', 'signtool.exe');
      if (fs.existsSync(p)) return p;
    }
    const diretto = path.join(base, 'x64', 'signtool.exe');
    if (fs.existsSync(diretto)) return diretto;
  }
  return null;
}

/**
 * Firma l'eseguibile con Authenticode, se e' configurato un certificato.
 *
 * La firma va applicata **dopo** ogni modifica al PE (il blob di postject, il
 * cambio di sottosistema): ritoccare il binario dopo averlo firmato ne
 * invaliderebbe la firma. Se non c'e' un certificato non e' un errore di build,
 * ma va detto forte: dalla 0.7.0 l'aggiornamento automatico **rifiuta** i
 * binari non firmati, quindi un exe non firmato non potra' aggiornarsi da solo.
 *
 * @param {string} exe
 * @param {NodeJS.ProcessEnv} env
 * @returns {{firmato: boolean, motivo?: string, signtool?: string}}
 */
export function firmaEseguibile(exe, env = process.env) {
  const opts = {
    pfx: env.WDECK_SIGN_PFX,
    password: env.WDECK_SIGN_PASSWORD,
    thumbprint: env.WDECK_SIGN_THUMBPRINT,
    timestamp: env.WDECK_SIGN_TIMESTAMP
  };
  if (!opts.pfx && !opts.thumbprint) {
    return { firmato: false, motivo: 'nessun certificato configurato' };
  }
  const signtool = trovaSigntool(env);
  if (!signtool) {
    throw new Error('signtool.exe non trovato: installa il Windows SDK o imposta WDECK_SIGNTOOL');
  }
  execFileSync(signtool, costruisciArgomentiFirma(exe, opts), { stdio: 'pipe' });
  // La stessa verifica che l'host fara' prima di sostituirsi: se non passa qui,
  // non passerebbe nemmeno la' e l'aggiornamento si fermerebbe.
  execFileSync(signtool, ['verify', '/pa', exe], { stdio: 'pipe' });
  return { firmato: true, signtool };
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(ROOT, full).split(path.sep).join('/'));
  }
  return out;
}

function main() {
  if (process.platform !== 'win32') {
    console.error('Questo script produce un .exe e va lanciato su Windows.');
    console.error('Su macOS e Linux si avvia dai sorgenti: npm start.');
    process.exit(1);
  }

  // L'host gira dalla 20.10, ma `node:sea` e gli asset incorporati esistono
  // dalla 20.12: costruire con una versione precedente darebbe un errore
  // oscuro a meta' strada invece di questa riga.
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 12)) {
    console.error(`Serve Node 20.12 o superiore per costruire l'eseguibile (qui c'e' ${process.versions.node}).`);
    console.error('L\'host invece gira gia\' dalla 20.10: e\' solo la costruzione a chiedere di piu\'.');
    process.exit(1);
  }

  // Il client va compilato prima: dentro l'exe ci va dist/web, non i sorgenti.
  console.log('  compilo il client web...');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-web.mjs')], { stdio: 'pipe' });

  const files = [];
  for (const item of INCLUDE) {
    const full = path.join(ROOT, item);
    if (!fs.existsSync(full)) throw new Error(`manca ${item}: lancia prima "npm run build"`);
    files.push(...walk(full));
  }
  files.push(...INCLUDE_FILES);

  // L'impronta del contenuto diventa il nome della cartella di estrazione:
  // cosi' un exe ricostruito estrae di nuovo, e uno identico non ripete il
  // lavoro. La versione da sola non basterebbe durante lo sviluppo.
  const digest = crypto.createHash('sha256');
  const assets = { MANIFEST: null };
  for (const file of files) {
    const buf = fs.readFileSync(path.join(ROOT, file));
    digest.update(file).update(buf);
    assets[file] = path.join(ROOT, file);
  }
  const stamp = `${pkg.version}-${digest.digest('hex').slice(0, 12)}`;

  const buildDir = path.join(ROOT, 'release', '.sea');
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });

  const manifestFile = path.join(buildDir, 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify({ version: pkg.version, stamp, files }));
  assets.MANIFEST = manifestFile;
  assets['deck.default.json'] = path.join(ROOT, 'deck.json');

  const seaConfig = {
    main: path.join(ROOT, 'scripts', 'sea-entry.cjs'),
    output: path.join(buildDir, 'wdeck.blob'),
    disableExperimentalSEAWarning: true,
    assets
  };
  const configFile = path.join(buildDir, 'sea-config.json');
  fs.writeFileSync(configFile, JSON.stringify(seaConfig, null, 2));

  console.log(`  incorporo ${files.length} file...`);
  execFileSync(process.execPath, ['--experimental-sea-config', configFile], { stdio: 'pipe' });

  const exe = path.join(ROOT, 'release', 'wdeck.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.copyFileSync(process.execPath, exe);

  console.log('  scrivo il blob nel binario (postject)...');
  execFileSync(
    'npx',
    ['--yes', 'postject', exe, 'NODE_SEA_BLOB', seaConfig.output, '--sentinel-fuse', FUSE],
    { stdio: 'pipe', shell: true }
  );

  console.log('  tolgo la finestra del terminale...');
  const sottosistema = impostaSottosistemaGrafico(exe);
  if (!sottosistema.cambiato) throw new Error(`sottosistema non modificato: ${sottosistema.motivo}`);

  // La firma va per ultima, dopo ogni ritocco al PE: firmare e poi modificare
  // invaliderebbe la firma.
  console.log('  firmo l\'eseguibile...');
  const firma = firmaEseguibile(exe);
  if (!firma.firmato) {
    console.warn(`  ATTENZIONE: eseguibile NON firmato (${firma.motivo}).`);
    console.warn('  Dalla 0.7.0 l\'aggiornamento automatico rifiuta i binari non firmati.');
    console.warn('  Imposta WDECK_SIGN_PFX (+ WDECK_SIGN_PASSWORD) o WDECK_SIGN_THUMBPRINT per firmare.');
  }

  // Un exe che non parte e' peggio di un errore di build: lo provo qui.
  // Senza console non si puo' leggere cosa stampa, quindi si guarda l'unica
  // cosa che resta osservabile dall'esterno: che esca da solo e senza errori.
  console.log('  verifico che parta...');
  execFileSync(exe, ['--help'], { stdio: 'ignore', timeout: 60000 });

  const mb = (fs.statSync(exe).size / 1048576).toFixed(1);
  console.log(`\n  versione : ${pkg.version}`);
  console.log(`  file     : ${files.length} incorporati`);
  console.log(`  impronta : ${stamp}`);
  console.log(`  firma    : ${firma.firmato ? 'applicata e verificata' : 'assente (non aggiornabile da solo)'}`);
  console.log(`  exe      : ${path.relative(ROOT, exe)} (${mb} MB)`);
  console.log('\nEXE OK');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
