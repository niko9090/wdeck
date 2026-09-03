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

import { PowerShellWorker } from './psworker.mjs';
import { isWindows } from './windows.mjs';

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
  if (!server) server = new PowerShellWorker({ name: 'key server', bootstrap: BOOTSTRAP });
  await server.run(encoded);
}

/** Ferma il processo persistente (da chiamare alla chiusura dell'host). */
export function stopKeyServer() {
  if (server) { server.stop(); server = null; }
}
