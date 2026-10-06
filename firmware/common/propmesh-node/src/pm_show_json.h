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
  out = PmSequence();
  if (!j.is<JsonObjectConst>()) return "sequence is not an object";
  long id = j["id"] | 0L;
  if (id < 1 || id > 65535) return "sequence id must be 1-65535";
  out.id = (uint16_t)id;
  pm_copy(out.name, j["name"] | "", sizeof(out.name));
  JsonArrayConst steps = j["steps"];
  if (steps.size() > PM_MAX_STEPS) return "too many steps";
  for (JsonArrayConst st : steps) {
    if (st.size() != 4) return "a step is [t_ms, kind, index, value]";
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
  }
  out.sort();
  return nullptr;
}

inline void pm_sequence_to_json(const PmSequence &s, JsonObject j) {
  j["id"] = s.id;
  j["name"] = s.name;
  JsonArray steps = j["steps"].to<JsonArray>();
  for (uint8_t i = 0; i < s.step_count; i++) {
    JsonArray st = steps.add<JsonArray>();
    st.add(s.steps[i].t_ms);
    st.add(pm_function(s.steps[i].kind)->name);
    st.add(s.steps[i].index);
    st.add(s.steps[i].value);
  }
}

// Sequence headers only — the console lists these, then fetches each.
inline void pm_sequence_summary(const PmSequence &s, JsonObject j) {
  j["id"] = s.id;
  j["name"] = s.name;
  j["steps"] = s.step_count;
  j["length_ms"] = s.length_ms();
}

inline const char *pm_rules_from_json(JsonArrayConst a, PmRule *out, uint8_t &n) {
  n = 0;
  if (a.size() > PM_MAX_RULES) return "too many triggers";
  for (JsonObjectConst r : a) {
    PmRule &x = out[n++];
    x = PmRule();
    long in = r["input"] | 0L, seq = r["seq"] | 0L, cd = r["cooldown_ms"] | 0L;
    if (in < 1 || in > 255) return "trigger input must be a DIGITAL_IN index";
    if (seq < 1 || seq > 65535) return "trigger sequence id must be 1-65535";
    if (cd < 0) return "bad cooldown";
    const char *on = r["on"] | "active";
    if (strcmp(on, "active") && strcmp(on, "clear")) return "trigger 'on' must be active or clear";
    x.input = (uint8_t)in;
    x.sequence = (uint16_t)seq;
    x.cooldown_ms = (uint32_t)cd;
    x.on_active = !strcmp(on, "active");
    x.enabled = r["enabled"] | true;
  }
  return nullptr;
}

inline void pm_rules_to_json(const PmRule *rules, uint8_t n, JsonArray a) {
  for (uint8_t i = 0; i < n; i++) {
    JsonObject r = a.add<JsonObject>();
    r["input"] = rules[i].input;
    r["on"] = rules[i].on_active ? "active" : "clear";
    r["seq"] = rules[i].sequence;
    r["cooldown_ms"] = rules[i].cooldown_ms;
    r["enabled"] = rules[i].enabled;
  }
}
