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

import { parseArgs } from 'node:util';
import { createHost } from '../src/host/index.mjs';

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
  --quiet             riduce i log
  -h, --help          mostra questo aiuto

Variabili d'ambiente equivalenti: WDECK_PORT, WDECK_HOST, WDECK_TOKEN,
WDECK_DRY_RUN, WDECK_REQUIRE_TOKEN.
`;

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
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false }
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

  const overrides = {};
  if (args.port) overrides.port = Number(args.port);
  if (args.host) overrides.host = args.host;
  if (args.token) overrides.token = args.token;
  if (args['dry-run']) overrides.dryRun = true;
  if (args['no-token']) overrides.requireToken = false;

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
      `  dry-run        : ${host.state.dryRun ? 'ATTIVO (nessuna azione reale)' : 'disattivato'}`,
      `  azioni         : ${host.registry.types().join(', ')}`,
      '',
      '  URL del client web:'
    ];
    for (const url of info.urls) {
      banner.push(`    ${url}${host.auth.required ? `?token=${encodeURIComponent(token)}` : ''}`);
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
