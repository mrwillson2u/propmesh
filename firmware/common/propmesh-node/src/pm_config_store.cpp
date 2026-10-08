#include <Arduino.h>
#include <LittleFS.h>
#include "pm_config_store.h"
#include "pm_config_json.h"

static const char *PATH = "/config.json";
static const char *TMP = "/config.tmp";

bool pm_store_begin() { return LittleFS.begin(true); }

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
