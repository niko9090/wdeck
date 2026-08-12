/*
 * wdeck_config.h - configurazione del firmware ESP32.
 *
 * Copiare i valori reali qui oppure passarli come -D in platformio.ini
 * (build_flags) per non salvare le credenziali nel repository.
 */

#ifndef WDECK_CONFIG_H
#define WDECK_CONFIG_H

/* ---------------------------- rete ---------------------------- */

#ifndef WDECK_WIFI_SSID
#define WDECK_WIFI_SSID "NOME-RETE-WIFI"
#endif

#ifndef WDECK_WIFI_PASS
#define WDECK_WIFI_PASS "PASSWORD-WIFI"
#endif

/* Indirizzo IP (o hostname) del PC su cui gira l'host Wdeck. */
#ifndef WDECK_HOST_ADDR
#define WDECK_HOST_ADDR "192.168.1.10"
#endif

#ifndef WDECK_HOST_PORT
#define WDECK_HOST_PORT 8899
#endif

/* Token mostrato dall'host all'avvio (settings.security.token). */
#ifndef WDECK_TOKEN
#define WDECK_TOKEN "CHANGE-ME-wdeck-dev-token"
#endif

/* Profilo/pagina da caricare all'avvio: vuoto = quelli attivi sull'host. */
#ifndef WDECK_START_PROFILE
#define WDECK_START_PROFILE ""
#endif

#ifndef WDECK_START_PAGE
#define WDECK_START_PAGE ""
#endif

/* -------------------------- display --------------------------- */

/* Rotazione TFT_eSPI: 0..3 (1 = orizzontale). */
#ifndef WDECK_TFT_ROTATION
#define WDECK_TFT_ROTATION 1
#endif

/* Soglia di pressione del touch resistivo (ignorata dai touch capacitivi). */
#ifndef WDECK_TOUCH_THRESHOLD
#define WDECK_TOUCH_THRESHOLD 400
#endif

/* Millisecondi di anti-rimbalzo fra due pressioni. */
#ifndef WDECK_TOUCH_DEBOUNCE_MS
#define WDECK_TOUCH_DEBOUNCE_MS 220
#endif

/* Margine e spaziatura della griglia, in pixel. */
#ifndef WDECK_GRID_MARGIN
#define WDECK_GRID_MARGIN 6
#endif

#ifndef WDECK_GRID_GAP
#define WDECK_GRID_GAP 5
#endif

/* Altezza della barra di stato in basso, in pixel. */
#ifndef WDECK_STATUS_H
#define WDECK_STATUS_H 16
#endif

/* ------------------------- comportamento ----------------------- */

/* Intervallo dei ping WebSocket (ms). */
#ifndef WDECK_PING_INTERVAL_MS
#define WDECK_PING_INTERVAL_MS 20000
#endif

/* Numero massimo di bottoni gestibili per pagina. */
#ifndef WDECK_MAX_BUTTONS
#define WDECK_MAX_BUTTONS 24
#endif

/* Dimensione del buffer JSON per il layout (byte). */
#ifndef WDECK_JSON_CAPACITY
#define WDECK_JSON_CAPACITY 4096
#endif

#endif /* WDECK_CONFIG_H */
