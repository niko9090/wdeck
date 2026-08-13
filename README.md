# Wdeck

**Stream Deck software multi-piattaforma**: un host che gira sul PC Windows,
un client web installabile (PWA) per Android e per gli altri PC, e un firmware
di esempio per ESP32 con display touch. Nessun hardware proprietario, nessuna
dipendenza npm a runtime.

```
   Android / iPad / altro PC          ESP32 + TFT touch
        (browser o PWA)                 (protocollo lite)
              |                                |
        WebSocket /ws                  WebSocket /ws/lite
              |                                |
              +--------------+-----------------+
                             |
                    HOST Node.js 22 (PC Windows)
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

Serve **Node.js 20.10 o superiore** (sviluppato e testato su Node 22).

Scarica l'archivio dell'ultima versione dalla pagina
[Releases](https://github.com/niko9090/wdeck/releases), estrailo e lancia:

```powershell
.\installer\install.ps1 -Autostart
```

L'installer copia tutto in `%LOCALAPPDATA%\Wdeck`, compila il client, **genera
un token e un PIN casuali per questo PC**, crea i collegamenti nel menu Start e
sul desktop e (con `-Autostart`) lo fa partire insieme a Windows. Non serve
essere amministratore e non viene scaricato nulla. Per rimuoverlo:
`.\installer\install.ps1 -Uninstall` (la tua `deck.json` viene conservata).

### Oppure dai sorgenti

```powershell
git clone https://github.com/niko9090/wdeck.git
cd wdeck
npm install          # nessuna dipendenza da scaricare: e' istantaneo
npm run build        # compila il client web in dist/web
npm start            # avvia l'host
```

All'avvio la console stampa gli URL da aprire e il token:

```
  Wdeck host v0.2.0 - deck "Wdeck"
  configurazione : C:\Users\<utente>\AppData\Local\Wdeck\deck.json
  dry-run        : disattivato
  azioni         : brightness, browser, clipboard, delay, desktop, focus, folder,
                   game, homeassistant, hotkey, http, hue, launch, media, mic,
                   navigate, noop, notify, obs, power, rdp, screenshot, script,
                   sequence, stub, text, url, volume, window

  URL del client web:
    http://127.0.0.1:8899/?token=...
    http://192.168.1.10:8899/?token=...

  token : CHANGE-ME-wdeck-dev-token
  PIN   : configurato (pairing via POST /api/pair)
```

Dal telefono, sulla stessa rete, apri l'indirizzo `192.168.x.x` e inserisci il
**PIN** (`settings.security.pin` in `deck.json`); in alternativa apri
direttamente l'URL con `?token=...`. Da Chrome/Edge: menu -> *Installa app* per
averlo a schermo intero come app nativa.

Mentre l'host gira, un'**icona nell'area di notifica** (vicino all'orologio) da'
accesso a: apri il deck, copia gli indirizzi per il telefono, ricarica
`deck.json`, controlla aggiornamenti, esci.

### Cosa sai fare dal client

| gesto | effetto |
|---|---|
| tocco su un bottone | esegue l'azione, con risposta immediata |
| **scorrimento orizzontale** | pagina precedente / successiva |
| trascinamento su un cursore | volume o luminosita' al valore scelto |
| tocco prolungato | esegue `holdAction`, se il bottone ne ha una |
| matita in alto a destra | modalita' modifica: tocca un controllo per cambiarlo, una cella vuota per aggiungerne uno |
| ingranaggio | PIN, computer collegati, aggiornamenti |

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

## Comandi

| comando | cosa fa |
|---|---|
| `npm start` | avvia l'host con `deck.json` |
| `npm run dev` | avvia l'host in dry-run (non esegue nulla) |
| `npm run build` | compila il client web statico in `dist/web/` |
| `npm test` | test unitari e di integrazione dell'host (150 verifiche) |
| `npm run smoke` | smoke test end-to-end su un host reale (36 verifiche) |
| `npm run test:esp32` | conformita' del firmware ESP32 al protocollo (109 verifiche) |
| `npm run check:docs` | coerenza fra documentazione, codice e protocollo |
| `npm run verify` | tutti i controlli sopra, in sequenza |
| `node scripts/gen-icons.mjs` | rigenera le icone PNG della PWA |

Opzioni della CLI:

```powershell
node bin/wdeck.mjs --help
node bin/wdeck.mjs --port 9000 --host 127.0.0.1   # solo locale
node bin/wdeck.mjs --dry-run --no-watch
node bin/wdeck.mjs --config .\deck-lavoro.json
```

Equivalenti come variabili d'ambiente: `WDECK_PORT`, `WDECK_HOST`,
`WDECK_TOKEN`, `WDECK_DRY_RUN`, `WDECK_REQUIRE_TOKEN`.

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
    "ui": { "theme": "dark", "accent": "#4c8dff", "showLabels": true }
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

### Azioni disponibili

29 azioni in 12 categorie. L'editor le mostra raggruppate esattamente cosi'.

| categoria | azioni |
|---|---|
| Media e audio | `media`, `volume`, `mic` |
| Tastiera e testo | `hotkey`, `text` |
| Finestre e desktop | `focus`, `desktop`, `window` |
| Sistema e alimentazione | `brightness`, `power` |
| Programmi e giochi | `launch`, `game` |
| Browser e web | `browser`, `url`, `http` |
| Desktop remoti | `rdp` |
| Streaming e OBS | `obs` |
| Casa intelligente | `homeassistant`, `hue` |
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
- **Pairing con PIN**, per non digitare il token sul telefono.
- **Whitelist `allowExec`**: se e' vuota, *nessun* programma puo' essere
  lanciato. Supporta i glob `*` e `**`; i percorsi relativi sono risolti
  rispetto alla cartella di `deck.json`; il path traversal non la aggira.
- **Whitelist di estensioni** e **whitelist degli schemi URL**.
- **Dry-run**: i client possono attivarlo ma **non disattivarlo**.
- **Bind**: `127.0.0.1` per l'uso solo locale, `0.0.0.0` per la LAN.
- Il layout inviato ai client **non contiene mai** token, PIN o whitelist.

Limiti noti: nessun HTTPS, un solo token condiviso, nessun rate limiting.
Vedi la sezione *Mancante* di [`docs/ROADMAP.md`](docs/ROADMAP.md).
Usare solo su una rete di cui ti fidi.

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
│  ├─ platform/                 tasti virtuali e integrazione PowerShell
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
- **Il protocollo e' un file solo.** `shared/protocol.mjs` e' importato
  dall'host e dal client web, e replicato in C in `wdeck_protocol.h`; un test
  automatico impedisce che i due divergano.
- **Windows tramite PowerShell.** Tasti e hotkey usano `keybd_event` via
  P/Invoke, il testo usa `SendKeys`; gli script sono passati con
  `-EncodedCommand`, quindi i parametri non possono causare injection.
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
