// Show logic for a node: its part of each sequence, the triggers on its
// sensors, and the player that runs steps on the mesh clock. Pure —
// no Arduino/ESP — so it is tested host-native; pm_show.cpp wires it
// to pins, flash and the radio. docs/generic-boards.md §"Sequences and
// triggers".
//
// A sequence is show-wide (one id), but each node stores only the steps
// for its own channels. A trigger lives on the node that owns the
// sensor; when it fires, that node broadcasts CUE(sequence, fire_at),
// and every node holding steps for the sequence starts them at the same
// mesh time.
#pragma once
#include <stdint.h>
#include <string.h>
#include "pm_config.h"
#include "pm_ramp.h"

#define PM_MAX_SEQUENCES 16
#define PM_MAX_STEPS 96          // per sequence, on one node
#define PM_MAX_RULES 16
#define PM_MAX_PLAYING 4         // sequences running at once on one node
#define PM_SEQ_NAME_LEN 24
#define PM_MAX_STEP_MS 600000u   // 10 minutes
#define PM_MAX_COOLDOWN_MS 3600000u
#define PM_MAX_LOOP_MS 3600000u      // an ambient loop repeats at most hourly
#define PM_MIN_LOOP_MS 1000u
#define PM_CUE_LEAD_MS 200       // fire_at = now + this: absorbs hops and relay jitter
#define PM_CUE_COPIES 3          // a CUE is one unacknowledged frame — send it thrice
#define PM_CUE_MEMORY_MS 3000    // ...and recognise the copies for this long

// "Arrive at `value` at `t_ms`." With dur_ms > 0 that is a ramp from the
// channel's then-current value, starting dur_ms earlier (a Timeline
// keyframe with the line leading into it); dur_ms == 0 sets at t_ms.
struct PmStep {
  uint32_t t_ms;
  uint8_t kind;   // pm_channel_kind_t
  uint8_t index;
  int32_t value;
  uint32_t dur_ms = 0;
  uint8_t ease_in = 0, ease_out = 0;  // percent of the ramp spent speeding up / slowing down
  uint32_t start_ms() const { return dur_ms > t_ms ? 0 : t_ms - dur_ms; }
};

// Color outputs: value 0xWWRRGGBB, ramped per component (pm_ramp.h).
inline bool pm_kind_color(uint8_t kind) {
  return pm_kind_is_strip(kind) || kind == PM_CHANNEL_KIND_BLE_LIGHT;
}
// Kinds a ramp makes sense for: a level, a position or a color — not a switch.
inline bool pm_kind_ramps(uint8_t kind) {
  return kind == PM_CHANNEL_KIND_SERVO || kind == PM_CHANNEL_KIND_LED ||
         kind == PM_CHANNEL_KIND_MOTOR || pm_kind_color(kind);
}

struct PmSequence {
  uint16_t id = 0;
  char name[PM_SEQ_NAME_LEN] = {};
  // Ambient (2026-10-09, software-plan §4.1): loops by itself whenever the
  // show is in `ambient` or `armed` mode — porch lights, a fog burst every
  // ten minutes. `loop_ms` is show-wide (the whole sequence's period, the
  // same on every node), and each repeat starts on a multiple of it in
  // mesh time, so every node's part stays in step with no messages.
  bool ambient = false;
  uint32_t loop_ms = 0;  // 0 = this node's part's own length (min 1 s)
  uint32_t at = 0;  // UTC s this part was last edited (docs §6k); 0 = before stamps
  uint8_t step_count = 0;
  PmStep steps[PM_MAX_STEPS];
  // Clear in place. Never `s = PmSequence()`: that builds a ~1.2 KB
  // temporary on the stack first.
  void clear() { id = 0; name[0] = 0; ambient = false; loop_ms = 0; at = 0; step_count = 0; }
  uint32_t period_ms() const {
    uint32_t p = loop_ms ? loop_ms : length_ms();
    return p < PM_MIN_LOOP_MS ? PM_MIN_LOOP_MS : p;
  }
  uint32_t length_ms() const {
    uint32_t m = 0;
    for (uint8_t i = 0; i < step_count; i++) if (steps[i].t_ms > m) m = steps[i].t_ms;
    return m;
  }
  // Steps in order of when they START (a ramp starts dur_ms before its
  // t_ms) — the player walks them front to back.
  void sort() {
    for (uint8_t i = 1; i < step_count; i++) {
      PmStep s = steps[i];
      uint8_t j = i;
      while (j && steps[j - 1].start_ms() > s.start_ms()) { steps[j] = steps[j - 1]; j--; }
      steps[j] = s;
    }
  }
};

// A trigger rule (software-plan "Console sections", 2026-10-12): trigger →
// logic → actions, all evaluated on the node that holds the rule, which
// then broadcasts the cues. The Show Graph's row view edits these.
//   trigger: a sensor edge on this node, or a sequence starting anywhere
//            (its CUE heard, or fired here) — "after X" chains; with
//            delay_ms = X's length it means "when X ends".
//   logic:   delay, cooldown, lockout (at most max_fires per window_min).
//   actions: one or more sequences — all of them, or one picked at random.
#define PM_RULE_MAX_SEQS 4
#define PM_MAX_DELAY_MS 3600000u
#define PM_MAX_WINDOW_MIN 1440
enum { PM_TRIG_SENSOR = 0, PM_TRIG_AFTER = 1 };
enum { PM_PICK_ALL = 0, PM_PICK_RANDOM = 1 };
struct PmRule {
  uint8_t trigger = PM_TRIG_SENSOR;
  uint8_t input = 0;        // SENSOR: DIGITAL_IN index on this node
  bool on_active = true;    // SENSOR: fire when the input becomes active (else: becomes clear)
  uint16_t after = 0;       // AFTER: the sequence whose start triggers this rule
  uint32_t delay_ms = 0;    // wait this long before the actions
  uint32_t cooldown_ms = 0; // ignore this rule's triggers this long after it fires
  uint8_t max_fires = 0;    // lockout: at most this many fires per window_min; 0 = no limit
  uint16_t window_min = 0;
  uint8_t pick = PM_PICK_ALL;
  uint8_t seq_count = 0;
  uint16_t seqs[PM_RULE_MAX_SEQS] = {};
  bool enabled = true;
  // One sensor → one sequence, the October-2026 form.
  static PmRule sensor(uint8_t input, bool on_active, uint16_t seq, uint32_t cooldown_ms, bool enabled = true) {
    PmRule r;
    r.input = input; r.on_active = on_active; r.cooldown_ms = cooldown_ms; r.enabled = enabled;
    r.seq_count = 1; r.seqs[0] = seq;
    return r;
  }
};

struct PmShow {
  uint8_t seq_count = 0;
  PmSequence seqs[PM_MAX_SEQUENCES];
  uint8_t rule_count = 0;
  PmRule rules[PM_MAX_RULES];
  uint32_t rules_at = 0;  // UTC s the triggers were last edited

  // Clear in place. NEVER `show = PmShow()` on the device: it builds a
  // ~19 KB temporary on the stack, the loop task has 8 KB, and the
  // overflow corrupts the WiFi task — every board crash-looped at boot
  // on 2026-10-05 until this.
  void clear() { seq_count = 0; rule_count = 0; rules_at = 0; }

  PmSequence *find(uint16_t id) {
    for (uint8_t i = 0; i < seq_count; i++) if (seqs[i].id == id) return &seqs[i];
    return nullptr;
  }
  // Insert or replace by id. False if full.
  bool put(const PmSequence &s) {
    PmSequence *at = find(s.id);
    if (!at) {
      if (seq_count >= PM_MAX_SEQUENCES) return false;
      at = &seqs[seq_count++];
    }
    *at = s;
    at->sort();
    return true;
  }
  bool remove(uint16_t id) {
    for (uint8_t i = 0; i < seq_count; i++) {
      if (seqs[i].id != id) continue;
      for (uint8_t j = i + 1; j < seq_count; j++) seqs[j - 1] = seqs[j];
      seq_count--;
      return true;
    }
    return false;
  }
};

// --- validation ------------------------------------------------------------
// Returns nullptr if the sequence can run on a node with config `cfg`,
// else a reason. Steps must address this node's OUTPUT channels.
inline const char *pm_check_sequence(const PmSequence &s, const PmNodeConfig &cfg) {
  if (!s.id) return "sequence id must be 1-65535";
  if (s.step_count > PM_MAX_STEPS) return "too many steps";
  if (s.loop_ms > PM_MAX_LOOP_MS) return "loop over an hour";
  if (s.loop_ms && s.loop_ms < s.length_ms()) return "loop is shorter than the sequence";
  for (uint8_t i = 0; i < s.step_count; i++) {
    const PmStep &st = s.steps[i];
    if (st.t_ms > PM_MAX_STEP_MS) return "step time over 10 minutes";
    if (st.kind == PM_CHANNEL_KIND_DIGITAL_IN) return "a step can't drive an input";
    if (!pm_find_channel(cfg, st.kind, st.index)) return "step addresses a channel this node doesn't have";
    if (st.dur_ms) {
      if (!pm_kind_ramps(st.kind)) return "relays and inputs can't ramp";
      if (st.dur_ms > st.t_ms) return "a ramp can't start before the sequence does";
      if (st.ease_in > 100 || st.ease_out > 100 || st.ease_in + st.ease_out > 100)
        return "ease in + ease out must be at most 100 %";
    }
  }
  return nullptr;
}

inline const char *pm_check_rules(const PmRule *rules, uint8_t n, const PmNodeConfig &cfg) {
  if (n > PM_MAX_RULES) return "too many triggers";
  for (uint8_t i = 0; i < n; i++) {
    const PmRule &r = rules[i];
    if (r.trigger == PM_TRIG_SENSOR) {
      if (!pm_find_channel(cfg, PM_CHANNEL_KIND_DIGITAL_IN, r.input))
        return "trigger uses a sensor input this node doesn't have";
    } else if (r.trigger == PM_TRIG_AFTER) {
      if (!r.after) return "'after' trigger names no sequence";
    } else return "unknown trigger";
    if (!r.seq_count || r.seq_count > PM_RULE_MAX_SEQS) return "trigger has no sequence";
    for (uint8_t k = 0; k < r.seq_count; k++) if (!r.seqs[k]) return "trigger has no sequence";
    if (r.cooldown_ms > PM_MAX_COOLDOWN_MS) return "cooldown over an hour";
    if (r.delay_ms > PM_MAX_DELAY_MS) return "delay over an hour";
    if (r.window_min > PM_MAX_WINDOW_MIN) return "lockout window over a day";
    if (r.pick > PM_PICK_RANDOM) return "pick must be all or random";
    // A sequence that re-triggers itself with no delay and no cooldown
    // would loop as fast as the mesh can carry cues.
    if (r.trigger == PM_TRIG_AFTER)
      for (uint8_t k = 0; k < r.seq_count; k++)
        if (r.seqs[k] == r.after && r.delay_ms + r.cooldown_ms < 1000)
          return "a sequence that restarts itself needs a delay or cooldown of at least 1 s";
  }
  return nullptr;
}

// --- ambient loops ------------------------------------------------------------
// Which repeat of an ambient sequence is due at mesh time `mesh_ms`, and
// when (mesh ms) it began. Repeats sit on multiples of the period, so two
// nodes asking at the same mesh time get the same answer.
inline int64_t pm_loop_index(int64_t mesh_ms, uint32_t period_ms) {
  return mesh_ms >= 0 ? mesh_ms / period_ms : -((-mesh_ms + period_ms - 1) / period_ms);
}

// --- triggers ----------------------------------------------------------------
// Rules on this node: a trigger (sensor edge, or a sequence starting)
// arms a rule — cooldown and lockout permitting — which is due delay_ms
// later; `due()` hands back the rules whose time has come and `pick()`
// turns one into the sequences to fire. Several rules may watch one
// trigger; every one that passes fires (fan-out).
class PmTriggers {
 public:
  // A sensor edge on this node. Returns how many rules it armed.
  uint8_t on_input(const PmShow &show, uint8_t index, bool active, uint32_t now_ms) {
    uint8_t n = 0;
    for (uint8_t i = 0; i < show.rule_count; i++) {
      const PmRule &r = show.rules[i];
      if (r.trigger != PM_TRIG_SENSOR || r.input != index || r.on_active != active) continue;
      n += arm(show, i, now_ms);
    }
    return n;
  }
  // A sequence started (its cue was heard, or fired here).
  uint8_t on_cue(const PmShow &show, uint16_t seq, uint32_t now_ms) {
    uint8_t n = 0;
    for (uint8_t i = 0; i < show.rule_count; i++) {
      const PmRule &r = show.rules[i];
      if (r.trigger != PM_TRIG_AFTER || r.after != seq) continue;
      n += arm(show, i, now_ms);
    }
    return n;
  }
  // Rules whose delay has run out. Returns the count written to `out`.
  uint8_t due(uint32_t now_ms, uint8_t *out, uint8_t max) {
    uint8_t n = 0;
    for (uint8_t i = 0; i < PM_MAX_RULES && n < max; i++) {
      if (!m_pending[i] || (int32_t)(now_ms - m_due[i]) < 0) continue;
      m_pending[i] = false;
      out[n++] = i;
    }
    return n;
  }
  // The sequences rule `i` fires: all of them, or one by `rnd`.
  uint8_t pick(const PmShow &show, uint8_t i, uint32_t rnd, uint16_t *out) {
    const PmRule &r = show.rules[i];
    if (!r.seq_count) return 0;
    if (r.pick == PM_PICK_RANDOM) { out[0] = r.seqs[rnd % r.seq_count]; return 1; }
    for (uint8_t k = 0; k < r.seq_count; k++) out[k] = r.seqs[k];
    return r.seq_count;
  }
  bool pending() const { for (bool p : m_pending) if (p) return true; return false; }
  // Re-armed, or the rules changed: forget cooldowns, lockouts and waits.
  void reset() {
    memset(m_fired, 0, sizeof(m_fired));
    memset(m_pending, 0, sizeof(m_pending));
    memset(m_count, 0, sizeof(m_count));
  }

 private:
  bool arm(const PmShow &show, uint8_t i, uint32_t now_ms) {
    const PmRule &r = show.rules[i];
    if (!r.enabled || m_pending[i]) return false;
    if (m_fired[i] && (uint32_t)(now_ms - m_last[i]) < r.cooldown_ms) return false;
    if (r.max_fires) {
      uint32_t window_ms = (uint32_t)r.window_min * 60000u;
      if (!m_count[i] || (uint32_t)(now_ms - m_window[i]) >= window_ms) { m_count[i] = 0; m_window[i] = now_ms; }
      if (m_count[i] >= r.max_fires) return false;
      m_count[i]++;
    }
    m_fired[i] = true;
    m_last[i] = now_ms;
    m_pending[i] = true;
    m_due[i] = now_ms + r.delay_ms;
    return true;
  }
  bool m_fired[PM_MAX_RULES] = {};
  uint32_t m_last[PM_MAX_RULES] = {};
  bool m_pending[PM_MAX_RULES] = {};
  uint32_t m_due[PM_MAX_RULES] = {};
  uint8_t m_count[PM_MAX_RULES] = {};
  uint32_t m_window[PM_MAX_RULES] = {};
};

// --- duplicate cues ------------------------------------------------------------
// Each CUE goes out PM_CUE_COPIES times (different frame seq, same
// cue_id); play it once.
class PmCueMemory {
 public:
  bool seen(uint32_t src, uint16_t cue_id, uint32_t now_ms) {
    Slot *free_slot = nullptr, *oldest = &m_s[0];
    for (Slot &s : m_s) {
      bool live = s.used && (uint32_t)(now_ms - s.at) < PM_CUE_MEMORY_MS;
      if (live && s.src == src && s.cue == cue_id) return true;
      if (!live) { s.used = false; if (!free_slot) free_slot = &s; }
      else if ((int32_t)(s.at - oldest->at) < 0) oldest = &s;
    }
    Slot *s = free_slot ? free_slot : oldest;
    *s = {true, src, cue_id, now_ms};
    return false;
  }

 private:
  struct Slot { bool used; uint32_t src; uint16_t cue; uint32_t at; };
  Slot m_s[12] = {};
};

// --- player ------------------------------------------------------------------
// Runs sequences against a local microsecond clock. A sequence started
// again while playing restarts from its top.
class PmPlayer {
 public:
  // `start_us`: local time at which t=0 of the sequence happens (may be
  // in the past — late cue — then the overdue steps run at once, which
  // keeps the end state right). `offset_ms` skips that far in.
  // Returns false if every slot is busy.
  bool start(const PmSequence *seq, int64_t start_us, uint32_t offset_ms = 0) {
    Play *slot = nullptr;
    for (Play &p : m_p) if (p.seq == seq) { slot = &p; break; }  // restart
    if (!slot) for (Play &p : m_p) if (!p.seq) { slot = &p; break; }
    if (!slot) return false;
    slot->seq = seq;
    slot->start_us = start_us - (int64_t)offset_ms * 1000;
    slot->next = 0;
    // Skip steps that END before the offset; a ramp straddling it is
    // started (late), so the output lands on its line.
    while (slot->next < seq->step_count && seq->steps[slot->next].t_ms < offset_ms) slot->next++;
    return true;
  }

  // Run every step whose start is due. `run(step, start_us)` drives the
  // output — for a ramp, `start_us` is the local time its line begins,
  // so a late start lands mid-curve. Returns the number of sequences
  // still playing.
  template <typename F>
  uint8_t tick(int64_t now_us, F run) {
    uint8_t live = 0;
    for (Play &p : m_p) {
      if (!p.seq) continue;
      while (p.next < p.seq->step_count &&
             now_us >= p.start_us + (int64_t)p.seq->steps[p.next].start_ms() * 1000) {
        const PmStep &st = p.seq->steps[p.next++];
        run(st, p.start_us + (int64_t)st.start_ms() * 1000);
      }
      if (p.next >= p.seq->step_count) p.seq = nullptr;
      else live++;
    }
    return live;
  }

  void stop_all() { for (Play &p : m_p) p.seq = nullptr; }
  // Forget a sequence (it is being replaced or deleted).
  void forget(const PmSequence *seq) { for (Play &p : m_p) if (p.seq == seq) p.seq = nullptr; }
  bool playing(const PmSequence *seq) const { for (const Play &p : m_p) if (p.seq == seq) return true; return false; }

 private:
  struct Play { const PmSequence *seq = nullptr; int64_t start_us = 0; uint8_t next = 0; };
  Play m_p[PM_MAX_PLAYING];
};
