/**
 * Composizione dell'host Wdeck: configurazione, registro azioni, stato,
 * dispatcher, API REST, hub WebSocket e file statici del client PWA.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createConfigStore, envOverrides } from './config/loader.mjs';
import { saveDeck, writeAtomic } from './config/writer.mjs';
import { formatErrors, validateDeck } from './config/schema.mjs';
import { createUpdateChecker } from './updates.mjs';
import { startTray } from './tray.mjs';
import { createDefaultRegistry } from './actions/handlers/index.mjs';
import { createDispatcher } from './actions/dispatcher.mjs';
import { createState } from './state.mjs';
import { createStatusTracker } from './status.mjs';
import { createAuth } from './security/auth.mjs';
import { createIconStore } from './icons.mjs';
import { createApiRouter } from './server/api.mjs';
import { createHub } from './server/hub.mjs';
import { createStaticHandler } from './server/static.mjs';
import { createUpgradeHandler } from './ws/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, '..', '..');

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

/** Indirizzi IPv4 non-loopback della macchina, per stampare gli URL LAN. */
export function lanAddresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}

/**
 * Crea (senza avviarlo) l'host Wdeck.
 * @param {{
 *   configFile?: string,
 *   overrides?: object,
 *   logger?: object,
 *   extraHandlers?: object[],
 *   watch?: boolean
 * }} [options]
 */
export function createHost(options = {}) {
  const logger = options.logger ?? console;
  const configFile = path.resolve(options.configFile ?? path.join(PROJECT_ROOT, 'deck.json'));
  const overrides = { ...envOverrides(), ...(options.overrides ?? {}) };

  const registry = createDefaultRegistry({ extra: options.extraHandlers ?? [] });
  const configStore = createConfigStore({
    file: configFile,
    actionTypes: registry.types(),
    overrides,
    logger
  });

  const deck = configStore.load();

  // Un EventEmitter che emette 'error' senza ascoltatori fa terminare il
  // processo: senza questa riga un errore di battitura in deck.json durante la
  // ricarica a caldo spegnerebbe l'host invece di lasciarlo sulla versione
  // valida precedente, che e' esattamente il comportamento promesso.
  configStore.on('error', (err) => {
    logger.error?.(`[wdeck] deck.json non valido: ${err.message}`);
    if (Array.isArray(err.errors)) {
      for (const detail of err.errors.slice(0, 10)) {
        logger.error?.(`[wdeck]   - ${detail.path || '<root>'}: ${detail.message}`);
      }
    }
    logger.warn?.('[wdeck] resta attiva la configurazione precedente: correggi il file e salva di nuovo');
  });

  const state = createState(deck);
  const auth = createAuth(deck.settings.security);
  const baseDir = path.dirname(configFile);

  const dispatcher = createDispatcher({
    registry,
    state,
    getDeck: () => configStore.get(),
    baseDir,
    logger
  });

  // Lo stato reale dei controlli (muto acceso, scena OBS in onda, livello del
  // volume) e' letto dal sistema, non dedotto dalle pressioni: e' l'unico modo
  // perche' resti giusto anche quando il PC viene toccato da altrove.
  const statusSettings = deck.settings.status ?? {};
  const status = createStatusTracker({
    registry,
    state,
    getDeck: () => configStore.get(),
    baseDir,
    logger,
    intervalMs: statusSettings.intervalMs,
    enabled: options.status !== false && statusSettings.enabled !== false
  });

  /** @type {any} */
  const host = {
    version: readVersion(),
    configFile,
    baseDir,
    logger,
    registry,
    configStore,
    state,
    auth,
    dispatcher,
    status,
    // Le icone caricate dall'utente stanno accanto a deck.json, non dentro:
    // un file di configurazione pieno di base64 non sarebbe piu' modificabile
    // a mano, che e' una delle cose che il progetto promette.
    icons: createIconStore({ dir: path.join(baseDir, 'icons'), logger }),
    server: null,
    hub: null,
    upgrades: null,
    tray: null,
    address: null
  };

  // Dopo una pressione lo stato va riletto: e' il momento in cui l'utente si
  // aspetta di vedere il bottone cambiare aspetto.
  state.on('press', () => status.scheduleAfterPress());
  // Cambio pagina o ricarica della configurazione: cambiano i controlli visibili.
  state.on('navigate', () => status.refresh({ force: true }).catch(() => {}));
  state.on('deck', () => {
    status.prune();
    status.refresh({ force: true }).catch(() => {});
  });

  host.reload = () => {
    const result = configStore.reload();
    if (result.ok) {
      state.replaceDeck(result.deck);
      logger.info?.('[wdeck] configurazione ricaricata');
    }
    return result;
  };

  /**
   * Salva su deck.json le modifiche fatte dall'editor visuale.
   * @param {object} incoming deck (o porzione) proveniente dal client
   */
  host.saveDeck = (incoming) => {
    const result = saveDeck({
      configPath: configFile,
      // Si parte dal file cosi' com'e' su disco, non dal deck normalizzato:
      // altrimenti un avvio con --port o --token scriverebbe quei valori
      // dentro deck.json al primo salvataggio, rendendoli permanenti.
      current: configStore.snapshot(),
      incoming,
      actionTypes: registry.types()
    });
    if (!result.ok) {
      logger.warn?.(`[wdeck] salvataggio rifiutato: ${result.errors?.length ?? 0} errori di validazione`);
      return result;
    }
    // Il watcher vedrebbe comunque la modifica, ma applicarla subito evita che
    // il client resti indietro per il tempo di debounce del file system.
    configStore.reload();
    state.replaceDeck(configStore.get());
    hub.broadcastDeck?.();
    logger.info?.(`[wdeck] deck salvato${result.backup ? ` (backup: ${path.basename(result.backup)})` : ''}`);
    return result;
  };

  /**
   * Aggiorna le impostazioni modificabili a caldo: PIN, tema, aggiornamenti.
   * Il token non passa da qui: cambiarlo scollegherebbe ogni client, quindi
   * resta un'operazione da fare a mano su deck.json.
   * @param {{pin?: string, ui?: object, updates?: object, tray?: object}} patch
   */
  host.updateSettings = (patch) => {
    // Come per saveDeck: la base e' il file su disco, non il deck con gli
    // override applicati.
    const current = configStore.snapshot();
    const changed = [];
    const next = JSON.parse(JSON.stringify({
      version: current.version,
      name: current.name,
      defaultProfile: current.defaultProfile,
      settings: current.settings ?? {},
      profiles: current.profiles
    }));

    if (patch.pin !== undefined) {
      const pin = String(patch.pin);
      if (pin !== '' && !/^[0-9]{4,12}$/.test(pin)) {
        return { ok: false, message: 'PIN non valido: sono ammesse da 4 a 12 cifre' };
      }
      next.settings.security = { ...next.settings.security, pin };
      changed.push('pin');
    }
    for (const section of ['ui', 'updates', 'tray', 'status']) {
      if (patch[section] !== undefined) {
        next.settings[section] = { ...next.settings[section], ...patch[section] };
        changed.push(section);
      }
    }
    if (changed.length === 0) return { ok: false, message: 'nessuna impostazione da aggiornare' };

    const validation = validateDeck(next, { actionTypes: registry.types() });
    if (!validation.valid) {
      return { ok: false, message: `impostazioni non valide:\n${formatErrors(validation.errors)}` };
    }

    writeAtomic(configFile, `${JSON.stringify(next, null, 2)}\n`);
    configStore.reload();
    state.replaceDeck(configStore.get());
    if (changed.includes('pin')) auth.setPin(next.settings.security.pin);
    logger.info?.(`[wdeck] impostazioni aggiornate: ${changed.join(', ')}`);
    return { ok: true, changed };
  };

  host.updates = createUpdateChecker({
    version: host.version,
    repository: deck.settings.updates?.repository ?? 'niko9090/wdeck',
    enabled: deck.settings.updates?.check !== false,
    logger,
    onUpdate: (status) => hub.broadcastUpdate?.(status)
  });

  const api = createApiRouter(host);
  const hub = createHub(host);
  host.hub = hub;
  status.on('change', (snapshot, changes) => hub.broadcastStatus(snapshot, changes));

  const serveStatic = createStaticHandler({
    roots: [path.join(PROJECT_ROOT, 'dist', 'web'), path.join(PROJECT_ROOT, 'web')],
    mounts: {
      '/shared/': [path.join(PROJECT_ROOT, 'shared')]
    }
  });

  const server = http.createServer(async (req, res) => {
    try {
      if (await api(req, res)) return;
      if (serveStatic(req, res)) return;
      // fallback SPA: qualunque percorso non-API restituisce index.html
      req.url = '/index.html';
      if (serveStatic(req, res)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 - risorsa non trovata');
    } catch (err) {
      logger.error?.(`[wdeck] errore richiesta: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 - errore interno');
      }
    }
  });

  const upgrades = createUpgradeHandler({
    routes: hub.routes,
    verify: (req, pathname) => hub.verifyUpgrade(req, pathname),
    logger
  });
  server.on('upgrade', (req, socket, head) => upgrades.handleUpgrade(req, socket, head));

  host.server = server;
  host.upgrades = upgrades;

  /**
   * Avvia il server HTTP.
   * @returns {Promise<{host: string, port: number, urls: string[]}>}
   */
  host.start = () => new Promise((resolve, reject) => {
    const { host: bindHost, port } = configStore.get().settings.server;
    server.once('error', reject);
    server.listen(port, bindHost, () => {
      server.removeListener('error', reject);
      const addr = server.address();
      host.address = { host: bindHost, port: addr.port };
      if (options.watch !== false) {
        configStore.watch();
        configStore.on('change', (next) => state.replaceDeck(next));
      }
      host.updates.start();
      status.start();

      const settings = configStore.get().settings;
      if (settings.tray?.enabled !== false && options.tray !== false) {
        const urls = buildUrls(bindHost, addr.port);
        host.tray = startTray({
          url: urls[0] ?? `http://127.0.0.1:${addr.port}`,
          urls: urls.map((u) => `${u}?token=${auth.token}`),
          token: auth.token,
          version: host.version,
          deckName: configStore.get().name,
          logger
        });
      }
      resolve({
        host: bindHost,
        port: addr.port,
        urls: buildUrls(bindHost, addr.port)
      });
    });
  });

  /** Ferma il server e libera le risorse. */
  host.stop = () => new Promise((resolve) => {
    configStore.close();
    host.updates.stop();
    status.stop();
    host.tray?.stop();
    hub.close();
    upgrades.closeAll();
    if (!server.listening) return resolve();
    server.close(() => resolve());
    // forza la chiusura delle connessioni keep-alive
    server.closeAllConnections?.();
    return undefined;
  });

  return host;
}

/** Costruisce l'elenco degli URL raggiungibili. */
export function buildUrls(bindHost, port) {
  const urls = [`http://127.0.0.1:${port}/`];
  if (bindHost === '0.0.0.0' || bindHost === '::') {
    for (const ip of lanAddresses()) urls.push(`http://${ip}:${port}/`);
  } else if (bindHost !== '127.0.0.1' && bindHost !== 'localhost') {
    urls.push(`http://${bindHost}:${port}/`);
  }
  return urls;
}

export { createDefaultRegistry, createDispatcher, createState, createAuth, createConfigStore };
