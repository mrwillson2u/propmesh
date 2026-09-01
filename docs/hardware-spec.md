# PropMesh — Hardware Specification v0.6

Open-source ESP32 mesh prop controller for Halloween / holiday displays.

Two board variants sharing one firmware base and one mesh protocol.

> **Cost confidence:** Component prices below are LCSC-indicative estimates, not live quotes — treat them as ±25%. Assembly, freight, scrap, and packaging figures are modeled from JLCPCB's published fee structure (§4) and are more reliable. Nothing here has been run through JLCPCB's quoting tool yet.

---

## 1. Design decisions locked in

| Decision | Rationale |
|---|---|
| **PCA9685 for all slow outputs** | 16 ch of 12-bit PWM for 2 GPIO. Servos, dimmable LEDs, and relay drive all move off the MCU. |
| **I²S audio, not DFPlayer Mini** | Deterministic sub-ms trigger latency (DFPlayer is ~100 ms and variable). Single SD card. Software volume/crossfade. |
| **No mains switching on board** | Dry-contact relays only, 30 V max. Removes creepage/clearance, isolation, and product-liability burden. Pair with a commercial IP-rated relay box for mains props. |
| **74AHCT125 level shifter on WS2812** | 3.3 V data into 5 V strips is marginal. This is the #1 cause of "my strip flickers randomly." |
| **U.FL antenna option** | Yard-scale coverage. WROOM-1 and WROOM-1U are pin-compatible — same PCB, two BOM variants. |
| **Battery on Mini only** | Mini's ~200 mA average load makes 1S Li-ion viable. Full board's ~2 A average does not. |
| **Mini stores audio in flash, not SD** | ESP32-C3 has no SDMMC; SPI SD costs 4 GPIO the C3 cannot spare. Flash audio + WiFi upload is better UX anyway. |
| **Sockets support stepper or brushed DC** | A stepper driver is two H-bridges; jumper-selectable mode pins let an MP6603-class module drive 2 DC channels per socket instead. Costs $0.51 and keeps the board useful for prop types not yet imagined. |
| **Socketed stepper drivers, not onboard silicon** | Pololu 2×8 footprint accepts TMC2209 / TMC2208 / DRV8825 / A4988. Users supply their own — everyone in this hobby has spare printer drivers. Blown driver is a swap, not a scrapped board. |
| **Motor PWM on ESP32 LEDC, never PCA9685** | PCA9685 caps near 1.6 kHz — squarely audible. DC motors need 20 kHz+ to run silent. A whining motor telegraphs the scare a second before it lands. |
| **Mixed connectors: screw for field wiring, JST-XH for pluggable** | Board edge, not board area, is the binding constraint. Screw terminals for anything that gets wet or yanked; JST-XH where the hardware already ships with a matching cable. Steppers plug straight in. |
| **Two SKUs per board: assembled and SMT-only** | Through-hole labor is the largest single assembly line item (§4.3). Shipping connectors loose cuts cost and lets builders choose their own connector style. |

---

## 2. Full board — "PropMesh Pro"

**MCU:** ESP32-S3-WROOM-1U-N8R2 · **Target size:** ~130 × 100 mm · **4-layer**

### 2.1 GPIO allocation

| Function | Pin | Notes |
|---|---|---|
| Boot button | GPIO 0 | Strapping |
| Analog in ×2 | GPIO 1, 2 | ADC1 only — ADC2 unusable with WiFi active |
| IR receiver | GPIO 3 | RMT RX. Strapping (JTAG select), internal pulldown, safe as input |
| WS2812 ch1 | GPIO 4 | RMT TX |
| WS2812 ch2 / APA102 DATA | GPIO 5 | RMT TX |
| APA102 CLK | GPIO 6 | Solder jumper selects 3-wire vs 4-wire |
| I²S BCLK | GPIO 7 | |
| I²C SDA / SCL | GPIO 8, 9 | PCA9685 + Qwiic header |
| Digital in ×3 | GPIO 10, 11, 12 | Pull-up, clamp diodes, 1 kΩ series |
| **Stepper 1 STEP / DIR** | **GPIO 13, 14** | Reclaimed from the old SPI header |
| I²S LRCLK / DOUT | GPIO 15, 16 | To MAX98357A |
| **TMC UART (shared)** | **GPIO 17, 18** | One UART configures both drivers via MS1/MS2 address strapping |
| USB D− / D+ | GPIO 19, 20 | Native USB; console lives here, so UART0 is free |
| **Stepper 2 STEP** | **GPIO 21** | |
| **DC motor B IN1 / IN2** | **GPIO 33, 34** | LEDC @ 25 kHz |
| Status RGB LED | GPIO 38 | |
| microSD — SDMMC 1-bit | GPIO 39, 40, 41 | CLK / CMD / D0 |
| **Stepper DIAG ×2 (StallGuard)** | **GPIO 42, 43** | Stall interrupt. Solder-jumper selectable to expansion header when running non-StallGuard drivers. |
| **DC motor A IN1** | **GPIO 44** | LEDC @ 25 kHz |
| **Expansion header** | **GPIO 45, 46** | Strapping pins — see §2.2. Broken out with pulldowns and series resistors. |
| **Stepper 2 DIR** | **GPIO 47** | |
| **DC motor A IN2** | **GPIO 48** | LEDC @ 25 kHz |
| Stepper shared ENABLE | PCA9685 ch 16 | The last free expander channel |

> **Verify against your module variant.** GPIO 33–37 are available on the N8R2 (quad PSRAM) but are consumed by octal PSRAM on R8/R16 parts. If you substitute a different WROOM-1 variant, re-check 33 and 34 before layout.

**Used: 31 of ~33 usable.** All remaining pins are broken out rather than left stranded — see §2.2.

### 2.2 Expansion header

A 2×5 0.1" header exposes everything the board doesn't consume internally.

| Pin | Signal | Notes |
|---|---|---|
| 1 | 3V3 | 500 mA budget |
| 2 | 5V | Shares the 3 A rail with LEDs and servos |
| 3, 10 | GND | |
| 4 | **GPIO 45** | ⚠ Strapping (VDD_SPI select). **Must be LOW at reset.** |
| 5 | **GPIO 46** | ⚠ Strapping (boot mode). **Must be LOW at reset.** |
| 6, 7 | SDA / SCL | Duplicates the Qwiic bus in 0.1" form |
| 8 | GPIO 42 | Stepper 1 DIAG, or free via solder jumper JP1 |
| 9 | GPIO 43 | Stepper 2 DIAG, or free via solder jumper JP2 |

**Strapping-pin protection (mandatory, not optional):** each of GPIO 45 and 46 gets a **10 kΩ pulldown to GND** plus a **100 Ω series resistor**. The pulldown guarantees a safe boot state even if a user leaves the header floating or attaches something with a weak pull-up; the series resistor limits damage from a miswired connection. Silkscreen both pins **"KEEP LOW AT RESET"**.

These two are best used as **outputs** — driving an LED, a MOSFET gate, a trigger to another controller. As inputs they're usable, but only for a signal guaranteed low during the boot window.

**The DIAG jumpers are free capability.** If someone populates A4988 or DRV8825 sockets, StallGuard doesn't exist and GPIO 42/43 would otherwise be dead. Cutting JP1/JP2 hands them back as general-purpose I/O.

#### The real expansion story is I²C

Two GPIO is a modest amount of headroom. The bus is where the actual growth is:

- **A second PCA9685 on the Qwiic connector gives 16 more PWM channels for about $1.** Address-strapped, no firmware surprises, and it's the same driver code you're already running.
- Chain up to **62 PCA9685s** in principle — realistically 3 or 4 before the 5 V rail becomes the limit, which is 48–64 channels of servo, dimmable LED, or relay drive.
- Any I²C sensor a builder wants: ToF distance for trigger zones, accelerometers, environmental sensors, capacitive touch.

Design the firmware to enumerate expanders at boot and this scales without a board respin. **Document this prominently** — it's the answer to "can I add more channels," and it's far cheaper than putting 32 channels on the base board.

### 2.3 Mechanical and connector strategy

#### Board size

The original 100 × 80 mm target was optimistic. Working from actual footprints:

| Category | Area |
|---|---|
| 2× Pololu stepper sockets (17×22 each + heatsink spacing) | ~960 mm² |
| ESP32-S3-WROOM-1U (18 × 25.5, plus antenna keepout) | ~470 mm² |
| 3× HK4100F relays | ~490 mm² |
| Power stage (2 buck ICs, 7×7 inductor, bulk caps) | ~630 mm² |
| microSD, USB-C, 3.5 mm jack | ~420 mm² |
| Remaining ICs (PCA9685, MAX98357A, 2× DRV8871, ULN2003, 74AHCT125) | ~320 mm² |
| Passives + 6 servo headers | ~540 mm² |
| Connectors (see split below) | ~2,160 mm² |
| **Raw footprint** | **~5,990 mm²** |
| **× 2.4 routing / clearance factor** | **~14,400 mm²** |

**Target: 130 × 100 mm.**

The 2.4× multiplier is higher than the usual 2.0× because **Economic PCBA is single-sided** — decoupling caps and small passives can't move to the bottom layer, so they consume top-side area alongside everything else.

#### The binding constraint is board edge, not area

Every connector that leaves the board needs perimeter. All-screw-terminals would need **~234 mm of edge**; a 100 × 80 board offers ~280 mm usable after mounting holes and corner radii. Technically feasible, but it forces terminals onto all four sides — miserable inside an enclosure with cable glands.

The mixed strategy below drops that to **~200 mm** and frees up which edges get used.

#### Screw terminals — field wiring

Things that get wet, get yanked, and have no standard connector.

| Output | Positions | Pitch |
|---|---|---|
| DC power in | 2 | 5.08 mm |
| Relay ×3 (NO/COM/NC) | 3 each | 5.08 mm |
| WS2812 | 3 | 5.08 mm |
| APA102 | 4 | 5.08 mm |
| DC motor ×2 | 2 each | 5.08 mm |
| Speaker | 2 | 3.5 mm |
| Basic LED ×2 | 2 each | 3.5 mm |

#### JST-XH and pin headers — pluggable

Things that connect to hardware already shipping with a cable.

| Input | Connector | Why |
|---|---|---|
| **Stepper ×2** | **JST-XH 4-pin** | **NEMA17s already terminate in JST-XH.** Printer parts plug straight in. |
| Digital input ×3 | JST-XH 3-pin | Power, ground, signal |
| Analog input ×2 | JST-XH 3-pin | Power, ground, signal |
| Servo ×6 | 3-pin 2.54 mm header | Servos carry their own connector |
| I²C | Qwiic JST-SH | Standard |

**The stepper swap alone saves ~286 mm² and 20 mm of board edge** — a JST-XH 4-pin is 10 mm wide against a 4-position screw terminal's 20.3 mm — and it makes the board a direct plug for motors the user already owns.

#### Corrected: sensor inputs must be 3-pin

Earlier revisions specified 2-position screw terminals for sensor inputs. **That is a functional bug.** An HC-SR501 PIR — the most common trigger sensor in this hobby — needs VCC, GND, and OUT. A 2-position terminal supplies two of the three, forcing users to steal 5 V from elsewhere on the board.

**All five sensor inputs are now 3-pin JST-XH:** power, ground, signal. This fixes the problem and shrinks the board at the same time.

#### Enclosure

130 × 100 mm fits a **150 × 110 × 70 mm IP65 junction box** (~$12, widely available). That leaves room for cable glands along one long edge and the ~20 mm of Z-height the stepper driver heatsinks need.

Fix the mounting-hole pattern early so a printable bracket and gland template can ship alongside the Gerbers.


### 2.4 Bill of materials

Estimated LCSC pricing at qty 100. **T** = through-hole (drives manual assembly cost, see §4.3).

#### MCU and USB
| Part | Qty | Mount | Unit | Ext |
|---|---|---|---|---|
| ESP32-S3-WROOM-1U-N8R2 | 1 | SMT | $3.40 | $3.40 |
| USB-C receptacle, 16-pin | 1 | SMT | $0.12 | $0.12 |
| USBLC6-2SC6 ESD | 1 | SMT | $0.10 | $0.10 |
| Tactile switch 6×6 (boot/reset) | 2 | SMT | $0.05 | $0.10 |
| | | | | **$3.72** |

#### Power
| Part | Qty | Mount | Unit | Ext |
|---|---|---|---|---|
| AP64350SP-13 buck, 40 V / 3.5 A | 1 | SMT | $0.80 | $0.80 |
| TLV62569 buck, 3.3 V | 1 | SMT | $0.35 | $0.35 |
| Inductor 4.7 µH / 5 A shielded | 1 | SMT | $0.15 | $0.15 |
| Inductor 2.2 µH / 2 A | 1 | SMT | $0.08 | $0.08 |
| AO3401A P-FET (reverse polarity) | 1 | SMT | $0.05 | $0.05 |
| SMAJ33A TVS | 1 | SMT | $0.08 | $0.08 |
| Polyfuse 3 A | 1 | SMT | $0.15 | $0.15 |
| Bulk electrolytics + MLCC | — | mixed | — | $0.40 |
| Screw terminal 2-pos, DC in | 1 | **T** | $0.20 | $0.20 |
| | | | | **$2.26** |

*Alternate:* MP4560 (55 V / 3 A, ~$0.55) for a cheaper main buck.

#### PWM expander and slow outputs
| Part | Qty | Mount | Unit | Ext |
|---|---|---|---|---|
| PCA9685PW, TSSOP-28 | 1 | SMT | $0.85 | $0.85 |
| ULN2003A relay driver (built-in flyback) | 1 | SMT | $0.20 | $0.20 |
| HK4100F-DC5V-SHG relay, 3 A | 3 | **T** | $0.45 | $1.35 |
| Screw terminal 3-pos (NO/COM/NC) | 3 | **T** | $0.30 | $0.90 |
| Servo header, 3-pin 2.54 mm | 6 | **T** | $0.05 | $0.30 |
| Basic LED output terminals | 2 | **T** | $0.25 | $0.50 |
| | | | | **$4.10** |

#### Audio
| Part | Qty | Mount | Unit | Ext |
|---|---|---|---|---|
| MAX98357AETE+T, 3.2 W class-D | 1 | SMT | $1.90 | $1.90 |
| microSD push-push socket | 1 | SMT | $0.30 | $0.30 |
| 3.5 mm line-out jack (PJ-320A) | 1 | **T** | $0.15 | $0.15 |
| Speaker screw terminal 2-pos | 1 | **T** | $0.20 | $0.20 |
| Output ferrite + caps | — | SMT | — | $0.10 |
| | | | | **$2.65** |

> **Sourcing decision required.** $1.90 reflects genuine Analog Devices / Maxim silicon at qty 100. Chinese functional equivalents run ~$0.60 and are generally fine for this application. Choosing the clone saves **$1.30/board** but is a call you should make deliberately, not by accident — document whichever you pick in the public BOM.

#### Addressable LED
| Part | Qty | Mount | Unit | Ext |
|---|---|---|---|---|
| SN74AHCT125N level shifter | 1 | SMT | $0.35 | $0.35 |
| Screw terminal 3-pos (WS2812) | 1 | **T** | $0.30 | $0.30 |
| Screw terminal 4-pos (APA102) | 1 | **T** | $0.35 | $0.35 |
| 1000 µF bulk + 330 Ω series | — | mixed | — | $0.25 |
| | | | | **$1.25** |

#### Motor drivers
| Part | Qty | Mount | Unit | Ext |
|---|---|---|---|---|
| Pololu 2×8 socket (8-pin female header ×2) | 2 | **T** | $0.25 | $0.50 |
| DRV8871DDAR H-bridge, 45 V / 3.6 A pk | 2 | SMT | $1.20 | $2.40 |
| JST-XH 4-pin (stepper coils) | 2 | **T** | $0.12 | $0.24 |
| Screw terminal 2-pos (DC motor) | 2 | **T** | $0.20 | $0.40 |
| Motor rail bulk caps + UART series R | — | mixed | — | $0.22 |
| Expansion header 2×5 0.1" + strap protection | 1 | **T** | $0.12 | $0.12 |
| Mode jumper blocks, 3-pin (MS1/2/3 × 2 sockets) | 6 | **T** | $0.033 | $0.20 |
| | | | | **$4.08** |

**Stepper drivers are user-supplied.** The socket is the standard Pololu 2×8 footprint.

#### Driver compatibility — UART vs SPI

The board wires a shared **two-wire UART** bus (GPIO 17/18). This is a deliberate constraint: SPI would need MOSI, MISO, SCK, plus a CS per socket — five pins, and only two are free.

| Driver | Fits socket | Config bus | On this board |
|---|---|---|---|
| **TMC2209** ✅ recommended | Yes | UART | **Full function.** Runtime current, microstep, StallGuard over the shared bus |
| TMC2208 | Yes | UART | Full function, minus StallGuard (chip doesn't have it) |
| TMC2240 | Yes | SPI | STEP/DIR standalone only — no runtime config, no StallGuard |
| TMC5160 | Yes | SPI | STEP/DIR standalone only |
| DRV8825 / A4988 | Yes | none | Works fully — no config bus to miss. Cut JP1/JP2 to reclaim the DIAG pins. |

**Why TMC2209 and not the newer parts:** the TMC2240 and TMC5160 add lossless current sensing, better thermal behavior, and higher current ceilings — all aimed at high-speed printing and industrial motion. A prop lid that opens once every four minutes gets nothing from that, and they cost 2–4× more. A NEMA17 tops out near 1.5–2 A regardless, so the TMC2209's 2.0 A RMS / 2.8 A peak is not the bottleneck; the motor is.

#### Dual-mode sockets: stepper or brushed DC

A bipolar stepper driver is two H-bridges. The socket's 1A/1B/2A/2B pins are those bridges, so feeding them PWM instead of step sequencing gives **two brushed DC channels per socket**.

**Supported in v1 via jumper-selectable mode pins.** Pololu's MP6603 carrier operates from 8 V to 55 V, delivers ~2 A per phase continuously and 4 A peak, is pinout-compatible with A4988 carriers in many applications, and has configurable input modes that let it alternatively drive brushed DC motors.

| Socket config | Total motor channels |
|---|---|
| 2× stepper (default) | 2 stepper + 2 DC onboard |
| 1× stepper, 1× DC module | 1 stepper + 4 DC |
| 2× DC module | 6 DC |

**Board requirements:**

- **MS1/MS2/MS3 on 3-pin jumper blocks per socket.** MS1/MS2 are needed regardless — that's how two TMC2209s get distinct UART addresses on a shared bus. Silkscreen the TMC2209 default positions.
- **STEP/DIR must be LEDC-capable.** GPIO 13/14 and 21/47 all are.
- Firmware: per-socket `stepper` / `dc` mode setting, plus a duty-cycle ceiling derived from the user's stated motor voltage (a 12 V motor on the 24 V VMOT rail caps near 50%).

> ⚠ **Verify at schematic capture.** StepStick control-side pinouts are not fully standardized — VMOT, GND, and the coil outputs are universal, but MS/UART/SPREAD pin assignments differ between A4988, DRV8825, TMC2208, TMC2209 (and between TMC2209 vendors). Check the MP6603, your specific TMC2209, and A4988 datasheets against the footprint before layout. Pololu describes the MP6603 as "very similar" to A4988, not identical.

**StallGuard is the feature that earns its keep here.** Sensorless homing means no limit switches and no extra cable runs to something staked in the dirt in the rain.

**Note on the market:** socketed drivers are now largely a Klipper / Voron / BigTreeTech enthusiast pattern, since most mainstream consumer printers integrate drivers on the mainboard. That's precisely this project's audience — and it's why the socket is the right call rather than a dated one. Most people who want this board already have spare TMC2209s in a drawer.

**Why sockets beat onboard silicon here:** the driver IC never appears in your BOM (no part cost, no $3 extended-part feeder fee), most builders already own spares, and a blown driver is a 10-second swap rather than a dead board.

**DC channels use DRV8871, driven from ESP32 LEDC at 25 kHz.** Do not route these through the PCA9685 — its ~1.6 kHz ceiling sits in the middle of the audible band and will make every motor whine.

#### Sensors and expansion
| Part | Qty | Mount | Unit | Ext |
|---|---|---|---|---|
| TSOP38238 IR receiver | 1 | **T** | $0.25 | $0.25 |
| JST-XH 3-pin, digital in ×3 | 3 | **T** | $0.10 | $0.30 |
| JST-XH 3-pin, analog in ×2 | 2 | **T** | $0.10 | $0.20 |
| BAT54S clamp diodes | 5 | SMT | $0.06 | $0.30 |
| Qwiic JST-SH 4-pin | 1 | SMT | $0.15 | $0.15 |
| 0.1" headers (SPI / UART) | 2 | **T** | $0.08 | $0.16 |
| HC-SR501 PIR footprint header | 1 | **T** | $0.08 | $0.08 |
| | | | | **$1.44** |

#### Misc and board
| Part | Qty | Mount | Unit | Ext |
|---|---|---|---|---|
| WS2812B-mini status LED | 1 | SMT | $0.10 | $0.10 |
| Passives (0402/0603 R&C) | — | SMT | — | $0.80 |
| U.FL antenna + pigtail | 1 | — | $1.20 | $1.20 |
| PCB, 4-layer 130×100 mm @ qty 100 | 1 | — | $4.30 | $4.30 |
| | | | | **$6.40** |

*JLCPCB adjusted FR4 pricing in August 2026. Re-quote the bare board before committing.*

### 2.5 Pro board landed cost, qty 100

| Line | Basis | Per board |
|---|---|---|
| **Parts subtotal** | sum of §2.4 | **$25.88** |
| SMT joints (~392) | $0.0017/joint | $0.67 |
| THT joints (~153) | $0.0173/joint | $2.65 |
| Hand-solder labor fee | $3.50 one-time ÷ 100 | $0.04 |
| Feeder loading (~52 unique parts) | $1.50 each = $78 ÷ 100 | $0.78 |
| Setup + stencil | ~$15 one-time ÷ 100 | $0.15 |
| **Assembly subtotal** | | **$4.29** |
| Air freight | ~$100 shipment ÷ 100 | $1.00 |
| Scrap allowance | 3% of parts + assembly | $0.91 |
| Retail packaging | ESD bag, box, quick-start card | $1.10 |
| **Ex-duty landed** | | **$33.18** |
| US import duty | at 25% on ~$30.50 PCBA value | +$7.63 |
| **Duty-paid landed** | | **~$40.80** |

**Suggested retail: $94–104.** At $99 that's a 2.5× multiple on duty-paid cost — thin for a physical product once you account for Tindie fees, returns, and support time. See §4.4 for the levers.

**SMT-only SKU:** drops THT joints and the hand-solder fee (−$2.69). Ship connectors and sockets loose in a bag. Target $84.

---

## 3. Mini board — "PropMesh Mini"

**MCU:** ESP32-C3-MINI-1U-N4 · **Target size:** ~50 × 40 mm · **2-layer** · **Battery powered**

### 3.1 GPIO allocation

The C3 has ~13 usable pins. This map only closes because audio lives in flash instead of on SD.

| Function | Pin | Notes |
|---|---|---|
| Analog sensor in | GPIO 0 | ADC1 |
| Battery voltage sense | GPIO 1 | ADC1, 1 MΩ divider + FET disconnect |
| 5 V rail load-switch enable | GPIO 2 | **Strapping pin** — needs pull-up, defaults rail ON at boot |
| IR receiver | GPIO 3 | RMT RX |
| I²S BCLK | GPIO 4 | |
| I²S LRCLK | GPIO 5 | |
| I²S DOUT | GPIO 6 | |
| WS2812 data out | GPIO 7 | RMT TX, through 74AHCT1G125 |
| I²C SDA | GPIO 8 | **Strapping pin** — I²C pull-up holds it high at boot ✓ |
| Boot button | GPIO 9 | Strapping pin |
| I²C SCL | GPIO 10 | To PCA9685 + Qwiic |
| USB D− / D+ | GPIO 18, 19 | Console over native USB Serial/JTAG |
| Digital input 1 | GPIO 20 | UART0 TX repurposed |
| Digital input 2 | GPIO 21 | UART0 RX repurposed |

**Retained via PCA9685:** 3 servo channels, 4 dimmable LED channels, 1 relay. Keeping the expander on the Mini is the single highest-value-per-mm² decision on this board.

**No motor channels on the Mini, deliberately.** All 13 usable GPIO are allocated, so motor control would have to run through the PCA9685 and its ~1.6 kHz ceiling — audible whine. Separately, a 1S cell sized for ~200 mA average cannot feed a NEMA17 or a stalled DC motor at 2–3 A. Builders who want a motor on a Mini should hang an external driver off the Qwiic connector.

**No spare GPIO on the Mini either** — all 15 exposed pins on the C3-MINI-1 are allocated, so there is no expansion header. The Qwiic connector is the entire expansion path, and it is a good one: a second PCA9685 adds 16 PWM channels for about $1, and any I²C sensor works. Budget the 5 V rail accordingly if running from battery.

### 3.2 Bill of materials

| Part | Qty | Mount | Unit | Ext |
|---|---|---|---|---|
| ESP32-C3-MINI-1U-N4 | 1 | SMT | $1.60 | $1.60 |
| USB-C receptacle + ESD + CC resistors | 1 | SMT | $0.25 | $0.25 |
| TP4056 Li-ion charger, SOP-8 | 1 | SMT | $0.10 | $0.10 |
| DW01A + FS8205A protection | 1 | SMT | $0.15 | $0.15 |
| AO3401 load-share P-FET + Schottky | 1 | SMT | $0.10 | $0.10 |
| TPS61023DRLR boost, 5 V / 3 A | 1 | SMT | $0.75 | $0.75 |
| Inductor 1 µH | 1 | SMT | $0.12 | $0.12 |
| ME6211C33 LDO, 1 µA Iq | 1 | SMT | $0.08 | $0.08 |
| AO3401 5 V rail load switch | 1 | SMT | $0.05 | $0.05 |
| JST-PH 2.0 battery connector | 1 | **T** | $0.10 | $0.10 |
| Solar input terminal + Schottky | 1 | **T** | $0.15 | $0.15 |
| PCA9685PW | 1 | SMT | $0.85 | $0.85 |
| MAX98357A | 1 | SMT | $1.90 | $1.90 |
| Speaker screw terminal | 1 | **T** | $0.20 | $0.20 |
| 74AHCT1G125 level shifter, SOT23-5 | 1 | SMT | $0.12 | $0.12 |
| WS2812 screw terminal 3-pos | 1 | **T** | $0.30 | $0.30 |
| HK4100F relay + driver transistor | 1 | **T** | $0.50 | $0.50 |
| Relay screw terminal 3-pos | 1 | **T** | $0.30 | $0.30 |
| Servo headers ×3 | 3 | **T** | $0.05 | $0.15 |
| Sensor input terminals (2 dig, 1 ana) | 3 | **T** | $0.20 | $0.60 |
| TSOP38238 IR receiver | 1 | **T** | $0.25 | $0.25 |
| Qwiic connector | 1 | SMT | $0.15 | $0.15 |
| Boot button + status LED | — | SMT | — | $0.15 |
| Passives | — | SMT | — | $0.50 |
| U.FL antenna + pigtail | 1 | — | $1.20 | $1.20 |
| PCB, 2-layer 50×40 mm | 1 | — | $0.55 | $0.55 |
| **Parts subtotal** | | | | **$11.17** |

*Battery cell and holder sold separately — most users already own 18650s.*

### 3.3 Mini board landed cost, qty 100

| Line | Basis | Per board |
|---|---|---|
| **Parts subtotal** | sum of §3.2 | **$11.17** |
| SMT joints (~230) | $0.0017/joint | $0.39 |
| THT joints (~35) | $0.0173/joint | $0.61 |
| Hand-solder labor fee | $3.50 one-time ÷ 100 | $0.04 |
| Feeder loading (~34 unique parts) | $1.50 each = $51 ÷ 100 | $0.51 |
| Setup + stencil | ~$15 one-time ÷ 100 | $0.15 |
| **Assembly subtotal** | | **$1.70** |
| Air freight | ~$45 shipment ÷ 100 | $0.45 |
| Scrap allowance | 3% of parts + assembly | $0.39 |
| Retail packaging | | $0.80 |
| **Ex-duty landed** | | **$14.51** |
| US import duty | at 25% on ~$12.90 PCBA value | +$3.23 |
| **Duty-paid landed** | | **~$17.75** |

**Suggested retail: $44–49.**

**SMT-only SKU:** −$0.65. Marginal on this board; probably not worth a second SKU.

### 3.4 Power budget and runtime

Battery: 1× 18650, 3000 mAh, 3.6 V nominal → **10.8 Wh usable**

| Mode | Load | Draw | Runtime |
|---|---|---|---|
| Always-listening, 20 px flicker + audio | MCU 0.33 W + LEDs 1.36 W + audio 0.15 W | ~1.84 W | **~6 h** |
| Always-listening, 8 px candle + audio | MCU 0.33 W + LEDs 0.32 W + audio 0.15 W | ~0.80 W | **~13 h** |
| Deep sleep, PIR wake (5 V rail switched off) | MCU 5 µA + boost EN low 1 µA + LDO 1 µA | ~15 µA | **months** |

**Critical:** without the 5 V load switch, WS2812 quiescent current (~0.7–1 mA per pixel) drops sleep runtime from months to about six days. This part is not optional.

**Solar:** 6 V / 1 W panel through a Schottky into TP4056 VIN yields ~5 Wh/day in good sun. Fully sustains a trigger-mode prop; meaningfully extends an always-on one. A CN3065 is the better-engineered alternative if you want proper solar charge behavior for ~$0.30 more.

---

## 4. Manufacturing cost model

### 4.1 JLCPCB published fee structure

| Fee | Rate |
|---|---|
| SMT assembly, automated placement | $0.0017 per solder joint |
| THT hand-soldering labor | $3.50 per order |
| THT manual assembly | $0.0173 per solder joint |
| Feeder loading, **Standard PCBA** | $1.50 per unique component |
| Setup fee | $8 per order (commonly offset by monthly coupons) |

### 4.2 Economic vs Standard PCBA

**Economic PCBA is capped at 30 pieces per board design.** Above that you either panelize or move to Standard PCBA. At qty 100 both boards land on Standard, which is why the $1.50-per-unique-part feeder loading fee appears in the cost tables — it does not apply to Economic orders.

**Implication for prototypes:** the first 5–30 boards of each spin can go Economic, which avoids feeder loading entirely and makes the March prototype run substantially cheaper per board than these production numbers suggest.

### 4.3 Through-hole is the dominant assembly cost

| Board | SMT joints | THT joints | SMT cost | THT cost |
|---|---|---|---|---|
| Pro | ~380 | ~96 | $0.65 | **$1.66** |
| Mini | ~230 | ~35 | $0.39 | $0.61 |

On the Pro, **through-hole labor costs 2.5× the entire SMT placement** despite being a quarter of the joints. The drivers are 13 screw terminals, 6 servo headers, and 3 relays.

**Mitigations, in order of preference:**

1. **Ship connectors unpopulated (SMT-only SKU).** Saves $1.70/board and lets builders choose screw terminals vs JST vs direct-solder. This is standard practice for open-source hardware and the community generally prefers it.
2. **Consolidate terminal blocks.** Three separate 2-pos digital-input terminals could become one 6-pos block — same pin count, fewer part numbers, one less feeder.
3. **Reduce unique part count.** Every part number eliminated saves $1.50 across the whole order. Standardizing on one resistor package and one terminal pitch is worth real money at Standard PCBA.

### 4.4 JLCPCB vs PCBWay

| | JLCPCB | PCBWay |
|---|---|---|
| Quoting | Instant, self-serve | Assembly usually needs a manual engineering quote |
| Component library | ~698 basic, 300k+ extended, tightly integrated with LCSC | Broader sourcing flexibility |
| Consigned parts | Generally not accepted for standard assembly | Accepts customer-supplied parts readily |
| Best for | Lowest cost when every part is in the LCSC library | Odd connectors, specific relays, anything LCSC doesn't stock |

**Recommendation:** design the BOM against LCSC's in-stock library and use JLCPCB. Switch to PCBWay only if three or more parts require global sourcing — at that point their flexibility beats JLCPCB's price.

### 4.5 Cost lines not yet modeled

- **Actual duty rate.** The 25% figure above is a placeholder. Verify the current HTS classification and rate for assembled PCBAs before committing to a production run — this is the single largest uncertainty in the model.
- **Certification.** FCC Part 15 intentional-radiator testing if you sell assembled boards in the US. Using a pre-certified ESP32 module covers the radio, but the finished product may still need testing. Budget $2–5k if required.
- **Tindie or Shopify fees**, payment processing, and domestic shipping.
- **Support time.** Real and non-trivial for a first hardware product.

### 4.6 Prototype run costing, qty 10

At 10 pieces you are under the 30-piece Economic PCBA cap, which removes the $1.50-per-part feeder loading fee. It is replaced by a **$3 fee per unique Extended part** — charged once per BOM line regardless of quantity. Basic Parts are free; Preferred Extended parts are exempt.

**Pro board, 10 pcs:**

| Line | Total | Per board |
|---|---|---|
| **Extended parts loading (~32 unique × $3)** | **$96.00** | **$9.60** |
| THT joints (1,530) | $26.47 | $2.65 |
| SMT joints (3,920) | $6.66 | $0.67 |
| Setup + stencil | $15.00 | $1.50 |
| THT hand-solder labor | $3.50 | $0.35 |
| **Assembly subtotal** | **$147.63** | **$14.76** |
| Components @ qty-10 pricing | ~$362 | ~$36.23 |
| Bare PCB, 4-layer 130×100 ×10 | ~$60 | $6.00 |
| Freight | ~$28 | $2.75 |
| **Ex-duty total** | **~$597** | **~$60** |

**Mini board, 10 pcs:** roughly **$275 total, ~$27/board** ex-duty.

**The extended-parts fee is ~66% of prototype assembly cost and is identical at 10 or 30 boards.**

#### Prototype cost levers

1. **Panelize both designs into one order with mouse bites.** Setup and stencil are paid once, and — critically — the ~10 Extended parts shared between Pro and Mini (PCA9685, MAX98357A, TSOP38238, HK4100F, U.FL, screw terminals, servo headers) load one feeder and incur one $3 fee instead of two. **Saves roughly $45.**
2. **Build 25–30 rather than 10.** The ~$105 of fixed fees is already spent; boards 11–30 cost only parts and joints, about **$40 each instead of $55**. If beta units are going out in August anyway, buying them now is nearly free.
3. **Skip JLCPCB's through-hole on prototypes.** That's $24 on the Pro run, and for v0.1 you want connectors unsoldered so terminal styles can change after bring-up.

#### Standard-only trap

Parts flagged **"Standard Only"** make the entire design ineligible for Economic PCBA. This commonly applies to SMD LEDs with high moisture-sensitivity level, certain sensors, BGA packages, and anything 0201 or smaller.

**Two parts at risk in this BOM:** the WS2812B-mini status LED and the TSOP38238 IR receiver. If either is flagged, the $136 assembly quote becomes roughly $100 in feeder fees plus a $25 setup — **near double**. Check both in JLCPCB's parts library before ordering; if flagged, move them to hand-soldered through-hole footprints.

**Also note Economic PCBA is single-sided.** All SMT parts must live on the top layer. Plan for this from the start of layout rather than discovering it at quote time.

#### Recommended alternative for v0.1

Ordering 10 bare 4-layer PCBs (~$60) plus components for three boards (~$115) comes to **~$175 for three hand-built prototypes**, versus $597 for ten assembled ones. Nothing on the Pro is BGA — the WROOM module is castellated and the PCA9685 is TSSOP-28, both hand-solderable with hot air or a hot plate. Layout mistakes surface on board one either way, and the difference funds a second spin.

Run PCBA on v0.2 in June at 25–30 units, once the design is proven and the fixed fees spread across boards you will actually ship.


---

## 5. Firmware requirements

### Must-have for v1
- **ESP-NOW mesh** with a designated conductor node for time sync
- **OTA updates** — mandatory. Nobody is pulling eight stakes out of the ground to reflash.
- **Captive portal + web UI** for first-time config and audio upload
- **Deep-sleep / always-on mode selector** exposed in config (Mini)
- **Battery level reporting** over the mesh (Mini)
- **Motor PWM on LEDC at 20–25 kHz.** Anything slower is audible and ruins the scare.
- **TMC UART driver config** — runtime current, microstep, and StallGuard threshold for both sockets over the shared two-wire bus
- **Stepper standstill current reduction, on by default.** A NEMA17 holding position draws 3–8 W doing nothing; six idle props is ~40 W of waste heat and sizes the PSU for a stationary load. Use TMC standstill reduction or full freewheel between triggers.
- **Per-socket motor mode** (`stepper` / `dc`) and a duty-cycle ceiling derived from the user's stated motor voltage
- **Sensorless homing via StallGuard** — home once at boot, then run open-loop. Removes limit switches from a yard install.

### High-value for adoption
- **E1.31 / Art-Net input.** This is the killer feature. The Halloween and Christmas display community already runs **xLights** and **Vixen**. Speaking sACN means your boards drop into existing shows on day one instead of asking people to learn a new tool.
- **Node-RED custom nodes** for visual automation
- **ESPHome custom component** as an alternate firmware path

---

## 6. Licensing

| Asset | License | Why |
|---|---|---|
| PCB / hardware | **CERN OHL-W** | Weakly reciprocal — lets people build commercial products on top, which grows adoption |
| Firmware | **MIT** or **GPL v3** | MIT for max adoption; GPL if you want derivative boards to stay open |
| Documentation | **CC BY-SA 4.0** | |

Publish **KiCad source**, not just Gerbers. That is the community standard and the difference between a project people fork and a project people just buy.

---

## 7. Schedule

The recurring failure mode is starting in October. Working backward from Halloween:

| Month | Milestone |
|---|---|
| **February** | Schematic capture, both boards |
| **March** | Layout, DRC, order v0.1 prototypes (5 each, Economic PCBA) |
| **April** | Bring-up: power rails, then LEDs, then audio, then mesh |
| **May** | Firmware: ESP-NOW sync, web UI, OTA |
| **June** | v0.2 spin with bring-up fixes. Get a real JLCPCB quote at qty 100. |
| **July** | E1.31 / xLights integration, docs, GitHub publish |
| **August** | Beta boards to a handful of haunters for real-world feedback |
| **September** | Tindie listing, final firmware polish |
| **October** | Decorate. Do not design. |

**Ship a v0.1 that only does LEDs, relay, and sensor input if you have to.** That is still a useful prop controller, it gets community feedback nine months earlier, and it de-risks the harder subsystems.
