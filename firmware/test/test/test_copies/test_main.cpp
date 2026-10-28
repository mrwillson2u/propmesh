// The bridge's board copies: what a copy keeps, whether settings agree,
// and what a visit at a check-in does (pm_copies_core.h).
#include <unity.h>
#include "pm_copies_core.h"

void setUp() {}
void tearDown() {}

static JsonDocument J(const char *s) { JsonDocument d; deserializeJson(d, s); return d; }

static void test_copy_drops_secrets() {
  JsonDocument in = J(R"({"v":1,"name":"Candle","brmesh_key":"a1b2c3d4","wifi":{"ssid":"home","pass":"x","pass_set":true},"channels":[]})");
  JsonDocument out;
  pm_copy_config(in.as<JsonObjectConst>(), out.to<JsonObject>());
  TEST_ASSERT_TRUE(out["brmesh_key"].isNull());
  TEST_ASSERT_TRUE(out["wifi"]["pass"].isNull());
  TEST_ASSERT_EQUAL_STRING("home", out["wifi"]["ssid"]);
  TEST_ASSERT_TRUE(out["wifi"]["pass_set"].as<bool>());
  TEST_ASSERT_EQUAL_STRING("Candle", out["name"]);
}

static void test_hello_keeps_list_fields() {
  JsonDocument in = J(R"({"ok":true,"node":"e076df14","name":"Candle 1","power":"battery","checkin_ms":300000,"up_s":12,"hold_s":170,"build":"abc"})");
  JsonDocument out;
  pm_copy_hello(in.as<JsonObjectConst>(), out.to<JsonObject>());
  TEST_ASSERT_EQUAL_STRING("Candle 1", out["name"]);
  TEST_ASSERT_EQUAL(300000, out["checkin_ms"].as<long>());
  TEST_ASSERT_TRUE(out["up_s"].isNull());
  TEST_ASSERT_TRUE(out["hold_s"].isNull());
  TEST_ASSERT_TRUE(out["ok"].isNull());
}

// The console leaves defaults out; the board fills them in. Key order differs.
static void test_within_defaults_and_order() {
  JsonDocument a = J(R"({"name":"C","channels":[{"kind":"LED","index":1,"pins":[5]}]})");
  JsonDocument b = J(R"({"v":1,"channels":[{"pins":[5],"index":1,"kind":"LED","invert":false}],"name":"C","power":"mains"})");
  TEST_ASSERT_TRUE(pm_settings_hold(a.as<JsonVariantConst>(), b.as<JsonVariantConst>()));
}

static void test_within_catches_a_change() {
  JsonDocument a = J(R"({"name":"C","channels":[{"kind":"LED","index":1,"pins":[5]}]})");
  JsonDocument b = J(R"({"name":"C","channels":[{"kind":"LED","index":1,"pins":[6]}]})");
  JsonDocument c = J(R"({"name":"D","channels":[{"kind":"LED","index":1,"pins":[5]}]})");
  JsonDocument d = J(R"({"name":"C","channels":[{"kind":"LED","index":1,"pins":[5]},{"kind":"RELAY","index":1,"pins":[7]}]})");
  TEST_ASSERT_FALSE(pm_settings_hold(a.as<JsonVariantConst>(), b.as<JsonVariantConst>()));
  TEST_ASSERT_FALSE(pm_settings_hold(a.as<JsonVariantConst>(), c.as<JsonVariantConst>()));
  TEST_ASSERT_FALSE(pm_settings_hold(a.as<JsonVariantConst>(), d.as<JsonVariantConst>()));  // a channel added
}

// The floods are the Floods tab's: a light paired since doesn't count, nor the key.
static void test_within_ignores_floods() {
  JsonDocument a = J(R"({"name":"C","channels":[{"kind":"LED","index":1,"pins":[5]}]})");
  JsonDocument b = J(R"({"name":"C","brmesh_key":"a1b2c3d4","channels":[{"kind":"BLE_LIGHT","index":1,"light":3,"pins":[]},{"kind":"LED","index":1,"pins":[5]}]})");
  TEST_ASSERT_TRUE(pm_settings_hold(a.as<JsonVariantConst>(), b.as<JsonVariantConst>()));
  TEST_ASSERT_TRUE(pm_settings_hold(b.as<JsonVariantConst>(), a.as<JsonVariantConst>()));
}

static PmCopyState base() { PmCopyState s = {}; s.has_copy = true; s.copy_at = 100; return s; }

static void test_plan_nothing_to_do() {
  PmCopyState s = base();
  s.stamps = true; s.board_at = 100;
  TEST_ASSERT_FALSE(pm_copy_plan(s).any);
  s.stamps = false;  // an older board, copy held: nothing either
  TEST_ASSERT_FALSE(pm_copy_plan(s).any);
}

static void test_plan_first_copy_and_stale() {
  PmCopyState s = {};
  PmVisitPlan p = pm_copy_plan(s);
  TEST_ASSERT_TRUE(p.any && p.read && !p.send);
  s = base(); s.stamps = true; s.board_at = 250;  // changed over USB since
  p = pm_copy_plan(s);
  TEST_ASSERT_TRUE(p.read);
}

static void test_plan_stamped_send_skips_read() {
  PmCopyState s = base();
  s.stamps = true; s.board_at = 100; s.waiting = true; s.base_at = 100; s.want_at = 300;
  PmVisitPlan p = pm_copy_plan(s);
  TEST_ASSERT_TRUE(p.send);
  TEST_ASSERT_FALSE(p.read);
  JsonDocument none;
  TEST_ASSERT_EQUAL(PM_SEND_GO, pm_copy_verdict(s, none.as<JsonVariantConst>(), none.as<JsonVariantConst>(), none.as<JsonVariantConst>()));
  s.board_at = 300;
  TEST_ASSERT_EQUAL(PM_SEND_ALREADY, pm_copy_verdict(s, none.as<JsonVariantConst>(), none.as<JsonVariantConst>(), none.as<JsonVariantConst>()));
  s.board_at = 200;
  TEST_ASSERT_EQUAL(PM_SEND_CLASH, pm_copy_verdict(s, none.as<JsonVariantConst>(), none.as<JsonVariantConst>(), none.as<JsonVariantConst>()));
}

static void test_plan_older_board_reads_then_compares() {
  PmCopyState s = base();
  s.waiting = true; s.want_at = 300;
  PmVisitPlan p = pm_copy_plan(s);
  TEST_ASSERT_TRUE(p.read && p.send);
  JsonDocument have = J(R"({"name":"Old","channels":[]})"), bse = J(R"({"name":"Old","channels":[]})"), want = J(R"({"name":"New","channels":[]})");
  JsonDocument other = J(R"({"name":"Someone else","channels":[]})"), none;
  TEST_ASSERT_EQUAL(PM_SEND_NEED_READ, pm_copy_verdict(s, none.as<JsonVariantConst>(), bse.as<JsonVariantConst>(), want.as<JsonVariantConst>()));
  TEST_ASSERT_EQUAL(PM_SEND_GO, pm_copy_verdict(s, have.as<JsonVariantConst>(), bse.as<JsonVariantConst>(), want.as<JsonVariantConst>()));
  TEST_ASSERT_EQUAL(PM_SEND_ALREADY, pm_copy_verdict(s, want.as<JsonVariantConst>(), bse.as<JsonVariantConst>(), want.as<JsonVariantConst>()));
  TEST_ASSERT_EQUAL(PM_SEND_CLASH, pm_copy_verdict(s, other.as<JsonVariantConst>(), bse.as<JsonVariantConst>(), want.as<JsonVariantConst>()));
}

static void test_plan_stuck_is_left_alone() {
  PmCopyState s = base();
  s.stamps = true; s.board_at = 100; s.waiting = true; s.stuck = true;
  TEST_ASSERT_FALSE(pm_copy_plan(s).any);
}

static void test_old_board_visit_rules() {
  TEST_ASSERT_TRUE(pm_copy_old_go(true, 0, false));     // a plain timer check-in
  TEST_ASSERT_TRUE(pm_copy_old_go(true, 5, false));     // the dwell after a reset (Candle 1 at every wake)
  TEST_ASSERT_FALSE(pm_copy_old_go(true, 19, false));   // a sync pull
  TEST_ASSERT_FALSE(pm_copy_old_go(true, 59, false));   // a sensor wake
  TEST_ASSERT_FALSE(pm_copy_old_go(true, 177, false));  // the setup window: don't stretch 3 min to 10
  TEST_ASSERT_TRUE(pm_copy_old_go(true, 590, false));   // a leftover 10-min hold nobody uses
  TEST_ASSERT_FALSE(pm_copy_old_go(true, 590, true));   // ... unless a console is at work
  TEST_ASSERT_TRUE(pm_copy_old_go(false, 177, true));   // mains: always
}

static void test_setup_window() {
  TEST_ASSERT_FALSE(pm_copy_setup_window(0));
  TEST_ASSERT_FALSE(pm_copy_setup_window(5));    // the dwell after a reset is not someone switching it on
  TEST_ASSERT_FALSE(pm_copy_setup_window(59));
  TEST_ASSERT_TRUE(pm_copy_setup_window(177));
  TEST_ASSERT_FALSE(pm_copy_setup_window(590));
}

static void test_release_rules() {
  TEST_ASSERT_TRUE(pm_copy_release(false, true, false, false));   // an older battery board: release
  TEST_ASSERT_FALSE(pm_copy_release(true, true, false, false));   // a newer one held 3 s per request: nothing to undo
  TEST_ASSERT_FALSE(pm_copy_release(false, true, true, false));   // a console is working on it
  TEST_ASSERT_FALSE(pm_copy_release(false, true, false, true));   // stay awake next time
  TEST_ASSERT_FALSE(pm_copy_release(false, false, false, false)); // mains: never asked
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_copy_drops_secrets);
  RUN_TEST(test_hello_keeps_list_fields);
  RUN_TEST(test_within_defaults_and_order);
  RUN_TEST(test_within_catches_a_change);
  RUN_TEST(test_within_ignores_floods);
  RUN_TEST(test_plan_nothing_to_do);
  RUN_TEST(test_plan_first_copy_and_stale);
  RUN_TEST(test_plan_stamped_send_skips_read);
  RUN_TEST(test_plan_older_board_reads_then_compares);
  RUN_TEST(test_plan_stuck_is_left_alone);
  RUN_TEST(test_old_board_visit_rules);
  RUN_TEST(test_setup_window);
  RUN_TEST(test_release_rules);
  return UNITY_END();
}
