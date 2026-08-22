/**
 * Funzioni "desktop" usate dalle pagine dinamiche del client:
 *  - listWindows / focusWindowByHandle  -> "pagina Finestre" (task switcher)
 *  - listStartMenuApps / launchStartMenuApp -> "pagina App" (lancia-app)
 *  - readSystemInfo -> widget di stato del PC
 *
 * Tutto cio' che tocca finestre e scorciatoie e' Windows-only e passa da
 * PowerShell (riuso del runner di windows.mjs); su altri sistemi le funzioni
 * restituiscono elenchi vuoti invece di fallire, cosi' le pagine restano vuote
 * ma il client non va in errore. readSystemInfo usa solo il modulo `os` di Node
 * ed e' quindi multipiattaforma.
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { isWindows, runPowerShell, WINDOW_PINVOKE, FOCUS_HELPER } from './windows.mjs';

/** Analizza l'output JSON di PowerShell garantendo sempre un array. */
function parseJsonArray(stdout) {
  const text = (stdout || '').trim();
  if (!text) return [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (Array.isArray(data)) return data;
  return [data];
}

/**
 * Elenca le finestre di primo livello con un titolo (le app visibili).
 * @returns {Promise<Array<{handle: string, title: string, process: string}>>}
 */
export async function listWindows() {
  if (!isWindows()) return [];
  const script = [
    'Get-Process |',
    '  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne \'\' } |',
    '  Select-Object @{n=\'handle\';e={[int64]$_.MainWindowHandle}}, @{n=\'title\';e={$_.MainWindowTitle}}, @{n=\'process\';e={$_.ProcessName}} |',
    '  Sort-Object title |',
    '  ConvertTo-Json -Compress'
  ].join('\n');
  const { stdout } = await runPowerShell(script, { timeoutMs: 6000 });
  return parseJsonArray(stdout)
    .filter((w) => w && w.handle !== undefined && w.title)
    .map((w) => ({ handle: String(w.handle), title: String(w.title), process: String(w.process ?? '') }));
}

/**
 * Porta in primo piano la finestra con l'handle indicato (dalla lista sopra).
 * @param {string|number} handle
 * @returns {Promise<boolean>}
 */
export async function focusWindowByHandle(handle) {
  if (!isWindows()) return false;
  const num = String(handle).replace(/[^0-9-]/g, '');
  if (!num || !/^-?\d+$/.test(num)) throw new Error('handle non valido');
  const script = [
    WINDOW_PINVOKE,
    FOCUS_HELPER,
    `$h = [IntPtr]([int64]${num})`,
    'if (Wdeck-Focus $h) { Write-Output "focus:ok"; exit 0 } else { Write-Output "focus:no"; exit 1 }'
  ].join('\n');
  const { stdout, code } = await runPowerShell(script, { timeoutMs: 5000 });
  return code === 0 || /focus:ok/.test(stdout);
}

/** Cartelle del menu Start (utente + tutti gli utenti). */
function startMenuDirs() {
  const dirs = [];
  if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  if (process.env.ProgramData) dirs.push(path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  return dirs;
}

/**
 * Elenca le scorciatoie (.lnk) del menu Start: le "app installate".
 * @returns {Promise<Array<{name: string, path: string}>>}
 */
export async function listStartMenuApps() {
  if (!isWindows()) return [];
  const seen = new Map(); // nome minuscolo -> voce (dedup)
  for (const dir of startMenuDirs()) {
    walkLnk(dir, (name, full) => {
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, { name, path: full });
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Ricorre una cartella raccogliendo i .lnk (fino a una profondita' ragionevole). */
function walkLnk(dir, onFile, depth = 0) {
  if (depth > 4) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkLnk(full, onFile, depth + 1);
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.lnk') {
      onFile(path.basename(entry.name, path.extname(entry.name)), full);
    }
  }
}

/**
 * Avvia una scorciatoia del menu Start. Per sicurezza accetta solo un .lnk che
 * sta davvero sotto una cartella del menu Start (il client passa un percorso
 * che ha ricevuto dall'host, ma non ci si fida ciecamente dell'input di rete).
 * @param {string} lnkPath
 * @returns {Promise<boolean>}
 */
export async function launchStartMenuApp(lnkPath) {
  if (!isWindows()) return false;
  if (typeof lnkPath !== 'string' || path.extname(lnkPath).toLowerCase() !== '.lnk') {
    throw new Error('percorso scorciatoia non valido');
  }
  const target = path.normalize(lnkPath).toLowerCase();
  const dentro = startMenuDirs().some((d) => target.startsWith(path.normalize(d).toLowerCase()));
  if (!dentro) throw new Error('la scorciatoia non e\' nel menu Start');
  if (!fs.existsSync(lnkPath)) throw new Error('scorciatoia inesistente');
  // Start-Process apre il .lnk con la shell, che risolve target e argomenti.
  const script = `Start-Process -FilePath ${JSON.stringify(lnkPath)}`;
  const { code } = await runPowerShell(script, { timeoutMs: 6000 });
  return code === 0;
}

/**
 * Stato del PC per i widget: host, CPU%, memoria, uptime. Solo modulo `os`,
 * quindi multipiattaforma e leggero. La CPU% si stima campionando due volte i
 * tempi cumulativi dei core a breve distanza.
 * @returns {Promise<{host: string, cpu: number, mem: {usedMb: number, totalMb: number, percent: number}, uptimeSec: number, cores: number}>}
 */
export async function readSystemInfo() {
  const cpu = await cpuUsagePercent();
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    host: os.hostname(),
    cpu,
    mem: {
      usedMb: Math.round(used / 1048576),
      totalMb: Math.round(total / 1048576),
      percent: total > 0 ? Math.round((used / total) * 100) : 0
    },
    uptimeSec: Math.round(os.uptime()),
    cores: os.cpus().length
  };
}

/** Somma i tempi dei core in due istanti e ricava la percentuale d'uso. */
function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const t of Object.values(cpu.times)) total += t;
    idle += cpu.times.idle;
  }
  return { idle, total };
}

function cpuUsagePercent() {
  return new Promise((resolve) => {
    const a = cpuTimes();
    setTimeout(() => {
      const b = cpuTimes();
      const idle = b.idle - a.idle;
      const total = b.total - a.total;
      const percent = total > 0 ? Math.round((1 - idle / total) * 100) : 0;
      resolve(Math.max(0, Math.min(100, percent)));
    }, 120);
  });
}
