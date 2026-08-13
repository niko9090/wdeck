/*
 * Wdeck - firmware di esempio per ESP32 con display TFT touch.
 *
 * Cosa fa:
 *   1. si collega al Wi-Fi;
 *   2. scarica il layout della pagina attiva da GET /api/lite/deck (protocollo lite);
 *   3. disegna la griglia di bottoni sul TFT;
 *   4. apre un WebSocket su /ws/lite e resta in ascolto di stato e navigazione;
 *   5. al tocco invia {"t":"p","i":"<id bottone>"} e mostra l'esito dell'ack.
 *
 * Librerie (vedi platformio.ini):
 *   - TFT_eSPI      (Bodmer)      display + touch
 *   - ArduinoJson   (bblanchon)   parsing JSON
 *   - WebSockets    (links2004)   client WebSocket
 *
 * Tutte le stringhe di protocollo provengono da wdeck_protocol.h: non
 * scrivere endpoint o chiavi JSON "a mano" in questo file, altrimenti
 * `npm run test:esp32` segnala la divergenza.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <TFT_eSPI.h>

#include "wdeck_config.h"
#include "wdeck_protocol.h"

// ---------------------------------------------------------------- tipi

struct WdeckButton {
  char id[24];
  char label[24];
  int row;
  int col;
  uint16_t color;
  // Stato reale inviato dall'host: -1 sconosciuto, 0 spento, 1 acceso.
  int8_t on;
  // rettangolo calcolato in fase di disegno
  int16_t x, y, w, h;
};

// ---------------------------------------------------------------- stato

static TFT_eSPI tft = TFT_eSPI();
static WebSocketsClient wsClient;

static WdeckButton buttons[WDECK_MAX_BUTTONS];
static int buttonCount = 0;
static int gridRows = 0;
static int gridCols = 0;
static char currentProfile[24] = {0};
static char currentPage[24] = {0};
static bool hostDryRun = false;
static bool wsConnected = false;
static uint32_t lastPing = 0;
static uint32_t lastTouch = 0;
static int highlightIndex = -1;
static uint32_t highlightUntil = 0;
static uint16_t highlightColor = TFT_WHITE;

// ---------------------------------------------------------------- utilita'

/** Converte "#rrggbb" nel formato RGB565 usato dal TFT. */
static uint16_t parseColor(const char *hex, uint16_t fallback) {
  if (hex == nullptr || hex[0] != '#' || strlen(hex) < 7) return fallback;
  long value = strtol(hex + 1, nullptr, 16);
  uint8_t r = (value >> 16) & 0xFF;
  uint8_t g = (value >> 8) & 0xFF;
  uint8_t b = value & 0xFF;
  return tft.color565(r, g, b);
}

static void copyString(char *dest, size_t size, const char *src) {
  if (src == nullptr) {
    dest[0] = '\0';
    return;
  }
  strncpy(dest, src, size - 1);
  dest[size - 1] = '\0';
}

/** Barra di stato in fondo allo schermo. */
static void drawStatus(const char *text, uint16_t color) {
  int y = tft.height() - WDECK_STATUS_H;
  tft.fillRect(0, y, tft.width(), WDECK_STATUS_H, TFT_BLACK);
  tft.setTextColor(color, TFT_BLACK);
  tft.setTextDatum(TL_DATUM);
  tft.drawString(text, 4, y + 3, 1);

  if (hostDryRun) {
    tft.setTextColor(TFT_ORANGE, TFT_BLACK);
    tft.setTextDatum(TR_DATUM);
    tft.drawString("DRY-RUN", tft.width() - 4, y + 3, 1);
  }
}

// ---------------------------------------------------------------- disegno

static void drawButton(int index, bool pressed) {
  if (index < 0 || index >= buttonCount) return;
  const WdeckButton &b = buttons[index];

  uint16_t fill = pressed ? highlightColor : b.color;
  tft.fillRoundRect(b.x, b.y, b.w, b.h, 6, fill);

  // Un bottone a due stati (muto, scena in onda, luce accesa) si riconosce dal
  // bordo chiaro e dalla spia in alto a sinistra: e' lo stato letto dall'host,
  // non l'ultima pressione fatta da questo dispositivo.
  uint16_t frame = (b.on == 1) ? TFT_WHITE : TFT_DARKGREY;
  tft.drawRoundRect(b.x, b.y, b.w, b.h, 6, frame);
  if (b.on >= 0) {
    tft.fillCircle(b.x + 8, b.y + 8, 3, b.on == 1 ? TFT_GREEN : TFT_DARKGREY);
  }

  tft.setTextColor(TFT_WHITE, fill);
  tft.setTextDatum(MC_DATUM);
  tft.drawString(b.label, b.x + b.w / 2, b.y + b.h / 2, 2);
}

/** Ricalcola i rettangoli e ridisegna l'intera griglia. */
static void drawGrid() {
  tft.fillScreen(TFT_BLACK);

  if (gridRows <= 0 || gridCols <= 0) {
    drawStatus("layout non disponibile", TFT_RED);
    return;
  }

  int usableH = tft.height() - WDECK_STATUS_H;
  int cellW = (tft.width() - 2 * WDECK_GRID_MARGIN - (gridCols - 1) * WDECK_GRID_GAP) / gridCols;
  int cellH = (usableH - 2 * WDECK_GRID_MARGIN - (gridRows - 1) * WDECK_GRID_GAP) / gridRows;

  for (int i = 0; i < buttonCount; i++) {
    WdeckButton &b = buttons[i];
    b.x = WDECK_GRID_MARGIN + b.col * (cellW + WDECK_GRID_GAP);
    b.y = WDECK_GRID_MARGIN + b.row * (cellH + WDECK_GRID_GAP);
    b.w = cellW;
    b.h = cellH;
    drawButton(i, false);
  }

  char status[48];
  snprintf(status, sizeof(status), "%s / %s", currentProfile, currentPage);
  drawStatus(status, TFT_CYAN);
}

// ---------------------------------------------------------------- rete

/** Costruisce un URL completo verso l'host, con token in querystring. */
static String buildUrl(const char *endpoint, const String &extraQuery) {
  String url = "http://";
  url += WDECK_HOST_ADDR;
  url += ":";
  url += String(WDECK_HOST_PORT);
  url += endpoint;
  url += "?";
  url += WDECK_TOKEN_QUERY;
  url += "=";
  url += WDECK_TOKEN;
  url += extraQuery;
  return url;
}

/** Scarica e interpreta il layout della pagina indicata (vuoto = pagina attiva). */
static bool fetchLayout(const char *profile, const char *page) {
  if (WiFi.status() != WL_CONNECTED) return false;

  String extra = "";
  if (profile != nullptr && profile[0] != '\0') extra += String("&profile=") + profile;
  if (page != nullptr && page[0] != '\0') extra += String("&page=") + page;

  HTTPClient http;
  http.begin(buildUrl(WDECK_EP_LITE_DECK, extra));
  http.addHeader(WDECK_TOKEN_HEADER, WDECK_TOKEN);
  int status = http.GET();

  if (status != 200) {
    Serial.printf("[wdeck] GET %s -> %d\n", WDECK_EP_LITE_DECK, status);
    http.end();
    drawStatus(status == 401 ? "token rifiutato" : "host non raggiungibile", TFT_RED);
    return false;
  }

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, http.getStream());
  http.end();

  if (err) {
    Serial.printf("[wdeck] JSON non valido: %s\n", err.c_str());
    drawStatus("layout illeggibile", TFT_RED);
    return false;
  }

  int version = doc[WDECK_F_VERSION] | 0;
  if (version != WDECK_LITE_PROTOCOL_VERSION) {
    Serial.printf("[wdeck] versione protocollo non supportata: %d\n", version);
    drawStatus("protocollo incompatibile", TFT_RED);
    return false;
  }

  copyString(currentProfile, sizeof(currentProfile), doc[WDECK_F_PROFILE] | "");
  copyString(currentPage, sizeof(currentPage), doc[WDECK_F_PAGE] | "");
  gridRows = doc[WDECK_F_ROWS] | 0;
  gridCols = doc[WDECK_F_COLS] | 0;
  hostDryRun = (doc[WDECK_F_DRY_RUN] | 0) != 0;

  buttonCount = 0;
  JsonArray list = doc[WDECK_F_BUTTONS].as<JsonArray>();
  for (JsonObject item : list) {
    if (buttonCount >= WDECK_MAX_BUTTONS) break;
    WdeckButton &b = buttons[buttonCount];
    copyString(b.id, sizeof(b.id), item[WDECK_F_ID] | "");
    copyString(b.label, sizeof(b.label), item[WDECK_F_LABEL] | "");
    b.row = item[WDECK_F_ROW] | 0;
    b.col = item[WDECK_F_COL] | 0;
    b.color = parseColor(item[WDECK_F_COLOR] | "", TFT_NAVY);
    b.on = -1;  // sconosciuto finche' non arriva il messaggio di stato
    // item[WDECK_F_ICON] e item[WDECK_F_TYPE] sono disponibili per estensioni
    // (glifi personalizzati o colorazione per tipo di azione).
    if (b.id[0] != '\0') buttonCount++;
  }

  Serial.printf("[wdeck] layout %s/%s: %dx%d, %d bottoni\n",
                currentProfile, currentPage, gridRows, gridCols, buttonCount);
  drawGrid();
  return true;
}

/** Invia la pressione di un bottone sul canale WebSocket. */
static void sendPress(int index) {
  if (index < 0 || index >= buttonCount) return;

  JsonDocument doc;
  doc[WDECK_F_TYPE] = WDECK_MSG_PRESS;
  doc[WDECK_F_ID] = buttons[index].id;

  String payload;
  serializeJson(doc, payload);

  if (wsConnected) {
    wsClient.sendTXT(payload);
  } else {
    // ripiego REST quando il WebSocket non e' disponibile
    HTTPClient http;
    http.begin(buildUrl(WDECK_EP_LITE_PRESS, ""));
    http.addHeader("Content-Type", "application/json");
    http.addHeader(WDECK_TOKEN_HEADER, WDECK_TOKEN);
    JsonDocument body;
    body[WDECK_F_ID] = buttons[index].id;
    String bodyText;
    serializeJson(body, bodyText);
    int status = http.POST(bodyText);
    http.end();
    highlightColor = (status == 200) ? TFT_DARKGREEN : TFT_RED;
    highlightIndex = index;
    highlightUntil = millis() + 250;
    drawButton(index, true);
    return;
  }

  highlightColor = TFT_DARKGREY;
  highlightIndex = index;
  highlightUntil = millis() + 1000;
  drawButton(index, true);
}

static int findButtonById(const char *id) {
  for (int i = 0; i < buttonCount; i++) {
    if (strcmp(buttons[i].id, id) == 0) return i;
  }
  return -1;
}

/** Gestisce un messaggio JSON ricevuto dal canale lite. */
static void handleWsMessage(const char *text) {
  JsonDocument doc;
  if (deserializeJson(doc, text)) return;

  const char *type = doc[WDECK_F_TYPE] | "";

  if (strcmp(type, WDECK_MSG_HELLO) == 0 || strcmp(type, WDECK_MSG_STATE) == 0) {
    hostDryRun = (doc[WDECK_F_DRY_RUN] | 0) != 0;
    const char *profile = doc[WDECK_F_PROFILE] | "";
    const char *page = doc[WDECK_F_PAGE] | "";
    if (page[0] != '\0' && strcmp(page, currentPage) != 0) {
      fetchLayout(profile, page);
    } else {
      char status[48];
      snprintf(status, sizeof(status), "%s / %s", currentProfile, currentPage);
      drawStatus(status, TFT_GREEN);
    }
    return;
  }

  if (strcmp(type, WDECK_MSG_NAVIGATE) == 0) {
    fetchLayout(doc[WDECK_F_PROFILE] | "", doc[WDECK_F_PAGE] | "");
    return;
  }

  // Stato reale dei bottoni: l'host manda solo id -> 0|1, i controlli assenti
  // dalla mappa restano "sconosciuti" e vengono disegnati senza spia.
  if (strcmp(type, WDECK_MSG_STATUS) == 0) {
    JsonObject states = doc[WDECK_F_STATES].as<JsonObject>();
    for (int i = 0; i < buttonCount; i++) {
      int8_t next = -1;
      if (!states.isNull() && states[buttons[i].id].is<int>()) {
        next = states[buttons[i].id].as<int>() != 0 ? 1 : 0;
      }
      if (next != buttons[i].on) {
        buttons[i].on = next;
        drawButton(i, false);
      }
    }
    return;
  }

  if (strcmp(type, WDECK_MSG_ACK) == 0) {
    bool ok = (doc[WDECK_F_OK] | 0) != 0;
    const char *message = doc[WDECK_F_MESSAGE] | "";
    int index = findButtonById(doc[WDECK_F_ID] | "");
    highlightColor = ok ? TFT_DARKGREEN : TFT_RED;
    highlightIndex = index;
    highlightUntil = millis() + 400;
    drawButton(index, true);
    drawStatus(message[0] ? message : (ok ? "ok" : "errore"), ok ? TFT_GREEN : TFT_RED);
    return;
  }

  if (strcmp(type, WDECK_MSG_ERROR) == 0) {
    drawStatus(doc[WDECK_F_MESSAGE] | "errore", TFT_RED);
    return;
  }

  if (strcmp(type, WDECK_MSG_PONG) == 0) {
    return;
  }
}

static void onWsEvent(WStype_t type, uint8_t *payload, size_t length) {
  (void)length;
  switch (type) {
    case WStype_CONNECTED:
      wsConnected = true;
      Serial.println("[wdeck] websocket connesso");
      drawStatus("connesso", TFT_GREEN);
      break;
    case WStype_DISCONNECTED:
      wsConnected = false;
      Serial.println("[wdeck] websocket disconnesso");
      drawStatus("riconnessione...", TFT_ORANGE);
      break;
    case WStype_TEXT:
      handleWsMessage(reinterpret_cast<const char *>(payload));
      break;
    default:
      break;
  }
}

static void connectWebSocket() {
  String path = String(WDECK_EP_WS_LITE) + "?" + WDECK_TOKEN_QUERY + "=" + WDECK_TOKEN;
  wsClient.begin(WDECK_HOST_ADDR, WDECK_HOST_PORT, path);
  wsClient.onEvent(onWsEvent);
  wsClient.setReconnectInterval(3000);
}

static void connectWifi() {
  tft.fillScreen(TFT_BLACK);
  drawStatus("connessione Wi-Fi...", TFT_YELLOW);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WDECK_WIFI_SSID, WDECK_WIFI_PASS);

  uint32_t deadline = millis() + 20000;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(250);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[wdeck] Wi-Fi ok, ip %s\n", WiFi.localIP().toString().c_str());
    drawStatus(WiFi.localIP().toString().c_str(), TFT_GREEN);
  } else {
    Serial.println("\n[wdeck] Wi-Fi non disponibile");
    drawStatus("Wi-Fi non disponibile", TFT_RED);
  }
}

// ---------------------------------------------------------------- touch

static void handleTouch() {
  uint16_t tx = 0, ty = 0;
  if (!tft.getTouch(&tx, &ty, WDECK_TOUCH_THRESHOLD)) return;
  if (millis() - lastTouch < WDECK_TOUCH_DEBOUNCE_MS) return;
  lastTouch = millis();

  for (int i = 0; i < buttonCount; i++) {
    const WdeckButton &b = buttons[i];
    if (tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h) {
      sendPress(i);
      return;
    }
  }
}

// ---------------------------------------------------------------- arduino

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[wdeck] avvio firmware ESP32");

  tft.init();
  tft.setRotation(WDECK_TFT_ROTATION);
  tft.fillScreen(TFT_BLACK);

  connectWifi();
  fetchLayout(WDECK_START_PROFILE, WDECK_START_PAGE);
  connectWebSocket();
}

void loop() {
  wsClient.loop();
  handleTouch();

  if (highlightIndex >= 0 && millis() > highlightUntil) {
    drawButton(highlightIndex, false);
    highlightIndex = -1;
  }

  if (wsConnected && millis() - lastPing > WDECK_PING_INTERVAL_MS) {
    lastPing = millis();
    JsonDocument doc;
    doc[WDECK_F_TYPE] = WDECK_MSG_PING;
    String payload;
    serializeJson(doc, payload);
    wsClient.sendTXT(payload);
  }

  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
    if (WiFi.status() == WL_CONNECTED) fetchLayout(currentProfile, currentPage);
  }
}
