#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <esp_ota_ops.h>
#include <esp_wifi.h>
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
static volatile uint8_t progress;
static char err[72];

static void fail(const char *why) {
  snprintf(err, sizeof(err), "%s", why);
  state = PM_OTA_FAILED;
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
  if (state == PM_OTA_CONNECTING || state == PM_OTA_DOWNLOADING || state == PM_OTA_REBOOTING) return false;
  if (!u || !s || strlen(u) >= sizeof(args->url) || strlen(s) >= sizeof(args->ssid) || (p && strlen(p) >= sizeof(args->pass))) return false;
  if (!args) args = new Args();
  if (!args) return false;
  strcpy(args->url, u);
  strcpy(args->ssid, s);
  strcpy(args->pass, p ? p : "");
  channel = mesh_channel;
  // Big stack: TLS-free HTTP still wants ~6 KB, plus the Update library.
  return xTaskCreate(task, "pm_ota", 12288, nullptr, 1, nullptr) == pdPASS;
}

uint8_t pm_ota_state() { return state; }
uint8_t pm_ota_progress() { return progress; }
const char *pm_ota_error() { return err; }

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
