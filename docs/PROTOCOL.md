# Protocollo Wdeck

Definizione unica: [`shared/protocol.mjs`](../shared/protocol.mjs).
Gemello C per i microcontrollori: [`firmware/esp32/include/wdeck_protocol.h`](../firmware/esp32/include/wdeck_protocol.h).
I due file sono confrontati automaticamente da `npm run test:esp32`.

Esistono due dialetti:

| | **full** | **lite** |
|---|---|---|
| destinatari | client web PWA, script, integrazioni | ESP32 e microcontrollori |
| formato | JSON leggibile, campi estesi | JSON con chiavi di 1 carattere |
| versione | `PROTOCOL_VERSION` = 1 | `LITE_PROTOCOL_VERSION` = 1 |
| trasporto | REST + WebSocket `/ws` | REST + WebSocket `/ws/lite` |
| autenticazione | token (query, header o messaggio `auth`) | token obbligatorio nell'handshake |

---

## 1. Autenticazione

Il token e' definito in `settings.security.token` (o generato all'avvio se assente).
Puo' essere trasmesso in tre modi, equivalenti:

| modo | esempio |
|---|---|
| querystring | `GET /api/deck?token=abc123` |
| header dedicato | `x-wdeck-token: abc123` |
| header standard | `Authorization: Bearer abc123` |

Se l'header e la querystring sono entrambi presenti, vince l'header.
Il confronto e' a tempo costante (`crypto.timingSafeEqual`).

### Due generi di credenziale

| | **token principale** | **token per dispositivo** |
|---|---|---|
| dove sta | `settings.security.token` | creato dal pairing, nel file resta la sola impronta SHA-256 |
| a che serve | la chiave di casa: console, URL con `?token=`, script | uno per telefono o tablet |
| scade | mai | quando si vuole (`deviceTokenDays`, oppure `days` alla creazione) |
| si revoca | rigenerandolo (`POST /api/token/rotate`) | uno alla volta, senza toccare gli altri |

Chi legge `deck.json` **non puo' ricavare** i token dei dispositivi: c'e' solo
l'impronta. Un telefono perso si toglie da solo, senza dover riaccoppiare tutti.

### Pairing tramite PIN

```http
POST /api/pair
Content-Type: application/json

{ "pin": "246810", "name": "Telefono di Nicola", "days": 90 }
```

```json
{ "ok": true, "token": "abc123...", "device": { "id": "d-1a2b3c4d5e", "name": "Telefono di Nicola", "expiresAt": 1793788800000 } }
```

`name` e `days` sono opzionali. **Il token si vede una volta sola**: dopo la
risposta, di lui resta soltanto l'impronta.

Un pairing riuscito **scrive su disco**: aggiunge la voce del dispositivo a
`settings.security.devices` dentro `deck.json`, lo stesso file che contiene i
profili. Non c'e' un archivio separato delle credenziali, quindi un accoppiamento
di prova lascia una traccia permanente nel file di configurazione: se `deck.json`
sta in un repository, quella traccia finisce in un commit. Il token vero non c'e'
— solo `hash`, l'impronta SHA-256, dalla quale non si risale alla credenziale —
ma il dispositivo resta valido finche' non lo si revoca:

```bash
node bin/wdeck.mjs --list-devices
node bin/wdeck.mjs --revoke-device d-1a2b3c4d5e
```

Il pairing e' l'unica operazione che tocca `deck.json` da sola: il semplice
avvio dell'host, comprese le letture di stato, non riscrive il file.

Il PIN e' in `settings.security.pin`; se vuoto, il pairing e' disabilitato e
`POST /api/pair` risponde `401`. I tentativi sono limitati (vedi sezione 2).

### `GET /api/pair/qr`

QR code da inquadrare col telefono: contiene l'URL del deck con dentro un token
gia' valido, quindi apre l'app **gia' collegata**, senza digitare indirizzo ne'
PIN.

```json
{
  "ok": true,
  "url": "http://192.168.1.79:8899/?token=...",
  "device": { "id": "d-1a2b3c4d5e", "name": "accoppiato con QR", "expiresAt": null },
  "mdns": "http://wdeck-host.local:8899/",
  "svg": "<svg ...>"
}
```

Ogni chiamata crea un **token dedicato**, non consegna quello principale:
mostrare il codice a qualcuno che passa non deve regalargli la chiave di casa,
e cio' che e' stato inquadrato una volta si revoca da solo. Con `?device=0` si
usa invece il token principale, `?name=` e `?days=` governano il dispositivo
creato.

Il QR e' generato dal progetto ([`shared/qr.mjs`](../shared/qr.mjs)): modalita'
byte, versioni 1-10, correzione a scelta. Nessuna libreria.

### Scoperta in rete locale (mDNS)

Con `settings.discovery.enabled` (predefinito) l'host si annuncia su
224.0.0.251:5353 come:

| record | contenuto |
|---|---|
| `A` | `<nome>.local` -> indirizzi IPv4 della macchina |
| `PTR` | `_wdeck._tcp.local` -> istanza del servizio |
| `SRV` | porta e nome host dell'istanza |
| `TXT` | `path`, `scheme`, `version`, `deck` |

Serve a una cosa concreta: `http://wdeck-host.local:8899` **non cambia** quando
il router riassegna gli indirizzi, e macOS, iOS, Windows 10+ e Android recente
lo risolvono senza installare nulla. Il nome si imposta con
`settings.discovery.name`.

L'annuncio non parte quando l'host e' in ascolto solo su `127.0.0.1`, e se la
porta 5353 e' gia' occupata (Bonjour, avahi) l'host lo segnala e prosegue senza.

### `GET /api/devices`

```json
{
  "ok": true,
  "deviceTokenDays": null,
  "current": "d-1a2b3c4d5e",
  "devices": [
    { "id": "d-1a2b3c4d5e", "name": "Telefono di Nicola", "createdAt": 1786012800000, "expiresAt": null, "expired": false, "lastSeenAt": 1786013000000 }
  ]
}
```

`current` e' l'id del dispositivo che sta facendo la richiesta (`null` se sta
usando il token principale): serve al client per avvisare prima che qualcuno
revochi se stesso.

### `POST /api/devices`

`{ "name": "ESP32 salotto", "days": 365 }` crea un token senza passare dal PIN:
un microcontrollore non sa digitarlo. Restituisce il token una volta sola.

### `DELETE /api/devices?id=<id>`

Revoca il dispositivo. I client collegati con quella credenziale vengono
**scollegati subito**: una revoca che lasciasse la sessione aperta fino alla
disconnessione non sarebbe una revoca.

### `POST /api/token/rotate`

Rigenera il token principale e lo restituisce. Con `{ "revokeDevices": true }`
revoca anche tutti i dispositivi. Senza, i dispositivi accoppiati restano
validi: ruotare la chiave di casa non deve buttare fuori chi ha gia' la sua.

Le stesse operazioni si fanno **senza avviare l'host**, che e' cio' che serve
quando il token e' andato perduto:

```bash
node bin/wdeck.mjs --rotate-token
node bin/wdeck.mjs --list-devices
node bin/wdeck.mjs --add-device "ESP32 salotto" --days 365
node bin/wdeck.mjs --revoke-device d-1a2b3c4d5e
node bin/wdeck.mjs --prune-devices
```

### Cifratura del trasporto

Con `settings.server.tls.enabled` (o `--tls`, o `WDECK_TLS=1`) l'host serve
**HTTPS e WSS** invece di HTTP e WS. Senza, il token viaggia in chiaro dentro
l'URL che si apre sul telefono, e chiunque sia sulla stessa rete Wi-Fi puo'
leggerlo.

Chiave e certificato vengono generati al primo avvio in `.wdeck-tls/` accanto a
`deck.json`, e rigenerati quando scadono o quando cambiano gli indirizzi della
macchina (rete diversa, VPN, dock). Il certificato copre `localhost`, `127.0.0.1`
e ogni indirizzo IPv4 della macchina.

**Non e' fidato da nessuna autorita'**: il browser mostra un avviso la prima
volta, da accettare una volta sola per dispositivo. Serve a cifrare, non a
dimostrare l'identita' dell'host. Chi ha un certificato vero lo indica con
`certFile` e `keyFile`, e l'host non genera nulla:

```json
"server": { "tls": { "enabled": true, "certFile": "mio.crt", "keyFile": "mio.key", "days": 825 } }
```

---

## 2. Endpoint REST (dialetto full)

Tutti gli endpoint restituiscono JSON. In caso di errore il formato e' sempre:

```json
{ "ok": false, "error": { "code": "unauthorized", "message": "token mancante o non valido" } }
```

Codici possibili: `unauthorized`, `bad_request`, `not_found`, `forbidden`,
`action_failed`, `unsupported_action`, `rate_limited`, `internal`.

### Limiti di frequenza

Due limiti indipendenti, entrambi a finestra scorrevole:

| limite | predefinito | si applica a |
|---|---|---|
| comandi | 60 ogni 10 s | `POST /api/press`, `POST /api/lite/press`, messaggio WebSocket `press` |
| tentativi di accesso | 10 ogni 5 min | `POST /api/pair`, token rifiutati su qualunque rotta, messaggio WebSocket `auth` |

Superato il limite la risposta e' `429` con codice `rate_limited` e l'header
`Retry-After` in secondi; sul WebSocket arriva un messaggio `error` con lo
stesso codice, e il canale `auth` viene chiuso.

I due contatori **non sono separabili**: anche un token rifiutato conta come
tentativo di accesso, altrimenti il limite sul PIN si aggirerebbe provando
direttamente i token. Un accesso riuscito azzera i tentativi di quell'indirizzo.

Si tarano da `settings.security.rateLimit`:

```json
{ "enabled": true, "press": { "windowMs": 10000, "max": 60 }, "auth": { "windowMs": 300000, "max": 10 } }
```

### `GET /api/health`

Pubblico (nessun token). Serve alla scoperta dell'host e alla diagnostica.

```json
{
  "ok": true,
  "name": "Wdeck Host",
  "deckName": "Wdeck",
  "version": "0.1.0",
  "protocol": 1,
  "liteProtocol": 1,
  "platform": "win32",
  "requiresToken": true,
  "pinPairing": true,
  "dryRun": false,
  "uptimeMs": 51234
}
```

### `POST /api/pair`

Pubblico. Scambia un PIN valido con il token (vedi sezione 1).

### `GET /api/deck`

Layout completo. **Non contiene mai** token, PIN o whitelist: i dati sensibili
sono rimossi da `publicDeck()`.

```json
{
  "ok": true,
  "protocol": 1,
  "deck": {
    "version": 1,
    "name": "Wdeck",
    "defaultProfile": "default",
    "ui": { "theme": "dark", "accent": "#4c8dff", "showLabels": true },
    "profiles": [
      {
        "id": "default",
        "name": "Scrivania",
        "defaultPage": "main",
        "pages": [
          {
            "id": "main",
            "name": "Principale",
            "rows": 3,
            "cols": 5,
            "buttons": [
              {
                "id": "media-playpause",
                "label": "Play/Pausa",
                "row": 0, "col": 1,
                "icon": "play",
                "color": "#1f6feb",
                "textColor": null,
                "action": { "type": "media", "params": { "key": "playpause" } },
                "holdAction": null
              }
            ]
          }
        ]
      }
    ]
  },
  "state": { "...": "vedi /api/state" }
}
```

### `GET /api/state`

```json
{
  "ok": true,
  "state": {
    "activeProfile": "default",
    "activePage": "main",
    "dryRun": false,
    "clients": 2,
    "pressCount": 17,
    "lastAction": { "buttonId": "mute", "type": "media", "ok": true, "dryRun": false, "detail": "...", "error": null, "at": 1765432100000 },
    "uptimeMs": 51234,
    "deckName": "Wdeck",
    "platform": "win32"
  }
}
```

### `GET /api/status`

Stato **reale** dei controlli, letto dal sistema e non dedotto dalle pressioni:
e' cio' che permette al bottone del muto di sapere di essere muto anche quando
il volume viene cambiato da un'altra applicazione.

```json
{
  "ok": true,
  "states": {
    "mute": { "on": true, "level": 34, "text": "muto", "at": 1786012800000 },
    "slider-volume": { "on": null, "level": 34, "text": null, "at": 1786012800000 },
    "obs-scena": { "on": false, "level": null, "text": "Pausa", "at": 1786012800000 },
    "obs-rec": { "on": null, "level": null, "text": null, "error": "OBS non raggiungibile", "at": 1786012800000 }
  }
}
```

| campo | significato |
|---|---|
| `on` | `true`/`false` per i controlli a due stati, `null` se non ne hanno uno |
| `level` | livello 0..100 per volume, microfono, luminosita' |
| `text` | etichetta breve gia' pronta (`muto`, `LIVE`, nome della scena in onda) |
| `error` | presente solo se la lettura e' fallita (servizio spento, piattaforma non supportata) |
| `at` | istante della lettura |

Con `?refresh=1` la lettura viene rifatta subito invece di usare la cache.

Solo i controlli della **pagina attiva** vengono interrogati, e solo mentre c'e'
almeno un client collegato. Un controllo con `"status": false` in `deck.json`
non viene mai interrogato. **In dry-run l'host non legge nulla dal sistema**,
quindi la mappa resta vuota: la promessa "in dry-run non tocco il PC" vale anche
per le letture.

### `GET /api/actions`

Elenco del registro azioni (utile per costruire editor di configurazione).

```json
{ "ok": true, "actions": [ { "type": "media", "title": "Tasti multimediali", "description": "...", "platforms": ["win32"], "paramsHelp": { "key": "playpause | next | ..." }, "stub": false } ] }
```

### `POST /api/press`

```json
{ "buttonId": "media-playpause", "profileId": "default", "pageId": "main", "hold": false, "dryRun": false }
```

Solo `buttonId` e' obbligatorio. `profileId`/`pageId` restringono la ricerca
(utile se si vuole essere certi del contesto). `hold: true` usa `holdAction`
quando definita.

> **Regola di sicurezza**: `dryRun` puo' solo rendere l'esecuzione *piu'*
> prudente. Se l'host e' in dry-run, nessun client puo' disattivarlo.

Risposta:

```json
{
  "ok": true,
  "result": {
    "ok": true,
    "buttonId": "media-playpause",
    "profileId": "default",
    "pageId": "main",
    "label": "Play/Pausa",
    "type": "media",
    "description": "tasto media \"playpause\"",
    "dryRun": true,
    "detail": "invierebbe VK 0xb3 (playpause)",
    "result": { "ok": true, "simulated": true, "script": "..." },
    "error": null,
    "durationMs": 3,
    "source": "rest"
  }
}
```

Codici HTTP: `200` eseguito, `400` parametri non validi, `401` senza token,
`403` bloccato dalla whitelist, `404` bottone inesistente, `501` azione non
supportata sulla piattaforma, `500` errore interno.

### `POST /api/reload`

Rilegge `deck.json` da disco. Se il file non e' valido la configurazione
precedente resta attiva e la risposta e' `400` con l'elenco degli errori.

### `POST /api/deck/save`

Salva una configurazione modificata dall'editor visuale.

```json
{ "deck": { "version": 1, "profiles": [ ... ] } }
```

Il corpo viene fuso con **il file cosi' com'e' su disco** - non con il deck in
memoria - poi validato per intero e scritto in modo atomico; la versione
precedente resta in `.wdeck-backup/`. La distinzione conta: il deck in memoria
porta con se' gli override di `--port`, `--token` e delle variabili `WDECK_*`,
e salvarlo li renderebbe permanenti.

Il blocco `settings.security` **non e' modificabile da qui**: token, PIN e
whitelist non transitano mai per il client.

Da questo endpoint passano tutte le modifiche dell'editor visuale: bottoni e
cursori, creazione ed eliminazione di pagine e profili, spostamento dei
controlli, dimensione della griglia. Non ci sono endpoint separati perche' non
servono: la validazione e' la stessa per tutti, ed e' quella che impedisce di
lasciare un profilo senza pagine, un `navigate` senza destinazione o due
controlli sulla stessa cella. Con una configurazione non valida
risponde `400` con `errors[]` (`path` e `message` per ogni problema) e il file
su disco non viene toccato.

Al salvataggio riuscito l'host rimanda a tutti i client collegati il messaggio
WebSocket `deck` aggiornato.

### `GET /api/settings`

Restituisce le impostazioni modificabili. Del blocco sicurezza espone solo la
forma (`pinConfigured`, `pinLength`, `requireToken`, `allowExec`), mai i valori
segreti.

### `POST /api/settings`

Aggiorna a caldo PIN, tema, preferenze di aggiornamento e icona nella barra:

```json
{ "pin": "135790", "ui": { "accent": "#4c8dff" }, "updates": { "check": true } }
```

Il PIN accetta da 4 a 12 cifre, oppure la stringa vuota per disattivare il
pairing. I dispositivi gia' associati restano collegati: cambia solo cio' che
serve per associarne di nuovi. Il token non si cambia da qui, perche'
scollegherebbe ogni client.

### `GET /api/audit`

Ultime voci del registro persistente delle azioni, dalla piu' recente.
Parametri: `limit` (1..1000, default 100) e `event` per filtrare.

```json
{
  "ok": true,
  "enabled": true,
  "file": "C:\Users\nicola\AppData\Local\Wdeck\wdeck-audit.log",
  "entries": [
    { "at": 1786012800000, "event": "press", "buttonId": "mute", "type": "media", "ok": true, "dryRun": false, "source": "ws", "durationMs": 120, "detail": "inviato tasto media \"mute\"", "error": null, "device": "d-1a2b3c4d5e", "address": "192.168.1.5" },
    { "at": 1786012700000, "event": "pair", "address": "192.168.1.5", "device": "d-1a2b3c4d5e", "name": "Telefono di Nicola" }
  ]
}
```

Eventi registrati: `press`, `pair`, `pair-failed`, `device-created`,
`device-revoked`, `token-rotated`, `rate-limited`.

Il file e' JSONL accanto a `deck.json` (`wdeck-audit.log`), ruotato a 1 MB con
tre copie conservate. **Token, PIN e password non ci finiscono mai**: i campi
con quei nomi sono sostituiti da `[omesso]` prima della scrittura, anche dentro
i parametri liberi di un'azione. Gli identificatori dei dispositivi si', perche'
sono esattamente cio' che serve per sapere chi ha fatto cosa.

Si configura da `settings.security.audit`:

```json
{ "enabled": true, "file": "wdeck-audit.log", "maxBytes": 1048576, "keep": 3 }
```

### `GET /api/icons`

Icone personalizzate caricate dall'utente. Stanno in `icons/` **accanto** a
`deck.json`, non dentro: una manciata di PNG in base64 renderebbe il file di
configurazione illeggibile e impossibile da modificare a mano.

```json
{
  "ok": true,
  "icons": [
    { "name": "mio-logo", "ext": "png", "contentType": "image/png", "bytes": 4210, "ref": "custom:mio-logo", "usedBy": ["btn-stream"] }
  ],
  "limits": { "maxBytes": 196608, "maxCount": 64, "formats": { "png": "image/png", "...": "..." } }
}
```

Un controllo la usa scrivendo `"icon": "custom:mio-logo"`.

### `POST /api/icons`

```json
{ "name": "mio-logo", "content": "data:image/png;base64,iVBORw0KGgo..." }
```

Il nome e' uno slug (`^[a-z0-9][a-z0-9-]{0,31}$`); `content` accetta un data URL
o base64 grezzo. Il **formato viene riconosciuto dai byte**, non da quanto
dichiara il client: sono ammessi PNG, JPEG, WebP, GIF e SVG, fino a 192 KB
ciascuna e 64 in tutto.

Gli SVG passano da una pulizia che rimuove `<script>`, `<foreignObject>`, i
gestori di evento `on*`, gli URL `javascript:` e i riferimenti esterni; se dopo
la pulizia resta qualcosa di eseguibile, il caricamento e' rifiutato.

### `DELETE /api/icons?name=<slug>`

Elimina un'icona. Se e' ancora usata da qualche controllo risponde `409` con
l'elenco `usedBy`; ripetere con `&force=1` per eliminarla comunque.

### `GET /api/icons/file?name=<slug>`

Il file dell'icona. Richiede il token, che qui puo' stare solo in querystring
perche' un tag `<img>` non puo' portare header. Servito con
`X-Content-Type-Options: nosniff` e una `Content-Security-Policy` restrittiva:
difesa in profondita' sugli SVG, che sono gia' ripuliti al caricamento.

### `GET /api/update`

Stato del controllo aggiornamenti. Con `?check=1` interroga subito le release
di GitHub invece di restituire l'ultimo risultato in cache.

```json
{
  "ok": true,
  "update": {
    "checkedAt": 1786012800000,
    "available": true,
    "current": "0.2.0",
    "latest": { "version": "0.3.0", "url": "https://github.com/...", "notes": "...", "asset": { "name": "wdeck-0.3.0.zip" } },
    "error": null
  },
  "selfUpdate": { "supported": true, "reason": null }
}
```

`selfUpdate` dice se questa installazione sa sostituirsi da sola. E' vero solo
per `wdeck.exe` su Windows; dai sorgenti `reason` spiega che si aggiorna con
`git pull`, e il client mostra quella frase invece del pulsante.

### `POST /api/update/apply`

Scarica l'ultima release, **verifica l'impronta** e mette il nuovo eseguibile al
posto di quello in esecuzione, poi riavvia.

```json
{ "ok": true, "version": "0.5.0", "from": "0.4.0", "sha256": "2278822a...", "backup": "C:\\Wdeck\\wdeck.exe.vecchio" }
```

Tre cose che questo endpoint fa e che vale la pena sapere:

- **Non parte mai da solo.** Il controllo periodico segnala e basta; si scarica
  soltanto quando qualcuno con un token valido chiama qui. La differenza fra
  "ti avviso" e "mi sostituisco mentre esegui comandi sul tuo PC" e' la ragione
  per cui sono due cose separate.
- **Verifica lo SHA-256** contro `SHA256SUMS.txt` pubblicato accanto alla
  release. Se il file non c'e', o l'impronta non corrisponde, l'aggiornamento si
  ferma **prima** di toccare l'eseguibile in uso e risponde `500`. Ci si
  fiderebbe altrimenti solo del TLS.
- **Tiene la versione precedente** come `wdeck.exe.vecchio`, cancellata al primo
  avvio andato a buon fine. Se la nuova non parte, si rinomina indietro.

| risposta | quando |
|---|---|
| `409 forbidden` | si sta girando dai sorgenti, o non su Windows |
| `409 bad_request` | si e' gia' all'ultima versione |
| `502 internal` | GitHub non risponde |
| `500 internal` | impronta mancante o diversa, o download fallito |
| `429 rate_limited` | vale il limite dei tentativi di accesso |

Ogni esito, riuscito o no, finisce nel registro di audit (`update-applied`,
`update-failed`) con chi l'ha chiesto e da dove.

L'host non scarica e non installa nulla: si limita a segnalarlo. Quando un
aggiornamento compare, i client ricevono anche l'evento WebSocket
`{ "type": "event", "event": "update" }`.

---

## 3. WebSocket full - `/ws`

Il token puo' essere passato nell'handshake (`/ws?token=...`) oppure inviato
come primo messaggio. Senza autenticazione entro **8 secondi** la connessione
viene chiusa con codice `1008`.

### Messaggi host -> client

| `type` | contenuto | quando |
|---|---|---|
| `hello` | `protocol`, `name`, `requiresToken`, `authenticated` | subito dopo la connessione |
| `auth-ok` | `protocol` | autenticazione riuscita |
| `deck` | `deck`, `state` | dopo `auth-ok` e a ogni ricarica di `deck.json` |
| `state` | `state` | a ogni variazione (pressioni, client, dry-run) |
| `status` | `states`, `changed` | stato reale dei controlli: dopo `auth-ok`, dopo ogni pressione e a ogni variazione letta dal sistema |
| `navigate` | `activeProfile`, `activePage` | cambio pagina/profilo |
| `ack` | `requestId`, `ok`, `result` | risposta a `press` / `navigate` / `reload` |
| `event` | `event: "press"`, `data` | notifica broadcast di una pressione |
| `error` | `code`, `message`, `requestId?` | errore applicativo |
| `pong` | `requestId`, `ts` | risposta a `ping` |

### Messaggi client -> host

| `type` | campi | note |
|---|---|---|
| `auth` | `token` | obbligatorio se il token non e' nell'URL |
| `press` | `buttonId`, `profileId?`, `pageId?`, `hold?`, `dryRun?`, `requestId?` | risponde con `ack` |
| `navigate` | `profile?`, `page?`, `requestId?` | risponde con `ack` |
| `reload` | `requestId?` | ricarica `deck.json` |
| `ping` | `requestId?` | risponde con `pong` |

Esempio di sessione completa:

```
client -> ws://192.168.1.10:8899/ws
host   <- {"type":"hello","protocol":1,"name":"Wdeck Host","requiresToken":true,"authenticated":false}
client -> {"type":"auth","token":"abc123"}
host   <- {"type":"auth-ok","protocol":1}
host   <- {"type":"deck","deck":{...},"state":{...}}
host   <- {"type":"state","state":{...}}
host   <- {"type":"status","states":{"mute":{"on":false,"level":34,"text":null}}}
client -> {"type":"press","buttonId":"mute","requestId":"r1"}
host   <- {"type":"ack","requestId":"r1","ok":true,"result":{...}}
host   <- {"type":"event","event":"press","data":{...}}
host   <- {"type":"status","states":{"mute":{"on":true,"level":34,"text":"muto"}},"changed":{"mute":{"on":true}}}
```

`states` e' sempre la mappa completa; `changed` contiene le sole voci variate
(`null` come valore = stato non piu' disponibile), utile per animare solo cio'
che e' cambiato.

Il server invia un `ping` di controllo ogni 30 secondi; i client che non
rispondono con `pong` vengono chiusi.

---

## 4. Protocollo lite (ESP32)

Pensato per dispositivi con poca RAM: chiavi JSON di **un solo carattere**,
nessun dato superfluo, layout di una pagina tipicamente sotto 1 KB.

### Nomi di campo

| campo logico | chiave | tipo | note |
|---|---|---|---|
| version | `v` | intero | versione del protocollo lite |
| profile | `f` | stringa | id profilo |
| page | `p` | stringa | id pagina |
| rows | `r` | intero | righe della griglia |
| cols | `c` | intero | colonne della griglia |
| buttons | `b` | array | bottoni della pagina |
| id | `i` | stringa | id bottone |
| label | `l` | stringa | etichetta |
| col | `x` | intero | colonna del bottone |
| row | `y` | intero | riga del bottone |
| color | `g` | stringa | `#rrggbb`, opzionale |
| icon | `n` | stringa | nome icona, opzionale |
| type | `t` | stringa | tipo azione oppure tipo messaggio |
| ok | `k` | 0/1 | esito |
| error | `e` | stringa | codice errore |
| message | `m` | stringa | messaggio leggibile |
| timestamp | `s` | intero | millisecondi dell'host |
| pages | `q` | array | id delle pagine del profilo |
| dryRun | `d` | 0/1 | host in dry-run |
| states | `w` | oggetto | id bottone -> 0/1: stato reale dei controlli a due stati |

### Tipi di messaggio (campo `t`)

| significato | valore | direzione |
|---|---|---|
| hello | `h` | host -> device |
| auth | `u` | riservato (token gia' nell'URL) |
| authOk | `k` | riservato |
| state | `s` | host -> device |
| press | `p` | device -> host |
| ack | `a` | host -> device |
| error | `e` | host -> device |
| ping | `i` | device -> host |
| pong | `o` | host -> device |
| navigate | `n` | host -> device |
| status | `z` | host -> device |

### `GET /api/lite/deck`

Parametri opzionali: `profile`, `page` (default: quelli attivi sull'host).

```json
{
  "v": 1, "f": "default", "p": "main", "r": 3, "c": 5, "d": 0,
  "q": ["main", "utility"],
  "b": [
    { "i": "media-prev", "l": "Prev", "x": 0, "y": 0, "g": "#2d3b55", "n": "prev", "t": "media" },
    { "i": "media-playpause", "l": "Play/Pausa", "x": 1, "y": 0, "g": "#1f6feb", "n": "play", "t": "media" }
  ]
}
```

I **parametri** delle azioni non vengono mai inviati al dispositivo: il device
conosce solo id, posizione e aspetto.

### `GET /api/lite/state`

```json
{ "v": 1, "f": "default", "p": "main", "d": 0, "s": 1765432100000 }
```

### `POST /api/lite/press`

Richiesta `{ "i": "media-playpause" }` -> risposta:

```json
{ "v": 1, "i": "media-playpause", "k": 1, "m": "inviato tasto media \"playpause\"", "d": 0 }
```

### WebSocket lite - `/ws/lite`

Il token e' **obbligatorio nell'handshake**: `ws://host:8899/ws/lite?token=abc123`.
Senza token l'upgrade viene rifiutato con `HTTP 401` (nessuna finestra di grazia:
un microcontrollore non deve gestire stati intermedi).

```
device -> ws://192.168.1.10:8899/ws/lite?token=abc123
host   <- {"t":"h","v":1,"f":"default","p":"main","d":0}
host   <- {"t":"s","v":1,"f":"default","p":"main","d":0,"s":1765432100000}
host   <- {"t":"z","v":1,"w":{"mute":0}}             (stato: il muto e' spento)
device -> {"t":"p","i":"mute"}
host   <- {"t":"a","i":"mute","k":1,"m":"inviato tasto media \"mute\""}
host   <- {"t":"z","v":1,"w":{"mute":1}}             (stato: ora e' acceso)
host   <- {"t":"n","f":"default","p":"utility"}      (cambio pagina: riscaricare il layout)
device -> {"t":"i"}
host   <- {"t":"o","s":1765432100000}
```

Il messaggio di stato porta solo `id -> 0|1`: livelli ed etichette restano al
dialetto full, perche' un microcontrollore non ha spazio per tenerli. I bottoni
assenti dalla mappa hanno stato sconosciuto e vanno disegnati senza spia.

### Come implementare un nuovo dispositivo

1. `GET /api/lite/deck?token=...` -> disegnare la griglia `r` x `c` usando `x`/`y`.
2. Aprire `/ws/lite?token=...` e restare in ascolto.
3. Su tocco inviare `{"t":"p","i":"<id>"}` e mostrare l'esito dell'`ack` (`k`).
4. Su `{"t":"n",...}` riscaricare il layout della nuova pagina.
5. Su `{"t":"z","w":{...}}` aggiornare l'aspetto dei bottoni accesi.
6. Inviare `{"t":"i"}` ogni ~20 s per tenere viva la connessione.

---

## 5. Compatibilita' e versioning

- `v` / `protocol` sono numeri interi: un client deve rifiutarsi di funzionare
  se riceve una versione maggiore di quella che conosce;
- l'aggiunta di **nuovi campi opzionali** non incrementa la versione;
- la modifica o rimozione di campi esistenti **incrementa** la versione;
- il firmware ESP32 controlla `v` all'avvio e mostra "protocollo incompatibile"
  sul display se non coincide.
