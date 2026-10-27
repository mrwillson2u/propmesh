#include <Arduino.h>
#include <LittleFS.h>
#include "pm_config_store.h"
#include "pm_config_json.h"

static const char *PATH = "/config.json";
static const char *TMP = "/config.tmp";

bool pm_store_begin() { return LittleFS.begin(true); }

static const char *LIGHTS_PATH = "/lights.json";

uint8_t pm_store_lights_load(uint8_t ids[], int32_t vals[], uint8_t max) {
  File f = LittleFS.open(LIGHTS_PATH, "r");
  if (!f) return 0;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) return 0;
  uint8_t n = 0;
  for (JsonPairConst kv : doc.as<JsonObjectConst>()) {
    if (n >= max) break;
    int id = atoi(kv.key().c_str());
    if (id < 1 || id > 255) continue;
    ids[n] = (uint8_t)id;
    vals[n] = kv.value().as<int32_t>();
    n++;
  }
  return n;
}

bool pm_store_lights_save(const uint8_t ids[], const int32_t vals[], uint8_t n) {
  JsonDocument doc;
  char key[4];
  for (uint8_t i = 0; i < n; i++) {
    snprintf(key, sizeof(key), "%u", ids[i]);
    doc[key] = vals[i];
  }
  File f = LittleFS.open(LIGHTS_PATH, "w");  // tiny: a torn write just loses the memory, never the config
  if (!f) return false;
  bool ok = serializeJson(doc, f) > 0;
  f.close();
  return ok;
}

static const char *CH_PATH = "/channel";
uint8_t pm_store_channel_load() {
  File f = LittleFS.open(CH_PATH, "r");
  if (!f) return 0;
  int ch = f.parseInt();
  f.close();
  return ch >= 1 && ch <= 13 ? (uint8_t)ch : 0;
}
void pm_store_channel_save(uint8_t ch) {
  if (pm_store_channel_load() == ch) return;
  File f = LittleFS.open(CH_PATH, "w");
  if (!f) return;
  f.print(ch);
  f.close();
}

// The board has browned out at full radio power (pm_mesh_low_power).
static const char *LOW_PATH = "/radio_low";
bool pm_store_radio_low() { return LittleFS.exists(LOW_PATH); }
void pm_store_radio_low_save() {
  if (pm_store_radio_low()) return;
  File f = LittleFS.open(LOW_PATH, "w");
  if (f) { f.print(1); f.close(); }
}

bool pm_store_load(PmNodeConfig &out) {
  out = PmNodeConfig();
  File f = LittleFS.open(PATH, "r");
  if (!f) return false;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err || pm_config_from_json(doc.as<JsonVariantConst>(), out)) {
    out = PmNodeConfig();
    return false;
  }
  return true;
}

bool pm_store_save(const PmNodeConfig &cfg) {
  JsonDocument doc;
  pm_config_to_json(cfg, doc.to<JsonObject>(), true);  // the file keeps the WiFi password
  File f = LittleFS.open(TMP, "w");
  if (!f) return false;
  bool ok = serializeJson(doc, f) > 0;
  f.close();
  if (!ok) return false;
  LittleFS.remove(PATH);
  return LittleFS.rename(TMP, PATH);
}
