#include <unity.h>
#include "pm_ramp.h"

void setUp() {}
void tearDown() {}

static void test_ease_endpoints_and_clamp() {
  for (uint8_t e = 0; e < PM_EASE_COUNT; e++) {
    TEST_ASSERT_EQUAL_FLOAT(0, pm_ease(e, 0));
    TEST_ASSERT_EQUAL_FLOAT(1, pm_ease(e, 1));
    TEST_ASSERT_EQUAL_FLOAT(0, pm_ease(e, -3));
    TEST_ASSERT_EQUAL_FLOAT(1, pm_ease(e, 7));
  }
}

static void test_ease_shapes() {
  TEST_ASSERT_EQUAL_FLOAT(0.5f, pm_ease(PM_EASE_LINEAR, 0.5f));
  TEST_ASSERT_EQUAL_FLOAT(0.25f, pm_ease(PM_EASE_IN, 0.5f));    // slow start
  TEST_ASSERT_EQUAL_FLOAT(0.75f, pm_ease(PM_EASE_OUT, 0.5f));   // fast start
  TEST_ASSERT_EQUAL_FLOAT(0.5f, pm_ease(PM_EASE_INOUT, 0.5f));  // symmetric
  TEST_ASSERT_TRUE(pm_ease(PM_EASE_INOUT, 0.25f) < 0.25f);
  TEST_ASSERT_TRUE(pm_ease(PM_EASE_INOUT, 0.75f) > 0.75f);
}

static void test_every_ease_is_monotonic() {
  for (uint8_t e = 0; e < PM_EASE_COUNT; e++) {
    float last = 0;
    for (int i = 1; i <= 100; i++) {
      float v = pm_ease(e, i / 100.0f);
      TEST_ASSERT_TRUE(v >= last);
      last = v;
    }
  }
}

static void test_ramp_follows_the_line() {
  PmRamp r;
  r.begin(200, 800, 1000000, 2000, PM_EASE_LINEAR);  // 1.0 s -> 3.0 s
  TEST_ASSERT_EQUAL_INT32(200, r.at(1000000));
  TEST_ASSERT_EQUAL_INT32(500, r.at(2000000));
  TEST_ASSERT_TRUE(r.active);
  TEST_ASSERT_EQUAL_INT32(800, r.at(3000000));
  TEST_ASSERT_FALSE(r.active);
}

// A late cue: the ramp is asked for its value after its scheduled
// start — it must be further along the line, not restarted.
static void test_late_start_lands_mid_curve() {
  PmRamp r;
  r.begin(0, 1000, 0, 4000, PM_EASE_LINEAR);
  TEST_ASSERT_EQUAL_INT32(750, r.at(3000000));
}

static void test_before_start_holds_from() {
  PmRamp r;
  r.begin(300, 900, 5000000, 1000, PM_EASE_INOUT);
  TEST_ASSERT_EQUAL_INT32(300, r.at(4000000));
  TEST_ASSERT_TRUE(r.active);
}

static void test_downward_ramp_and_zero_duration() {
  PmRamp r;
  r.begin(1000, 0, 0, 1000, PM_EASE_OUT);
  TEST_ASSERT_EQUAL_INT32(250, r.at(500000));  // 75 % of the way down
  PmRamp z;
  z.begin(0, 700, 0, 0, PM_EASE_LINEAR);
  TEST_ASSERT_EQUAL_INT32(700, z.at(0));
  TEST_ASSERT_FALSE(z.active);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_ease_endpoints_and_clamp);
  RUN_TEST(test_ease_shapes);
  RUN_TEST(test_every_ease_is_monotonic);
  RUN_TEST(test_ramp_follows_the_line);
  RUN_TEST(test_late_start_lands_mid_curve);
  RUN_TEST(test_before_start_holds_from);
  RUN_TEST(test_downward_ramp_and_zero_duration);
  return UNITY_END();
}
