/**
 * Azioni di produttivita': appunti, cartelle, schermate, notifiche, timer.
 *
 * Sono le azioni che fanno risparmiare i gesti ripetuti della giornata:
 * incollare una firma, aprire la cartella del progetto, far comparire un
 * promemoria sul PC mentre si e' dall'altra parte della stanza.
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildKeyScript, runPowerShell } from '../../platform/windows.mjs';
import { parseHotkey } from '../../platform/keys.mjs';

/** Codifica una stringa per inserirla in uno script senza problemi di quoting. */
function b64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function decodeLine(varName, value) {
  return `$${varName} = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(value)}'))`;
}

export const clipboardAction = {
  type: 'clipboard',
  title: 'Appunti',
  description: 'Copia un testo negli appunti, lo incolla nella finestra attiva oppure svuota gli appunti. '
    + 'Con "paste" il testo viene copiato e subito incollato: e\' il modo piu\' affidabile di inserire '
    + 'testi lunghi, molto piu\' veloce della digitazione tasto per tasto.',
  platforms: ['win32'],
  category: 'productivity',
  paramsHelp: {
    mode: 'copy | paste | clear (default copy)',
    text: 'testo da mettere negli appunti (max 20000 caratteri)'
  },
  validate(params) {
    const mode = params?.mode ?? 'copy';
    if (!['copy', 'paste', 'clear'].includes(mode)) {
      throw new Error('parametro "mode" non valido: atteso copy, paste o clear');
    }
    if (mode !== 'clear') {
      if (typeof params?.text !== 'string' || params.text.length === 0) {
        throw new Error(`con mode "${mode}" serve il parametro "text"`);
      }
      if (params.text.length > 20000) throw new Error('parametro "text" troppo lungo (max 20000 caratteri)');
    }
  },
  describe(params) {
    const mode = params?.mode ?? 'copy';
    if (mode === 'clear') return 'svuota gli appunti';
    const preview = String(params?.text ?? '').slice(0, 40).replace(/\s+/g, ' ');
    return `${mode === 'paste' ? 'incolla' : 'copia'} "${preview}${String(params?.text ?? '').length > 40 ? '...' : ''}"`;
  },
  async run(params, ctx) {
    const mode = params?.mode ?? 'copy';
    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: this.describe(params) };
    }

    if (mode === 'clear') {
      const res = await runPowerShell('Set-Clipboard -Value ""', { timeoutMs: 8000 });
      if (res.code !== 0) throw new Error(`svuotamento appunti fallito: ${res.stderr.slice(0, 200)}`);
      return { ok: true, detail: 'appunti svuotati' };
    }

    const copy = await runPowerShell([decodeLine('t', params.text), 'Set-Clipboard -Value $t'].join('\n'), { timeoutMs: 8000 });
    if (copy.code !== 0) throw new Error(`copia negli appunti fallita: ${copy.stderr.slice(0, 200)}`);
    if (mode === 'copy') return { ok: true, detail: `copiati ${params.text.length} caratteri` };

    const hotkey = parseHotkey('ctrl+v');
    const paste = await runPowerShell(buildKeyScript(hotkey.modifierCodes, hotkey.keyCode), { timeoutMs: 8000 });
    if (paste.code !== 0) throw new Error(`incolla fallito: ${paste.stderr.slice(0, 200)}`);
    return { ok: true, detail: `incollati ${params.text.length} caratteri` };
  }
};

export const folderAction = {
  type: 'folder',
  title: 'Apri cartella',
  description: 'Apre una cartella in Esplora file e ne porta la finestra in primo piano. Accetta anche '
    + 'le cartelle speciali di Windows come "shell:Downloads".',
  platforms: ['win32'],
  category: 'productivity',
  paramsHelp: { path: 'percorso della cartella, oppure una shell: location', select: 'percorso di un file da selezionare' },
  validate(params) {
    if (typeof params?.path !== 'string' || params.path.trim() === '') throw new Error('parametro "path" mancante');
  },
  describe: (params) => `apre la cartella ${params?.path}`,
  async run(params, ctx) {
    const target = params.path;
    const isShell = target.toLowerCase().startsWith('shell:');
    if (!isShell && !fs.existsSync(target) && !ctx.dryRun) {
      throw new Error(`cartella non trovata: ${target}`);
    }
    if (ctx.dryRun) return { ok: true, simulated: true, detail: `aprirebbe ${target}` };

    const script = params.select
      ? [decodeLine('s', params.select), 'Start-Process explorer.exe -ArgumentList "/select,`"$s`""'].join('\n')
      : [decodeLine('p', target), 'Start-Process explorer.exe -ArgumentList $p'].join('\n');
    const res = await runPowerShell(script, { timeoutMs: 10000 });
    if (res.code !== 0) throw new Error(`apertura cartella fallita: ${res.stderr.slice(0, 200)}`);
    return { ok: true, detail: `aperta ${params.select ?? target}` };
  }
};

export const screenshotAction = {
  type: 'screenshot',
  title: 'Schermata',
  description: 'Cattura lo schermo intero e salva un PNG, oppure apre lo strumento di cattura di Windows '
    + 'per selezionare un\'area. Il file viene salvato nella cartella indicata (default: Immagini).',
  platforms: ['win32'],
  category: 'productivity',
  paramsHelp: {
    mode: 'screen | area (default screen)',
    directory: 'cartella di destinazione (default: %USERPROFILE%\\Pictures\\Wdeck)',
    clipboard: 'true per copiare la schermata anche negli appunti'
  },
  validate(params) {
    const mode = params?.mode ?? 'screen';
    if (!['screen', 'area'].includes(mode)) throw new Error('parametro "mode" non valido: atteso screen o area');
  },
  describe: (params) => ((params?.mode ?? 'screen') === 'area' ? 'cattura un\'area dello schermo' : 'cattura lo schermo intero'),
  async run(params, ctx) {
    const mode = params?.mode ?? 'screen';
    if (ctx.dryRun) return { ok: true, simulated: true, detail: this.describe(params) };

    // La cattura d'area e' interattiva: si delega allo strumento di sistema,
    // che gestisce gia' selezione, annullamento e copia negli appunti.
    if (mode === 'area') {
      const hotkey = parseHotkey('win+shift+s');
      const res = await runPowerShell(buildKeyScript(hotkey.modifierCodes, hotkey.keyCode), { timeoutMs: 8000 });
      if (res.code !== 0) throw new Error(`apertura cattura area fallita: ${res.stderr.slice(0, 200)}`);
      return { ok: true, detail: 'strumento di cattura aperto: seleziona l\'area sul PC' };
    }

    const dir = params.directory ?? path.join(process.env.USERPROFILE ?? '.', 'Pictures', 'Wdeck');
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
      decodeLine('dir', dir),
      'if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }',
      '$b = [System.Windows.Forms.SystemInformation]::VirtualScreen',
      '$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
      '$g = [System.Drawing.Graphics]::FromImage($bmp)',
      '$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)',
      '$name = "wdeck-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".png"',
      '$full = Join-Path $dir $name',
      '$bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)',
      ...(params.clipboard ? ['[System.Windows.Forms.Clipboard]::SetImage($bmp)'] : []),
      '$g.Dispose(); $bmp.Dispose()',
      'Write-Output $full'
    ].join('\n');

    const res = await runPowerShell(script, { timeoutMs: 20000 });
    if (res.code !== 0) throw new Error(`cattura schermo fallita: ${res.stderr.slice(0, 200)}`);
    return { ok: true, detail: `salvata in ${res.stdout}`, file: res.stdout };
  }
};

export const notifyAction = {
  type: 'notify',
  title: 'Notifica sul PC',
  description: 'Mostra una notifica di Windows sul computer host. Utile per mandarsi un promemoria dal '
    + 'telefono o per segnalare la fine di un\'operazione lunga.',
  platforms: ['win32'],
  category: 'productivity',
  paramsHelp: { title: 'titolo della notifica', message: 'testo della notifica', sound: 'true per il suono di sistema' },
  validate(params) {
    if (typeof params?.message !== 'string' || params.message.trim() === '') throw new Error('parametro "message" mancante');
    if (params.message.length > 500) throw new Error('parametro "message" troppo lungo (max 500 caratteri)');
  },
  describe: (params) => `notifica "${String(params?.message ?? '').slice(0, 40)}"`,
  async run(params, ctx) {
    if (ctx.dryRun) return { ok: true, simulated: true, detail: `mostrerebbe la notifica "${params.message}"` };
    const res = await runPowerShell(buildNotifyScript(params), { timeoutMs: 12000 });
    if (res.code !== 0) throw new Error(`notifica fallita: ${res.stderr.slice(0, 200)}`);
    return { ok: true, detail: 'notifica mostrata sul PC' };
  }
};

/**
 * Script della notifica: NotifyIcon di WinForms invece delle API toast di
 * WinRT, che da un processo non impacchettato richiedono un AppUserModelID
 * registrato e fallirebbero in silenzio.
 * @param {{title?: string, message: string, sound?: boolean}} params
 * @returns {string}
 */
export function buildNotifyScript(params) {
  return [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
    decodeLine('title', params.title ?? 'Wdeck'),
    decodeLine('msg', params.message),
    '$icon = New-Object System.Windows.Forms.NotifyIcon',
    '$icon.Icon = [System.Drawing.SystemIcons]::Information',
    '$icon.BalloonTipTitle = $title',
    '$icon.BalloonTipText = $msg',
    '$icon.Visible = $true',
    '$icon.ShowBalloonTip(6000)',
    ...(params.sound ? ['[System.Media.SystemSounds]::Asterisk.Play()'] : []),
    // Senza attesa il processo termina e la notifica sparisce prima di comparire.
    'Start-Sleep -Milliseconds 6500',
    '$icon.Dispose()'
  ].join('\n');
}

export default [clipboardAction, folderAction, screenshotAction, notifyAction];
