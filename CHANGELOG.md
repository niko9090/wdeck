# Changelog

Formato ispirato a [Keep a Changelog](https://keepachangelog.com/it/1.1.0/).
Il progetto segue il [versionamento semantico](https://semver.org/lang/it/).

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
