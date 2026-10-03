# PropMesh Mini — recommended revision, 2026-09-16

**Accepted module, 2026-09-19: ESP32-S3-WROOM-1U-N16R2.** See the
[module decision](module-selection-2026-09-19.md). Earlier C3/C6 preferences and
C3-specific pin proposals below are superseded; other circuit recommendations
remain proposals pending the S3 design.

Proposal following the [plan audit](review-2026-09-16.md). These are recommended
decisions, not an implemented schematic or an approved replacement pinmap.

**2026-09-19 follow-up:** the user's compact-size and pre-certified-module
priorities are evaluated in the [GPIO/module comparison](gpio-module-options-2026-09-19.md).
That comparison adds C6-MINI-1U-H8 as the first module to prototype; the C3/S3
recommendations below record the earlier discussion.

Keep the Mini focused on short, locally triggered effects, with remote
configuration through a powered Pro. Keep the C3, flash audio, native USB,
external antenna and one-cell battery. Resolve the following before capture.

## 1. Separate the controller supply from the effects supply

Use this power tree:

```text
USB / solar -> isolated input selection -> charger with power path -> SYS
                                              |                       |
                                       protected 1S cell              +-> always-on 3.3 V buck-boost
                                                                      |   MCU, wake sensor, PCA logic
                                                                      +-> switchable 5 V boost
                                                                          amp, strip, servos, relay
```

Replace the ME6211 with a low-quiescent-current buck-boost. My first candidate
is [TPS63802](https://www.ti.com/lit/ds/symlink/tps63802.pdf): it can maintain
3.3 V as the cell discharges and has 11 µA typical quiescent current. Its small
exposed-pad package needs reflow/hot-air assembly and the manufacturer's
placement pattern. Select the inductor and effective ceramic capacitance from
its application design, including DC bias and load transients.

The wake port should provide always-on 3.3 V for a specified low-power sensor
or accept a dry contact. Keep GPIO4 as its input. A generic 5 V PIR belongs on
a separately budgeted supply; powering it from the switched rail prevents
motion wake. Qwiic devices also need an explicit sleep-current budget.

## 2. Replace the discrete charging/load-sharing arrangement

My preferred candidate is
[BQ25185](https://www.ti.com/lit/ds/symlink/bq25185.pdf), which combines charging
and system power sharing, supports weak input sources, and specifies 4 µA
battery-only quiescent current. It also provides a battery-temperature input.
Use a thermistor attached to the cell and retain a deliberate cell-protection
design. Specify 4.2 V charging for the selected Li-ion chemistry.

Start with a 300–500 mA programmed USB charge target, subject to source-current
and thermal limits; available charge current falls when the system uses power.
USB and solar still require input isolation/selection and appropriate source
limits. This part is a linear charger, not a claim of maximum-power-point
tracking or guaranteed solar yield. Check panel open-circuit voltage and cell
temperature limits. Include its exposed-pad assembly requirements in the BOM.

## 3. Move IR off board and use the freed pin to simplify power control

Proposed assignments:

| GPIO | Proposed function | Hardware reset default |
|---|---|---|
| 2 | Shared PCA9685 active-low OE | Pull high: outputs disabled |
| 3 | TPS61023 active-high EN | Pull low: 5 V boost off |
| 4 | Local sensor wake | Input with defined bias |

This changes the original active-low rail assignment because GPIO3 becomes
available when IR is removed. GPIO2 remains pulled high, preserving the original
boot/default-off intent. No inversion is needed. Confirm reset and deep-sleep
pin behavior on the chosen module before freezing the map.

Keep the [TPS61023](https://www.ti.com/lit/ds/symlink/tps61023.pdf) and use its
specified shutdown disconnection. Remove the standalone AO3401 rail switch if
the completed circuit proves it redundant. Additional isolation is needed if
external load power could feed back into the board. Define signal states before
removing power; the boost's disconnect does not isolate I²S, PWM or data wires.

External IR remains an accessory option, with its idle consumption included.
The follow-up below recommends preserving external IR break-beam support for
the user's intended crossing detector.

## 4. Give servos and dimming separate PWM resources

Use two PCA9685s: 0x40 for 50 Hz servos and 0x41 for 1 kHz dimming. Relay and
ordinary status-LED control can use spare channels. This follows the revised
Pro architecture and avoids sacrificing dimming quality to save one IC.
[Each PCA has only one shared PWM frequency](https://www.nxp.com/docs/en/data-sheet/PCA9685.pdf).

Connect both OE pins to GPIO2. Fit driver gate/base pull-downs, configure the
disabled-output state to LOW, initialize both chips before enabling outputs,
and command their oscillators to sleep when effects are inactive. Keep their
logic on the always-on supply; independently disable load power. Reinitialize
after every MCU boot because a PCA can retain its state through an MCU reset.

## 5. Preserve OTA and put a real limit on audio storage

Use the currently recommended
[ESP32-C3-MINI-1U-N4X](https://www.espressif.com/sites/default/files/documentation/esp32-c3-mini-1_datasheet_en.pdf),
with a pinned toolchain compatible with that silicon revision.

For the 4 MiB version, start from two 1.5 MiB application slots and approximately
0.875 MiB for files, leaving 128 KiB for boot/configuration/metadata allocations.
This is a budgeting example; a real aligned partition table and complete
firmware build must validate it. At 64 kbit/s, the file allowance is about
115 seconds before filesystem/configuration overhead. I would accept this
short-clip limitation rather than sacrifice recoverable firmware updates.
[OTA requires a second application slot](https://docs.espressif.com/projects/esp-idf/en/stable/esp32c3/api-reference/system/ota.html).

If 2 MiB of audio is a firm requirement, choose a larger-flash controller before
capture. My fallback is the Pro's
[ESP32-S3-WROOM-1U-N8R2](https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf),
with 8 MB flash and 2 MB PSRAM. That would warrant a fresh GPIO/PWM architecture
and battery benchmark, not a drop-in part substitution. Prototype simultaneous
audio decoding, mesh and strip output before committing to either controller.

## 6. Set a realistic shared output-power target

My proposed qualification target is **5 V / 1 A total continuous**, shared by
all onboard-powered effects, using a battery connector, holder, wiring and
protection path rated for at least 3 A. This is a design target, not a verified
rating. At 3.0 V and assumed 90% efficiency, the effects alone need about
1.85 A from the cell, before MCU current and other losses. The existing 2 A
JST-PH path leaves inadequate margin for that target.

Qualify the complete path at low battery, hot ambient and simultaneous starts;
include charger power-path losses. Select boost inductors for both saturation
and RMS current. Use external power for larger strips or substantial servo
loads, with deliberate backfeed prevention. Three servo connectors do not mean
three stalled servos can be powered simultaneously. Include current limiting
or suitable protection; software brightness limits cannot handle every fault.

## 7. Implement three explicit operating modes

| Mode | Initial behavior | Intended use |
|---|---|---|
| Show / edit | Continuous listening | Timed cues, live control, uploads |
| Reachable standby | Receive/poll opportunity around once per second | Convenient remote access with a delay |
| Long standby | Deep sleep; GPIO wake plus 60-second check-in | Infrequent effects and remote maintenance |

The intervals are initial tuning targets. ESP-NOW supports station receive
windows, but confirm disconnected-station power saving and CPU power management
in the actual pinned SDK; measure complete-board consumption.
[Espressif ESP-NOW power-saving API](https://docs.espressif.com/projects/esp-idf/en/stable/esp32c3/api-reference/network/esp_now.html#config-esp-now-power-saving-parameter).

Keep queued commands on a powered Pro. A Mini polls, receives a request to stay
awake, acknowledges it, and opens a renewable maintenance session. Add command
IDs, acknowledgements, retries, expiry and a UI showing next expected contact.
Do not retransmit expired effect triggers as late surprises. Timed shows need
preloaded cues/time synchronization or continuous listening. A sleeping Mini
must not be required to relay traffic for other nodes.

## 8. Finish supporting circuits and verify placement before pricing

- Use a permanent 1 MΩ/1 MΩ battery divider with an ADC capacitor rather than
  an unallocated disconnect FET. Budget its 2.1 µA at 4.2 V and validate ADC
  calibration/settling with that source impedance.
- Explicitly add all four dimming power stages, connectors, gate resistors,
  pull-downs and any required inductive-load suppression to the BOM. Provide
  proper sensor voltage protection; GPIO21's series resistor alone is not it.
- Keep indicators off in sleep. Target **under 100 µA measured at the battery
  for the bare board in deep sleep**, excluding attached sensors/accessories,
  as an initial acceptance goal. This is not a predicted measurement. Measure
  radio standby separately and budget event energy and timer-wake overhead.
- Place every connector, plug/screwdriver clearance and antenna cable first.
  Treat 50 × 40 mm as a target until that placement works. Reserve compact
  switching loops, uninterrupted return paths and charger/amplifier thermal
  copper; do not compress these merely to retain the outline.
- Reprice the complete BOM after these decisions. The existing $11.17 estimate
  cannot represent this revision. Replace runtime and solar promises with
  measured modes, event counts and explicit usable-energy assumptions.

Recommended sequence: power-tree and pin-budget revision; devkit proof of audio,
OTA and sleepy-leaf communication; power-circuit prototype and measurements;
connector placement; then schematic capture and routing. No electrical or
firmware implementation was changed to create this proposal.

## Follow-up: precise crossing detection and longer audio

The user clarified that the hidden IR transmitter establishes a beam that
someone walks through. Preserve this capability through the always-on GPIO4
wake port; onboard IR removal need not remove the feature.

A slit or tube can narrow a PIR's detection area, but its response still depends
on motion through detection zones and thermal contrast. For a definite crossing
point, recommend an external active IR break beam.
[Panasonic PIR FAQ, Q1-10 and Q1-14](https://api.pim.na.industrial.panasonic.com/file_stream/main/fileversion/244673).

Prototype a fixed-gain light-barrier receiver such as TSSP4038 and a matching
38 kHz modulated emitter. The planned TSOP38238 suppresses continuous signals;
it is a remote-control receiver. Arrange a steady beam-present/broken signal
for GPIO wake. If using intermittent bursts to save transmitter power, add a
hardware missing-pulse detector so the sleeping MCU need not interpret them.
Rearm only after the path is clear, and qualify sunlight, alignment and reflected
light. Sensor detection and wake-to-audio latency are separate measurements.
[Vishay receiver application note](https://www.vishay.com/doc/?82904=),
[TSOP38238 datasheet](https://www.vishay.com/docs/82491/tsop382.pdf).

The current [TSSP40 datasheet](https://www.vishay.com/docs/82458/tssp40.pdf)
specifies 0.35 mA typical at 3.3 V in darkness. Budget actual illuminated
operation and output loading separately, plus the transmitter's own supply.
This is a useful precision-versus-power trade, not a reason to drop IR outright.

Additional soldered SPI NOR flash is viable audio storage. For example,
[W25Q128JV](https://www.winbond.com/resource-files/w25q128jv%20revg%2004082019%20plus.pdf)
provides 128 Mbit = 16 MiB and a commanded power-down mode. Ordinary SPI needs
SCLK, MOSI, MISO and CS: four GPIO that the present C3 map does not have free.
Its module's internal flash bus is not exposed for an easy shared-bus addition.
Keep application/OTA partitions in main flash and stream audio from the
secondary device. ESP-IDF supports secondary flash; filesystem integration
still needs validating in the project's pinned build.
[Espressif external-flash API](https://docs.espressif.com/projects/esp-idf/en/v4.4.6/esp32c3/api-reference/storage/spi_flash.html).

| Dedicated audio capacity | At 64 kbit/s | At 128 kbit/s |
|---|---:|---:|
| 16 MiB | 35 min | 17.5 min |
| 32 MiB | 70 min | 35 min |
| 64 MiB | 140 min | 70 min |

Calculated capacities before filesystem overhead; larger devices require their
own part/driver qualification. Compression quality and decoder resources also
need a playback test.

If longer audio is a priority, first evaluate
[ESP32-S3-WROOM-1U-N16R2](https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf):
16 MB flash plus 2 MB PSRAM, without a separate storage bus. An illustrative
10 MiB audio allocation holds about 22 minutes at 64 kbit/s or 11 minutes at
128 kbit/s, while leaving space for two 2 MiB applications and other partitions.
PSRAM is working memory, not persistent audio storage. This module option changes
the MCU/PWM/placement design and requires a new power benchmark; it is a proposal,
not an accepted substitution. For hours of audio, external flash or microSD on
a controller with enough pins becomes more attractive.
