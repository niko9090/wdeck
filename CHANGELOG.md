# Changelog

Formato ispirato a [Keep a Changelog](https://keepachangelog.com/it/1.1.0/).
Il progetto segue il [versionamento semantico](https://semver.org/lang/it/).

## [0.2.7] - 2026-08-13

### Sicurezza

- **Registro di audit persistente.** Wdeck esegue programmi sul PC su richiesta
  della rete locale: se qualcosa va storto, i log della console non aiutano
  perche' spariscono alla chiusura. Ora ogni azione lascia una riga accanto a
  `deck.json` con chi l'ha chiesta, da dove, con quale esito e in quanto tempo.
- Registrati anche gli eventi di sicurezza: `pair`, `pair-failed`,
  `device-created`, `device-revoked`, `token-rotated`, `rate-limited`.
- Formato JSONL, una riga per evento: si legge con `tail`, si filtra con `grep`,
  e un file troncato da un arresto improvviso costa una riga, non il registro.
  Rotazione a 1 MB con tre copie conservate.
- **Token, PIN e password non ci finiscono mai**: i campi con quei nomi sono
  sostituiti da `[omesso]` prima della scrittura, anche dentro i parametri
  liberi di un'azione, dove un header di autorizzazione puo' capitare.
- `GET /api/audit` (con `limit` ed `event`) e `settings.security.audit`.

### Corretto

- **Anche `npm run test:esp32` girava sulla `deck.json` dell'utente.** Come lo
  smoke test, ora usa una copia temporanea: da questa versione l'host scrive
  accanto alla configurazione, e una verifica non deve lasciarci nulla.
- Due difetti trovati dai test appena scritti: una riga rimasta a meta' per un
  arresto improvviso si portava via anche la riga successiva (che le veniva
  appesa di seguito), e subito dopo una rotazione la scrittura falliva perche'
  cercava di leggere la fine di un file appena spostato.

### Note

Ai client il registro non arriva: l'evento WebSocket `press` continua a portare
la forma ridotta di sempre. L'identificativo del dispositivo di un altro non
riguarda chi sta guardando il deck.

## [0.2.6] - 2026-08-13

### Sicurezza

- **Un token per dispositivo, revocabile da solo.** Il pairing con PIN non
  consegna piu' il token principale: crea una credenziale dedicata a quel
  telefono. Prima bastava un telefono perso per dover cambiare il token a
  tutti.
- **Scadenza facoltativa**: `days` alla creazione, oppure
  `settings.security.deviceTokenDays` come predefinito. `--prune-devices` toglie
  i scaduti.
- In `deck.json` resta la sola **impronta SHA-256**: chi legge il file non puo'
  ricavare le credenziali dei dispositivi. Il token si vede una volta sola, in
  risposta a chi lo ha chiesto.
- **La revoca scollega subito** i client che stavano usando quella credenziale.
  Lasciarli collegati fino alla disconnessione avrebbe significato non revocare
  niente per tutta la durata della sessione.
- **Rotazione del token principale** finalmente esposta: `POST /api/token/rotate`,
  il bottone in *Impostazioni* del client, e da riga di comando **senza avviare
  l'host** - che e' proprio il caso in cui serve, se il token e' andato perduto.
- Nuovi comandi CLI: `--rotate-token` (con `--revoke-devices`), `--list-devices`,
  `--add-device <nome>` (con `--days`), `--revoke-device <id>`, `--prune-devices`.
  `--add-device` serve all'ESP32, che il PIN non sa digitarlo.
- Nuovi endpoint `GET`/`POST`/`DELETE /api/devices`.
- Una revoca **scritta a mano** in `deck.json` vale alla ricarica a caldo: prima
  un token tolto dal file continuava a funzionare fino al riavvio.

### Corretto

- **Lo smoke test scriveva nel `deck.json` dell'utente.** Da quando il pairing
  crea un dispositivo, la verifica lasciava una voce nella configurazione di chi
  la lanciava. Ora gira su una copia temporanea: prova la configurazione vera,
  che e' il senso di uno smoke test, senza toccarla.

### Note

Ruotare il token principale **non** revoca i dispositivi accoppiati, a meno di
chiederlo con `revokeDevices`: cambiare la chiave di casa non deve buttare fuori
chi ha gia' la sua.

Il token principale finisce in `deck.json` solo quando viene davvero ruotato:
accoppiare un telefono non deve scrivere nel file una credenziale che l'utente
non ci aveva messo.

## [0.2.5] - 2026-08-13

### Sicurezza

- **Limiti di frequenza**, con il codice `rate_limited` che il protocollo
  definiva da sempre senza che nulla lo usasse. Due limiti indipendenti a
  finestra scorrevole: 60 comandi ogni 10 secondi e 10 tentativi di accesso
  ogni 5 minuti. Oltre il tetto la risposta e' `429` con `Retry-After`, e sul
  WebSocket un messaggio `error` con lo stesso codice.
- Un PIN di quattro cifre sono diecimila combinazioni: senza limite si provano
  in pochi secondi, ed era il punto piu' debole del pairing.
- **Anche i token rifiutati contano come tentativi di accesso**: tenere due
  contatori separati avrebbe lasciato aperta la via di provare direttamente i
  token invece del PIN.
- Un accesso riuscito azzera i tentativi di quell'indirizzo: chi conosce il PIN
  non deve pagare per i tentativi di chi non lo conosce.
- La tabella dei contatori ha un tetto di chiavi: senza, sarebbe stata a sua
  volta una via per esaurire la memoria dell'host.
- Taratura da `settings.security.rateLimit` (`enabled`, `press`, `auth`).

### Note

Il limite si conta per dispositivo autenticato quando c'e', altrimenti per
indirizzo: dietro un NAT tutti i telefoni di casa condividono l'indirizzo, e
limitarli insieme punirebbe l'innocente per il vicino.

`test/ratelimit.test.mjs` inietta l'orologio: aspettare davvero cinque minuti
per vedere scadere una finestra avrebbe reso la suite inservibile.

## [0.2.4] - 2026-08-13

### Aggiunto

- **L'editor visuale copre tutto il deck.** Oltre a bottoni e cursori si possono
  ora creare, rinominare, riordinare ed eliminare **pagine e profili**, cambiare
  la dimensione della griglia, scegliere pagina e profilo iniziali e **spostare
  i controlli trascinandoli** in un'altra cella. Prima per queste cose serviva
  aprire `deck.json` a mano.
- **Icone personalizzate** caricate dall'utente: PNG, JPEG, WebP, GIF o SVG,
  fino a 192 KB e 64 in tutto. Finiscono in `icons/` accanto a `deck.json` e si
  usano come `"icon": "custom:mio-logo"`. Nuovi endpoint `GET`/`POST`/`DELETE
  /api/icons` e `GET /api/icons/file`.
- Nell'editor si sceglie l'icona da una griglia che mostra insieme i glifi
  inclusi e quelli caricati, e si puo' decidere se un controllo debba mostrare
  lo stato reale.

### Corretto

- **Gli override di avvio finivano dentro `deck.json`.** Il salvataggio partiva
  dal deck in memoria, che porta con se' `--port`, `--token` e le variabili
  `WDECK_*`: al primo salvataggio dall'editor quei valori diventavano
  permanenti, e chi avviava su una porta effimera si ritrovava una
  configurazione perfino invalida. Ora la base e' il file cosi' com'e' su disco
  ([`ConfigStore.snapshot()`](src/host/config/loader.mjs)). Vale anche per
  `POST /api/settings`. Il difetto e' emerso scrivendo i test dell'editor, ed e'
  coperto da due test di regressione.
- Un salvataggio riuscito da `POST /api/settings` non avvisava i client
  collegati: ora rimanda il deck aggiornato come fa `POST /api/deck/save`.

### Sicurezza

Il formato di un'icona e' riconosciuto **dai byte**, non da quanto dichiara il
client. Gli SVG - l'unico formato accettato che possa contenere codice -
passano da una pulizia che toglie `<script>`, `<foreignObject>`, i gestori
`on*`, gli URL `javascript:`, i riferimenti esterni e le entita' XXE; se dopo la
pulizia resta qualcosa di eseguibile il caricamento e' rifiutato. Il file e'
poi servito con `nosniff` e una `Content-Security-Policy` restrittiva. I nomi
sono slug, quindi il path traversal non ha da dove passare.

### Note

Il campo `status` sui controlli e il riferimento `custom:` nel campo `icon` sono
entrambi opzionali: le configurazioni esistenti si caricano identiche.

## [0.2.3] - 2026-08-13

### Aggiunto

- **L'host non e' piu' solo-Windows.** `media`, `hotkey`, `text`, `url`,
  `volume` e `mic` funzionano ora anche su macOS e su Linux. Prima fuori da
  Windows rispondevano `501`.
- Nuova facciata [`src/host/platform/input.mjs`](src/host/platform/input.mjs):
  gli handler non contengono piu' alcun `if (process.platform === ...)`, e ogni
  operazione ha una coppia `plan*` (descrive, per il dry-run) / `send*` (esegue).
  Stessa cosa per l'audio in `platform/audio.mjs`.
- Adattatore macOS (`osascript`): tasti e testo via System Events, volume e muto
  via `set volume`, play/pausa/brano inoltrati al primo lettore attivo fra
  Spotify, Music e TV. Se manca il permesso Accessibilita', l'errore lo dice.
- Adattatore Linux: `xdotool` su X11 e `ydotool` su Wayland (scelti in base a
  `XDG_SESSION_TYPE`), `pactl` con ripiego su `amixer` per il volume,
  `playerctl` con ripiego sul tasto multimediale per la riproduzione,
  `xdg-open` per gli URL. Quando uno strumento manca, l'errore dice quale
  pacchetto installare invece di fallire in modo oscuro.
- L'azione `script` esegue anche i file `.sh`, che e' cio' che serviva perche'
  la sua dichiarazione `platforms: ['*']` fosse vera.
- `test/platform.test.mjs`: 34 verifiche sulle mappe dei tasti, sulla scelta
  degli strumenti e sulla facciata. Le mappe sono moduli puri, quindi la
  traduzione per macOS e Linux e' verificata anche dalla macchina Windows su
  cui il progetto e' nato, e dalla CI su tutti e tre i sistemi.

### Note

**Il percorso Windows non e' stato toccato**: gli stessi script PowerShell, le
stesse funzioni di `platform/windows.mjs`. La facciata li richiama tali e quali.

Restano dichiarate solo per Windows le azioni che richiederebbero un adattatore
per ogni ambiente desktop invece di un comando solo: `brightness`, `focus`,
`desktop`, `window`, `power`, `clipboard`, `folder`, `screenshot`, `notify`,
`browser`, `game`, `rdp`. Il motivo di ciascuna e' in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

L'esecuzione reale su macOS e Linux non e' stata provata su quelle macchine:
la CI ne verifica avvio, test e smoke, ma l'input sintetico richiede una
sessione grafica interattiva.

## [0.2.2] - 2026-08-13

### Aggiunto

- **Stato reale dei controlli.** Il bottone del muto sa di essere muto, quello
  della scena OBS sa se e' in onda, la luce Hue sa di essere accesa. L'host
  legge la condizione vera dal sistema e dai servizi collegati e la manda ai
  client: bordo acceso, spia e un'etichetta breve (`muto`, `LIVE`, il nome
  della scena). Resta giusta anche quando qualcosa viene cambiato da un'altra
  applicazione, che e' il caso in cui un deck cieco mente.
- Nuovo contratto opzionale `readState(params, ctx)` per gli handler
  (vedi [`docs/ADDING-ACTIONS.md`](docs/ADDING-ACTIONS.md)). Lo dichiarano
  `volume`, `mic`, `brightness`, `media`, `obs` e `hue`.
- `GET /api/status` (con `?refresh=1`) e messaggio WebSocket `status`, con
  `states` completo e `changed` per le sole voci variate.
- Il canale lite trasporta lo stato in forma compatta (`z` / `w`, `id -> 0|1`):
  il firmware ESP32 disegna i bottoni accesi con bordo chiaro e spia.
- `settings.status` (`enabled`, `intervalMs`) e `"status": false` sul singolo
  controllo per escluderlo dalle letture.
- `GET /api/actions` riporta `reportsState` per ogni azione.
- `test/status.test.mjs`: 21 verifiche su normalizzazione, letture condivise,
  backoff, eventi di variazione e traduzione delle risposte di OBS.

### Note

Il costo delle letture e' contenuto per scelta: vengono interrogati solo i
controlli della pagina attiva, solo mentre almeno un client e' collegato, le
letture identiche di un giro sono messe in comune e un servizio che non
risponde viene messo in pausa per un minuto. **In dry-run non viene letto
nulla**: la promessa di non toccare il PC vale anche per le letture, quindi in
quella modalita' la mappa degli stati resta vuota.

Il supporto ESP32 e' conforme al protocollo e verificato da `npm run test:esp32`,
ma come tutto il firmware **non e' provato su hardware reale**.

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
