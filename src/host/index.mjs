/**
 * Composizione dell'host Wdeck: configurazione, registro azioni, stato,
 * dispatcher, API REST, hub WebSocket e file statici del client PWA.
 */

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ERROR_CODES } from '../../shared/protocol.mjs';
import { createConfigStore, envOverrides } from './config/loader.mjs';
import { saveDeck, writeAtomic } from './config/writer.mjs';
import { formatErrors, validateDeck } from './config/schema.mjs';
import { createUpdateChecker } from './updates.mjs';
import { applyUpdate, cleanupOldExe, restart as restartExe, selfUpdateSupport } from './update-apply.mjs';
import { startTray } from './tray.mjs';
import { createDefaultRegistry } from './actions/handlers/index.mjs';
import { createDispatcher } from './actions/dispatcher.mjs';
import { createState } from './state.mjs';
import { createStatusTracker } from './status.mjs';
import { createAuth } from './security/auth.mjs';
import { createRateLimits } from './security/ratelimit.mjs';
import { createIconStore } from './icons.mjs';
import { loadTlsOptions } from './security/tls.mjs';
import { createMdnsResponder } from './discovery.mjs';
import { createAuditLog, pressEntry } from './audit.mjs';
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
  const baseDir = path.dirname(configFile);

  /**
   * Scrive su deck.json una modifica del blocco sicurezza.
   *
   * Passa dal file cosi' com'e' su disco, come ogni altra scrittura: il deck in
   * memoria porta con se' gli override di avvio, e salvarli li renderebbe
   * permanenti.
   * @param {object} patch porzioni di settings.security da sostituire
   */
  function persistSecurity(patch) {
    const current = configStore.snapshot();
    const next = {
      ...current,
      settings: {
        ...(current.settings ?? {}),
        security: { ...(current.settings?.security ?? {}), ...patch }
      }
    };
    const validation = validateDeck(next, { actionTypes: registry.types() });
    if (!validation.valid) {
      logger.error?.(`[wdeck] impossibile salvare la sicurezza:\n${formatErrors(validation.errors)}`);
      return false;
    }
    writeAtomic(configFile, `${JSON.stringify(next, null, 2)}\n`);
    configStore.reload();
    return true;
  }

  // Il token principale imposto da --token o WDECK_TOKEN vale per quell'avvio
  // soltanto: non va scritto nel file, e una modifica del file non deve
  // sovrascriverlo a caldo.
  const tokenIsOverridden = overrides.token !== undefined;

  const auth = createAuth(deck.settings.security, {
    onChange: ({ token, devices, reason }) => {
      // Il token principale finisce nel file solo quando e' stato davvero
      // ruotato: accoppiare un telefono non deve scriverci dentro una
      // credenziale che l'utente non aveva messo.
      const scriviToken = reason === 'rotate' && !tokenIsOverridden;
      persistSecurity({ devices, ...(scriviToken ? { token } : {}) });
    }
  });

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
    // Le pressioni sono limitate per non trasformare un client impazzito in
    // decine di processi al secondo; i tentativi di autenticazione perche' un
    // PIN di quattro cifre, senza limite, si indovina in pochi secondi.
    limits: createRateLimits(deck.settings.security.rateLimit ?? {}),
    // Le icone caricate dall'utente stanno accanto a deck.json, non dentro:
    // un file di configurazione pieno di base64 non sarebbe piu' modificabile
    // a mano, che e' una delle cose che il progetto promette.
    icons: createIconStore({ dir: path.join(baseDir, 'icons'), logger }),
    // Wdeck esegue programmi su richiesta della rete: senza un registro
    // persistente non c'e' modo di ricostruire cosa e' successo, perche' i log
    // della console spariscono alla chiusura.
    audit: createAuditLog({
      file: deck.settings.security.audit?.file
        ? path.resolve(baseDir, deck.settings.security.audit.file)
        : path.join(baseDir, 'wdeck-audit.log'),
      enabled: options.audit !== false && deck.settings.security.audit?.enabled !== false,
      maxBytes: deck.settings.security.audit?.maxBytes,
      keep: deck.settings.security.audit?.keep,
      logger
    }),
    server: null,
    hub: null,
    upgrades: null,
    tray: null,
    mdns: null,
    address: null
  };

  /**
   * URL da cui un dispositivo puo' accoppiarsi, con il token dentro.
   * E' il contenuto del QR code: inquadrarlo apre il deck gia' collegato.
   * @param {string} [token] token da includere (default: quello principale)
   */
  host.pairingUrl = (token = auth.token) => {
    const port = host.address?.port ?? configStore.get().settings.server.port;
    const base = buildUrls(host.address?.host ?? configStore.get().settings.server.host, port, host.scheme ?? 'http');
    // Il primo URL della lista e' 127.0.0.1, che su un telefono non porta da
    // nessuna parte: si preferisce il primo indirizzo di rete vero.
    const url = base.find((u) => !u.includes('127.0.0.1')) ?? base[0];
    return auth.required ? `${url}?token=${encodeURIComponent(token)}` : url;
  };

  // Dopo una pressione lo stato va riletto: e' il momento in cui l'utente si
  // aspetta di vedere il bottone cambiare aspetto.
  state.on('press', () => status.scheduleAfterPress());
  state.on('action', (entry) => host.audit.write('press', pressEntry(entry)));
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
      // Una revoca scritta a mano in deck.json deve valere subito: prima un
      // token tolto dal file continuava a funzionare fino al riavvio.
      auth.syncFromConfig(result.deck.settings.security, { allowTokenChange: !tokenIsOverridden });
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

  // Sostituzione dell'eseguibile. Deliberatamente separata dal controllo
  // periodico: quello guarda e basta, questo agisce solo se chiamato.
  const supporto = selfUpdateSupport();
  host.selfUpdate = {
    support: { supported: supporto.supported, reason: supporto.reason },

    /** Scarica l'ultima release, ne verifica l'impronta e la mette al posto di questa. */
    async apply() {
      if (!supporto.supported) {
        return { ok: false, status: 409, code: ERROR_CODES.forbidden, error: supporto.reason };
      }
      const stato = await host.updates.check({ force: true });
      if (stato.error) {
        return { ok: false, status: 502, code: ERROR_CODES.internal, error: stato.error };
      }
      if (!stato.available) {
        return { ok: false, status: 409, code: ERROR_CODES.badRequest, error: `sei gia' alla versione ${host.version}` };
      }
      try {
        logger.info?.(`[wdeck] scarico la versione ${stato.latest.version}...`);
        const esito = await applyUpdate({
          release: stato.latest,
          exePath: supporto.exePath,
          onProgress: (fase) => logger.debug?.(`[wdeck] aggiornamento: ${fase}`)
        });
        logger.info?.(`[wdeck] versione ${esito.version} installata; la precedente resta in ${path.basename(esito.backup)}`);
        return { ok: true, from: host.version, restart: true, ...esito };
      } catch (err) {
        logger.warn?.(`[wdeck] aggiornamento non riuscito: ${err.message}`);
        return { ok: false, status: 500, code: ERROR_CODES.internal, error: err.message };
      }
    },

    /** Riavvia con la versione appena installata, dopo aver chiuso in ordine. */
    restart() {
      if (!supporto.supported) return;
      setTimeout(() => {
        host.stop().catch(() => {});
        restartExe(supporto.exePath);
      }, 300).unref?.();
    }
  };

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

  // Senza cifratura il token viaggia in chiaro dentro l'URL che si apre sul
  // telefono: chiunque sia sulla stessa rete puo' leggerlo. Il certificato
  // autofirmato non dimostra l'identita' dell'host, ma toglie di mezzo quello.
  const tlsConfig = deck.settings.server.tls ?? {};
  let tls = null;
  if (options.tls !== false) {
    try {
      tls = loadTlsOptions({
        config: tlsConfig,
        baseDir,
        hosts: ['localhost', '127.0.0.1', ...lanAddresses()],
        logger
      });
    } catch (err) {
      // Un errore nella configurazione TLS non deve lasciare l'host spento e
      // muto: si dice cosa non va e si prosegue in chiaro.
      logger.error?.(`[wdeck] TLS non attivabile: ${err.message}`);
      logger.warn?.('[wdeck] l\'host prosegue in HTTP: correggi settings.server.tls e riavvia');
      tls = null;
    }
  }
  host.tls = tls;
  host.scheme = tls ? 'https' : 'http';

  const onRequest = async (req, res) => {
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
  };

  const server = tls
    ? https.createServer({ key: tls.key, cert: tls.cert }, onRequest)
    : http.createServer(onRequest);

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
        configStore.on('change', (next) => {
          state.replaceDeck(next);
          auth.syncFromConfig(next.settings.security, { allowTokenChange: !tokenIsOverridden });
        });
      }
      host.updates.start();
      status.start();

      // Se stiamo girando, l'aggiornamento e' andato a buon fine: la copia di
      // sicurezza della versione precedente ha finito il suo lavoro.
      if (supporto.supported && cleanupOldExe(supporto.exePath)) {
        logger.debug?.('[wdeck] rimossa la copia della versione precedente');
      }

      // Un indirizzo numerico non si ricorda e cambia con il DHCP: annunciarsi
      // come "<nome>.local" da' un indirizzo stabile che macOS, iOS, Windows e
      // Android sanno risolvere senza installare nulla.
      const discovery = configStore.get().settings.discovery ?? {};
      if (discovery.enabled !== false && options.discovery !== false && bindHost !== '127.0.0.1') {
        host.mdns = createMdnsResponder({
          name: discovery.name ?? configStore.get().settings.server.publicName,
          port: addr.port,
          scheme: host.scheme,
          txt: { version: host.version, deck: configStore.get().name },
          logger
        });
        host.mdns.start().catch(() => {});
      }

      const settings = configStore.get().settings;
      if (settings.tray?.enabled !== false && options.tray !== false) {
        const urls = buildUrls(bindHost, addr.port, host.scheme);
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
        scheme: host.scheme,
        tls: Boolean(tls),
        mdns: host.mdns?.hostname ?? null,
        urls: buildUrls(bindHost, addr.port, host.scheme)
      });
    });
  });

  /** Ferma il server e libera le risorse. */
  host.stop = () => new Promise((resolve) => {
    configStore.close();
    host.updates.stop();
    status.stop();
    host.mdns?.stop();
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

/**
 * Costruisce l'elenco degli URL raggiungibili.
 * @param {string} bindHost
 * @param {number} port
 * @param {'http'|'https'} [scheme]
 */
export function buildUrls(bindHost, port, scheme = 'http') {
  const urls = [`${scheme}://127.0.0.1:${port}/`];
  if (bindHost === '0.0.0.0' || bindHost === '::') {
    for (const ip of lanAddresses()) urls.push(`${scheme}://${ip}:${port}/`);
  } else if (bindHost !== '127.0.0.1' && bindHost !== 'localhost') {
    urls.push(`${scheme}://${bindHost}:${port}/`);
  }
  return urls;
}

export { createDefaultRegistry, createDispatcher, createState, createAuth, createConfigStore };
