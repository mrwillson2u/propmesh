// Sleep on battery (docs/generic-boards.md §6f). Two tiers:
//  * OFF tier — the schedule (or STOP ALL) says off: deep sleep. Wakes on
//    any DIGITAL_IN pin (sensor or button; it must be an RTC pin), on the
//    check-in timer (sleep_checkin_min), or just before the next schedule
//    window. The wall clock rides through sleep on the RTC; the mesh
//    channel is remembered in flash already.
//  * SHOW tier — any other mode: modem sleep, the radio listening
//    sleep_window_ms of every sleep_interval_ms (stage 2).
// A console request holds the board awake for 10 min so pages and
// updates work; a boot by sensor holds it 60 s so the cue can run.
#pragma once
#include <stdint.h>
#include "pm_config.h"

// Call once at boot, before the mesh and show start: reads the wake
// cause, restores the wall clock after a deep sleep.
void pm_sleep_begin();
// After the show has started: fire the trigger for the pin that woke us.
void pm_sleep_after_boot(const PmNodeConfig &cfg);
void pm_sleep_apply(const PmNodeConfig &cfg);
void pm_sleep_loop();
void pm_sleep_radio_reapply();  // after pm_mesh_recover: the driver forgot its power mode and wake window
void pm_sleep_hold(uint32_t ms);    // keep awake at least this long
uint32_t pm_sleep_hold_left_ms();   // how much longer a hold keeps it awake (0 = free to sleep)
// Switch off on request (the console's Power off): outputs off, then deep
// sleep with no wake source, so only a reset or a power cycle starts it
// again. False on a build without deep sleep (the DevKit): unplug it.
bool pm_sleep_power_off();
bool pm_sleep_holding();
bool pm_sleep_supported();  // false on a mains-board build (PM_NO_SLEEP)
uint16_t pm_sleep_listen_ms();  // listen interval while in the show tier, else 0 (heartbeat listen_ms)
// "power" | "timer" | "sensor" | "reset" — what started this boot.
const char *pm_sleep_wake_cause();
int pm_sleep_wake_gpio();           // -1 unless a sensor pin woke us
// How far this board's sleep clock drifts, measured against the conductor
// and corrected for (docs §6m); false until it has measured once.
bool pm_sleep_drift_ppm(int32_t *ppm);
// How long the board was awake on its previous wake, ms (0 = unknown).
uint32_t pm_sleep_last_awake_ms();
bool pm_sleep_rtc_pin(uint8_t gpio);  // can this GPIO wake the chip from deep sleep? (profile `wake` cap)

// The cell's drain rate, measured by the board itself (docs/console-nodes-list.md §8):
// the resting voltage is logged once an hour (at sleep entry, or hourly
// while awake) in RTC memory, which survives deep sleep; the rate is
// the fall from the oldest log to the newest over the hours between. A
// rise of 50 mV or more (it was charged) restarts the log. The console
// turns the rate into "will it last tonight".
void pm_sleep_note_battery(uint16_t mv);  // main's heartbeat passes the latest reading
// False until the log spans PM_BATT_MIN_SPAN_H hours. rate: mV per hour,
// positive = draining (can be ~0 or slightly negative on a flat stretch).
bool pm_sleep_battery_rate(float *mv_per_h, float *span_h);
#define PM_BATT_MIN_SPAN_H 20.0f
// After a power-on (or the reset button) a battery board stays awake this
// long before its sleep pattern starts, so it can be set up straight away
// (Colin, 2026-10-26: "it goes to sleep as soon as I turn it on"). A
// software restart (an update) or a sleep wake gets no grace.
#define PM_SETUP_HOLD_MS 180000UL
