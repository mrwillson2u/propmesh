#include "pm_sync.h"
#include <Arduino.h>
#include <LittleFS.h>
#include <freertos/FreeRTOS.h>
#include "pm_show.h"
#include "pm_mesh.h"
#include "pm_link.h"
#include "pm_api.h"
#include "pm_channels.h"
#include "pm_sleep.h"
#include "pm_config_json.h"
#include "pm_reassembly.h"  // PM_API_MAX_BYTES
#include "pm_schedule.h"    // pm_mode_name
#include "pm_show_core.h"   // PM_MAX_SEQUENCES

// --- this board's own sync state (/sync.json) ---------------------------------
// show_synced: the conductor's show_at this board last caught up to.
// floods_at: the floods copy this board holds.
static const char *SYNC_PATH = "/sync.json";
static uint32_t show_synced, floods_at;

static uint32_t now_s() { return pm_wall().utc_ok ? (uint32_t)(pm_wall_utc_ms() / 1000) : 0; }

static void save_sync() {
  JsonDocument d;
  d["show_synced"] = show_synced;
  d["floods_at"] = floods_at;
  File f = LittleFS.open(SYNC_PATH, "w");
  if (!f) return;
  serializeJson(d, f);
  f.close();
}

static bool read_json(const char *path, JsonDocument &d) {
  File f = LittleFS.open(path, "r");
  if (!f) return false;
  bool ok = !deserializeJson(d, f);
  f.close();
  return ok;
}

static bool write_json(const char *path, const JsonDocument &d) {
  char tmp[40];
  snprintf(tmp, sizeof(tmp), "%s.tmp", path);
  File f = LittleFS.open(tmp, "w");
  if (!f) return false;
  bool ok = serializeJson(d, f) > 0;
  f.close();
  if (!ok) return false;
  LittleFS.remove(path);
  return LittleFS.rename(tmp, path);
}

// --- the bridge's copy of every board's part -----------------------------------
// /m/<node>_i.json   index: {"seqs": {"<id>": {"at": T, "del": true?}}, "rules_at": T}
// /m/<node>_s<id>.json  {"at": T, "sequence": {...}} — the console's request
// /m/<node>_r.json   {"at": T, "rules": [...]}
// /m/floods.json     {"at": T, "key": "…", "lights": [{"light": n, "label": "…"}]}
// Deletions stay in the index as tombstones, so a board that was away when
// a sequence was deleted deletes it too. Only what the console sends goes
// in: a board's existing parts are never deleted for being unknown here.
static uint32_t mirror_show_at, mirror_floods_at;
static bool is_bridge() { return pm_role() & PM_NODE_ROLE_BRIDGE; }

static void mpath(char *out, size_t n, uint32_t node, const char *what) {
  snprintf(out, n, "/m/%08lx_%s.json", (unsigned long)node, what);
}

static void mirror_note(uint32_t node, uint16_t seq, uint32_t at, bool del, bool rules) {
  char p[40];
  mpath(p, sizeof(p), node, "i");
  JsonDocument idx;
  read_json(p, idx);
  if (rules) idx["rules_at"] = at;
  else {
    char k[8];
    snprintf(k, sizeof(k), "%u", seq);
    JsonObject e = idx["seqs"][k].to<JsonObject>();
    e["at"] = at;
    if (del) e["del"] = true;
  }
  write_json(p, idx);
  if (at > mirror_show_at) mirror_show_at = at;
}

void pm_show_mirror(uint32_t dst, JsonObjectConst req) {
  const char *cmd = req["cmd"] | "";
  uint32_t at = req["at"] | 0UL;
  if (!at) at = now_s();
  if (!at) return;  // no clock anywhere: nothing to stamp a copy with
  char p[40];
  if (!strcmp(cmd, "set_sequence")) {
    uint16_t id = req["sequence"]["id"] | 0;
    if (!id) return;
    char what[12];
    snprintf(what, sizeof(what), "s%u", id);
    mpath(p, sizeof(p), dst, what);
    JsonDocument d;
    d["at"] = at;
    d["sequence"] = req["sequence"];
    if (write_json(p, d)) mirror_note(dst, id, at, false, false);
  } else if (!strcmp(cmd, "delete_sequence")) {
    uint16_t id = req["seq"] | 0;
    if (!id) return;
    char what[12];
    snprintf(what, sizeof(what), "s%u", id);
    mpath(p, sizeof(p), dst, what);
    LittleFS.remove(p);
    mirror_note(dst, id, at, true, false);
  } else if (!strcmp(cmd, "set_rules")) {
    mpath(p, sizeof(p), dst, "r");
    JsonDocument d;
    d["at"] = at;
    d["rules"] = req["rules"];
    if (write_json(p, d)) mirror_note(dst, 0, at, false, true);
  } else if (!strcmp(cmd, "set_config")) {
    // A config that holds the floods key is a sender's: its key and light
    // list are the floods for every sender.
    JsonObjectConst cfg = req["config"];
    const char *key = cfg["brmesh_key"] | "";
    if (!*key) return;
    JsonDocument d;
    d["at"] = at;
    d["key"] = key;
    JsonArray lights = d["lights"].to<JsonArray>();
    for (JsonObjectConst c : cfg["channels"].as<JsonArrayConst>()) {
      if (strcmp(c["kind"] | "", "BLE_LIGHT")) continue;
      JsonObject l = lights.add<JsonObject>();
      l["light"] = c["light"] | (c["index"] | 0);
      l["label"] = c["label"] | "";
    }
    // Only a real change is news: a sender's pins edited (same key, same
    // lights) must not make every sender rewrite its config.
    JsonDocument have;
    if (read_json("/m/floods.json", have) && !strcmp(have["key"] | "", key) && have["lights"] == d["lights"]) return;
    if (write_json("/m/floods.json", d) && at > mirror_floods_at) mirror_floods_at = at;
  }
}

static void mirror_scan() {
  File dir = LittleFS.open("/m");
  if (!dir || !dir.isDirectory()) { LittleFS.mkdir("/m"); return; }
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    String n = f.name();
    JsonDocument d;
    bool ok = !deserializeJson(d, f);
    f.close();
    if (!ok) continue;
    if (n.endsWith("_i.json")) {
      uint32_t r = d["rules_at"] | 0UL;
      if (r > mirror_show_at) mirror_show_at = r;
      for (JsonPairConst kv : d["seqs"].as<JsonObjectConst>()) {
        uint32_t a = kv.value()["at"] | 0UL;
        if (a > mirror_show_at) mirror_show_at = a;
      }
    } else if (n == "floods.json") {
      mirror_floods_at = d["at"] | 0UL;
    }
  }
}

bool pm_sync_handle(const char *cmd, JsonObjectConst req, JsonObject resp) {
  if (strncmp(cmd, "pull_", 5)) return false;
  if (!is_bridge()) { resp["ok"] = false; resp["error"] = "only a bridge keeps the show for other boards"; return true; }
  uint32_t node = strtoul(req["for"] | "0", nullptr, 16);
  char p[40];
  JsonDocument d;
  if (!strcmp(cmd, "pull_index")) {
    mpath(p, sizeof(p), node, "i");
    if (read_json(p, d)) {
      resp["seqs"] = d["seqs"];
      resp["rules_at"] = d["rules_at"] | 0UL;
    }
    resp["show_at"] = mirror_show_at;
  } else if (!strcmp(cmd, "pull_seq")) {
    char what[12];
    snprintf(what, sizeof(what), "s%u", (unsigned)(req["seq"] | 0));
    mpath(p, sizeof(p), node, what);
    if (!read_json(p, d)) { resp["ok"] = false; resp["error"] = "no copy of that sequence"; return true; }
    resp["at"] = d["at"];
    resp["sequence"] = d["sequence"];
  } else if (!strcmp(cmd, "pull_rules")) {
    mpath(p, sizeof(p), node, "r");
    if (!read_json(p, d)) { resp["ok"] = false; resp["error"] = "no copy of those triggers"; return true; }
    resp["at"] = d["at"];
    resp["rules"] = d["rules"];
  } else if (!strcmp(cmd, "pull_floods")) {
    if (!read_json("/m/floods.json", d)) { resp["ok"] = false; resp["error"] = "no floods copy"; return true; }
    resp["at"] = d["at"];
    resp["key"] = d["key"];
    resp["lights"] = d["lights"];
  } else {
    resp["ok"] = false;
    resp["error"] = "unknown command";
  }
  return true;
}

void pm_sync_config_saved(JsonObjectConst req) {
  // The console (or a sync) gave this board a floods key: that copy's stamp.
  if (!*(req["config"]["brmesh_key"] | "")) return;
  uint32_t at = req["at"] | 0UL;
  if (!at) at = now_s();
  if (at && at != floods_at) { floods_at = at; save_sync(); }
}

// --- following ----------------------------------------------------------------

static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool s_have;
static uint32_t s_conductor;
static pm_show_stamps_t s_latest;

static void on_stamps(uint32_t conductor, const pm_show_stamps_t &st) {
  portENTER_CRITICAL(&s_mux);
  s_conductor = conductor;
  s_latest = st;
  s_have = true;
  portEXIT_CRITICAL(&s_mux);
}

enum Ask : uint8_t { ASK_NONE, ASK_SCHED, ASK_FLOODS, ASK_INDEX, ASK_SEQ, ASK_RULES, ASK_PUSH };
static Ask s_busy = ASK_NONE;
static uint32_t s_next_ms;      // no new request before this (back-off)
static uint32_t s_pushed_sched, s_pushed_mode;
// The show pull in progress: the sequences to fetch (or delete), triggers.
static uint16_t q_ids[PM_MAX_SEQUENCES * 2];
static uint8_t q_n, q_i;
static bool q_rules, q_active;
static uint32_t q_target;
static uint32_t s_dst;

static void local(const char *cmd, JsonDocument &req) {
  req["cmd"] = cmd;
  JsonDocument resp;
  pm_api_handle(req.as<JsonObjectConst>(), resp.to<JsonObject>());
  if (resp["ok"].is<bool>() && !resp["ok"].as<bool>())
    Serial.printf("sync: %s refused here: %s\n", cmd, resp["error"] | "?");
}

static void done(bool ok) {
  s_busy = ASK_NONE;
  s_next_ms = millis() + (ok ? 300 : 10000);  // a failed pull waits; a good one moves on
}

static void on_reply(const char *json, size_t len, void *) {
  Ask what = s_busy;
  if (!json) { Serial.println("sync: the conductor didn't answer — retrying in 10 s"); done(false); return; }
  JsonDocument r;
  if (deserializeJson(r, json, len) || !(r["ok"] | true)) {
    // One missing copy mustn't stall the rest: skip it and carry on.
    if (what == ASK_SEQ || what == ASK_RULES) { if (what == ASK_RULES) q_rules = false; done(true); return; }
    done(false);
    return;
  }
  switch (what) {
    case ASK_SCHED: {
      JsonDocument req;
      req["schedule"] = r["schedule"];
      req["at"] = r["at"];
      local("set_schedule", req);
      Serial.printf("sync: schedule from the conductor (edited %lu)\n", (unsigned long)(r["at"] | 0UL));
      break;
    }
    case ASK_FLOODS: {
      // Already the same key and lights (e.g. the console wrote both)? Just
      // take the stamp — rewriting the config restarts every output.
      {
        JsonDocument mine;
        pm_config_to_json(pm_channels_config(), mine.to<JsonObject>());
        JsonDocument ml;
        JsonArray arr = ml.to<JsonArray>();
        for (JsonObjectConst c : mine["channels"].as<JsonArrayConst>()) {
          if (strcmp(c["kind"] | "", "BLE_LIGHT")) continue;
          JsonObject l = arr.add<JsonObject>();
          l["light"] = c["light"];
          l["label"] = c["label"];
        }
        if (!strcmp(mine["brmesh_key"] | "", r["key"] | "") && ml == r["lights"]) {
          floods_at = r["at"] | floods_at;
          save_sync();
          break;
        }
      }
      // Our config with the conductor's key and light list.
      JsonDocument req;
      JsonObject cfg = req["config"].to<JsonObject>();
      pm_config_to_json(pm_channels_config(), cfg, true);
      cfg["brmesh_key"] = r["key"];
      JsonArray ch = cfg["channels"];
      for (int i = (int)ch.size() - 1; i >= 0; i--)
        if (!strcmp(ch[i]["kind"] | "", "BLE_LIGHT")) ch.remove(i);
      for (JsonObjectConst l : r["lights"].as<JsonArrayConst>()) {
        JsonObject c = ch.add<JsonObject>();
        c["kind"] = "BLE_LIGHT";
        c["index"] = l["light"];
        c["light"] = l["light"];
        c["label"] = l["label"];
        c["pins"].to<JsonArray>();
      }
      req["at"] = r["at"];
      local("set_config", req);
      floods_at = r["at"] | floods_at;
      save_sync();
      Serial.println("sync: floods key and lights from the conductor");
      break;
    }
    case ASK_INDEX: {
      q_n = q_i = 0;
      q_rules = (r["rules_at"] | 0UL) > pm_show_rules_at();
      for (JsonPairConst kv : r["seqs"].as<JsonObjectConst>()) {
        uint16_t id = atoi(kv.key().c_str());
        uint32_t at = kv.value()["at"] | 0UL;
        bool del = kv.value()["del"] | false;
        int64_t mine = pm_show_seq_at(id);
        if (del) {
          if (mine >= 0 && (uint32_t)mine <= at) {
            JsonDocument req;
            req["seq"] = id;
            req["at"] = at;
            local("delete_sequence", req);
          }
        } else if ((mine < 0 || (uint32_t)mine < at) && q_n < sizeof(q_ids) / sizeof(q_ids[0])) {
          q_ids[q_n++] = id;
        }
      }
      q_target = r["show_at"] | 0UL;
      q_active = true;
      Serial.printf("sync: show — %u sequence(s)%s to fetch\n", q_n, q_rules ? " and the triggers" : "");
      break;
    }
    case ASK_SEQ: {
      JsonDocument req;
      req["sequence"] = r["sequence"];
      req["at"] = r["at"];
      local("set_sequence", req);
      break;
    }
    case ASK_RULES: {
      JsonDocument req;
      req["rules"] = r["rules"];
      req["at"] = r["at"];
      local("set_rules", req);
      q_rules = false;
      break;
    }
    default: break;
  }
  done(true);
}

static bool ask(Ask what, JsonDocument &req) {
  // On the heap, for the moment it takes pm_link_ask to copy it: the ESP32
  // builds have no static RAM to spare — a static 4 KB buffer here left
  // FreeRTOS unable to start its timer task, and the bridge boot-looped
  // (2026-10-12).
  size_t cap = measureJson(req) + 1;
  if (cap > PM_API_MAX_BYTES) { s_next_ms = millis() + 10000; return false; }
  char *buf = (char *)malloc(cap);
  if (!buf) { s_next_ms = millis() + 2000; return false; }
  size_t n = serializeJson(req, buf, cap);
  pm_sleep_hold(20000);  // a battery board stays listening for the answer
  bool ok = pm_link_ask(s_dst, buf, n, on_reply, nullptr);
  free(buf);
  if (!ok) { s_next_ms = millis() + 2000; return false; }
  s_busy = what;
  return true;
}

static void publish() {
  pm_show_stamps_t st;
  pm_show_stamps(st);
  st.show_at = is_bridge() ? mirror_show_at : 0;
  st.floods_at = is_bridge() ? mirror_floods_at : 0;
  pm_mesh_set_stamps(st);
}

void pm_sync_begin() {
  JsonDocument d;
  if (read_json(SYNC_PATH, d)) {
    show_synced = d["show_synced"] | 0UL;
    floods_at = d["floods_at"] | 0UL;
  }
  mirror_scan();
  pm_mesh_on_stamps(on_stamps);
}

void pm_sync_status(JsonObject out) {
  pm_show_stamps_t mine;
  pm_show_stamps(mine);
  out["sched_at"] = mine.sched_at;
  out["mode_at"] = mine.mode_at;
  out["show_synced"] = is_bridge() ? mirror_show_at : show_synced;
  out["floods_at"] = is_bridge() ? mirror_floods_at : floods_at;
}

void pm_sync_loop() {
  static uint32_t last_pub;
  uint32_t now = millis();
  if (now - last_pub >= 500) { last_pub = now; publish(); }

  if (pm_role() & PM_NODE_ROLE_CONDUCTOR) return;  // the conductor is the copy
  if (!s_have || s_busy != ASK_NONE || (int32_t)(now - s_next_ms) < 0) return;
  pm_show_stamps_t c, mine;
  portENTER_CRITICAL(&s_mux);
  c = s_latest;
  s_dst = s_conductor;
  portEXIT_CRITICAL(&s_mux);
  pm_show_stamps(mine);
  char hex[9];
  snprintf(hex, sizeof(hex), "%08lx", (unsigned long)pm_node_id());

  // 1. Mode: the conductor's hold, if newer — no request needed, it's all
  // in the beacon. If OURS is newer (STOP ALL reached us but not it), give
  // it to the conductor, and the rest of the mesh follows from there.
  pm_show_follow_mode(c.mode_manual, c.mode_at, c.mode_until);
  pm_show_stamps(mine);
  if (mine.mode_at > c.mode_at && mine.mode_manual != 0xFF && mine.mode_at != s_pushed_mode) {
    s_pushed_mode = mine.mode_at;
    JsonDocument req;
    req["cmd"] = "set_mode";
    req["mode"] = pm_mode_name(mine.mode_manual);
    req["at"] = mine.mode_at;
    Serial.println("sync: our mode is newer than the conductor's — sending it");
    ask(ASK_PUSH, req);
    return;
  }

  // 2. Schedule.
  if (c.sched_at > mine.sched_at) {
    JsonDocument req;
    req["cmd"] = "get_schedule";
    ask(ASK_SCHED, req);
    return;
  }
  if (mine.sched_at > c.sched_at && mine.sched_at != s_pushed_sched) {
    s_pushed_sched = mine.sched_at;
    JsonDocument own, req;
    own["cmd"] = "get_schedule";
    JsonDocument resp;
    pm_api_handle(own.as<JsonObjectConst>(), resp.to<JsonObject>());
    req["cmd"] = "set_schedule";
    req["schedule"] = resp["schedule"];
    req["at"] = mine.sched_at;
    Serial.println("sync: our schedule is newer than the conductor's — sending it");
    ask(ASK_PUSH, req);
    return;
  }

  // 3. Floods — only on a board that sends to them (holds a key).
  if (c.floods_at > floods_at && pm_channels_config().has_brmesh_key) {
    JsonDocument req;
    req["cmd"] = "pull_floods";
    ask(ASK_FLOODS, req);
    return;
  }

  // 4. Our part of the sequences and triggers, from a bridge's copy.
  if (q_active) {
    JsonDocument req;
    req["for"] = hex;
    if (q_i < q_n) {
      req["cmd"] = "pull_seq";
      req["seq"] = q_ids[q_i++];
      ask(ASK_SEQ, req);
      return;
    }
    if (q_rules) {
      req["cmd"] = "pull_rules";
      ask(ASK_RULES, req);
      return;
    }
    q_active = false;
    show_synced = q_target;
    save_sync();
    Serial.printf("sync: show up to date (edited %lu)\n", (unsigned long)show_synced);
    return;
  }
  if (c.show_at > show_synced) {
    JsonDocument req;
    req["cmd"] = "pull_index";
    req["for"] = hex;
    ask(ASK_INDEX, req);
  }
}
