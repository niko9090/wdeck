/** Azione di rete: richiesta HTTP verso webhook / API locali. */

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

export const httpAction = {
  type: 'http',
  title: 'Richiesta HTTP',
  description: 'Invia una richiesta HTTP (webhook). Utile per Home Assistant, Node-RED, OBS via plugin REST.',
  platforms: ['*'],
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
    const response = await fetch(params.url, {
      method,
      headers: params.headers ?? undefined,
      body: ['GET', 'HEAD'].includes(method) ? undefined : params.body,
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = (await response.text()).slice(0, 2000);
    if (!response.ok) {
      throw new Error(`richiesta HTTP fallita: ${response.status} ${response.statusText}`);
    }
    return { ok: true, detail: `${method} ${params.url} -> ${response.status}`, status: response.status, body: text };
  }
};

export default [httpAction];
