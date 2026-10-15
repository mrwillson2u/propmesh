// Show schedule: sun times, calendar, window evaluation, manual hold, JSON.
// docs/software-plan.md §4.1, docs/generic-boards.md §6e.
#include <unity.h>
#include "pm_checkin.h"
#include "pm_schedule.h"
#include "pm_schedule_json.h"
#include "pm_show_core.h"
#include "pm_time.h"

void setUp() {}
void tearDown() {}

// --- sun ------------------------------------------------------------------------
// Reference: the `astral` Python library (an independent NOAA-based
// implementation), minutes after 00:00 UTC. Compared modulo a day, since
// a west-coast sunset falls on the next UTC date.
struct SunCase { const char *where; double lat, lon; int32_t day; double dawn, rise, set, dusk; };
static const SunCase SUN[] = {
  {"NYC 2026-10-31", 40.7128, -74.006, 20757, 656.6, 685.5, 1313.2, 1342.1},
  {"Seattle 2026-10-31", 47.6062, -122.3321, 20757, 859.6, 892.4, 54.3, 87.0},
  {"Miami 2026-12-21", 25.7617, -80.1918, 20808, 697.5, 723.3, 1354.7, 1380.4},
  {"London 2026-06-21", 51.5074, -0.1278, 20625, 174.8, 223.5, 1221.2, 1269.9},
  {"Sydney 2026-10-31", -33.8688, 151.2093, 20757, 1108.4, 1135.3, 501.7, 528.6},
};

static double wrapdiff(double a, double b) {
  double d = fmod(a - b, 1440.0);
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  return fabs(d);
}

static void test_sun_matches_reference() {
  for (const SunCase &c : SUN) {
    double ref[] = {c.dawn, c.rise, c.set, c.dusk};
    for (int e = 0; e < PM_SUN_EVENTS; e++) {
      double got = pm_sun_utc_min(c.day, c.lat, c.lon, (PmSunEvent)e);
      char msg[64];
      snprintf(msg, sizeof msg, "%s event %d: got %.1f want %.1f", c.where, e, got, ref[e]);
      TEST_ASSERT_TRUE_MESSAGE(wrapdiff(got, ref[e]) < 2.0, msg);
    }
  }
}

static void test_polar_night_has_no_sunset() {
  // Tromsø (69.6 N) at the winter solstice: the sun never rises.
  TEST_ASSERT_TRUE(isnan(pm_sun_utc_min(20808, 69.65, 18.96, PM_SUN_SET)));
}

// --- calendar --------------------------------------------------------------------
static void test_calendar() {
  TEST_ASSERT_EQUAL(1031, pm_month_day(20757));
  TEST_ASSERT_EQUAL(6, pm_weekday(20757));   // 2026-10-31 is a Saturday
  TEST_ASSERT_EQUAL(2, pm_weekday(20753));   // 2026-10-27 Tuesday
  TEST_ASSERT_EQUAL(101, pm_month_day(0));   // 1970-01-01
  TEST_ASSERT_EQUAL(4, pm_weekday(0));       // Thursday
  TEST_ASSERT_EQUAL(229, pm_month_day(19782)); // 2024-02-29, a leap day
}

// --- evaluation ------------------------------------------------------------------
static const int16_t EDT = -240;
static int64_t at(int32_t day, int h, int m, int16_t tz = EDT) { return (int64_t)day * 86400 + (h * 60 + m) * 60 - tz * 60; }
static int hhmm(int64_t utc_s, int16_t tz = EDT) {
  int64_t l = utc_s + tz * 60, s = ((l % 86400) + 86400) % 86400;
  return (int)(s / 3600) * 100 + (int)(s % 3600 / 60);
}

// The shipped default (software-plan §4.1), New York.
static PmSchedule defaults() {
  PmSchedule s;
  JsonDocument d;
  deserializeJson(d, R"({"lat":40.7128,"lon":-74.006,"windows":[
    {"start":"sunset-60","end":"21:30","mode":"armed"},
    {"start":"21:30","end":"22:30","mode":"ambient"},
    {"days":["fri","sat"],"start":"sunset-60","end":"22:30","mode":"armed"},
    {"dates":["10-31","10-31"],"start":"sunset-60","end":"23:00","mode":"armed"}]})");
  TEST_ASSERT_NULL(pm_schedule_from_json(d.as<JsonVariantConst>(), s));
  return s;
}

static void test_weeknight() {
  PmSchedule s = defaults();
  PmScheduler k;
  int32_t tue = 20753;  // 2026-10-27, sunset ~17:59 EDT
  PmSchedEval ev = k.eval(s, at(tue, 16, 0), EDT);
  TEST_ASSERT_EQUAL(PM_MODE_OFF, ev.mode);
  TEST_ASSERT_EQUAL(PM_MODE_ARMED, ev.next_mode);
  int arm = hhmm(ev.next_s);
  TEST_ASSERT_TRUE_MESSAGE(arm >= 1655 && arm <= 1705, "armed an hour before sunset");
  TEST_ASSERT_EQUAL(hhmm(ev.sun_s[PM_SUN_SET]) - 100, arm);

  ev = k.eval(s, at(tue, 20, 0), EDT);
  TEST_ASSERT_EQUAL(PM_MODE_ARMED, ev.mode);
  TEST_ASSERT_EQUAL(PM_MODE_AMBIENT, ev.next_mode);
  TEST_ASSERT_EQUAL(2130, hhmm(ev.next_s));

  ev = k.eval(s, at(tue, 22, 0), EDT);
  TEST_ASSERT_EQUAL(PM_MODE_AMBIENT, ev.mode);
  TEST_ASSERT_EQUAL(PM_MODE_OFF, ev.next_mode);
  TEST_ASSERT_EQUAL(2230, hhmm(ev.next_s));

  ev = k.eval(s, at(tue, 23, 0), EDT);
  TEST_ASSERT_EQUAL(PM_MODE_OFF, ev.mode);
  TEST_ASSERT_EQUAL(PM_MODE_ARMED, ev.next_mode);  // tomorrow, sunset − 60
  TEST_ASSERT_TRUE(ev.next_s > at(tue + 1, 16, 0) && ev.next_s < at(tue + 1, 18, 0));
}

static void test_later_windows_win() {
  PmSchedule s = defaults();
  PmScheduler k;
  // Friday 22:00: the Fri/Sat window (listed later) overrides the daily ambient.
  PmSchedEval ev = k.eval(s, at(20756, 22, 0), EDT);
  TEST_ASSERT_EQUAL(PM_MODE_ARMED, ev.mode);
  TEST_ASSERT_EQUAL(2, ev.window);
  TEST_ASSERT_EQUAL(2230, hhmm(ev.next_s));
  // Halloween 22:45: only the Oct 31 window still says armed.
  ev = k.eval(s, at(20757, 22, 45), EDT);
  TEST_ASSERT_EQUAL(PM_MODE_ARMED, ev.mode);
  TEST_ASSERT_EQUAL(3, ev.window);
  TEST_ASSERT_EQUAL(2300, hhmm(ev.next_s));
}

static void test_window_past_midnight() {
  PmSchedule s;
  s.lat = 40.7; s.lon = -74.0; s.enabled = true; s.count = 1;
  pm_time_from_str("22:00", s.w[0].start);
  pm_time_from_str("02:00", s.w[0].end);
  PmScheduler k;
  PmSchedEval ev = k.eval(s, at(20754, 1, 0), EDT);  // Wed 01:00: Tuesday's window still on
  TEST_ASSERT_EQUAL(PM_MODE_ARMED, ev.mode);
  TEST_ASSERT_EQUAL(200, hhmm(ev.next_s));
  ev = k.eval(s, at(20754, 2, 0), EDT);
  TEST_ASSERT_EQUAL(PM_MODE_OFF, ev.mode);
  TEST_ASSERT_EQUAL(2200, hhmm(ev.next_s));
}

static void test_days_filter() {
  PmSchedule s = defaults();
  s.count = 3;  // drop Halloween
  s.w[0].days = 1 << 5 | 1 << 6;  // daily window now Fri/Sat only
  s.w[1].days = 1 << 5 | 1 << 6;
  PmScheduler k;
  TEST_ASSERT_EQUAL(PM_MODE_OFF, k.eval(s, at(20753, 20, 0), EDT).mode);  // Tuesday
  TEST_ASSERT_EQUAL(PM_MODE_ARMED, k.eval(s, at(20756, 20, 0), EDT).mode);  // Friday
}

// --- manual hold -------------------------------------------------------------------
static void test_stop_holds_until_next_change() {
  PmSchedule s = defaults();
  PmScheduler k;
  PmModeKeeper keep;
  int32_t tue = 20753;
  int64_t t = at(tue, 20, 0);
  TEST_ASSERT_EQUAL(PM_MODE_ARMED, keep.update(true, k.eval(s, t, EDT), t, 60));
  keep.manual(PM_MODE_OFF);  // STOP ALL at 20:00
  TEST_ASSERT_EQUAL(PM_MODE_OFF, keep.update(true, k.eval(s, t, EDT), t, 60));
  t = at(tue, 21, 29);
  TEST_ASSERT_EQUAL(PM_MODE_OFF, keep.update(true, k.eval(s, t, EDT), t, 60));  // 89 min: not capped (less active)
  t = at(tue, 21, 30);
  TEST_ASSERT_EQUAL(PM_MODE_AMBIENT, keep.update(true, k.eval(s, t, EDT), t, 60));
  TEST_ASSERT_FALSE(keep.holding());
}

static void test_rearm_in_quiet_hours_is_capped() {
  PmSchedule s = defaults();
  PmScheduler k;
  PmModeKeeper keep;
  int64_t t = at(20753, 23, 0);  // off until tomorrow evening
  keep.manual(PM_MODE_ARMED);
  TEST_ASSERT_EQUAL(PM_MODE_ARMED, keep.update(true, k.eval(s, t, EDT), t, 60));
  t = at(20753, 23, 59);
  TEST_ASSERT_EQUAL(PM_MODE_ARMED, keep.update(true, k.eval(s, t, EDT), t, 60));
  t = at(20754, 0, 0);
  TEST_ASSERT_EQUAL(PM_MODE_OFF, keep.update(true, k.eval(s, t, EDT), t, 60));
}

static void test_no_clock_keeps_boot_or_manual() {
  PmModeKeeper keep;
  PmSchedEval none;
  TEST_ASSERT_EQUAL(PM_MODE_ARMED, keep.update(false, none, 0, 60));  // boots armed, as before schedules
  keep.manual(PM_MODE_AMBIENT);
  TEST_ASSERT_EQUAL(PM_MODE_AMBIENT, keep.update(false, none, 0, 60));
}

// A STOP ALL saved to flash and restored after a restart keeps its end;
// one whose end has passed gives way to the schedule.
static void test_restored_hold() {
  PmSchedule s = defaults();
  PmScheduler k;
  int32_t tue = 20753;
  PmModeKeeper keep;
  keep.restore(PM_MODE_OFF, at(tue, 21, 30));  // stopped at 20:00, held to 21:30
  int64_t t = at(tue, 20, 45);                  // board restarted at 20:45
  TEST_ASSERT_EQUAL(PM_MODE_OFF, keep.update(true, k.eval(s, t, EDT), t, 60));
  t = at(tue, 21, 30);
  TEST_ASSERT_EQUAL(PM_MODE_AMBIENT, keep.update(true, k.eval(s, t, EDT), t, 60));
  PmModeKeeper none;  // no schedule, no clock: a restored stop holds
  none.restore(PM_MODE_OFF, 0);
  PmSchedEval e;
  TEST_ASSERT_EQUAL(PM_MODE_OFF, none.update(false, e, 0, 60));
}

// --- wall clock ----------------------------------------------------------------------
static void test_wall_clock_and_dst() {
  PmWallClock w;
  TEST_ASSERT_FALSE(w.ok());
  w.set_utc(1793000000000LL, 5000);  // UTC ms, local timer ms
  TEST_ASSERT_EQUAL_INT64(1793000001000LL, w.utc_ms(6000));
  TEST_ASSERT_FALSE(w.ok());  // no time zone yet
  w.set_tz(-240, 1793512800, -300);  // EDT until 2026-11-01 06:00 UTC, then EST
  TEST_ASSERT_TRUE(w.ok());
  TEST_ASSERT_EQUAL(-240, w.tz_at(1793512799));
  TEST_ASSERT_EQUAL(-300, w.tz_at(1793512800));
}

// --- JSON -----------------------------------------------------------------------------
static void test_json_round_trip() {
  PmSchedule a = defaults(), b;
  JsonDocument d;
  pm_schedule_to_json(a, d.to<JsonObject>());
  TEST_ASSERT_EQUAL_STRING("sunset-60", d["windows"][0]["start"]);
  TEST_ASSERT_EQUAL_STRING("21:30", d["windows"][0]["end"]);
  TEST_ASSERT_TRUE(d["windows"][0]["days"].isNull());
  TEST_ASSERT_EQUAL_STRING("fri", d["windows"][2]["days"][0]);
  TEST_ASSERT_EQUAL_STRING("10-31", d["windows"][3]["dates"][0]);
  TEST_ASSERT_NULL(pm_schedule_from_json(d.as<JsonVariantConst>(), b));
  TEST_ASSERT_EQUAL(a.count, b.count);
  for (uint8_t i = 0; i < a.count; i++) {
    TEST_ASSERT_EQUAL(a.w[i].days, b.w[i].days);
    TEST_ASSERT_EQUAL(a.w[i].start.ref, b.w[i].start.ref);
    TEST_ASSERT_EQUAL(a.w[i].start.min, b.w[i].start.min);
    TEST_ASSERT_EQUAL(a.w[i].from_md, b.w[i].from_md);
  }
}

static void test_json_rejects() {
  PmSchedule s;
  JsonDocument d;
  const char *bad[] = {
    R"({"lat":95,"lon":0,"windows":[]})",
    R"({"lat":40,"lon":-74,"windows":[{"start":"25:00","end":"22:00","mode":"armed"}]})",
    R"({"lat":40,"lon":-74,"windows":[{"start":"sundown","end":"22:00","mode":"armed"}]})",
    R"({"lat":40,"lon":-74,"windows":[{"start":"sunset-60","end":"22:00","mode":"scary"}]})",
    R"({"lat":40,"lon":-74,"windows":[{"days":["fry"],"start":"sunset","end":"22:00","mode":"armed"}]})",
    R"({"lat":40,"lon":-74,"windows":[{"dates":["10-31"],"start":"sunset","end":"22:00","mode":"armed"}]})",
  };
  for (const char *j : bad) {
    deserializeJson(d, j);
    TEST_ASSERT_NOT_NULL_MESSAGE(pm_schedule_from_json(d.as<JsonVariantConst>(), s), j);
  }
  PmTimeSpec t;
  TEST_ASSERT_TRUE(pm_time_from_str("dusk+15", t));
  TEST_ASSERT_EQUAL(PM_REF_DUSK, t.ref);
  TEST_ASSERT_EQUAL(15, t.min);
}

// --- ambient loops --------------------------------------------------------------------
static void test_loop_index_is_shared() {
  // Two nodes asking at the same mesh time agree; repeats sit on multiples.
  TEST_ASSERT_EQUAL_INT64(0, pm_loop_index(0, 600000));
  TEST_ASSERT_EQUAL_INT64(0, pm_loop_index(599999, 600000));
  TEST_ASSERT_EQUAL_INT64(1, pm_loop_index(600000, 600000));
  TEST_ASSERT_EQUAL_INT64(-1, pm_loop_index(-1, 600000));
  PmSequence s;
  s.id = 1; s.step_count = 1; s.steps[0] = {20000, PM_CHANNEL_KIND_RELAY, 1, 0};
  TEST_ASSERT_EQUAL(20000, s.period_ms());
  s.loop_ms = 600000;
  TEST_ASSERT_EQUAL(600000, s.period_ms());
  s.loop_ms = 10000;  // shorter than its own steps
  PmNodeConfig c;
  c.channels[0].kind = PM_CHANNEL_KIND_RELAY; c.channels[0].index = 1; c.channels[0].pins[0] = 21; c.channels[0].pin_count = 1;
  c.channel_count = 1;
  TEST_ASSERT_EQUAL_STRING("loop is shorter than the sequence", pm_check_sequence(s, c));
}

// Check-ins land on a shared UTC grid (§6m): two boards that fell asleep
// at different moments, with the same period, wake for the same slot.
static void test_checkin_grid_aligns_boards() {
  PmCheckinPlan a = pm_checkin_plan(1000000000ULL + 17, 300, 20, pm_checkin_guard(300, false));
  PmCheckinPlan b = pm_checkin_plan(1000000000ULL + 140, 300, 20, pm_checkin_guard(300, false));
  TEST_ASSERT_EQUAL_UINT64(a.slot_s, b.slot_s);
  TEST_ASSERT_EQUAL_UINT64(0, a.slot_s % 300);
  TEST_ASSERT_EQUAL_UINT32(4, a.guard_s);  // 1 % of 300 s, + 1 s
  TEST_ASSERT_EQUAL_UINT64(a.slot_s, 1000000000ULL + 17 + a.sleep_s + a.guard_s);
}

// A slot too close to bother sleeping for is skipped for the next one.
static void test_checkin_skips_a_slot_too_close() {
  uint64_t slot = (1000000200ULL / 300) * 300 + 300;  // a slot on the grid
  PmCheckinPlan p = pm_checkin_plan(slot - 10, 300, 20, pm_checkin_guard(300, false));
  TEST_ASSERT_EQUAL_UINT64(slot + 300, p.slot_s);
  TEST_ASSERT_TRUE(p.sleep_s >= 20);
}

// A 10-minute board meets the 5-minute ones on every other slot.
static void test_checkin_longer_period_meets_shorter() {
  PmCheckinPlan five = pm_checkin_plan(1800000000ULL + 5, 300, 20, 4);
  PmCheckinPlan ten = pm_checkin_plan(1800000000ULL + 5, 600, 20, 7);
  TEST_ASSERT_EQUAL_UINT64(0, ten.slot_s % 300);
  TEST_ASSERT_TRUE(ten.slot_s == five.slot_s || ten.slot_s == five.slot_s + 300);
}

// Drift: a board whose clock read 3 s ahead after 300 s asleep runs 1 %
// fast, asks for a 1 % longer sleep next time, and earns a tighter guard.
static void test_drift_measured_and_corrected() {
  int32_t ppm = 0;
  TEST_ASSERT_TRUE(pm_drift_ppm(3000, 300000, &ppm));
  TEST_ASSERT_EQUAL_INT32(10000, ppm);
  TEST_ASSERT_EQUAL_UINT64(303000, pm_drift_correct_ms(300000, ppm));
  TEST_ASSERT_EQUAL_UINT64(297000, pm_drift_correct_ms(300000, -ppm));
  TEST_ASSERT_EQUAL_UINT32(4, pm_checkin_guard(300, false));
  TEST_ASSERT_EQUAL_UINT32(1, pm_checkin_guard(300, true));
  TEST_ASSERT_EQUAL_UINT32(3, pm_checkin_guard(900, true));
}

// Not drift: too short a sleep to judge, or a jump no oscillator makes.
static void test_drift_rejects_nonsense() {
  int32_t ppm = 123;
  TEST_ASSERT_FALSE(pm_drift_ppm(500, 30000, &ppm));     // 30 s asleep
  TEST_ASSERT_FALSE(pm_drift_ppm(3600000, 300000, &ppm)); // an hour's jump
  TEST_ASSERT_EQUAL_INT32(123, ppm);
  TEST_ASSERT_EQUAL_INT32(10000, pm_drift_blend(0, false, 10000));
  TEST_ASSERT_EQUAL_INT32(7500, pm_drift_blend(10000, true, 0));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_checkin_grid_aligns_boards);
  RUN_TEST(test_checkin_skips_a_slot_too_close);
  RUN_TEST(test_checkin_longer_period_meets_shorter);
  RUN_TEST(test_drift_measured_and_corrected);
  RUN_TEST(test_drift_rejects_nonsense);
  RUN_TEST(test_sun_matches_reference);
  RUN_TEST(test_polar_night_has_no_sunset);
  RUN_TEST(test_calendar);
  RUN_TEST(test_weeknight);
  RUN_TEST(test_later_windows_win);
  RUN_TEST(test_window_past_midnight);
  RUN_TEST(test_days_filter);
  RUN_TEST(test_stop_holds_until_next_change);
  RUN_TEST(test_rearm_in_quiet_hours_is_capped);
  RUN_TEST(test_no_clock_keeps_boot_or_manual);
  RUN_TEST(test_restored_hold);
  RUN_TEST(test_wall_clock_and_dst);
  RUN_TEST(test_json_round_trip);
  RUN_TEST(test_json_rejects);
  RUN_TEST(test_loop_index_is_shared);
  return UNITY_END();
}
