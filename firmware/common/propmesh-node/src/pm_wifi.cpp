#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <sys/time.h>
#include "pm_wifi.h"
#include "pm_mesh.h"

// While a station is trying to join, it scans every channel for its
// router — and the radio it scans with is the mesh's. With the core's
// auto-reconnect that scan ran back to back whenever the router was out
// of reach, and the mesh lost most of its frames: a firmware update to
// Prop failed with "no reply" while the bridge showed "joining WiFi"
// (2026-10-08). So the bridge retries on its own schedule — one attempt,
// started on the mesh's own channel, then a pause that grows to 2 min —
// and the mesh gets the radio in between.
#define RETRY_FIRST_MS 15000
#define RETRY_MAX_MS 120000

static char ssid[33], pass[65];
static bool want, was_up, mdns_up;
static char ip[16];
static uint32_t last_try_ms, retry_ms = RETRY_FIRST_MS;
static volatile uint8_t last_reason;  // why the last attempt or link ended (wifi_err_reason_t)
static volatile bool attempt_ended;   // set by the event: the scan is over, one way or another
static bool handler_set;
static uint8_t home_ch;               // the mesh's channel when the attempt started

static void begin_attempt() {
  last_try_ms = millis();
  home_ch = pm_mesh_channel();
  attempt_ended = false;
  // Start the scan on the mesh's channel: when the router is still there
  // (the usual case) it is found at once and nothing else is scanned.
  WiFi.begin(ssid, pass, pm_mesh_channel());
}

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
  if (!handler_set) {
    handler_set = true;
    WiFi.onEvent([](arduino_event_id_t, arduino_event_info_t info) {
      last_reason = info.wifi_sta_disconnected.reason;
      attempt_ended = true;
    }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  }
  WiFi.persistent(false);         // credentials live in our config, not NVS
  WiFi.setAutoReconnect(false);   // our schedule, not back-to-back scans (above)
  WiFi.setSleep(false);           // modem sleep would starve ESP-NOW
  last_reason = 0;
  retry_ms = RETRY_FIRST_MS;
  begin_attempt();
  Serial.printf("wifi: joining %s\n", ssid);
}

void pm_wifi_loop() {
  if (!want) return;
  bool up = WiFi.status() == WL_CONNECTED;
  if (up && !was_up) {
    strlcpy(ip, WiFi.localIP().toString().c_str(), sizeof(ip));
    Serial.printf("wifi: joined %s as %s on channel %u\n", ssid, ip, pm_mesh_channel());
    retry_ms = RETRY_FIRST_MS;
    last_reason = 0;
    if (!mdns_up) {
      mdns_up = MDNS.begin("propmesh");  // propmesh.local
      if (mdns_up) MDNS.addService("propmesh", "tcp", 81);  // the console's WebSocket
    }
    // Wall time for the show schedule (software-plan §4.1): a bridge on
    // WiFi keeps the mesh's clock right with no console attached, and
    // gets it back by itself after a power cut. UTC only — the time zone
    // comes from the console and is kept in /schedule.json.
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  } else if (!up && was_up) {
    Serial.printf("wifi: lost (%s) — retrying in %lu s\n", pm_wifi_reason(), (unsigned long)(retry_ms / 1000));
    ip[0] = 0;
    last_try_ms = millis();
  }
  was_up = up;
  static uint32_t last_ntp_ms;
  if (up && (uint32_t)(millis() - last_ntp_ms) > 60000) {
    timeval tv;
    gettimeofday(&tv, nullptr);
    if (tv.tv_sec > 1700000000) {  // 1970 until SNTP has answered once
      last_ntp_ms = millis();
      pm_wall().set_utc((int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000, esp_timer_get_time() / 1000);
    }
  }
  // A failed attempt leaves the radio wherever its scan ended (the console
  // saw channel 14): put it back on the mesh's channel until the next try.
  if (!up && attempt_ended) {
    attempt_ended = false;
    if (home_ch && pm_mesh_channel() != home_ch) pm_mesh_set_channel(home_ch);
  }
  if (!up && (uint32_t)(millis() - last_try_ms) > retry_ms) {
    if (last_reason) Serial.printf("wifi: couldn't join %s (%s) — trying again\n", ssid, pm_wifi_reason());
    WiFi.disconnect(false, false);  // end the previous attempt's scan before the next
    begin_attempt();
    retry_ms = retry_ms * 2 > RETRY_MAX_MS ? RETRY_MAX_MS : retry_ms * 2;
  }
}

bool pm_wifi_configured() { return want; }
bool pm_wifi_connected() { return want && WiFi.status() == WL_CONNECTED; }
const char *pm_wifi_ip() { return pm_wifi_connected() ? ip : ""; }
int8_t pm_wifi_rssi() { return pm_wifi_connected() ? (int8_t)WiFi.RSSI() : 0; }
const char *pm_wifi_ssid() { return ssid; }

// Plain words for the reasons a home router actually gives.
const char *pm_wifi_reason() {
  switch (last_reason) {
    case 0: return "";
    case WIFI_REASON_NO_AP_FOUND: return "network not found — out of range, wrong name, or 5 GHz only";
    case WIFI_REASON_AUTH_FAIL:
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_MIC_FAILURE: return "wrong password";
    case WIFI_REASON_BEACON_TIMEOUT: return "router stopped answering (weak signal?)";
    case WIFI_REASON_ASSOC_LEAVE: return "left";
    default: return WiFi.disconnectReasonName((wifi_err_reason_t)last_reason);
  }
}
