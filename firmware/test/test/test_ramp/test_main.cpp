#include <unity.h>
#include "pm_ramp.h"

void setUp() {}
void tearDown() {}

static const uint8_t SHAPES[][2] = {{0, 0}, {50, 50}, {100, 0}, {0, 100}, {20, 60}, {30, 30}, {10, 0}};

static void test_ease_endpoints_and_clamp() {
  for (auto &e : SHAPES) {
    TEST_ASSERT_EQUAL_FLOAT(0, pm_ease(e[0], e[1], 0));
    TEST_ASSERT_EQUAL_FLOAT(1, pm_ease(e[0], e[1], 1));
    TEST_ASSERT_EQUAL_FLOAT(0, pm_ease(e[0], e[1], -3));
    TEST_ASSERT_EQUAL_FLOAT(1, pm_ease(e[0], e[1], 7));
  }
}

// The new amounts reproduce the old named presets exactly, so stored
// sequences keep their shape.
static void test_presets_match_old_quadratics() {
  for (int i = 1; i < 100; i++) {
    float p = i / 100.0f;
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, p, pm_ease(0, 0, p));
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, p * p, pm_ease(100, 0, p));
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 1 - (1 - p) * (1 - p), pm_ease(0, 100, p));
    float io = p < 0.5f ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, io, pm_ease(50, 50, p));
  }
}

static void test_every_shape_is_monotonic_and_continuous() {
  for (auto &e : SHAPES) {
    float last = 0;
    for (int i = 1; i <= 1000; i++) {
      float v = pm_ease(e[0], e[1], i / 1000.0f);
      TEST_ASSERT_TRUE(v >= last);
      TEST_ASSERT_TRUE(v - last < 0.01f);  // no jumps at the phase boundaries
      last = v;
    }
  }
}

// Speeds up over the first 20 %, slows over the last 60 %: halfway in
// time it is past halfway in distance (fast cruise early).
static void test_asymmetric_shape() {
  TEST_ASSERT_TRUE(pm_ease(20, 60, 0.5f) > 0.5f);
  TEST_ASSERT_TRUE(pm_ease(60, 20, 0.5f) < 0.5f);
  TEST_ASSERT_TRUE(pm_ease(20, 60, 0.1f) < 0.1f);  // still easing in
}

static void test_ramp_follows_the_line() {
  PmRamp r;
  r.begin(200, 800, 1000000, 2000, PM_EASE_PRESET_LINEAR);  // 1.0 s -> 3.0 s
  TEST_ASSERT_EQUAL_INT32(200, r.at(1000000));
  TEST_ASSERT_EQUAL_INT32(500, r.at(2000000));
  TEST_ASSERT_TRUE(r.active);
  TEST_ASSERT_EQUAL_INT32(800, r.at(3000000));
  TEST_ASSERT_FALSE(r.active);
}

static void test_late_start_lands_mid_curve() {
  PmRamp r;
  r.begin(0, 1000, 0, 4000, PM_EASE_PRESET_LINEAR);
  TEST_ASSERT_EQUAL_INT32(750, r.at(3000000));
}

static void test_before_start_holds_from() {
  PmRamp r;
  r.begin(300, 900, 5000000, 1000, PM_EASE_PRESET_INOUT);
  TEST_ASSERT_EQUAL_INT32(300, r.at(4000000));
  TEST_ASSERT_TRUE(r.active);
}

static void test_downward_ramp_and_zero_duration() {
  PmRamp r;
  r.begin(1000, 0, 0, 1000, PM_EASE_PRESET_OUT);
  TEST_ASSERT_EQUAL_INT32(250, r.at(500000));
  PmRamp z;
  z.begin(0, 700, 0, 0, PM_EASE_PRESET_LINEAR);
  TEST_ASSERT_EQUAL_INT32(700, z.at(0));
  TEST_ASSERT_FALSE(z.active);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_ease_endpoints_and_clamp);
  RUN_TEST(test_presets_match_old_quadratics);
  RUN_TEST(test_every_shape_is_monotonic_and_continuous);
  RUN_TEST(test_asymmetric_shape);
  RUN_TEST(test_ramp_follows_the_line);
  RUN_TEST(test_late_start_lands_mid_curve);
  RUN_TEST(test_before_start_holds_from);
  RUN_TEST(test_downward_ramp_and_zero_duration);
  return UNITY_END();
}
