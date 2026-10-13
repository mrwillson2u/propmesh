# PropMesh Mini — accepted module selection, 2026-09-19

**Decision: ESP32-S3-WROOM-1U-N16R2.** The user selected this module after
comparing C3/C6 pin budgets, board size and audio storage. This supersedes the
earlier recommendation to prototype C6-MINI-1U-H8 first.

The priorities remain a pre-certified module, compact complete board, external
IR break-beam wake, native USB, battery operation and longer audio recordings.
The selected part has 16 MB flash, 2 MB quad-SPI PSRAM and 36 exposed GPIO.
Its body is 18 × 19.2 × 3.2 mm. Use this exact R2 variant when planning pins;
other PSRAM variants can reserve additional GPIO.
[Espressif module datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf).

## Material tradeoffs

- **Power:** active CPU and memory-retention energy needs measurement with the
  actual workload. The S3 table gives 240 µA light sleep, with an additional
  40 µA for this 2 MB PSRAM; simple deep-sleep modes are 7–8 µA typical. These
  are datasheet baselines, not complete-board or reachable-mesh measurements.
  CPU frequency, radio duty cycle, peripherals and regulator losses matter.
  Sensor-triggered deep sleep remains viable; no runtime percentage is claimed.
  [Power tables and PSRAM footnote](https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf).
- **Cost:** DigiKey US prices checked on 2026-09-19 were $6.32 for one S3 module
  and $4.77410 each at 100, versus $3.38 and $2.53910 for the C3-N4X. The
  100-piece difference is $2.235/module before shipping/tax/tariff additions.
  This is a distributor snapshot, not a production BOM quote. Removing separate
  audio flash and PWM expanders can offset some of the difference.
  [S3 listing](https://www.digikey.com/en/products/detail/espressif-systems/ESP32-S3-WROOM-1U-N16R2/16162650),
  [C3 listing](https://www.digikey.com/en/products/detail/espressif-systems/ESP32-C3-MINI-1U-N4X/27525543).
- **Compared with C6:** S3 lacks C6's Wi-Fi 6 and 802.15.4/Thread/Zigbee radio.
  Those capabilities are not used by the current PropMesh ESP-NOW design.
  [C6 capabilities](https://www.espressif.com/sites/default/files/documentation/esp32-c6-mini-1_mini-1u_datasheet_en.pdf).
- **Integration:** a new GPIO allocation, firmware target and partition table
  are required. The previous C3 assignments cannot be reused by merely changing
  the module name. Sharing the S3 family with Pro reduces the number of distinct
  MCU platforms to support.

Espressif lists FCC certification for S3-WROOM-1U in its
[certificate directory](https://www.espressif.com/en/support/documents/certificates).
Retain the documented module/antenna configuration. Module certification does
not establish certification of the complete product.

## Recommended implementation direction

Use module flash for audio and retain two application slots for OTA. The
previous illustrative 10 MiB audio allocation remains a planning budget, not
an implemented partition table. Keep the external wake-sensor connection and
the always-on controller / switched-effects power architecture.

Evaluate native hardware PWM for the Mini's three servos and four dimmers,
with a direct relay-control GPIO. This could remove both proposed PCA9685s;
the power FETs, relay driver, suppression and hardware default-off behavior
remain necessary. Independent hardware timers preserve servo and dimmer
frequencies without software-timed pulses.
[S3 LEDC documentation](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/ledc.html).

The selected module is accepted; detailed PWM/pin assignments and power-part
choices remain design work. `pinmap.yaml` and generated Mini headers still
describe the explicitly marked legacy C3 baseline. No S3 schematic or PCB exists
yet. Before capture, replace that baseline, regenerate headers, update hardware
and software specs together, and validate audio/mesh timing, wake latency and
complete-board power.

## Current scope: optional clock provision; wireless wake experiments deferred

Accepted 2026-09-19: prioritize power, audio, Wi-Fi/ESP-NOW and sensor/timer
wake. Defer BLE standby experiments, Thread/Zigbee and auxiliary wake radios.

For the future S3 schematic and PCB, reserve GPIO15 (XTAL_32K_P, module pad 8)
and GPIO16 (XTAL_32K_N, module pad 9) for an optional 32.768 kHz crystal.
Include footprints for the crystal, two load capacitors and optional parallel
bias resistor, all **DNP (do not populate)** in the initial build. Keep the
crystal circuit close to the module pins with short traces away from switching
power and digital noise. Select the crystal/package and load values during
capture; follow Espressif's RTC clock circuit. Firmware must operate without
the optional crystal fitted. This reserves a future experiment, not BLE wake
functionality; the crystal does not let BLE receive during deep sleep.
[Module pin definitions](https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf),
[RTC clock circuit](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/schematic-checklist.html#rtc-clock-source-optional).

No Mini schematic or PCB exists yet: this is a capture/layout requirement,
not a physically placed footprint. Preserve this reservation when replacing
the legacy C3 pinmap with the S3 allocation.

### Deferred background: Bluetooth or 802.15.4 to enable Wi-Fi on demand

The user asked whether a low-power radio could wake the Mini and enable Wi-Fi.
The following options are retained for future reference, outside current scope.

**Built-in BLE cannot wake the S3 from true deep sleep:** its wireless hardware
is powered down. BLE modem sleep plus automatic light sleep can instead keep
the device contactable through scheduled radio activity.
[S3 sleep modes](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/sleep_modes.html).

Possible future experiment: disable Mini Wi-Fi, periodically advertise a connectable
BLE service, and have a powered Pro scan/connect and request a Wi-Fi session.
After acknowledgement, enable Wi-Fi/ESP-NOW, report readiness and maintain the
session until timeout. Let the powered Pro perform scanning rather than making
the battery Mini continuously scan for wake broadcasts. A Pro must be within
BLE reach; existing ESP-NOW multi-hop routes do not automatically carry BLE.
Measure coexistence effects on the Pro's normal Wi-Fi/mesh service.
[S3 coexistence](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-guides/coexist.html).

Compare this with ESP-NOW receive windows at the same contact-latency target,
and with deep-sleep timer check-ins at longer intervals. Measure complete-board
current including radio events, PSRAM, regulator and wake sensor; BLE is not
automatically the lowest-energy choice. Espressif's power-save example includes
S3 builds for the main crystal and an external 32 kHz clock. The optional
32.768 kHz crystal provision above preserves that future comparison; current
scope does not include implementing or benchmarking BLE standby.
[BLE power-save example](https://github.com/espressif/esp-idf/blob/master/examples/bluetooth/nimble/power_save/README.md),
[ESP-NOW receive windows](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/network/esp_now.html#config-esp-now-power-saving-parameter).

For true S3 deep sleep with radio-triggered wake, a separate low-power radio/MCU
can periodically receive and assert an RTC-capable GPIO. That adds a module,
power/antenna integration and another firmware path. Thread/Zigbee also need
an appropriate powered parent/gateway radio, absent from the current Pro.
Thread sleepy end devices poll their parent; changing protocols does not remove
the latency-versus-energy tradeoff.
[OpenThread sleepy end devices](https://openthread.io/guides/thread-primer/node-roles-and-types).

Current decision: keep the selected S3 with sensor/timer deep sleep for long
standby and continuous Wi-Fi availability during tightly timed shows. Revisit
wireless wake only after the core functions work.
