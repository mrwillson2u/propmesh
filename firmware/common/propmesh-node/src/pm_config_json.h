// Node config <-> JSON (ArduinoJson 7). The same document is stored in
// LittleFS, sent over USB serial, and — from stage 2 — chunked over the
// mesh. Shape: docs/generic-boards.md §"Config JSON".
//
// Parsing only checks shape; pm_validate() decides whether the result
// is safe to apply. Header-only: tested host-native.
#pragma once
#include <ArduinoJson.h>
#include <ctype.h>
#include <stdio.h>
#include "pm_config.h"

// Returns nullptr on success, else a short reason.
inline const char *pm_config_from_json(JsonVariantConst root, PmNodeConfig &out) {
  out = PmNodeConfig();
  if (!root.is<JsonObjectConst>()) return "config is not an object";
  pm_copy(out.name, root["name"] | "", sizeof(out.name));
  out.bridge = root["bridge"] | false;
  // "wifi": {"ssid", "pass"} — bridge only. A missing "pass" means "keep
  // the stored one" (the console never sees it); pm_api fills it back in.
  out.battery = !strcmp(root["power"] | "mains", "battery");
  JsonVariantConst sl = root["sleep"];
  out.sleep_interval_ms = sl["interval_ms"] | 1000;
  out.sleep_window_ms = sl["window_ms"] | 100;
  out.sleep_checkin_ms = sl["checkin_ms"] | 300000UL;
  out.sleep_relay = sl["relay"] | false;
  if (out.sleep_interval_ms < 200 || out.sleep_interval_ms > 10000) return "sleep.interval_ms must be 200-10000";
  if (out.sleep_window_ms < 30 || out.sleep_window_ms > out.sleep_interval_ms) return "sleep.window_ms must be 30 to interval_ms";
  if (out.sleep_checkin_ms < 30000 || out.sleep_checkin_ms > 86400000UL) return "sleep.checkin_ms must be 30000 (30 s) to 86400000 (24 h)";
  JsonVariantConst wifi = root["wifi"];
  pm_copy(out.wifi_ssid, wifi["ssid"] | "", sizeof(out.wifi_ssid));
  pm_copy(out.wifi_pass, wifi["pass"] | "", sizeof(out.wifi_pass));
  // "brmesh_key": 8 hex digits, e.g. "5a13c79e"
  const char *key = root["brmesh_key"] | "";
  if (*key) {
    if (strlen(key) != 8) return "brmesh_key must be 8 hex digits";
    for (int i = 0; i < 4; i++) {
      unsigned v;
      char two[3] = {key[2 * i], key[2 * i + 1], 0};
      if (!isxdigit((unsigned char)two[0]) || !isxdigit((unsigned char)two[1])) return "brmesh_key must be 8 hex digits";
      sscanf(two, "%2x", &v);
      out.brmesh_key[i] = (uint8_t)v;
    }
    out.has_brmesh_key = true;
  }

  JsonArrayConst chans = root["channels"];
  if (chans.size() > PM_MAX_CHANNELS) return "too many channels";
  for (JsonObjectConst jc : chans) {
    PmChannelCfg &c = out.channels[out.channel_count];
    const pm_function_t *f = pm_function_by_name(jc["kind"] | "");
    if (!f) return "unknown channel kind";
    c.kind = f->kind;
    int index = jc["index"] | 0;
    if (index < 1 || index > 255) return "channel index must be 1-255";
    c.index = (uint8_t)index;
    JsonArrayConst pins = jc["pins"];
    if (pins.size() > PM_FN_MAX_PINS) return "too many pins on a channel";
    for (JsonVariantConst p : pins) {
      int gpio = p | -1;
      if (gpio < 0 || gpio > 254) return "bad pin number";
      c.pins[c.pin_count++] = (uint8_t)gpio;
    }
    pm_copy(c.label, jc["label"] | "", sizeof(c.label));
    c.active_low = jc["active_low"] | false;
    const char *pull = jc["pull"] | "none";
    c.pull = !strcmp(pull, "up") ? PM_PULL_UP
           : !strcmp(pull, "down") ? PM_PULL_DOWN
           : !strcmp(pull, "none") ? PM_PULL_NONE : 0xFF;
    c.min_us = jc["min_us"] | c.min_us;
    c.max_us = jc["max_us"] | c.max_us;
    c.travel_ms = jc["travel_ms"] | c.travel_ms;
    c.ease_ms = jc["ease_ms"] | c.ease_ms;
    c.pixels = jc["pixels"] | c.pixels;
    if (c.kind == PM_CHANNEL_KIND_SPI_STRIP) c.order = PM_ORDER_BGR;
    const char *order = jc["order"] | "";
    if (*order) {
      c.order = !strcmp(order, "grb") ? PM_ORDER_GRB : !strcmp(order, "rgb") ? PM_ORDER_RGB
              : !strcmp(order, "bgr") ? PM_ORDER_BGR : 0xFF;
      if (c.order == 0xFF) return "order must be grb, rgb or bgr";
    }
    const char *effect = jc["effect"] | "solid";
    c.effect = !strcmp(effect, "solid") ? PM_EFFECT_SOLID : !strcmp(effect, "fire") ? PM_EFFECT_FIRE : 0xFF;
    if (c.effect == 0xFF) return "effect must be solid or fire";
    JsonVariantConst fj = jc["fire"];
    if (!fj.isNull()) {
      PmFireCfg &f = c.fire;
      f.w = fj["w"] | f.w;  f.h = fj["h"] | f.h;  f.zigzag = fj["zigzag"] | f.zigzag;
      f.brightness = fj["brightness"] | f.brightness;  f.speed = fj["speed"] | f.speed;
      f.flame10 = fj["flame10"] | f.flame10;  f.noise = fj["noise"] | f.noise;
      f.smoke_speed = fj["smoke_speed"] | f.smoke_speed;  f.smoke_dim = fj["smoke_dim"] | f.smoke_dim;
      f.smoke_scale = fj["smoke_scale"] | f.smoke_scale;
    }
    JsonVariantConst cj = jc["candle"];
    if (!cj.isNull()) {
      PmCandleCfg &k = c.candle;
      k.drama10 = cj["drama10"] | k.drama10;  k.floor = cj["floor"] | k.floor;
      k.gust_s = cj["gust_s"] | k.gust_s;  k.sputter_s = cj["sputter_s"] | k.sputter_s;
      k.swing_chz = cj["swing_chz"] | k.swing_chz;  k.kick_ms = cj["kick_ms"] | k.kick_ms;
      k.coil = cj["coil"] | k.coil;
      k.draft = cj["draft"] | k.draft;
    }
    if (c.kind == PM_CHANNEL_KIND_BATTERY) {
      float div = jc["divider"] | 2.0f;
      c.batt_div100 = (uint16_t)(div * 100 + 0.5f);
    }
    long light = jc["light"] | (long)c.light_id;
    if (light < 0 || light > 255) return "light must be 1-255";
    c.light_id = (uint8_t)light;
    out.channel_count++;
  }
  return nullptr;
}

// Only the fields a kind uses are written, so the stored document reads
// the way the user thinks about the channel.
// `secrets`: include the WiFi password. Only for the board's own flash —
// what goes to a console says `pass_set` instead. (Until 2026-10-08 the
// file got the console's version too: the bridge lost its password at its
// first reboot and scanned for the router forever, wrecking the mesh.)
inline void pm_config_to_json(const PmNodeConfig &cfg, JsonObject root, bool secrets = false) {
  root["v"] = 1;
  root["name"] = cfg.name;
  root["bridge"] = cfg.bridge;
  root["power"] = cfg.battery ? "battery" : "mains";
  if (cfg.battery) {
    JsonObject sl = root["sleep"].to<JsonObject>();
    sl["interval_ms"] = cfg.sleep_interval_ms;
    sl["window_ms"] = cfg.sleep_window_ms;
    sl["checkin_ms"] = cfg.sleep_checkin_ms;
    if (cfg.sleep_relay) sl["relay"] = true;
  }
  if (cfg.wifi_ssid[0]) {
    JsonObject wifi = root["wifi"].to<JsonObject>();
    wifi["ssid"] = cfg.wifi_ssid;
    if (secrets) wifi["pass"] = cfg.wifi_pass;
    else wifi["pass_set"] = cfg.wifi_pass[0] != 0;
  }
  if (cfg.has_brmesh_key) {
    char hex[9];
    snprintf(hex, sizeof(hex), "%02x%02x%02x%02x", cfg.brmesh_key[0], cfg.brmesh_key[1],
             cfg.brmesh_key[2], cfg.brmesh_key[3]);
    root["brmesh_key"] = hex;
  }
  JsonArray chans = root["channels"].to<JsonArray>();
  for (uint8_t i = 0; i < cfg.channel_count; i++) {
    const PmChannelCfg &c = cfg.channels[i];
    const pm_function_t *f = pm_function(c.kind);
    if (!f) continue;
    JsonObject jc = chans.add<JsonObject>();
    jc["kind"] = f->name;
    jc["index"] = c.index;
    jc["label"] = c.label;
    JsonArray pins = jc["pins"].to<JsonArray>();
    for (uint8_t p = 0; p < c.pin_count; p++) pins.add(c.pins[p]);
    switch (c.kind) {
      case PM_CHANNEL_KIND_RELAY:
        jc["active_low"] = c.active_low;
        break;
      case PM_CHANNEL_KIND_DIGITAL_IN:
        jc["active_low"] = c.active_low;
        jc["pull"] = c.pull == PM_PULL_UP ? "up" : c.pull == PM_PULL_DOWN ? "down" : "none";
        break;
      case PM_CHANNEL_KIND_SERVO:
        jc["min_us"] = c.min_us;
        jc["max_us"] = c.max_us;
        jc["travel_ms"] = c.travel_ms;
        jc["ease_ms"] = c.ease_ms;
        break;
      case PM_CHANNEL_KIND_LED_STRIP:
      case PM_CHANNEL_KIND_SPI_STRIP:
        jc["pixels"] = c.pixels;
        jc["order"] = c.order == PM_ORDER_RGB ? "rgb" : c.order == PM_ORDER_BGR ? "bgr" : "grb";
        jc["effect"] = c.effect == PM_EFFECT_FIRE ? "fire" : "solid";
        if (c.effect == PM_EFFECT_FIRE) {
          JsonObject fj = jc["fire"].to<JsonObject>();
          const PmFireCfg &f = c.fire;
          fj["w"] = f.w;  fj["h"] = f.h;  fj["zigzag"] = f.zigzag;
          fj["brightness"] = f.brightness;  fj["speed"] = f.speed;  fj["flame10"] = f.flame10;
          fj["noise"] = f.noise;  fj["smoke_speed"] = f.smoke_speed;  fj["smoke_dim"] = f.smoke_dim;
          fj["smoke_scale"] = f.smoke_scale;
        }
        break;
      case PM_CHANNEL_KIND_BLE_LIGHT:
        jc["light"] = c.light_id;
        break;
      case PM_CHANNEL_KIND_BATTERY:
        jc["divider"] = c.batt_div100 / 100.0f;
        break;
      case PM_CHANNEL_KIND_CANDLE: {
        jc["active_low"] = c.active_low;
        JsonObject cj = jc["candle"].to<JsonObject>();
        const PmCandleCfg &k = c.candle;
        cj["drama10"] = k.drama10;  cj["floor"] = k.floor;  cj["gust_s"] = k.gust_s;
        cj["sputter_s"] = k.sputter_s;  cj["swing_chz"] = k.swing_chz;  cj["kick_ms"] = k.kick_ms;
        cj["coil"] = k.coil;
        if (k.draft) cj["draft"] = k.draft;
        break;
      }
    }
  }
}
