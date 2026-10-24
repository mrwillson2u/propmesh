#include "pm_radio.h"
#include <Arduino.h>
#include <esp_err.h>
#include "pm_mesh.h"
#include "pm_sleep.h"
#include "pm_wifi.h"
#include "pm_lastwords.h"
#include "pm_api.h"

static uint32_t s_rebuilds, s_last_ms;

bool pm_radio_rebuild(const char *why) {
  const pm_stats_t *st = pm_stats();
  char detail[200];
  snprintf(detail, sizeof(detail), "%s; send errors %lu (last %s); inflight %lu; lost %lu; alloc fails %lu; heap %lu/%lu",
           why, (unsigned long)st->tx_err, st->last_tx_err ? esp_err_to_name(st->last_tx_err) : "none",
           (unsigned long)pm_mesh_tx_inflight(), (unsigned long)st->tx_lost, (unsigned long)pm_api_alloc_failures(),
           (unsigned long)ESP.getFreeHeap(), (unsigned long)ESP.getMaxAllocHeap());
  pm_lastwords_note("radio rebuilt", detail);
  Serial.printf("radio: rebuilding — %s\n", detail);
  bool ok = pm_mesh_recover(pm_mesh_channel());
  pm_sleep_radio_reapply();
  pm_wifi_rejoin();
  pm_mesh_unheard_reset();
  s_rebuilds++;
  s_last_ms = millis();
  Serial.printf("radio: %s\n", ok ? "back" : "ESP-NOW did not come back");
  return ok;
}
uint32_t pm_radio_rebuilds() { return s_rebuilds; }
uint32_t pm_radio_last_rebuild_ms() { return s_last_ms; }
