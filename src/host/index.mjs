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
import { createDefaultRegistry } from './actions/handlers/index.mjs';
import { createDispatcher } from './actions/dispatcher.mjs';
import { createState } from './state.mjs';
import { createAuth } from './security/auth.mjs';
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
    server: null,
    hub: null,
    upgrades: null,
    address: null
  };

  host.reload = () => {
    const result = configStore.reload();
    if (result.ok) {
      state.replaceDeck(result.deck);
      logger.info?.('[wdeck] configurazione ricaricata');
    }
    return result;
  };

  const api = createApiRouter(host);
  const hub = createHub(host);
  host.hub = hub;

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
