; Installer di Wdeck per Windows.
;
; Produce WdeckSetup.exe: procedura guidata, icone nel menu Start e sul
; desktop, avvio automatico facoltativo e disinstallazione registrata in
; "App e funzionalita'". Non serve essere amministratore: si installa nella
; cartella dell'utente, che e' anche il motivo per cui non chiede l'UAC.
;
; Si costruisce con:  npm run installer
; (che compila prima l'eseguibile e genera l'icona)

#define Nome "Wdeck"
#define Editore "niko9090"
#define Sito "https://github.com/niko9090/wdeck"
#ifndef Versione
  #define Versione "0.0.0"
#endif

[Setup]
AppId={{9C7F1B2E-4A55-4C1D-9E3B-7D6A2F0B5E41}
AppName={#Nome}
AppVersion={#Versione}
AppVerName={#Nome} {#Versione}
AppPublisher={#Editore}
AppPublisherURL={#Sito}
AppSupportURL={#Sito}/issues
AppUpdatesURL={#Sito}/releases

; Per utente: niente UAC, niente "vuoi consentire a questa app di apportare
; modifiche". Un deck non ha motivo di chiedere i diritti di amministratore.
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#Nome}
DefaultGroupName={#Nome}
DisableProgramGroupPage=yes
DisableDirPage=no
AllowNoIcons=yes

OutputDir=..\release
OutputBaseFilename=WdeckSetup-{#Versione}
SetupIconFile=wdeck.ico
UninstallDisplayIcon={app}\wdeck.exe
UninstallDisplayName={#Nome} {#Versione}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "italiano"; MessagesFile: "compiler:Languages\Italian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "avvioautomatico"; Description: "Avvia Wdeck all'accesso a Windows"; GroupDescription: "Avvio:"

[Files]
Source: "..\release\wdeck.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "wdeck.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\CHANGELOG.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#Nome}"; Filename: "{app}\wdeck.exe"; IconFilename: "{app}\wdeck.ico"
Name: "{group}\Cartella di Wdeck"; Filename: "{localappdata}\Wdeck"
Name: "{group}\{cm:UninstallProgram,{#Nome}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#Nome}"; Filename: "{app}\wdeck.exe"; IconFilename: "{app}\wdeck.ico"; Tasks: desktopicon
Name: "{userstartup}\{#Nome}"; Filename: "{app}\wdeck.exe"; IconFilename: "{app}\wdeck.ico"; Tasks: avvioautomatico

[Run]
Filename: "{app}\wdeck.exe"; Description: "Avvia Wdeck adesso"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; I file estratti dall'eseguibile sono usa e getta e vanno via col programma.
; La configurazione dell'utente resta: deck.json e le icone caricate a mano
; sono lavoro suo, non nostro.
Type: filesandordirs; Name: "{localappdata}\Wdeck\runtime"
Type: files; Name: "{localappdata}\Wdeck\wdeck.log"
Type: files; Name: "{localappdata}\Wdeck\wdeck.log.1"

[Code]
// Wdeck gira in sottofondo con l'icona vicino all'orologio: se e' acceso, il
// file e' in uso e non si puo' sostituire. Meglio chiuderlo noi che mostrare
// un errore di file bloccato a meta' installazione.
function ChiudiWdeck(): Boolean;
var
  Esito: Integer;
begin
  Exec('taskkill.exe', '/IM wdeck.exe /F', '', SW_HIDE, ewWaitUntilTerminated, Esito);
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  ChiudiWdeck();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  ChiudiWdeck();
  Result := True;
end;
