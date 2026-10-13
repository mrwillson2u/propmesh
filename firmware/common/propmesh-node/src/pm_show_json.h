// Sequences and triggers <-> JSON. One format for /show.json in flash
// and for the console API (which moves one sequence per request, so a
// full sequence always fits the mesh's 4320-byte message). A step is
// [t_ms, "KIND", index, value] to keep that small.
// Shape checks only; pm_check_* decide whether it can run here.
// Header-only: tested host-native.
#pragma once
#include <ArduinoJson.h>
#include "pm_show_core.h"

inline const char *pm_sequence_from_json(JsonVariantConst j, PmSequence &out) {
  out.clear();  // in place — see PmShow::clear
  if (!j.is<JsonObjectConst>()) return "sequence is not an object";
  long id = j["id"] | 0L;
  if (id < 1 || id > 65535) return "sequence id must be 1-65535";
  out.id = (uint16_t)id;
  pm_copy(out.name, j["name"] | "", sizeof(out.name));
  out.ambient = j["ambient"] | false;
  long loop = j["loop_ms"] | 0L;
  if (loop < 0) return "bad loop_ms";
  out.loop_ms = (uint32_t)loop;
  out.at = j["at"] | 0UL;
  JsonArrayConst steps = j["steps"];
  if (steps.size() > PM_MAX_STEPS) return "too many steps";
  for (JsonArrayConst st : steps) {
    // [t, kind, index, value] — a set; [..., dur_ms, ease_in %, ease_out %]
    // — a ramp; [..., dur_ms, "name"] — a ramp with a named preset (the
    // form before 2026-10-06, still read so stored shows keep working).
    if (st.size() != 4 && st.size() != 6 && st.size() != 7)
      return "a step is [t_ms, kind, index, value] or [..., dur_ms, ease_in, ease_out]";
    const pm_function_t *f = pm_function_by_name(st[1] | "");
    if (!f) return "unknown channel kind in a step";
    long t = st[0] | -1L, idx = st[2] | 0L;
    if (t < 0) return "bad step time";
    if (idx < 1 || idx > 255) return "bad step channel index";
    PmStep &s = out.steps[out.step_count++];
    s.t_ms = (uint32_t)t;
    s.kind = f->kind;
    s.index = (uint8_t)idx;
    s.value = pm_clamp_value(*f, st[3] | 0L);
    if (st.size() >= 6) {
      long dur = st[4] | -1L;
      if (dur < 0) return "bad ramp duration";
      s.dur_ms = (uint32_t)dur;
      if (st.size() == 7) {
        long ein = st[5] | -1L, eout = st[6] | -1L;
        if (ein < 0 || ein > 100 || eout < 0 || eout > 100) return "ease amounts are 0-100 %";
        s.ease_in = (uint8_t)ein;
        s.ease_out = (uint8_t)eout;
      } else {
        const char *e = st[5] | "";
        if (!strcmp(e, "linear")) { s.ease_in = 0; s.ease_out = 0; }
        else if (!strcmp(e, "in")) { s.ease_in = 100; s.ease_out = 0; }
        else if (!strcmp(e, "out")) { s.ease_in = 0; s.ease_out = 100; }
        else if (!strcmp(e, "inout")) { s.ease_in = 50; s.ease_out = 50; }
        else return "easing must be linear, in, out or inout";
      }
    }
  }
  out.sort();
  return nullptr;
}

inline void pm_sequence_to_json(const PmSequence &s, JsonObject j) {
  j["id"] = s.id;
  j["name"] = s.name;
  if (s.ambient) j["ambient"] = true;
  if (s.loop_ms) j["loop_ms"] = s.loop_ms;
  if (s.at) j["at"] = s.at;
  JsonArray steps = j["steps"].to<JsonArray>();
  for (uint8_t i = 0; i < s.step_count; i++) {
    JsonArray st = steps.add<JsonArray>();
    st.add(s.steps[i].t_ms);
    st.add(pm_function(s.steps[i].kind)->name);
    st.add(s.steps[i].index);
    st.add(s.steps[i].value);
    if (s.steps[i].dur_ms) {  // the 4-element form stays valid for plain steps
      st.add(s.steps[i].dur_ms);
      st.add(s.steps[i].ease_in);
      st.add(s.steps[i].ease_out);
    }
  }
}

// Sequence headers only — the console lists these, then fetches each.
inline void pm_sequence_summary(const PmSequence &s, JsonObject j) {
  j["id"] = s.id;
  j["name"] = s.name;
  j["steps"] = s.step_count;
  j["length_ms"] = s.length_ms();
  if (s.ambient) j["ambient"] = true;
  if (s.loop_ms) j["loop_ms"] = s.loop_ms;
  if (s.at) j["at"] = s.at;
}

inline const char *pm_rules_from_json(JsonArrayConst a, PmRule *out, uint8_t &n) {
  n = 0;
  if (a.size() > PM_MAX_RULES) return "too many triggers";
  for (JsonObjectConst r : a) {
    PmRule &x = out[n++];
    x = PmRule();
    const char *trig = r["trigger"] | "sensor";
    if (!strcmp(trig, "sensor")) {
      long in = r["input"] | 0L;
      if (in < 1 || in > 255) return "trigger input must be a DIGITAL_IN index";
      const char *on = r["on"] | "active";
      if (strcmp(on, "active") && strcmp(on, "clear")) return "trigger 'on' must be active or clear";
      x.trigger = PM_TRIG_SENSOR;
      x.input = (uint8_t)in;
      x.on_active = !strcmp(on, "active");
    } else if (!strcmp(trig, "after")) {
      long a = r["after"] | 0L;
      if (a < 1 || a > 65535) return "'after' must name a sequence id";
      x.trigger = PM_TRIG_AFTER;
      x.after = (uint16_t)a;
    } else return "trigger must be sensor or after";
    long cd = r["cooldown_ms"] | 0L, dl = r["delay_ms"] | 0L;
    if (cd < 0) return "bad cooldown";
    if (dl < 0) return "bad delay";
    x.cooldown_ms = (uint32_t)cd;
    x.delay_ms = (uint32_t)dl;
    // "seqs": [..] with "pick"; the one-sequence form before 2026-10-12 is "seq".
    JsonArrayConst seqs = r["seqs"];
    if (seqs.size() > PM_RULE_MAX_SEQS) return "a trigger plays at most 4 sequences";
    for (JsonVariantConst v : seqs) {
      long id = v | 0L;
      if (id < 1 || id > 65535) return "trigger sequence id must be 1-65535";
      x.seqs[x.seq_count++] = (uint16_t)id;
    }
    if (!x.seq_count) {
      long seq = r["seq"] | 0L;
      if (seq < 1 || seq > 65535) return "trigger sequence id must be 1-65535";
      x.seqs[x.seq_count++] = (uint16_t)seq;
    }
    const char *pick = r["pick"] | "all";
    if (strcmp(pick, "all") && strcmp(pick, "random")) return "pick must be all or random";
    x.pick = !strcmp(pick, "random") ? PM_PICK_RANDOM : PM_PICK_ALL;
    JsonObjectConst lim = r["limit"];
    long fires = lim["fires"] | 0L, win = lim["window_min"] | 0L;
    if (fires < 0 || fires > 255 || win < 0 || win > PM_MAX_WINDOW_MIN) return "bad lockout";
    if ((fires > 0) != (win > 0)) return "lockout needs both fires and window_min";
    x.max_fires = (uint8_t)fires;
    x.window_min = (uint16_t)win;
    x.enabled = r["enabled"] | true;
  }
  return nullptr;
}

inline void pm_rules_to_json(const PmRule *rules, uint8_t n, JsonArray a) {
  for (uint8_t i = 0; i < n; i++) {
    JsonObject r = a.add<JsonObject>();
    const PmRule &x = rules[i];
    if (x.trigger == PM_TRIG_AFTER) {
      r["trigger"] = "after";
      r["after"] = x.after;
    } else {
      r["trigger"] = "sensor";
      r["input"] = x.input;
      r["on"] = x.on_active ? "active" : "clear";
    }
    if (x.delay_ms) r["delay_ms"] = x.delay_ms;
    r["cooldown_ms"] = x.cooldown_ms;
    if (x.max_fires) { r["limit"]["fires"] = x.max_fires; r["limit"]["window_min"] = x.window_min; }
    if (x.pick == PM_PICK_RANDOM) r["pick"] = "random";
    JsonArray seqs = r["seqs"].to<JsonArray>();
    for (uint8_t k = 0; k < x.seq_count; k++) seqs.add(x.seqs[k]);
    r["seq"] = x.seq_count ? x.seqs[0] : 0;  // read by consoles from before 2026-10-12
    r["enabled"] = x.enabled;
  }
}
