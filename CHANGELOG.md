# Changelog

Formato ispirato a [Keep a Changelog](https://keepachangelog.com/it/1.1.0/).
Il progetto segue il [versionamento semantico](https://semver.org/lang/it/).

## [0.2.10] - 2026-08-13

### Aggiunto

- **MQTT**, **Spotify** e **Discord**: le tre integrazioni che la roadmap
  dichiarava assenti. Nessuna integrazione inclusa usa piu' l'azione `stub`.
- **`mqtt`**: client MQTT 3.1.1 scritto sui socket di Node (CONNECT, PUBLISH,
  SUBSCRIBE, DISCONNECT, QoS 0 e 1, `mqtt://` e `mqtts://`). MQTT e' il modo con
  cui parla mezza domotica - Home Assistant, Zigbee2MQTT, Tasmota, ESPHome -
  quindi copre molto piu' di quanto avrebbe coperto un'integrazione per marca.
  Con `stateTopic` il bottone mostra anche lo stato reale letto dal broker.
- **`spotify`**: riproduzione, brano, volume, casuale, ripetizione, spostamento
  su un altro dispositivo, riproduzione di un URI. Passa dalla Web API e non
  dai tasti multimediali perche' quelli agiscono su qualunque lettore abbia il
  fuoco: l'API comanda l'account, quindi funziona anche se la musica sta
  suonando sul telefono o su un altoparlante in un'altra stanza. Il refresh
  token si configura una volta; l'access token orario resta in memoria.
- **`discord`**: messaggi in un canale via webhook, e comandi su microfono e
  cuffie attraverso il canale locale del client Discord (named pipe su Windows,
  socket unix altrove).
- Tutte e tre dichiarano `readState`, quindi i loro bottoni mostrano la
  condizione vera e non l'ultima pressione.

### Corretto

- **Il client MQTT perdeva le risposte piu' veloci di lui.** Le attese venivano
  registrate dopo aver scritto sul socket: un broker sulla stessa macchina puo'
  rispondere nello stesso giro di eventi, e un messaggio "retained" arriva
  spesso nello stesso pacchetto TCP della conferma di iscrizione. Il difetto e'
  emerso col broker finto dei test, che parla il protocollo vero.

### Note

Sui limiti di Discord il progetto non promette piu' di quanto puo' mantenere:
il webhook funziona subito, mentre i comandi sulla voce richiedono
un'applicazione registrata e uno scope che Discord concede su richiesta. Senza,
il client risponde con un errore, che viene riportato tale e quale invece di far
finta di aver funzionato.

## [0.2.9] - 2026-08-13

### Aggiunto

- **QR code per accoppiare il telefono.** Si inquadra e il deck si apre gia'
  collegato: niente indirizzo da digitare, niente PIN. Il codice compare nel
  terminale all'avvio e in *Impostazioni -> Collega un altro dispositivo*.
  Nuovo endpoint `GET /api/pair/qr`.
- Ogni codice porta con se' un **token dedicato**, non quello principale:
  mostrarlo a qualcuno che passa non regala la chiave di casa, e cio' che e'
  stato inquadrato una volta si revoca da solo.
- **Generatore di QR scritto nel progetto** ([`shared/qr.mjs`](shared/qr.mjs)):
  modalita' byte, versioni 1-10, quattro livelli di correzione, scelta
  automatica della maschera fra le otto previste. Reed-Solomon su GF(256),
  informazioni di formato con BCH, resa in SVG e in caratteri a blocchi per il
  terminale. Nessuna libreria.
- **Scoperta in rete locale (mDNS)**: l'host si annuncia come `<nome>.local` e
  come servizio `_wdeck._tcp.local`. Serve a una cosa concreta: quel nome non
  cambia quando il router riassegna gli indirizzi, e macOS, iOS, Windows 10+ e
  Android recente lo risolvono senza installare nulla.
- `--no-qr` per non stampare il codice all'avvio; `settings.discovery` per il
  nome annunciato e per spegnere l'annuncio.

### Note

Il QR e' scritto da zero, quindi e' verificato contro riferimenti esterni e non
solo contro se stesso: il polinomio generatore di Reed-Solomon coincide con i
coefficienti elencati dalla norma, le codeword di correzione coincidono con
l'esempio della norma (`01234567` in versione 1 livello M), e la tabella dei
blocchi e' confrontata con le codeword ricavate dalla geometria per tutte e
quaranta le combinazioni versione/livello. Un errore di trascrizione non passa.

Se la porta 5353 e' gia' occupata da Bonjour o avahi, l'host lo segnala e
prosegue senza annuncio: non e' un motivo per non partire.

## [0.2.8] - 2026-08-13

### Sicurezza

- **HTTPS e WSS opzionali**, con certificato autofirmato generato all'avvio.
  Senza cifratura il token viaggia in chiaro dentro l'URL che si apre sul
  telefono: chiunque sia sulla stessa rete Wi-Fi puo' leggerlo e usare il deck.
  Si attiva con `--tls`, `WDECK_TLS=1` o `settings.server.tls.enabled`.
- La struttura X.509 e' **costruita nel progetto**: Node sa generare le chiavi
  e sa firmare, ma non sa comporre un certificato, e quel pezzo di solito lo
  mette una libreria o `openssl` come processo esterno. Qui non si poteva fare
  ne' l'uno ne' l'altro, quindi il DER e' scritto a mano in
  [`security/selfsigned.mjs`](src/host/security/selfsigned.mjs). Il vincolo di
  zero dipendenze resta intatto.
- Il certificato copre `localhost`, `127.0.0.1` e gli indirizzi IPv4 della
  macchina, e viene **rigenerato** quando scade o quando quegli indirizzi
  cambiano: dopo un cambio di rete o l'aggancio a una dock, un certificato che
  non copre il nuovo indirizzo sarebbe inutile proprio dove serve.
- Chi ha un certificato vero lo indica con `certFile` e `keyFile`: in quel caso
  l'host non genera nulla.
- Un errore nella configurazione TLS non lascia l'host spento: viene segnalato
  e si prosegue in HTTP.
- Il client WebSocket accetta ora `rejectUnauthorized: false`, che serve a
  collegarsi a un host con certificato autofirmato.

### Note

Il certificato **non e' fidato da nessuna autorita'**: la prima volta il browser
mostra un avviso, da accettare una volta per dispositivo. Serve a cifrare il
traffico in LAN, non a dimostrare l'identita' dell'host - ma il traffico in
chiaro era il problema piu' grosso rimasto.

I test rileggono il certificato con `crypto.X509Certificate`, cioe' con lo
stesso parser che useranno i browser, e poi lo usano davvero su un server HTTPS
con WebSocket sopra: se la struttura ASN.1 fosse sbagliata, nessuna delle due
cose funzionerebbe.

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
