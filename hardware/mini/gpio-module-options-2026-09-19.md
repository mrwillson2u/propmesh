# PropMesh Mini — GPIO and module options, 2026-09-19

**Decision update:** the user subsequently selected **ESP32-S3-WROOM-1U-N16R2**.
See the [accepted module decision](module-selection-2026-09-19.md). The comparison
below is retained as rationale; its C6-first recommendation is superseded.

The user's priorities are a pre-certified ESP module and a compact complete
board, while preserving precise IR break-beam triggering and useful audio
storage. This updates the earlier module recommendation; no pin assignments
or hardware implementation change here.

## Current C3 allocation

Source: [pinmap.yaml](../../pinmap.yaml). All 15 exposed GPIO are assigned.
This is the existing plan, before the proposed IR/power/PWM changes.

| GPIO | Current use | Reallocation assessment |
|---|---|---|
| 0 | Analog sensor input | Optional if analog accessories are not required |
| 1 | Battery voltage ADC | Keep; moving to an I2C ADC/gauge costs another IC |
| 2 | Active-low 5 V rail control | Keep a hardware control signal; assignment/circuit can change |
| 3 | Dedicated onboard IR receiver | Best reclaim: external break-beam receiver can use GPIO4 |
| 4 | Digital input 1 / deep-sleep wake | Keep for the break beam or another selected wake sensor |
| 5 | I2S LRCLK | Keep for the planned amplifier |
| 6 | I2S audio data | Keep for the planned amplifier |
| 7 | Addressable LED strip data | Keep if retaining strip support |
| 8 | I2C SDA | Shared by output controllers and Qwiic |
| 9 | Boot/recovery button | Can also serve an application function after boot, with circuit changes |
| 10 | I2C SCL | Shared by output controllers and Qwiic |
| 18 | USB D− | Keep for native USB programming/console |
| 19 | USB D+ | Keep for native USB programming/console |
| 20 | I2S BCLK | Keep for the planned amplifier |
| 21 | Digital input 2 | Optional if one digital sensor input is sufficient |

Servos, dimming outputs and the relay use PCA9685 channels, not individual C3
GPIO. Removing one of those outputs therefore does not free an MCU pin. Removing
Qwiic alone also frees no pins while the PCA still needs I2C.

The [C3 module datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-c3-mini-1_datasheet_en.pdf)
confirms the exposed GPIO and boot strapping. GPIO9 can potentially double as a
SPI chip-select because inactive-high CS suits normal boot. The button circuit,
reset behavior and any attached chip must preserve recovery and avoid driving
an output directly against ground. It is a shared signal requiring design work,
not a free pin obtained just by deleting the button.

## What fits on a C3

Moving IR to the GPIO4 wake port reclaims one pin without losing the user's
break-beam feature. Dropping analog input and the second digital input could
reclaim another two, at a real feature cost. Reusing GPIO9 could provide a
fourth SPI signal, but the recommended hardware PCA output-disable control
also needs a signal: the original map omitted it. The proposed GPIO2=OE and
GPIO3=boost EN consume the first reclaimed pin.

Additional savings are possible by moving slow functions into another I2C IC,
combining control signals with carefully designed hardware, or making USB
charge-only and providing a different programming connection. These approaches
add parts or sacrifice convenience. They are possible, but are a poor starting
point when a module with more GPIO can occupy the same body area.

## Module comparison

These are external-antenna versions, matching the current plan. Body dimensions
exclude land patterns, routing, antenna cable/antenna, connectors and power
circuitry. Matching body dimensions do not imply pin compatibility.

| Module | Body, mm | Exposed GPIO | Flash / PSRAM |
|---|---|---:|---|
| ESP32-C3-MINI-1U-N4X | 13.2 × 12.5 | 15 | 4 MB / none |
| ESP32-C6-MINI-1U-H8 | 13.2 × 12.5 | 22 | 8 MB / none |
| ESP32-S3-WROOM-1U-N16R2 | 18.0 × 19.2 | 36 | 16 MB / 2 MB |

Sources: [C3](https://www.espressif.com/sites/default/files/documentation/esp32-c3-mini-1_datasheet_en.pdf),
[C6](https://www.espressif.com/sites/default/files/documentation/esp32-c6-mini-1_mini-1u_datasheet_en.pdf),
[S3 WROOM](https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf).
The S3 WROOM body adds 180.6 mm², approximately 9% of the proposed 50 × 40 mm
board area; this is an area calculation, not a placement proof.

Espressif's [certificate directory](https://www.espressif.com/en/support/documents/certificates)
lists FCC certifications for all three module families above, including the
external-antenna C6-MINI-1U. Match the ordered variant and antenna to the applicable
module documentation. This comparison does not establish certification of the
complete PropMesh product.

The S3-MINI-1U is another interesting physical option at 15.4 × 15.4 mm, with
39 GPIO and either 8 MB flash without PSRAM or 4 MB flash with 2 MB PSRAM.
However, this review found FCC documentation listed for S3-MINI-1 and CE/SRRC
for S3-MINI-1U, without verifying FCC coverage for the exact 1U configuration.
Do not infer that coverage from its sister module. It remains a secondary
candidate pending that verification.
[S3 MINI datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3-mini-1_mini-1u_datasheet_en.pdf).

## C6 resource budgets worth prototyping

With one external wake sensor in place of onboard IR, the core functions use
14 GPIO: analog input, battery sense, boost enable, wake input, three I2S signals,
strip data, two I2C signals, boot, two USB signals and the second digital input.

| Proposed output/storage architecture | Additional GPIO | Total | Free |
|---|---:|---:|---:|
| Two PCAs, shared OE, external SPI flash | 1 + 4 | 19 | 3 |
| Native servos; one PCA for dimmers/relay with OE; external SPI flash | 3 + 1 + 4 | 22 | 0 |
| Native servos, dimmers and relay; audio in module flash | 3 + 4 + 1 | 22 | 0 |

These are signal budgets, not verified pinmaps. A final allocation must account
for strapping, USB's fixed pins, ADC and deep-sleep wake restrictions, and ROM
UART output. C6 module GPIO are 0–9 and 12–23; GPIO10/11 are not available.

The C6 provides separate MCPWM and LEDC peripherals. The proposal is MCPWM for
three servos and LEDC for four dimmers, retaining different frequencies without
software-generated PWM. Espressif provides a
[C6 MCPWM servo example](https://docs.espressif.com/projects/esp-idf/en/stable/esp32c6/api-reference/peripherals/mcpwm.html).
External power FETs, flybacks, servo power and defined reset states remain
necessary even if the PWM expanders are removed.

This is a reason to revisit the earlier locked PCA decision specifically on
Mini: the C3 needed the pin reduction, while C6 has enough GPIO and independent
hardware PWM resources to trade the expanders for board area. It does not change
the Pro's implementation or silently remove its hardware disable behavior.

## Recommendation

Prototype **C6-MINI-1U-H8 first** for the smallest module with a workable GPIO
budget. With external audio flash, the one-PCA architecture is an attractive
placement candidate. If several minutes in the module's 8 MB flash are enough,
the all-native-output candidate removes both expanders. Actual audio capacity
depends on the OTA/application partition budget.

The repository already has a C6 devkit environment in
[platformio.ini](../../firmware/mesh-node/platformio.ini), but that is not evidence
that audio decoding, simultaneous outputs, mesh and battery sleep have been
validated together. Pin the SDK and run that workload before choosing hardware.
Also compare complete-board sleep/active energy rather than assuming C6 is lower
power because it is newer. Confirm purchasing availability before freezing H8.

Choose **S3-WROOM-1U-N16R2** if the integrated 16 MB storage, PSRAM and greater
processing/GPIO margin are more valuable than the larger module. Its native PWM
can also replace the Mini's expanders, so compare complete placements rather
than module rectangles alone. Retain the C3 only if its smaller feature/storage
budget is acceptable without elaborate pin sharing.
