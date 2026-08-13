/**
 * HTTPS e WSS con certificato autofirmato generato all'avvio.
 *
 * Senza cifratura il token viaggia in chiaro sulla LAN, dentro l'URL che si
 * apre sul telefono: chiunque sia sulla stessa rete Wi-Fi puo' leggerlo e usare
 * il deck. Con `settings.server.tls.enabled` l'host genera da solo la chiave e
 * il certificato, li conserva accanto a `deck.json` e li rigenera quando
 * scadono o quando cambiano gli indirizzi della macchina.
 *
 * Il certificato **non e' fidato da nessuna autorita'**: la prima volta il
 * browser mostra un avviso, e va accettato. Serve a cifrare, non a dimostrare
 * chi sia l'host. Chi ha un certificato vero (per esempio da una CA interna)
 * puo' indicarlo con `certFile` e `keyFile`, e questo modulo non genera nulla.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { generateSelfSigned } from './selfsigned.mjs';

/** Nome dei file dentro la cartella dei certificati. */
export const CERT_FILE = 'cert.pem';
export const KEY_FILE = 'key.pem';

/** Quanto prima della scadenza il certificato viene rigenerato. */
export const RENEW_BEFORE_MS = 7 * 86400_000;

/**
 * Verifica se un certificato esistente e' ancora buono.
 * @param {string} pem
 * @param {{hosts?: string[], now?: number}} [options]
 * @returns {{ok: boolean, reason?: string}}
 */
export function certificateUsable(pem, { hosts = [], now = Date.now() } = {}) {
  let cert;
  try {
    cert = new crypto.X509Certificate(pem);
  } catch (err) {
    return { ok: false, reason: `certificato illeggibile: ${err.message}` };
  }

  const notAfter = Date.parse(cert.validTo);
  if (!Number.isFinite(notAfter)) return { ok: false, reason: 'scadenza non interpretabile' };
  if (notAfter - now < RENEW_BEFORE_MS) return { ok: false, reason: 'scaduto o in scadenza' };

  // Un indirizzo IP nuovo (rete diversa, docking station, VPN) rende il
  // certificato inutile proprio dove serve: meglio rigenerarlo.
  for (const host of hosts) {
    const covered = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? cert.checkIP(host) : cert.checkHost(host);
    if (!covered) return { ok: false, reason: `non copre "${host}"` };
  }
  return { ok: true };
}

/**
 * Restituisce chiave e certificato, generandoli se servono.
 * @param {{
 *   dir: string,
 *   hosts?: string[],
 *   days?: number,
 *   commonName?: string,
 *   logger?: object,
 *   now?: number
 * }} options
 * @returns {{key: string, cert: string, generated: boolean, dir: string}}
 */
export function ensureCertificate({ dir, hosts = ['localhost', '127.0.0.1'], days = 825, commonName, logger = console, now = Date.now() }) {
  const root = path.resolve(dir);
  const certPath = path.join(root, CERT_FILE);
  const keyPath = path.join(root, KEY_FILE);

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const cert = fs.readFileSync(certPath, 'utf8');
    const check = certificateUsable(cert, { hosts, now });
    if (check.ok) {
      return { key: fs.readFileSync(keyPath, 'utf8'), cert, generated: false, dir: root };
    }
    logger.info?.(`[wdeck] certificato rigenerato: ${check.reason}`);
  }

  const generated = generateSelfSigned({
    altNames: hosts,
    days,
    ...(commonName ? { commonName } : {})
  });

  fs.mkdirSync(root, { recursive: true });
  // La chiave privata non deve essere leggibile dagli altri utenti della
  // macchina. Su Windows la modalita' POSIX viene ignorata, ma il file resta
  // dentro il profilo dell'utente.
  fs.writeFileSync(keyPath, generated.key, { mode: 0o600 });
  fs.writeFileSync(certPath, generated.cert, { mode: 0o644 });
  logger.info?.(`[wdeck] certificato autofirmato generato in ${root} (valido fino al ${generated.notAfter.toISOString().slice(0, 10)})`);

  return { key: generated.key, cert: generated.cert, generated: true, dir: root };
}

/**
 * Opzioni TLS per `https.createServer`, oppure null se la cifratura e' spenta.
 * @param {{
 *   config?: {enabled?: boolean, certFile?: string, keyFile?: string, days?: number},
 *   baseDir: string,
 *   hosts?: string[],
 *   logger?: object
 * }} options
 * @returns {{key: string, cert: string, selfSigned: boolean}|null}
 */
export function loadTlsOptions({ config = {}, baseDir, hosts = [], logger = console }) {
  if (config.enabled !== true) return null;

  if (config.certFile || config.keyFile) {
    if (!config.certFile || !config.keyFile) {
      throw new Error('TLS: servono sia settings.server.tls.certFile sia keyFile (oppure nessuno dei due, per generarli)');
    }
    const certPath = path.resolve(baseDir, config.certFile);
    const keyPath = path.resolve(baseDir, config.keyFile);
    for (const file of [certPath, keyPath]) {
      if (!fs.existsSync(file)) throw new Error(`TLS: file non trovato: ${file}`);
    }
    logger.info?.(`[wdeck] TLS con certificato fornito: ${certPath}`);
    return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8'), selfSigned: false };
  }

  const { key, cert } = ensureCertificate({
    dir: path.join(baseDir, '.wdeck-tls'),
    hosts: hosts.length > 0 ? hosts : ['localhost', '127.0.0.1'],
    days: config.days,
    logger
  });
  return { key, cert, selfSigned: true };
}
