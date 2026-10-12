#include "pm_lastwords.h"
#include <Arduino.h>
#include <LittleFS.h>
#include "pm_mesh.h"  // pm_wall_utc_ms

static const char *PATH = "/last.json";
static JsonDocument prev;  // the record from before this boot
static bool have_prev;
static uint32_t last_write_ms;
static bool wrote_once;

void pm_lastwords_begin() {
  File f = LittleFS.open(PATH, "r");
  if (!f) return;
  have_prev = !deserializeJson(prev, f) && prev["what"].is<const char *>();
  f.close();
}

void pm_lastwords_note(const char *what, const char *detail) {
  uint32_t now = millis();
  if (wrote_once && now - last_write_ms < 10000) return;
  wrote_once = true;
  last_write_ms = now;
  JsonDocument d;
  d["what"] = what;
  if (detail && *detail) d["detail"] = detail;
  d["up_s"] = now / 1000;  // how long the board had been running
  int64_t utc = pm_wall_utc_ms();
  if (utc > 0) d["utc_s"] = (uint32_t)(utc / 1000);  // when, if the clock was known
  File f = LittleFS.open(PATH, "w");
  if (!f) return;
  serializeJson(d, f);
  f.close();
  Serial.printf("lastwords: %s%s%s\n", what, detail && *detail ? " — " : "", detail ? detail : "");
}

bool pm_lastwords_any() { return have_prev; }

void pm_lastwords_to_json(JsonObject out) {
  if (!have_prev) return;
  for (JsonPairConst kv : prev.as<JsonObjectConst>()) out[kv.key()] = kv.value();
}
