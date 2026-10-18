// The candle model (pm_candle_core.h, docs §6n): an hour of simulated
// flicker, checked for the things that would hurt a real candle or look
// wrong — a coil held on, a flame that goes fully dark, events that never
// come — plus the config round trip and the validator's limits.
#include <unity.h>
#include "pm_candle_core.h"
#include "pm_pinrules.h"
#include "pm_config_json.h"

void setUp() {}
void tearDown() {}

static void run_hour(const PmCandleCfg &cfg, float *lo, float *hi, uint32_t *kicks, uint16_t *widest, uint32_t *gust_ticks) {
  PmCandleCore m;
  m.begin(cfg, 0, 12345);
  *lo = 1; *hi = 0; *kicks = 0; *widest = 0; *gust_ticks = 0;
  for (uint32_t t = 0; t < 3600000; t += PM_CANDLE_TICK_MS) {
    float b = m.led(t, PM_CANDLE_TICK_MS);
    if (b < *lo) *lo = b;
    if (b > *hi) *hi = b;
    if (m.gusting()) (*gust_ticks)++;
    uint16_t w = m.kick(t);
    if (w) { (*kicks)++; if (w > *widest) *widest = w; }
  }
}

static void test_flicker_stays_in_range_and_never_goes_dark() {
  PmCandleCfg cfg;  // the sketch's defaults
  float lo, hi; uint32_t kicks, gust_ticks; uint16_t widest;
  run_hour(cfg, &lo, &hi, &kicks, &widest, &gust_ticks);
  TEST_ASSERT_TRUE(lo >= cfg.floor / 100.0f - 1e-6f);  // never below the floor
  TEST_ASSERT_TRUE(hi <= 1.0f);
  TEST_ASSERT_TRUE(lo < 0.3f);   // the sputters do dip
  TEST_ASSERT_TRUE(hi > 0.85f);  // and it burns near full most of the time
}

// At 2.7 Hz with bursts of 3-5 and ~1 s rests, an hour is thousands of
// kicks; none wider than the gust kick (kick_ms × 1.4).
static void test_coil_kicks_are_bounded() {
  PmCandleCfg cfg;
  float lo, hi; uint32_t kicks, gust_ticks; uint16_t widest;
  run_hour(cfg, &lo, &hi, &kicks, &widest, &gust_ticks);
  TEST_ASSERT_TRUE(kicks > 6000 && kicks < 11000);  // ~2.7 Hz with short pauses and a skip in ten
  TEST_ASSERT_TRUE(widest <= (uint16_t)(cfg.kick_ms * 1.7f * 1.15f) + 1);  // a sputter's hardest pump
  TEST_ASSERT_TRUE(widest <= 100);
  TEST_ASSERT_TRUE(gust_ticks > 0);  // gusts happened
}

static void test_coil_off_means_no_kicks() {
  PmCandleCfg cfg;
  cfg.coil = false;
  float lo, hi; uint32_t kicks, gust_ticks; uint16_t widest;
  run_hour(cfg, &lo, &hi, &kicks, &widest, &gust_ticks);
  TEST_ASSERT_EQUAL_UINT32(0, kicks);
}

static void test_calm_candle_barely_dips() {
  PmCandleCfg cfg;
  cfg.drama10 = 0;
  cfg.sputter_s = 0;  // never
  float lo, hi; uint32_t kicks, gust_ticks; uint16_t widest;
  run_hour(cfg, &lo, &hi, &kicks, &widest, &gust_ticks);
  TEST_ASSERT_TRUE(lo > 0.7f);  // only the slow wander is left
}

static void test_candle_config_round_trips_and_validates() {
  PmNodeConfig c;
  c.channel_count = 1;
  PmChannelCfg &ch = c.channels[0];
  ch.kind = PM_CHANNEL_KIND_CANDLE;
  ch.index = 1;
  ch.pin_count = 2;
  ch.pins[0] = 25;
  ch.pins[1] = 26;
  ch.active_low = true;
  ch.candle.swing_chz = 300;
  ch.candle.coil = false;
  JsonDocument doc;
  pm_config_to_json(c, doc.to<JsonObject>());
  PmNodeConfig back;
  TEST_ASSERT_NULL(pm_config_from_json(doc.as<JsonVariantConst>(), back));
  TEST_ASSERT_EQUAL_UINT8(PM_CHANNEL_KIND_CANDLE, back.channels[0].kind);
  TEST_ASSERT_TRUE(back.channels[0].active_low);
  TEST_ASSERT_EQUAL_UINT16(300, back.channels[0].candle.swing_chz);
  TEST_ASSERT_FALSE(back.channels[0].candle.coil);
  PmIssues ok = pm_validate(PM_BOARD_ESP32_DEVKIT_V1, back);
  TEST_ASSERT_EQUAL_UINT8(0, ok.errors);

  back.channels[0].candle.kick_ms = 200;  // would cook the coil
  PmIssues bad = pm_validate(PM_BOARD_ESP32_DEVKIT_V1, back);
  TEST_ASSERT_TRUE(bad.has("candle_settings"));
  back.channels[0].candle.kick_ms = 25;
  back.channels[0].pins[1] = 34;  // input-only: can't drive a coil
  TEST_ASSERT_TRUE(pm_validate(PM_BOARD_ESP32_DEVKIT_V1, back).has("pin_cannot"));
}

// Tuning: steady kicks at exactly the asked rate, no rests, no gust
// pumping; back to the burst pattern when it stops.
static void test_tuning_kicks_steadily_at_the_rate() {
  PmCandleCfg cfg;
  PmCandleCore m;
  m.begin(cfg, 0, 7);
  m.tune(285);  // 2.85 Hz
  uint32_t kicks = 0; uint16_t widest = 0;
  for (uint32_t t = 0; t < 20000; t += PM_CANDLE_TICK_MS) {
    m.led(t, PM_CANDLE_TICK_MS);
    uint16_t w = m.kick(t);
    if (w) { kicks++; if (w > widest) widest = w; }
  }
  TEST_ASSERT_TRUE(kicks >= 56 && kicks <= 58);  // 2.85 × 20 s = 57
  TEST_ASSERT_EQUAL_UINT16(cfg.kick_ms, widest);  // never the gust's wider kick
  m.tune(285, 12);  // a trial kick width rides along
  TEST_ASSERT_EQUAL_UINT16(12, m.kick(20000 + 5000));
  // Bursts at the tuned rate: fewer kicks than steady, all at the trial width.
  m.tune(285, 12, true);
  uint32_t bk = 0; uint16_t bw = 0;
  for (uint32_t t = 30000; t < 50000; t += PM_CANDLE_TICK_MS) { uint16_t w = m.kick(t); if (w) { bk++; if (w > bw) bw = w; } }
  TEST_ASSERT_TRUE(bk > 10 && bk < 50);
  TEST_ASSERT_EQUAL_UINT16(12, bw);
  m.tune(0);
  uint32_t after = 0;
  for (uint32_t t = 50000; t < 110000; t += PM_CANDLE_TICK_MS) { m.led(t, PM_CANDLE_TICK_MS); if (m.kick(t)) after++; }
  TEST_ASSERT_TRUE(after < 57 * 3 && after > 57 * 2);  // resting runs again: a little under steady
}

// The wobble follows the flicker: kicks during a gust are wider than at
// rest, and resting kicks are not all the same width.
static void test_coil_follows_the_flicker() {
  PmCandleCfg cfg;
  PmCandleCore m;
  m.begin(cfg, 0, 99);
  uint16_t rest_lo = 999, rest_hi = 0, gust_hi = 0;
  for (uint32_t t = 0; t < 600000; t += PM_CANDLE_TICK_MS) {
    m.led(t, PM_CANDLE_TICK_MS);
    uint16_t w = m.kick(t);
    if (!w) continue;
    if (m.pumping()) { if (w > gust_hi) gust_hi = w; }
    else { if (w < rest_lo) rest_lo = w; if (w > rest_hi) rest_hi = w; }
  }
  TEST_ASSERT_TRUE(rest_lo < rest_hi);          // varies at rest
  TEST_ASSERT_TRUE(rest_hi <= cfg.kick_ms + 1);
  TEST_ASSERT_TRUE(rest_lo >= cfg.kick_ms * 0.75f - 1);
  TEST_ASSERT_TRUE(gust_hi > cfg.kick_ms * 1.3f); // harder in a gust
  TEST_ASSERT_TRUE(gust_hi <= 100);
}

// Candles in the same draft gust at the same mesh second with the same
// shape; a different draft (or no draft) is independent of them.
static void test_draft_syncs_gusts_across_candles() {
  PmCandleCfg a; a.draft = 3;
  PmCandleCfg b; b.draft = 3;
  PmCandleCfg other; other.draft = 4;
  PmCandleCore ca, cb, co;
  ca.begin(a, 0, 1); cb.begin(b, 0, 999); co.begin(other, 0, 5);
  uint32_t same = 0, starts_a = 0, starts_o = 0, differ = 0;
  bool wa = false, wo = false;
  for (uint32_t t = 0; t < 3600000; t += PM_CANDLE_TICK_MS) {
    int64_t mesh_us = (int64_t)t * 1000 + 777000000LL;  // mesh time: any offset, shared
    ca.draft_tick(t, true, mesh_us); cb.draft_tick(t, true, mesh_us); co.draft_tick(t, true, mesh_us);
    ca.led(t, PM_CANDLE_TICK_MS); cb.led(t, PM_CANDLE_TICK_MS); co.led(t, PM_CANDLE_TICK_MS);
    if (ca.gusting() != cb.gusting()) differ++;
    if (ca.gusting() && !wa) starts_a++;
    if (co.gusting() && !wo) starts_o++;
    wa = ca.gusting(); wo = co.gusting();
    if (ca.gusting() && co.gusting()) same++;
  }
  TEST_ASSERT_EQUAL_UINT32(0, differ);          // a and b always agree
  TEST_ASSERT_TRUE(starts_a > 100 && starts_a < 400);  // ~1 per 18 s over an hour
  TEST_ASSERT_TRUE(starts_o > 100 && starts_o < 400);
  TEST_ASSERT_TRUE(same < (uint32_t)(starts_a * 100));  // drafts 3 and 4 mostly don't overlap
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_flicker_stays_in_range_and_never_goes_dark);
  RUN_TEST(test_coil_kicks_are_bounded);
  RUN_TEST(test_coil_off_means_no_kicks);
  RUN_TEST(test_calm_candle_barely_dips);
  RUN_TEST(test_candle_config_round_trips_and_validates);
  RUN_TEST(test_tuning_kicks_steadily_at_the_rate);
  RUN_TEST(test_coil_follows_the_flicker);
  RUN_TEST(test_draft_syncs_gusts_across_candles);
  return UNITY_END();
}
