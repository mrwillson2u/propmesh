#include <new>
#include <Arduino.h>
#include <LittleFS.h>
#include "pm_show.h"
#include "pm_show_core.h"
#include "pm_show_json.h"
#include "pm_schedule.h"
#include "pm_schedule_json.h"
#include "pm_channels.h"
#include "pm_link.h"
#include "pm_mesh.h"

static const char *PATH = "/show.json";
static const char *TMP = "/show.tmp";
static const char *SCHED_PATH = "/schedule.json";
static const char *SCHED_TMP = "/schedule.tmp";
// A mode set by hand (STOP ALL, Off/Ambient/Armed) and when it ends, so a
// restart doesn't undo it — the board used to boot armed after a STOP ALL
// (2026-10-10). Written only when a button is pressed or its end is
// first worked out; removed when the hold ends.
static const char *MODE_PATH = "/mode.json";
// Outputs SET BY HAND (console sliders, the Floods panel, a porch-light
// relay switched on) come back on when the show does — floods used to
// stay dark after a re-arm (2026-10-10). Never what a sequence was in
// the middle of: a fogger relay caught mid-burst by STOP ALL must not be
// switched on again with no sequence left to turn it off. A sequence
// step on an output takes it off the by-hand list (the show took over);
// All off by hand empties it. In flash while off, so a restart keeps it.
static const char *PARKED_PATH = "/parked.json";
struct Parked { uint8_t kind, index; int32_t value; };
static Parked hand[PM_MAX_CHANNELS];    // last value set by hand, per output
static uint8_t hand_count;
static Parked parked[PM_MAX_CHANNELS];  // the by-hand outputs that were on when the show went off
static uint8_t parked_count;
static void load_parked();
static bool is_on(const Parked &p) { return p.kind == PM_CHANNEL_KIND_SERVO ? p.value >= 0 : p.value != 0; }

void pm_show_hand_set(uint8_t kind, uint8_t index, int32_t value) {
  for (uint8_t i = 0; i < hand_count; i++)
    if (hand[i].kind == kind && hand[i].index == index) { hand[i].value = value; return; }
  if (hand_count < PM_MAX_CHANNELS) hand[hand_count++] = {kind, index, value};
}
void pm_show_hand_clear() { hand_count = 0; }
static void hand_forget(uint8_t kind, uint8_t index) {
  for (uint8_t i = 0; i < hand_count; i++)
    if (hand[i].kind == kind && hand[i].index == index) { hand[i] = hand[--hand_count]; return; }
}
// The schedule is re-evaluated this often (and at once after any change):
// the sun maths is ~16 trig-heavy double evaluations, too slow to run
// every loop on a chip without a double FPU, and minutes are the unit.
#define SCHED_EVAL_MS 10000
// After boot with a schedule but no wall time yet: stay off this long
// waiting for the mesh's clock (a beacon is due within 5 s) — a power
// blip at 2 a.m. must not arm the yard. Then fall back to armed, so a
// yard with no clock source still has a show.
#define CLOCK_WAIT_MS 60000
#define CUE_COPY_GAP_MS 15
// A cue whose start time is further out than this means the clocks
// disagree (a node just rejoined): play now rather than wait.
#define MAX_FUTURE_US 5000000LL
// ...and one this late would dump every step at once: start now instead.
#define MAX_LATE_US 1000000LL

// ~31 KB, so on the heap — not a task stack (the 2026-10-05 crash loop),
// and not static either: the ESP32 caps statically allocated data near
// 124 KB and this one object was a quarter of it, so every feature added
// on 2026-10-07 tipped the link over (2026-10-08). Allocated in
// pm_show_begin(), NOT as a static initializer: global constructors run
// before FreeRTOS starts, when the only heap is what's left of the static
// data region (~128 KB minus ~96 KB of statics). Taking 31 KB of that
// left the scheduler nothing for its timer task and every ESP32 build
// boot-looped — "assert failed: vApplicationGetTimerTaskMemory"
// (2026-10-12, twice). Never freed.
static PmShow *showp;
#define show (*showp)
static PmPlayer player;
static PmTriggers triggers;
static PmCueMemory cues;

// --- mode and schedule (software-plan §4.1) --------------------------------
// off: nothing plays, outputs off. ambient: ambient sequences loop,
// sensor triggers ignored. armed: ambient + triggers. Boots armed when
// there is no schedule — a power cut never leaves an unscheduled show dead.
static uint8_t mode = PM_MODE_ARMED;
static const char *mode_reason = "no schedule";
static PmSchedule sched;
static PmScheduler scheduler;
static PmModeKeeper keeper;
static PmSchedEval last_ev;
static bool sched_dirty = true;
static int64_t saved_until = -1;  // hold end as written to MODE_PATH; -1 = no file
// When each mesh-wide document was last edited (UTC s, docs §6k). Newest
// wins everywhere: a set_* older than what a board holds is ignored, so a
// late or replayed request can never undo a newer edit.
static uint32_t sched_at, mode_at;
static uint32_t now_s() { return pm_wall().utc_ok ? (uint32_t)(pm_wall_utc_ms() / 1000) : 0; }
// The request's own stamp (the console's clock, or the copy being synced),
// else this board's clock, else 0 (no clock anywhere: apply, as before).
static uint32_t req_at(JsonObjectConst req) { uint32_t a = req["at"] | 0UL; return a ? a : now_s(); }
static bool stale(JsonObject resp, uint32_t at, uint32_t have) {
  if (!at || !have || at >= have) return false;
  resp["stale"] = true;  // ok, but ignored: this board holds a newer edit
  resp["have_at"] = have;
  return true;
}
static uint32_t last_eval_ms;
static int64_t loop_k[PM_MAX_SEQUENCES];  // last repeat started, per ambient sequence slot
static void reset_loops() { for (int64_t &k : loop_k) k = INT64_MIN; }

static void hex(char out[9], uint32_t id) { snprintf(out, 9, "%08lx", (unsigned long)id); }

// --- storage -----------------------------------------------------------------

static bool save() {
  JsonDocument doc;
  doc["v"] = 1;
  JsonArray seqs = doc["sequences"].to<JsonArray>();
  for (uint8_t i = 0; i < show.seq_count; i++) pm_sequence_to_json(show.seqs[i], seqs.add<JsonObject>());
  pm_rules_to_json(show.rules, show.rule_count, doc["rules"].to<JsonArray>());
  if (show.rules_at) doc["rules_at"] = show.rules_at;
  File f = LittleFS.open(TMP, "w");
  if (!f) return false;
  bool ok = serializeJson(doc, f) > 0;
  f.close();
  if (!ok) return false;
  LittleFS.remove(PATH);
  return LittleFS.rename(TMP, PATH);
}

static bool save_schedule() {
  JsonDocument doc;
  pm_schedule_to_json(sched, doc["schedule"].to<JsonObject>());
  if (sched_at) doc["at"] = sched_at;
  const PmWallClock &w = pm_wall();
  if (w.tz_ok) {  // SNTP brings UTC back after a power cut; the zone has to come from here
    doc["tz"]["offset_min"] = w.tz_min;
    doc["tz"]["next_change_s"] = w.tz_next_s;
    doc["tz"]["next_offset_min"] = w.tz_next_min;
  }
  File f = LittleFS.open(SCHED_TMP, "w");
  if (!f) return false;
  bool ok = serializeJson(doc, f) > 0;
  f.close();
  if (!ok) return false;
  LittleFS.remove(SCHED_PATH);
  return LittleFS.rename(SCHED_TMP, SCHED_PATH);
}

// The hold — or, once it has ended, just when the last one was set: the
// stamp must survive a restart, or a board would take an old STOP ALL
// from the conductor as news.
static void save_manual() {
  JsonDocument doc;
  doc["mode"] = keeper.holding() ? pm_mode_name(keeper.manual_mode()) : "none";
  doc["until_s"] = (double)keeper.until();  // double: exact for these values, no 64-bit JSON ints needed
  if (mode_at) doc["at"] = mode_at;
  File f = LittleFS.open(MODE_PATH, "w");
  if (!f) return;
  serializeJson(doc, f);
  f.close();
  saved_until = keeper.until();
}

static void load_manual() {
  File f = LittleFS.open(MODE_PATH, "r");
  if (!f) return;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  mode_at = err ? 0 : (doc["at"] | 0UL);
  uint8_t m = err ? 0xFF : pm_mode_from_str(doc["mode"] | "");
  if (m == 0xFF) return;  // "none": no hold, only its stamp
  int64_t until = (int64_t)(doc["until_s"] | 0.0);
  keeper.restore(m, until);
  mode = m;  // boot straight into it: no armed blip before the first evaluation
  saved_until = until;
}

static void load_schedule() {
  reset_loops();
  File f = LittleFS.open(SCHED_PATH, "r");
  if (!f) return;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) return;
  if (pm_schedule_from_json(doc["schedule"], sched)) sched = PmSchedule();
  sched_at = doc["at"] | 0UL;
  if (doc["tz"].is<JsonObjectConst>() && !pm_wall().tz_ok)
    pm_wall().set_tz(doc["tz"]["offset_min"] | 0, doc["tz"]["next_change_s"] | 0UL, doc["tz"]["next_offset_min"] | 0);
}

void pm_show_begin() {
  if (!showp) showp = new PmShow();
  load_schedule();
  load_manual();
  load_parked();
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
  show.rules_at = doc["rules_at"] | 0UL;
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
  evt["armed"] = mode == PM_MODE_ARMED;
  evt["mode"] = pm_mode_name(mode);
  evt["here"] = played;  // this (USB) node has steps for it and started them
  pm_link_event(evt);
}

static bool play(uint16_t seq_id, int64_t start_us, uint32_t offset_ms) {
  PmSequence *s = show.find(seq_id);
  if (!s || mode == PM_MODE_OFF) return false;
  int64_t now = esp_timer_get_time();
  if (start_us > now + MAX_FUTURE_US || start_us < now - MAX_LATE_US) start_us = now;
  return player.start(s, start_us, offset_ms);
}

// A cue for a mesh with a board listening in windows (docs §6f): the lead
// covers one listen interval, and copies go out every 100 ms across it
// (each with a fresh frame seq so relays pass every one; the cue_id
// dedups at the receiver). Sent from pm_show_loop, never blocking.
#define LEAF_COPY_GAP_MS 100
static struct { bool used; pm_cue_t cue; uint8_t left; uint32_t next_ms; } cue_repeat;

static void chain_from(uint16_t seq);
void pm_show_fire(uint16_t seq, uint32_t offset_ms) {
  if (mode == PM_MODE_OFF) return;
  pm_cue_t c = {};
  do c.cue_id = (uint16_t)esp_random(); while (!c.cue_id);
  c.sequence_id = seq;
  c.target_group = PM_BROADCAST_GROUP;
  c.start_offset_ms = offset_ms;
  uint16_t leaf = pm_mesh_leaf_listen_ms();
  uint32_t lead_ms = leaf ? leaf + 150 : PM_CUE_LEAD_MS;
  int64_t start_local = esp_timer_get_time() + (int64_t)lead_ms * 1000;
  // Unsynced: fire_at 0 tells receivers "as soon as you hear it".
  c.fire_at_us = pm_time_synced() ? (uint64_t)(pm_mesh_time_us() + (int64_t)lead_ms * 1000) : 0;
  // A CUE is one unacknowledged frame; send copies (same cue_id).
  for (int i = 0; i < PM_CUE_COPIES; i++) {
    for (int tries = 0; tries < 5 && !pm_send(PM_MSG_TYPE_CUE, &c, sizeof(c)); tries++) delay(2);
    if (i + 1 < PM_CUE_COPIES) delay(CUE_COPY_GAP_MS);
  }
  if (leaf) cue_repeat = { true, c, (uint8_t)(leaf / LEAF_COPY_GAP_MS + 1), millis() + LEAF_COPY_GAP_MS };
  emit_cue(pm_node_id(), seq, c.cue_id, play(seq, start_local, offset_ms));
  chain_from(seq);
}

void pm_show_on_cue(uint32_t src, const pm_cue_t &c) {
  uint32_t now_ms = millis();
  if (cues.seen(src, c.cue_id, now_ms)) return;
  int64_t start = (c.fire_at_us && pm_time_synced())
      ? pm_local_time_us((int64_t)c.fire_at_us)
      : esp_timer_get_time();
  emit_cue(src, c.sequence_id, c.cue_id, play(c.sequence_id, start, c.start_offset_ms));
  chain_from(c.sequence_id);
}

void pm_show_on_input(uint8_t index, bool active) {
  if (mode != PM_MODE_ARMED) return;  // sensors scare only while armed
  triggers.on_input(show, index, active, millis());  // due rules fire from pm_show_loop
}

// A sequence started here or anywhere: "after X" rules arm (in ambient
// too — a chain off an ambient loop is the point of them).
static void chain_from(uint16_t seq) {
  if (mode == PM_MODE_OFF) return;
  triggers.on_cue(show, seq, millis());
}

// Rules whose delay ran out: fire their sequences.
static void fire_due_rules() {
  uint8_t idx[PM_MAX_RULES];
  uint8_t n = triggers.due(millis(), idx, PM_MAX_RULES);
  for (uint8_t k = 0; k < n; k++) {
    uint16_t seqs[PM_RULE_MAX_SEQS];
    uint8_t m = triggers.pick(show, idx[k], esp_random(), seqs);
    for (uint8_t j = 0; j < m; j++) pm_show_fire(seqs[j]);
  }
}

static void park_outputs() {
  parked_count = 0;
  for (uint8_t i = 0; i < hand_count; i++)
    if (is_on(hand[i]) && pm_find_channel(pm_channels_config(), hand[i].kind, hand[i].index)) parked[parked_count++] = hand[i];
  if (!parked_count) { LittleFS.remove(PARKED_PATH); return; }
  JsonDocument doc;
  JsonArray a = doc.to<JsonArray>();
  for (uint8_t i = 0; i < parked_count; i++) {
    JsonArray e = a.add<JsonArray>();
    e.add(parked[i].kind); e.add(parked[i].index); e.add(parked[i].value);
  }
  File f = LittleFS.open(PARKED_PATH, "w");
  if (f) { serializeJson(doc, f); f.close(); }
}

static void load_parked() {
  File f = LittleFS.open(PARKED_PATH, "r");
  if (!f) return;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) return;
  parked_count = 0;
  for (JsonArrayConst e : doc.as<JsonArrayConst>())
    if (parked_count < PM_MAX_CHANNELS) parked[parked_count++] = {(uint8_t)(e[0] | 0), (uint8_t)(e[1] | 0), e[2] | (int32_t)0};
}

// Back on: each parked output that is still off returns to its value. One
// changed by hand while the show was off is left as set.
static void unpark_outputs() {
  for (uint8_t i = 0; i < parked_count; i++) {
    int32_t now = pm_channel_get(parked[i].kind, parked[i].index);
    bool off = parked[i].kind == PM_CHANNEL_KIND_SERVO ? now < 0 : now == 0;
    if (off) { pm_channel_set(parked[i].kind, parked[i].index, parked[i].value); pm_show_hand_set(parked[i].kind, parked[i].index, parked[i].value); }
  }
  if (parked_count) LittleFS.remove(PARKED_PATH);
  parked_count = 0;
}

static void apply_mode(uint8_t next) {
  if (next == mode) return;
  uint8_t was = mode;
  mode = next;
  if (next == PM_MODE_OFF) {
    player.stop_all();
    park_outputs();  // before they go dark
    pm_channels_all_off();
  }
  if (was == PM_MODE_OFF) {
    unpark_outputs();
    reset_loops();     // ambient sequences start straight away (and may then set the lights themselves)
  }
  if (next == PM_MODE_ARMED) triggers.reset();
  JsonDocument evt;
  char id[9];
  hex(id, pm_node_id());
  evt["evt"] = "mode";
  evt["node"] = id;
  evt["mode"] = pm_mode_name(mode);
  evt["reason"] = mode_reason;
  pm_link_event(evt);
}

static void eval_mode() {
  const PmWallClock &w = pm_wall();
  int64_t utc_s = w.utc_ok ? pm_wall_utc_ms() / 1000 : 0;
  bool scheduled = sched.active() && w.ok();
  if (scheduled) last_ev = scheduler.eval(sched, utc_s, w.tz_at(utc_s));
  uint8_t next;
  if (sched.active() && !w.ok() && !keeper.holding() && millis() < CLOCK_WAIT_MS) {
    next = PM_MODE_OFF;
    mode_reason = "waiting for the clock";
  } else {
    next = keeper.update(scheduled, last_ev, utc_s, sched.manual_max_min);
    mode_reason = keeper.holding() ? "manual" : scheduled ? "schedule" : sched.active() ? "no clock" : "no schedule";
  }
  // Keep the saved hold in step: its end once known, "none" once over.
  if (!keeper.holding() && saved_until >= 0) { save_manual(); saved_until = -1; }
  else if (keeper.holding() && keeper.until() != saved_until) save_manual();
  apply_mode(next);
}

// Start each ambient sequence's repeat when its period comes round on
// the mesh clock — the same instant on every node.
static void ambient_tick() {
  if (mode == PM_MODE_OFF) return;
  bool synced = pm_time_synced();
  int64_t mesh_ms = (synced ? pm_mesh_time_us() : esp_timer_get_time()) / 1000;
  for (uint8_t i = 0; i < show.seq_count; i++) {
    PmSequence &q = show.seqs[i];
    if (!q.ambient) continue;
    uint32_t period = q.period_ms();
    int64_t k = pm_loop_index(mesh_ms, period);
    if (k == loop_k[i]) continue;
    int64_t start_us = k * (int64_t)period * 1000;
    if (synced) start_us = pm_local_time_us(start_us);
    if (player.start(&q, start_us)) loop_k[i] = k;  // a full player tries again next pass
  }
}

void pm_show_loop() {
  if (cue_repeat.used && (int32_t)(millis() - cue_repeat.next_ms) >= 0) {
    pm_send(PM_MSG_TYPE_CUE, &cue_repeat.cue, sizeof(cue_repeat.cue));
    cue_repeat.next_ms += LEAF_COPY_GAP_MS;
    if (!--cue_repeat.left) cue_repeat.used = false;
  }
  if (sched_dirty || (uint32_t)(millis() - last_eval_ms) >= SCHED_EVAL_MS) {
    sched_dirty = false;
    last_eval_ms = millis();
    eval_mode();
  }
  ambient_tick();
  if (mode != PM_MODE_OFF) fire_due_rules();
  player.tick(esp_timer_get_time(), [](const PmStep &st, int64_t start_us) {
    hand_forget(st.kind, st.index);  // the show drives this output now
    if (st.dur_ms) pm_channel_ramp(st.kind, st.index, st.value, start_us, st.dur_ms, st.ease_in, st.ease_out);
    else pm_channel_set(st.kind, st.index, st.value);
  });
}

void pm_show_stop() {
  player.stop_all();
  pm_channels_freeze();
}

void pm_show_set_mode(uint8_t m) {
  mode_at = now_s();
  keeper.manual(m);
  save_manual();
  eval_mode();
}

// --- the show follows the conductor (docs §6k) ------------------------------------

void pm_show_stamps(pm_show_stamps_t &out) {
  // A schedule saved before stamps existed (2026-10-12) counts as the
  // oldest possible edit: a board with none pulls it, any real edit wins.
  if (!sched_at && sched.active()) sched_at = 1;
  out.mode_manual = keeper.holding() ? keeper.manual_mode() : 0xFF;
  out.mode_at = mode_at;
  out.mode_until = keeper.holding() && keeper.until() > 0 ? (uint32_t)keeper.until() : 0;
  out.sched_at = sched_at;
}

void pm_show_follow_mode(uint8_t manual, uint32_t at, uint32_t until) {
  if (!at || at <= mode_at) return;
  mode_at = at;
  if (manual == 0xFF) keeper.clear();
  else keeper.restore(manual, until);
  save_manual();
  saved_until = keeper.holding() ? keeper.until() : -1;
  eval_mode();
}

int64_t pm_show_seq_at(uint16_t id) {
  PmSequence *q = show.find(id);
  return q ? (int64_t)q->at : -1;
}
uint32_t pm_show_rules_at() { return show.rules_at; }
void pm_show_arm(bool on) { pm_show_set_mode(on ? PM_MODE_ARMED : PM_MODE_OFF); }
bool pm_show_armed() { return mode == PM_MODE_ARMED; }
uint8_t pm_show_mode() { return mode; }

// --- API -------------------------------------------------------------------------

static void fail(JsonObject resp, const char *why) {
  resp["ok"] = false;
  resp["error"] = why;
}

// The mode, why, and what the schedule does next — every reply that can
// change it carries this, and get_show for the console's status line.
static void put_mode(JsonObject resp);
void pm_show_put_mode(JsonObject resp) { put_mode(resp); }
static void put_mode(JsonObject resp) {
  const PmWallClock &w = pm_wall();
  resp["mode"] = pm_mode_name(mode);
  resp["reason"] = mode_reason;
  // Outputs on right now (a light, a relay, a held servo, a motor): the
  // console lights STOP ALL whenever anything anywhere is on — even with
  // the show off, e.g. floods switched on by hand (2026-10-11).
  const PmNodeConfig &cfg = pm_channels_config();
  uint8_t on = 0;
  for (uint8_t i = 0; i < cfg.channel_count; i++) {
    const PmChannelCfg &c = cfg.channels[i];
    if (c.kind == PM_CHANNEL_KIND_DIGITAL_IN || c.kind == PM_CHANNEL_KIND_BATTERY) continue;  // inputs
    int32_t v = pm_channel_get(c.kind, c.index);
    if (c.kind == PM_CHANNEL_KIND_SERVO ? v >= 0 : v != 0) on++;
  }
  resp["outputs_on"] = on;
  resp["clock"] = w.ok();
  resp["scheduled"] = sched.active();
  if (w.utc_ok) {
    int64_t utc_s = pm_wall_utc_ms() / 1000;
    resp["utc_s"] = utc_s;
    if (w.tz_ok) resp["tz_min"] = w.tz_at(utc_s);
  }
  if (keeper.holding() && keeper.until()) resp["hold_until_s"] = keeper.until();
  if (sched.active() && w.ok()) {
    if (last_ev.next_s) { resp["next_s"] = last_ev.next_s; resp["next_mode"] = pm_mode_name(last_ev.next_mode); }
    if (last_ev.sun_s[PM_SUN_SET]) resp["sunset_s"] = last_ev.sun_s[PM_SUN_SET];
    if (last_ev.sun_s[PM_SUN_RISE]) resp["sunrise_s"] = last_ev.sun_s[PM_SUN_RISE];
  }
}

uint32_t pm_show_next_change_s() {
  return (sched.active() && pm_wall().ok()) ? last_ev.next_s : 0;
}

bool pm_show_handle(const char *cmd, JsonObjectConst req, JsonObject resp) {
  if (!strcmp(cmd, "get_show")) {
    resp["armed"] = mode == PM_MODE_ARMED;
    put_mode(resp);
    JsonArray seqs = resp["sequences"].to<JsonArray>();
    for (uint8_t i = 0; i < show.seq_count; i++) {
      JsonObject j = seqs.add<JsonObject>();
      pm_sequence_summary(show.seqs[i], j);
      // A pin change can orphan steps; say so rather than fail silently.
      const char *bad = pm_check_sequence(show.seqs[i], pm_channels_config());
      if (bad) j["problem"] = bad;
    }
    pm_rules_to_json(show.rules, show.rule_count, resp["rules"].to<JsonArray>());
    JsonObject sync = resp["sync"].to<JsonObject>();  // what this board holds, for the console
    sync["sched_at"] = sched_at;
    sync["mode_at"] = mode_at;
    sync["rules_at"] = show.rules_at;
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
    if (req["at"].is<uint32_t>() || !s.at) s.at = req_at(req);
    PmSequence *have = show.find(s.id);
    if (have && stale(resp, s.at, have->at)) return true;
    player.stop_all();  // the store moves under any running pointer
    reset_loops();
    if (!show.put(s)) { fail(resp, "this node holds 16 sequences already"); return true; }
    if (!save()) fail(resp, "could not save to flash");
    return true;
  }
  if (!strcmp(cmd, "delete_sequence")) {
    PmSequence *have = show.find(req["seq"] | 0);
    if (have && stale(resp, req_at(req), have->at)) return true;
    player.stop_all();
    reset_loops();
    show.remove(req["seq"] | 0);  // deleting what isn't there is fine
    if (!save()) fail(resp, "could not save to flash");
    return true;
  }
  if (!strcmp(cmd, "set_rules")) {
    // On the heap for the call: static RAM on the ESP32 builds is at the
    // edge where FreeRTOS can't start (docs §6k, 2026-10-12).
    PmRule *rules = new (std::nothrow) PmRule[PM_MAX_RULES];
    if (!rules) { fail(resp, "out of memory"); return true; }
    uint8_t n = 0;
    const char *err = pm_rules_from_json(req["rules"], rules, n);
    if (!err) err = pm_check_rules(rules, n, pm_channels_config());
    if (err) { delete[] rules; fail(resp, err); return true; }
    uint32_t at = req_at(req);
    if (stale(resp, at, show.rules_at)) { delete[] rules; return true; }
    memcpy(show.rules, rules, sizeof(PmRule) * PM_MAX_RULES);
    delete[] rules;
    show.rule_count = n;
    show.rules_at = at;
    triggers.reset();
    if (!save()) fail(resp, "could not save to flash");
    return true;
  }
  if (!strcmp(cmd, "cue")) {
    long seq = req["seq"] | 0L;
    if (seq < 1 || seq > 65535) { fail(resp, "seq must be 1-65535"); return true; }
    if (mode == PM_MODE_OFF) { fail(resp, "the show is off — arm it, or switch to ambient"); return true; }
    pm_show_fire((uint16_t)seq, req["offset_ms"] | 0);
    return true;
  }
  if (!strcmp(cmd, "arm")) {  // the pre-schedule API: armed / off, held like set_mode
    uint32_t at = req_at(req);
    if (stale(resp, at, mode_at)) { put_mode(resp); return true; }
    pm_show_arm(req["on"] | true);
    mode_at = at;
    save_manual();
    resp["armed"] = mode == PM_MODE_ARMED;
    put_mode(resp);
    return true;
  }
  if (!strcmp(cmd, "set_mode")) {
    uint8_t m = pm_mode_from_str(req["mode"] | "");
    if (m == 0xFF) { fail(resp, "mode must be off, ambient or armed"); return true; }
    uint32_t at = req_at(req);
    if (stale(resp, at, mode_at)) { put_mode(resp); return true; }
    pm_show_set_mode(m);
    mode_at = at;
    save_manual();
    put_mode(resp);
    return true;
  }
  if (!strcmp(cmd, "set_clock")) {
    // From the console's device clock on every connect. utc_ms as a double:
    // exact to the millisecond for centuries, and every JSON reader agrees.
    double utc = req["utc_ms"] | 0.0;
    if (utc < 1.7e12) { fail(resp, "utc_ms missing or before 2023"); return true; }
    PmWallClock &w = pm_wall();
    w.set_utc((int64_t)utc, esp_timer_get_time() / 1000);
    if (req["tz_offset_min"].is<int>()) {
      int16_t tz = req["tz_offset_min"], nx = req["tz_next_offset_min"] | (int)tz;
      uint32_t at = req["tz_next_change_s"] | 0UL;
      bool changed = !w.tz_ok || w.tz_min != tz || w.tz_next_s != at || w.tz_next_min != nx;
      w.set_tz(tz, at, nx);
      if (changed) save_schedule();
    }
    sched_dirty = true;
    eval_mode();
    put_mode(resp);
    return true;
  }
  if (!strcmp(cmd, "set_schedule")) {
    PmSchedule s;
    const char *err = pm_schedule_from_json(req["schedule"], s);
    if (err) { fail(resp, err); return true; }
    uint32_t at = req_at(req);
    if (stale(resp, at, sched_at)) { put_mode(resp); return true; }
    sched = s;
    sched_at = at;
    if (!save_schedule()) fail(resp, "could not save to flash");
    eval_mode();
    put_mode(resp);
    return true;
  }
  if (!strcmp(cmd, "get_schedule")) {
    pm_schedule_to_json(sched, resp["schedule"].to<JsonObject>());
    resp["at"] = sched_at;  // a follower syncing from the conductor keeps the same stamp
    put_mode(resp);
    return true;
  }
  return false;
}
