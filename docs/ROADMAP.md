# Stato del lavoro e roadmap

Documento di consegna del **lavoro semi-finito**: dice con precisione cosa
funziona, cosa e' dichiaratamente un segnaposto e cosa non esiste ancora,
cosi' da poter decidere insieme dove investire il prossimo giro.

Ultimo aggiornamento: 2026-08-13 - versione `0.2.6`.

Legenda: **Completo** = implementato e coperto da test - **Stub** = presente ma
volutamente incompleto - **Mancante** = non esiste.

---

## Completo

### Host (Node.js 22, zero dipendenze runtime)

- Server HTTP + WebSocket su un'unica porta, **senza alcun pacchetto npm**:
  il framing WebSocket RFC 6455 e' implementato in
  [`src/host/ws/`](../src/host/ws/) (server, client e parser di frame).
- API REST completa: `/api/health`, `/api/pair`, `/api/deck`, `/api/state`,
  `/api/status`, `/api/actions`, `/api/press`, `/api/reload`
  (vedi [PROTOCOL.md](PROTOCOL.md)).
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

### Windows, macOS e Linux

`media`, `hotkey`, `text`, `url`, `volume` e `mic` funzionano su tutte e tre le
piattaforme. Gli handler parlano con la facciata
[`src/host/platform/input.mjs`](../src/host/platform/input.mjs), che sceglie
l'adattatore: PowerShell su Windows (invariato), `osascript` su macOS,
`xdotool`/`ydotool` con `pactl`/`amixer` e `playerctl` su Linux. Quando uno
strumento manca l'errore dice quale pacchetto installare. L'azione `script`
esegue anche i file `.sh`.

### Sicurezza di base

- Token obbligatorio (query, header `x-wdeck-token` o `Bearer`), confronto a
  tempo costante, generazione automatica se non configurato.
- **Token per dispositivo**: il pairing con PIN crea una credenziale dedicata,
  revocabile da sola e con scadenza facoltativa. Nel file resta la sola
  impronta SHA-256. Revocare scollega subito i client interessati.
- **Rotazione del token principale** da client, endpoint e riga di comando
  (`--rotate-token`, `--list-devices`, `--add-device`, `--revoke-device`,
  `--prune-devices`), anche a host spento.
- Una revoca scritta a mano in `deck.json` vale alla ricarica a caldo, senza
  riavviare l'host.
- Whitelist `allowExec` (glob `*` e `**`) + whitelist di estensioni: a
  whitelist vuota **non si esegue nulla**; il path traversal e' neutralizzato.
- Whitelist degli schemi URL.
- **Limiti di frequenza** a finestra scorrevole su comandi (60 / 10 s) e
  tentativi di accesso (10 / 5 min), con codice `rate_limited` e `Retry-After`.
  I token rifiutati contano come tentativi di accesso: i due contatori non sono
  separabili, altrimenti il limite sul PIN si aggirerebbe provando i token.
- Dry-run globale che **nessun client puo' disattivare** (puo' solo attivarlo).
- Bind configurabile (`0.0.0.0` per la LAN, `127.0.0.1` per il solo locale).
- Il layout servito ai client non contiene mai token, PIN o whitelist.

### Stato reale dei controlli

- Gli handler dichiarano `readState()` e l'host legge la condizione vera dal
  sistema: muto acceso, scena OBS in onda, registrazione o diretta attive, luce
  Hue accesa, livello di volume e luminosita'. Copre `volume`, `mic`,
  `brightness`, `media`, `obs`, `hue`.
- Pubblicato su `GET /api/status`, sul messaggio WebSocket `status` e, in forma
  compatta (`id -> 0|1`), sul canale lite: anche l'ESP32 disegna i bottoni accesi.
- Costo tenuto basso di proposito: si interrogano solo i controlli della pagina
  attiva, solo con client collegati, con letture messe in comune e pausa di un
  minuto sui servizi che non rispondono. In dry-run non si legge nulla.

### Editor visuale

- Modifica completa dal client, senza toccare `deck.json`: controlli (azione,
  parametri, icona, colore, larghezza), **creazione ed eliminazione di pagine e
  profili**, rinomina, riordino, dimensione della griglia, profilo e pagina
  iniziali, **spostamento dei controlli per trascinamento**.
- **Icone personalizzate** caricate dall'utente (PNG, JPEG, WebP, GIF, SVG):
  stanno in `icons/` accanto a `deck.json` e si usano come `custom:nome`. Il
  formato e' riconosciuto dai byte e gli SVG sono ripuliti da script, gestori di
  evento e riferimenti esterni.
- Tutto passa da `POST /api/deck/save`, quindi dalla stessa validazione: una
  modifica che romperebbe la configurazione viene rifiutata con la ragione, e la
  versione precedente resta in `.wdeck-backup/`.

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

### Test automatici e integrazione continua

| comando | contenuto | verifiche |
|---|---|---|
| `npm test` | file di test unitari/integrazione | 306 |
| `npm run smoke` | end-to-end su host reale | 46 |
| `npm run test:esp32` | conformita' firmware <-> protocollo | 111 |
| `npm run build` | build PWA con verifica dei file prodotti | - |
| `npm run check:docs` | coerenza della documentazione | - |
| `npm run check:deps` | vincolo di zero dipendenze | - |

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) esegue `npm run verify`
a ogni push e pull request su Linux, Windows e macOS, con Node 20.10 e 22.

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

---

## Mancante (non esiste ancora)

### Piattaforme

- **Luminosita' su macOS e Linux**: `brightness` resta dichiarata solo per
  Windows. Su macOS non e' pilotabile senza un binario nativo (le API sono
  private) e su Linux dipende dal driver grafico; dichiararla supportata
  darebbe un errore a ogni pressione invece del `501` chiaro di oggi.
- **Finestre, desktop virtuali, appunti, screenshot, notifiche, alimentazione**
  restano azioni solo-Windows: ognuna richiederebbe un adattatore per ambiente
  desktop (GNOME, KDE, Aqua) e non un solo comando come per tasti e volume.
- Nessun servizio Windows vero e proprio. Non e' una dimenticanza: un servizio
  gira nella sessione 0 e da li' non puo' inviare tasti ne' portare finestre in
  primo piano nella sessione dell'utente, quindi meta' delle azioni smetterebbe
  di funzionare. L'avvio automatico al login (`install.ps1 -Autostart`) ottiene
  lo stesso risultato pratico senza quel limite.

### Sicurezza

- Nessun HTTPS/WSS: il traffico in LAN e' in chiaro (token compreso).
- Nessun audit log persistente delle azioni eseguite.

### Funzionalita'

- Luminosita': su un PC con HDR attivo e monitor che rifiutano DDC/CI nessuno
  dei tre metodi funziona, e l'azione fallisce con un messaggio esplicito.
  Servirebbe un overlay di attenuazione, che e' un processo in piu' da tenere
  vivo.
- Integrazioni MQTT, Spotify e Discord ancora assenti (OBS, Home Assistant e
  Hue ci sono).
- L'aggiornamento viene segnalato ma non applicato: il download e la
  sostituzione dei file restano a carico dell'utente.
- Nessuna scoperta automatica dell'host (mDNS/Bonjour) ne' QR code per il pairing.
- Nessuna localizzazione: interfaccia e messaggi solo in italiano.
- Nessun bundling/minificazione del JavaScript della PWA (viene servito come
  moduli ES; solo il CSS e' minificato).

### Qualita'

- Nessun test su hardware ESP32 reale, nessun test del client web in browser
  (niente Playwright/Puppeteer): la PWA e' verificata solo lato server.
- Nessuna misura di copertura del codice.

---

## Prossimi passi consigliati

In ordine di rapporto valore/costo, da decidere insieme:

1. **Provare il firmware su una scheda vera** e correggere pin/rotazione/touch:
   e' l'unico pezzo dichiaratamente non collaudato.
2. ~~**Feedback di stato sui bottoni** (toggle muto, scena OBS attiva).~~
   **fatto in 0.2.2.**
3. ~~**Adattatore Linux/macOS** per hotkey e tasti media.~~ **fatto in 0.2.3.**
4. ~~**Editor grafico del deck** completo nella PWA.~~ **fatto in 0.2.4.**
5. **Token per dispositivo + revoca**, con QR code per il pairing.
6. **HTTPS/WSS** con certificato autofirmato generato all'avvio.
7. **Integrazione OBS** al posto dell'azione `stub`.
8. ~~**CI** che esegua `npm run verify` a ogni commit.~~ **fatto in 0.2.1.**
