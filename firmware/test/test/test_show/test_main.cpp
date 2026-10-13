#include <unity.h>
#include <vector>
#include "pm_show_core.h"
#include "pm_show_json.h"

void setUp() {}
void tearDown() {}

static PmNodeConfig node() {  // a heads board: 2 servos, a relay, a PIR
  PmNodeConfig c;
  auto add = [&](uint8_t kind, uint8_t idx, uint8_t pin) {
    PmChannelCfg &ch = c.channels[c.channel_count++];
    ch.kind = kind; ch.index = idx; ch.pins[0] = pin; ch.pin_count = 1;
  };
  add(PM_CHANNEL_KIND_SERVO, 1, 25);
  add(PM_CHANNEL_KIND_SERVO, 2, 26);
  add(PM_CHANNEL_KIND_RELAY, 1, 21);
  add(PM_CHANNEL_KIND_DIGITAL_IN, 1, 34);
  return c;
}

static PmSequence seq(uint16_t id, std::initializer_list<PmStep> steps) {
  PmSequence s;
  s.id = id;
  for (const PmStep &st : steps) s.steps[s.step_count++] = st;
  s.sort();
  return s;
}

// --- player ----------------------------------------------------------

static void test_steps_run_on_time_in_order() {
  PmSequence s = seq(1, {{1000, PM_CHANNEL_KIND_SERVO, 1, 800},
                         {0, PM_CHANNEL_KIND_RELAY, 1, 1},
                         {2500, PM_CHANNEL_KIND_RELAY, 1, 0}});
  PmPlayer p;
  std::vector<uint32_t> ran;
  auto rec = [&](const PmStep &st, int64_t) { ran.push_back(st.t_ms); };
  p.start(&s, 1000000);                       // t=0 at local 1.0 s
  p.tick(999999, rec);   TEST_ASSERT_EQUAL(0, ran.size());
  p.tick(1000000, rec);  TEST_ASSERT_EQUAL(1, ran.size());
  p.tick(1999999, rec);  TEST_ASSERT_EQUAL(1, ran.size());
  p.tick(2000000, rec);  TEST_ASSERT_EQUAL(2, ran.size());
  TEST_ASSERT_EQUAL(0, p.tick(9000000, rec));  // finished
  TEST_ASSERT_EQUAL(3, ran.size());
  TEST_ASSERT_EQUAL(0, ran[0]);
  TEST_ASSERT_EQUAL(2500, ran[2]);
}

// A cue that arrives late (start in the past) runs the overdue steps at
// once rather than dropping them, so the prop ends in the right state.
static void test_late_start_catches_up() {
  PmSequence s = seq(1, {{0, PM_CHANNEL_KIND_RELAY, 1, 1}, {100, PM_CHANNEL_KIND_SERVO, 1, 500}});
  PmPlayer p;
  int n = 0;
  p.start(&s, 0);
  p.tick(5000000, [&](const PmStep &, int64_t) { n++; });
  TEST_ASSERT_EQUAL(2, n);
}

static void test_start_offset_skips_earlier_steps() {
  PmSequence s = seq(1, {{0, PM_CHANNEL_KIND_RELAY, 1, 1}, {1000, PM_CHANNEL_KIND_RELAY, 1, 0}});
  PmPlayer p;
  std::vector<uint32_t> ran;
  p.start(&s, 0, 500);  // play from 0.5 s in
  p.tick(400000, [&](const PmStep &st, int64_t) { ran.push_back(st.t_ms); });
  TEST_ASSERT_EQUAL(0, ran.size());
  p.tick(500000, [&](const PmStep &st, int64_t) { ran.push_back(st.t_ms); });
  TEST_ASSERT_EQUAL(1, ran.size());
  TEST_ASSERT_EQUAL(1000, ran[0]);
}

static void test_retrigger_restarts_from_top() {
  PmSequence s = seq(1, {{0, PM_CHANNEL_KIND_RELAY, 1, 1}, {1000, PM_CHANNEL_KIND_RELAY, 1, 0}});
  PmPlayer p;
  int n = 0;
  auto cnt = [&](const PmStep &, int64_t) { n++; };
  p.start(&s, 0);
  p.tick(0, cnt);
  p.start(&s, 500000);
  p.tick(500000, cnt);   // step 0 again
  TEST_ASSERT_EQUAL(2, n);
}

static void test_concurrent_limit_and_stop() {
  PmSequence a[PM_MAX_PLAYING + 1];
  for (int i = 0; i <= PM_MAX_PLAYING; i++) a[i] = seq(i + 1, {{9000, PM_CHANNEL_KIND_RELAY, 1, 1}});
  PmPlayer p;
  for (int i = 0; i < PM_MAX_PLAYING; i++) TEST_ASSERT_TRUE(p.start(&a[i], 0));
  TEST_ASSERT_FALSE(p.start(&a[PM_MAX_PLAYING], 0));
  p.stop_all();
  int n = 0;
  TEST_ASSERT_EQUAL(0, p.tick(99000000, [&](const PmStep &, int64_t) { n++; }));
  TEST_ASSERT_EQUAL(0, n);
}

// --- triggers ----------------------------------------------------------

// What `t` fires right now: the sequences of every rule that is due.
static uint8_t fires(PmTriggers &t, const PmShow &show, uint32_t now, uint16_t *out, uint32_t rnd = 0) {
  uint8_t idx[PM_MAX_RULES], n = t.due(now, idx, PM_MAX_RULES), m = 0;
  for (uint8_t k = 0; k < n; k++) m += t.pick(show, idx[k], rnd, out + m);
  return m;
}

static void test_rule_fires_on_edge_with_cooldown() {
  PmShow show;
  show.rules[0] = PmRule::sensor(1, true, 7, 30000);
  show.rule_count = 1;
  PmTriggers t;
  uint16_t s[8];
  TEST_ASSERT_EQUAL(1, t.on_input(show, 1, true, 1000));
  TEST_ASSERT_EQUAL(1, fires(t, show, 1000, s)); TEST_ASSERT_EQUAL(7, s[0]);
  TEST_ASSERT_EQUAL(0, t.on_input(show, 1, false, 2000));   // clear: not this rule
  TEST_ASSERT_EQUAL(0, t.on_input(show, 1, true, 20000));   // in cooldown
  TEST_ASSERT_EQUAL(1, t.on_input(show, 1, true, 31001));   // after
  TEST_ASSERT_EQUAL(0, t.on_input(show, 2, true, 99999));   // other input
}

static void test_disabled_rule_and_clear_edge() {
  PmShow show;
  show.rules[0] = PmRule::sensor(1, true, 7, 0, false);
  show.rules[1] = PmRule::sensor(1, false, 8, 0);
  show.rule_count = 2;
  PmTriggers t;
  uint16_t s[8];
  TEST_ASSERT_EQUAL(0, t.on_input(show, 1, true, 0));
  TEST_ASSERT_EQUAL(1, t.on_input(show, 1, false, 10));
  TEST_ASSERT_EQUAL(1, fires(t, show, 10, s)); TEST_ASSERT_EQUAL(8, s[0]);
}

// --- logic: delay, fan-out, random, lockout, chaining ---------------------

static void test_delay_and_fan_out() {
  PmShow show;
  show.rules[0] = PmRule::sensor(1, true, 7, 0);
  show.rules[0].delay_ms = 2000;
  show.rules[0].seq_count = 2; show.rules[0].seqs[1] = 9;  // fire both
  show.rules[1] = PmRule::sensor(1, true, 11, 0);          // a second rule on the same sensor
  show.rule_count = 2;
  PmTriggers t;
  uint16_t s[8];
  TEST_ASSERT_EQUAL(2, t.on_input(show, 1, true, 1000));
  TEST_ASSERT_EQUAL(1, fires(t, show, 1000, s)); TEST_ASSERT_EQUAL(11, s[0]);  // the undelayed one, now
  TEST_ASSERT_EQUAL(0, fires(t, show, 2999, s));
  TEST_ASSERT_EQUAL(2, fires(t, show, 3000, s));                              // the delayed one, both sequences
  TEST_ASSERT_EQUAL(7, s[0]); TEST_ASSERT_EQUAL(9, s[1]);
  TEST_ASSERT_EQUAL(0, fires(t, show, 9000, s));                              // once
}

static void test_random_pick_and_lockout() {
  PmShow show;
  show.rules[0] = PmRule::sensor(1, true, 7, 0);
  show.rules[0].pick = PM_PICK_RANDOM;
  show.rules[0].seq_count = 3; show.rules[0].seqs[1] = 8; show.rules[0].seqs[2] = 9;
  show.rules[0].max_fires = 2; show.rules[0].window_min = 1;  // twice a minute at most
  show.rule_count = 1;
  PmTriggers t;
  uint16_t s[8];
  t.on_input(show, 1, true, 0);
  TEST_ASSERT_EQUAL(1, fires(t, show, 0, s, 4)); TEST_ASSERT_EQUAL(8, s[0]);   // 4 % 3 = 1
  t.on_input(show, 1, true, 10000);
  TEST_ASSERT_EQUAL(1, fires(t, show, 10000, s, 5)); TEST_ASSERT_EQUAL(9, s[0]);
  TEST_ASSERT_EQUAL(0, t.on_input(show, 1, true, 20000));   // locked out
  TEST_ASSERT_EQUAL(1, t.on_input(show, 1, true, 61000));   // new window
}

static void test_chain_after_sequence() {
  PmShow show;
  PmRule &r = show.rules[0];
  r.trigger = PM_TRIG_AFTER; r.after = 5; r.delay_ms = 6200;  // "when 5 ends" = its length
  r.seq_count = 1; r.seqs[0] = 6;
  show.rule_count = 1;
  PmTriggers t;
  uint16_t s[8];
  TEST_ASSERT_EQUAL(0, t.on_input(show, 1, true, 0));       // a sensor doesn't arm it
  TEST_ASSERT_EQUAL(0, t.on_cue(show, 4, 100));              // another sequence doesn't
  TEST_ASSERT_EQUAL(1, t.on_cue(show, 5, 100));
  TEST_ASSERT_EQUAL(0, fires(t, show, 6000, s));
  TEST_ASSERT_EQUAL(1, fires(t, show, 6300, s)); TEST_ASSERT_EQUAL(6, s[0]);
  TEST_ASSERT_TRUE(t.on_cue(show, 5, 7000) == 1);            // no cooldown: chains again
  t.reset();
  TEST_ASSERT_FALSE(t.pending());
}

// --- cue copies ----------------------------------------------------------

static void test_cue_copies_played_once() {
  PmCueMemory m;
  TEST_ASSERT_FALSE(m.seen(0xA, 42, 0));
  TEST_ASSERT_TRUE(m.seen(0xA, 42, 20));
  TEST_ASSERT_TRUE(m.seen(0xA, 42, 40));
  TEST_ASSERT_FALSE(m.seen(0xB, 42, 50));                      // other sender
  TEST_ASSERT_FALSE(m.seen(0xA, 42, PM_CUE_MEMORY_MS + 100));  // a new cue, later
}

// --- validation + JSON -----------------------------------------------------

static void test_sequence_checked_against_node() {
  PmNodeConfig c = node();
  TEST_ASSERT_NULL(pm_check_sequence(seq(1, {{0, PM_CHANNEL_KIND_SERVO, 2, 10}}), c));
  TEST_ASSERT_NOT_NULL(pm_check_sequence(seq(1, {{0, PM_CHANNEL_KIND_SERVO, 3, 10}}), c));       // no SERVO_3
  TEST_ASSERT_NOT_NULL(pm_check_sequence(seq(1, {{0, PM_CHANNEL_KIND_DIGITAL_IN, 1, 1}}), c));   // input
  TEST_ASSERT_NOT_NULL(pm_check_sequence(seq(1, {{PM_MAX_STEP_MS + 1, PM_CHANNEL_KIND_RELAY, 1, 1}}), c));
  TEST_ASSERT_NOT_NULL(pm_check_sequence(seq(0, {}), c));
}

static void test_rules_checked_against_node() {
  PmNodeConfig c = node();
  PmRule ok[1] = {PmRule::sensor(1, true, 5, 1000)};
  PmRule bad[1] = {PmRule::sensor(2, true, 5, 1000)};   // no DIGITAL_IN_2
  TEST_ASSERT_NULL(pm_check_rules(ok, 1, c));
  TEST_ASSERT_NOT_NULL(pm_check_rules(bad, 1, c));
  PmRule loop[1]; loop[0].trigger = PM_TRIG_AFTER; loop[0].after = 5; loop[0].seq_count = 1; loop[0].seqs[0] = 5;
  TEST_ASSERT_NOT_NULL(pm_check_rules(loop, 1, c));      // restarts itself with no delay
  loop[0].cooldown_ms = 1000;
  TEST_ASSERT_NULL(pm_check_rules(loop, 1, c));
}

static void test_sequence_json_round_trip_sorted_and_clamped() {
  JsonDocument d, out;
  deserializeJson(d, "{\"id\":3,\"name\":\"Head turn\",\"steps\":[[1200,\"SERVO\",1,200],[0,\"SERVO\",1,9000],[500,\"RELAY\",1,1]]}");
  PmSequence s;
  TEST_ASSERT_NULL(pm_sequence_from_json(d.as<JsonVariantConst>(), s));
  TEST_ASSERT_EQUAL(3, s.step_count);
  TEST_ASSERT_EQUAL(0, s.steps[0].t_ms);
  TEST_ASSERT_EQUAL(1000, s.steps[0].value);  // clamped to the servo range
  TEST_ASSERT_EQUAL(1200, s.length_ms());
  pm_sequence_to_json(s, out.to<JsonObject>());
  PmSequence back;
  TEST_ASSERT_NULL(pm_sequence_from_json(out.as<JsonVariantConst>(), back));
  TEST_ASSERT_EQUAL_STRING("Head turn", back.name);
  TEST_ASSERT_EQUAL(500, back.steps[1].t_ms);
  TEST_ASSERT_EQUAL(PM_CHANNEL_KIND_RELAY, back.steps[1].kind);
}

// A full sequence must fit one mesh API message (pm_reassembly.h: 4320).
static void test_full_sequence_fits_one_mesh_message() {
  PmSequence s;
  s.id = 65535;
  memset(s.name, 'x', PM_SEQ_NAME_LEN - 1);
  for (int i = 0; i < PM_MAX_STEPS; i++) s.steps[s.step_count++] = {PM_MAX_STEP_MS, PM_CHANNEL_KIND_LED_STRIP, 255, 16777215};
  JsonDocument d;
  JsonObject req = d.to<JsonObject>();
  req["id"] = 999999; req["cmd"] = "set_sequence"; req["node"] = "deadbeef";
  pm_sequence_to_json(s, req["sequence"].to<JsonObject>());
  char buf[8000];
  size_t n = serializeJson(d, buf, sizeof(buf));
  TEST_ASSERT_TRUE(n <= 4320);
}

static void test_rules_json() {
  JsonDocument d, out;
  deserializeJson(d, "[{\"input\":1,\"on\":\"active\",\"seq\":3,\"cooldown_ms\":30000},{\"input\":1,\"on\":\"clear\",\"seq\":4,\"enabled\":false}]");
  PmRule r[PM_MAX_RULES];
  uint8_t n;
  TEST_ASSERT_NULL(pm_rules_from_json(d.as<JsonArrayConst>(), r, n));
  TEST_ASSERT_EQUAL(2, n);
  TEST_ASSERT_TRUE(r[0].enabled);
  TEST_ASSERT_EQUAL(3, r[0].seqs[0]);   // the old one-sequence form still reads
  TEST_ASSERT_FALSE(r[1].on_active);
  TEST_ASSERT_FALSE(r[1].enabled);
  deserializeJson(d, "[{\"input\":1,\"on\":\"sideways\",\"seq\":3}]");
  TEST_ASSERT_NOT_NULL(pm_rules_from_json(d.as<JsonArrayConst>(), r, n));
  // The full form, and the round trip.
  deserializeJson(d, "[{\"trigger\":\"after\",\"after\":5,\"delay_ms\":6200,\"cooldown_ms\":1000,\"pick\":\"random\",\"seqs\":[6,7],\"limit\":{\"fires\":10,\"window_min\":60}}]");
  TEST_ASSERT_NULL(pm_rules_from_json(d.as<JsonArrayConst>(), r, n));
  TEST_ASSERT_EQUAL(PM_TRIG_AFTER, r[0].trigger);
  TEST_ASSERT_EQUAL(5, r[0].after);
  TEST_ASSERT_EQUAL(6200, r[0].delay_ms);
  TEST_ASSERT_EQUAL(PM_PICK_RANDOM, r[0].pick);
  TEST_ASSERT_EQUAL(2, r[0].seq_count);
  TEST_ASSERT_EQUAL(10, r[0].max_fires);
  TEST_ASSERT_EQUAL(60, r[0].window_min);
  JsonDocument back;
  pm_rules_to_json(r, n, back.to<JsonArray>());
  PmRule r2[PM_MAX_RULES]; uint8_t n2;
  TEST_ASSERT_NULL(pm_rules_from_json(back.as<JsonArrayConst>(), r2, n2));
  TEST_ASSERT_EQUAL(0, memcmp(&r[0], &r2[0], sizeof(PmRule)));
  deserializeJson(d, "[{\"trigger\":\"after\",\"after\":5,\"seqs\":[6],\"limit\":{\"fires\":3}}]");
  TEST_ASSERT_NOT_NULL(pm_rules_from_json(d.as<JsonArrayConst>(), r, n));   // lockout without a window
}

static void test_show_put_replace_remove() {
  PmShow sh;
  TEST_ASSERT_TRUE(sh.put(seq(5, {{0, 1, 1, 1}})));
  TEST_ASSERT_TRUE(sh.put(seq(6, {})));
  TEST_ASSERT_TRUE(sh.put(seq(5, {{0, 1, 1, 0}, {10, 1, 1, 1}})));  // replace
  TEST_ASSERT_EQUAL(2, sh.seq_count);
  TEST_ASSERT_EQUAL(2, sh.find(5)->step_count);
  TEST_ASSERT_TRUE(sh.remove(5));
  TEST_ASSERT_NULL(sh.find(5));
  TEST_ASSERT_NOT_NULL(sh.find(6));
}

// --- ramps -------------------------------------------------------------

// A ramp step fires at its START (t - dur), with the start time passed
// through, and sorts by start even when its t is later.
static void test_ramp_step_fires_at_its_start() {
  PmSequence s = seq(1, {{2000, PM_CHANNEL_KIND_SERVO, 1, 900, 1500, 50, 50},   // starts at 500
                         {1000, PM_CHANNEL_KIND_RELAY, 1, 1}});
  TEST_ASSERT_EQUAL(500, s.steps[0].start_ms());
  TEST_ASSERT_EQUAL(1000, s.steps[1].start_ms());
  PmPlayer p;
  std::vector<std::pair<uint32_t, int64_t>> ran;
  auto rec = [&](const PmStep &st, int64_t start) { ran.push_back({st.t_ms, start}); };
  p.start(&s, 1000000);
  p.tick(1499999, rec);  TEST_ASSERT_EQUAL(0, ran.size());
  p.tick(1500000, rec);  TEST_ASSERT_EQUAL(1, ran.size());
  TEST_ASSERT_EQUAL(2000, ran[0].first);
  TEST_ASSERT_EQUAL_INT64(1500000, ran[0].second);
  p.tick(2000000, rec);  TEST_ASSERT_EQUAL(2, ran.size());
}

static void test_ramp_rules() {
  PmNodeConfig c = node();
  TEST_ASSERT_NULL(pm_check_sequence(seq(1, {{2000, PM_CHANNEL_KIND_SERVO, 1, 500, 2000, 0, 100}}), c));
  TEST_ASSERT_NOT_NULL(pm_check_sequence(seq(1, {{2000, PM_CHANNEL_KIND_RELAY, 1, 1, 500, 0, 0}}), c));     // relays don't ramp
  TEST_ASSERT_NOT_NULL(pm_check_sequence(seq(1, {{1000, PM_CHANNEL_KIND_SERVO, 1, 500, 1500, 0, 0}}), c));  // starts before 0
  TEST_ASSERT_NOT_NULL(pm_check_sequence(seq(1, {{1000, PM_CHANNEL_KIND_SERVO, 1, 500, 500, 70, 40}}), c)); // in + out > 100
}

static void test_ramp_json_round_trip_and_legacy_names() {
  JsonDocument d, out;
  // a plain step, a ramp with amounts, and a ramp in the old named form
  deserializeJson(d, "{\"id\":2,\"steps\":[[0,\"SERVO\",1,100],[1500,\"SERVO\",1,900,1500,20,60],[3000,\"LED\",1,0,1000,\"out\"]]}");
  PmSequence s;
  TEST_ASSERT_NULL(pm_sequence_from_json(d.as<JsonVariantConst>(), s));
  TEST_ASSERT_EQUAL(3, s.step_count);
  TEST_ASSERT_EQUAL(0, s.steps[0].dur_ms);
  TEST_ASSERT_EQUAL(1500, s.steps[1].dur_ms);
  TEST_ASSERT_EQUAL(20, s.steps[1].ease_in);
  TEST_ASSERT_EQUAL(60, s.steps[1].ease_out);
  TEST_ASSERT_EQUAL(0, s.steps[2].ease_in);    // "out" = 0/100
  TEST_ASSERT_EQUAL(100, s.steps[2].ease_out);
  pm_sequence_to_json(s, out.to<JsonObject>());
  TEST_ASSERT_EQUAL(4, out["steps"][0].size());  // plain step keeps the short form
  TEST_ASSERT_EQUAL(7, out["steps"][1].size());
  TEST_ASSERT_EQUAL(60, out["steps"][1][6].as<int>());
  TEST_ASSERT_EQUAL(7, out["steps"][2].size());  // legacy name written back as amounts
  deserializeJson(d, "{\"id\":2,\"steps\":[[1500,\"SERVO\",1,900,1500,\"bouncy\"]]}");
  TEST_ASSERT_NOT_NULL(pm_sequence_from_json(d.as<JsonVariantConst>(), s));
  deserializeJson(d, "{\"id\":2,\"steps\":[[1500,\"SERVO\",1,900,1500,120,0]]}");
  TEST_ASSERT_NOT_NULL(pm_sequence_from_json(d.as<JsonVariantConst>(), s));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_steps_run_on_time_in_order);
  RUN_TEST(test_late_start_catches_up);
  RUN_TEST(test_start_offset_skips_earlier_steps);
  RUN_TEST(test_retrigger_restarts_from_top);
  RUN_TEST(test_concurrent_limit_and_stop);
  RUN_TEST(test_rule_fires_on_edge_with_cooldown);
  RUN_TEST(test_disabled_rule_and_clear_edge);
  RUN_TEST(test_delay_and_fan_out);
  RUN_TEST(test_random_pick_and_lockout);
  RUN_TEST(test_chain_after_sequence);
  RUN_TEST(test_cue_copies_played_once);
  RUN_TEST(test_sequence_checked_against_node);
  RUN_TEST(test_rules_checked_against_node);
  RUN_TEST(test_sequence_json_round_trip_sorted_and_clamped);
  RUN_TEST(test_full_sequence_fits_one_mesh_message);
  RUN_TEST(test_rules_json);
  RUN_TEST(test_show_put_replace_remove);
  RUN_TEST(test_ramp_step_fires_at_its_start);
  RUN_TEST(test_ramp_rules);
  RUN_TEST(test_ramp_json_round_trip_and_legacy_names);
  return UNITY_END();
}
