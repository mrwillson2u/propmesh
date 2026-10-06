#include <unity.h>
#include "pm_motion.h"

void setUp() {}
void tearDown() {}

// Run until stopped (or a safety cap); returns elapsed ms.
static float run(PmMotion &m, uint16_t travel, uint16_t ease, float *peak_v = nullptr,
                 bool *overshot = nullptr) {
  float t = 0, start = m.pos, tgt = m.target;
  while (t < 20000) {
    bool moving = m.step(20, travel, ease);
    t += 20;
    if (peak_v && fabsf(m.vel) > *peak_v) *peak_v = fabsf(m.vel);
    if (overshot && ((tgt >= start && m.pos > tgt + 0.01f) || (tgt < start && m.pos < tgt - 0.01f))) *overshot = true;
    if (!moving) break;
  }
  return t;
}

static void test_off_jumps() {
  PmMotion m;
  m.target = 800;
  TEST_ASSERT_FALSE(m.step(20, 0, 0));
  TEST_ASSERT_EQUAL_FLOAT(800, m.pos);
}

// A full sweep takes about travel + ease (ramp up and down cost half an
// ease each way), and arrives exactly.
static void test_full_sweep_time_and_arrival() {
  PmMotion m;
  m.target = 1000;
  float t = run(m, 600, 200);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 1000, m.pos);
  TEST_ASSERT_TRUE(t >= 600 && t <= 900);
}

static void test_speed_never_exceeds_cruise() {
  PmMotion m;
  m.target = 1000;
  float peak = 0;
  run(m, 500, 100, &peak);
  TEST_ASSERT_TRUE(peak <= 1000.0f / 500 + 1e-4f);
}

// Starts gently: after one tick it has barely moved.
static void test_eases_in() {
  PmMotion m;
  m.target = 1000;
  m.step(20, 600, 300);
  TEST_ASSERT_TRUE(m.pos < 5);
}

static void test_never_overshoots_either_way() {
  bool over = false;
  PmMotion a; a.target = 1000; run(a, 300, 0, nullptr, &over);
  PmMotion b; b.jump(900); b.target = 100; run(b, 300, 250, nullptr, &over);
  PmMotion c; c.target = 3; run(c, 1500, 400, nullptr, &over);
  TEST_ASSERT_FALSE(over);
}

// The point of a follower: a new target mid-move keeps the velocity —
// no drop to zero, no backwards lurch.
static void test_retarget_keeps_velocity() {
  PmMotion m;
  m.target = 1000;
  for (int i = 0; i < 15; i++) m.step(20, 600, 200);
  float v_before = m.vel;
  m.target = 900;  // dragged a bit further back, same direction
  m.step(20, 600, 200);
  TEST_ASSERT_TRUE(v_before > 0);
  TEST_ASSERT_TRUE(m.vel > v_before * 0.8f);
}

// Reversing mid-move decelerates through zero rather than snapping.
static void test_reverse_mid_move_is_smooth() {
  PmMotion m;
  m.target = 1000;
  for (int i = 0; i < 15; i++) m.step(20, 600, 200);
  float p = m.pos, v = m.vel;
  m.target = 0;
  m.step(20, 600, 200);
  TEST_ASSERT_TRUE(m.vel < v);         // slowing
  TEST_ASSERT_TRUE(m.pos >= p);        // still carried forward this tick
  run(m, 600, 200);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 0, m.pos);
}

// Heading for 1000 at speed, then told to go back: it brakes through the
// end stop region but never past it.
static void test_reverse_near_end_stays_in_range() {
  PmMotion m;
  m.jump(950);
  m.target = 1000;
  m.vel = 1000.0f / 250;  // at cruise for a 250 ms sweep
  m.target = 0;
  float hi = 0;
  for (int i = 0; i < 200; i++) { m.step(20, 250, 400); if (m.pos > hi) hi = m.pos; }
  TEST_ASSERT_TRUE(hi <= 1000);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 0, m.pos);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_off_jumps);
  RUN_TEST(test_full_sweep_time_and_arrival);
  RUN_TEST(test_speed_never_exceeds_cruise);
  RUN_TEST(test_eases_in);
  RUN_TEST(test_never_overshoots_either_way);
  RUN_TEST(test_retarget_keeps_velocity);
  RUN_TEST(test_reverse_mid_move_is_smooth);
  RUN_TEST(test_reverse_near_end_stays_in_range);
  return UNITY_END();
}
