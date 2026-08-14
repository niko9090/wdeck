/**
 * Livelli di sistema: volume master, volume microfono, luminosita' schermo.
 *
 * Il volume passa dalle API Core Audio (IAudioEndpointVolume) dichiarate in C#
 * inline: e' l'unico modo per leggere e impostare un valore *assoluto* senza
 * dipendenze native. I tasti media (azione `media`) sanno solo alzare/abbassare
 * a passi fissi, che per uno slider non basta.
 *
 * La luminosita' usa WMI (WmiMonitorBrightnessMethods): funziona sui pannelli
 * integrati dei portatili. I monitor esterni richiedono DDC/CI, che non e'
 * raggiungibile senza librerie native: in quel caso l'errore e' esplicito.
 */

import { runPowerShell, isWindows } from './windows.mjs';

/**
 * Definizione C# delle interfacce COM di Core Audio.
 * Costante e riusata da tutti gli script audio.
 */
const AUDIO_CSHARP = `
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float level, Guid ctx);
  int j();
  int GetMasterVolumeLevelScalar(out float level);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx);
  int GetMute(out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int ctx, IntPtr a, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int f();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class WdeckAudio {
  // dataFlow: 0 = uscita (render), 1 = ingresso (capture)
  static IAudioEndpointVolume Endpoint(int dataFlow) {
    IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(dataFlow, 1, out dev));
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object o;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
    return (IAudioEndpointVolume)o;
  }
  public static float GetVolume(int flow) { float v; Marshal.ThrowExceptionForHR(Endpoint(flow).GetMasterVolumeLevelScalar(out v)); return v; }
  public static void SetVolume(int flow, float v) { Marshal.ThrowExceptionForHR(Endpoint(flow).SetMasterVolumeLevelScalar(v, Guid.Empty)); }
  public static bool GetMute(int flow) { bool m; Marshal.ThrowExceptionForHR(Endpoint(flow).GetMute(out m)); return m; }
  public static void SetMute(int flow, bool m) { Marshal.ThrowExceptionForHR(Endpoint(flow).SetMute(m, Guid.Empty)); }
}
`.trim();

const AUDIO_PREAMBLE = [
  '$src = @\'',
  AUDIO_CSHARP,
  '\'@',
  'Add-Type -TypeDefinition $src -ErrorAction Stop | Out-Null'
].join('\n');

/** Converte il nome del canale nel dataFlow di Core Audio. */
function flowOf(target) {
  return target === 'mic' || target === 'input' ? 1 : 0;
}

/**
 * Script che legge volume (0..100) e stato muto del canale indicato.
 * @param {'speaker'|'mic'} target
 * @returns {string}
 */
export function buildReadVolumeScript(target = 'speaker') {
  return [
    AUDIO_PREAMBLE,
    `$flow = ${flowOf(target)}`,
    '$v = [WdeckAudio]::GetVolume($flow)',
    '$m = [WdeckAudio]::GetMute($flow)',
    '$pct = [Math]::Round($v * 100)',
    'Write-Output "volume=$pct;muted=$($m.ToString().ToLower())"'
  ].join('\n');
}

/**
 * Script che imposta il volume a un valore assoluto in percentuale.
 * @param {'speaker'|'mic'} target
 * @param {number} percent 0..100
 * @returns {string}
 */
export function buildSetVolumeScript(target, percent) {
  const clamped = clampPercent(percent);
  return [
    AUDIO_PREAMBLE,
    `$flow = ${flowOf(target)}`,
    `[WdeckAudio]::SetVolume($flow, ${(clamped / 100).toFixed(4)})`,
    '$v = [WdeckAudio]::GetVolume($flow)',
    '$m = [WdeckAudio]::GetMute($flow)',
    '$pct = [Math]::Round($v * 100)',
    'Write-Output "volume=$pct;muted=$($m.ToString().ToLower())"'
  ].join('\n');
}

/**
 * Script che somma un delta al volume corrente, con clamp a 0..100.
 * @param {'speaker'|'mic'} target
 * @param {number} delta -100..100
 * @returns {string}
 */
export function buildAdjustVolumeScript(target, delta) {
  const d = Math.max(-100, Math.min(100, Number(delta) || 0));
  return [
    AUDIO_PREAMBLE,
    `$flow = ${flowOf(target)}`,
    '$cur = [WdeckAudio]::GetVolume($flow) * 100',
    `$next = [Math]::Max(0, [Math]::Min(100, $cur + (${d})))`,
    '[WdeckAudio]::SetVolume($flow, $next / 100)',
    '$m = [WdeckAudio]::GetMute($flow)',
    '$pct = [Math]::Round($next)',
    'Write-Output "volume=$pct;muted=$($m.ToString().ToLower())"'
  ].join('\n');
}

/**
 * Script che imposta o inverte il muto.
 * @param {'speaker'|'mic'} target
 * @param {boolean|'toggle'} value
 * @returns {string}
 */
export function buildMuteScript(target, value = 'toggle') {
  const lines = [AUDIO_PREAMBLE, `$flow = ${flowOf(target)}`];
  if (value === 'toggle') {
    lines.push('$next = -not [WdeckAudio]::GetMute($flow)');
  } else {
    lines.push(`$next = $${value === true ? 'true' : 'false'}`);
  }
  lines.push(
    '[WdeckAudio]::SetMute($flow, $next)',
    '$pct = [Math]::Round([WdeckAudio]::GetVolume($flow) * 100)',
    'Write-Output "volume=$pct;muted=$($next.ToString().ToLower())"'
  );
  return lines.join('\n');
}

/**
 * Controllo luminosita' dei monitor esterni via DDC/CI (dxva2.dll).
 *
 * WMI (WmiMonitorBrightnessMethods) copre solo i pannelli integrati dei
 * portatili: su un desktop con monitor esterni risponde "Non supportato".
 * DDC/CI parla direttamente col monitor sul canale I2C del cavo ed e'
 * raggiungibile con solo P/Invoke, quindi resta a dipendenze zero.
 * Ogni monitor espone un proprio intervallo min..max: qui viene sempre
 * normalizzato in percentuale 0..100.
 */
const DDC_CSHARP = `
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WdeckMon {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct PHYSICAL_MONITOR { public IntPtr h; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string desc; }
  delegate bool EnumProc(IntPtr hMon, IntPtr hdc, IntPtr rect, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr rect, EnumProc proc, IntPtr data);
  [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMon, out uint count);
  [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMon, uint count, [Out] PHYSICAL_MONITOR[] arr);
  [DllImport("dxva2.dll")] static extern bool GetMonitorBrightness(IntPtr h, out uint min, out uint cur, out uint max);
  [DllImport("dxva2.dll")] static extern bool SetMonitorBrightness(IntPtr h, uint val);
  [DllImport("dxva2.dll")] static extern bool DestroyPhysicalMonitor(IntPtr h);

  static List<PHYSICAL_MONITOR> All() {
    List<PHYSICAL_MONITOR> found = new List<PHYSICAL_MONITOR>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr hMon, IntPtr hdc, IntPtr rect, IntPtr data) {
      uint n;
      if (GetNumberOfPhysicalMonitorsFromHMONITOR(hMon, out n) && n > 0) {
        PHYSICAL_MONITOR[] arr = new PHYSICAL_MONITOR[n];
        if (GetPhysicalMonitorsFromHMONITOR(hMon, n, arr)) found.AddRange(arr);
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  /// Percentuale del primo monitor che risponde a DDC/CI, -1 se nessuno.
  public static int Get() {
    foreach (PHYSICAL_MONITOR m in All()) {
      uint min, cur, max;
      bool ok = GetMonitorBrightness(m.h, out min, out cur, out max);
      DestroyPhysicalMonitor(m.h);
      if (ok && max > min) return (int)Math.Round((cur - min) * 100.0 / (max - min));
    }
    return -1;
  }

  /// Applica la percentuale a tutti i monitor che rispondono. Torna quanti ne ha impostati.
  public static int Set(int percent) {
    int done = 0;
    foreach (PHYSICAL_MONITOR m in All()) {
      uint min, cur, max;
      if (GetMonitorBrightness(m.h, out min, out cur, out max) && max > min) {
        uint target = (uint)Math.Round(min + (max - min) * (percent / 100.0));
        if (SetMonitorBrightness(m.h, target)) done++;
      }
      DestroyPhysicalMonitor(m.h);
    }
    return done;
  }
}
`.trim();

/**
 * Terzo livello di fallback: attenuazione software via gamma ramp.
 *
 * Serve perche' i due metodi hardware coprono meno di quanto sembri: WMI vale
 * solo per i pannelli integrati, e DDC/CI viene rifiutato da parecchie
 * combinazioni GPU/cavo/dock (errore 1168 su GetPhysicalMonitorsFromHMONITOR).
 * La gamma ramp non tocca la retroilluminazione - scurisce l'immagine - ma
 * funziona su qualunque schermo, che e' cio' che serve a uno slider.
 * L'intervallo utile e' compresso in 35..100% per non arrivare mai al nero.
 */
const GAMMA_CSHARP = `
using System;
using System.Runtime.InteropServices;
public class WdeckGamma {
  // GetDC(NULL) non basta: la gamma ramp va applicata su un DC del *device*
  // DISPLAY, altrimenti gdi32 rifiuta la chiamata e torna false.
  [DllImport("gdi32.dll", CharSet = CharSet.Auto)] static extern IntPtr CreateDC(string driver, string device, string output, IntPtr init);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hDC);
  [DllImport("gdi32.dll")] static extern bool SetDeviceGammaRamp(IntPtr hDC, ref RAMP ramp);
  [DllImport("gdi32.dll")] static extern bool GetDeviceGammaRamp(IntPtr hDC, ref RAMP ramp);
  [StructLayout(LayoutKind.Sequential)]
  public struct RAMP { [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256 * 3)] public ushort[] Table; }

  public static bool Set(int percent) {
    double factor = 0.35 + (Math.Max(0, Math.Min(100, percent)) / 100.0) * 0.65;
    RAMP ramp = new RAMP();
    ramp.Table = new ushort[256 * 3];
    for (int i = 0; i < 256; i++) {
      int value = (int)(i * 257 * factor);
      if (value > 65535) value = 65535;
      ramp.Table[i] = ramp.Table[256 + i] = ramp.Table[512 + i] = (ushort)value;
    }
    IntPtr dc = CreateDC("DISPLAY", null, null, IntPtr.Zero);
    if (dc == IntPtr.Zero) return false;
    bool ok = SetDeviceGammaRamp(dc, ref ramp);
    DeleteDC(dc);
    return ok;
  }

  /// Ricava la percentuale dalla rampa attiva invertendo la formula di Set().
  public static int Get() {
    RAMP ramp = new RAMP();
    ramp.Table = new ushort[256 * 3];
    IntPtr dc = CreateDC("DISPLAY", null, null, IntPtr.Zero);
    if (dc == IntPtr.Zero) return -1;
    bool ok = GetDeviceGammaRamp(dc, ref ramp);
    DeleteDC(dc);
    if (!ok) return -1;
    double factor = ramp.Table[255] / (255.0 * 257.0);
    int pct = (int)Math.Round((factor - 0.35) / 0.65 * 100);
    return Math.Max(0, Math.Min(100, pct));
  }
}
`.trim();

const DDC_PREAMBLE = [
  '$ddc = @\'',
  DDC_CSHARP,
  '\'@',
  'Add-Type -TypeDefinition $ddc -ErrorAction Stop | Out-Null',
  '$gam = @\'',
  GAMMA_CSHARP,
  '\'@',
  'Add-Type -TypeDefinition $gam -ErrorAction Stop | Out-Null'
].join('\n');

/**
 * Legge la luminosita' provando prima WMI (portatili) e poi DDC/CI (desktop).
 * @returns {string}
 */
export function buildReadBrightnessScript() {
  return [
    DDC_PREAMBLE,
    '$cur = $null',
    'try {',
    '  $b = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction Stop',
    '  $cur = ($b | Select-Object -First 1).CurrentBrightness',
    '} catch { $cur = $null }',
    'if ($null -eq $cur) { $d = [WdeckMon]::Get(); if ($d -ge 0) { $cur = $d; $mode = "ddc" } }',
    'if ($null -eq $cur) { $g = [WdeckGamma]::Get(); if ($g -ge 0) { $cur = $g; $mode = "gamma" } }',
    'if ($null -eq $cur) { Write-Error "nessun metodo di controllo luminosita\' disponibile"; exit 5 }',
    'if ($null -eq $mode) { $mode = "wmi" }',
    'Write-Output "brightness=$cur;mode=$mode"'
  ].join('\n');
}

/**
 * Imposta la luminosita' a un valore assoluto (0..100), WMI con fallback DDC/CI.
 * @param {number} percent
 * @returns {string}
 */
export function buildSetBrightnessScript(percent) {
  const clamped = clampPercent(percent);
  return [
    DDC_PREAMBLE,
    `$target = ${clamped}`,
    '$done = $false',
    'try {',
    '  $m = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop',
    '  foreach ($mon in $m) { Invoke-CimMethod -InputObject $mon -MethodName WmiSetBrightness -Arguments @{ Brightness = $target; Timeout = 1 } | Out-Null }',
    '  $done = $true',
    '} catch { $done = $false }',
    '$mode = "wmi"',
    'if (-not $done) { if ([WdeckMon]::Set($target) -gt 0) { $done = $true; $mode = "ddc" } }',
    'if (-not $done) { if ([WdeckGamma]::Set($target)) { $done = $true; $mode = "gamma" } }',
    'if (-not $done) { Write-Error "nessun metodo di controllo luminosita\' disponibile"; exit 5 }',
    'Write-Output "brightness=$target;mode=$mode"'
  ].join('\n');
}

/**
 * Somma un delta alla luminosita' corrente, con clamp a 0..100.
 * @param {number} delta
 * @returns {string}
 */
export function buildAdjustBrightnessScript(delta) {
  const d = Math.max(-100, Math.min(100, Number(delta) || 0));
  return [
    DDC_PREAMBLE,
    '$cur = $null',
    'try {',
    '  $b = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction Stop',
    '  $cur = ($b | Select-Object -First 1).CurrentBrightness',
    '} catch { $cur = $null }',
    'if ($null -eq $cur) { $dd = [WdeckMon]::Get(); if ($dd -ge 0) { $cur = $dd } }',
    'if ($null -eq $cur) { $gg = [WdeckGamma]::Get(); if ($gg -ge 0) { $cur = $gg } }',
    'if ($null -eq $cur) { Write-Error "nessun metodo di controllo luminosita\' disponibile"; exit 5 }',
    `$target = [int][Math]::Max(0, [Math]::Min(100, $cur + (${d})))`,
    '$done = $false',
    '$mode = "wmi"',
    'try {',
    '  $m = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop',
    '  foreach ($mon in $m) { Invoke-CimMethod -InputObject $mon -MethodName WmiSetBrightness -Arguments @{ Brightness = $target; Timeout = 1 } | Out-Null }',
    '  $done = $true',
    '} catch { $done = $false }',
    'if (-not $done) { if ([WdeckMon]::Set($target) -gt 0) { $done = $true; $mode = "ddc" } }',
    'if (-not $done) { if ([WdeckGamma]::Set($target)) { $done = $true; $mode = "gamma" } }',
    'if (-not $done) { Write-Error "impostazione luminosita\' non riuscita"; exit 5 }',
    'Write-Output "brightness=$target;mode=$mode"'
  ].join('\n');
}

/**
 * Normalizza una percentuale in intero 0..100.
 * @param {number} value
 * @returns {number}
 */
export function clampPercent(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/**
 * Estrae le coppie chiave=valore emesse dagli script sopra.
 * @param {string} stdout es. "volume=42;muted=false" o "brightness=60;mode=gamma"
 * @returns {{volume?: number, muted?: boolean, brightness?: number, mode?: string}}
 */
export function parseLevelOutput(stdout) {
  const out = {};
  for (const chunk of String(stdout).trim().split(/[;\s]+/)) {
    const [key, raw] = chunk.split('=');
    if (raw === undefined) continue;
    if (key === 'muted') out.muted = raw === 'true';
    else if (key === 'mode') out.mode = raw;
    else if (key === 'volume' || key === 'brightness') {
      const n = Number(raw);
      if (Number.isFinite(n)) out[key] = n;
    }
  }
  return out;
}

/**
 * Legge volume e stato del muto di un canale.
 * @param {'speaker'|'mic'} [target]
 * @returns {Promise<{volume?: number, muted?: boolean}>}
 */
export function readVolume(target = 'speaker') {
  return runLevelScript(buildReadVolumeScript(target), { what: `volume ${target}` });
}

/**
 * Legge la luminosita' corrente dello schermo.
 * @returns {Promise<{brightness?: number, mode?: string}>}
 */
export function readBrightness() {
  // La compilazione C# del primo giro e' lenta quanto quella della scrittura.
  return runLevelScript(buildReadBrightnessScript(), { what: 'luminosita\'', timeoutMs: 30000 });
}

/**
 * Esegue uno degli script sopra e ne interpreta l'output.
 * @param {string} script
 * @param {{timeoutMs?: number, what?: string}} [options]
 * @returns {Promise<{volume?: number, muted?: boolean, brightness?: number}>}
 */
export async function runLevelScript(script, { timeoutMs = 12000, what = 'livello' } = {}) {
  if (!isWindows()) throw new Error(`${what}: operazione disponibile solo su Windows`);
  const res = await runPowerShell(script, { timeoutMs });
  if (res.code !== 0) {
    // Lo stderr di PowerShell arriva serializzato in CLIXML quando il processo
    // non e' interattivo: qui interessa solo il messaggio, non l'XML attorno.
    const clean = String(res.stderr).replace(/<[^>]+>/g, ' ').replace(/_x000D_|_x000A_/g, '').replace(/\s+/g, ' ').trim();
    throw new Error(`${what} non riuscito: ${clean.slice(0, 300) || `exit ${res.code}`}`);
  }
  return parseLevelOutput(res.stdout);
}
