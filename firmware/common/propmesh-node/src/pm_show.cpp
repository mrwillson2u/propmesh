#include <Arduino.h>
#include <LittleFS.h>
#include "pm_show.h"
#include "pm_show_core.h"
#include "pm_show_json.h"
#include "pm_channels.h"
#include "pm_link.h"
#include "pm_mesh.h"

static const char *PATH = "/show.json";
static const char *TMP = "/show.tmp";
#define CUE_COPY_GAP_MS 15
// A cue whose start time is further out than this means the clocks
// disagree (a node just rejoined): play now rather than wait.
#define MAX_FUTURE_US 5000000LL
// ...and one this late would dump every step at once: start now instead.
#define MAX_LATE_US 1000000LL

static PmShow show;  // ~19 KB; static so it isn't on a task stack
static PmPlayer player;
static PmTriggers triggers;
static PmCueMemory cues;
static bool armed = true;

static void hex(char out[9], uint32_t id) { snprintf(out, 9, "%08lx", (unsigned long)id); }

// --- storage -----------------------------------------------------------------

static bool save() {
  JsonDocument doc;
  doc["v"] = 1;
  JsonArray seqs = doc["sequences"].to<JsonArray>();
  for (uint8_t i = 0; i < show.seq_count; i++) pm_sequence_to_json(show.seqs[i], seqs.add<JsonObject>());
  pm_rules_to_json(show.rules, show.rule_count, doc["rules"].to<JsonArray>());
  File f = LittleFS.open(TMP, "w");
  if (!f) return false;
  bool ok = serializeJson(doc, f) > 0;
  f.close();
  if (!ok) return false;
  LittleFS.remove(PATH);
  return LittleFS.rename(TMP, PATH);
}

void pm_show_begin() {
  show.clear();
  File f = LittleFS.open(PATH, "r");
  if (!f) return;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) return;
  static PmSequence s;
  for (JsonVariantConst j : doc["sequences"].as<JsonArrayConst>())
    if (!pm_sequence_from_json(j, s)) show.put(s);
  if (pm_rules_from_json(doc["rules"].as<JsonArrayConst>(), show.rules, show.rule_count))
    show.rule_count = 0;
}

// --- playing -------------------------------------------------------------------

static void emit_cue(uint32_t src, uint16_t seq, uint16_t cue_id, bool played) {
  JsonDocument evt;
  char id[9];
  hex(id, src);
  evt["evt"] = "cue";
  evt["node"] = id;  // who fired it
  evt["seq"] = seq;
  evt["cue"] = cue_id;
  evt["armed"] = armed;
  evt["here"] = played;  // this (USB) node has steps for it and started them
  pm_link_event(evt);
}

static bool play(uint16_t seq_id, int64_t start_us, uint32_t offset_ms) {
  PmSequence *s = show.find(seq_id);
  if (!s || !armed) return false;
  int64_t now = esp_timer_get_time();
  if (start_us > now + MAX_FUTURE_US || start_us < now - MAX_LATE_US) start_us = now;
  return player.start(s, start_us, offset_ms);
}

void pm_show_fire(uint16_t seq, uint32_t offset_ms) {
  if (!armed) return;
  pm_cue_t c = {};
  do c.cue_id = (uint16_t)esp_random(); while (!c.cue_id);
  c.sequence_id = seq;
  c.target_group = PM_BROADCAST_GROUP;
  c.start_offset_ms = offset_ms;
  int64_t start_local = esp_timer_get_time() + (int64_t)PM_CUE_LEAD_MS * 1000;
  // Unsynced: fire_at 0 tells receivers "as soon as you hear it".
  c.fire_at_us = pm_time_synced() ? (uint64_t)(pm_mesh_time_us() + (int64_t)PM_CUE_LEAD_MS * 1000) : 0;
  // A CUE is one unacknowledged frame; send copies (same cue_id).
  for (int i = 0; i < PM_CUE_COPIES; i++) {
    for (int tries = 0; tries < 5 && !pm_send(PM_MSG_TYPE_CUE, &c, sizeof(c)); tries++) delay(2);
    if (i + 1 < PM_CUE_COPIES) delay(CUE_COPY_GAP_MS);
  }
  emit_cue(pm_node_id(), seq, c.cue_id, play(seq, start_local, offset_ms));
}

void pm_show_on_cue(uint32_t src, const pm_cue_t &c) {
  uint32_t now_ms = millis();
  if (cues.seen(src, c.cue_id, now_ms)) return;
  int64_t start = (c.fire_at_us && pm_time_synced())
      ? pm_local_time_us((int64_t)c.fire_at_us)
      : esp_timer_get_time();
  emit_cue(src, c.sequence_id, c.cue_id, play(c.sequence_id, start, c.start_offset_ms));
}

void pm_show_on_input(uint8_t index, bool active) {
  if (!armed) return;
  uint16_t seq = triggers.on_input(show, index, active, millis());
  if (seq) pm_show_fire(seq);
}

void pm_show_loop() {
  player.tick(esp_timer_get_time(), [](const PmStep &st) {
    pm_channel_set(st.kind, st.index, st.value);
  });
}

void pm_show_stop() { player.stop_all(); }

void pm_show_arm(bool on) {
  armed = on;
  if (!on) player.stop_all();
  triggers.reset();
}

bool pm_show_armed() { return armed; }

// --- API -------------------------------------------------------------------------

static void fail(JsonObject resp, const char *why) {
  resp["ok"] = false;
  resp["error"] = why;
}

bool pm_show_handle(const char *cmd, JsonObjectConst req, JsonObject resp) {
  if (!strcmp(cmd, "get_show")) {
    resp["armed"] = armed;
    JsonArray seqs = resp["sequences"].to<JsonArray>();
    for (uint8_t i = 0; i < show.seq_count; i++) {
      JsonObject j = seqs.add<JsonObject>();
      pm_sequence_summary(show.seqs[i], j);
      // A pin change can orphan steps; say so rather than fail silently.
      const char *bad = pm_check_sequence(show.seqs[i], pm_channels_config());
      if (bad) j["problem"] = bad;
    }
    pm_rules_to_json(show.rules, show.rule_count, resp["rules"].to<JsonArray>());
    return true;
  }
  if (!strcmp(cmd, "get_sequence")) {
    PmSequence *s = show.find(req["seq"] | 0);  // "seq", never "id": that is the request number
    if (!s) { fail(resp, "no such sequence on this node"); return true; }
    pm_sequence_to_json(*s, resp["sequence"].to<JsonObject>());
    return true;
  }
  if (!strcmp(cmd, "set_sequence")) {
    static PmSequence s;
    const char *err = pm_sequence_from_json(req["sequence"], s);
    if (!err) err = pm_check_sequence(s, pm_channels_config());
    if (err) { fail(resp, err); return true; }
    player.stop_all();  // the store moves under any running pointer
    if (!show.put(s)) { fail(resp, "this node holds 16 sequences already"); return true; }
    if (!save()) fail(resp, "could not save to flash");
    return true;
  }
  if (!strcmp(cmd, "delete_sequence")) {
    player.stop_all();
    show.remove(req["seq"] | 0);  // deleting what isn't there is fine
    if (!save()) fail(resp, "could not save to flash");
    return true;
  }
  if (!strcmp(cmd, "set_rules")) {
    static PmRule rules[PM_MAX_RULES];
    uint8_t n = 0;
    const char *err = pm_rules_from_json(req["rules"], rules, n);
    if (!err) err = pm_check_rules(rules, n, pm_channels_config());
    if (err) { fail(resp, err); return true; }
    memcpy(show.rules, rules, sizeof(rules));
    show.rule_count = n;
    triggers.reset();
    if (!save()) fail(resp, "could not save to flash");
    return true;
  }
  if (!strcmp(cmd, "cue")) {
    long seq = req["seq"] | 0L;
    if (seq < 1 || seq > 65535) { fail(resp, "seq must be 1-65535"); return true; }
    if (!armed) { fail(resp, "disarmed — arm the show first"); return true; }
    pm_show_fire((uint16_t)seq, req["offset_ms"] | 0);
    return true;
  }
  if (!strcmp(cmd, "arm")) {
    pm_show_arm(req["on"] | true);
    resp["armed"] = armed;
    return true;
  }
  return false;
}
