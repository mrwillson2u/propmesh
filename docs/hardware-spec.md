# PropMesh — Hardware Specification v0.6

Open-source ESP32 mesh prop controller for Halloween / holiday displays.

Two board variants sharing one firmware base and one mesh protocol.

> **Cost confidence:** Component prices below are LCSC-indicative estimates, not live quotes — treat them as ±25%. Assembly, freight, scrap, and packaging figures are modeled from JLCPCB's published fee structure (§4) and are more reliable. Nothing here has been run through JLCPCB's quoting tool yet.

---

## 1. Design decisions locked in

| Decision | Rationale |
|---|---|
| **PCA9685 for all slow outputs** | 16 ch of 12-bit PWM for 2 GPIO. Servos, dimmable LEDs, and relay drive all move off the MCU. **Two chips since 2026-09-16**: all channels of one PCA9685 share a single PWM frequency, so servos at 50 Hz forced the DC dimming channels to flicker at 50 Hz — the six DC channels now run on a second PCA9685 (0x41) at 1 kHz for $1.84 and zero GPIO. Both output-enables on GPIO 37: outputs held off while the MCU is in reset. |
| **I²S audio, not DFPlayer Mini** | Deterministic sub-ms trigger latency (DFPlayer is ~100 ms and variable). Single SD card. Software volume/crossfade. |
| **No mains switching on board** | Dry-contact relays only, 30 V max. Removes creepage/clearance, isolation, and product-liability burden. Pair with a commercial IP-rated relay box for mains props. |
| **74AHCT-family level shifter on WS2812** (one octal 74AHCT541 since 2026-09-05) | 3.3 V data into 5 V strips is marginal. This is the #1 cause of "my strip flickers randomly." |
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
| LED strip 1 clock | GPIO 3 | APA102 CLK via the 74AHCT541 octal shifter — both strip outputs are 3- or 4-wire. Strapping (JTAG select): drives only a shifter input. *Corrected 2026-09-08: GPIO 3 has no internal pull (DS Table 3-1 = Floating); it is safe because the strap applies only with the JTAG_SEL_ENABLE eFuse burned — populate `R53` to make it deterministic.* *Was the IR receiver until 2026-09-05: a receiver inside a hidden enclosure can't see a remote — plug one into a `DIGITAL_IN` instead.* |
| WS2812 ch1 | GPIO 4 | RMT TX |
| WS2812 ch2 / APA102 DATA | GPIO 5 | RMT TX |
| LED strip 2 clock | GPIO 6 | APA102 CLK via the 74AHCT541; 3- vs 4-wire is a firmware setting |
| I²S BCLK | GPIO 7 | |
| I²C SDA / SCL | GPIO 8, 9 | PCA9685 + Qwiic header |
| Digital in ×3 | GPIO 10, 11, 12 | Pull-up, clamp diodes, 1 kΩ series |
| **Stepper 1 STEP / DIR** | **GPIO 13, 14** | Reclaimed from the old SPI header |
| I²S LRCLK / DOUT | GPIO 15, 16 | To MAX98357A |
| **TMC UART (shared)** | **GPIO 17, 18** | One UART configures both drivers via MS1/MS2 address strapping |
| USB D− / D+ | GPIO 19, 20 | Native USB; console lives here, so UART0 is free |
| **Stepper 2 STEP** | **GPIO 21** | |
| **DC motor B IN1 / IN2** | **GPIO 35, 36** | LEDC @ 25 kHz. *Moved from 33/34 on 2026-09-03 — those pins are not bonded out on any WROOM-1.* |
| Status RGB LED | GPIO 38 | 5 V WS2812 — data through buffer 4 of the 74AHCT541 octal shifter |
| microSD — SDMMC 1-bit | GPIO 39, 40, 41 | CLK / CMD / D0 · 10 kΩ pull-ups on CMD and D0 |
| **Stepper DIAG ×2 (StallGuard)** | **GPIO 42, 43** | Stall interrupt. Solder-jumper selectable to expansion header when running non-StallGuard drivers. GPIO 43 is U0TXD — the ROM boot log drives it at every reset, so a 1 kΩ series resistor isolates it from the TMC's push-pull DIAG output. |
| **DC motor A IN1** | **GPIO 44** | LEDC @ 25 kHz |
| **Expansion header** | **GPIO 45, 46** | Strapping pins — see §2.2. Broken out with pulldowns and series resistors. |
| **Stepper 2 DIR** | **GPIO 47** | |
| **DC motor A IN2** | **GPIO 48** | LEDC @ 25 kHz |
| Stepper shared ENABLE | PCA9685 ch 16 | The last free expander channel. **Through a 2N7002 inverter + pull-up** — PCA9685 powers up outputs-LOW and driver EN is active-low, so uninverted, both sockets would energize from power-on until I²C init. Inverted, drivers default disabled; firmware drives the channel HIGH to enable. |

> **Verify against your module variant.** GPIO 35–37 are available on the N8R2 (quad PSRAM) but are consumed by octal PSRAM on R8/R16 parts — and motor B lives on 35/36, so the module variant is load-bearing. (GPIO 33/34 do not exist on any WROOM-1 — Espressif DS v1.8, verified 2026-09-03.)

**Used: 36 of 36 module GPIO — no spare.** GPIO 37 (free on N8R2, consumed by octal PSRAM on R8/R16) was the spare until 2026-09-16; it is now `PCA_OE`, both PCA9685 output-enables with a 10 k pull-up. GPIO 45/46 are broken out on the expansion header — see §2.2.

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
| Power stage (2 buck ICs, inductors 11.5×10 + 7.1×6.6, bulk caps, protection) | ~740 mm² |
| microSD, USB-C, 3.5 mm jack | ~420 mm² |
| Remaining ICs (PCA9685, MAX98357A, 2× DRV8871, ULN2003, 74AHCT541) | ~320 mm² |
| Passives + 6 servo headers | ~540 mm² |
| Connectors (see split below) | ~2,160 mm² |
| **Raw footprint** | **~6,100 mm²** |
| **× 2.4 routing / clearance factor** | **~14,640 mm²** |

**Target: 130 × 100 mm.**

> **Updated once real parts were chosen (2026-09-02):** the original
> estimate assumed a single 7×7 mm inductor. The resolved parts are
> **11.5×10 mm (L1) and 7.1×6.6 mm (L2)** — 162 mm² instead of 49,
> i.e. **+271 mm² after the routing factor, ~2 % of the board.**
> Absorbable. If layout still runs short, the remaining win is a 4×4 mm
> L2 (−31 mm², see sheets/01); nothing else in the power stage shrinks
> without a real trade.

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

The power pin carries **5 V** — the HC-SR501 needs a 5–12 V supply (its output is a 3.3 V logic signal). Digital inputs get the pull-up + clamp + 1 kΩ series treatment; analog inputs get a divider sized so a 5 V-powered sensor's full-scale output stays inside the ADC range.

#### Enclosure (decided 2026-09-06 — replaces the gland-box plan)

**The box: Multilink RNI-1500** (~$17), the drop-in successor to the
CableGuard CG-1500 that the xLights / Falcon / Kulp community has
standardised on for a decade. Outside 11.6 × 11.2 × 5.1 in, **inside
24.7 × 24.7 × 11.4 cm**. It solves the exact problem a gland box
cannot: wires enter through **self-sealing slotted ports along the
bottom edge** — push a cable through, no gland, a dozen of them — and
the gasketed lid keeps rain out from above. It is rain-tight, not
submersible, which is the correct target. Every commercial pixel
controller advertises "fits a CG-1500"; PropMesh should too, because
it is the box a large share of customers already own.
**Second choice: Bud NBF-32022** (~$19, ABS, IP66/NEMA 4X, 12.8 × 8.9
× 5.3 in inside) — fully sealed, so it needs a cut slot or glands and
a membrane vent; the community uses it with the same plate kits.

**The menu, sized by a rule.** A 130 × 100 board with terminals on
two or three edges needs **~40 mm of wire-bend room beyond every
connector edge** — that, not the board, sets the box. Written out:
**the Pro needs an interior of at least 210 × 140 × 60 mm** (130 + 2 ×
40 along the board, 100 + 40 across it, heatsinks + standoffs deep).
Read a listing's *interior* size against that and the answer is
immediate. **Anything narrower than 140 mm inside is a Mini box.** Field-wiring
cable count is up to ~23 (typical prop: 5–8), so the entry must take
many thin low-voltage cables, not a few fat ones.

- **Hidden / on the ground, no modification: DRiBOX (SOCKiTBOX) Medium
  FL-1859-285 — black, IP55, 34 × 22 × 11.7 cm, ~$20.** Made for cords:
  a silicone seal moulds around cables at both end slots, with clip-in
  cable guides. Lid up, lies on its back — its native posture. **The
  seal is shaped for 8–12 mm mains cords; loose 3–5 mm pigtails leave
  gaps beside them** (asked 2026-09-07). Harmless for rain — the gaps
  sit under the lid lip in a lid-up box — but an open door for insects.
  So: **run the field wiring through a ½ in split loom (or spiral wrap)
  where it crosses each end seal** — one loom per end is exactly the
  cord diameter the seal expects, closes the gaps, and protects the
  pigtails at the box edge. Foam weatherstrip pressed into the channel
  is the no-loom fallback. The slightly-vented result is what the
  condensation argument wants anyway. (The
  Small, interior 200 × 111 × 94 mm, is too tight for the Pro's
  connector clearance; **it is the Mini's box.**) Wall use: a printed
  bracket on the back, since it has no ears.
- **Clear-lid family, no modification: Joinfworld "outdoor electrical
  box" line** (found by Colin 2026-09-07). Hinged transparent lid with a
  stainless latch, 3.5 mm walls, a fixed internal bracket, wall/tree
  ears *and* lies flat, three ~11 mm cable-entry notches with silicone
  plugs for the unused ones. **The 9 × 5 × 4.3 in medium (interior
  207 × 107 × 97 mm, $20, green) is a Mini box** — 107 mm across
  cannot take the Pro's connector edge. Pro candidates in the same
  family, interiors estimated from the outside size and wall thickness
  — **verify the listing's interior graphic against 210 × 140 × 60**:
  - **The 11.4 × 7.5 × 5.5 in "Extension Cord Cover" ($34, grey base,
    clear hinged lid, two stainless latches, wall kit, lies flat) is a
    different and better design than the medium** (Colin, 2026-09-07):
    its **six cord ports are notched into the top edge of one end wall
    at the lid's parting line, under the lid rim** — DRiBOX-class lipped
    entry, not a flush side notch. Interior ≈ 275 × 175 × 115 mm
    (estimated from the outside size; confirm on the listing). Each
    port is sized for a **⌀9.2 mm cord** and ships with a cord mat and a
    blank mat, so **bundle pigtails to ~9 mm: ¼ in split loom (≈ 8 mm
    OD, 3–4 thin cables) or spiral wrap plus a turn of silicone tape —
    ½ in loom is too fat for these ports.** Six ports × 3–4 pigtails ≈
    the Pro's maximum cable count. The listing carries Amazon's
    "frequently returned item" flag: read the one-star reviews (fit,
    latch, seal) before ordering.
  - The **10 × 7 × 3.9 in black IP68 "project box"** (≈ 247 × 170 ×
    85 mm, black, clear lid) — check whether it ships with entries or is
    a plain sealed box needing the KEL-DPZ hole.
  The 9 × 5 medium's three ~11 mm flush notches take the split-loom
  treatment described for the DRiBOX.
  **Why the clear lid matters:** the status pixel becomes readable
  without opening the box — so it stays on the top edge, facing the
  lid, in both orientations. Caveats: an unbranded clear lid may yellow
  in a few seasons of UV, and a clear lid in direct sun is a
  greenhouse; these boxes are for the shade they're hidden in. Green
  is arguably better camouflage in foliage than black.
  **Its weakness (Colin, 2026-09-07): the entries are flush in the side
  wall with no overhang, so the seal is the only thing between wall
  runoff and the wires** — the RNI boxes have gravity (bottom entry)
  and the DRiBOX has its lid lip; this has neither. Rules that make it
  acceptable: **wall-mount it entries-down** (then it is gravity-safe
  like an RNI); **drip loops on every cable**; lying flat, **add the
  overhang** — a strip of self-adhesive rubber/aluminium angle above
  the notches or a printed clip-on eyebrow — or tuck that end under
  the prop.
- **Wall, small, no modification: Multilink RNI-300** — 20.7 × 23.8 ×
  8.6 cm, captive cable entrances along the bottom, wall ears; grey
  (paint it). Board across the top, ~120 mm of wire room below.
- **Wall with the supply inside: Multilink RNI-1500** (above).
- **DIY black box with a sourced entry, one hole-saw cut:** a 230 × 150
  × 85 or 250 × 150 × 100 mm black ABS IP65 box (~$12–15) plus a
  **multi-membrane cable-entry plate** — **icotek KEL-DPZ 63|13** (13
  self-sealing membranes for 1.5–22 mm cables, M63 thread + locknut,
  IP66/68; Amazon B071FFW3MC, ~$29 at distributors; the **63|35 bk** is
  the black 35-membrane version). One **2½ in (63.5 mm) hole saw** cut,
  no other tooling. Checked 2026-09-07: true clones of it are an
  AliExpress item, not an Amazon one; what Amazon sells cheaply are
  fixed-hole **multi-hole gland inserts** (uxcell M63 6-hole, ToolRise
  M20 4-hole, ASI multi-entry seals) — usable, but four of them cost
  as much as the genuine plate and need four holes. Buy the icotek. The 200 × 150 × 100 class (interior 185 × 135) is the
  floor, not the recommendation. Slot-and-printed-insert remains the
  no-budget fallback.

In every configuration **the supply lives outside the small boxes** as a
sealed IP67 brick (§2.9) — the display community's habit, and it keeps
50–100 W of heat out of a sealed volume. Only the RNI-1500 takes a
supply inside.

**Judging any box in one line: entries either face down, or sit under a
drip edge; a flush side entry relies on its seal alone and needs the
mitigations above.** Weather ranking of the families: bottom entry
(RNI) > lipped side entry (DRiBOX, Joinfworld 11.4 × 7.5) > flush
side entry (Joinfworld 9 × 5).

**Both orientations, one rule: the entry face is never on top.**
Wall-mounted, entries face down and cables drip straight off; lying on
its back in a bush, the lid is up, entries face sideways ~90 mm above
the ground, and a slight tilt toward them drains anything that gets in.
Two landscape staples through the ears (or the bracket) stop a ground
box walking in the wind.

**Don't print the box; print the plate.** A 25 cm printed box is hours
of ASA per unit and never as tight as a $17 moulding. The **mounting
plate** is what the "printable bracket" open item becomes: a small,
fast print (or laser-cut) that adapts the board's fixed hole pattern to
whichever box a user has — one design for the RNI-1500's bosses, one
for the NBF, one for the RNI-300, a tray for the DRiBOX Medium, one
blank — plus the optional slot insert. Third-party plate kits for Falcon/Kulp boards are
exactly this and sell for $10–15; ship ours as STLs with the Gerbers. The RNI-1500 interior also takes a **Mean Well LRS-100/150
(129 × 97 mm) stacked below the Pro (130 × 100)** — 197 mm of the
247 mm height — so "one box, one supply, one controller" is a real
configuration for the plate to support.

**Condensation, not rain, is what kills outdoor electronics.** A sealed
box breathes with the day/night cycle, pulls in humid air, and
condenses it on the cold PCB. The CG-1500 design is right *because* it
is vented at the bottom (NEMA-3R thinking: tight above, breathes
below). So: mount the board **vertically, connectors facing down**, so
drips fall off the terminals; every cable makes a **drip loop** before
its port; silica gel is not needed in a vented box (and needs
recharging in a sealed one — a $2 breathable membrane vent is the
better upgrade for an NBF).

**What the board contributes:** **ENIG finish for production** (HASL is
fine for v0.1 hand-builds; ENIG resists the years of humidity that eat
HASL); no exposed copper beyond test points; an **optional acrylic
conformal coat** documented for users (mask sockets, terminals and the
SD slot); plastic boxes only — a metal box kills WiFi, and the -1U
module's external antenna is the escape hatch if someone insists.

**Layout consequences, fixed now:**
- **Field wiring on the BOTTOM edge and the two SHORT edges; the TOP
  edge is service only.** The full connector run is ~250 mm (5.08 mm
  terminals ×16, 3.5 mm ×7, XH ×7, a jack) and a long edge is 130 mm,
  so one edge was never possible. Bottom edge = the heavy and the
  common (DC in, both strips, motors, DC outputs); short edges =
  relays, coil XHs, sensor XHs, speaker, line out. Top edge = USB-C,
  microSD, boot button, status pixel, U.FL — reachable with the lid
  open, never wet. Wires from the side edges turn once toward the
  entry; the ~40 mm rule above covers it.
- Stepper sockets mid-board; the 11.4 cm depth clears driver heatsinks
  with room to spare.
- **Four M3 corner holes on a fixed pattern** (exact spacing settled at
  layout and then frozen — the plate depends on it).


### 2.4 Bill of materials

Estimated LCSC pricing at qty 100. **T** = through-hole (drives manual assembly cost, see §4.3).

> **These tables are cost rollups, not orderable specs.** Several lines
> carry selection criteria the headline number doesn't capture (Isat vs
> Irms on inductors, AHCT vs HC thresholds, hold vs trip on the
> polyfuse, resistor-programmed pins on MAX98357A/DRV8871), and each
> block needs supporting passives that are lumped or omitted here.
> Schematic capture works from **`hardware/pro/sheets/`** — one
> self-contained document per schematic sheet (map:
> `hardware/pro/README.md`) — never from these tables alone.

#### MCU and USB — $4.11 ✅ verified

**Itemised in `hardware/pro/sheets/02-mcu-usb.md`, the single source** —
12 part numbers with verified LCSC numbers and prices (2026-09-03).
This is the rollup only.

| Group | qty 100 | qty 1 |
|---|---|---|
| Module (ESP32-S3-WROOM-1U-N8R2, `C3013944`) | $3.69 | $4.98 |
| USB (Type-C `C165948`, USBLC6, SS34, CC pulldowns) | $0.33 | $0.41 |
| Buttons, EN/boot network, decoupling | $0.09 | $0.14 |
| **MCU + USB total** | **$4.11** | **$5.53** |

> **GPIO 33/34 do not exist on the WROOM-1** (any variant — Espressif
> DS v1.8). MOTOR_B moved to GPIO 35/36, which makes the **N8R2 suffix
> load-bearing**: octal-PSRAM variants (R8/R16V) consume IO35–37.
> Closes open verification item #1, 2026-09-03.

#### Power — $6.73 ✅ verified

**Itemised in `hardware/pro/sheets/01-power.md`, which is the single
source.** Not duplicated here: 21 distinct part numbers, each with its
LCSC number and selection criteria, live in that sheet's per-section
tables. This section carries only the rolled-up cost the model needs.

**These are now real prices, not estimates** — every part on the sheet
has an LCSC number, and the figures below were pulled from JLCPCB's
parts API on 2026-09-03 (the query is in the sheet's Sourcing status).
The earlier $6.88 estimate was within 5 %.

| Group | qty 100 | qty 1 |
|---|---|---|
| Regulators + magnetics (AP64350, TLV62569, L1, L2) | $1.67 | $2.41 |
| Input protection (Q1 + gate clamp, D_Z, D1, F1 holder + fuse, J1, J2 barrel, R_G) | $3.58 | $4.96 |
| Capacitors (11) | $1.44 | $1.77 |
| Resistors ×9, rail LEDs ×2 | $0.04 | $0.04 |
| **Power section total** | **$6.73** | **$9.17** |

The **qty-1 column is the one that matters for the September 2026
prototype run** — five hand-built boards cost ~$45 in power-section
parts alone.

> **F1 dominates at $2.85 (qty 100) / $3.95 (qty 1) — 44 % of the
> whole power section** — a Littelfuse holder chosen for v0.1
> because footprint certainty beats price while committing to a layout.
> **Re-source a generic MINI-blade holder before production** (terminal
> pitch is standardised); expect ~$2.50/board back. Second-largest is
> C1 at $0.80 for 2× 100 V parts, where a 63 V generic saves ~$0.40.

*Alternate:* MP4560 (55 V / 3 A, ~$0.55) for a cheaper main buck.

#### PWM expander and slow outputs — $5.46 ✅ verified

**Itemised in `hardware/pro/sheets/03-outputs.md`, the single source**
(sourced 2026-09-04). Rollup only:

| Group | qty 100 | qty 1 |
|---|---|---|
| PCA9685PW `C2678753` + support | $1.86 | $2.90 |
| Relays ×3 + ULN2003 + 3-pos terminals ×3 | $1.59 | $2.59 |
| **6× DC switch/dim channels** (SI2356DS 40 V — AO3400A until 2026-09-16 — + SS34 flyback + terminal, **VIN_PROT rail — 2 A/ch, 5 A total**) | $1.75 | $2.85 |
| Servo headers ×6 | $0.14 | $0.20 |
| **Slow-outputs total** | **$5.46** | **$8.67** |

> **LED-channel decision resolved 2026-09-04: all 6 channels kept**,
> driven by discrete AO3400A FETs (Basic) — no feature trim. The
> Darlington's ~1 V drop lost 20 % of a 5 V string; the FET loses
> millivolts. AO3400A also replaces sheet 06's 2N7002. *(2026-09-16:
> the six output FETs became 40 V Vishay SI2356DS — the input TVS
> cannot protect a 30 V part — so two MOSFET part numbers now.)* Relay coil reality: 40 mA each (H-power
> suffix), not the 70 mA once assumed. PCA9685 real price $1.84@100
> vs the $0.85 guess — the old table's biggest miss.

#### Audio — $3.28 ✅ verified

**Itemised in `hardware/pro/sheets/04-audio.md`, the single source**
(sourced + datasheet-resolved 2026-09-04). Rollup only:

| Group | qty 100 | qty 1 |
|---|---|---|
| MAX98357A `C910544` + config, decoupling, EMI beads | $1.02 | $1.44 |
| microSD TF-01A `C91145` + pull-ups ×3 + decoupling | $0.33 | $0.44 |
| Speaker terminal | $0.28 | $0.35 |
| **Line-out: PCM5102A `C107671` + PJ-320A jack + support** | $1.65 | $2.25 |
| **Audio total** | **$3.28** | **$4.47** |

> **Clone question dissolved:** genuine ADI is **$0.88 @100** — cheaper
> than this table's old $1.90 estimate and only $0.28 over the clone.
> Genuine, in the public BOM.
> **Line-out KEPT, done right** (dropped then reversed same day, 2026-09-04):
> never off the BTL speaker pins — a PCM5102A second DAC on the shared
> I²S bus gives real ground-centred line level for ~$1.65. Feeds FM
> transmitters / powered speakers — an xLights-community staple.
> GAIN = 12 dB (direct tie), SD_MODE = mono via 620 k — datasheet-exact,
> see the sheet.

#### Addressable LED — $1.09 ✅ verified

**Itemised in `hardware/pro/sheets/05-led.md`, the single source**
(sourced 2026-09-04). Rollup only:

| Group | qty 100 | qty 1 |
|---|---|---|
| **SN74AHCT541DWR** `C2682058` octal shifter + decoupling | $0.45 | $0.67 |
| Strip terminals: 4× DG128-02P (two per strip), 220 µF ×2 (1000 µF until 2026-09-16), 330 Ω ×5, 4 × 10 k input pulldowns | $0.89 | $1.24 |
| Status pixel WS2812B-MINI-X2 `C4154873` + 100 nF (moved from Misc) | $0.10 | $0.13 |
| **LED total** | **$1.44** | **$2.04** |

> **Both strip outputs are 3- or 4-wire** (decided 2026-09-05): GPIO 3
> came free when the onboard IR receiver was dropped. **One octal
> 74AHCT541 shifts all five lines** (strip 1 data + clock, strip 2
> data + clock, status pixel) and leaves three spare 5 V-level outputs
> as v0.1 bodge points — it replaced a quad AHCT125 + single-gate
> 1G125 pair the same day, for +$0.12 and one ordinary 20-pin symbol
> instead of a multi-unit one. SOIC-20W, 1.27 mm pitch, hand-solder
> friendly. Each output = two 02P blocks (5V/GND + DATA/CLK) —
> symmetric, and the 04P terminal was stock-dead anyway. **No mode
> jumper** (dropped 2026-09-06): 3- vs 4-wire is a firmware setting, an
> empty CLK terminal needs no isolating, and the 330 Ω limits a miswire. Status pixel import verified
> against the Worldsemi DS: pins match, land pattern = DS
> recommendation slightly enlarged, V_IH 3.25 V at 5 V — the DS's own
> number for why it needs its shifter gate.

#### Motor drivers — $4.75 ✅ verified

**Itemised in `hardware/pro/sheets/06-motors.md`, the single source**
(sourced + both open items closed 2026-09-04). Rollup only:

| Group | qty 100 | qty 1 |
|---|---|---|
| 2× DRV8871 `C75864` + ILIM, decoupling, terminals | $3.68 | $5.55 |

> **Datasheet-review changes 2026-09-16 add $3.53 per board at qty 100**: $1.49 for six 40 V SI2356DS output FETs replacing AO3400A, and $2.04 for the rest (second PCA9685 $1.84; USB link header, VBUS cap, 22 Ω pair, SD and shifter pull resistors, R53 fitted; 220 µF replacing 1000 µF and 2.2 k 1206 replacing 1 k 0603 net to a few cents). The per-sheet rollups above predate them. Detail: `hardware/pro/schematic-changes-2026-09-16.md`.
| 2× stepper sockets (4× 1×8 female) + MS straps + shunts + DIAG aux | $0.83 | $1.05 |
| JST-XH coils ×2, bulk electrolytics, EN inverter, UART R | $0.24 | $0.29 |
| **Motor total** | **$4.75** | **$6.89** |

> **Open item #3 CLOSED** (Pololu drawing md09b): socket rows are
> 12.70 mm apart exactly, 1×8 at 2.54 mm. RST/SLP positions hardwired
> together = the TMC2209 PDN_UART bus (the ecosystem's own trick —
> A4988 needs them tied, TMC puts UART there). DIAG reaches the GPIOs
> via 2-pin aux headers + jumper wire, because vendors break DIAG out
> in different places. **ILIM verified from TI's DS: ITRIP = 64000/R;
> 30 kΩ = 2.13 A per channel.** DRV8871 genuine = $1.84@100, double
> the old estimate — the sheet's honest cost driver.

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

**Verified 2026-09-07 against the MP6603 datasheet (Rev 1.1, tables 1–3)
and Pololu's carrier drawing (md51a).** The carrier's pins sit in the
A4988 positions like this, and our socket (sheet 06) is wired for it:

| Socket position (A4988 name) | MP6603 carrier pin | In PWM mode it is | On our board |
|---|---|---|---|
| EN | EN (nENBL) | **PWM_D** — enable/PWM for bridge C/D | `STEPPER_EN`, shared by both sockets via the inverter; **held low = enabled** |
| MS1 | **M2** | mode bit | strap `J29` (socket 1) / `J30` (socket 2) → **3V3** for mode 3 |
| MS2 | **M1** | mode bit | strap `J31` / `J32` → **GND** for mode 3 |
| MS3 | **IN_SEL** | 0 = PWM (DC) mode | strap `J33` / `J34` → **GND** for DC, 3V3 (or open — carrier pulls it up) for stepper |
| RST | ROSC | **PWM_A** — direction for bridge A/B | tied to SLP and the TMC UART net (`TMC_UART_RX`) |
| SLP | SLEEP | sleep (low = sleep) | same net as above → **this net must stay high** |
| STEP | STEP | **PWM_B** — enable/PWM for bridge A/B | `STEPPER_x_STEP` GPIO, per socket |
| DIR | DIR | **PWM_C** — direction for bridge C/D | `STEPPER_x_DIR` GPIO, per socket |
| VMOT, GND | same | | `VIN_PROT`, GND |
| 2B, 2A, 1A, 1B | OUT_D, OUT_C, OUT_A, OUT_B | the two bridges | the 4-pin coil XH `J25`/`J27`: **pins 1B+1A = channel A, 2A+2B = channel B** |
| VDD | FLT (nFAULT, 1.5 kΩ series) | fault output | our +3V3 pin — Pololu says tying it to logic supply is safe; no fault readback |
| GND | GND | | |

**What a socket gives in DC mode (M2=1, M1=0, IN_SEL=0 — "two
full-bridges", datasheet Table 2/3):**

- **Channel B (2A/2B, bridge C/D): bidirectional.** Direction on the
  socket's own DIR GPIO; enable is the shared EN (held low). Speed
  control is **locked-antiphase PWM on DIR** (50 % = stopped, 100 % =
  full forward, 0 % = full reverse) — the only per-socket pin left.
- **Channel A (1A/1B, bridge A/B): one direction only.** Its direction
  pin is the RST/SLP net, which our socket ties together for the
  TMC2209's UART; pulling it low would put the MP6603 to sleep, so it
  stays high (= forward) and speed is **PWM on the socket's STEP
  GPIO** (low = drive, high = brake — Table 2). Fine for fans, pumps,
  one-way conveyors; a lid that must open *and* close goes on channel B
  or on a DRV8871 channel.
- Current limit: the carrier's trimpot (ISET) still applies in this
  mode (Table 1, "current limit: yes"). Logic is 3.3 V-compatible; the
  carrier has its own regulator.
- **Caveat when mixing one TMC2209 and one MP6603:** TMC UART traffic
  toggles the shared RST/SLP net, which is the MP6603's SLEEP and
  channel-A direction — the DC motor glitches and the chip naps for
  ~500 µs per frame. Two MP6603s, or a TMC2209 configured once at boot
  and left alone, avoid it. A v0.2 idea (not v0.1): a solder jumper per
  socket to split RST from SLP, which would give channel A its own
  direction pin.

So "convertible" applies to the **two sockets only**. The two DRV8871
channels (`J23`, `J28`) are fixed 2-wire brushed DC outputs and are not
part of it. Counts in the table above stand.

**StallGuard is the feature that earns its keep here.** Sensorless homing means no limit switches and no extra cable runs to something staked in the dirt in the rain.

**Note on the market:** socketed drivers are now largely a Klipper / Voron / BigTreeTech enthusiast pattern, since most mainstream consumer printers integrate drivers on the mainboard. That's precisely this project's audience — and it's why the socket is the right call rather than a dated one. Most people who want this board already have spare TMC2209s in a drawer.

**Why sockets beat onboard silicon here:** the driver IC never appears in your BOM (no part cost, no $3 extended-part feeder fee), most builders already own spares, and a blown driver is a 10-second swap rather than a dead board.

**DC channels use DRV8871, driven from ESP32 LEDC at 25 kHz.** Do not route these through the PCA9685 — its ~1.6 kHz ceiling sits in the middle of the audible band and will make every motor whine.

#### Sensors and expansion — $0.28 ✅ verified

**Itemised in `hardware/pro/sheets/07-sensors-expansion.md`, the
single source** (sourced 2026-09-04, IR dropped 2026-09-05). Rollup:

| Group | qty 100 | qty 1 |
|---|---|---|
| 5× XH-3 + PIR header + 3× BAT54S + input passives | $0.14 | $0.17 |
| Qwiic (SH-1.0 clone `C7430446`) + 2×5 expansion + strap Rs | $0.14 | $0.15 |
| **Sensors total** | **$0.28** | **$0.32** |

> **No onboard IR receiver** (2026-09-05): the board lives hidden
> inside a prop or enclosure, where a receiver can't see a remote. IR,
> when wanted, is a TSOP module on a pigtail into any `DIGITAL_IN`
> (5 V on the XH, output clamped by the BAT54S; firmware runs RMT
> receive on that pin). That freed GPIO 3 for strip 1's clock and
> removed the block's most expensive part and its only THT joint.
> The genuine SM04B-SRSS-TB Qwiic is stock-dead at JLC; a 130 k-stock
> SH-1.0 clone sits on KiCad's official JST-SH footprint (measure at
> layout). Only three BAT54S, not five: analog inputs get halvers, not
> clamps.

#### Misc and board
| Part | Qty | Mount | Unit | Ext |
|---|---|---|---|---|
| Passives (0603 R&C — see §2.6) | — | SMT | — | $0.80 |
| U.FL antenna + pigtail | 1 | — | $1.20 | $1.20 |
| PCB, 4-layer 130×100 mm @ qty 100 | 1 | — | $4.30 | $4.30 |
| | | | | **$6.30** |

*(Status LED moved into the verified Addressable LED block 2026-09-04.)*

*JLCPCB adjusted FR4 pricing in August 2026. Re-quote the bare board before committing.*

### 2.5 Schematic-capture checklist

Board-level requirements that are easy to lose between spec and schematic:

- [ ] **Stepper EN inverted** — AO3400A + pull-up (the output channels moved to 40 V SI2356DS on 2026-09-16; this inverter's drain only sees 3.3 V, so it stays AO3400A) on the shared EN net. PCA9685 powers up outputs-LOW and EN is active-low on every socketed driver; uninverted, both sockets energize coils from power-on until I²C init (and during any firmware crash).
- [ ] **1 kΩ series on GPIO 43** (STEPPER_2_DIAG) — ROM boot log drives U0TXD at every reset against the TMC's push-pull DIAG output.
- [ ] **Status LED data through a 74AHCT541 buffer** — it's a 5 V WS2812 (V_IH 3.25 V). Five of eight buffers used; unused inputs A5–A7 tied to GND, spare outputs Y5–Y7 left open as 5 V-level bodge points.
- [ ] **10 kΩ pull-ups on SD CMD and D0.**
- [ ] **GPIO 45/46: 10 kΩ pulldown + 100 Ω series** (§2.2), silkscreen "KEEP LOW AT RESET".
- [ ] **Sensor JST power pins carry 5 V**; dividers on the analog inputs (§2.3).
- [ ] **Level shifter is SN74AHCT541DWR (SOIC-20W)** — the AHCT suffix is the level shift; never AHC/HC. One octal part replaced the quad + single-gate pair on 2026-09-05.
- [ ] **GPIO 35–37 to test points** — the only unallocated pins.

### 2.6 v0.1 layout — design for patchability

"Fix it with jumpers" is the v0.1 recovery plan, so the layout must be
designed for it on purpose. These cost nearly nothing at design time and
are the difference between a bodge-able board and a scrapped spin:

- [ ] **Test point on every GPIO and every rail.** GPIO 35–37 are spare
  anyway. Label test points with net names on silkscreen.
- [ ] **0 Ω series links on unproven nets** — TMC UART bus, DIAG lines,
  strap-adjacent signals. A cuttable, rewireable link beats a trace.
- [ ] **Staged power with removable links:** input → 5 V → 3.3 V, a
  0 Ω / jumper between each stage. First power-on is incremental, and a
  bad buck can't take the MCU down with it.
- [ ] **Bottom side stays empty** (the Economic-PCBA single-sided rule
  already forces this) — that is the bodge-wire canvas. Don't spend it.
- [ ] **Unpopulated pull-up/pulldown pads** near every boot-sensitive
  pin (GPIO 0, 3, 45, 46 on the Pro; 2, 8, 9 on the Mini).
- [ ] **0603 minimum passives and generous annular rings** on v0.1 —
  hand-rework friendly. Shrink in a later rev if area demands it.
- [ ] **Rev + date on silkscreen**, and fix the mounting-hole pattern
  now (it's already an open item — v0.1 is when it locks).

Bring-up order the staged links enable: rails unloaded → rails loaded →
MCU boots → one subsystem at a time.

### 2.7 Pro board landed cost, qty 100

| Line | Basis | Per board |
|---|---|---|
| **Parts subtotal** | sum of §2.4 (**all seven blocks verified**; IR dropped 2026-09-05; misc/PCB still estimates) | **$31.62** |
| SMT joints (~396) | $0.0017/joint | $0.67 |
| THT joints (~152) | $0.0173/joint | $2.63 |
| Hand-solder labor fee | $3.50 one-time ÷ 100 | $0.04 |
| Feeder loading (~52 unique parts) | $1.50 each = $78 ÷ 100 | $0.78 |
| Setup + stencil | ~$15 one-time ÷ 100 | $0.15 |
| **Assembly subtotal** | | **$4.27** |
| Air freight | ~$100 shipment ÷ 100 | $1.00 |
| Scrap allowance | 3% of parts + assembly | $1.08 |
| Retail packaging | ESD bag, box, quick-start card | $1.10 |
| **Ex-duty landed** | | **$39.07** |
| US import duty | at 25% on ~$36.24 PCBA value | +$9.06 |
| **Duty-paid landed** | | **~$48.13** |

**Suggested retail: $94–104.** At $99 that's a 2.5× multiple on duty-paid cost — thin for a physical product once you account for Tindie fees, returns, and support time. See §4.4 for the levers.

**SMT-only SKU:** drops THT joints and the hand-solder fee (−$2.69). Ship connectors and sockets loose in a bag. Target $84.

### 2.8 Worked use case: fogger

A pond-fogger mist effect (24 V ultrasonic mister + variable fan + lights) maps onto the Pro with **zero hardware changes** — it is a firmware profile, not a board variant.

| Fogger need | Pro resource | Notes |
|---|---|---|
| Mister power, on/off | Relay 1 (dry contact) | Supply-agnostic — pond foggers ship with both 24 VAC and 24 VDC bricks; the contact doesn't care |
| Variable fan | DC motor channel A, DRV8871 @ 25 kHz | 2-wire brushed fan. Silent PWM |
| 12 V *or* 24 V fan | Firmware duty-cycle ceiling (§5) | A 12 V fan on the 24 V rail caps near 50% duty — already a v1 firmware feature |
| Lights | Dimmable + addressable channels | |
| Power | One 24 V supply | Runs the board, the fan rail, and feeds the mister through the relay contact |

**Current limit:** the HK4100F contact is rated 3 A. Single- and 3-disc misters (~25–50 W at 24 V) fit; a 10-head pond fogger (~250 W → 10 A) does not. For big loads the onboard relay switches the **coil of an external automotive relay or SSR** — consistent with the dry-contact philosophy, and worth stating in user docs before someone welds a contact learning it.

**If demand justifies a cheaper fogger SKU later:** a depopulated BOM variant of the same PCB (no audio, no stepper sockets) — shared Gerbers, shared firmware, no new layout. Do not design a third board for this; decide after shipping, with sales data.

### 2.9 Power budget and input limits

The Mini has had a power budget since §3.4; the Pro never did, which
left the input fuse rating unfounded. Loads are given as **power**,
because input current scales inversely with supply voltage — the
worst case is at the *bottom* of the 12–24 V range, not the top.

| Subsystem | Worst-case power | Basis |
|---|---|---|
| 5 V rail | **15 W** | capped by design at 3 A × 5 V — servos, relay coils, audio, logic. (DC switch channels moved OFF this rail to VIN_PROT, 2026-09-04 — they now budget against the input fuse instead) |
| → input side | **17 W** | 15 W ÷ 88 % buck efficiency |
| 2× stepper (NEMA17, running) | **24 W** | ~12 W each: I²R in 1.5 A/phase coils plus driver loss. Standstill reduction cuts this to ~2 W each |
| 2× brushed DC (DRV8871) | **48 W** | ~24 W each at 2 A continuous — **user-dependent and effectively unbounded**; the board cannot budget what someone plugs in |
| **Worst-case total** | **~89 W** | everything running simultaneously |

**Plan for: a 100 W supply, 150 W if both DC motors are real motors.**
That is the whole answer to "what amperage" — 8.5 A at 12 V or 4.2 A at
24 V covers the everything-at-once case (7.4 A / 3.7 A) with a
sliver of margin, and 150 W (12.5 A / 6.3 A) covers it comfortably.
Defaults to name in the docs (bought by the user, never on the BOM):

| Configuration | 12 V | 24 V | Why |
|---|---|---|---|
| Hidden / ground (supply outside the box) | **Mean Well LPV-100-12** (8.5 A, IP67 potted brick, ~$25) — or the ubiquitous no-name black "12 V 8.3 A IP67 LED driver" (~$14) | **LPV-100-24** (4.2 A); **LPV-150-24** (6.3 A) if motors dominate | sealed, sits on the ground, no box needs to fit it |
| Wall with supply inside (RNI-1500) | **LRS-100-12** (8.5 A, ~$17) | **LRS-100-24** (4.5 A) / **LRS-150-24** | open-frame, 129 × 97 mm, stacks below the board |

**Fuse reality check:** the everything-at-12-V case (7.4 A) sits at the
default 7.5 A MINI blade's rating — a blade fuse run at ~100 % will
eventually nuisance-blow. That case is rare (two steppers *and* two
2 A DC motors *and* a full 5 V rail), and the guidance already says
"choose 24 V if motors dominate", but: the holder takes a **10 A MINI
blade** for that build, so **layout sizes the input path (terminal,
fuse, FET, copper) for 10 A continuous**, and the user docs say so.

**Input current is what sizes the fuse and the input path:**

| Vin | Board only | + steppers | Everything |
|---|---|---|---|
| **12 V** (minimum) | 1.4 A | 3.4 A | **7.4 A** |
| **24 V** | 0.7 A | 1.7 A | 3.7 A |
| **28 V** (abs max) | 0.6 A | 1.5 A | 3.2 A |

#### Input range narrowed to 12–30 V (was 7–30 V)

At 7 V a fully loaded board would have drawn **12.7 A** — past the 10 A
screw terminal and past any sane trace width. The 7 V lower bound served
no documented use case: battery operation is Mini-only by locked
decision, and no standard prop supply is 7–9 V. **Raising the floor to
12 V halves every current in the design for free** — FET dissipation,
fuse rating, trace width, connector stress.

**24 V was considered as a hard requirement and rejected.** It would
halve currents again (3.7 A worst case), but 12 V is deeply entrenched
in this hobby — LED strips, fog machines, solenoids, car-battery setups
— and requiring a new PSU is a real adoption tax for a modest
engineering convenience. Support both; recommend 24 V.

**User-facing guidance to ship:** *"12–24 V DC, absolute maximum 28 V.
**Match the supply to your lights: the 6 switch/dim channels output
your input voltage**, so a 12 V supply gives 12 V channels (what most
prop lighting wants) and 24 V gives 24 V. Choose 24 V only if steppers
or DC motors dominate — same power at half the current, and TMC drivers
give noticeably better torque at speed. Mixed voltages are supported:
feed those loads from their own supply, bring only the switched return
to the channel terminal, and tie the grounds."*

That coupling is a **consequence of the 2026-09-04 decision to put the
switch channels on `VIN_PROT`** instead of +5 V — the right trade (5 V
channels were near-useless for 12 V prop lighting), but it makes the
supply choice a lighting decision as well as a motor one. See
`sheets/03-outputs.md` for the full reasoning and the mixed-voltage
recipe.

#### Ceiling lowered 30 V → 28 V (2026-09-03)

Nothing on the board uses more than 24 V, and the recommended stepper
driver cannot take 30: the **TMC2209's operating range ends at 29 V**,
and `VIN_PROT` feeds the sockets directly, so the old 30 V spec put a
socketed driver at its limit with zero margin. 28 V clears the TMC2209
with a volt in hand while still covering a real 24 V supply's unloaded
excursions (+5 % regulation ≈ 25.2 V) and motor back-EMF on the shared
rail. **28 V is a damage threshold, not an operating point** — no
common supply or motor is 28 V nominal.

**Hardware unchanged by design.** The protection parts keep their old
margins (SMAJ33A TVS, 100 V input ceramics, 63 V bulk): re-sourcing a
finished sheet to save ~$0.10 was not worth it, and the headroom buys a
graceful failure — 30 V applied anyway kills a socketed $1 driver, not
the power section. The barrel jack (DC-044A, 30 V rated) now carries
2 V of margin over the stated max instead of zero.

#### Fuse: blade holder, not a PPTC

A 30 V-rated 3 A-hold SMD PPTC does not exist (§ sheets/01) — voltage
and hold current trade against each other in PPTC chemistry, and
Littelfuse's largest 33 V part is 1.85 A hold. **Use a PCB-mount ATO/ATC
mini blade fuse holder.**

| Blade fuse | @ 7 V | @ 12 V | @ 24 V |
|---|---|---|---|
| 5 A | 35 W | 60 W | 120 W |
| **7.5 A** | 52 W | **90 W** | **180 W** |
| 10 A | 70 W | 120 W | 240 W |

**Ship 7.5 A.** It covers the full 89 W worst case at 12 V, sits under
the 10 A terminal rating, and — the reason it suits v0.1 — **the value
is a field decision, not a design commitment.** Measure real current at
bring-up and swap the fuse; users can size it to their own load. That
is the §2.6 patchability principle applied to protection.

Note what a fuse does *not* do: it is slow (a 7.5 A blade takes seconds
at 15 A), so it protects **wiring and connectors against a sustained
short**, not the FET or the regulator against a fast fault. Those are
covered by the AP64350's cycle-by-cycle current limit and thermal
shutdown, and by sizing Q1 to survive fault current until the fuse
clears.

---

## 3. Mini board — "PropMesh Mini"

**MCU:** ESP32-C3-MINI-1U-N4 · **Target size:** ~50 × 40 mm · **2-layer** · **Battery powered**

### 3.1 GPIO allocation

The C3 has ~13 usable pins. This map only closes because audio lives in flash instead of on SD.

| Function | Pin | Notes |
|---|---|---|
| Analog sensor in | GPIO 0 | ADC1 |
| Battery voltage sense | GPIO 1 | ADC1, 1 MΩ divider + FET disconnect |
| 5 V rail load-switch enable | GPIO 2 | **Strapping pin — ACTIVE-LOW enable.** The pull-up keeps the strap high at boot *and* the rail off in deep sleep with the pin simply released — no GPIO hold, so the wake-reset strap is never violated. Firmware drives it LOW to power the rail. |
| IR receiver | GPIO 3 | RMT RX. RTC-capable — can wake from deep sleep |
| Digital input 1 | GPIO 4 | **RTC-capable — the deep-sleep wake input.** The PIR goes here. |
| I²S LRCLK | GPIO 5 | |
| I²S DOUT | GPIO 6 | |
| WS2812 data out | GPIO 7 | RMT TX, through 74AHCT1G125 |
| I²C SDA | GPIO 8 | **Strapping pin** — I²C pull-up holds it high at boot ✓ |
| Boot button | GPIO 9 | Strapping pin |
| I²C SCL | GPIO 10 | To PCA9685 + Qwiic |
| USB D− / D+ | GPIO 18, 19 | Console over native USB Serial/JTAG |
| I²S BCLK | GPIO 20 | U0RXD repurposed |
| Digital input 2 | GPIO 21 | U0TXD repurposed — ROM boot log drives it at reset; 1 kΩ series resistor |

**Why digital input 1 lives on GPIO 4:** the C3 only wakes from deep sleep on GPIO 0–5. With both digital inputs on 20/21 the "PIR wake, months of runtime" mode would be impossible — nothing could wake the chip. I²S doesn't care which pins it uses, so BCLK takes GPIO 20 instead.

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
| Deep sleep, PIR wake on GPIO 4 (5 V rail switched off) | MCU 5 µA + boost EN low 1 µA + LDO 1 µA | ~15 µA | **months** |

**Critical:** without the 5 V load switch, WS2812 quiescent current (~0.7–1 mA per pixel) drops sleep runtime from months to about six days. This part is not optional.

**Solar:** 6 V / 1 W panel through a Schottky into TP4056 VIN yields ~5 Wh/day in good sun. Fully sustains a trigger-mode prop; meaningfully extends an always-on one. A CN3065 is the better-engineered alternative if you want proper solar charge behavior for ~$0.30 more.

### 3.5 Schematic-capture checklist

- [ ] **Rail enable is ACTIVE-LOW on GPIO 2** — pull-up, firmware drives low to power the rail. Never flip this back to active-high: it either violates the GPIO 2 strap on wake (pin held low through the reset) or leaves the rail on through sleep (pin released high) — both fatal to the sleep story.
- [ ] **1 kΩ series on GPIO 21** (digital input 2) — ROM boot log drives U0TXD at reset against whatever sensor is attached.
- [ ] **PIR / wake sensor input is GPIO 4** — the only deep-sleep-wake-capable digital input; silkscreen it as the wake input.
- [ ] **Cap the 5 V rail at ~1.2 A continuous** — the JST-PH battery input is rated 2 A, and the boost pulls roughly 1.5 W from the cell per watt delivered at 5 V. Document the cap; strips beyond ~30 px get external power with data-only from the board.

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
| Pro | ~392 | ~153 | $0.67 | **$2.65** |
| Mini | ~230 | ~35 | $0.39 | $0.61 |

On the Pro, **through-hole labor costs 4× the entire SMT placement** despite being under a third of the joints. The drivers are 13 screw terminals, 6 servo headers, and 3 relays.

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

**One part at risk in this BOM:** the WS2812B-mini status LED. (The TSOP38238 IR receiver was the other, until it left the Pro BOM on 2026-09-05 — a receiver inside a hidden enclosure can't see a remote; plug-in IR goes on a `DIGITAL_IN`.) If the LED is flagged, the ~$148 assembly subtotal becomes roughly $100 in feeder fees plus a $25 setup on top of the joints — **near double**. *Status (open item #2):* the part is pinned — WS2812B-MINI-X2 `C4154873` (Extended, 20 k stock). The parts API does not expose the "Standard Only" attribute, and v0.1 is hand-populated, so the flag is moot until a PCBA run: **verify it in the JLCPCB order UI before the first assembly order.** If flagged, fall back to a THT 5 mm WS2812 on the same net.

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
- **Named prop profiles** — canned sequencing for common builds. First: **fogger** (mist pulse timing, fan pre-purge and ramp curves, light sync — see §2.8). Fog-chiller builders obsess over fan-vs-mist timing; a profile that sequences it well is a selling point no relay box has.


---

## 5.5 Landscape (surveyed 2026-09-02)

**Incumbent prop controllers are single-node, wired-trigger boxes.**
PicoBoo / BooBox (FrightIdeas) is the industry standard — one PIR in,
two relays out, sequenced audio, a decade of field reliability. EFX-TEK
Prop-1/2 and Gilderfluke cover the hobby and theme-park ends.
**Octobanger** is the open-source analog (Arduino 8-channel sequencer +
PC app) and its users are the natural early adopters here.

**Adjacent, not competing:** xLights/Vixen with Falcon/Kulp sACN
controllers (the pixel world PropMesh *joins* via sACN input), WLED
(ESP32 LED nodes syncing over WiFi — nearest shipping "yard of nodes"
story, but LED-only and router-dependent), Falcon Player.

**The gap:** nothing productized is battery-powered, mesh-synchronized,
and multi-actuator. Existing ESP-NOW Halloween builds are one-off
trigger broadcasts with no time sync. **PicoBoo coordinates a prop;
PropMesh coordinates a yard** — that is the positioning, and it is
additive to what haunters already own rather than a replacement.

**Do not compete on single-prop simplicity.** A PicoBoo is the right
answer for one prop and one sensor, and it will stay that way.

Reference for firmware: **ESPNowMeshClock** (Hemisphere-Project) is a
mature ESP-NOW mesh-time library for show control — compare against
`pm_time.h` before the winter firmware push.
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

Revised 2026-09-01: **Halloween 2026 is a full-season field test on
prototype hardware; Halloween 2027 is the launch.** A yard of props
running for a month is both the best possible shakedown and the launch
content. The old plan's beta window was one August; this plan's is an
entire October plus a relaxed 2027.

| When | Milestone |
|---|---|
| **Sep 2026, wk 1–2** | **Pro v0.1 only** — schematic + layout in KiCad, close the open verification items (CLAUDE.md), order by ~Sep 12: bare 4-layer boards + LCSC/Digi-Key parts, hand-populate 2–3 (fastest path; no PCBA queue) |
| **Sep 2026, wk 3–4** | Boards + parts arrive. Bring-up: rails unloaded → loaded → MCU → one subsystem at a time (§2.6 staged links) |
| **~Oct 10, 2026** | **Rev-B decision point.** Bodge-able → run it. Fatal flaw → one expedited quick-turn shot, or fall back to devkits + perf board for this year's show. No mid-October redesigns |
| **Oct 2026** | **Field season.** The yard show runs on the prototype. Keep a bring-up defect log — it is the v0.2 to-do list. Decorating is the test |
| **Nov–Dec 2026** | **Mini v0.1** design + spin (second KiCad project benefits from the first). Pro v0.2 fixes from the defect log. Mesh firmware on devkits per software plan |
| **Jan–Feb 2027** | v0.2 spin of both boards, panelized, Economic PCBA at 25–30 pcs (§4.6 lever) |
| **Mar–Apr 2027** | Real JLCPCB quote at qty 100. E1.31 / xLights integration |
| **May–Jun 2027** | Beta boards to haunters — months earlier than the old plan. Docs, GitHub publish |
| **Jul–Aug 2027** | **Promote.** This is when the display community researches next season's builds. 2026 field-season footage is the material |
| **Sep 2027** | Tindie listing live, fulfill |
| **Oct 2027** | Decorate. Do not design. |

**Ship a v0.1 that only does LEDs, relay, and sensor input if you have to.** That is still a useful prop controller, it gets a full field season of feedback, and it de-risks the harder subsystems.
