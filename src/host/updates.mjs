/**
 * Controllo aggiornamenti tramite le release di GitHub.
 *
 * L'host non scarica e non installa nulla da solo: si limita a confrontare la
 * propria versione con l'ultima release pubblicata e a segnalarlo al client,
 * che mostra la notifica. Un aggiornamento automatico che sostituisce eseguibili
 * sul PC di qualcun altro e' una decisione che spetta all'utente, non al programma.
 */

/** Ogni quanto ricontrollare, se il controllo periodico e' attivo. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Confronta due versioni semver (senza pre-release).
 * @param {string} a
 * @param {string} b
 * @returns {number} negativo se a < b, 0 se uguali, positivo se a > b
 */
export function compareVersions(a, b) {
  const parse = (v) => String(v).replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const va = parse(a);
  const vb = parse(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i += 1) {
    const diff = (va[i] ?? 0) - (vb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Interroga l'API GitHub per l'ultima release del repository.
 * @param {string} repository nella forma "utente/repo"
 * @param {{timeoutMs?: number, fetchImpl?: Function}} [options]
 * @returns {Promise<{version: string, name: string, url: string, notes: string, publishedAt: string, asset: object|null}>}
 */
export async function fetchLatestRelease(repository, { timeoutMs = 8000, fetchImpl = fetch } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repository))) {
    throw new Error(`repository non valido: "${repository}" (atteso "utente/repo")`);
  }
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wdeck-update-check' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (response.status === 404) {
    throw new Error(`nessuna release pubblicata per ${repository}`);
  }
  if (!response.ok) {
    throw new Error(`GitHub ha risposto ${response.status}`);
  }
  const data = await response.json();
  const installer = (data.assets ?? []).find((a) => /\.(exe|msi|zip)$/i.test(a.name ?? ''));
  return {
    version: String(data.tag_name ?? '').replace(/^v/i, ''),
    name: data.name ?? data.tag_name ?? '',
    url: data.html_url ?? `https://github.com/${repository}/releases/latest`,
    notes: String(data.body ?? '').slice(0, 4000),
    publishedAt: data.published_at ?? null,
    asset: installer ? { name: installer.name, url: installer.browser_download_url, size: installer.size } : null
  };
}

/**
 * Crea il servizio di controllo aggiornamenti.
 * @param {{version: string, repository: string, enabled?: boolean, logger?: object, onUpdate?: Function}} spec
 */
export function createUpdateChecker({ version, repository, enabled = true, logger = console, onUpdate }) {
  /** @type {{checkedAt: number, available: boolean, current: string, latest: object|null, error: string|null}} */
  let last = { checkedAt: 0, available: false, current: version, latest: null, error: null };
  let timer = null;

  /**
   * Esegue il controllo. Non lancia mai: un problema di rete non deve
   * disturbare chi sta usando il deck.
   * @param {{force?: boolean}} [options]
   */
  async function check({ force = false } = {}) {
    if (!enabled && !force) return last;
    try {
      const latest = await fetchLatestRelease(repository);
      const available = compareVersions(latest.version, version) > 0;
      last = { checkedAt: Date.now(), available, current: version, latest, error: null };
      if (available) {
        logger.info?.(`[wdeck] aggiornamento disponibile: ${version} -> ${latest.version} (${latest.url})`);
        onUpdate?.(last);
      }
    } catch (err) {
      last = { ...last, checkedAt: Date.now(), error: err.message };
      logger.debug?.(`[wdeck] controllo aggiornamenti non riuscito: ${err.message}`);
    }
    return last;
  }

  return {
    get status() {
      return last;
    },
    check,
    /** Avvia il controllo periodico (il primo dopo 10s, per non rallentare l'avvio). */
    start() {
      if (!enabled || timer) return;
      const first = setTimeout(() => check(), 10000);
      first.unref?.();
      timer = setInterval(() => check(), CHECK_INTERVAL_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
