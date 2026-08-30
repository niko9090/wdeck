/**
 * "Key server" persistente per Windows.
 *
 * Ogni tasto media o hotkey, finora, avviava un nuovo PowerShell che con
 * `Add-Type` **ricompilava a runtime** il ponte verso `keybd_event`: ~300-700 ms
 * a pressione, quasi tutti spesi nella compilazione. Da qui la latenza che si
 * sentiva a ogni tocco.
 *
 * Qui il PowerShell resta acceso: compila il P/Invoke **una volta sola**, poi
 * legge dallo stdin una riga per pressione ed esegue gli eventi in pochi
 * millisecondi. Il protocollo trasporta **solo numeri** (codici tasto e flag):
 * nessuno script arbitrario, quindi la superficie di sicurezza non cambia.
 *
 * E' un'ottimizzazione, non un obbligo: se il processo non parte, si blocca o
 * viene disattivato (`WDECK_KEYSERVER=0`), chi chiama ricade sul vecchio metodo
 * a colpo singolo. La correttezza non dipende mai da lui.
 */

import { spawn } from 'node:child_process';
import { encodePowerShell, isWindows, powershellPath } from './windows.mjs';

/**
 * Script sempre uguale caricato nel processo: definisce keybd_event una volta,
 * poi cicla leggendo "<id> <op;op;...>" e risponde "<id> OK" o "<id> ERR ...".
 * Ogni op e' "K:<vk>:<flags>", "M:<flags>:<data>:<dx>:<dy>" o "S:<ms>"
 * (esadecimale). Le due coordinate del mouse arrivano sempre, 0 quando non
 * servono: cosi' la riga ha una forma sola e non c'e' niente da indovinare.
 */
const BOOTSTRAP = [
  '$ErrorActionPreference = "Stop"',
  '$sig = @\'',
  '[DllImport("user32.dll", SetLastError=true)]',
  'public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);',
  '[DllImport("user32.dll", SetLastError=true)]',
  'public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, System.UIntPtr dwExtraInfo);',
  '\'@',
  "$k = Add-Type -MemberDefinition $sig -Name 'WdeckKeys' -Namespace 'Wdeck' -PassThru",
  '$out = [Console]::Out',
  '$out.WriteLine("READY"); $out.Flush()',
  'while ($true) {',
  '  $line = [Console]::In.ReadLine()',
  '  if ($null -eq $line) { break }',
  '  if ($line.Length -eq 0) { continue }',
  '  $sp = $line.IndexOf(" ")',
  '  if ($sp -lt 0) { continue }',
  '  $id = $line.Substring(0, $sp)',
  '  $ops = $line.Substring($sp + 1)',
  '  try {',
  '    foreach ($op in $ops.Split(";")) {',
  '      if ($op.Length -eq 0) { continue }',
  '      $p = $op.Split(":")',
  '      if ($p[0] -eq "S") { Start-Sleep -Milliseconds ([Convert]::ToInt32($p[1], 16)) }',
  '      elseif ($p[0] -eq "M") { $k::mouse_event([uint32]([Convert]::ToUInt32($p[1], 16)), [uint32]([Convert]::ToUInt32($p[3], 16)), [uint32]([Convert]::ToUInt32($p[4], 16)), [uint32]([Convert]::ToUInt32($p[2], 16)), [UIntPtr]::Zero) }',
  '      else { $k::keybd_event([byte]([Convert]::ToInt32($p[1], 16)), 0, [uint32]([Convert]::ToInt32($p[2], 16)), [UIntPtr]::Zero) }',
  '    }',
  '    $out.WriteLine("$id OK"); $out.Flush()',
  '  } catch {',
  '    $out.WriteLine("$id ERR " + $_.Exception.Message); $out.Flush()',
  '  }',
  '}'
].join('\n');

const READY_MS = 5000;
const JOB_MS = 5000;

class KeyServer {
  constructor() {
    this.proc = null;
    this.ready = null;
    this.onReady = null;
    this.onReadyFail = null;
    this.jobId = 0;
    this.pending = new Map();
    this.buffer = '';
  }

  start() {
    if (this.ready) return this.ready;
    let proc;
    try {
      proc = spawn(powershellPath(), [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encodePowerShell(BOOTSTRAP)
      ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return Promise.reject(err);
    }
    this.proc = proc;

    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('key server: nessun READY entro il tempo')), READY_MS);
      this.onReady = () => { clearTimeout(timer); resolve(); };
      this.onReadyFail = (err) => { clearTimeout(timer); reject(err); };
    });

    proc.stdout.on('data', (d) => this.onData(d.toString()));
    proc.stderr.on('data', () => { /* gli errori tornano come "<id> ERR" sullo stdout */ });
    proc.on('error', (err) => this.fail(err));
    proc.on('exit', () => this.fail(new Error('key server: processo terminato')));
    return this.ready;
  }

  onData(text) {
    this.buffer += text;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      if (line === 'READY') { this.onReady?.(); continue; }
      const sp = line.indexOf(' ');
      const id = sp >= 0 ? line.slice(0, sp) : line;
      const rest = sp >= 0 ? line.slice(sp + 1) : '';
      const job = this.pending.get(id);
      if (!job) continue;
      this.pending.delete(id);
      clearTimeout(job.timer);
      if (rest.startsWith('OK')) job.resolve();
      else job.reject(new Error(`key server: ${rest || 'errore'}`));
    }
  }

  /** Abbatte il processo e rifiuta tutto: la prossima chiamata lo riavvia. */
  fail(err) {
    this.onReadyFail?.(err);
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(err); }
    this.pending.clear();
    const proc = this.proc;
    this.proc = null;
    this.ready = null;
    this.onReady = null;
    this.onReadyFail = null;
    this.buffer = '';
    try { proc?.kill(); } catch { /* gia' uscito */ }
  }

  async run(encoded) {
    await this.start();
    const id = String(++this.jobId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const job = this.pending.get(id);
        this.pending.delete(id);
        const err = new Error('key server: risposta non arrivata in tempo');
        job?.reject(err);
        this.fail(err); // un job che non risponde = processo bloccato: si riparte
      }, JOB_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(`${id} ${encoded}\n`);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  stop() {
    const proc = this.proc;
    this.proc = null;
    this.ready = null;
    for (const job of this.pending.values()) { clearTimeout(job.timer); }
    this.pending.clear();
    try { proc?.stdin?.end(); } catch { /* */ }
    try { proc?.kill(); } catch { /* */ }
  }
}

let server = null;

/** Vero se il key server e' utilizzabile (Windows e non disattivato). */
export function keyServerEnabled() {
  return isWindows() && process.env.WDECK_KEYSERVER !== '0';
}

/**
 * Esegue una sequenza di operazioni gia' codificata sul processo persistente.
 * Lancia se non disponibile o in caso di errore: chi chiama ripiega sul metodo
 * a colpo singolo.
 * @param {string} encoded
 */
export async function sendKeyOps(encoded) {
  if (!keyServerEnabled()) throw new Error('key server non disponibile');
  if (!server) server = new KeyServer();
  return server.run(encoded);
}

/** Ferma il processo persistente (da chiamare alla chiusura dell'host). */
export function stopKeyServer() {
  if (server) { server.stop(); server = null; }
}
