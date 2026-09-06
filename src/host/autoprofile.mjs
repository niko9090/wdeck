/**
 * Profili per applicazione: il deck cambia profilo da solo quando in primo
 * piano c'e' un programma "collegato" a quel profilo (`profile.apps`, elenco
 * di nomi di processo o pezzi di titolo di finestra).
 *
 * Il processo in primo piano si legge con un worker PowerShell persistente
 * (`psworker.mjs`): compilare il P/Invoke una volta e poi chiedere ogni
 * secondo e mezzo costa pochi millisecondi, mentre un PowerShell nuovo a
 * ogni giro costerebbe piu' del giro stesso.
 *
 * Si agisce SOLO al cambio di finestra in primo piano: se l'utente sceglie a
 * mano un altro profilo mentre il programma resta davanti, nessuno lo
 * riporta indietro finche' non cambia finestra. Altrimenti sarebbe un
 * braccio di ferro fra il deck e chi lo usa.
 */

import { PowerShellWorker, workerLoop } from './platform/psworker.mjs';
import { isWindows } from './platform/windows.mjs';

const BOOTSTRAP = [
  '$sig = @\'',
  '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);',
  '\'@',
  "$fgw = Add-Type -MemberDefinition $sig -Name 'WdeckFg' -Namespace 'Wdeck' -PassThru",
  workerLoop([
    '    $h = $fgw::GetForegroundWindow()',
    '    [uint32]$fpid = 0',
    '    [void]$fgw::GetWindowThreadProcessId($h, [ref]$fpid)',
    '    $sb = New-Object System.Text.StringBuilder 512',
    '    [void]$fgw::GetWindowText($h, $sb, 512)',
    '    $name = ""',
    '    try { $name = (Get-Process -Id $fpid -ErrorAction Stop).ProcessName } catch { }',
    '    $r = "$fpid|$name|" + $sb.ToString().Replace("`n", " ").Replace("`r", " ")'
  ].join('\n'))
].join('\n');

/** Legge "pid|processo|titolo" cosi' come lo scrive il worker. */
export function parseForeground(text) {
  const [pid, proc, ...rest] = String(text ?? '').split('|');
  return { pid: Number(pid) || 0, process: (proc ?? '').trim(), title: rest.join('|').trim() };
}

/**
 * Il primo profilo che "collega" il programma in primo piano.
 * Un nome collegato combacia se e' uguale al nome del processo (senza .exe,
 * maiuscole ignorate) oppure se compare nel titolo della finestra.
 * @param {Array<{id: string, apps?: string[]}>} profiles
 * @param {{process?: string, title?: string}} fg
 */
export function matchProfile(profiles, fg) {
  const proc = String(fg?.process ?? '').toLowerCase().replace(/\.exe$/, '').trim();
  const title = String(fg?.title ?? '').toLowerCase();
  for (const profile of profiles ?? []) {
    for (const app of profile.apps ?? []) {
      const voce = String(app ?? '').toLowerCase().trim().replace(/\.exe$/, '');
      if (!voce) continue;
      if (proc === voce || (title && title.includes(voce))) return profile;
    }
  }
  return null;
}

/**
 * @param {{state: object, getDeck: () => object, logger?: object, intervalMs?: number, readForeground?: () => Promise<string>}} spec
 */
export function createAutoProfile({ state, getDeck, logger = console, intervalMs = 1500, readForeground = null }) {
  let worker = null;
  let timer = null;
  let ultimo = null;
  let busy = false;

  const leggi = readForeground ?? (() => worker.run('FG'));

  /** Un giro: legge il primo piano e, se e' cambiato, cambia profilo se serve. */
  async function tick() {
    if (busy) return null;
    const deck = getDeck();
    if (deck?.settings?.ui?.autoProfile === false) return null;
    if (!deck?.profiles?.some((p) => p.apps?.length)) return null;
    busy = true;
    try {
      const fg = parseForeground(await leggi());
      const chiave = `${fg.pid}|${fg.process}`;
      if (chiave === ultimo) return null;
      ultimo = chiave;
      const profile = matchProfile(deck.profiles, fg);
      if (!profile || profile.id === state.activeProfileId) return null;
      state.navigate(profile.id, profile.defaultPage ?? null);
      logger.info?.(`[wdeck] profilo "${profile.id}" per ${fg.process || 'finestra'} in primo piano`);
      return profile.id;
    } catch (err) {
      logger.debug?.(`[wdeck] primo piano non letto: ${err.message}`);
      return null;
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      if (timer) return;
      if (!readForeground) {
        if (!isWindows()) return;
        worker = new PowerShellWorker({ name: 'primo piano', bootstrap: BOOTSTRAP, readyMs: 20000, jobMs: 4000 });
      }
      timer = setInterval(() => { tick(); }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      worker?.stop();
      worker = null;
    },
    tick
  };
}
