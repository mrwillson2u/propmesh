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
    long light = jc["light"] | (long)c.light_id;
    if (light < 0 || light > 255) return "light must be 1-255";
    c.light_id = (uint8_t)light;
    out.channel_count++;
  }
  return nullptr;
}

// Only the fields a kind uses are written, so the stored document reads
// the way the user thinks about the channel.
inline void pm_config_to_json(const PmNodeConfig &cfg, JsonObject root) {
  root["v"] = 1;
  root["name"] = cfg.name;
  root["bridge"] = cfg.bridge;
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
        jc["pixels"] = c.pixels;
        break;
      case PM_CHANNEL_KIND_BLE_LIGHT:
        jc["light"] = c.light_id;
        break;
    }
  }
}
