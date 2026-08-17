/** Azione di rete: richiesta HTTP verso webhook / API locali. */

import dns from 'node:dns/promises';
import net from 'node:net';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

/** Codici di reindirizzamento HTTP che l'azione segue manualmente. */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * Verifica se un indirizzo IPv4 appartenga a loopback, link-local o a un
 * intervallo privato (RFC 1918). Un IPv4 malformato viene bloccato per
 * prudenza. @param {string} ip @returns {boolean}
 */
function isPrivateIpv4(ip) {
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = o;
  if (a === 127) return true;                          // loopback 127.0.0.0/8
  if (a === 10) return true;                           // privato 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;    // privato 172.16.0.0/12
  if (a === 192 && b === 168) return true;             // privato 192.168.0.0/16
  if (a === 169 && b === 254) return true;             // link-local 169.254.0.0/16
  if (a === 0) return true;                            // "questo host" 0.0.0.0/8
  return false;
}

/**
 * Verifica se un indirizzo IP (v4 o v6) punti a un servizio interno che le
 * richieste HTTP dell'utente non devono poter raggiungere.
 * @param {string} ip @returns {boolean}
 */
function isPrivateIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) {
    const low = ip.toLowerCase();
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIpv4(mapped[1]);       // IPv4-mapped ::ffff:a.b.c.d
    if (low === '::1' || low === '::') return true;    // loopback / non specificato
    if (/^fe[89ab]/.test(low)) return true;            // link-local fe80::/10
    if (/^f[cd]/.test(low)) return true;               // unique local fc00::/7
    return false;
  }
  return true; // ne' IPv4 ne' IPv6 valido: blocca
}

/**
 * Lancia un errore "forbidden" se l'host risolve (anche) a un indirizzo
 * interno. I nomi vengono risolti prima di contattarli, cosi' un DNS che
 * punta a 127.0.0.1 (DNS rebinding) non aggira il blocco.
 * @param {string} hostname
 */
async function assertPublicHost(hostname) {
  const literal = net.isIP(hostname);
  const addresses = literal ? [hostname] : (await dns.lookup(hostname, { all: true })).map((r) => r.address);
  for (const ip of addresses) {
    if (isPrivateIp(ip)) {
      const err = new Error(`destinazione non consentita: "${hostname}" risolve a un indirizzo interno (${ip})`);
      err.code = 'forbidden';
      throw err;
    }
  }
}

export const httpAction = {
  type: 'http',
  title: 'Richiesta HTTP',
  description: 'Invia una richiesta HTTP (webhook). Utile per Home Assistant, Node-RED, OBS via plugin REST.',
  platforms: ['*'],
  category: 'browser',
  paramsHelp: {
    url: 'URL http/https',
    method: ALLOWED_METHODS.join(' | '),
    headers: 'oggetto chiave/valore (opzionale)',
    body: 'stringa (opzionale)',
    timeoutMs: 'intero 100..30000 (default 5000)'
  },
  validate(params) {
    if (typeof params?.url !== 'string' || params.url.trim() === '') throw new Error('parametro "url" mancante');
    let parsed;
    try {
      parsed = new URL(params.url);
    } catch {
      throw new Error(`parametro "url" non valido: "${params.url}"`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`schema non supportato per l'azione http: "${parsed.protocol}"`);
    }
    const method = (params.method ?? 'GET').toUpperCase();
    if (!ALLOWED_METHODS.includes(method)) throw new Error(`metodo HTTP non supportato: "${params.method}"`);
    if (params.headers !== undefined && (typeof params.headers !== 'object' || params.headers === null || Array.isArray(params.headers))) {
      throw new Error('parametro "headers" non valido: atteso oggetto');
    }
    if (params.body !== undefined && typeof params.body !== 'string') {
      throw new Error('parametro "body" non valido: atteso stringa');
    }
    if (params.timeoutMs !== undefined) {
      const t = Number(params.timeoutMs);
      if (!Number.isInteger(t) || t < 100 || t > 30000) throw new Error('parametro "timeoutMs" non valido: 100..30000');
    }
  },
  describe: (params) => `${(params?.method ?? 'GET').toUpperCase()} ${params?.url}`,
  async run(params, ctx) {
    const method = (params.method ?? 'GET').toUpperCase();
    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `invierebbe ${method} ${params.url}` };
    }
    const timeoutMs = params.timeoutMs ?? 5000;

    // SSRF: la destinazione e ogni redirect vengono ricontrollati, cosi' un
    // 3xx verso 127.0.0.1 o 169.254.169.254 non viene seguito alla cieca.
    let url = params.url;
    let response;
    const maxRedirects = 5;
    for (let hop = 0; ; hop++) {
      await assertPublicHost(new URL(url).hostname);
      response = await fetch(url, {
        method,
        headers: params.headers ?? undefined,
        body: ['GET', 'HEAD'].includes(method) ? undefined : params.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs)
      });
      const location = response.headers.get('location');
      if (!REDIRECT_STATUS.has(response.status) || !location) break;
      if (hop >= maxRedirects) throw new Error('troppi redirect nella richiesta HTTP');
      const next = new URL(location, url);
      if (!['http:', 'https:'].includes(next.protocol)) {
        throw new Error(`redirect verso uno schema non supportato: "${next.protocol}"`);
      }
      url = next.toString();
    }

    const text = (await response.text()).slice(0, 2000);
    if (!response.ok) {
      throw new Error(`richiesta HTTP fallita: ${response.status} ${response.statusText}`);
    }
    return { ok: true, detail: `${method} ${params.url} -> ${response.status}`, status: response.status, body: text };
  }
};

export default [httpAction];
