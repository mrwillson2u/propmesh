// A mains board build (the DevKit, -DPM_NO_SLEEP) keeps Bluetooth for the
// floods instead: the chip's IRAM holds WiFi + Bluetooth or WiFi + deep
// sleep, not all three (2026-10-11). "On battery" on such a board still
// makes it a leaf; it just never sleeps.
#ifdef PM_NO_SLEEP
#include <esp_wifi.h>
#include "pm_sleep.h"
#include "pm_pinrules.h"
void pm_sleep_begin() {}
void pm_sleep_after_boot(const PmNodeConfig &) {}
void pm_sleep_apply(const PmNodeConfig &) {}
void pm_sleep_loop() {}
void pm_sleep_radio_reapply() { esp_wifi_set_ps(WIFI_PS_NONE); }
void pm_sleep_hold(uint32_t) {}
bool pm_sleep_holding() { return true; }
bool pm_sleep_supported() { return false; }
uint16_t pm_sleep_listen_ms() { return 0; }
const char *pm_sleep_wake_cause() { return "power"; }
int pm_sleep_wake_gpio() { return -1; }
bool pm_sleep_drift_ppm(int32_t *) { return false; }
uint32_t pm_sleep_last_awake_ms() { return 0; }
bool pm_sleep_rtc_pin(uint8_t g) { const pm_board_pin_t *p = pm_board_pin(PM_BOARD_PROFILE, g); return p && (p->caps & PM_CAP_WAKE); }
#else
#include <Arduino.h>
#include <sys/time.h>
#include <esp_sleep.h>
#include <esp_wifi.h>
#include <esp_now.h>
#include "pm_sleep.h"
#include "pm_show.h"
#include "pm_ota.h"
#include "pm_time.h"
#include "pm_mesh.h"
#include "pm_schedule.h"
#include "pm_checkin.h"
#include "pm_channels.h"
#include "pm_ble_tx.h"

// Awake at least this long after a timer wake: send a heartbeat, hear the
// bridge's beacon (every ≤5 s) and any waiting request. At ~100 mA awake,
// the dwell is most of the off tier's budget: 15 s every minute averaged
// ~25 mA (2026-10-11); 6 s every 5 min is ~2 mA.
#define BOOT_DWELL_MS 6000
#define SENSOR_HOLD_MS 60000     // after a sensor wake: let the cue run, heartbeat, be seen
#define CONSOLE_HOLD_MS 600000   // after a console request: pages, updates
#define WINDOW_LEAD_S 5          // wake this long before the next schedule window
#define MIN_SLEEP_S 20           // not worth sleeping for less

// Survives deep sleep (not a power cycle): the time zone, so the schedule
// works the moment we wake, and a marker that the wall clock is valid.
RTC_DATA_ATTR static int16_t rtc_tz_min;
RTC_DATA_ATTR static uint32_t rtc_tz_next_s;
RTC_DATA_ATTR static int16_t rtc_tz_next_min;
RTC_DATA_ATTR static bool rtc_clock_ok;
// The check-in grid's guard for the sleep just ended (pm_checkin.h): a
// board woke this early, so it stays this long past the slot as well.
RTC_DATA_ATTR static uint32_t rtc_guard_s;
RTC_DATA_ATTR static uint32_t rtc_slot_s;        // the grid slot this wake is for (UTC s); 0 = not a grid wake
// Drift self-correction (§6m): the wall clock when we went to sleep, the
// sleep clock's measured error, and how long the previous wake lasted.
RTC_DATA_ATTR static int64_t rtc_sleep_utc_ms;   // 0 = no clock at sleep
RTC_DATA_ATTR static int32_t rtc_drift_ppm;
RTC_DATA_ATTR static bool rtc_drift_ok;
RTC_DATA_ATTR static uint32_t rtc_awake_ms;

static bool battery;
static uint32_t checkin_ms = 300000;
static uint16_t interval_ms = 1000, window_ms = 100;
static uint32_t hold_until_ms;   // explicit holds: a console request, a sync pull, a sensor wake
// A check-in's wake: at most this long (the old fixed dwell, the fallback
// when no bridge is heard); released early once its job is done (§6m).
static uint32_t wake_until_ms;
static bool check_in;            // this boot is a timer wake on the grid
static uint32_t first_bridge_ms; // millis() the bridge was first heard this boot
static int64_t wake_utc_ms;      // the wall clock as the RTC restored it at wake
static bool drift_done;          // measured (or given up) this boot
static const char *cause = "power";
static int wake_gpio = -1;
static bool show_tier;  // in the show tier (modem sleep, or awake on a repeater)
static bool relay;      // battery repeater (docs §6m): awake and relaying in the show tier

// Pins the board profile marks `wake` (ESP32: RTC GPIOs; C6: LP GPIO
// 0-7; C3: GPIO 0-5) — the only ones the chip can wake on. The ESP32 and
// C6 wake through ext1; the C3 has no ext1 and uses the GPIO wake path.
bool pm_sleep_rtc_pin(uint8_t g) {
  const pm_board_pin_t *p = pm_board_pin(PM_BOARD_PROFILE, g);
  return p && (p->caps & PM_CAP_WAKE);
}

void pm_sleep_begin() {
  switch (esp_sleep_get_wakeup_cause()) {
    case ESP_SLEEP_WAKEUP_TIMER: cause = "timer"; break;
#if SOC_PM_SUPPORT_EXT1_WAKEUP
    case ESP_SLEEP_WAKEUP_EXT1: {
      cause = "sensor";
      uint64_t m = esp_sleep_get_ext1_wakeup_status();
      for (int g = 0; g < 40; g++) if (m & (1ULL << g)) { wake_gpio = g; break; }
      break;
    }
#else
    case ESP_SLEEP_WAKEUP_GPIO: {
      cause = "sensor";
      uint64_t m = esp_sleep_get_gpio_wakeup_status();
      for (int g = 0; g < 40; g++) if (m & (1ULL << g)) { wake_gpio = g; break; }
      break;
    }
#endif
    default: cause = esp_reset_reason() == ESP_RST_POWERON ? "power" : "reset"; break;
  }
  if (cause[0] == 't' || cause[0] == 's') {
    // The system clock kept counting on the RTC through the sleep.
    struct timeval tv;
    gettimeofday(&tv, nullptr);
    if (rtc_clock_ok && tv.tv_sec > 1600000000) {
      PmWallClock &w = pm_wall();
      wake_utc_ms = (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
      w.set_utc(wake_utc_ms, millis());
      w.set_tz(rtc_tz_min, rtc_tz_next_s, rtc_tz_next_min);
    }
    if (cause[0] == 's') {
      hold_until_ms = millis() + SENSOR_HOLD_MS;
    } else {
      // A timer wake on the grid came `guard` early. At most it stays
      // through the slot and `guard` past it plus the dwell, so every
      // board's window overlaps at the slot whichever way its clock
      // drifted; pm_sleep_loop lets it go sooner once its job is done.
      check_in = rtc_slot_s != 0;
      hold_until_ms = millis();
      wake_until_ms = millis() + BOOT_DWELL_MS + 2000UL * rtc_guard_s;
    }
  } else {
    hold_until_ms = millis() + BOOT_DWELL_MS;
  }
}

void pm_sleep_after_boot(const PmNodeConfig &cfg) {
  if (wake_gpio < 0) return;
  for (uint8_t i = 0; i < cfg.channel_count; i++) {
    const PmChannelCfg &c = cfg.channels[i];
    if (c.kind == PM_CHANNEL_KIND_DIGITAL_IN && c.pins[0] == wake_gpio) {
      Serial.printf("sleep: woken by %s on GPIO %d — running its triggers\n", c.label, wake_gpio);
      pm_show_on_input(c.index, true);
      return;
    }
  }
}

void pm_sleep_apply(const PmNodeConfig &cfg) {
  battery = cfg.battery;
  bool was_relay = relay;
  relay = cfg.battery && cfg.sleep_relay;
  // The repeater setting changed mid-show: leave the tier so the next
  // pass re-enters it the right way (windows, or awake).
  if (show_tier && relay != was_relay) {
    esp_now_set_wake_window(65535);
    esp_wifi_set_ps(WIFI_PS_NONE);
    pm_mesh_set_stale_ms(PM_SYNC_STALE_MS);
    show_tier = false;
  }
  checkin_ms = cfg.sleep_checkin_ms;
  interval_ms = cfg.sleep_interval_ms;
  window_ms = cfg.sleep_window_ms;
  if (!battery && show_tier) { esp_wifi_set_ps(WIFI_PS_NONE); show_tier = false; }
}

void pm_sleep_hold(uint32_t ms) {
  if (!ms) { hold_until_ms = millis() + 3000; return; }  // release: sleep in a moment
  uint32_t until = millis() + ms;
  if ((int32_t)(until - hold_until_ms) > 0) hold_until_ms = until;
}
bool pm_sleep_supported() { return true; }
// 0 on a repeater: it is awake through the show, so others needn't send
// cues early or repeat them into a window.
uint16_t pm_sleep_listen_ms() { return show_tier && !relay ? interval_ms : 0; }
bool pm_sleep_holding() {
  uint32_t now = millis();
  return (int32_t)(now - hold_until_ms) < 0 || (int32_t)(now - wake_until_ms) < 0;
}
bool pm_sleep_drift_ppm(int32_t *ppm) { if (rtc_drift_ok) *ppm = rtc_drift_ppm; return rtc_drift_ok; }
uint32_t pm_sleep_last_awake_ms() { return rtc_awake_ms; }

// Drift self-correction (§6m): the first conductor beacon after a deep
// sleep says how far the RTC-carried wall clock wandered while asleep.
static void measure_drift() {
  if (drift_done || !wake_utc_ms || !rtc_sleep_utc_ms) return;
  int64_t step;
  if (!pm_wall_first_step(&step)) return;
  drift_done = true;
  int64_t slept = wake_utc_ms - rtc_sleep_utc_ms;
  int32_t ppm;
  if (!pm_drift_ppm(step, slept, &ppm)) {
    Serial.printf("sleep: clock off by %+lld ms after %lld s asleep — not used for drift\n", (long long)step, (long long)(slept / 1000));
    return;
  }
  rtc_drift_ppm = pm_drift_blend(rtc_drift_ppm, rtc_drift_ok, ppm);
  rtc_drift_ok = true;
  Serial.printf("sleep: clock off by %+lld ms after %lld s asleep (%+ld ppm); correcting by %+ld ppm\n",
                (long long)step, (long long)(slept / 1000), (long)ppm, (long)rtc_drift_ppm);
}

// A check-in can end once its job is done (§6m): our heartbeat is out (the
// first goes ~0.5 s after a timer wake), the bridge has been heard (so the
// mesh path is up and the beacon's edit stamps have arrived), and a
// moment has passed for a sync pull to start and hold us itself. A
// repeater also stays until the latest a board behind it can arrive —
// `guard` past the slot — plus one beacon period, so that board hears the
// bridge through it.
static void release_check_in() {
  if (!check_in || (int32_t)(millis() - wake_until_ms) >= 0) return;
  uint32_t heard = pm_mesh_bridge_heard_at_ms();
  if (heard && !first_bridge_ms) first_bridge_ms = millis();
  if (!first_bridge_ms || millis() < 1500 || millis() - first_bridge_ms < 1500) return;
  if (relay && (!pm_wall().utc_ok || pm_wall_utc_ms() / 1000 < (int64_t)rtc_slot_s + rtc_guard_s + 6)) return;
  wake_until_ms = millis();
}
const char *pm_sleep_wake_cause() { return cause; }
int pm_sleep_wake_gpio() { return wake_gpio; }

static void set_show_tier(bool on);
void pm_sleep_radio_reapply() {
  bool t = show_tier;
  show_tier = !t;       // so set_show_tier runs its branch again on a fresh driver
  set_show_tier(t);
}

// Show tier (stage 2): the radio listens window_ms of every interval_ms.
static void set_show_tier(bool on) {
  if (on == show_tier) return;
  show_tier = on;
  if (on && relay) {
    // A battery repeater relays for the boards behind it, and a relay
    // can't doze: frames sent while it slept would be lost (no store-and-
    // forward). So the show tier keeps the radio on, like a mains board.
    esp_now_set_wake_window(65535);
    esp_wifi_set_ps(WIFI_PS_NONE);
    Serial.println("sleep: show tier — repeater, awake and relaying until the show is off");
  } else if (on) {
    esp_wifi_connectionless_module_set_wake_interval(interval_ms);
    esp_now_set_wake_window(window_ms);
    esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
    pm_mesh_set_stale_ms(60000);  // hears one beacon in (interval / window)
    Serial.printf("sleep: show tier — listening %u ms of every %u ms\n", window_ms, interval_ms);
  } else {
    esp_now_set_wake_window(65535);  // the whole interval: back to listening always
    esp_wifi_set_ps(WIFI_PS_NONE);
    pm_mesh_set_stale_ms(PM_SYNC_STALE_MS);
    Serial.println("sleep: awake — radio always on");
  }
}

static void deep_sleep(uint64_t ms, const char *why) {
  const PmNodeConfig &cfg = pm_channels_config();
  // Every sensor/button pin wakes us. ext1 takes one polarity for the whole
  // set: active-high pins (most PIRs) on ANY_HIGH; if every input is
  // active-low, ALL_LOW instead.
  uint64_t hi = 0, lo = 0;
  for (uint8_t i = 0; i < cfg.channel_count; i++) {
    const PmChannelCfg &c = cfg.channels[i];
    if (c.kind != PM_CHANNEL_KIND_DIGITAL_IN || !pm_sleep_rtc_pin(c.pins[0])) continue;
    (c.active_low ? lo : hi) |= 1ULL << c.pins[0];
  }
#if SOC_PM_SUPPORT_EXT1_WAKEUP
  if (hi) esp_sleep_enable_ext1_wakeup(hi, ESP_EXT1_WAKEUP_ANY_HIGH);
#if CONFIG_IDF_TARGET_ESP32
  else if (lo) esp_sleep_enable_ext1_wakeup(lo, ESP_EXT1_WAKEUP_ALL_LOW);  // the ESP32 has no ANY_LOW
#else
  else if (lo) esp_sleep_enable_ext1_wakeup(lo, ESP_EXT1_WAKEUP_ANY_LOW);
#endif
#else
  // The C3: no ext1. The GPIO wake path takes a polarity per call, so both
  // sets can be armed at once.
  if (hi) esp_deep_sleep_enable_gpio_wakeup(hi, ESP_GPIO_WAKEUP_GPIO_HIGH);
  if (lo) esp_deep_sleep_enable_gpio_wakeup(lo, ESP_GPIO_WAKEUP_GPIO_LOW);
#endif
  esp_sleep_enable_timer_wakeup(ms * 1000ULL);
  // Carry the wall clock: the system clock runs on the RTC through sleep.
  PmWallClock &w = pm_wall();
  if (w.utc_ok) {
    int64_t utc_ms = pm_wall_utc_ms();
    struct timeval tv = { (time_t)(utc_ms / 1000), (suseconds_t)((utc_ms % 1000) * 1000) };
    settimeofday(&tv, nullptr);
    rtc_tz_min = w.tz_min; rtc_tz_next_s = w.tz_next_s; rtc_tz_next_min = w.tz_next_min;
    rtc_clock_ok = w.tz_ok;
    rtc_sleep_utc_ms = utc_ms;
  } else { rtc_clock_ok = false; rtc_sleep_utc_ms = 0; }
  rtc_awake_ms = millis();  // how long this wake lasted, for hello next time
  Serial.printf("sleep: awake %lu ms; deep sleep %.1f s (%s)%s\n", (unsigned long)rtc_awake_ms, ms / 1000.0, why, hi || lo ? ", sensor pins wake" : "");
  Serial.flush();
  delay(50);
  esp_deep_sleep_start();
}

void pm_sleep_loop() {
  if (!battery) return;
  measure_drift();
  release_check_in();
  bool off = pm_show_mode() == PM_MODE_OFF;
  set_show_tier(!off && !pm_sleep_holding());
  if (!off || pm_sleep_holding()) return;
  if (pm_ota_state() == PM_OTA_DOWNLOADING || pm_ota_state() == PM_OTA_CONNECTING || pm_ota_state() == PM_OTA_REBOOTING) return;
  // A flood color just sent (e.g. "dark" at the end of the show) goes out
  // before the radio does.
  if (pm_ble_busy()) return;
  // How long: to the next check-in on the shared UTC grid (§6m), or sooner
  // if a schedule window starts first. With no clock yet, the old rule:
  // a full period from now.
  uint32_t secs = checkin_ms / 1000;
  rtc_guard_s = 0;
  rtc_slot_s = 0;
  bool clock = pm_wall().utc_ok;
  if (clock) {
    PmCheckinPlan plan = pm_checkin_plan((uint64_t)(pm_wall_utc_ms() / 1000), checkin_ms / 1000, MIN_SLEEP_S,
                                         pm_checkin_guard(checkin_ms / 1000, rtc_drift_ok));
    secs = plan.sleep_s;
    rtc_guard_s = plan.guard_s;
    rtc_slot_s = (uint32_t)plan.slot_s;
  }
  bool window = false;
  uint32_t next = pm_show_next_change_s();
  if (next && clock) {
    int64_t until = (int64_t)next - pm_wall_utc_ms() / 1000 - WINDOW_LEAD_S;
    if (until > 0 && until < secs) { secs = (uint32_t)until; window = true; rtc_guard_s = 0; rtc_slot_s = 0; }
  }
  if (secs < MIN_SLEEP_S) { pm_sleep_hold(MIN_SLEEP_S * 1000); return; }
  // Real seconds → what to ask this board's (measured) sleep clock for.
  uint64_t ms = rtc_drift_ok ? pm_drift_correct_ms((uint64_t)secs * 1000, rtc_drift_ppm) : (uint64_t)secs * 1000;
  deep_sleep(ms, window ? "until the next schedule window" : clock ? "check-in (on the grid)" : "check-in (no clock yet)");
}

#endif  // PM_NO_SLEEP
