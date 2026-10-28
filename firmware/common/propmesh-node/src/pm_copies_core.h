// The pure part of the bridge's board copies (pm_copies.cpp): what to keep
// of a hello and a config, whether two settings agree, and what a visit at
// a board's check-in has to do. Header-only and free of Arduino includes,
// so the host tests (firmware/test, test_copies) exercise it.
// docs/console-nodes-list.md §9 "Settings kept on the bridge".
#pragma once
#include <ArduinoJson.h>
#include <string.h>
#include <stdint.h>

// The hello fields the console's board list needs. The rest (uptime,
// holds, battery rate, mode) changes at every wake and would rewrite the
// copy each time for nothing.
static const char *const PM_COPY_HELLO_KEYS[] = {
  "node", "fw", "build", "built", "board", "power", "checkin_ms", "relay",
  "sleeps", "ble", "name", "bridge", "role",
};

inline void pm_copy_hello(JsonObjectConst hello, JsonObject out) {
  for (const char *k : PM_COPY_HELLO_KEYS)
    if (!hello[k].isNull()) out[k] = hello[k];
}

// What a copy keeps of a config: never the floods key (it lives only on
// the boards) or a WiFi password (boards never send one; drop it anyway).
inline void pm_copy_config(JsonObjectConst cfg, JsonObject out) {
  for (JsonPairConst kv : cfg) {
    if (!strcmp(kv.key().c_str(), "brmesh_key")) continue;
    if (!strcmp(kv.key().c_str(), "wifi")) {
      JsonObject w = out["wifi"].to<JsonObject>();
      for (JsonPairConst x : kv.value().as<JsonObjectConst>())
        if (strcmp(x.key().c_str(), "pass")) w[x.key()] = x.value();
      continue;
    }
    out[kv.key()] = kv.value();
  }
}

// Everything `a` says, `b` says too: objects by key (b may have more —
// the board fills in defaults the console left out), arrays element by
// element and the same length, values equal. The floods key, the WiFi
// password and BLE_LIGHT channels are left out on both sides: the floods
// are the Floods tab's, and arrive by their own sync.
inline bool pm_is_light(JsonVariantConst c) { return c.is<JsonObjectConst>() && !strcmp(c["kind"] | "", "BLE_LIGHT"); }

inline bool pm_settings_within(JsonVariantConst a, JsonVariantConst b, bool top = false) {
  if (a.is<JsonObjectConst>()) {
    if (!b.is<JsonObjectConst>()) return false;
    for (JsonPairConst kv : a.as<JsonObjectConst>()) {
      const char *k = kv.key().c_str();
      if (top && (!strcmp(k, "brmesh_key"))) continue;
      if (!strcmp(k, "pass") || !strcmp(k, "pass_set")) continue;
      if (top && !strcmp(k, "channels")) {
        JsonArrayConst ca = kv.value().as<JsonArrayConst>(), cb = b["channels"].as<JsonArrayConst>();
        size_t i = 0, j = 0, na = ca.size(), nb = cb.size();
        for (;;) {
          while (i < na && pm_is_light(ca[i])) i++;
          while (j < nb && pm_is_light(cb[j])) j++;
          if (i >= na || j >= nb) break;
          if (!pm_settings_within(ca[i], cb[j])) return false;
          i++; j++;
        }
        if ((i < na) != (j < nb)) return false;
        continue;
      }
      if (!pm_settings_within(kv.value(), b[k])) return false;
    }
    return true;
  }
  if (a.is<JsonArrayConst>()) {
    if (!b.is<JsonArrayConst>()) return false;
    JsonArrayConst x = a.as<JsonArrayConst>(), y = b.as<JsonArrayConst>();
    if (x.size() != y.size()) return false;
    for (size_t i = 0; i < x.size(); i++) if (!pm_settings_within(x[i], y[i])) return false;
    return true;
  }
  if (a.isNull()) return true;  // not said: nothing to disagree with
  if (a.is<const char *>()) return b.is<const char *>() && !strcmp(a.as<const char *>(), b.as<const char *>());
  if (a.is<bool>()) return b.is<bool>() && a.as<bool>() == b.as<bool>();
  if (a.is<double>() && b.is<double>()) return a.as<double>() == b.as<double>();
  return false;
}
// The settings in `want` are already what the board has.
inline bool pm_settings_hold(JsonVariantConst want, JsonVariantConst have) { return pm_settings_within(want, have, true); }

// ---- a visit at a check-in ------------------------------------------------------
// What the bridge knows when it hears a board awake, and what it must do.
struct PmCopyState {
  bool has_copy;        // a copy of its settings is on the bridge
  uint32_t copy_at;     // that copy's stamp (0 = unknown)
  bool waiting;         // a change is waiting for it
  bool stuck;           // ... but it is not to be sent (refused, or the board changed underneath)
  uint32_t base_at;     // the stamp of the copy the waiting change was edited from (0 = unknown)
  uint32_t want_at;     // the waiting change's own stamp
  bool wake;            // "stay awake next time"
  bool stamps;          // the board reports its settings' stamp (firmware 2026-10-28 on)
  uint32_t board_at;    // ... and this is it (0 = no clock when it was set)
};
enum PmSendVerdict : uint8_t { PM_SEND_NONE, PM_SEND_GO, PM_SEND_ALREADY, PM_SEND_CLASH, PM_SEND_NEED_READ };
struct PmVisitPlan {
  bool any;    // anything to do at all
  bool wake;   // send hold_awake {min: 10}
  bool read;   // read its settings (get_config)
  bool send;   // a waiting change to deliver (decided after the read, if there is one)
};

inline PmVisitPlan pm_copy_plan(const PmCopyState &s) {
  PmVisitPlan p = {};
  bool deliver = s.waiting && !s.stuck;
  bool stale = s.stamps && s.has_copy && s.board_at != s.copy_at;
  // Without stamps a delivery needs the board's settings: to check the
  // edit's base still holds, and for its floods key and lights, which an
  // older board would lose otherwise. With stamps, only when they don't say.
  bool read_for_send = deliver && (!s.stamps || !s.base_at || !s.board_at);
  p.wake = s.wake;
  p.read = !s.has_copy || stale || read_for_send;
  p.send = deliver;
  p.any = p.wake || p.read || p.send;
  return p;
}

// Whether to send the waiting change. `read`: the board's settings were
// just read (have != null); `base` / `want`: the waiting change's base and
// content.
inline PmSendVerdict pm_copy_verdict(const PmCopyState &s, JsonVariantConst have, JsonVariantConst base, JsonVariantConst want) {
  if (!s.waiting || s.stuck) return PM_SEND_NONE;
  if (s.stamps && s.base_at && s.board_at) {
    if (s.board_at == s.want_at) return PM_SEND_ALREADY;  // delivered; the reply was lost
    return s.board_at == s.base_at ? PM_SEND_GO : PM_SEND_CLASH;
  }
  if (have.isNull()) return PM_SEND_NEED_READ;
  if (pm_settings_hold(want, have)) return PM_SEND_ALREADY;
  return pm_settings_hold(base, have) ? PM_SEND_GO : PM_SEND_CLASH;
}

// After a visit: let a battery board sleep again, unless something else
// wants it up. `hold_s` is what its hello said before the visit (hello
// doesn't hold a board): the setup window after a power-on (3 min), a
// sensor wake or a sync pull is at most that. A longer hold with no
// console behind it is a visit's own, left over from a missed release.
// A console request to it in the last 10 min (a page open, an update
// streaming) or the bridge's own "stay awake next time" keeps it up too.
inline bool pm_copy_release(bool battery, uint32_t hold_s, bool console_recent, bool woke_it) {
  if (!battery || woke_it || console_recent) return false;
  if (hold_s > 0 && hold_s <= 185) return false;
  return true;
}
