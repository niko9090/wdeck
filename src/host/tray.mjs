/**
 * Icona di Wdeck nell'area di notifica di Windows.
 *
 * L'host e' un processo Node senza finestre: senza questa icona l'unico segno
 * che sta girando e' la finestra del terminale. La barra delle applicazioni si
 * raggiunge con NotifyIcon di WinForms, pilotato da uno script PowerShell
 * separato - nessuna dipendenza npm, nessun modulo nativo da compilare.
 *
 * Il processo della tray e' un figlio staccato che parla con l'host solo via
 * HTTP, come qualunque altro client: se muore, l'host continua a funzionare.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { powershellPath, isWindows } from './platform/windows.mjs';

/**
 * Genera lo script PowerShell della tray.
 *
 * @param {{url: string, urls: string[], token: string, pid: number, version: string, deckName: string, scriptsDir?: string}} spec
 * @returns {string}
 */
export function buildTrayScript({ url, urls = [], token, pid, version, deckName, scriptsDir = '' }) {
  const b64 = (value) => Buffer.from(String(value), 'utf8').toString('base64');
  const decode = (name, value) => `$${name} = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(value)}'))`;

  return `
# Un errore qui non ha nessuno che lo veda: il processo gira nascosto e senza
# console. Il log rende diagnosticabile una tray che non compare.
$ErrorActionPreference = 'Stop'
$logFile = Join-Path $env:TEMP 'wdeck-tray.log'
function Write-TrayLog([string]$text) {
  try { Add-Content -Path $logFile -Value "$(Get-Date -Format 'HH:mm:ss') $text" } catch { }
}
trap {
  Write-TrayLog "ERRORE: $_"
  Write-TrayLog $_.ScriptStackTrace
  exit 1
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
${decode('url', url)}
${decode('token', token)}
${decode('deckName', deckName)}
${decode('urlList', urls.join("\n"))}
${decode('scriptsDir', scriptsDir)}
$hostPid = ${Number(pid)}
$version = '${String(version).replace(/'/g, "''")}'

# $url arriva con lo slash finale ("http://127.0.0.1:8899/"): concatenare
# "/api/..." darebbe "//api/...", che il server NON riconosce (pagina HTML per i
# GET, 404 per i POST). $base e' la stessa base senza slash finale, da usare per
# TUTTE le chiamate all'API. $deckUrl apre il deck gia' autenticato col token.
$base = $url.TrimEnd('/')
$deckUrl = "$base/?token=$token"

# L'icona viene disegnata a runtime: nessun file .ico da distribuire e da
# tenere allineato, e resta nitida a qualunque scala del desktop.
$bmp = New-Object System.Drawing.Bitmap 32, 32
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
$bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 76, 141, 255))
$g.FillRectangle($bg, 2, 2, 28, 28)
$fg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
foreach ($cell in @(@(6,6), @(13,6), @(20,6), @(6,13), @(13,13), @(20,13), @(6,20), @(13,20), @(20,20))) {
  $g.FillRectangle($fg, $cell[0], $cell[1], 5, 5)
}
$g.Dispose()

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$icon.Text = "Wdeck $version - $deckName"
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

function Add-Item([string]$text, [scriptblock]$action) {
  $item = $menu.Items.Add($text)
  $item.add_Click($action)
  return $item
}

$titolo = $menu.Items.Add("Wdeck $version")
$titolo.Enabled = $false
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

Add-Item 'Apri il deck nel browser' { Start-Process "$deckUrl" } | Out-Null
Add-Item 'Apri le impostazioni' { Start-Process "$deckUrl#settings" } | Out-Null
Add-Item 'Copia indirizzo per il telefono' {
  Set-Clipboard -Value $urlList
  $icon.BalloonTipTitle = 'Indirizzi copiati'
  $icon.BalloonTipText = $urlList
  $icon.ShowBalloonTip(4000)
} | Out-Null

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

Add-Item 'Ricarica deck.json' {
  try {
    Invoke-RestMethod -Uri "$base/api/reload" -Method POST -Headers @{ 'x-wdeck-token' = $token } | Out-Null
    $icon.BalloonTipTitle = 'Wdeck'
    $icon.BalloonTipText = 'Configurazione ricaricata'
  } catch {
    $icon.BalloonTipTitle = 'Ricarica non riuscita'
    $icon.BalloonTipText = $_.Exception.Message
  }
  $icon.ShowBalloonTip(4000)
} | Out-Null

# Aggiunge uno script alla cartella "scripts" di Wdeck: da li' l'host lo propone
# come suggerimento nell'editor, per un pulsante o uno slider.
Add-Item 'Aggiungi uno script...' {
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title = 'Scegli uno script o programma da aggiungere a Wdeck'
  $dlg.Filter = 'Script e programmi (*.ps1;*.bat;*.cmd;*.exe;*.lnk;*.vbs;*.py)|*.ps1;*.bat;*.cmd;*.exe;*.lnk;*.vbs;*.py|Tutti i file (*.*)|*.*'
  if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    try {
      if (-not (Test-Path $scriptsDir)) { New-Item -ItemType Directory -Path $scriptsDir -Force | Out-Null }
      $nome = [System.IO.Path]::GetFileName($dlg.FileName)
      Copy-Item -LiteralPath $dlg.FileName -Destination (Join-Path $scriptsDir $nome) -Force
      $icon.BalloonTipTitle = 'Script aggiunto'
      $icon.BalloonTipText = "Ora ""$nome"" e' tra i suggerimenti nell'editor (azione Avvia/Script)."
    } catch {
      $icon.BalloonTipTitle = 'Aggiunta non riuscita'
      $icon.BalloonTipText = $_.Exception.Message
    }
    $icon.ShowBalloonTip(4000)
  }
} | Out-Null

Add-Item 'Apri la cartella degli script' {
  try {
    if (-not (Test-Path $scriptsDir)) { New-Item -ItemType Directory -Path $scriptsDir -Force | Out-Null }
    Start-Process explorer.exe $scriptsDir
  } catch {
    $icon.BalloonTipTitle = 'Apertura non riuscita'
    $icon.BalloonTipText = $_.Exception.Message
    $icon.ShowBalloonTip(4000)
  }
} | Out-Null

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

Add-Item 'Controlla aggiornamenti' {
  # Esito mostrato con una finestra (MessageBox) e non con un fumetto: i fumetti
  # non compaiono se le notifiche di Windows o l'Assistente notifiche sono spenti,
  # e sembrerebbe che "non funzioni nulla". Qui l'utente ha chiesto una risposta:
  # la deve vedere sempre.
  try {
    $res = Invoke-RestMethod -Uri "$base/api/update?check=1" -Headers @{ 'x-wdeck-token' = $token }
    if ($res.update.available) {
      if ($res.selfUpdate.supported) {
        $msg = "Disponibile la versione $($res.update.latest.version) (in uso la $($res.update.current)).\`n\`nVuoi scaricarla e installarla adesso? Si aprira' il deck con la barra di avanzamento."
        $scelta = [System.Windows.Forms.MessageBox]::Show($msg, 'Aggiornamento disponibile', 'YesNo', 'Question')
        # L'aggiornamento avviene nel browser, dove c'e' la barra che mostra
        # download/verifica/installazione: cosi' si vede che sta procedendo e non
        # e' bloccato, invece di un'attesa muta dalla tray.
        if ($scelta -eq 'Yes') { Start-Process "$deckUrl#update" }
      } else {
        [System.Windows.Forms.MessageBox]::Show("Disponibile la versione $($res.update.latest.version). Apri il deck nel browser per aggiornare.", 'Aggiornamento disponibile', 'OK', 'Information') | Out-Null
      }
    } else {
      [System.Windows.Forms.MessageBox]::Show("Sei gia' alla versione piu' recente ($($res.update.current)).", 'Nessun aggiornamento', 'OK', 'Information') | Out-Null
    }
  } catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Controllo non riuscito', 'OK', 'Error') | Out-Null
  }
} | Out-Null

Add-Item 'Scarica e installa aggiornamento' {
  # Apre il deck nel browser sull'aggiornamento: li' c'e' la finestra con la
  # barra di avanzamento (download, verifica, installazione, riavvio), cosi' si
  # vede cosa sta succedendo invece di un'attesa muta.
  Start-Process "$deckUrl#update"
} | Out-Null

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

Add-Item 'Esci da Wdeck' {
  $icon.Visible = $false
  # Chiusura ordinata: l'host intercetta il segnale e chiude i client collegati.
  try { Stop-Process -Id $hostPid -ErrorAction Stop } catch { }
  [System.Windows.Forms.Application]::Exit()
} | Out-Null

$icon.ContextMenuStrip = $menu
$icon.add_MouseDoubleClick({ Start-Process "$deckUrl" })

$icon.BalloonTipTitle = "Wdeck $version in esecuzione"
$icon.BalloonTipText = "Deck ""$deckName"" raggiungibile su $url"
$icon.ShowBalloonTip(4000)

# Se l'host termina (chiusura del terminale, arresto del PC) l'icona deve
# sparire da sola, altrimenti resta un fantasma cliccabile nella barra.
$watch = New-Object System.Windows.Forms.Timer
$watch.Interval = 500
$watch.add_Tick({
  # L'host e' morto, oppure ha tolto questo script (e' il suo modo di dire
  # "chiudi", vedi stop() in tray.mjs): l'icona si toglie da sola PRIMA di
  # uscire. Uccisa da fuori, lascerebbe un'icona fantasma nella barra accanto
  # a quella nuova: "piu' Wdeck aperti" dopo ogni aggiornamento.
  if (-not (Get-Process -Id $hostPid -ErrorAction SilentlyContinue) -or -not (Test-Path -LiteralPath $PSCommandPath)) {
    $icon.Visible = $false
    $icon.Dispose()
    [System.Windows.Forms.Application]::Exit()
  }
})
$watch.Start()

Write-TrayLog "tray avviata (host pid $hostPid, url $url)"
# Application.Run senza argomenti richiede un ApplicationContext esplicito:
# senza, il ciclo dei messaggi termina subito e l'icona sparisce all'istante.
$ctx = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($ctx)
Write-TrayLog 'tray terminata'
$icon.Dispose()
`.trim();
}

/**
 * Avvia l'icona nell'area di notifica.
 *
 * @param {{url: string, urls?: string[], token: string, version: string, deckName: string, scriptsDir?: string, logger?: object}} spec
 * @returns {{stop: () => Promise<void>, pid: number|null, scriptFile: string|null}}
 */
export function startTray({ url, urls = [], token, version, deckName, scriptsDir = '', logger = console }) {
  const inactive = { async stop() {}, pid: null, scriptFile: null };
  if (!isWindows()) {
    logger.debug?.('[wdeck] icona nella barra disponibile solo su Windows');
    return inactive;
  }

  const scriptFile = path.join(os.tmpdir(), `wdeck-tray-${process.pid}.ps1`);
  try {
    fs.writeFileSync(
      scriptFile,
      buildTrayScript({ url, urls, token, pid: process.pid, version, deckName, scriptsDir }),
      'utf8'
    );
  } catch (err) {
    logger.warn?.(`[wdeck] icona nella barra non avviata: ${err.message}`);
    return inactive;
  }

  let child;
  try {
    child = spawn(
      powershellPath(),
      // Niente -NonInteractive: WinForms ha bisogno della stazione finestre
      // interattiva, e con quel flag il ciclo dei messaggi non parte.
      ['-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptFile],
      // Niente detached: su Windows quel flag toglie la console al figlio e
      // PowerShell esce immediatamente con codice 0 senza eseguire lo script.
      // Restare agganciati e' anche piu' corretto, perche' l'icona deve vivere
      // esattamente quanto l'host; unref() evita che tenga in piedi Node.
      { stdio: 'ignore', windowsHide: true }
    );
    child.unref();
  } catch (err) {
    logger.warn?.(`[wdeck] icona nella barra non avviata: ${err.message}`);
    return inactive;
  }

  const cleanup = () => {
    try {
      fs.unlinkSync(scriptFile);
    } catch {
      // il file temporaneo resta: non e' un errore che valga un messaggio
    }
  };

  return {
    pid: child.pid ?? null,
    scriptFile,
    stop() {
      // Prima si toglie lo script: la tray lo controlla ogni mezzo secondo e,
      // non trovandolo piu', nasconde l'icona ed esce da sola. Ucciderla
      // subito lascerebbe l'icona fantasma. Se non esce entro un secondo e
      // mezzo, allora si uccide.
      cleanup();
      return new Promise((resolve) => {
        let done = false;
        let timer = null;
        const fine = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        };
        if (child.exitCode !== null || child.signalCode !== null) { fine(); return; }
        timer = setTimeout(() => {
          try { child.kill(); } catch { /* gia' uscito */ }
          fine();
        }, 1500);
        child.once('exit', fine);
      });
    }
  };
}
