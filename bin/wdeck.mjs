#!/usr/bin/env node
/**
 * CLI dell'host Wdeck.
 *
 * Esempi:
 *   node bin/wdeck.mjs                       avvia con deck.json della root
 *   node bin/wdeck.mjs --dry-run             non esegue nulla, logga soltanto
 *   node bin/wdeck.mjs --port 9000 --host 127.0.0.1
 *   node bin/wdeck.mjs --config ./mio-deck.json
 */

import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHost, PROJECT_ROOT } from '../src/host/index.mjs';
import { addDevice, listDevices, pruneExpiredDevices, revokeDevice, rotateToken } from '../src/host/security/manage.mjs';
import { qrText } from '../shared/qr.mjs';

const HELP = `
Wdeck host - Stream Deck software

Uso: wdeck [opzioni]

Opzioni:
  --config <file>     percorso di deck.json (default: ./deck.json)
  --port <n>          porta di ascolto (sovrascrive deck.json)
  --host <ip>         indirizzo di bind: 0.0.0.0 = LAN, 127.0.0.1 = solo locale
  --token <str>       token di autenticazione (sovrascrive deck.json)
  --dry-run           simula le azioni senza eseguirle
  --no-token          disattiva l'autenticazione (SOLO per test in locale)
  --no-watch          disattiva la ricarica a caldo di deck.json
  --tls               attiva HTTPS/WSS con certificato autofirmato
  --no-qr             non stampa il QR code di accoppiamento all'avvio
  --quiet             riduce i log
  -h, --help          mostra questo aiuto

Sicurezza (non avviano l'host: lavorano su deck.json e terminano)
  --rotate-token          rigenera il token principale
  --revoke-devices        con --rotate-token, revoca anche tutti i dispositivi
  --list-devices          elenca i dispositivi accoppiati
  --add-device <nome>     crea un token per un dispositivo (utile per l'ESP32)
  --revoke-device <id>    revoca un dispositivo
  --prune-devices         toglie i dispositivi scaduti
  --days <n>              con --add-device, giorni di validita'

Variabili d'ambiente equivalenti: WDECK_PORT, WDECK_HOST, WDECK_TOKEN,
WDECK_DRY_RUN, WDECK_REQUIRE_TOKEN.
`;

/** Data leggibile, o un trattino se assente. */
const quando = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '-');

/**
 * Esegue i comandi di sicurezza che non richiedono l'host acceso.
 * @param {object} args opzioni gia' interpretate
 * @param {string} configFile
 * @returns {boolean} true se un comando e' stato eseguito (il processo termina)
 */
function runSecurityCommand(args, configFile) {
  const fine = (result, onOk) => {
    if (!result.ok) {
      console.error(`\n[wdeck] ${result.message}\n`);
      process.exitCode = 1;
      return;
    }
    onOk(result);
  };

  if (args['rotate-token']) {
    fine(rotateToken(configFile, { revokeDevices: args['revoke-devices'] }), (r) => {
      console.log('\n  Token principale rigenerato.\n');
      console.log(`  token : ${r.token}`);
      if (r.revokedDevices > 0) console.log(`  revocati ${r.revokedDevices} dispositivi accoppiati`);
      console.log('\n  I client collegati vanno riaccoppiati.'
        + ' Riavvia l\'host se e\' gia\' in esecuzione.\n');
    });
    return true;
  }

  if (args['list-devices']) {
    fine(listDevices(configFile), (r) => {
      if (r.devices.length === 0) {
        console.log('\n  Nessun dispositivo accoppiato.\n');
        return;
      }
      console.log('\n  Dispositivi accoppiati:\n');
      console.log('  id              nome                      creato            scade');
      for (const d of r.devices) {
        console.log(`  ${d.id.padEnd(15)} ${d.name.padEnd(25)} ${quando(d.createdAt).padEnd(17)} `
          + `${d.expiresAt ? quando(d.expiresAt) : 'mai'}${d.expired ? '  (SCADUTO)' : ''}`);
      }
      console.log('');
    });
    return true;
  }

  if (args['add-device']) {
    const days = args.days === undefined ? null : Number(args.days);
    fine(addDevice(configFile, { name: args['add-device'], days }), (r) => {
      console.log(`\n  Dispositivo "${r.device.name}" creato (${r.device.id}).\n`);
      console.log(`  token : ${r.token}`);
      console.log(`  scade : ${r.device.expiresAt ? quando(r.device.expiresAt) : 'mai'}`);
      console.log('\n  Il token si vede solo adesso: nel file ne resta la sola impronta.\n');
    });
    return true;
  }

  if (args['revoke-device']) {
    fine(revokeDevice(configFile, args['revoke-device']), (r) => {
      console.log(`\n  Dispositivo revocato: ${r.revoked}\n`);
    });
    return true;
  }

  if (args['prune-devices']) {
    fine(pruneExpiredDevices(configFile), (r) => {
      console.log(r.removed.length === 0
        ? '\n  Nessun dispositivo scaduto.\n'
        : `\n  Rimossi ${r.removed.length} dispositivi scaduti: ${r.removed.join(', ')}\n`);
    });
    return true;
  }

  return false;
}

function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        config: { type: 'string' },
        port: { type: 'string' },
        host: { type: 'string' },
        token: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'no-token': { type: 'boolean', default: false },
        'no-watch': { type: 'boolean', default: false },
        tls: { type: 'boolean', default: false },
        'no-qr': { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        'rotate-token': { type: 'boolean', default: false },
        'revoke-devices': { type: 'boolean', default: false },
        'list-devices': { type: 'boolean', default: false },
        'add-device': { type: 'string' },
        'revoke-device': { type: 'string' },
        'prune-devices': { type: 'boolean', default: false },
        days: { type: 'string' }
      },
      allowPositionals: false
    });
  } catch (err) {
    console.error(`Argomenti non validi: ${err.message}`);
    console.log(HELP);
    process.exit(2);
    return;
  }

  const args = parsed.values;
  if (args.help) {
    console.log(HELP);
    return;
  }

  // I comandi di sicurezza lavorano sul file e terminano: non serve (e non
  // conviene) tenere l'host acceso e raggiungibile per revocare un telefono.
  const configFile = path.resolve(args.config ?? path.join(PROJECT_ROOT, 'deck.json'));
  if (runSecurityCommand(args, configFile)) return;

  const overrides = {};
  if (args.port) overrides.port = Number(args.port);
  if (args.host) overrides.host = args.host;
  if (args.token) overrides.token = args.token;
  if (args['dry-run']) overrides.dryRun = true;
  if (args['no-token']) overrides.requireToken = false;
  if (args.tls) overrides.tls = true;

  const logger = args.quiet
    ? { ...console, info: () => {}, debug: () => {} }
    : console;

  let host;
  try {
    host = createHost({
      configFile: args.config,
      overrides,
      logger,
      watch: !args['no-watch']
    });
  } catch (err) {
    console.error(`\n[wdeck] avvio fallito:\n${err.message}\n`);
    process.exit(1);
    return;
  }

  for (const warning of host.configStore.warnings) {
    console.warn(`[wdeck] attenzione: ${warning.path}: ${warning.message}`);
  }

  host.start().then((info) => {
    const token = host.auth.token;
    const banner = [
      '',
      `  Wdeck host v${host.version} - deck "${host.configStore.get().name}"`,
      `  configurazione : ${host.configFile}`,
      `  piattaforma    : ${process.platform}`,
      `  cifratura      : ${info.tls ? 'HTTPS/WSS attivo' : 'assente (traffico in chiaro)'}`,
      `  dry-run        : ${host.state.dryRun ? 'ATTIVO (nessuna azione reale)' : 'disattivato'}`,
      `  azioni         : ${host.registry.types().join(', ')}`,
      '',
      '  URL del client web:'
    ];
    for (const url of info.urls) {
      banner.push(`    ${url}${host.auth.required ? `?token=${encodeURIComponent(token)}` : ''}`);
    }
    if (info.tls && host.tls?.selfSigned) {
      banner.push('', '  Il certificato e\' autofirmato: la prima volta il browser mostra un avviso,',
        '  va accettato una volta sola per dispositivo.');
    }
    if (host.auth.required) {
      banner.push('', `  token : ${token}${host.auth.generated ? '  (generato automaticamente)' : ''}`);
      if (host.auth.pinEnabled) banner.push('  PIN   : configurato (pairing via POST /api/pair)');
    } else {
      banner.push('', '  ATTENZIONE: autenticazione disattivata');
    }
    banner.push('', '  Ctrl+C per fermare', '');
    console.log(banner.join('\n'));
  }).catch((err) => {
    console.error(`\n[wdeck] impossibile mettersi in ascolto: ${err.message}\n`);
    process.exit(1);
  });

  const shutdown = async (signal) => {
    console.log(`\n[wdeck] ricevuto ${signal}, arresto in corso...`);
    await host.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
