#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <esp_ota_ops.h>
#include <esp_wifi.h>
#include <Update.h>
#include <mbedtls/base64.h>
#include <mbedtls/sha256.h>
#include "pm_ota.h"

// The Arduino core marks a freshly booted OTA image valid during init
// unless the sketch asks to do it itself — we want the mesh up first.
extern "C" bool verifyRollbackLater() { return true; }

// Arguments live on the heap only while an update runs: static RAM is
// nearly full on this board.
struct Args { char url[160], ssid[33], pass[65]; };
static Args *args;
static uint8_t channel;
static volatile uint8_t state = PM_OTA_IDLE;
// The WiFi task is running. Kept apart from `state`: a mesh transfer that
// died midway used to leave state = DOWNLOADING, which both start checks
// read as "a WiFi update is running" — refused until a reboot (2026-10-08).
static volatile bool wifi_busy;
static volatile uint8_t progress;
static char err[72];

static void fail(const char *why) {
  snprintf(err, sizeof(err), "%s", why);
  state = PM_OTA_FAILED;
  wifi_busy = false;
  // Back onto the mesh: drop the AP and return to the mesh channel.
  WiFi.disconnect(true, false);
  delay(100);
  WiFi.mode(WIFI_STA);
  esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE);
}

static void task(void *) {
  state = PM_OTA_CONNECTING;
  progress = 0;
  err[0] = 0;
  delay(1500);  // let the "ok" reply leave over the mesh before the channel changes
  WiFi.persistent(false);  // use the credentials, never save them
  WiFi.setAutoReconnect(false);
  WiFi.begin(args->ssid, args->pass);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 25000) delay(100);
  if (WiFi.status() != WL_CONNECTED) {
    fail("couldn't join that WiFi (name/password, or out of range)");
    delete args;
    args = nullptr;
    vTaskDelete(nullptr);
    return;
  }
  Serial.printf("ota: joined %s as %s, fetching %s\n", args->ssid, WiFi.localIP().toString().c_str(), args->url);
  state = PM_OTA_DOWNLOADING;
  httpUpdate.rebootOnUpdate(false);
  httpUpdate.onProgress([](int cur, int total) { if (total > 0) progress = (uint8_t)(cur * 100L / total); });
  WiFiClient client;
  t_httpUpdate_return r = httpUpdate.update(client, args->url);
  if (r == HTTP_UPDATE_OK) {
    Serial.println("ota: written — rebooting into the new image");
    state = PM_OTA_REBOOTING;
    delay(300);
    ESP.restart();
  }
  char why[96];
  snprintf(why, sizeof(why), r == HTTP_UPDATE_NO_UPDATES ? "server had nothing to send" : "%s", httpUpdate.getLastErrorString().c_str());
  Serial.printf("ota: failed — %s\n", why);
  fail(why);
  delete args;
  args = nullptr;
  vTaskDelete(nullptr);
}

bool pm_ota_start(const char *u, const char *s, const char *p, uint8_t mesh_channel) {
  if (wifi_busy || state == PM_OTA_REBOOTING) return false;
  pm_ota_abort();  // a mesh transfer left hanging gives way
  if (!u || !s || strlen(u) >= sizeof(args->url) || strlen(s) >= sizeof(args->ssid) || (p && strlen(p) >= sizeof(args->pass))) return false;
  if (!args) args = new Args();
  if (!args) return false;
  strcpy(args->url, u);
  strcpy(args->ssid, s);
  strcpy(args->pass, p ? p : "");
  channel = mesh_channel;
  // Big stack: TLS-free HTTP still wants ~6 KB, plus the Update library.
  wifi_busy = xTaskCreate(task, "pm_ota", 12288, nullptr, 1, nullptr) == pdPASS;
  return wifi_busy;
}

uint8_t pm_ota_state() { return state; }
uint8_t pm_ota_progress() { return progress; }
const char *pm_ota_error() { return err; }

// --- over the mesh -----------------------------------------------------------

static struct {
  bool open;
  uint32_t size, written;
  uint8_t want[32];
  mbedtls_sha256_context sha;
  uint8_t *buf;  // 3 kB decode buffer, heap, only while receiving (static RAM is full)
  uint32_t last_ms;  // last chunk: a transfer silent for RX_STALE_MS is dropped
} rx;
#define RX_STALE_MS 60000
#define RX_BUF 3072

static void rx_close() {
  rx.open = false;
  free(rx.buf);
  rx.buf = nullptr;
  if (!wifi_busy && state == PM_OTA_DOWNLOADING) state = PM_OTA_IDLE;
}
static uint32_t reboot_at;

static bool hex32(const char *s, uint8_t out[32]) {
  if (!s || strlen(s) != 64) return false;
  for (int i = 0; i < 32; i++) {
    unsigned v;
    if (sscanf(s + 2 * i, "%2x", &v) != 1) return false;
    out[i] = (uint8_t)v;
  }
  return true;
}

const char *pm_ota_begin(uint32_t size, const char *sha256_hex) {
  if (wifi_busy) return "a WiFi update is running";
  if (state == PM_OTA_REBOOTING) return "already rebooting into a new image";
  // A previous mesh transfer that never finished is simply replaced (below).
  if (!size || !hex32(sha256_hex, rx.want)) return "ota_begin needs size and a 64-digit sha256";
  if (rx.open) { Update.abort(); rx_close(); }
  if (!rx.buf) rx.buf = (uint8_t *)malloc(RX_BUF);
  if (!rx.buf) return "out of memory";
  if (!Update.begin(size, U_FLASH)) { rx_close(); return Update.errorString(); }
  mbedtls_sha256_init(&rx.sha);
  mbedtls_sha256_starts(&rx.sha, 0);
  rx.open = true;
  rx.size = size;
  rx.written = 0;
  rx.last_ms = millis();
  state = PM_OTA_DOWNLOADING;
  progress = 0;
  err[0] = 0;
  Serial.printf("ota: receiving %lu bytes over the mesh\n", (unsigned long)size);
  return nullptr;
}

const char *pm_ota_data(uint32_t off, const char *data, uint32_t *written) {
  *written = rx.written;
  if (!rx.open) return "no update in progress — ota_begin first";
  if (off != rx.written) return "offset mismatch — resume from `written`";
  if (!data) return "no data";
  uint8_t *buf = rx.buf;
  size_t n = 0;
  if (mbedtls_base64_decode(buf, RX_BUF, &n, (const uint8_t *)data, strlen(data)) != 0) return "bad base64 (or chunk over 3 kB)";
  if (rx.written + n > rx.size) { Update.abort(); rx_close(); return "more bytes than announced"; }
  if (Update.write(buf, n) != n) { const char *e = Update.errorString(); Update.abort(); rx_close(); return e; }
  mbedtls_sha256_update(&rx.sha, buf, n);
  rx.last_ms = millis();
  rx.written += n;
  *written = rx.written;
  progress = (uint8_t)(rx.written * 100ULL / rx.size);
  return nullptr;
}

const char *pm_ota_end() {
  if (!rx.open) return "no update in progress";
  rx_close();
  if (rx.written != rx.size) { Update.abort(); return "image incomplete"; }
  uint8_t got[32];
  mbedtls_sha256_finish(&rx.sha, got);
  mbedtls_sha256_free(&rx.sha);
  if (memcmp(got, rx.want, 32)) { Update.abort(); return "sha256 mismatch — the image was corrupted in transit"; }
  if (!Update.end(true)) return Update.errorString();
  Serial.println("ota: image verified and written — rebooting into it");
  state = PM_OTA_REBOOTING;
  reboot_at = millis() + 1000;  // let the reply leave first (pm_ota_loop)
  return nullptr;
}

void pm_ota_abort() {
  if (rx.open) Update.abort();
  rx_close();
  if (state == PM_OTA_DOWNLOADING) state = PM_OTA_IDLE;
}

uint32_t pm_ota_written() { return rx.written; }

void pm_ota_loop() {
  if (reboot_at && (int32_t)(millis() - reboot_at) >= 0) ESP.restart();
  if (rx.open && (uint32_t)(millis() - rx.last_ms) > RX_STALE_MS) {
    Serial.println("ota: transfer went silent — dropped");
    pm_ota_abort();
  }
}

bool pm_ota_pending() {
  const esp_partition_t *run = esp_ota_get_running_partition();
  esp_ota_img_states_t st;
  return run && esp_ota_get_state_partition(run, &st) == ESP_OK && st == ESP_OTA_IMG_PENDING_VERIFY;
}

void pm_ota_mark_valid() {
  if (pm_ota_pending()) {
    esp_ota_mark_app_valid_cancel_rollback();
    Serial.println("ota: new image confirmed (mesh up) — rollback cancelled");
  }
}
