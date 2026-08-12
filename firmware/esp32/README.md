# Wdeck - firmware ESP32 (esempio)

Client hardware per l'host Wdeck: scarica il layout dall'host, disegna la griglia
su un display TFT e invia gli eventi di pressione tramite il **protocollo lite**
(vedi [`../../docs/PROTOCOL.md`](../../docs/PROTOCOL.md)).

> Stato: **esempio funzionante ma non collaudato su hardware**. Il codice compila
> concettualmente contro le librerie indicate e il suo aderire al protocollo e'
> verificato automaticamente da `npm run test:esp32`, ma non e' stato ancora
> provato su una scheda fisica. Vedi `docs/ROADMAP.md`.

## Hardware previsto

| Ambiente PlatformIO | Scheda | Display | Touch |
|---|---|---|---|
| `esp32-ili9341` (default) | ESP32 dev generico | ILI9341 320x240 SPI | XPT2046 (SPI condiviso, `TOUCH_CS=22`) |
| `esp32-cyd` | ESP32-2432S028R "cheap yellow display" | ILI9341 | XPT2046 (`TOUCH_CS=33`) |
| `esp32s3-st7789` | ESP32-S3 DevKitC-1 | ST7789 320x240 | nessuno |

## Compilazione

```bash
# una tantum: https://platformio.org/install/cli
cd firmware/esp32

# configurare rete/host/token (vedi sotto), poi:
pio run                       # compila l'ambiente predefinito
pio run -e esp32-cyd          # compila per un'altra scheda
pio run -t upload -t monitor  # flash + monitor seriale
```

## Configurazione

Due possibilita', equivalenti:

1. modificare i valori in `include/wdeck_config.h`;
2. (consigliato) passarli come `build_flags` in `platformio.ini`, cosi' le
   credenziali non finiscono nel repository:

```ini
build_flags =
    ${env.build_flags}
    -DWDECK_WIFI_SSID='"CasaMia"'
    -DWDECK_WIFI_PASS='"password"'
    -DWDECK_HOST_ADDR='"192.168.1.10"'
    -DWDECK_HOST_PORT=8899
    -DWDECK_TOKEN='"il-token-stampato-dall-host"'
```

Il token e' quello mostrato dall'host all'avvio (o il valore di
`settings.security.token` in `deck.json`).

## Come funziona

```
setup()
  connectWifi()
  fetchLayout()      GET /api/lite/deck?token=...   -> griglia disegnata
  connectWebSocket() ws://host:porta/ws/lite?token=...

loop()
  wsClient.loop()    riceve stato / navigazione / ack
  handleTouch()      tocco -> {"t":"p","i":"<id>"} -> ack -> lampeggio verde/rosso
  ping ogni 20 s
```

Se il WebSocket non e' disponibile il firmware ripiega su
`POST /api/lite/press` (stesso payload compatto).

## Vincoli di protocollo

`include/wdeck_protocol.h` e' il gemello C di `shared/protocol.mjs`.
**Non scrivere endpoint o chiavi JSON come stringhe letterali in `main.cpp`**:
usa sempre le macro. Il test automatico

```bash
npm run test:esp32
```

verifica che (a) i valori dell'header coincidano con quelli del modulo
JavaScript, (b) il sorgente usi le macro, (c) `platformio.ini` configuri
davvero un display, e (d) un host reale risponda correttamente agli
stessi URL e payload che il firmware costruisce.

## Limitazioni note

- nessun rendering delle icone: viene mostrata solo l'etichetta testuale
  (il campo `n`/icona viene scaricato ma non usato);
- nessuna gestione della pressione prolungata (`holdAction`);
- nessun pairing via PIN: il token va compilato prima della flash;
- solo HTTP/WS in chiaro (nessun TLS): usare esclusivamente in LAN fidata.
