// A mains board build (the DevKit, -DPM_NO_SLEEP) keeps Bluetooth for the
// floods instead: the chip's IRAM holds WiFi + Bluetooth or WiFi + deep
// sleep, not all three (2026-10-11). "On battery" on such a board still
// makes it a leaf; it just never sleeps.
#ifdef PM_NO_SLEEP
#include "pm_sleep.h"
#include "pm_pinrules.h"
void pm_sleep_begin() {}
void pm_sleep_after_boot(const PmNodeConfig &) {}
void pm_sleep_apply(const PmNodeConfig &) {}
void pm_sleep_loop() {}
void pm_sleep_hold(uint32_t) {}
bool pm_sleep_holding() { return true; }
bool pm_sleep_supported() { return false; }
uint16_t pm_sleep_listen_ms() { return 0; }
const char *pm_sleep_wake_cause() { return "power"; }
int pm_sleep_wake_gpio() { return -1; }
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

static bool battery;
static uint32_t checkin_ms = 300000;
static uint16_t interval_ms = 1000, window_ms = 100;
static uint32_t hold_until_ms;
static const char *cause = "power";
static int wake_gpio = -1;
static bool show_tier;  // modem sleep configured

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
      w.set_utc((int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000, millis());
      w.set_tz(rtc_tz_min, rtc_tz_next_s, rtc_tz_next_min);
    }
    hold_until_ms = millis() + (cause[0] == 's' ? SENSOR_HOLD_MS : BOOT_DWELL_MS);
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
uint16_t pm_sleep_listen_ms() { return show_tier ? interval_ms : 0; }
bool pm_sleep_holding() { return (int32_t)(millis() - hold_until_ms) < 0; }
const char *pm_sleep_wake_cause() { return cause; }
int pm_sleep_wake_gpio() { return wake_gpio; }

// Show tier (stage 2): the radio listens window_ms of every interval_ms.
static void set_show_tier(bool on) {
  if (on == show_tier) return;
  show_tier = on;
  if (on) {
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

static void deep_sleep(uint32_t seconds, const char *why) {
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
  esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);
  // Carry the wall clock: the system clock runs on the RTC through sleep.
  PmWallClock &w = pm_wall();
  if (w.utc_ok) {
    int64_t utc_ms = pm_wall_utc_ms();
    struct timeval tv = { (time_t)(utc_ms / 1000), (suseconds_t)((utc_ms % 1000) * 1000) };
    settimeofday(&tv, nullptr);
    rtc_tz_min = w.tz_min; rtc_tz_next_s = w.tz_next_s; rtc_tz_next_min = w.tz_next_min;
    rtc_clock_ok = w.tz_ok;
  } else rtc_clock_ok = false;
  Serial.printf("sleep: deep sleep %lu s (%s)%s\n", (unsigned long)seconds, why, hi || lo ? ", sensor pins wake" : "");
  Serial.flush();
  delay(50);
  esp_deep_sleep_start();
}

void pm_sleep_loop() {
  if (!battery) return;
  bool off = pm_show_mode() == PM_MODE_OFF;
  set_show_tier(!off && !pm_sleep_holding());
  if (!off || pm_sleep_holding()) return;
  if (pm_ota_state() == PM_OTA_DOWNLOADING || pm_ota_state() == PM_OTA_CONNECTING || pm_ota_state() == PM_OTA_REBOOTING) return;
  // A flood color just sent (e.g. "dark" at the end of the show) goes out
  // before the radio does.
  if (pm_ble_busy()) return;
  // How long: the check-in, or sooner if a schedule window starts first.
  uint32_t secs = checkin_ms / 1000;
  uint32_t next = pm_show_next_change_s();
  if (next && pm_wall().utc_ok) {
    int64_t until = (int64_t)next - pm_wall_utc_ms() / 1000 - WINDOW_LEAD_S;
    if (until > 0 && until < secs) secs = (uint32_t)until;
  }
  if (secs < MIN_SLEEP_S) { pm_sleep_hold(MIN_SLEEP_S * 1000); return; }
  deep_sleep(secs, next && secs < checkin_ms / 1000 ? "until the next schedule window" : "check-in");
}

#endif  // PM_NO_SLEEP
