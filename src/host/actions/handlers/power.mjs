/**
 * Azioni di alimentazione e sessione: blocca, sospendi, spegni, riavvia,
 * spegni lo schermo.
 *
 * Sono le azioni piu' distruttive del deck: per questo i comandi irreversibili
 * accettano un ritardo (`delaySeconds`) e nel client conviene marcare il
 * bottone con `"confirm": true`, che impone una conferma prima dell'invio.
 */

import { runPowerShell } from '../../platform/windows.mjs';

/**
 * Comandi supportati. `script` e' PowerShell puro: nessuno di questi comandi
 * richiede privilegi di amministratore per l'utente interattivo.
 */
const POWER_COMMANDS = {
  lock: {
    label: 'blocca la sessione',
    destructive: false,
    script: 'rundll32.exe user32.dll,LockWorkStation'
  },
  sleep: {
    label: 'sospendi il PC',
    destructive: true,
    script: 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState("Suspend", $false, $false)'
  },
  hibernate: {
    label: 'iberna il PC',
    destructive: true,
    script: 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState("Hibernate", $false, $false)'
  },
  shutdown: {
    label: 'spegni il PC',
    destructive: true,
    script: (delay) => `shutdown.exe /s /t ${delay}`
  },
  restart: {
    label: 'riavvia il PC',
    destructive: true,
    script: (delay) => `shutdown.exe /r /t ${delay}`
  },
  signout: {
    label: 'disconnetti l\'utente',
    destructive: true,
    script: 'shutdown.exe /l'
  },
  abort: {
    label: 'annulla spegnimento programmato',
    destructive: false,
    script: 'shutdown.exe /a'
  },
  'monitor-off': {
    label: 'spegni lo schermo',
    destructive: false,
    // WM_SYSCOMMAND / SC_MONITORPOWER: lo schermo si riaccende al primo
    // movimento del mouse, quindi non e' un'operazione bloccante.
    script: [
      '$sig = @\'',
      '[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);',
      '\'@',
      "$m = Add-Type -MemberDefinition $sig -Name 'WdeckPower' -Namespace 'Wdeck' -PassThru",
      '[void]$m::SendMessage([IntPtr]0xFFFF, 0x0112, [IntPtr]0xF170, [IntPtr]2)'
    ].join('\n')
  }
};

export const powerAction = {
  type: 'power',
  title: 'Alimentazione e sessione',
  description: 'Blocca, sospendi, iberna, spegni, riavvia o disconnetti. Comprende anche lo spegnimento '
    + 'del solo schermo e l\'annullamento di uno spegnimento programmato.',
  platforms: ['win32'],
  category: 'system',
  paramsHelp: {
    command: Object.keys(POWER_COMMANDS).join(' | '),
    delaySeconds: 'ritardo prima di spegnimento/riavvio, 0..600 (default 0)'
  },
  validate(params) {
    if (!POWER_COMMANDS[params?.command]) {
      throw new Error(`parametro "command" non valido: atteso uno fra ${Object.keys(POWER_COMMANDS).join(', ')}`);
    }
    if (params?.delaySeconds !== undefined) {
      const d = Number(params.delaySeconds);
      if (!Number.isInteger(d) || d < 0 || d > 600) {
        throw new Error('parametro "delaySeconds" non valido: atteso intero fra 0 e 600');
      }
    }
  },
  describe(params) {
    const spec = POWER_COMMANDS[params?.command];
    const delay = Number(params?.delaySeconds) || 0;
    return `${spec?.label ?? params?.command}${delay ? ` fra ${delay} secondi` : ''}`;
  },
  async run(params, ctx) {
    const spec = POWER_COMMANDS[params.command];
    const delay = Number(params.delaySeconds) || 0;
    const script = typeof spec.script === 'function' ? spec.script(delay) : spec.script;

    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `eseguirebbe: ${spec.label}`, script };
    }
    const res = await runPowerShell(script, { timeoutMs: 15000 });
    if (res.code !== 0) {
      throw new Error(`comando "${params.command}" fallito: ${res.stderr.slice(0, 200) || `exit ${res.code}`}`);
    }
    return { ok: true, detail: spec.label };
  }
};

export default [powerAction];
