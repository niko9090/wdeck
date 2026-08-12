/*
 * wdeck_protocol.h - protocollo "lite" di Wdeck per microcontrollori.
 *
 * ATTENZIONE: questo file e' il gemello C di shared/protocol.mjs.
 * Ogni valore qui deve coincidere con quello definito nel modulo JavaScript;
 * `npm run test:esp32` confronta i due file e fallisce in caso di divergenza.
 *
 * Il protocollo lite usa chiavi JSON di un solo carattere per restare
 * ampiamente sotto il KB per pagina, cosi' da poter essere gestito da un
 * ESP32 con poca RAM libera.
 */

#ifndef WDECK_PROTOCOL_H
#define WDECK_PROTOCOL_H

/* ------------------------------------------------------------------ */
/* Versione                                                            */
/* ------------------------------------------------------------------ */

#define WDECK_LITE_PROTOCOL_VERSION 1

/* ------------------------------------------------------------------ */
/* Endpoint                                                            */
/* ------------------------------------------------------------------ */

#define WDECK_EP_HEALTH     "/api/health"
#define WDECK_EP_LITE_DECK  "/api/lite/deck"
#define WDECK_EP_LITE_STATE "/api/lite/state"
#define WDECK_EP_LITE_PRESS "/api/lite/press"
#define WDECK_EP_WS_LITE    "/ws/lite"

/* Autenticazione: querystring per il WebSocket, header per il REST. */
#define WDECK_TOKEN_QUERY  "token"
#define WDECK_TOKEN_HEADER "x-wdeck-token"

/* ------------------------------------------------------------------ */
/* Nomi di campo compatti (LITE_FIELDS)                                */
/* ------------------------------------------------------------------ */

#define WDECK_F_VERSION   "v"  /* intero: versione protocollo lite   */
#define WDECK_F_PROFILE   "f"  /* stringa: id profilo                */
#define WDECK_F_PAGE      "p"  /* stringa: id pagina                 */
#define WDECK_F_ROWS      "r"  /* intero: righe della griglia        */
#define WDECK_F_COLS      "c"  /* intero: colonne della griglia      */
#define WDECK_F_BUTTONS   "b"  /* array: bottoni della pagina        */
#define WDECK_F_ID        "i"  /* stringa: id bottone                */
#define WDECK_F_LABEL     "l"  /* stringa: etichetta                 */
#define WDECK_F_COL       "x"  /* intero: colonna del bottone        */
#define WDECK_F_ROW       "y"  /* intero: riga del bottone           */
#define WDECK_F_COLOR     "g"  /* stringa "#rrggbb" (opzionale)      */
#define WDECK_F_ICON      "n"  /* stringa: nome icona (opzionale)    */
#define WDECK_F_TYPE      "t"  /* stringa: tipo azione / messaggio   */
#define WDECK_F_OK        "k"  /* 0|1: esito                         */
#define WDECK_F_ERROR     "e"  /* stringa: codice errore             */
#define WDECK_F_MESSAGE   "m"  /* stringa: messaggio leggibile       */
#define WDECK_F_TIMESTAMP "s"  /* intero: millisecondi host          */
#define WDECK_F_PAGES     "q"  /* array di stringhe: pagine profilo  */
#define WDECK_F_DRY_RUN   "d"  /* 0|1: host in modalita' dry-run     */

/* ------------------------------------------------------------------ */
/* Tipi di messaggio WebSocket (campo WDECK_F_TYPE)                    */
/* ------------------------------------------------------------------ */

#define WDECK_MSG_HELLO    "h"  /* host -> device: benvenuto          */
#define WDECK_MSG_AUTH     "u"  /* riservato (token gia' nell'URL)    */
#define WDECK_MSG_AUTH_OK  "k"  /* riservato                          */
#define WDECK_MSG_STATE    "s"  /* host -> device: stato corrente     */
#define WDECK_MSG_PRESS    "p"  /* device -> host: pressione bottone  */
#define WDECK_MSG_ACK      "a"  /* host -> device: esito pressione    */
#define WDECK_MSG_ERROR    "e"  /* host -> device: errore             */
#define WDECK_MSG_PING     "i"  /* device -> host                     */
#define WDECK_MSG_PONG     "o"  /* host -> device                     */
#define WDECK_MSG_NAVIGATE "n"  /* host -> device: cambio pagina      */

#endif /* WDECK_PROTOCOL_H */
