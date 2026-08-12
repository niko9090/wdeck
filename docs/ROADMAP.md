# Stato del lavoro e roadmap

Documento di consegna del **lavoro semi-finito**: dice con precisione cosa
funziona, cosa e' dichiaratamente un segnaposto e cosa non esiste ancora,
cosi' da poter decidere insieme dove investire il prossimo giro.

Ultimo aggiornamento: 2026-08-12 - versione `0.1.0`.

Legenda: **Completo** = implementato e coperto da test - **Stub** = presente ma
volutamente incompleto - **Mancante** = non esiste.

---

## Completo

### Host (Node.js 22, zero dipendenze runtime)

- Server HTTP + WebSocket su un'unica porta, **senza alcun pacchetto npm**:
  il framing WebSocket RFC 6455 e' implementato in
  [`src/host/ws/`](../src/host/ws/) (server, client e parser di frame).
- API REST completa: `/api/health`, `/api/pair`, `/api/deck`, `/api/state`,
  `/api/actions`, `/api/press`, `/api/reload` (vedi [PROTOCOL.md](PROTOCOL.md)).
- Canale WebSocket full `/ws` con autenticazione, broadcast di stato,
  `ack` correlati da `requestId`, heartbeat ping/pong.
- Configurazione dichiarativa `deck.json` con **validazione propria**
  (tipi + controlli semantici: id univoci, celle non sovrapposte, target di
  navigazione esistenti) e **ricarica a caldo**; se la nuova configurazione e'
  invalida resta attiva la precedente.
- Registro azioni estensibile a plugin (`extraHandlers`, `override`).
- Dispatcher con dry-run, misura dei tempi, errori tipizzati.
- CLI `bin/wdeck.mjs` con `--dry-run`, `--port`, `--host`, `--token`,
  `--no-token`, `--no-watch`, `--config`, piu' le variabili `WDECK_*`.

### Azioni (12 tipi)

`media`, `hotkey`, `text`, `launch`, `script`, `url`, `http`, `sequence`,
`delay`, `navigate`, `noop`, `stub` - vedi [ADDING-ACTIONS.md](ADDING-ACTIONS.md).

L'input sintetico su Windows usa PowerShell con `keybd_event` (P/Invoke) per
tasti e hotkey e `WScript.Shell.SendKeys` per il testo: nessuna dipendenza
nativa da compilare. Gli script PowerShell sono passati con `-EncodedCommand`,
quindi non esistono problemi di quoting o injection dai parametri.

### Sicurezza di base

- Token obbligatorio (query, header `x-wdeck-token` o `Bearer`), confronto a
  tempo costante, generazione automatica se non configurato.
- Pairing tramite PIN (`POST /api/pair`).
- Whitelist `allowExec` (glob `*` e `**`) + whitelist di estensioni: a
  whitelist vuota **non si esegue nulla**; il path traversal e' neutralizzato.
- Whitelist degli schemi URL.
- Dry-run globale che **nessun client puo' disattivare** (puo' solo attivarlo).
- Bind configurabile (`0.0.0.0` per la LAN, `127.0.0.1` per il solo locale).
- Il layout servito ai client non contiene mai token, PIN o whitelist.

### Client web PWA

- Griglia responsive con proporzioni corrette su telefono, tablet e desktop.
- Profili (menu a tendina) e pagine (tab), sincronizzati fra i client.
- Icone vettoriali (22 glifi), colori per bottone, etichette opzionali.
- Feedback live: stato connessione, badge dry-run, ultima azione, lampeggio
  verde/rosso sul bottone, toast di errore, vibrazione su Android.
- Pressione prolungata (650 ms) -> `holdAction`.
- Riconnessione automatica con backoff esponenziale.
- Pairing con PIN dall'interfaccia, oppure token da URL (`?token=...`, che
  viene poi rimosso dalla cronologia) o inserito a mano.
- Modalita' schermo intero, installabile come app (manifest + service worker,
  app shell in cache; `/api` e `/ws` mai in cache).
- Build statica riproducibile: `npm run build` -> `dist/web/` con id di build,
  `asset-manifest.json` e verifica finale dei file attesi.

### Protocollo lite + ESP32

- Dialetto compatto documentato (chiavi di 1 carattere), REST + `/ws/lite`.
- Firmware di esempio PlatformIO/Arduino con TFT_eSPI, ArduinoJson e
  WebSockets: scarica il layout, disegna la griglia, invia le pressioni,
  ripiega su REST se il WebSocket cade, riconnette il Wi-Fi.
- Tre ambienti di scheda preconfigurati (ILI9341 generico, "cheap yellow
  display" ESP32-2432S028R, ESP32-S3 + ST7789).

### Test automatici

| comando | contenuto | verifiche |
|---|---|---|
| `npm test` | 8 file di test unitari/integrazione | 150 |
| `npm run smoke` | end-to-end su host reale | 36 |
| `npm run test:esp32` | conformita' firmware <-> protocollo | 109 |
| `npm run build` | build PWA con verifica dei file prodotti | - |
| `node scripts/check-docs.mjs` | coerenza della documentazione | - |

---

## Stub (presenti ma volutamente incompleti)

| elemento | stato attuale | cosa manca |
|---|---|---|
| azione `stub` | conferma la pressione e restituisce la nota configurata | e' il segnaposto per le integrazioni non ancora scritte (OBS, MQTT, Home Assistant): non esegue nulla |
| firmware ESP32 | codice completo e conforme al protocollo, verificato dai test | **non e' mai stato compilato ne' provato su hardware reale**: i pin dichiarati vanno verificati sulla scheda in uso |
| icone su ESP32 | il campo `n` viene scaricato ma ignorato | il display mostra solo l'etichetta testuale; servono glifi bitmap o LVGL |
| `holdAction` | supportata da host e client web | non supportata dall'ESP32; nessuna interfaccia per configurarla, va scritta a mano in `deck.json` |
| tema chiaro | CSS presente, attivo con `ui.theme: "auto"` + preferenza di sistema | `ui.theme: "light"` non forza ancora il tema chiaro |
| `ui.showLabels` | rispettato dal client web | ignorato dall'ESP32 |
| rotazione token | `auth.rotate()` esiste ed e' testata | non e' esposta da nessun endpoint o comando CLI |
| token e ricarica a caldo | `deck.json` si ricarica a caldo | un token modificato nel file richiede il riavvio dell'host (i client collegati non vengono invalidati a meta' sessione) |
| codice errore `rate_limited` | definito nel protocollo | nessun rate limiting implementato |

---

## Mancante (non esiste ancora)

### Piattaforme

- **macOS e Linux**: l'host parte e serve la PWA ovunque, ma `media`, `hotkey`,
  `text` e `url` sono implementate solo per Windows. Fuori da Windows queste
  azioni rispondono `501` con un messaggio esplicito (e restano provabili in
  dry-run). Servono adattatori: `osascript`/CGEvent su macOS, `xdotool`/`ydotool`
  o `uinput` su Linux.
- Nessun pacchetto di installazione, nessun avvio automatico, nessun servizio
  Windows, nessuna icona in area di notifica.

### Sicurezza

- Nessun HTTPS/WSS: il traffico in LAN e' in chiaro (token compreso).
- Nessun limite ai tentativi di PIN/token (brute force possibile) e nessun
  rate limiting sulle pressioni.
- Un solo token valido per tutti i client: niente identita' per dispositivo,
  niente revoca selettiva, niente scadenza.
- Nessun audit log persistente delle azioni eseguite.

### Funzionalita'

- Nessun editor grafico della configurazione: `deck.json` si modifica a mano
  (con l'aiuto di [`schema/deck.schema.json`](../schema/deck.schema.json)).
- Nessun caricamento di icone personalizzate (PNG/SVG dell'utente).
- Nessun feedback di stato *reale* sui bottoni (es. il tasto muto non sa se il
  sistema e' effettivamente muto): il protocollo lo prevede, la logica no.
- Nessuna integrazione pronta: OBS, Home Assistant, MQTT, Spotify, Discord.
- Nessuna scoperta automatica dell'host (mDNS/Bonjour) ne' QR code per il pairing.
- Nessuna localizzazione: interfaccia e messaggi solo in italiano.
- Nessun bundling/minificazione del JavaScript della PWA (viene servito come
  moduli ES; solo il CSS e' minificato).

### Qualita'

- Nessuna pipeline CI (i comandi vanno eseguiti a mano).
- Nessun test su hardware ESP32 reale, nessun test del client web in browser
  (niente Playwright/Puppeteer): la PWA e' verificata solo lato server.
- Nessuna misura di copertura del codice.

---

## Prossimi passi consigliati

In ordine di rapporto valore/costo, da decidere insieme:

1. **Provare il firmware su una scheda vera** e correggere pin/rotazione/touch:
   e' l'unico pezzo dichiaratamente non collaudato.
2. **Feedback di stato sui bottoni** (toggle muto, scena OBS attiva): e' cio'
   che distingue davvero uno Stream Deck da un telecomando.
3. **Adattatore Linux/macOS** per hotkey e tasti media: apre l'uso dell'host
   fuori da Windows (l'architettura e' gia' pronta, serve un modulo per piattaforma).
4. **Editor grafico del deck** nella PWA, sfruttando `GET /api/actions` che gia'
   descrive ogni azione e i suoi parametri.
5. **Token per dispositivo + revoca**, con QR code per il pairing.
6. **HTTPS/WSS** con certificato autofirmato generato all'avvio.
7. **Integrazione OBS** al posto dell'azione `stub`.
8. **CI** che esegua `npm run verify` a ogni commit.
