# Changelog

Formato ispirato a [Keep a Changelog](https://keepachangelog.com/it/1.1.0/).
Il progetto segue il [versionamento semantico](https://semver.org/lang/it/).

## [0.2.1] - 2026-08-13

### Aggiunto

- **Integrazione continua** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):
  `npm run verify` a ogni push e pull request, su Linux, Windows e macOS con
  Node 20.10 e 22. Prima i comandi andavano ricordati ed eseguiti a mano.
- `npm run check:deps`: guardia automatica del vincolo di zero dipendenze.
  Fallisce se `package.json` acquista dipendenze o se un sorgente importa un
  pacchetto che non sia un modulo built-in di Node.
- `test/project.test.mjs`: sei verifiche sull'impianto del progetto (assenza di
  dipendenze, presenza e trigger del workflow, completezza di `verify`).

### Note

`npm run check:deps` fa ora parte di `npm run verify`, quindi la violazione del
vincolo di zero dipendenze interrompe la catena di verifica come qualunque test
fallito. Il resto dei limiti noti e' in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## [0.2.0] - 2026-08-13

Prima versione installabile, con l'editor visuale e 17 azioni in piu'.

### Aggiunto

#### Client

- **Cursori** per volume, microfono e luminosita': si trascinano come uno slider
  e mostrano il valore reale letto dal PC. Gli invii sono limitati a uno ogni
  120 ms piu' uno garantito al rilascio, per non lanciare decine di script.
- **Scorrimento orizzontale** per cambiare pagina, con animazione direzionale e
  un rimbalzo quando non c'e' altra pagina. Funzionano anche le frecce.
- **Editor visuale**: la matita in alto attiva la modifica; si tocca un
  controllo per cambiarlo o una cella vuota per aggiungerne uno, scegliendo
  l'azione da un menu diviso per categorie con la descrizione dei parametri.
  Il salvataggio passa dalla validazione dell'host e crea un backup.
- **Piu' computer nella stessa app**: schede in alto per passare da un PC
  all'altro, ognuno con il proprio token. Gestione da Impostazioni.
- **Impostazioni** nel client: PIN modificabile, elenco dei computer,
  controllo aggiornamenti.
- **Conferma** prima delle azioni marcate `"confirm": true`.
- L'esito delle azioni senza effetti visibili (script, notifiche, comandi
  remoti) compare come messaggio: prima non si vedeva nulla.

#### Host

- **Icona nell'area di notifica** con menu: apri il deck, copia gli indirizzi,
  ricarica la configurazione, controlla aggiornamenti, esci. Realizzata con
  NotifyIcon di WinForms, senza dipendenze.
- **Controllo aggiornamenti** sulle release di GitHub, con notifica nel client.
  L'host non scarica e non installa nulla da solo.
- **Salvataggio della configurazione** (`POST /api/deck/save`) con validazione,
  scrittura atomica e backup ruotati in `.wdeck-backup/`.
- **Impostazioni a caldo** (`GET`/`POST /api/settings`): PIN, tema, aggiornamenti.
- 17 nuove azioni: `volume`, `mic`, `brightness`, `focus`, `desktop`, `window`,
  `power`, `browser`, `game`, `rdp`, `clipboard`, `folder`, `screenshot`,
  `notify`, `obs`, `homeassistant`, `hue`.
- Le azioni dichiarano una **categoria** e un tipo di controllo, usati
  dall'editor per raggrupparle.
- **Installer** (`installer/install.ps1`): installazione nel profilo utente,
  collegamenti, avvio automatico opzionale, generazione di token e PIN casuali,
  disinstallazione che conserva `deck.json`.
- `npm run package` prepara l'archivio da allegare a una release.

### Corretto

- **I programmi avviati restavano dietro alla finestra del browser.** `launch`
  ora chiede esplicitamente il primo piano: Windows rifiuta
  `SetForegroundWindow` a un processo che non ha il focus, quindi si aggancia
  temporaneamente il thread di input della finestra attiva. Se il programma
  delega la finestra a un'altra istanza (il Blocco note di Windows 11, i
  launcher dei giochi) c'e' un secondo tentativo per nome di processo.
- **L'interfaccia andava a scatti.** Tre cause distinte: mancava
  `touch-action`, quindi il browser aspettava 300 ms per escludere un doppio
  tap; l'azione partiva solo al rilascio, dopo un timer di 650 ms; e la griglia
  veniva ricostruita a ogni messaggio di stato. Ora il tocco parte subito, il
  timer serve solo ai bottoni con `holdAction`, e la griglia si ridisegna solo
  quando cambia davvero.
- **Un `deck.json` non valido faceva terminare l'host** durante la ricarica a
  caldo, invece di lasciare attiva la configurazione precedente come
  documentato: l'evento `error` del config store non aveva ascoltatori, e in
  Node questo si traduce in un'eccezione non gestita. Coperto da un test.

## [0.1.0] - 2026-08-12

Prima consegna: lavoro semi-finito, funzionante e valutabile.
Stato dettagliato di ogni componente in [docs/ROADMAP.md](docs/ROADMAP.md).

### Aggiunto

#### Host (Node.js 22, zero dipendenze runtime)

- Server HTTP + WebSocket su un'unica porta, costruito solo su moduli built-in.
- Implementazione propria del framing WebSocket RFC 6455 (`src/host/ws/`):
  parser incrementale, frammentazione, masking, ping/pong, close handshake,
  piu' un client usato dai test.
- API REST: `/api/health`, `/api/pair`, `/api/deck`, `/api/state`,
  `/api/actions`, `/api/press`, `/api/reload`.
- Canale WebSocket `/ws` con autenticazione, broadcast dello stato,
  `ack` correlati da `requestId` e heartbeat.
- Configurazione dichiarativa `deck.json` con validatore proprio (tipi +
  controlli semantici) e ricarica a caldo che preserva la versione valida
  in caso di errore.
- Registro azioni estensibile a plugin e dispatcher con dry-run.
- CLI `bin/wdeck.mjs` e override tramite variabili `WDECK_*`.

#### Azioni

- `media`, `hotkey`, `text` - input sintetico su Windows via PowerShell
  (`keybd_event` in P/Invoke e `SendKeys`), script passati con `-EncodedCommand`.
- `launch`, `script`, `url` - esecuzione locale filtrata dalla whitelist.
- `http` - richieste verso webhook e API.
- `sequence`, `delay`, `navigate`, `noop`, `stub`.

#### Sicurezza

- Token obbligatorio (querystring, header `x-wdeck-token`, `Authorization: Bearer`)
  con confronto a tempo costante e generazione automatica.
- Pairing tramite PIN.
- Whitelist `allowExec` con glob, whitelist di estensioni, whitelist degli
  schemi URL, protezione dal path traversal.
- Dry-run globale non disattivabile dai client.
- Layout servito ai client ripulito da token, PIN e whitelist.

#### Client web PWA

- Griglia responsive, profili e pagine sincronizzati, 22 icone vettoriali.
- Feedback live (stato connessione, badge dry-run, ultima azione, lampeggio
  per bottone, toast, vibrazione), pressione prolungata per `holdAction`,
  riconnessione con backoff.
- Pairing con PIN dall'interfaccia, token da URL o inserito a mano.
- Service worker con app shell in cache (`/api` e `/ws` sempre in rete),
  manifest, icone PNG generate da `scripts/gen-icons.mjs`.
- Build statica `npm run build` -> `dist/web/` con id di build, minificazione
  del CSS, `asset-manifest.json` e verifica dei file prodotti.

#### Protocollo lite ed ESP32

- Dialetto compatto (chiavi JSON di un carattere) con REST e `/ws/lite`,
  documentato in `docs/PROTOCOL.md`.
- Firmware di esempio PlatformIO (TFT_eSPI + ArduinoJson + WebSockets) con tre
  ambienti di scheda, ripiego REST e riconnessione Wi-Fi.
- `firmware/esp32/include/wdeck_protocol.h` come gemello C di
  `shared/protocol.mjs`, con test che ne impedisce la divergenza.

#### Test e strumenti

- `npm test` - 150 verifiche su schema, registro, dispatcher, autenticazione,
  whitelist, tasti, framing WebSocket, protocollo, configurazione, stato, API.
- `npm run smoke` - 36 verifiche end-to-end su un host reale.
- `npm run test:esp32` - 109 verifiche di conformita' del firmware.
- `npm run check:docs` - coerenza fra documentazione, codice e protocollo.
- `npm run verify` - tutti i controlli in sequenza.

#### Documentazione

- `README.md` con quickstart Windows, comandi, configurazione, sicurezza e
  architettura.
- `docs/PROTOCOL.md`, `docs/ROADMAP.md`, `docs/ADDING-ACTIONS.md`,
  `firmware/esp32/README.md`.

### Note

- Su macOS e Linux l'host parte e serve la PWA, ma `media`, `hotkey`, `text` e
  `url` rispondono `501`: sono implementate solo per Windows.
- Il firmware ESP32 non e' ancora stato provato su hardware reale.
- Nessun HTTPS, un solo token condiviso, nessun rate limiting.
