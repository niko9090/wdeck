<#
.SYNOPSIS
    Installa Wdeck su questo PC.

.DESCRIPTION
    Copia i file in %LOCALAPPDATA%\Wdeck, crea i collegamenti nel menu Start e
    sul desktop e, se richiesto, registra l'avvio automatico con Windows.

    Non richiede privilegi di amministratore: tutto resta nel profilo utente.
    Non scarica nulla: usa i file gia' presenti accanto a questo script.

.PARAMETER Autostart
    Registra Wdeck fra i programmi che partono al login.

.PARAMETER NoShortcut
    Non creare il collegamento sul desktop.

.PARAMETER Uninstall
    Rimuove installazione, collegamenti e avvio automatico.

.EXAMPLE
    .\install.ps1 -Autostart
#>

[CmdletBinding()]
param(
    [switch]$Autostart,
    [switch]$NoShortcut,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$AppName    = 'Wdeck'
$InstallDir = Join-Path $env:LOCALAPPDATA $AppName
$StartMenu  = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$RunKey     = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$SourceDir  = Split-Path -Parent $PSScriptRoot

function Write-Step([string]$text) { Write-Host "  $text" -ForegroundColor Cyan }
function Write-Ok([string]$text)   { Write-Host "  $text" -ForegroundColor Green }
function Write-Warn([string]$text) { Write-Host "  $text" -ForegroundColor Yellow }

function New-Shortcut([string]$path, [string]$target, [string]$arguments, [string]$workingDir, [string]$description) {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $target
    $link.Arguments = $arguments
    $link.WorkingDirectory = $workingDir
    $link.Description = $description
    $link.IconLocation = "$target,0"
    $link.Save()
}

# ----------------------------------------------------------- disinstallazione

if ($Uninstall) {
    Write-Host ''
    Write-Host "Disinstallazione di $AppName" -ForegroundColor White

    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*wdeck*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Step 'processi in esecuzione terminati'

    Remove-ItemProperty -Path $RunKey -Name $AppName -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $StartMenu "$AppName.lnk") -ErrorAction SilentlyContinue
    Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk") -ErrorAction SilentlyContinue
    Write-Step 'collegamenti e avvio automatico rimossi'

    if (Test-Path $InstallDir) {
        # La configurazione dell'utente non viene buttata via insieme al programma.
        $keep = Join-Path $env:LOCALAPPDATA "$AppName-deck-backup.json"
        if (Test-Path (Join-Path $InstallDir 'deck.json')) {
            Copy-Item (Join-Path $InstallDir 'deck.json') $keep -Force
            Write-Warn "deck.json conservato in $keep"
        }
        Remove-Item $InstallDir -Recurse -Force
    }
    Write-Ok "$AppName rimosso."
    return
}

# ----------------------------------------------------------- prerequisiti

Write-Host ''
Write-Host "Installazione di $AppName" -ForegroundColor White
Write-Host ''

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host '  Node.js non e'' installato.' -ForegroundColor Red
    Write-Host '  Wdeck richiede Node.js 20.10 o superiore: https://nodejs.org/it/download'
    Write-Host '  Installalo e rilancia questo script.'
    exit 1
}

$version = (& node --version).TrimStart('v')
$major = [int]($version.Split('.')[0])
$minor = [int]($version.Split('.')[1])
if ($major -lt 20 -or ($major -eq 20 -and $minor -lt 10)) {
    Write-Host "  Node.js $version e' troppo vecchio: serve la 20.10 o superiore." -ForegroundColor Red
    exit 1
}
Write-Step "Node.js $version trovato"

if (-not (Test-Path (Join-Path $SourceDir 'package.json'))) {
    Write-Host "  File di origine non trovati in $SourceDir" -ForegroundColor Red
    Write-Host '  Estrai l''archivio completo prima di lanciare l''installazione.'
    exit 1
}

# ----------------------------------------------------------- copia dei file

$deckEsistente = $null
if (Test-Path (Join-Path $InstallDir 'deck.json')) {
    # Un aggiornamento non deve sovrascrivere i bottoni configurati dall'utente.
    $deckEsistente = Get-Content (Join-Path $InstallDir 'deck.json') -Raw
    Write-Step 'configurazione esistente rilevata: verra'' conservata'
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
foreach ($item in @('bin', 'src', 'shared', 'web', 'dist', 'schema', 'scripts', 'tools', 'installer', 'package.json', 'README.md', 'LICENSE', 'CHANGELOG.md')) {
    $source = Join-Path $SourceDir $item
    if (Test-Path $source) {
        Copy-Item $source -Destination $InstallDir -Recurse -Force
    }
}

if ($deckEsistente) {
    Set-Content -Path (Join-Path $InstallDir 'deck.json') -Value $deckEsistente -Encoding utf8
} elseif (-not (Test-Path (Join-Path $InstallDir 'deck.json'))) {
    Copy-Item (Join-Path $SourceDir 'deck.json') (Join-Path $InstallDir 'deck.json') -Force
}
Write-Step "file copiati in $InstallDir"

# Il client web va compilato una volta, altrimenti l'host serve i sorgenti.
if (-not (Test-Path (Join-Path $InstallDir 'dist\web\index.html'))) {
    Push-Location $InstallDir
    try {
        & node scripts/build-web.mjs | Out-Null
        Write-Step 'client web compilato'
    } catch {
        Write-Warn 'compilazione del client non riuscita: l''host servira'' i sorgenti'
    } finally {
        Pop-Location
    }
}

# ----------------------------------------------------------- token e PIN

# Le credenziali di esempio non devono sopravvivere all'installazione: qui
# vengono sostituite con valori casuali, diversi su ogni PC.
$deckPath = Join-Path $InstallDir 'deck.json'
$deck = Get-Content $deckPath -Raw | ConvertFrom-Json
if ($deck.settings.security.token -like 'CHANGE-ME*' -or [string]::IsNullOrWhiteSpace($deck.settings.security.token)) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $deck.settings.security.token = [Convert]::ToBase64String($bytes).Replace('+', '').Replace('/', '').Replace('=', '')
    $deck.settings.security.pin = -join (1..6 | ForEach-Object { Get-Random -Minimum 0 -Maximum 10 })
    $deck | ConvertTo-Json -Depth 12 | Set-Content -Path $deckPath -Encoding utf8
    Write-Step "token e PIN generati per questo PC (PIN: $($deck.settings.security.pin))"
}

# ----------------------------------------------------------- collegamenti

$launcher = Join-Path $InstallDir 'Wdeck.cmd'
@"
@echo off
cd /d "%~dp0"
start "" /min node bin\wdeck.mjs %*
"@ | Set-Content -Path $launcher -Encoding ascii

New-Shortcut -path (Join-Path $StartMenu "$AppName.lnk") -target $launcher -arguments '' -workingDir $InstallDir -description 'Wdeck - Stream Deck software'
Write-Step 'collegamento aggiunto al menu Start'

if (-not $NoShortcut) {
    New-Shortcut -path (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk") -target $launcher -arguments '' -workingDir $InstallDir -description 'Wdeck - Stream Deck software'
    Write-Step 'collegamento aggiunto al desktop'
}

if ($Autostart) {
    Set-ItemProperty -Path $RunKey -Name $AppName -Value "`"$launcher`""
    Write-Step 'avvio automatico con Windows attivato'
}

# ----------------------------------------------------------- fine

$pin = (Get-Content $deckPath -Raw | ConvertFrom-Json).settings.security.pin
Write-Host ''
Write-Ok "$AppName installato."
Write-Host ''
Write-Host '  Avvialo dal menu Start o dal collegamento sul desktop.'
Write-Host '  Poi apri http://<indirizzo-del-PC>:8899 dal telefono e inserisci il PIN.'
Write-Host ''
Write-Host "  PIN di questo PC : $pin" -ForegroundColor White
Write-Host "  Cartella         : $InstallDir"
Write-Host ''
Write-Host '  Per disinstallare:  .\install.ps1 -Uninstall'
Write-Host ''
