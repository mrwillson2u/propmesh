#include <Arduino.h>
#include <LittleFS.h>
#include "pm_config_store.h"
#include "pm_config_json.h"

static const char *PATH = "/config.json";
static const char *TMP = "/config.tmp";

bool pm_store_begin() { return LittleFS.begin(true); }

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
  pm_config_to_json(cfg, doc.to<JsonObject>());
  File f = LittleFS.open(TMP, "w");
  if (!f) return false;
  bool ok = serializeJson(doc, f) > 0;
  f.close();
  if (!ok) return false;
  LittleFS.remove(PATH);
  return LittleFS.rename(TMP, PATH);
}
