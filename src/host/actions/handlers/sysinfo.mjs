/**
 * Azione `sysinfo`: i numeri del PC per i comandi di sola lettura (quadrante,
 * livello, grafico, display). Non fa nulla se premuta (mostra il valore):
 * il suo lavoro e' `readState`, che il poller di stato chiama ogni pochi
 * secondi. Era il pezzo mancante: i widget della pagina Novita' erano nati
 * con `noop` e non avevano NIENTE da mostrare ("--" per sempre).
 *
 * Metriche: cpu, ram, disk (percentuale usata + GB liberi), netDown/netUp
 * (Mbit/s, dai contatori delle schede di rete via level server), uptime,
 * clock, host. `level` e' 0..100 per cpu/ram/disk e Mbit/s per la rete
 * (il tile ha min/max suoi: un grafico di rete con max 100 va bene per una
 * fibra, con max 20 per un ADSL).
 */

import fs from 'node:fs';
import os from 'node:os';
import { readSystemInfo } from '../../platform/desktop.mjs';
import { readNetFast } from '../../platform/levelserver.mjs';
import { isWindows } from '../../platform/windows.mjs';

export const METRICS = ['cpu', 'ram', 'disk', 'netDown', 'netUp', 'uptime', 'clock', 'host'];

/** Ultimo campione dei contatori di rete, per ricavare la velocita'. */
let ultimaRete = null;

function formatGb(bytes) {
  const gb = bytes / 1e9;
  return gb >= 100 ? `${Math.round(gb)}` : gb.toFixed(1);
}

export function formatUptime(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const g = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (g > 0) return `${g}g ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

/**
 * Velocita' di rete dagli ultimi due campioni dei contatori (byte totali).
 * Il primo campione non ha un "prima": torna null e la volta dopo si sa.
 * @param {{rx: number, tx: number, at: number}} adesso
 * @param {{rx: number, tx: number, at: number}|null} prima
 * @returns {{downMbps: number, upMbps: number}|null}
 */
export function netRate(adesso, prima) {
  if (!prima || adesso.at <= prima.at) return null;
  const dt = (adesso.at - prima.at) / 1000;
  const down = Math.max(0, adesso.rx - prima.rx) * 8 / dt / 1e6;
  const up = Math.max(0, adesso.tx - prima.tx) * 8 / dt / 1e6;
  return { downMbps: Math.round(down * 10) / 10, upMbps: Math.round(up * 10) / 10 };
}

async function readNet({ readCounters = readNetFast, now = Date.now } = {}) {
  const c = await readCounters();
  const adesso = { rx: Number(c.rx) || 0, tx: Number(c.tx) || 0, at: now() };
  const rate = netRate(adesso, ultimaRete);
  ultimaRete = adesso;
  return rate;
}

/**
 * Legge una metrica. Separata dall'handler cosi' i test la chiamano con
 * letture finte (senza toccare CPU, dischi o PowerShell).
 * @param {string} metric
 * @param {{drive?: string}} params
 * @param {{sysinfo?: Function, statfs?: Function, readCounters?: Function, now?: Function}} [deps]
 * @returns {Promise<{level: number|null, text: string}>}
 */
export async function readMetric(metric, params = {}, deps = {}) {
  const sysinfo = deps.sysinfo ?? readSystemInfo;
  const now = deps.now ?? Date.now;
  switch (metric) {
    case 'cpu': {
      const info = await sysinfo();
      return { level: info.cpu, text: `${info.cpu}%` };
    }
    case 'ram': {
      const info = await sysinfo();
      return { level: info.mem.percent, text: `${(info.mem.usedMb / 1024).toFixed(1)}/${Math.round(info.mem.totalMb / 1024)} GB` };
    }
    case 'disk': {
      const statfs = deps.statfs ?? ((p) => fs.statfsSync(p));
      const drive = String(params.drive || (isWindows() ? 'C:\\' : '/'));
      const s = statfs(drive);
      const totale = s.bsize * s.blocks;
      const liberi = s.bsize * s.bavail;
      const usati = totale > 0 ? Math.round((1 - liberi / totale) * 100) : 0;
      return { level: usati, text: `${formatGb(liberi)} GB liberi` };
    }
    case 'netDown':
    case 'netUp': {
      const rate = await readNet({ readCounters: deps.readCounters, now });
      if (!rate) return { level: null, text: '…' };
      const v = metric === 'netDown' ? rate.downMbps : rate.upMbps;
      return { level: v, text: `${v} Mbit/s` };
    }
    case 'uptime':
      return { level: null, text: formatUptime(deps.uptime ?? os.uptime()) };
    case 'clock': {
      const d = new Date(now());
      return { level: null, text: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
    }
    case 'host':
      return { level: null, text: os.hostname() };
    default:
      throw new Error(`metrica sconosciuta: "${metric}"`);
  }
}

export const sysinfoAction = {
  type: 'sysinfo',
  title: 'Stato del PC',
  description: 'Mostra un numero del PC (CPU, memoria, disco, rete, tempo di accensione, ora) in un quadrante, un livello, un grafico o un display. Si aggiorna da solo; premendo il tasto mostra il valore.',
  platforms: ['*'],
  category: 'system',
  paramsHelp: { metric: `una fra ${METRICS.join(', ')}`, drive: 'unita\' per "disk" (default C:\\)' },
  fields: [
    {
      key: 'metric',
      label: 'Cosa mostrare',
      type: 'select',
      required: true,
      default: 'cpu',
      options: [
        { value: 'cpu', label: 'CPU (%)' },
        { value: 'ram', label: 'Memoria usata (%)' },
        { value: 'disk', label: 'Disco usato (%) e GB liberi' },
        { value: 'netDown', label: 'Rete in ricezione (Mbit/s)' },
        { value: 'netUp', label: 'Rete in invio (Mbit/s)' },
        { value: 'uptime', label: 'Acceso da' },
        { value: 'clock', label: 'Ora' },
        { value: 'host', label: 'Nome del PC' }
      ]
    },
    { key: 'drive', label: 'Unita\' (solo disco)', type: 'text', placeholder: 'C:\\' }
  ],
  validate(params) {
    if (!METRICS.includes(params?.metric)) throw new Error(`parametro "metric" non valido (${METRICS.join(', ')})`);
  },
  describe: (params) => `stato del PC: ${params?.metric ?? 'cpu'}`,
  async run(params) {
    const { text } = await readMetric(params.metric, params);
    return { ok: true, detail: text };
  },
  async readState(params) {
    const { level, text } = await readMetric(params.metric, params);
    return { on: null, level, text };
  }
};

export default [sysinfoAction];
