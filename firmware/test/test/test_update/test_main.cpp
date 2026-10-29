// The bridge during an update: which requests wait their turn, and the
// direct-send choice with its back-off (pm_update_core.h).
#include <unity.h>
#include "pm_update_core.h"

void setUp() {}
void tearDown() {}

static void test_reads_wait_their_turn() {
  TEST_ASSERT_TRUE(pm_upd_waits_turn("hello"));
  TEST_ASSERT_TRUE(pm_upd_waits_turn("state"));
  TEST_ASSERT_TRUE(pm_upd_waits_turn("get_config"));
  TEST_ASSERT_TRUE(pm_upd_waits_turn("get_sequence"));
  TEST_ASSERT_TRUE(pm_upd_waits_turn("ota_status"));
}

static void test_actions_go_straight_out() {
  TEST_ASSERT_FALSE(pm_upd_waits_turn("cue"));
  TEST_ASSERT_FALSE(pm_upd_waits_turn("all_off"));
  TEST_ASSERT_FALSE(pm_upd_waits_turn("set"));
  TEST_ASSERT_FALSE(pm_upd_waits_turn("set_config"));
  TEST_ASSERT_FALSE(pm_upd_waits_turn("set_mode"));
  TEST_ASSERT_FALSE(pm_upd_waits_turn("hold_awake"));
}

static void test_direct_needs_a_good_direct_link() {
  PmDirect d = {};
  TEST_ASSERT_TRUE(pm_direct_choose(d, true, -79));
  TEST_ASSERT_TRUE(pm_direct_choose(d, true, PM_DIRECT_MIN_RSSI));
  TEST_ASSERT_FALSE(pm_direct_choose(d, true, -89));  // weak: the relays are its better way in
  TEST_ASSERT_FALSE(pm_direct_choose(d, false, -60)); // not heard directly at all
}

static void test_one_miss_is_forgiven() {
  PmDirect d = {};
  pm_direct_missed(d);
  pm_direct_answered(d);
  pm_direct_missed(d);
  TEST_ASSERT_TRUE(pm_direct_choose(d, true, -70));
}

static void test_two_misses_back_off_then_retry() {
  PmDirect d = {};
  pm_direct_missed(d);
  pm_direct_missed(d);
  for (int i = 0; i < PM_DIRECT_BACKOFF; i++) TEST_ASSERT_FALSE(pm_direct_choose(d, true, -70));
  TEST_ASSERT_TRUE(pm_direct_choose(d, true, -70));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_reads_wait_their_turn);
  RUN_TEST(test_actions_go_straight_out);
  RUN_TEST(test_direct_needs_a_good_direct_link);
  RUN_TEST(test_one_miss_is_forgiven);
  RUN_TEST(test_two_misses_back_off_then_retry);
  return UNITY_END();
}
