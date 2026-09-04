/**
 * Controllo aggiornamenti tramite le release di GitHub.
 *
 * Questo modulo **guarda soltanto**: confronta la versione in esecuzione con
 * l'ultima release pubblicata e lo segnala. Non scarica niente di sua
 * iniziativa, nemmeno quando trova una versione nuova.
 *
 * A scaricare e sostituire ci pensa [`update-apply.mjs`](./update-apply.mjs), e
 * solo su richiesta esplicita: la differenza fra "ti avviso" e "mi sostituisco
 * da solo mentre esegui comandi sul tuo PC" e' l'intera ragione della
 * separazione fra i due file.
 */

import { FILE_IMPRONTE } from './update-apply.mjs';

/** Ogni quanto ricontrollare, se il controllo periodico e' attivo. */
// Ogni 30 minuti, non 6 ore: con 6 ore una release pubblicata un quarto
// d'ora dopo l'ultimo controllo restava invisibile per mezza giornata (il
// telefono resta collegato e il controllo del client parte solo al
// ricollegamento). GitHub concede 60 richieste l'ora senza token: 2 l'ora
// dall'host, piu' quelle dei client (frenate sotto), stanno larghe.
export const CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** Sotto questa distanza da un controllo riuscito si risponde con l'ultimo esito. */
export const MIN_FRESH_MS = 2 * 60 * 1000;

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
  const assets = data.assets ?? [];
  // L'aggiornamento a caldo sostituisce il PROPRIO eseguibile rinominandolo:
  // deve percio' scaricare il binario nudo `wdeck.exe`, non l'installer
  // `WdeckSetup-x.exe` (che pure finisce in .exe). Una release ne pubblica
  // entrambi, quindi il nudo va scelto per nome, non "il primo .exe capitato".
  const installer = assets.find((a) => /^wdeck\.exe$/i.test(a.name ?? ''))
    ?? assets.find((a) => /\.exe$/i.test(a.name ?? '') && !/setup/i.test(a.name ?? ''))
    ?? assets.find((a) => /\.exe$/i.test(a.name ?? ''))
    ?? assets.find((a) => /\.(msi|zip)$/i.test(a.name ?? ''));
  const impronte = assets.find((a) => a.name === FILE_IMPRONTE);
  return {
    version: String(data.tag_name ?? '').replace(/^v/i, ''),
    name: data.name ?? data.tag_name ?? '',
    url: data.html_url ?? `https://github.com/${repository}/releases/latest`,
    notes: String(data.body ?? '').slice(0, 4000),
    publishedAt: data.published_at ?? null,
    asset: installer ? { name: installer.name, url: installer.browser_download_url, size: installer.size } : null,
    checksums: impronte ? { url: impronte.browser_download_url } : null
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
    // Freno: dieci client che si ricollegano insieme, o che chiedono tutti un
    // controllo "fresco" allo stesso minuto, farebbero dieci chiamate a GitHub
    // per la stessa risposta. Un esito riuscito vale due minuti per tutti,
    // anche per chi chiede "fresco" (check=1) dalla tray o dalle impostazioni.
    if (!last.error && last.checkedAt && Date.now() - last.checkedAt < MIN_FRESH_MS) return last;
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
