// The bridge's copies of every board's hello and settings — pm_copies.h.
//
// Files (LittleFS, beside the show copies in /m):
//   /m/<node>_c.json  {"hello": {...}, "config": {...}, "at": T, "read": S, "rev": n}
//                     at: the settings' stamp (0 = unknown); read: UTC s the
//                     copy was last confirmed; rev: bumped on every change.
//   /m/<node>_w.json  {"config": {...}, "base": {...}, "base_at": T, "at": T,
//                      "saved": S, "stuck": true?, "error": "..."?}
//                     a change waiting for the board, and the copy it was
//                     edited from.
//   /m/wake.json      ["<node>", ...] — "stay awake next time".
// RAM: one small slot per board (MAX_COPIES), so a heartbeat is decided
// without touching flash; files are written only when something changes.
#include "pm_copies.h"
#include "pm_copies_core.h"
#include <Arduino.h>
#include <LittleFS.h>
#include "pm_link.h"
#include "pm_mesh.h"
#include "pm_reassembly.h"  // PM_API_MAX_BYTES

#define MAX_COPIES 32
// Leave this much of the flash area free for the show copies (sequences,
// triggers): they matter more on the night, so the copies stop first.
#define FS_RESERVE 24576
#define RETRY_MS 30000          // a visit that got no answer: not again before this
#define CONSOLE_RECENT_MS 600000  // a console request this recent keeps a board awake
#define WAKE_MIN 10             // "stay awake next time", minutes

enum : uint8_t { F_COPY = 1, F_WAIT = 2, F_STUCK = 4, F_WAKE = 8, F_FULL = 16, F_HELLO = 32 };
struct Slot {
  uint32_t id;
  uint32_t at;        // the copy's stamp
  uint32_t rev;
  uint32_t base_at;   // the waiting change's base stamp
  uint32_t want_at;   // the waiting change's own stamp
  uint32_t seen_s;    // last heard, UTC s (RAM only: a heartbeat never writes flash)
  uint32_t not_before_ms;
  uint32_t woke_ms;   // when this bridge served its "stay awake next time"
  uint8_t flags;
};
static Slot s_slots[MAX_COPIES];
static bool s_began;

static uint32_t now_s() { return pm_wall().utc_ok ? (uint32_t)(pm_wall_utc_ms() / 1000) : 0; }
bool pm_copies_active() { return s_began && (pm_role() & PM_NODE_ROLE_BRIDGE); }

static Slot *find(uint32_t id, bool make) {
  Slot *empty = nullptr;
  for (Slot &s : s_slots) {
    if (s.id == id) return &s;
    if (!s.id && !empty) empty = &s;
  }
  if (!make || !empty) return nullptr;
  *empty = Slot();
  empty->id = id;
  return empty;
}

static void path(char *out, size_t n, uint32_t id, char what) {
  snprintf(out, n, "/m/%08lx_%c.json", (unsigned long)id, what);
}
static bool read_doc(const char *p, JsonDocument &d, JsonDocument *filter = nullptr) {
  File f = LittleFS.open(p, "r");
  if (!f) return false;
  bool ok = filter ? !deserializeJson(d, f, DeserializationOption::Filter(*filter)) : !deserializeJson(d, f);
  f.close();
  return ok;
}
static bool room() { return LittleFS.totalBytes() - LittleFS.usedBytes() >= FS_RESERVE; }
static bool write_doc(const char *p, const JsonDocument &d, bool growing) {
  if (growing && !room()) return false;
  char tmp[40];
  snprintf(tmp, sizeof(tmp), "%s.tmp", p);
  File f = LittleFS.open(tmp, "w");
  if (!f) return false;
  bool ok = serializeJson(d, f) > 0;
  f.close();
  if (!ok) { LittleFS.remove(tmp); return false; }
  LittleFS.remove(p);
  return LittleFS.rename(tmp, p);
}

static void save_wake() {
  JsonDocument d;
  JsonArray a = d.to<JsonArray>();
  char hex[9];
  for (Slot &s : s_slots)
    if (s.id && (s.flags & F_WAKE)) { snprintf(hex, sizeof(hex), "%08lx", (unsigned long)s.id); a.add(hex); }
  if (a.size()) write_doc("/m/wake.json", d, false);
  else LittleFS.remove("/m/wake.json");
}

// Every console hears what changed, so the list and pages update live.
static void announce(const Slot &s, const char *what, const char *error = nullptr) {
  JsonDocument e;
  char hex[9];
  snprintf(hex, sizeof(hex), "%08lx", (unsigned long)s.id);
  e["evt"] = "copy";
  e["node"] = hex;
  e["what"] = what;  // "copy" | "waiting" | "delivered" | "stuck" | "cancelled" | "wake" | "full"
  e["rev"] = s.rev;
  e["at"] = s.at;
  e["waiting"] = !!(s.flags & F_WAIT);
  if (s.flags & F_STUCK) e["stuck"] = true;
  if (s.flags & F_WAKE) e["wake"] = true;
  if (error) e["error"] = error;
  pm_link_event(e);
}

// ---- the copy file --------------------------------------------------------------

// Merge into the copy: a hello (list fields only), and/or settings with
// their stamp. Written only when something the console shows changed.
static void store(Slot &s, JsonObjectConst hello, JsonObjectConst config, bool has_config, uint32_t at) {
  char p[32];
  path(p, sizeof(p), s.id, 'c');
  JsonDocument d;
  bool had = read_doc(p, d);
  bool changed = false;
  if (!hello.isNull()) {
    JsonDocument h;
    pm_copy_hello(hello, h.to<JsonObject>());
    if (!pm_settings_within(h.as<JsonVariantConst>(), d["hello"]) || !pm_settings_within(d["hello"], h.as<JsonVariantConst>())) {
      d["hello"] = h;
      changed = true;
    }
  }
  bool reread = false;  // only the "last read" time is new
  if (has_config) {
    JsonDocument c;
    pm_copy_config(config, c.to<JsonObject>());
    bool same = pm_settings_hold(c.as<JsonVariantConst>(), d["config"]) && pm_settings_hold(d["config"], c.as<JsonVariantConst>());
    if (!same || (d["at"] | 0UL) != at) {
      d["config"] = c;
      d["at"] = at;
      changed = true;
      // The list shows the name and power from the hello: keep them in
      // step with settings that were just delivered, with no console to ask.
      if (d["hello"].is<JsonObject>()) {
        JsonObject h = d["hello"];
        h["name"] = c["name"] | "";
        h["bridge"] = c["bridge"] | false;
        if (!strcmp(c["power"] | "", "battery")) {
          h["power"] = "battery";
          if (!c["sleep"]["checkin_ms"].isNull()) h["checkin_ms"] = c["sleep"]["checkin_ms"];
          if (c["sleep"]["relay"] | false) h["relay"] = true; else h.remove("relay");
        } else { h.remove("power"); h.remove("checkin_ms"); h.remove("relay"); }
      }
    }
    // "As last read" stays honest without a flash write per read: at most hourly.
    uint32_t t = now_s();
    if (t && (changed || t - (d["read"] | 0UL) > 3600)) { d["read"] = t; reread = !changed; }
  }
  if (!changed && !reread) return;
  if (reread) { write_doc(p, d, false); return; }  // same settings: no new rev, no news
  d["rev"] = s.rev + 1;
  if (!write_doc(p, d, !had)) {
    if (!(s.flags & F_FULL)) { s.flags |= F_FULL; announce(s, "full"); }
    return;
  }
  s.flags &= ~F_FULL;
  s.rev++;
  if (has_config || (d["config"].is<JsonObject>())) s.flags |= F_COPY;
  if (d["hello"].is<JsonObject>()) s.flags |= F_HELLO;
  s.at = d["at"] | 0UL;
  announce(s, "copy");
}

static void drop_waiting(Slot &s) {
  char p[32];
  path(p, sizeof(p), s.id, 'w');
  LittleFS.remove(p);
  s.flags &= ~(F_WAIT | F_STUCK);
}
static void mark_stuck(Slot &s, const char *why) {
  char p[32];
  path(p, sizeof(p), s.id, 'w');
  JsonDocument d;
  if (read_doc(p, d)) { d["stuck"] = true; d["error"] = why; write_doc(p, d, false); }
  s.flags |= F_STUCK;
  announce(s, "stuck", why);
}

// ---- a visit at a check-in --------------------------------------------------------

enum Step : uint8_t { V_IDLE, V_HELLO, V_WAKE, V_READ, V_SEND, V_RELEASE };
static struct {
  uint32_t id;
  Step step;
  PmCopyState st;
  PmVisitPlan plan;
  bool battery, woke;
  uint32_t hold_s;
  JsonDocument *have;  // the board's settings, when read this visit (with its floods key)
} v;

static void step_next();
static void end_visit(bool failed) {
  Slot *s = find(v.id, false);
  if (s && failed) s->not_before_ms = millis() + RETRY_MS;
  delete v.have;
  v.have = nullptr;
  v.id = 0;
  v.step = V_IDLE;
}
static bool ask(const char *json, pm_ask_cb_t cb) {
  if (pm_link_ask(v.id, json, strlen(json), cb, nullptr)) return true;
  end_visit(true);
  return false;
}
static bool reply(const char *json, size_t len, JsonDocument &d) {
  if (!json) { end_visit(true); return false; }
  if (deserializeJson(d, json, len)) { end_visit(true); return false; }
  return true;
}

static void on_hello(const char *json, size_t len, void *) {
  JsonDocument d;
  if (!reply(json, len, d)) return;
  Slot *s = find(v.id, false);
  if (!s) return end_visit(false);
  v.battery = !strcmp(d["power"] | "", "battery");
  v.hold_s = d["hold_s"] | 0UL;
  if (d["ok"] | false) store(*s, d.as<JsonObjectConst>(), JsonObjectConst(), false, 0);
  // A board in its setup window was just switched on by hand: the person
  // is there, so "stay awake next time" is spent rather than stretching
  // 3 min to 10 (Colin, 2026-10-26). Not the 6 s dwell after a reset,
  // which Candles 1 and 2 and the Lantern show at every wake.
  bool spent = false;
  if (v.plan.wake && pm_copy_setup_window(v.hold_s)) {
    s->flags &= ~F_WAKE;
    save_wake();
    v.plan.wake = false;
    spent = true;
    announce(*s, "wake");
  }
  // An older board holds 10 min for any request: visit it only when
  // nothing else holds it (pm_copy_old_go), else at a later check-in —
  // not at its next heartbeat, which comes while the same hold runs.
  if (!v.st.stamps && !v.plan.wake && (spent ? v.battery : !pm_copy_old_go(v.battery, v.hold_s, pm_link_console_recent(v.id, CONSOLE_RECENT_MS)))) {
    s->not_before_ms = millis() + (v.hold_s + 5) * 1000UL;
    return end_visit(false);  // only a hello was asked, which holds nothing: nothing to release
  }
  if (spent) v.woke = true;
  step_next();
}
static void on_wake(const char *json, size_t len, void *) {
  JsonDocument d;
  if (!reply(json, len, d)) return;
  Slot *s = find(v.id, false);
  if (s && (d["ok"] | false)) {
    s->flags &= ~F_WAKE;
    s->woke_ms = millis();
    save_wake();
    v.woke = true;
    announce(*s, "wake");
  }
  step_next();
}
static void on_read(const char *json, size_t len, void *) {
  v.have = new JsonDocument();
  if (!reply(json, len, *v.have)) return;
  Slot *s = find(v.id, false);
  if (!s || !((*v.have)["ok"] | false)) return end_visit(true);
  uint32_t at = (*v.have)["at"] | 0UL;
  if (at) { v.st.stamps = true; v.st.board_at = at; }
  store(*s, JsonObjectConst(), (*v.have)["config"].as<JsonObjectConst>(), true, at);
  step_next();
}
static void on_sent(const char *json, size_t len, void *) {
  JsonDocument d;
  if (!reply(json, len, d)) return;
  Slot *s = find(v.id, false);
  if (!s) return end_visit(false);
  if (!(d["ok"] | false)) {
    char why[96];
    snprintf(why, sizeof(why), "the board refused it: %s", d["error"] | "no reason given");
    mark_stuck(*s, why);
  } else {
    char p[32];
    path(p, sizeof(p), s->id, 'w');
    JsonDocument w;
    if (read_doc(p, w)) store(*s, JsonObjectConst(), w["config"].as<JsonObjectConst>(), true, s->want_at);
    drop_waiting(*s);
    announce(*s, "delivered");
  }
  step_next();
}
static void on_released(const char *, size_t, void *) { end_visit(false); }

static void deliver(Slot &s) {
  char p[32];
  path(p, sizeof(p), s.id, 'w');
  JsonDocument w;
  if (!read_doc(p, w)) { s.flags &= ~F_WAIT; return step_next(); }
  JsonVariantConst have = v.have ? JsonVariantConst((*v.have)["config"]) : JsonVariantConst();
  switch (pm_copy_verdict(v.st, have, w["base"], w["config"])) {
    case PM_SEND_ALREADY:
      if (!v.have) store(s, JsonObjectConst(), w["config"].as<JsonObjectConst>(), true, s.want_at);
      drop_waiting(s);
      announce(s, "delivered");
      return step_next();
    case PM_SEND_CLASH:
      mark_stuck(s, "its settings changed since this edit (another console, or the board itself) — check them and save again");
      return step_next();
    case PM_SEND_NONE:
    case PM_SEND_NEED_READ:
      return step_next();
    case PM_SEND_GO: break;
  }
  // The request: the waiting settings with their stamp. A board that
  // stamps keeps its own floods key and lights (keep_floods); an older one
  // is handed back the ones it has, which this visit just read.
  JsonDocument req;
  req["cmd"] = "set_config";
  req["bg"] = true;  // a newer board: a 3 s hold, not 10 min (pm_api)
  req["at"] = s.want_at;
  JsonObject cfg = req["config"].to<JsonObject>();
  for (JsonPairConst kv : w["config"].as<JsonObjectConst>()) cfg[kv.key()] = kv.value();
  if (v.st.stamps && v.st.base_at && v.st.board_at) req["keep_floods"] = true;
  else if (v.have) {
    JsonObjectConst hc = (*v.have)["config"];
    JsonArray ch = cfg["channels"];
    for (int i = (int)ch.size() - 1; i >= 0; i--) if (pm_is_light(ch[i])) ch.remove(i);
    for (JsonVariantConst c : hc["channels"].as<JsonArrayConst>()) if (pm_is_light(c)) ch.add(c);
    if (!hc["brmesh_key"].isNull()) cfg["brmesh_key"] = hc["brmesh_key"];
  }
  char *buf = (char *)malloc(PM_API_MAX_BYTES);
  if (!buf) return end_visit(true);
  size_t n = serializeJson(req, buf, PM_API_MAX_BYTES);
  bool ok = n < PM_API_MAX_BYTES && pm_link_ask(v.id, buf, n, on_sent, nullptr);
  free(buf);
  if (!ok) { mark_stuck(s, "too large to send over the mesh"); return step_next(); }
}

static void step_next() {
  Slot *s = find(v.id, false);
  if (!s) return end_visit(false);
  for (;;) {
    v.step = (Step)(v.step + 1);
    switch (v.step) {
      case V_HELLO:
        // Needed for an older board (its battery and hold decide the visit),
        // for "stay awake next time" (the setup window spends it), and for
        // the copy's list fields the first time.
        if (v.st.stamps && !v.plan.wake && (s->flags & F_HELLO)) continue;
        return (void)ask("{\"cmd\":\"hello\",\"bg\":true}", on_hello);
      case V_WAKE:
        if (!v.plan.wake) continue;
        { char q[48]; snprintf(q, sizeof(q), "{\"cmd\":\"hold_awake\",\"min\":%d}", WAKE_MIN); return (void)ask(q, on_wake); }
      case V_READ:
        if (!v.plan.read) continue;
        return (void)ask("{\"cmd\":\"get_config\",\"bg\":true}", on_read);
      case V_SEND:
        if (!v.plan.send || !(s->flags & F_WAIT) || (s->flags & F_STUCK)) continue;
        return deliver(*s);
      case V_RELEASE: {
        bool woke_recent = v.woke || (s->woke_ms && millis() - s->woke_ms < WAKE_MIN * 60000UL);
        if (!pm_copy_release(v.st.stamps, v.battery, pm_link_console_recent(v.id, CONSOLE_RECENT_MS), woke_recent)) return end_visit(false);
        return (void)ask("{\"cmd\":\"hold_awake\",\"min\":0}", on_released);
      }
      default: return end_visit(false);
    }
  }
}

void pm_copies_heard(uint32_t node, bool stamps, uint32_t cfg_at, bool sleeping) {
  if (!pm_copies_active()) return;
  Slot *s = find(node, true);
  if (!s) return;
  uint32_t t = now_s();
  if (t) s->seen_s = t;
  if (sleeping || v.id || (int32_t)(millis() - s->not_before_ms) < 0) return;
  if ((s->flags & F_FULL) && !(s->flags & (F_WAIT | F_WAKE))) return;  // no room for a new copy
  if (pm_link_busy_with(node)) return;  // a console is talking to it: not now
  PmCopyState st = {};
  st.has_copy = s->flags & F_COPY;
  st.copy_at = s->at;
  st.waiting = s->flags & F_WAIT;
  st.stuck = s->flags & F_STUCK;
  st.base_at = s->base_at;
  st.want_at = s->want_at;
  st.wake = s->flags & F_WAKE;
  st.stamps = stamps;
  st.board_at = cfg_at;
  PmVisitPlan plan = pm_copy_plan(st);
  if (!plan.any) return;
  v.id = node;
  v.step = V_IDLE;
  v.st = st;
  v.plan = plan;
  v.battery = false;
  v.woke = false;
  v.hold_s = 0;
  v.have = nullptr;
  step_next();
}

// ---- following the console's traffic ----------------------------------------------

void pm_copies_observe(uint32_t node, const char *req, size_t req_len, const char *reply, size_t reply_len) {
  if (!pm_copies_active()) return;
  JsonDocument f, q;
  f["cmd"] = true;
  if (deserializeJson(q, req, req_len, DeserializationOption::Filter(f))) return;
  const char *cmd = q["cmd"] | "";
  bool hello = !strcmp(cmd, "hello"), get = !strcmp(cmd, "get_config"), set = !strcmp(cmd, "set_config");
  if (!hello && !get && !set) return;
  JsonDocument r;
  if (deserializeJson(r, reply, reply_len) || !(r["ok"] | false)) return;
  Slot *s = find(node, true);
  if (!s) return;
  if (hello) store(*s, r.as<JsonObjectConst>(), JsonObjectConst(), false, 0);
  else if (get) store(*s, JsonObjectConst(), r["config"].as<JsonObjectConst>(), true, r["at"] | 0UL);
  else {
    JsonDocument full;
    if (deserializeJson(full, req, req_len)) return;
    // The board's stamp is the request's; without one it took its own
    // clock, and the next heartbeat's cfg_at says what it is.
    store(*s, JsonObjectConst(), full["config"].as<JsonObjectConst>(), true, full["at"] | 0UL);
  }
}

// ---- the console's commands ------------------------------------------------------------

static Slot *target(JsonObjectConst req, JsonObject resp) {
  uint32_t id = strtoul(req["for"] | "0", nullptr, 16);
  Slot *s = id ? find(id, false) : nullptr;
  if (!s) { resp["ok"] = false; resp["error"] = "no copy of that board on the bridge"; }
  return s;
}

bool pm_copies_handle(const char *cmd, JsonObjectConst req, JsonObject resp) {
  static const char *const CMDS[] = { "get_copies", "get_copy", "queue_config", "cancel_config", "stay_awake", "forget_copy" };
  bool mine = false;
  for (const char *c : CMDS) mine |= !strcmp(cmd, c);
  if (!mine) return false;
  if (!pm_copies_active()) { resp["ok"] = false; resp["error"] = "only a bridge keeps copies of the boards"; return true; }
  char p[32], hex[9];

  if (!strcmp(cmd, "get_copies")) {
    // Every board's list fields and what is waiting for it, a page at a
    // time: a reply has to fit one console line.
    int from = req["from"] | 0;
    JsonArray out = resp["copies"].to<JsonArray>();
    JsonDocument filt;
    filt["hello"] = true; filt["at"] = true; filt["read"] = true;
    for (int i = from; i < MAX_COPIES; i++) {
      Slot &s = s_slots[i];
      if (!s.id) continue;
      if (measureJson(resp) > 3200) { resp["more"] = i; break; }
      path(p, sizeof(p), s.id, 'c');
      JsonDocument d;
      bool have = read_doc(p, d, &filt);
      if (!have && !(s.flags & F_WAKE)) continue;
      snprintf(hex, sizeof(hex), "%08lx", (unsigned long)s.id);
      JsonObject o = out.add<JsonObject>();
      o["node"] = hex;
      if (have) { o["hello"] = d["hello"]; o["read"] = d["read"]; }
      o["at"] = s.at;
      o["rev"] = s.rev;
      o["config"] = !!(s.flags & F_COPY);
      if (s.seen_s) o["seen"] = s.seen_s;
      if (s.flags & F_WAKE) o["wake"] = true;
      if (s.flags & F_WAIT) {
        path(p, sizeof(p), s.id, 'w');
        JsonDocument wf, w;
        wf["at"] = true; wf["saved"] = true; wf["stuck"] = true; wf["error"] = true;
        if (read_doc(p, w, &wf)) o["waiting"] = w;
      }
    }
    resp["fs_used"] = (uint32_t)LittleFS.usedBytes();
    resp["fs_total"] = (uint32_t)LittleFS.totalBytes();
    if (!room()) resp["full"] = true;
    return true;
  }

  Slot *s = target(req, resp);
  if (!s) return true;

  if (!strcmp(cmd, "get_copy")) {
    // {for, waiting?: true} — the settings, or the change waiting (two
    // replies: both together may not fit one line).
    bool w = req["waiting"] | false;
    path(p, sizeof(p), s->id, w ? 'w' : 'c');
    JsonDocument d;
    if (!read_doc(p, d)) { resp["ok"] = false; resp["error"] = w ? "nothing waiting" : "no copy of its settings yet"; return true; }
    if (w) { d.remove("base"); resp["waiting"] = d; }
    else for (JsonPairConst kv : d.as<JsonObjectConst>()) resp[kv.key()] = kv.value();
    resp["rev"] = s->rev;
    return true;
  }
  if (!strcmp(cmd, "queue_config")) {
    // {for, config, rev, at}: rev is the copy the console edited.
    if (!(s->flags & F_COPY)) { resp["ok"] = false; resp["error"] = "no copy of its settings yet — it is read at the board's next check-in"; return true; }
    if (!req["rev"].isNull() && (req["rev"] | 0UL) != s->rev) { resp["ok"] = false; resp["error"] = "its settings changed since this page opened — reopen it"; resp["rev"] = s->rev; return true; }
    path(p, sizeof(p), s->id, 'c');
    JsonDocument c;
    if (!read_doc(p, c)) { resp["ok"] = false; resp["error"] = "could not read the copy"; return true; }
    JsonDocument w;
    pm_copy_config(req["config"].as<JsonObjectConst>(), w["config"].to<JsonObject>());
    w["base"] = c["config"];
    w["base_at"] = s->at;
    uint32_t at = req["at"] | 0UL;
    if (!at) at = now_s();
    w["at"] = at;
    w["saved"] = now_s();
    path(p, sizeof(p), s->id, 'w');
    if (!write_doc(p, w, !(s->flags & F_WAIT))) { resp["ok"] = false; resp["error"] = "the bridge's flash is full"; return true; }
    s->flags = (s->flags | F_WAIT) & ~F_STUCK;
    s->base_at = s->at;
    s->want_at = at;
    s->not_before_ms = 0;
    resp["at"] = at;
    announce(*s, "waiting");
    return true;
  }
  if (!strcmp(cmd, "cancel_config")) {
    drop_waiting(*s);
    announce(*s, "cancelled");
    return true;
  }
  if (!strcmp(cmd, "stay_awake")) {
    if (req["on"] | true) s->flags |= F_WAKE; else s->flags &= ~F_WAKE;
    s->not_before_ms = 0;
    save_wake();
    announce(*s, "wake");
    return true;
  }
  // forget_copy
  path(p, sizeof(p), s->id, 'c'); LittleFS.remove(p);
  path(p, sizeof(p), s->id, 'w'); LittleFS.remove(p);
  bool woke = s->flags & F_WAKE;
  *s = Slot();
  if (woke) save_wake();
  return true;
}

// ---- boot ------------------------------------------------------------------------

void pm_copies_begin() {
  s_began = true;
  File dir = LittleFS.open("/m");
  if (!dir || !dir.isDirectory()) return;
  JsonDocument cf, wf;
  cf["at"] = true; cf["rev"] = true; cf["config"] = true; cf["hello"] = true;
  wf["base_at"] = true; wf["at"] = true; wf["stuck"] = true;
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    String n = f.name();
    int slash = n.lastIndexOf('/');
    if (slash >= 0) n = n.substring(slash + 1);
    bool c = n.endsWith("_c.json"), w = n.endsWith("_w.json");
    if ((!c && !w) || n.length() != 15) { f.close(); continue; }
    uint32_t id = strtoul(n.substring(0, 8).c_str(), nullptr, 16);
    JsonDocument d;
    bool ok = !deserializeJson(d, f, DeserializationOption::Filter(c ? cf : wf));
    f.close();
    Slot *s = ok && id ? find(id, true) : nullptr;
    if (!s) continue;
    if (c) {
      s->at = d["at"] | 0UL;
      s->rev = d["rev"] | 0UL;
      if (!d["config"].isNull()) s->flags |= F_COPY;
      if (!d["hello"].isNull()) s->flags |= F_HELLO;
    } else {
      s->flags |= F_WAIT;
      if (d["stuck"] | false) s->flags |= F_STUCK;
      s->base_at = d["base_at"] | 0UL;
      s->want_at = d["at"] | 0UL;
    }
  }
  JsonDocument wake;
  if (read_doc("/m/wake.json", wake))
    for (JsonVariantConst x : wake.as<JsonArrayConst>()) {
      Slot *s = find(strtoul(x | "0", nullptr, 16), true);
      if (s) s->flags |= F_WAKE;
    }
}
