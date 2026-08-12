/**
 * Livello di integrazione con il sistema operativo.
 *
 * Su Windows tutte le operazioni "native" (tasti media, hotkey, digitazione testo,
 * apertura URL/programmi) sono realizzate tramite PowerShell: nessuna dipendenza
 * nativa da compilare. Su altre piattaforme le funzioni falliscono in modo
 * esplicito e controllato (vedi docs/ROADMAP.md).
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { VK } from './keys.mjs';

const KEYEVENTF_EXTENDEDKEY = 0x0001;
const KEYEVENTF_KEYUP = 0x0002;

/** Tasti che richiedono il flag "extended" in keybd_event. */
const EXTENDED_KEYS = new Set([
  VK.left, VK.up, VK.right, VK.down,
  VK.home, VK.end, VK.pageup, VK.pagedown,
  VK.insert, VK.delete, VK.printscreen, VK.numlock,
  VK.win, VK.rwin, VK.apps,
  VK.volumemute, VK.volumedown, VK.volumeup,
  VK.medianext, VK.mediaprev, VK.mediastop, VK.mediaplaypause,
  VK.browserback, VK.browserforward
]);

export const isWindows = () => process.platform === 'win32';

/** Percorso dell'eseguibile PowerShell (sovrascrivibile via WDECK_POWERSHELL). */
export function powershellPath() {
  return process.env.WDECK_POWERSHELL || 'powershell.exe';
}

/**
 * Codifica uno script PowerShell per `-EncodedCommand` (UTF-16LE + base64).
 * Evita completamente i problemi di quoting/escaping degli argomenti.
 * @param {string} script
 * @returns {string}
 */
export function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * Esegue uno script PowerShell e ne raccoglie l'output.
 * @param {string} script
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{code: number|null, stdout: string, stderr: string, timedOut: boolean}>}
 */
export function runPowerShell(script, { timeoutMs = 15000 } = {}) {
  if (!isWindows()) {
    return Promise.reject(new Error('PowerShell non disponibile: questa azione richiede Windows'));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(script)],
      { windowsHide: true }
    );

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut });
    });
  });
}

/**
 * Genera lo script PowerShell che preme (e rilascia) una combinazione di tasti.
 * Funzione pura: usata anche dai test e dalla modalita' dry-run per mostrare
 * esattamente cosa verrebbe eseguito.
 * @param {number[]} modifierCodes
 * @param {number} keyCode
 * @param {{repeat?: number}} [options]
 * @returns {string}
 */
export function buildKeyScript(modifierCodes, keyCode, { repeat = 1 } = {}) {
  const times = Math.max(1, Math.min(20, Number(repeat) || 1));
  const flagsFor = (code) => (EXTENDED_KEYS.has(code) ? KEYEVENTF_EXTENDEDKEY : 0);
  const down = (code) => `$k::keybd_event(${hex(code)},0,${hex(flagsFor(code))},[UIntPtr]::Zero)`;
  const up = (code) => `$k::keybd_event(${hex(code)},0,${hex(flagsFor(code) | KEYEVENTF_KEYUP)},[UIntPtr]::Zero)`;

  const lines = [
    '$sig = @\'',
    '[DllImport("user32.dll", SetLastError=true)]',
    'public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);',
    '\'@',
    "$k = Add-Type -MemberDefinition $sig -Name 'WdeckKeys' -Namespace 'Wdeck' -PassThru"
  ];

  for (const code of modifierCodes) lines.push(down(code));
  for (let i = 0; i < times; i += 1) {
    lines.push(down(keyCode));
    lines.push(up(keyCode));
    if (i < times - 1) lines.push('Start-Sleep -Milliseconds 40');
  }
  for (const code of [...modifierCodes].reverse()) lines.push(up(code));

  return lines.join('\n');
}

const hex = (n) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

/**
 * Applica l'escaping richiesto da WScript.Shell.SendKeys.
 * @param {string} text
 * @returns {string}
 */
export function escapeSendKeys(text) {
  return String(text)
    .replace(/[+^%~(){}[\]]/g, (ch) => `{${ch}}`)
    .replace(/\r\n|\r|\n/g, '{ENTER}');
}

/**
 * Genera lo script PowerShell che digita un testo tramite SendKeys.
 * @param {string} text
 * @returns {string}
 */
export function buildTypeTextScript(text) {
  const payload = Buffer.from(escapeSendKeys(text), 'utf8').toString('base64');
  return [
    `$b64 = '${payload}'`,
    '$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64))',
    "$wsh = New-Object -ComObject WScript.Shell",
    '$wsh.SendKeys($text)'
  ].join('\n');
}

/**
 * Genera lo script PowerShell che apre un URL con il gestore predefinito.
 * @param {string} url
 * @returns {string}
 */
export function buildOpenUrlScript(url) {
  const payload = Buffer.from(String(url), 'utf8').toString('base64');
  return [
    `$b64 = '${payload}'`,
    '$url = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64))',
    'Start-Process $url'
  ].join('\n');
}

/**
 * Avvia un programma esterno in modo detached (l'host non attende la chiusura).
 * @param {{path: string, args?: string[], cwd?: string}} spec
 * @returns {Promise<{pid: number|undefined}>}
 */
export function launchProcess({ path: exePath, args = [], cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, args, {
      cwd: cwd || path.dirname(exePath),
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.on('error', reject);
    // Un piccolo ritardo evita di risolvere prima che 'error' possa essere emesso.
    setTimeout(() => {
      child.unref();
      resolve({ pid: child.pid });
    }, 30);
  });
}

/**
 * Determina il comando da usare per eseguire uno script in base all'estensione.
 * Funzione pura, testabile su qualunque piattaforma.
 * @param {string} scriptPath
 * @param {string[]} args
 * @returns {{command: string, argv: string[]}}
 */
export function resolveScriptRunner(scriptPath, args = []) {
  const ext = path.extname(scriptPath).toLowerCase();
  switch (ext) {
    case '.ps1':
      return {
        command: powershellPath(),
        argv: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]
      };
    case '.bat':
    case '.cmd':
      return { command: process.env.COMSPEC || 'cmd.exe', argv: ['/c', scriptPath, ...args] };
    case '.py':
      return { command: process.env.WDECK_PYTHON || 'python', argv: [scriptPath, ...args] };
    case '.js':
    case '.mjs':
      return { command: process.execPath, argv: [scriptPath, ...args] };
    case '.exe':
    case '.com':
      return { command: scriptPath, argv: [...args] };
    default:
      throw new Error(`estensione script non supportata: "${ext || '(nessuna)'}"`);
  }
}

/**
 * Esegue uno script e ne raccoglie l'output (usato dall'azione `script`).
 * @param {{path: string, args?: string[], cwd?: string, timeoutMs?: number}} spec
 * @returns {Promise<{code: number|null, stdout: string, stderr: string, timedOut: boolean}>}
 */
export function runScript({ path: scriptPath, args = [], cwd, timeoutMs = 30000 }) {
  const { command, argv } = resolveScriptRunner(scriptPath, args);
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, { cwd: cwd || path.dirname(scriptPath), windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim().slice(0, 4000), stderr: stderr.trim().slice(0, 4000), timedOut });
    });
  });
}
