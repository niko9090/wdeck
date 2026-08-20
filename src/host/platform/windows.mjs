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
    let killTimer = null;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      // Escalation a SIGKILL se PowerShell non risponde a SIGTERM.
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gia' uscito */ } }, 2000);
    }, timeoutMs);

    const clearTimers = () => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); };

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimers();
      reject(err);
    });
    child.on('close', (code) => {
      clearTimers();
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
 * Stessa sequenza di `buildKeyScript`, ma come lista di operazioni invece che
 * come script: e' cio' che si manda al "key server" persistente, che le esegue
 * senza ricompilare ogni volta il P/Invoke. Ogni voce e' `{vk, flags}` (un
 * evento di tasto) oppure `{sleep}` (una pausa in ms). Funzione pura, testabile.
 * @param {number[]} modifierCodes
 * @param {number} keyCode
 * @param {{repeat?: number}} [options]
 * @returns {Array<{vk?: number, flags?: number, sleep?: number}>}
 */
export function buildKeyOps(modifierCodes, keyCode, { repeat = 1 } = {}) {
  const times = Math.max(1, Math.min(20, Number(repeat) || 1));
  const flagsFor = (code) => (EXTENDED_KEYS.has(code) ? KEYEVENTF_EXTENDEDKEY : 0);
  const ops = [];
  const down = (code) => ops.push({ vk: code, flags: flagsFor(code) });
  const up = (code) => ops.push({ vk: code, flags: flagsFor(code) | KEYEVENTF_KEYUP });
  for (const code of modifierCodes) down(code);
  for (let i = 0; i < times; i += 1) {
    down(keyCode);
    up(keyCode);
    if (i < times - 1) ops.push({ sleep: 40 });
  }
  for (const code of [...modifierCodes].reverse()) up(code);
  return ops;
}

/**
 * Codifica le operazioni per il protocollo (una riga) del key server:
 * `K:<vk>:<flags>` per un evento di tasto, `S:<ms>` per una pausa, in esadecimale
 * e separate da `;`. Solo numeri: nessuno script arbitrario passa di qui.
 * @param {Array<{vk?: number, flags?: number, sleep?: number}>} ops
 * @returns {string}
 */
export function encodeKeyOps(ops) {
  return ops.map((op) => (op.sleep != null
    ? `S:${(op.sleep & 0xffff).toString(16)}`
    : `K:${(op.vk & 0xff).toString(16)}:${(op.flags & 0xffff).toString(16)}`)).join(';');
}

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
 * Funzione PowerShell che invia Win+Ctrl+Freccia, la scorciatoia ufficiale per
 * spostarsi fra desktop virtuali. Tutti e tre i tasti sono "extended".
 */
export const VK_WIN_CTRL_ARROW_SCRIPT = [
  '$sigK = @\'',
  '[DllImport("user32.dll", SetLastError=true)]',
  'public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);',
  '\'@',
  "$kb = Add-Type -MemberDefinition $sigK -Name 'WdeckDesk' -Namespace 'Wdeck' -PassThru",
  'function Wdeck-DesktopStep([string]$dir) {',
  '  $arrow = if ($dir -eq \'right\') { 0x27 } else { 0x25 }',
  '  $kb::keybd_event(0x5B, 0, 0x0001, [UIntPtr]::Zero)',
  '  $kb::keybd_event(0x11, 0, 0x0001, [UIntPtr]::Zero)',
  '  $kb::keybd_event($arrow, 0, 0x0001, [UIntPtr]::Zero)',
  '  $kb::keybd_event($arrow, 0, 0x0003, [UIntPtr]::Zero)',
  '  $kb::keybd_event(0x11, 0, 0x0003, [UIntPtr]::Zero)',
  '  $kb::keybd_event(0x5B, 0, 0x0003, [UIntPtr]::Zero)',
  '}'
].join('\n');

/**
 * Blocco P/Invoke riusato da tutti gli script che manipolano finestre.
 * Definito una volta sola per non duplicare la stessa Add-Type in mezzo file.
 */
export const WINDOW_PINVOKE = [
  '$sig = @\'',
  '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
  '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);',
  '[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);',
  '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);',
  '[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);',
  '[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);',
  '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int t, uint flags);',
  '[DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool repaint);',
  '[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
  '\'@',
  "$w = Add-Type -MemberDefinition $sig -Name 'WdeckWin' -Namespace 'Wdeck' -PassThru"
].join('\n');

/**
 * Funzione PowerShell che porta davvero una finestra in primo piano.
 *
 * Windows rifiuta SetForegroundWindow se il processo chiamante non possiede
 * gia' il focus (foreground lock): qui il vincolo viene aggirato agganciando
 * temporaneamente il thread di input della finestra attiva a quello della
 * finestra da attivare, che e' la tecnica documentata e non invasiva.
 */
export const FOCUS_HELPER = [
  'function Wdeck-Focus([IntPtr]$h) {',
  '  if ($h -eq [IntPtr]::Zero) { return $false }',
  '  if ($w::IsIconic($h)) { [void]$w::ShowWindow($h, 9) } else { [void]$w::ShowWindow($h, 5) }',
  '  $fg = $w::GetForegroundWindow()',
  '  $tidFg = $w::GetWindowThreadProcessId($fg, [IntPtr]::Zero)',
  '  $tidMe = $w::GetCurrentThreadId()',
  '  $attached = $false',
  '  if ($tidFg -ne $tidMe) { $attached = $w::AttachThreadInput($tidFg, $tidMe, $true) }',
  '  [void]$w::BringWindowToTop($h)',
  '  $ok = $w::SetForegroundWindow($h)',
  '  if ($attached) { [void]$w::AttachThreadInput($tidFg, $tidMe, $false) }',
  '  return $ok',
  '}'
].join('\n');

/**
 * Genera lo script che porta in primo piano la finestra principale di un PID.
 * Attende che la finestra esista: i programmi appena avviati non ce l'hanno subito.
 * @param {number} pid
 * @param {{timeoutMs?: number}} [options]
 * @returns {string}
 */
export function buildFocusPidScript(pid, { timeoutMs = 4000, processName = null } = {}) {
  const attempts = Math.max(1, Math.round(Number(timeoutMs) / 150));
  const lines = [
    WINDOW_PINVOKE,
    FOCUS_HELPER,
    `$target = ${Number(pid)}`,
    `for ($i = 0; $i -lt ${attempts}; $i++) {`,
    '  $p = Get-Process -Id $target -ErrorAction SilentlyContinue',
    '  if ($null -ne $p) {',
    '    $p.Refresh()',
    '    if ($p.MainWindowHandle -ne [IntPtr]::Zero) {',
    '      if (Wdeck-Focus $p.MainWindowHandle) { Write-Output "focus:ok"; exit 0 }',
    '    }',
    '  }'
  ];

  // Diversi programmi non tengono la finestra sul processo che si e' avviato:
  // il Blocco note di Windows 11 passa il documento a un'istanza gia' viva, gli
  // installer e i launcher di giochi delegano a un secondo eseguibile. Senza
  // questo secondo tentativo per nome, il focus fallirebbe proprio nei casi in
  // cui la finestra e' comparsa davvero.
  if (processName) {
    const b64 = Buffer.from(String(processName), 'utf8').toString('base64');
    lines.push(
      `  $name = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}'))`,
      '  $alt = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Sort-Object StartTime -Descending | Select-Object -First 1',
      '  if ($null -ne $alt) {',
      '    if (Wdeck-Focus $alt.MainWindowHandle) { Write-Output "focus:ok"; exit 0 }',
      '  }'
    );
  }

  lines.push(
    '  Start-Sleep -Milliseconds 150',
    '}',
    'Write-Output "focus:none"'
  );
  return lines.join('\n');
}

/**
 * Genera lo script che porta in primo piano una finestra cercata per nome
 * di processo o per titolo (confronto case-insensitive, con caratteri jolly).
 * @param {{process?: string, title?: string}} spec
 * @returns {string}
 */
export function buildFocusWindowScript({ process: procName, title }) {
  const b64 = (v) => Buffer.from(String(v), 'utf8').toString('base64');
  const lines = [
    WINDOW_PINVOKE,
    FOCUS_HELPER,
    '$cands = Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }'
  ];
  if (procName) {
    lines.push(
      `$n = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64(procName)}'))`,
      '$cands = $cands | Where-Object { $_.ProcessName -like $n -or $_.ProcessName -eq [System.IO.Path]::GetFileNameWithoutExtension($n) }'
    );
  }
  if (title) {
    lines.push(
      `$t = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64(title)}'))`,
      '$cands = $cands | Where-Object { $_.MainWindowTitle -like "*$t*" }'
    );
  }
  lines.push(
    '$target = $cands | Sort-Object -Property StartTime -Descending | Select-Object -First 1',
    'if ($null -eq $target) { Write-Output "focus:none"; exit 3 }',
    'if (Wdeck-Focus $target.MainWindowHandle) { Write-Output "focus:ok" } else { Write-Output "focus:failed"; exit 4 }'
  );
  return lines.join('\n');
}

/**
 * Porta in primo piano la finestra di un processo appena avviato.
 * Non lancia mai: il focus e' un "di piu'", il programma e' comunque partito.
 * @param {number} pid
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<boolean>}
 */
export async function focusPid(pid, options = {}) {
  if (!isWindows() || !pid) return false;
  // Il nome del processo si ricava dal percorso dell'eseguibile lanciato e
  // serve al tentativo di riserva quando il pid non possiede la finestra.
  const processName = options.processName
    ?? (options.exePath ? path.basename(options.exePath, path.extname(options.exePath)) : null);
  try {
    const res = await runPowerShell(
      buildFocusPidScript(pid, { ...options, processName }),
      { timeoutMs: (options.timeoutMs ?? 4000) + 3000 }
    );
    return res.code === 0 && res.stdout.includes('focus:ok');
  } catch {
    return false;
  }
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
    case '.cmd': {
      // cmd.exe /c ri-analizza la riga di comando: un argomento con
      // metacaratteri (& | ^ < > " %) verrebbe interpretato come comando a se'
      // (es. "& calc" avvia calc). Non esiste un quoting affidabile per tutti
      // questi casi, quindi li si rifiuta con un errore chiaro.
      for (const arg of args) {
        if (/[&|^<>"%]/.test(String(arg))) {
          throw new Error(`argomento non ammesso per uno script .bat/.cmd: "${arg}" `
            + '(contiene un metacarattere di cmd.exe fra & | ^ < > " %)');
        }
      }
      return { command: process.env.COMSPEC || 'cmd.exe', argv: ['/c', scriptPath, ...args] };
    }
    case '.py':
      return { command: process.env.WDECK_PYTHON || 'python', argv: [scriptPath, ...args] };
    // Gli script di shell servono a macOS e Linux: l'azione `script` dichiara
    // platforms ['*'], ma fuori da Windows non avrebbe avuto nulla da eseguire.
    case '.sh':
      return { command: process.env.WDECK_SHELL || '/bin/sh', argv: [scriptPath, ...args] };
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
    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      // Escalation a SIGKILL se lo script non risponde a SIGTERM.
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gia' uscito */ } }, 2000);
    }, timeoutMs);

    const clearTimers = () => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); };

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimers();
      reject(err);
    });
    child.on('close', (code) => {
      clearTimers();
      resolve({ code, stdout: stdout.trim().slice(0, 4000), stderr: stderr.trim().slice(0, 4000), timedOut });
    });
  });
}
