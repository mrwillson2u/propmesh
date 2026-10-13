// The show schedule: which mode the show is in at a given moment, when
// that next changes, and how a manual override (STOP ALL, RE-ARM) yields
// back to it. docs/software-plan.md §4.1, docs/generic-boards.md §6e.
//
// Every node holds the same schedule and the same wall clock, so every
// node reaches the same answer on its own — no messages at the edges,
// and the show still switches off at 22:30 with no laptop and no WiFi.
// Header-only, no Arduino: tested host-native.
#pragma once
#include <stdint.h>
#include <string.h>
#include "pm_sun.h"

// Modes, least to most active: the order matters (manual hold rule).
enum PmMode : uint8_t { PM_MODE_OFF = 0, PM_MODE_AMBIENT = 1, PM_MODE_ARMED = 2 };
inline const char *pm_mode_name(uint8_t m) {
  return m == PM_MODE_ARMED ? "armed" : m == PM_MODE_AMBIENT ? "ambient" : "off";
}

// A window edge: a clock time, or a sun event plus an offset.
enum PmTimeRef : uint8_t { PM_REF_CLOCK, PM_REF_DAWN, PM_REF_SUNRISE, PM_REF_SUNSET, PM_REF_DUSK };
struct PmTimeSpec {
  uint8_t ref = PM_REF_CLOCK;
  int16_t min = 0;  // CLOCK: minutes after local midnight; sun: offset (−60 = an hour before)
};

#define PM_MAX_WINDOWS 12
#define PM_DAYS_ALL 0x7F  // bit 0 = Sunday … bit 6 = Saturday

struct PmWindow {
  uint8_t days = PM_DAYS_ALL;
  uint16_t from_md = 0, to_md = 0;  // month*100 + day, inclusive; 0/0 = any date. 1225..0105 wraps.
  PmTimeSpec start, end;            // end at or before start = ends the next day
  uint8_t mode = PM_MODE_ARMED;
};

struct PmSchedule {
  bool enabled = false;
  float lat = 0, lon = 0;
  uint16_t manual_max_min = 60;  // a manual mode MORE active than the schedule's lasts at most this
  uint8_t count = 0;
  PmWindow w[PM_MAX_WINDOWS];
  bool active() const { return enabled && count; }
};

// --- calendar ---------------------------------------------------------------
inline int32_t pm_floor_div(int64_t a, int64_t b) { return (int32_t)(a >= 0 ? a / b : -((-a + b - 1) / b)); }

// month*100 + day for days since 1970-01-01 (Howard Hinnant's civil_from_days).
inline uint16_t pm_month_day(int32_t day) {
  int32_t z = day + 719468, era = (z >= 0 ? z : z - 146096) / 146097;
  uint32_t doe = (uint32_t)(z - era * 146097);
  uint32_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  uint32_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  uint32_t mp = (5 * doy + 2) / 153;
  uint32_t d = doy - (153 * mp + 2) / 5 + 1, m = mp < 10 ? mp + 3 : mp - 9;
  return (uint16_t)(m * 100 + d);
}
inline uint8_t pm_weekday(int32_t day) { return (uint8_t)(((day % 7) + 11) % 7); }  // 1970-01-01 was a Thursday (4)

// --- evaluation ------------------------------------------------------------------
struct PmSchedEval {
  uint8_t mode = PM_MODE_OFF;  // what the schedule says now
  int8_t window = -1;          // the window that decided it; -1 = none matched (off)
  int64_t next_s = 0;          // UTC seconds of the next change of mode; 0 = none within two days
  uint8_t next_mode = PM_MODE_OFF;
  int64_t sun_s[PM_SUN_EVENTS] = {};  // today's dawn/rise/set/dusk, UTC seconds; 0 = none (polar)
};

class PmScheduler {
 public:
  // `utc_s`: now. `tz_min`: local offset from UTC (−240 = EDT).
  PmSchedEval eval(const PmSchedule &s, int64_t utc_s, int16_t tz_min) {
    PmSchedEval ev;
    m_s = &s;
    m_tz_s = (int64_t)tz_min * 60;
    int64_t local = utc_s + m_tz_s;
    m_day0 = pm_floor_div(local, 86400) - 1;  // sun table covers yesterday .. the day after tomorrow
    for (int d = 0; d < 4; d++)
      for (int e = 0; e < PM_SUN_EVENTS; e++) {
        double m = pm_sun_utc_min(m_day0 + d, s.lat, s.lon, (PmSunEvent)e);
        m_has[d][e] = !isnan(m);
        m_sun[d][e] = m_has[d][e] ? (int64_t)(m_day0 + d) * 86400 + (int64_t)lround(m * 60.0) + m_tz_s : 0;
      }
    for (int e = 0; e < PM_SUN_EVENTS; e++) ev.sun_s[e] = m_has[1][e] ? m_sun[1][e] - m_tz_s : 0;
    ev.window = match(local);
    ev.mode = ev.window < 0 ? PM_MODE_OFF : s.w[ev.window].mode;

    // Next change: walk every window edge after now, in time order, until
    // the mode there differs from now's.
    int64_t edges[PM_MAX_WINDOWS * 2 * 3];
    int n = 0;
    int64_t horizon = (int64_t)(m_day0 + 4) * 86400;
    for (uint8_t i = 0; i < s.count; i++)
      for (int d = 0; d < 4; d++) {  // d = 0: a window from yesterday still running past midnight
        int64_t a, b;
        if (!span(s.w[i], m_day0 + d, a, b)) continue;
        if (a > local && a < horizon) edges[n++] = a;
        if (b > local && b < horizon) edges[n++] = b;
      }
    for (int i = 1; i < n; i++)  // insertion sort: n is small
      for (int j = i; j && edges[j - 1] > edges[j]; j--) { int64_t x = edges[j]; edges[j] = edges[j - 1]; edges[j - 1] = x; }
    for (int i = 0; i < n; i++) {
      int k = match(edges[i]);
      uint8_t m = k < 0 ? PM_MODE_OFF : s.w[k].mode;
      if (m != ev.mode) { ev.next_s = edges[i] - m_tz_s; ev.next_mode = m; break; }
    }
    return ev;
  }

 private:
  // Local seconds of an edge on local day `day`; false if the sun event doesn't happen.
  bool edge(const PmTimeSpec &t, int32_t day, int64_t &out) const {
    if (t.ref == PM_REF_CLOCK) { out = (int64_t)day * 86400 + (int64_t)t.min * 60; return true; }
    int d = day - m_day0;
    if (d < 0 || d > 3) return false;
    static const PmSunEvent EV[] = {PM_SUN_DAWN, PM_SUN_DAWN, PM_SUN_RISE, PM_SUN_SET, PM_SUN_DUSK};
    PmSunEvent e = EV[t.ref];
    if (!m_has[d][e]) return false;
    out = m_sun[d][e] + (int64_t)t.min * 60;
    return true;
  }
  bool day_matches(const PmWindow &w, int32_t day) const {
    if (!(w.days & (1 << pm_weekday(day)))) return false;
    if (!w.from_md && !w.to_md) return true;
    uint16_t md = pm_month_day(day);
    return w.from_md <= w.to_md ? (md >= w.from_md && md <= w.to_md) : (md >= w.from_md || md <= w.to_md);
  }
  // [a, b) in local seconds for the window starting on `day`.
  bool span(const PmWindow &w, int32_t day, int64_t &a, int64_t &b) const {
    if (!day_matches(w, day) || !edge(w.start, day, a) || !edge(w.end, day, b)) return false;
    if (b <= a) {  // runs past midnight: the end is on the next day
      if (!edge(w.end, day + 1, b)) return false;
      if (b <= a) return false;
    }
    return true;
  }
  // Last window (in list order) whose span holds local time `t`; -1 = none.
  int match(int64_t t) const {
    int32_t day = pm_floor_div(t, 86400);
    int hit = -1;
    for (uint8_t i = 0; i < m_s->count; i++)
      for (int32_t d = day - 1; d <= day; d++) {
        int64_t a, b;
        if (span(m_s->w[i], d, a, b) && t >= a && t < b) hit = i;
      }
    return hit;
  }

  const PmSchedule *m_s = nullptr;
  int64_t m_tz_s = 0;
  int32_t m_day0 = 0;
  int64_t m_sun[4][PM_SUN_EVENTS] = {};
  bool m_has[4][PM_SUN_EVENTS] = {};
};

// --- manual override -----------------------------------------------------------------
// A manual mode holds until the schedule's next change, so STOP ALL at
// 20:00 stays stopped until 21:30 and re-arming at 22:40 isn't undone a
// minute later. A manual mode MORE active than the schedule's (armed
// during quiet hours) is capped at manual_max_min — otherwise "until the
// next change" would mean all night, and the morning off would never
// come. With no wall clock a manual mode holds until there is one.
class PmModeKeeper {
 public:
  explicit PmModeKeeper(uint8_t boot = PM_MODE_ARMED) : m_boot(boot) {}

  void manual(uint8_t mode) { m_manual = mode; m_has = true; m_until = 0; }
  // After a restart: the manual mode saved in flash, and when it ends (0 =
  // not worked out yet). A STOP ALL must survive a reboot (2026-10-10).
  void restore(uint8_t mode, int64_t until) { m_manual = mode; m_has = true; m_until = until; }
  uint8_t manual_mode() const { return m_manual; }
  // The conductor's hold ended (or was replaced by the schedule): follow it.
  void clear() { m_has = false; m_until = 0; }

  // `ev` is ignored unless `scheduled` (schedule active AND clock valid).
  uint8_t update(bool scheduled, const PmSchedEval &ev, int64_t utc_s, uint16_t max_min) {
    if (!scheduled) return m_has ? m_manual : m_boot;
    if (m_has && !m_until) {
      m_until = ev.next_s ? ev.next_s : utc_s + 86400;
      if (m_manual > ev.mode && utc_s + (int64_t)max_min * 60 < m_until) m_until = utc_s + (int64_t)max_min * 60;
    }
    if (m_has && utc_s < m_until) return m_manual;
    m_has = false;
    return ev.mode;
  }
  bool holding() const { return m_has; }
  int64_t until() const { return m_until; }  // UTC s; 0 = until there is a clock

 private:
  uint8_t m_boot, m_manual = PM_MODE_ARMED;
  bool m_has = false;
  int64_t m_until = 0;
};
