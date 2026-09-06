/**
 * Azioni di produttivita': appunti, cartelle, schermate, notifiche, timer.
 *
 * Sono le azioni che fanno risparmiare i gesti ripetuti della giornata:
 * incollare una firma, aprire la cartella del progetto, far comparire un
 * promemoria sul PC mentre si e' dall'altra parte della stanza.
 */

import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_EXTENSIONS, buildKeyScript, buildPlaySoundScript, playSound, runPowerShell, startPowerShellDetached } from '../../platform/windows.mjs';
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
  fields: [
    {
      key: 'mode',
      label: 'Modalita\'',
      type: 'select',
      default: 'copy',
      options: [
        { value: 'copy', label: 'Copia' },
        { value: 'paste', label: 'Copia e incolla' },
        { value: 'clear', label: 'Svuota appunti' }
      ]
    },
    {
      key: 'text',
      label: 'Testo',
      type: 'textarea',
      help: 'testo da mettere negli appunti (max 20000 caratteri)',
      required: true
    }
  ],
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

/**
 * shell: location note e sicure che il bottone puo' aprire. Tutto il resto
 * (in particolare le forme "shell:::{CLSID}", che possono puntare a oggetti di
 * sistema arbitrari) viene rifiutato: una cartella "vera" resta comunque
 * apribile passando il suo percorso.
 */
const ALLOWED_SHELL_LOCATIONS = new Set([
  'downloads', 'desktop', 'desktopdirectory', 'personal', 'documentslibrary', 'mydocuments',
  'mypictures', 'pictures', 'mymusic', 'music', 'myvideo', 'videos',
  'profile', 'recent', 'sendto', 'startup', 'favorites', 'recyclebinfolder', 'usersfilesfolder'
]);

export const folderAction = {
  type: 'folder',
  title: 'Apri cartella',
  description: 'Apre una cartella in Esplora file e ne porta la finestra in primo piano. Accetta anche '
    + 'le cartelle speciali di Windows come "shell:Downloads".',
  platforms: ['win32'],
  category: 'productivity',
  paramsHelp: { path: 'percorso della cartella, oppure una shell: location', select: 'percorso di un file da selezionare' },
  fields: [
    {
      key: 'path',
      label: 'Cartella',
      type: 'text',
      help: 'percorso della cartella, oppure una shell: location',
      placeholder: 'C:\\Progetti oppure shell:Downloads',
      required: true
    },
    {
      key: 'select',
      label: 'File da selezionare',
      type: 'text',
      help: 'percorso di un file da selezionare'
    }
  ],
  validate(params) {
    if (typeof params?.path !== 'string' || params.path.trim() === '') throw new Error('parametro "path" mancante');
    const target = params.path.trim();
    if (/^shell:/i.test(target)) {
      const loc = target.slice(target.indexOf(':') + 1).trim().toLowerCase();
      if (!ALLOWED_SHELL_LOCATIONS.has(loc)) {
        throw new Error(`shell: location non consentita: "${target}" (ammesse: ${[...ALLOWED_SHELL_LOCATIONS].join(', ')})`);
      }
    }
  },
  describe: (params) => `apre la cartella ${params?.path}`,
  async run(params, ctx) {
    const target = params.path;
    const isShell = /^shell:/i.test(target);
    if (!isShell && !ctx.dryRun) {
      // Deve essere una cartella reale ed esistente: non un file, non un percorso inventato.
      let stat = null;
      try { stat = fs.statSync(target); } catch { stat = null; }
      if (!stat) throw new Error(`cartella non trovata: ${target}`);
      if (!stat.isDirectory()) throw new Error(`il percorso non e' una cartella: ${target}`);
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
  fields: [
    {
      key: 'mode',
      label: 'Modalita\'',
      type: 'select',
      default: 'screen',
      options: [
        { value: 'screen', label: 'Schermo intero' },
        { value: 'area', label: 'Area a scelta' }
      ]
    },
    {
      key: 'directory',
      label: 'Cartella di destinazione',
      type: 'text',
      help: 'default: %USERPROFILE%\\Pictures\\Wdeck'
    },
    {
      key: 'clipboard',
      label: 'Copia anche negli appunti',
      type: 'toggle',
      help: 'copia la schermata anche negli appunti'
    }
  ],
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
  fields: [
    {
      key: 'title',
      label: 'Titolo',
      type: 'text',
      help: 'titolo della notifica',
      placeholder: 'Wdeck'
    },
    {
      key: 'message',
      label: 'Messaggio',
      type: 'text',
      help: 'testo della notifica (max 500 caratteri)',
      required: true
    },
    {
      key: 'sound',
      label: 'Suono di sistema',
      type: 'toggle',
      help: 'riproduce il suono di sistema'
    }
  ],
  validate(params) {
    if (typeof params?.message !== 'string' || params.message.trim() === '') throw new Error('parametro "message" mancante');
    if (params.message.length > 500) throw new Error('parametro "message" troppo lungo (max 500 caratteri)');
  },
  describe: (params) => `notifica "${String(params?.message ?? '').slice(0, 40)}"`,
  async run(params, ctx) {
    if (ctx.dryRun) return { ok: true, simulated: true, detail: `mostrerebbe la notifica "${params.message}"` };
    // Il fumetto resta a schermo 6 secondi e il processo che lo mostra deve
    // vivere quanto lui: il TASTO no. Prima si aspettava la fine (8-10 secondi
    // a pressione, dal registro); ora il processo e' staccato e il tasto torna
    // libero appena la notifica e' partita.
    await startPowerShellDetached(buildNotifyScript(params));
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
    decodeLine('title', params.title ?? 'Wdeck'),
    decodeLine('msg', params.message),
    // Notifica VERA di Windows 10/11 (centro notifiche, resta nell'elenco),
    // via WinRT. L'AppId e' quello di PowerShell, gia' registrato con Windows:
    // senza un AppId registrato la notifica non compare affatto.
    'try {',
    '  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    "  $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
    '  $t = [System.Security.SecurityElement]::Escape($title)',
    '  $m = [System.Security.SecurityElement]::Escape($msg)',
    `  $audio = '${params.sound ? '' : '<audio silent="true"/>'}'`,
    '  $xml = "<toast><visual><binding template=\'ToastGeneric\'><text>$t</text><text>$m</text></binding></visual>$audio</toast>"',
    '  $doc = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '  $doc.LoadXml($xml)',
    '  $toast = New-Object Windows.UI.Notifications.ToastNotification $doc',
    '  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)',
    '} catch {',
    // Ripiego: il vecchio fumetto della barra (Windows senza WinRT, o notifiche
    // bloccate per PowerShell). Serve tenere vivo il processo finche' sparisce.
    '  Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
    '  $icon = New-Object System.Windows.Forms.NotifyIcon',
    '  $icon.Icon = [System.Drawing.SystemIcons]::Information',
    '  $icon.BalloonTipTitle = $title',
    '  $icon.BalloonTipText = $msg',
    '  $icon.Visible = $true',
    '  $icon.ShowBalloonTip(6000)',
    ...(params.sound ? ['  [System.Media.SystemSounds]::Asterisk.Play()'] : []),
    '  Start-Sleep -Milliseconds 6500',
    '  $icon.Dispose()',
    '}'
  ].join('\n');
}

export const soundAction = {
  type: 'sound',
  title: 'Riproduci suono',
  description: 'Riproduce un file audio (soundboard): wav, mp3, m4a, ogg, flac. Il suono parte e il '
    + 'pulsante resta subito libero, cosi\' piu\' suoni possono sovrapporsi. Per ora solo Windows.',
  platforms: ['win32'],
  category: 'media',
  paramsHelp: {
    path: 'percorso del file audio (wav, mp3, m4a, aac, ogg, flac, wma)',
    volume: 'volume 0..100 (default 100)'
  },
  fields: [
    { key: 'path', label: 'File audio', type: 'text', required: true, help: 'percorso del file (wav, mp3, m4a, ogg, flac)', placeholder: 'C:\\Suoni\\applausi.mp3' },
    { key: 'volume', label: 'Volume', type: 'number', help: '0..100', min: 0, max: 100, step: 1, default: 100 }
  ],
  validate(params) {
    if (typeof params?.path !== 'string' || params.path.trim() === '') {
      throw new Error('parametro "path" mancante');
    }
    const ext = path.extname(params.path).toLowerCase();
    if (!AUDIO_EXTENSIONS.includes(ext)) {
      throw new Error(`formato audio non supportato: "${ext || '(nessuno)'}" (ammessi: ${AUDIO_EXTENSIONS.join(', ')})`);
    }
    if (params.volume !== undefined) {
      const v = Number(params.volume);
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error('parametro "volume" non valido: atteso 0..100');
    }
  },
  describe: (params) => `riproduce "${path.basename(params?.path ?? '')}"`,
  async run(params, ctx) {
    if (ctx.dryRun) {
      return { ok: true, simulated: true, detail: `riprodurrebbe ${params.path}`, script: buildPlaySoundScript(params.path, params.volume ?? 100) };
    }
    if (!fs.existsSync(params.path)) throw new Error(`file audio non trovato: ${params.path}`);
    await playSound({ path: params.path, volume: params.volume ?? 100 });
    return { ok: true, detail: `riproduce "${path.basename(params.path)}"` };
  }
};

export default [clipboardAction, folderAction, screenshotAction, notifyAction, soundAction];
