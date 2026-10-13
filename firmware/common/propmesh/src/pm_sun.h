// Sunrise, sunset, civil dawn and dusk for a date and place — NOAA's
// solar calculator equations (the ones behind gml.noaa.gov/grad/solcalc),
// good to about a minute at yard latitudes. The show schedule's
// "sunset − 60" comes from here (docs/software-plan.md §4.1).
// Header-only, no Arduino: tested host-native.
#pragma once
#include <math.h>
#include <stdint.h>

// Zenith angles: the sun's centre this far from straight up.
#define PM_SUN_ZENITH_HORIZON 90.833  // rise/set: refraction + the sun's radius
#define PM_SUN_ZENITH_CIVIL 96.0      // civil dawn/dusk: 6° below the horizon

namespace pm_sun_detail {
inline double rad(double d) { return d * M_PI / 180.0; }
inline double deg(double r) { return r * 180.0 / M_PI; }

// t: Julian centuries since J2000.0.
inline double mean_long(double t) {
  double l = fmod(280.46646 + t * (36000.76983 + t * 0.0003032), 360.0);
  return l < 0 ? l + 360.0 : l;
}
inline double mean_anomaly(double t) { return 357.52911 + t * (35999.05029 - 0.0001537 * t); }
inline double eccentricity(double t) { return 0.016708634 - t * (0.000042037 + 0.0000001267 * t); }
inline double eq_of_centre(double t) {
  double m = rad(mean_anomaly(t));
  return sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + sin(2 * m) * (0.019993 - 0.000101 * t) +
         sin(3 * m) * 0.000289;
}
inline double apparent_long(double t) {
  return mean_long(t) + eq_of_centre(t) - 0.00569 - 0.00478 * sin(rad(125.04 - 1934.136 * t));
}
inline double obliquity(double t) {
  double e0 = 23.0 + (26.0 + (21.448 - t * (46.8150 + t * (0.00059 - t * 0.001813))) / 60.0) / 60.0;
  return e0 + 0.00256 * cos(rad(125.04 - 1934.136 * t));
}
inline double declination(double t) { return deg(asin(sin(rad(obliquity(t))) * sin(rad(apparent_long(t))))); }
// Minutes the sundial runs ahead of the clock.
inline double equation_of_time(double t) {
  double y = tan(rad(obliquity(t)) / 2.0);
  y *= y;
  double l0 = rad(mean_long(t)), e = eccentricity(t), m = rad(mean_anomaly(t));
  double et = y * sin(2 * l0) - 2 * e * sin(m) + 4 * e * y * sin(m) * cos(2 * l0) -
              0.5 * y * y * sin(4 * l0) - 1.25 * e * e * sin(2 * m);
  return deg(et) * 4.0;
}

// Minutes after 00:00 UTC of the day starting at Julian day `jd`, or NAN
// when the sun never crosses that zenith (polar day/night).
inline double event_utc(bool rise, double jd, double lat, double lon, double zenith) {
  double t = (jd - 2451545.0) / 36525.0;
  double latr = rad(lat), dec = rad(declination(t));
  double arg = cos(rad(zenith)) / (cos(latr) * cos(dec)) - tan(latr) * tan(dec);
  if (arg < -1.0 || arg > 1.0) return NAN;
  double ha = deg(acos(arg));
  return 720.0 - 4.0 * (lon + (rise ? ha : -ha)) - equation_of_time(t);
}
}  // namespace pm_sun_detail

enum PmSunEvent : uint8_t { PM_SUN_DAWN, PM_SUN_RISE, PM_SUN_SET, PM_SUN_DUSK, PM_SUN_EVENTS };

// Minutes after 00:00 UTC on calendar day `day` (days since 1970-01-01),
// or NAN. Latitude north-positive, longitude east-positive (so the US is
// negative). Two passes: the second evaluates the sun at the event itself.
inline double pm_sun_utc_min(int32_t day, double lat, double lon, PmSunEvent ev) {
  using namespace pm_sun_detail;
  bool rise = ev == PM_SUN_DAWN || ev == PM_SUN_RISE;
  double zen = (ev == PM_SUN_DAWN || ev == PM_SUN_DUSK) ? PM_SUN_ZENITH_CIVIL : PM_SUN_ZENITH_HORIZON;
  double jd = (double)day + 2440587.5;  // 1970-01-01 00:00 UTC is JD 2440587.5
  double m = event_utc(rise, jd, lat, lon, zen);
  if (isnan(m)) return m;
  return event_utc(rise, jd + m / 1440.0, lat, lon, zen);
}
