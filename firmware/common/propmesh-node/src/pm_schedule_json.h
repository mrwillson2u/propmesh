// The show schedule <-> JSON: /schedule.json in flash and the console's
// set_schedule / get_schedule (docs/generic-boards.md §6e).
//
//   {"enabled": true, "lat": 40.71, "lon": -74.01, "manual_max_min": 60,
//    "windows": [{"days": ["fri","sat"], "dates": ["10-31","10-31"],
//                 "start": "sunset-60", "end": "22:30", "mode": "armed"}]}
//
// A time is "HH:MM" or a sun event with an optional offset in minutes:
// "sunset", "sunset-60", "dusk+15" (dawn, sunrise, sunset, dusk). "days"
// and "dates" are optional (absent = every day / any date).
// Header-only: tested host-native.
#pragma once
#include <ArduinoJson.h>
#include <stdio.h>
#include <stdlib.h>
#include "pm_schedule.h"

static const char *const PM_REF_NAMES[] = {"", "dawn", "sunrise", "sunset", "dusk"};
static const char *const PM_DAY_NAMES[] = {"sun", "mon", "tue", "wed", "thu", "fri", "sat"};

inline bool pm_time_from_str(const char *s, PmTimeSpec &out) {
  if (!s || !*s) return false;
  int h, m;
  char extra;
  if (strchr(s, ':')) {
    if (sscanf(s, "%d:%d%c", &h, &m, &extra) != 2 || h < 0 || h > 24 || m < 0 || m > 59 || h * 60 + m > 1440) return false;
    out.ref = PM_REF_CLOCK;
    out.min = (int16_t)(h * 60 + m);
    return true;
  }
  for (uint8_t r = PM_REF_DAWN; r <= PM_REF_DUSK; r++) {
    size_t n = strlen(PM_REF_NAMES[r]);
    if (strncmp(s, PM_REF_NAMES[r], n)) continue;
    const char *rest = s + n;
    long off = 0;
    if (*rest) {
      if (*rest != '+' && *rest != '-') return false;
      char *end;
      off = strtol(rest, &end, 10);
      if (*end || off < -720 || off > 720) return false;
    }
    out.ref = r;
    out.min = (int16_t)off;
    return true;
  }
  return false;
}

inline void pm_time_to_str(const PmTimeSpec &t, char out[16]) {
  if (t.ref == PM_REF_CLOCK) snprintf(out, 16, "%02d:%02d", t.min / 60, t.min % 60);
  else if (!t.min) snprintf(out, 16, "%s", PM_REF_NAMES[t.ref]);
  else snprintf(out, 16, "%s%+d", PM_REF_NAMES[t.ref], t.min);
}

inline uint8_t pm_mode_from_str(const char *s) {
  if (!strcmp(s, "armed")) return PM_MODE_ARMED;
  if (!strcmp(s, "ambient")) return PM_MODE_AMBIENT;
  if (!strcmp(s, "off")) return PM_MODE_OFF;
  return 0xFF;
}

inline bool pm_md_from_str(const char *s, uint16_t &out) {
  int m, d;
  char extra;
  if (sscanf(s, "%d-%d%c", &m, &d, &extra) != 2 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  out = (uint16_t)(m * 100 + d);
  return true;
}

inline const char *pm_schedule_from_json(JsonVariantConst j, PmSchedule &out) {
  out = PmSchedule();
  if (!j.is<JsonObjectConst>()) return "schedule is not an object";
  out.enabled = j["enabled"] | true;
  float lat = j["lat"] | 1000.0f, lon = j["lon"] | 1000.0f;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return "lat must be -90..90 and lon -180..180";
  out.lat = lat;
  out.lon = lon;
  long cap = j["manual_max_min"] | 60L;
  if (cap < 1 || cap > 1440) return "manual_max_min must be 1-1440";
  out.manual_max_min = (uint16_t)cap;
  JsonArrayConst ws = j["windows"];
  if (ws.size() > PM_MAX_WINDOWS) return "at most 12 windows";
  for (JsonObjectConst w : ws) {
    PmWindow &x = out.w[out.count++];
    x = PmWindow();
    if (!pm_time_from_str(w["start"] | "", x.start)) return "window start must be HH:MM or e.g. sunset-60";
    if (!pm_time_from_str(w["end"] | "", x.end)) return "window end must be HH:MM or e.g. sunset-60";
    x.mode = pm_mode_from_str(w["mode"] | "");
    if (x.mode == 0xFF) return "window mode must be off, ambient or armed";
    if (!w["days"].isNull()) {
      x.days = 0;
      for (JsonVariantConst d : w["days"].as<JsonArrayConst>()) {
        int k = -1;
        for (int i = 0; i < 7; i++) if (!strcmp(d | "", PM_DAY_NAMES[i])) k = i;
        if (k < 0) return "days are sun, mon, tue, wed, thu, fri, sat";
        x.days |= 1 << k;
      }
      if (!x.days) return "a window needs at least one day";
    }
    if (!w["dates"].isNull()) {
      JsonArrayConst d = w["dates"];
      if (d.size() != 2 || !pm_md_from_str(d[0] | "", x.from_md) || !pm_md_from_str(d[1] | "", x.to_md))
        return "dates are [\"MM-DD\", \"MM-DD\"]";
    }
  }
  return nullptr;
}

inline void pm_schedule_to_json(const PmSchedule &s, JsonObject j) {
  j["enabled"] = s.enabled;
  j["lat"] = s.lat;
  j["lon"] = s.lon;
  j["manual_max_min"] = s.manual_max_min;
  JsonArray ws = j["windows"].to<JsonArray>();
  for (uint8_t i = 0; i < s.count; i++) {
    const PmWindow &w = s.w[i];
    JsonObject o = ws.add<JsonObject>();
    char a[16], b[16];
    pm_time_to_str(w.start, a);
    pm_time_to_str(w.end, b);
    o["start"] = a;
    o["end"] = b;
    o["mode"] = pm_mode_name(w.mode);
    if (w.days != PM_DAYS_ALL) {
      JsonArray d = o["days"].to<JsonArray>();
      for (int k = 0; k < 7; k++) if (w.days & (1 << k)) d.add(PM_DAY_NAMES[k]);
    }
    if (w.from_md || w.to_md) {
      char f[6], t[6];
      snprintf(f, 6, "%02u-%02u", w.from_md / 100, w.from_md % 100);
      snprintf(t, 6, "%02u-%02u", w.to_md / 100, w.to_md % 100);
      JsonArray d = o["dates"].to<JsonArray>();
      d.add(f);
      d.add(t);
    }
  }
}
