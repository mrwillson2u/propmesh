#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include "pm_wifi.h"
#include "pm_mesh.h"

static char ssid[33], pass[65];
static bool want, was_up, mdns_up;
static char ip[16];
static uint32_t last_try_ms;

void pm_wifi_apply(const PmNodeConfig &cfg) {
  bool join = cfg.bridge && cfg.wifi_ssid[0];
  bool changed = join != want || strcmp(ssid, cfg.wifi_ssid) || strcmp(pass, cfg.wifi_pass);
  strlcpy(ssid, cfg.wifi_ssid, sizeof(ssid));
  strlcpy(pass, cfg.wifi_pass, sizeof(pass));
  want = join;
  if (!changed) return;
  if (!join) {
    if (was_up || WiFi.status() == WL_CONNECTED) Serial.println("wifi: leaving");
    WiFi.disconnect(false, false);
    was_up = false;
    ip[0] = 0;
    return;
  }
  WiFi.persistent(false);         // credentials live in our config, not NVS
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);           // modem sleep would starve ESP-NOW
  WiFi.begin(ssid, pass);
  last_try_ms = millis();
  Serial.printf("wifi: joining %s\n", ssid);
}

void pm_wifi_loop() {
  if (!want) return;
  bool up = WiFi.status() == WL_CONNECTED;
  if (up && !was_up) {
    strlcpy(ip, WiFi.localIP().toString().c_str(), sizeof(ip));
    Serial.printf("wifi: joined %s as %s on channel %u\n", ssid, ip, pm_mesh_channel());
    if (!mdns_up) mdns_up = MDNS.begin("propmesh");  // propmesh.local
  } else if (!up && was_up) {
    Serial.println("wifi: lost — reconnecting");
    ip[0] = 0;
  }
  was_up = up;
  // Auto-reconnect usually handles it; kick it if it has been quiet a while.
  if (!up && (uint32_t)(millis() - last_try_ms) > 30000) {
    last_try_ms = millis();
    WiFi.begin(ssid, pass);
  }
}

bool pm_wifi_configured() { return want; }
bool pm_wifi_connected() { return want && WiFi.status() == WL_CONNECTED; }
const char *pm_wifi_ip() { return pm_wifi_connected() ? ip : ""; }
int8_t pm_wifi_rssi() { return pm_wifi_connected() ? (int8_t)WiFi.RSSI() : 0; }
const char *pm_wifi_ssid() { return ssid; }
