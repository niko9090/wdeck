/**
 * Desktop virtuali di Windows.
 *
 * Windows non espone un'API pubblica per saltare a un desktop preciso:
 * l'unica interfaccia COM che lo farebbe (IVirtualDesktopManagerInternal) non
 * e' documentata e cambia GUID a ogni build, quindi qui non viene usata.
 *
 * L'approccio adottato e' in due tempi e regge agli aggiornamenti:
 *  1. il registro dice quanti desktop esistono, quale e' attivo e come si
 *     chiamano (Explorer li salva sotto VirtualDesktops);
 *  2. lo spostamento avviene con le scorciatoie ufficiali Win+Ctrl+Freccia,
 *     ripetute esattamente quante volte serve per coprire la distanza.
 */

import { runPowerShell, isWindows, VK_WIN_CTRL_ARROW_SCRIPT } from './windows.mjs';

const VD_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VirtualDesktops';

/**
 * Script che riporta numero di desktop, indice attivo (0-based) e nomi.
 * I nomi vuoti nel registro sono quelli mai rinominati dall'utente.
 * @returns {string}
 */
export function buildDesktopInfoScript() {
  return [
    `$k = '${VD_KEY}'`,
    '$p = Get-ItemProperty -Path $k -ErrorAction Stop',
    '$ids = $p.VirtualDesktopIDs',
    '$cur = $p.CurrentVirtualDesktop',
    'if ($null -eq $ids) { Write-Error "nessun desktop virtuale nel registro"; exit 6 }',
    '$count = [int]($ids.Length / 16)',
    '$index = -1',
    '$names = @()',
    'for ($i = 0; $i -lt $count; $i++) {',
    '  $slice = New-Object byte[] 16',
    '  [Array]::Copy($ids, $i * 16, $slice, 0, 16)',
    '  $guid = [Guid]::new($slice)',
    '  if ($null -ne $cur) {',
    '    $same = $true',
    '    for ($j = 0; $j -lt 16; $j++) { if ($slice[$j] -ne $cur[$j]) { $same = $false; break } }',
    '    if ($same) { $index = $i }',
    '  }',
    '  $n = $null',
    '  try { $n = (Get-ItemProperty -Path "$k\\Desktops\\{$guid}" -ErrorAction Stop).Name } catch { $n = $null }',
    '  if ([string]::IsNullOrWhiteSpace($n)) { $n = "Desktop " + ($i + 1) }',
    '  $names += $n',
    '}',
    '$json = ConvertTo-Json -InputObject $names -Compress',
    '$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))',
    'Write-Output "count=$count;index=$index;names=$b64"'
  ].join('\n');
}

/**
 * Script che si sposta di N desktop a destra (delta > 0) o a sinistra.
 * @param {number} delta numero di desktop da attraversare
 * @returns {string}
 */
export function buildDesktopSwitchScript(delta) {
  const steps = Math.min(32, Math.abs(Math.round(Number(delta) || 0)));
  const arrow = delta > 0 ? 'right' : 'left';
  return [
    VK_WIN_CTRL_ARROW_SCRIPT,
    `for ($i = 0; $i -lt ${steps}; $i++) {`,
    `  Wdeck-DesktopStep '${arrow}'`,
    // L'animazione di Windows richiede un attimo: senza pausa le pressioni
    // successive vengono ignorate e si finisce sul desktop sbagliato.
    '  Start-Sleep -Milliseconds 120',
    '}'
  ].join('\n');
}

/**
 * Interpreta l'output di buildDesktopInfoScript.
 * @param {string} stdout
 * @returns {{count: number, index: number, names: string[]}}
 */
export function parseDesktopInfo(stdout) {
  const out = { count: 0, index: -1, names: [] };
  for (const chunk of String(stdout).trim().split(';')) {
    const [key, raw] = chunk.split('=');
    if (raw === undefined) continue;
    if (key === 'count' || key === 'index') out[key] = Number(raw);
    else if (key === 'names') {
      try {
        const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
        out.names = Array.isArray(decoded) ? decoded : [decoded];
      } catch {
        out.names = [];
      }
    }
  }
  return out;
}

/**
 * Legge lo stato corrente dei desktop virtuali.
 * @returns {Promise<{count: number, index: number, names: string[]}>}
 */
export async function readDesktops() {
  if (!isWindows()) throw new Error('desktop virtuali: disponibili solo su Windows');
  const res = await runPowerShell(buildDesktopInfoScript(), { timeoutMs: 10000 });
  if (res.code !== 0) throw new Error(`lettura desktop virtuali fallita: ${res.stderr.slice(0, 200) || `exit ${res.code}`}`);
  return parseDesktopInfo(res.stdout);
}

/**
 * Risolve un riferimento a desktop (indice 1-based o nome) in indice 0-based.
 * @param {{index?: number, name?: string}} target
 * @param {{count: number, names: string[]}} info
 * @returns {number}
 */
export function resolveDesktopTarget(target, info) {
  if (target?.name) {
    const wanted = String(target.name).trim().toLowerCase();
    const found = info.names.findIndex((n) => String(n).trim().toLowerCase() === wanted);
    if (found === -1) {
      throw new Error(`desktop "${target.name}" non trovato (disponibili: ${info.names.join(', ')})`);
    }
    return found;
  }
  const n = Number(target?.index);
  if (!Number.isInteger(n) || n < 1) throw new Error('parametro "index" non valido: atteso intero >= 1');
  if (n > info.count) throw new Error(`desktop ${n} inesistente: ne risultano ${info.count}`);
  return n - 1;
}
