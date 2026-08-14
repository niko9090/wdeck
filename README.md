# Wdeck

**Stream Deck software multi-piattaforma**: un host che gira su Windows, macOS e
Linux, un client web installabile (PWA) per Android e per gli altri PC, e un
firmware di esempio per ESP32 con display touch. Nessun hardware proprietario,
nessuna dipendenza npm a runtime.

```
   Android / iPad / altro PC          ESP32 + TFT touch
        (browser o PWA)                 (protocollo lite)
              |                                |
        WebSocket /ws                  WebSocket /ws/lite
              |                                |
              +--------------+-----------------+
                             |
              HOST Node.js 22 (Windows, macOS, Linux)
                    REST + WebSocket, deck.json
                             |
              tasti media | hotkey | testo | programmi
              script .ps1/.bat/.py | URL | webhook HTTP
```

> **Stato: lavoro semi-finito, funzionante e valutabile.**
> Cosa e' completo, cosa e' un segnaposto e cosa manca e' elencato senza sconti
> in [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Quickstart: installazione su Windows

Scarica **`WdeckSetup.exe`** dalla pagina
[Releases](https://github.com/niko9090/wdeck/releases) e fai doppio clic.

Procedura guidata, icona sul desktop e nel menu Start, avvio automatico se lo
spunti, e la voce per rimuoverlo in *App e funzionalita'* come qualsiasi altro
programma. **Non serve installare Node.js**, non serve essere amministratore e
non compare nessuna finestra del terminale: Wdeck sta nell'area di notifica,
vicino all'orologio, e da li' si apre il deck, si copiano gli indirizzi per il
telefono e si esce.

Disinstallando, la tua `deck.json` e le icone che hai caricato **restano**: sono
lavoro tuo.

### Se preferisci non installare niente

Nella stessa pagina c'e' `wdeck.exe`: lo stesso programma in un file solo, da
tenere su una chiavetta. Doppio clic e parte, senza scrivere niente nel sistema.

### Oppure dai sorgenti (Windows, macOS, Linux)

```bash
git clone https://github.com/niko9090/wdeck.git
cd wdeck
npm install          # nessuna dipendenza da scaricare: e' istantaneo
npm run build        # compila il client web in dist/web
npm start            # avvia l'host
```

Su macOS e Linux non c'e' un installer: si avvia dai sorgenti. Quali azioni
funzionano su quale sistema, e cosa serve installare, e' nella tabella
[Su quali sistemi gira](#su-quali-sistemi-gira).

All'avvio la console stampa gli URL da aprire e il token:

```
  Wdeck host v0.6.0 - deck "Wdeck"
  configurazione : C:\Users\<utente>\AppData\Local\Wdeck\deck.json
  dry-run        : disattivato
  azioni         : brightness, browser, clipboard, delay, desktop, discord,
                   focus, folder, game, homeassistant, hotkey, http, hue, launch,
                   media, mic, mqtt, navigate, noop, notify, obs, power, rdp,
                   screenshot, script, sequence, spotify, stub, text, url,
                   volume, window

  URL del client web:
    http://127.0.0.1:8899/?token=...
    http://192.168.1.10:8899/?token=...

  token : CHANGE-ME-wdeck-dev-token
  PIN   : configurato (pairing via POST /api/pair)
```

**Il modo piu' rapido di collegare il telefono e' inquadrare il QR code** che
l'host stampa nel terminale all'avvio: si apre il deck gia' collegato, senza
digitare indirizzo ne' PIN. Ogni codice porta con se' un token dedicato a quel
dispositivo, revocabile da solo. Lo stesso codice si trova in *Impostazioni ->
Collega un altro dispositivo*.

In alternativa apri l'indirizzo `192.168.x.x` e inserisci il **PIN**
(`settings.security.pin` in `deck.json`), oppure usa l'URL con `?token=...`.

L'host si annuncia anche in rete locale come **`wdeck-host.local`**: quel nome
non cambia quando il router riassegna gli indirizzi, e macOS, iOS, Windows 10+
e Android recente lo risolvono senza installare nulla.

Da Chrome/Edge: menu -> *Installa app* per averlo a schermo intero come app
nativa.

Mentre l'host gira, un'**icona nell'area di notifica** (vicino all'orologio) da'
accesso a: apri il deck, copia gli indirizzi per il telefono, ricarica
`deck.json`, controlla aggiornamenti, esci.

### Cosa sai fare dal client

| gesto | effetto |
|---|---|
| tocco su un bottone | esegue l'azione, con risposta immediata |
| **scorrimento orizzontale** | pagina precedente / successiva |
| trascinamento su un cursore | volume o luminosita' al valore scelto |
| tocco prolungato | esegue `holdAction`, se il controllo ne ha una |
| matita in alto a destra | modalita' modifica: vedi sotto |
| ingranaggio | PIN, computer collegati, aggiornamenti |

### L'editor visuale

La matita in alto a destra accende la modalita' modifica. Da li' si fa tutto
senza toccare `deck.json`:

| gesto | effetto |
|---|---|
| tocco su un controllo | ne apre le impostazioni: azione, parametri, icona, colore, larghezza |
| **trascinamento di un controllo** | lo sposta in un'altra cella |
| tocco su una cella vuota | aggiunge un controllo li' |
| **+** in fondo alle schede | aggiunge una pagina |
| matita su una scheda | nome, righe, colonne, ordine, eliminazione della pagina |
| menu dei profili -> *Gestisci profili* | crea, rinomina, elimina, sceglie il profilo iniziale |

Ogni salvataggio passa dalla **validazione dell'host**, che e' l'unico a vedere
la configurazione intera: se una modifica lascerebbe un profilo senza pagine, un
controllo fuori dalla griglia, due controlli sulla stessa cella o un `navigate`
senza destinazione, il salvataggio viene rifiutato e il messaggio dice quale.
La versione precedente resta in `.wdeck-backup/`.

### Icone personalizzate

Nell'editor, sotto *Icona*, ci sono i glifi inclusi e il bottone **Carica
un'icona**: PNG, JPEG, WebP, GIF o SVG, fino a 192 KB, fino a 64 in tutto.
I file finiscono in `icons/` **accanto** a `deck.json` (non dentro: un file di
configurazione pieno di base64 non sarebbe piu' modificabile a mano) e si usano
scrivendo `"icon": "custom:mio-logo"`.

Il formato viene riconosciuto **dai byte**, non da quanto dichiara il browser.
Gli SVG vengono ripuliti al caricamento da script, gestori di evento, URL
`javascript:` e riferimenti esterni; se resta qualcosa di eseguibile il file
viene rifiutato.

### Piu' computer

Wdeck si installa su tutti i PC che vuoi. Dopo il primo, tocca **+** nella barra
in alto (o *Impostazioni -> Aggiungi un altro computer*) e associa l'altro host:
compaiono delle schede in alto e si passa dall'uno all'altro con un tocco,
restando nella stessa app. Ogni computer conserva il proprio token.

### Prima di usarlo davvero

Modifica [`deck.json`](deck.json):

1. cambia `settings.security.token` (almeno 8 caratteri) e `settings.security.pin`;
2. rivedi `settings.security.allowExec`: **e' la lista degli unici programmi e
   script che l'host potra' lanciare**;
3. se vuoi provare senza rischi, avvia con `npm run dev` (dry-run: le azioni
   vengono validate e registrate, ma non eseguite).

Il file si ricarica **a caldo**: salvi, e i client aggiornano la griglia.
Se scrivi qualcosa di sbagliato, l'host lo segnala e tiene la versione buona.

---

## Distribuzione: installer, eseguibile e binari ESP32

Per **dare Wdeck a qualcun altro** non serve che quel qualcuno installi Node.js
o sappia cos'e' npm.

### `WdeckSetup.exe`, l'installer

```powershell
npm run installer    # produce release\WdeckSetup-<versione>.exe (~23 MB)
```

Procedura guidata in italiano e inglese, icone nel menu Start e sul desktop,
avvio automatico facoltativo, disinstallazione registrata in *App e
funzionalita'*. Si installa per utente in `%LOCALAPPDATA%\Programs\Wdeck`,
quindi **non chiede l'UAC**: un deck non ha ragione di volere i diritti di
amministratore.

Lo costruisce [Inno Setup](https://jrsoftware.org/isdl.php), che va installato a
parte: e' un attrezzo da banco come `postject`, non entra in `package.json` e non
finisce dentro il programma.

**Nessuna finestra del terminale.** `node.exe` e' compilato come applicazione a
console, e questo e' il motivo per cui un eseguibile costruito con SEA apre una
finestra nera e la lascia aperta. Nell'intestazione PE un campo di due byte
distingue le due cose: `npm run exe` lo porta da 3 (console) a 2 (grafico), e
non tocca nient'altro - il codice eseguito e' identico. Senza terminale il
diario finisce in `%LOCALAPPDATA%\Wdeck\wdeck.log`, che e' la prima cosa da
guardare quando qualcosa non parte.

### `wdeck.exe`, file unico

```powershell
npm run exe        # produce release\wdeck.exe (~84 MB)
```

Un solo file, che si copia su una chiavetta e parte con un doppio clic: dentro
c'e' il runtime di Node insieme all'host, grazie alle *Single Executable
Applications* di Node 20+. Alla prima esecuzione riversa i propri moduli in
`%LOCALAPPDATA%\Wdeck\runtime\<impronta>\` e crea `%LOCALAPPDATA%\Wdeck\deck.json`
se non esiste gia'; la configurazione sta **fuori** dai file estratti, quindi un
exe piu' recente non se la porta via. Accetta le stesse opzioni della CLI
(`wdeck.exe --port 9000 --dry-run`).

Pesa 84 MB perche' l'interprete e' dentro: e' il prezzo del non chiedere nulla
al PC di destinazione. Chi Node ce l'ha gia' fa prima con l'archivio zip.

Per **costruirlo** serve Node 20.12 o superiore (`node:sea` non esiste prima);
per **eseguirlo** non serve niente, e l'host dai sorgenti continua a girare
dalla 20.10 come sempre.

La build usa [postject](https://github.com/nodejs/postject), lo strumento
ufficiale del progetto Node.js, scaricato al volo da `npx` **solo in fase di
costruzione**: non e' una dipendenza, non compare in `package.json` e l'host non
lo importa mai. Il vincolo di zero dipendenze a runtime resta verificato da
`npm run check:deps`.

### Firmware ESP32 gia' compilato

```powershell
pip install platformio    # una volta sola
npm run firmware          # produce release\firmware\*.bin
```

Escono tre binari per ciascuna delle schede supportate — `firmware`,
`bootloader` e `partitions` — pronti da scrivere:

```powershell
pio run -e esp32-cyd -t upload          # scheda collegata via USB
# oppure, partendo dai .bin gia' pronti:
esptool.py --chip esp32 write_flash 0x1000 esp32-cyd-bootloader.bin `
    0x8000 esp32-cyd-partitions.bin 0x10000 esp32-cyd-firmware.bin
```

Wi-Fi, indirizzo dell'host e token si passano alla compilazione senza toccare
il codice (`-DWDECK_WIFI_SSID=...`, vedi `firmware/esp32/platformio.ini`).

**Cosa dimostra questa compilazione, e cosa no.** Che il firmware compili per
tutte e tre le schede e' una verifica vera, ed e' servita: ha trovato un errore
che nessun test poteva vedere (l'ambiente senza touch non compilava affatto).
Che il firmware **funzioni** su una scheda accesa e' un'altra affermazione, e
quella richiede l'hardware: pin, rotazione e taratura del touch restano da
verificare sulla scheda in uso.

---

## Comandi

| comando | cosa fa |
|---|---|
| `npm start` | avvia l'host con `deck.json` |
| `npm run dev` | avvia l'host in dry-run (non esegue nulla) |
| `npm run build` | compila il client web statico in `dist/web/` |
| `npm test` | test unitari e di integrazione dell'host (465 verifiche) |
| `npm run smoke` | smoke test end-to-end su un host reale (49 verifiche) |
| `npm run test:esp32` | conformita' del firmware ESP32 al protocollo (111 verifiche) |
| `npm run check:docs` | coerenza fra documentazione, codice e protocollo |
| `npm run check:deps` | verifica il vincolo di zero dipendenze (package.json e import) |
| `npm run verify` | tutti i controlli sopra, in sequenza |
| `npm run installer` | costruisce `release/WdeckSetup-<versione>.exe` (serve Inno Setup) |
| `npm run exe` | costruisce `release/wdeck.exe`, eseguibile singolo per Windows |
| `npm run checksums` | scrive `release/SHA256SUMS.txt` |
| `node scripts/gen-ico.mjs` | genera `installer/wdeck.ico` dalle icone della PWA |
| `npm run firmware` | compila il firmware ESP32 in `release/firmware/*.bin` |
| `npm run package` | archivio zip da allegare a una release |
| `node scripts/gen-icons.mjs` | rigenera le icone PNG della PWA |

Opzioni della CLI:

```powershell
node bin/wdeck.mjs --help
node bin/wdeck.mjs --port 9000 --host 127.0.0.1   # solo locale
node bin/wdeck.mjs --dry-run --no-watch
node bin/wdeck.mjs --tls                          # HTTPS/WSS autofirmato
node bin/wdeck.mjs --config .\deck-lavoro.json
```

Equivalenti come variabili d'ambiente: `WDECK_PORT`, `WDECK_HOST`,
`WDECK_TOKEN`, `WDECK_DRY_RUN`, `WDECK_REQUIRE_TOKEN`, `WDECK_TLS`.

### Integrazione continua

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) esegue `npm run verify` a
ogni push e a ogni pull request, su Linux, Windows e macOS con Node 20.10 e 22.
E' la stessa catena che si lancia in locale: test unitari, smoke end-to-end,
build della PWA, conformita' del firmware e coerenza della documentazione.

---

## Configurazione: `deck.json`

Struttura: **deck -> profili -> pagine -> bottoni -> azione**.

```json
{
  "version": 1,
  "defaultProfile": "default",
  "settings": {
    "server":   { "host": "0.0.0.0", "port": 8899 },
    "security": {
      "requireToken": true,
      "token": "un-token-lungo-e-casuale",
      "pin": "246810",
      "dryRun": false,
      "allowUrlSchemes": ["http", "https"],
      "allowedExtensions": [".exe", ".ps1", ".bat"],
      "allowExec": ["C:\\Windows\\System32\\notepad.exe", "scripts/examples/*"]
    },
    "ui": { "theme": "dark", "accent": "#4c8dff", "showLabels": true, "language": "auto" }
  },
  "profiles": [
    {
      "id": "default",
      "name": "Scrivania",
      "defaultPage": "main",
      "pages": [
        {
          "id": "main", "name": "Principale", "rows": 3, "cols": 5,
          "buttons": [
            {
              "id": "media-playpause",
              "label": "Play/Pausa",
              "row": 0, "col": 1,
              "icon": "play",
              "color": "#1f6feb",
              "action": { "type": "media", "params": { "key": "playpause" } }
            }
          ]
        }
      ]
    }
  ]
}
```

Regole applicate dal validatore ([`src/host/config/schema.mjs`](src/host/config/schema.mjs)):

- gli `id` dei bottoni sono **univoci nell'intero deck** (servono da indirizzo);
- due bottoni non possono occupare la stessa cella;
- `row`/`col` devono stare dentro `rows`/`cols`;
- i target di `navigate` devono esistere;
- il tipo di azione dev'essere registrato.

Lo schema JSON per l'autocompletamento negli editor e'
[`schema/deck.schema.json`](schema/deck.schema.json) (gia' referenziato con
`$schema` in `deck.json`).

### Su quali sistemi gira

L'host, la PWA e il protocollo funzionano ovunque giri Node 20.10+. Cambia
quali azioni possono essere *eseguite*:

| azione | Windows | macOS | Linux |
|---|:---:|:---:|:---:|
| `media`, `hotkey`, `text`, `url` | si | si | si |
| `volume`, `mic` | si | si | si |
| `launch`, `script`, `http`, `sequence`, `navigate`, `obs`, `homeassistant`, `hue` | si | si | si |
| `brightness`, `focus`, `desktop`, `window`, `power`, `clipboard`, `folder`, `screenshot`, `notify`, `browser`, `game`, `rdp` | si | - | - |

Fuori dalle piattaforme supportate un'azione risponde `501` con un messaggio
esplicito, e resta comunque provabile in dry-run.

Cosa serve installare:

- **Windows**: nulla, PowerShell basta.
- **macOS**: nulla (`osascript` e' di sistema). L'input sintetico richiede pero'
  il permesso **Accessibilita'** per l'applicazione che avvia Wdeck, in
  *Impostazioni di Sistema -> Privacy e sicurezza -> Accessibilita'*; senza,
  l'azione fallisce dicendo esattamente questo.
- **Linux**: `xdotool` (sessioni X11) oppure `ydotool` con il suo demone
  (sessioni Wayland) per tasti e testo; `pactl` (PipeWire/PulseAudio) o
  `amixer` (ALSA) per il volume; `playerctl` per play/pausa e cambio brano
  (senza, si ripiega sul tasto multimediale); `xdg-open` per gli URL. Se ne
  manca uno, l'errore dice quale pacchetto installare.

### Azioni disponibili

32 azioni in 12 categorie. L'editor le mostra raggruppate esattamente cosi'.

| categoria | azioni |
|---|---|
| Media e audio | `media`, `volume`, `mic`, `spotify` |
| Tastiera e testo | `hotkey`, `text` |
| Finestre e desktop | `focus`, `desktop`, `window` |
| Sistema e alimentazione | `brightness`, `power` |
| Programmi e giochi | `launch`, `game` |
| Browser e web | `browser`, `url`, `http` |
| Desktop remoti | `rdp` |
| Streaming e OBS | `obs`, `discord` |
| Casa intelligente | `homeassistant`, `hue`, `mqtt` |
| Produttivita' | `clipboard`, `folder`, `screenshot`, `notify` |
| Script personalizzati | `script` |
| Navigazione deck | `navigate`, `sequence`, `delay`, `noop`, `stub` |

Tabella completa dei parametri e guida per aggiungerne di nuove:
[`docs/ADDING-ACTIONS.md`](docs/ADDING-ACTIONS.md).

### Cursori

Un controllo con `"kind": "slider"` diventa un cursore trascinabile. Funziona
con le azioni che dichiarano `control: 'slider'` (`volume`, `mic`,
`brightness`), che leggono e impostano un valore assoluto invece di muoversi a
scatti come i tasti media:

```json
{
  "id": "slider-volume", "label": "Volume",
  "row": 0, "col": 0, "kind": "slider", "span": 4,
  "action": { "type": "volume", "params": {} }
}
```

`span` indica quante celle occupa in orizzontale. Il valore mostrato e' sempre
quello reale letto dal PC, non l'ultima posizione del dito.

### Stato reale dei controlli

Il bottone del muto sa di essere muto. L'host legge periodicamente la
condizione vera dal PC e dai servizi collegati, e i client la mostrano: bordo
acceso, spia e un'etichetta breve (`muto`, `LIVE`, il nome della scena OBS in
onda). Il valore resta giusto anche quando qualcosa viene cambiato **da
un'altra applicazione**, che e' proprio il caso in cui un deck "cieco" mente.

Sanno dichiarare il proprio stato: `volume`, `mic`, `brightness`, `media` (con
`key` `mute`/`volumeup`/`volumedown`), `obs`, `hue`, `mqtt`, `spotify` e
`discord`.

```json
{ "id": "mute", "label": "Muto", "row": 0, "col": 0,
  "action": { "type": "volume", "params": { "mute": "toggle" } } }
```

Non serve configurare nulla. Per spegnere la lettura su un singolo controllo:
`"status": false`. Per spegnerla del tutto o cambiarne il ritmo:

```json
"settings": { "status": { "enabled": true, "intervalMs": 8000 } }
```

Vengono interrogati solo i controlli della pagina che si sta guardando, e solo
mentre c'e' almeno un client collegato; le letture uguali sono messe in comune
(dieci cursori del volume costano una lettura sola) e un servizio spento viene
messo in pausa per un minuto invece di essere interrogato di continuo.
In **dry-run non viene letto nulla**: la promessa di non toccare il PC vale
anche per le letture.

### Aspetto e lingua

`settings.ui.theme` accetta `dark`, `light` e `auto` (segue il sistema);
`settings.ui.language` accetta `it`, `en` e `auto` (segue il browser).
Entrambi si cambiano anche da *Impostazioni -> Aspetto*, senza toccare il file.

### Pressione prolungata

Un controllo puo' avere una **seconda azione**, eseguita tenendolo premuto per
mezzo secondo: si configura dall'editor, nella sezione *Pressione prolungata*.
E' comoda per mettere l'opposto sullo stesso tasto - accendi e spegni, muto e
volume al massimo - senza occupare due celle.

```json
{
  "id": "luce", "label": "Luce", "row": 0, "col": 0,
  "action":     { "type": "hue", "params": { "id": 1, "on": "toggle" } },
  "holdAction": { "type": "hue", "params": { "id": 1, "on": false } }
}
```

### Conferma per le azioni pericolose

`"confirm": true` su un bottone fa comparire una richiesta di conferma prima
dell'esecuzione. Consigliato su `power` con `shutdown`, `restart` e `signout`.

Esempi:

```json
{ "type": "hotkey",   "params": { "keys": "ctrl+shift+m" } }
{ "type": "media",    "params": { "key": "volumeup", "repeat": 3 } }
{ "type": "launch",   "params": { "path": "C:\\Windows\\explorer.exe", "args": ["C:\\"] } }
{ "type": "script",   "params": { "path": "scripts/examples/hello.ps1", "args": ["Wdeck"] } }
{ "type": "http",     "params": { "url": "http://homeassistant.local:8123/api/webhook/x", "method": "POST" } }
{ "type": "sequence", "params": { "steps": [
    { "type": "media", "params": { "key": "playpause" } },
    { "type": "delay", "params": { "ms": 250 } },
    { "type": "hotkey", "params": { "keys": "win+d" } }
] } }
```

---

## Sicurezza

Il progetto esegue programmi sul tuo PC su richiesta della rete locale: le
protezioni non sono un dettaglio.

- **Token obbligatorio** su ogni endpoint tranne `/api/health` e `/api/pair`;
  confronto a tempo costante; generato automaticamente se non lo configuri.
- **Un token per dispositivo.** Il pairing con PIN non consegna piu' la chiave
  di casa: crea una credenziale dedicata a quel telefono, che si **revoca da
  sola** e puo' **scadere**. In `deck.json` ne resta la sola impronta SHA-256,
  quindi chi legge il file non puo' ricavarla. Un telefono perso si toglie
  senza riaccoppiare tutti gli altri, e chi era collegato viene scollegato
  subito, non alla prossima richiesta.
- **Rotazione del token principale** da *Impostazioni* nel client, da
  `POST /api/token/rotate`, o da riga di comando **senza avviare l'host**
  (`--rotate-token`), che e' cio' che serve quando il token e' andato perduto.
- **Whitelist `allowExec`**: se e' vuota, *nessun* programma puo' essere
  lanciato. Supporta i glob `*` e `**`; i percorsi relativi sono risolti
  rispetto alla cartella di `deck.json`; il path traversal non la aggira.
- **Whitelist di estensioni** e **whitelist degli schemi URL**.
- **Limiti di frequenza**: 60 comandi ogni 10 secondi e 10 tentativi di accesso
  ogni 5 minuti, a finestra scorrevole. Un PIN di quattro cifre sono diecimila
  combinazioni: senza limite si provano in pochi secondi. Anche i token
  rifiutati contano come tentativi, altrimenti il limite si aggirerebbe
  provando quelli. Si tara da `settings.security.rateLimit`.
- **Registro di audit** persistente accanto a `deck.json`: ogni azione con chi
  l'ha chiesta, da dove, con quale esito e in quanto tempo, piu' gli eventi di
  sicurezza (pairing riusciti e falliti, revoche, rotazioni, blocchi per
  frequenza). E' JSONL, si legge con `tail` e si filtra con `grep`. Token, PIN e
  password non ci finiscono mai. Si legge anche da `GET /api/audit`.
- **Dry-run**: i client possono attivarlo ma **non disattivarlo**.
- **HTTPS/WSS opzionale** con certificato autofirmato generato all'avvio
  (`--tls`, oppure `settings.server.tls.enabled`). Senza, il token viaggia in
  chiaro dentro l'URL che apri sul telefono: chiunque sia sulla stessa rete
  Wi-Fi puo' leggerlo. Il certificato copre `localhost`, `127.0.0.1` e gli
  indirizzi della macchina, si rigenera quando scade o quando cambia rete, e
  non richiede alcuna dipendenza: la struttura X.509 e' costruita nel progetto.
  Non essendo firmato da un'autorita', il browser mostra un avviso la prima
  volta. Chi ha un certificato vero lo indica con `certFile` e `keyFile`.
- **Bind**: `127.0.0.1` per l'uso solo locale, `0.0.0.0` per la LAN.
- Il layout inviato ai client **non contiene mai** token, PIN o whitelist.

### Il pairing scrive in `deck.json`

Vale la pena saperlo prima di tenere `deck.json` sotto controllo di versione:
**ogni accoppiamento riuscito modifica il file di configurazione**, aggiungendo
una voce a `settings.security.devices`. Non e' un file separato.

```json
{ "id": "d-1a2b3c4d5e", "name": "Telefono di Nicola",
  "hash": "793cbd7e...", "createdAt": 1786655324210, "expiresAt": null }
```

Il token vero **non c'e'**: resta solo la sua impronta SHA-256, che serve a
riconoscerlo ma non permette di ricostruirlo. Anche committando il file per
sbaglio non si consegna una credenziale valida — ma si consegna comunque
l'elenco dei dispositivi accoppiati, e i token di prova restano validi finche'
non li si revoca. Le voci nate da un collaudo si tolgono cosi':

```bash
node bin/wdeck.mjs --list-devices              # quali ci sono
node bin/wdeck.mjs --revoke-device d-1a2b3c4d5e # via quella
node bin/wdeck.mjs --prune-devices              # via tutte le scadute
```

Chi vuole che il proprio `deck.json` non finisca mai in un commit lo tenga fuori
dal repository: l'host accetta `--config <percorso>`, e l'installer lo mette
gia' in `%LOCALAPPDATA%\Wdeck\deck.json`, fuori dalla cartella del progetto.

Gestione da riga di comando (non avvia l'host, lavora su `deck.json`):

```bash
node bin/wdeck.mjs --list-devices
node bin/wdeck.mjs --add-device "ESP32 salotto" --days 365
node bin/wdeck.mjs --revoke-device d-1a2b3c4d5e
node bin/wdeck.mjs --rotate-token
```

Vedi la sezione *Mancante* di [`docs/ROADMAP.md`](docs/ROADMAP.md) per quello
che resta scoperto.

---

## Architettura

```
Wdeck/
├─ bin/wdeck.mjs                CLI dell'host
├─ deck.json                    configurazione (profili, pagine, bottoni)
├─ schema/deck.schema.json      schema JSON per gli editor
├─ shared/protocol.mjs          protocollo condiviso host <-> web <-> ESP32
├─ src/host/
│  ├─ index.mjs                 composizione dell'host (createHost)
│  ├─ state.mjs                 stato runtime + eventi
│  ├─ config/                   validazione schema + caricamento e hot reload
│  ├─ actions/                  registro, dispatcher e handler delle azioni
│  ├─ security/                 token/PIN e whitelist di esecuzione
│  ├─ platform/                 adattatori Windows / macOS / Linux
│  ├─ server/                   API REST, hub WebSocket, file statici
│  └─ ws/                       WebSocket RFC 6455 (frame, server, client)
├─ web/                         client PWA (moduli ES, nessun framework)
├─ firmware/esp32/              firmware di esempio PlatformIO
├─ scripts/                     build, smoke test, conformita', utility
├─ test/                        suite `node --test`
└─ docs/                        PROTOCOL.md, ROADMAP.md, ADDING-ACTIONS.md
```

Scelte di fondo:

- **Zero dipendenze runtime.** Solo moduli built-in di Node: niente pacchetti
  nativi da compilare, `npm install` immediato, nulla che invecchi male.
  Il WebSocket e la validazione dello schema sono implementati nel progetto.
  `npm run check:deps` fa fallire la build se qualcuno aggiunge un pacchetto.
- **Il protocollo e' un file solo.** `shared/protocol.mjs` e' importato
  dall'host e dal client web, e replicato in C in `wdeck_protocol.h`; un test
  automatico impedisce che i due divergano.
- **Un adattatore per piattaforma, una facciata sola.** Gli handler parlano con
  [`src/host/platform/input.mjs`](src/host/platform/input.mjs) e non sanno su
  quale sistema girano. Windows usa PowerShell (`keybd_event` via P/Invoke,
  `SendKeys` per il testo, script passati con `-EncodedCommand` cosi' i
  parametri non possono causare injection); macOS usa `osascript`; Linux usa
  `xdotool`/`ydotool`, `pactl`/`amixer` e `playerctl`. Le mappe dei tasti sono
  moduli puri, quindi verificabili anche dalla piattaforma sbagliata.
- **Dry-run come cittadino di prima classe.** Ogni handler sa simularsi: e'
  quello che rende i test eseguibili ovunque e sicuri.

---

## Documentazione

- [`docs/PROTOCOL.md`](docs/PROTOCOL.md) - REST, WebSocket full, protocollo lite, esempi di sessione.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) - completo / stub / mancante e prossimi passi.
- [`docs/ADDING-ACTIONS.md`](docs/ADDING-ACTIONS.md) - come scrivere una nuova azione.
- [`firmware/esp32/README.md`](firmware/esp32/README.md) - schede supportate, compilazione, configurazione.
- [`CHANGELOG.md`](CHANGELOG.md) - cosa e' cambiato.

## Licenza

MIT.
