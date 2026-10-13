# Schematic changes from the 2026-09-16 datasheet review

**One document for this whole job.** Every change, every value, every
footprint, and the exact part of each sheet it touches. The connection
specs (`sheets/*.net.yaml`) already describe the finished result, so the
checker goes green sheet by sheet as you finish each one.

Decisions behind it (answered by Colin 2026-09-16, reasoning in
`datasheet-review-2026-09-16.md`): **1A** smaller strip bulk caps plus a
USB-power link, **2A** 2.2 kΩ 1206 sensor resistors, **3B** a second
PCA9685 for the DC channels, **OE yes** — both PCAs' output-enable on
GPIO 37, **4B** 40 V output FETs. Plus the fixes the review proved: SD pull-ups, USB series
resistors and VBUS cap, pulldowns on the level-shifter inputs.

| Sheet (file) | What changes | Why |
|---|---|---|
| 08 Test Points | `R53` fitted as 10 k | GPIO 3 has no internal pull; the shifter input must not float |
| 07 Sensor Expansion | `R40`, `R47`, `R52` → 2.2 k in 1206 | a 24 V miswire no longer burns them |
| 05 LEDs | `C43`, `C45` → 220 µF 6.3 mm; + 4 pulldowns | buck starts cleanly; shifter inputs defined at reset |
| 04 Audio | card DAT1/DAT2 get 10 k pull-ups | Espressif requires all four DAT lines pulled up |
| 02 MCU and USB | USB-power link header, VBUS cap, 2 × 22 Ω + 2 DNP caps, `TP1` → `PCA_OE` | opt-in USB power; Espressif and ST guidance; GPIO 37 becomes OE |
| 03 Outputs | second PCA9685 + support; DC channel labels move to it; both OE pins on `PCA_OE`; `Q1`–`Q6` Value → `SI2356DS` | flicker-free dimming; outputs off during MCU reset; the input TVS can finally protect the output FETs |

## Status — ✅ COMPLETE (Fri 2 Oct 2026, 23:00)

All six sections drawn. All eight sheet checkers `ALL NETS MATCH, footprints
OK`; ERC 0 errors, 0 warnings. (`R53` ended up on sheet 05 beside the other
four pulldowns; the specs were moved to match.)

Parts cost: **+$3.53 per board at 100** — $1.84 second PCA9685, $1.49
six 40 V FETs, cents for the rest. Every part number below was checked against JLCPCB's parts
API on 2026-09-16.

---

## Moves you'll use (KiCad 10 schematic editor)

| To | Do |
|---|---|
| Open a sheet | the **Hierarchy Navigator** panel on the left → click the sheet name (or double-click the sheet's box on the root sheet) |
| Add a part | press **A** (Add Symbol) → type the symbol name in the search box → pick the exact entry → OK → click to drop |
| Set Value / Footprint | **double-click** the part → *Symbol Properties* → edit the **Value** row and the **Footprint** row (paste the full name, e.g. `Resistor_SMD:R_0603_1608Metric`) → OK |
| Mark a part not fitted | double-click → *Symbol Properties* → tick **Do not populate** (untick to fit it) |
| Wire | press **W** (Draw Wires), click at a pin end, click at the other end |
| Global label | **Add Global Label** (Place menu; hotkey shown beside it), type the text exactly, click so its point touches a pin end or wire |
| Power symbol | press **P** (Add Power) → `+3V3` or `GND` |
| No-connect flag | press **Q** (Add No Connect Flag), click on the pin end |
| Move | hover the item, press **M**, move, click |
| Delete | click the item (wire, flag, symbol), press **Delete** |

**Lines beginning "Part:" are nothing to do in KiCad.** They record which
physical component to buy — manufacturer part number, LCSC code, rating —
so the order can be placed later. In the schematic you only ever set
**Value** and **Footprint**; the LCSC codes live in the sheet specs
(`sheets/*.net.yaml`) and Claude builds the parts order from those.

**Two rules that matter here.** A global label connects to every other
global label with the *same text* on every sheet, so you never have to
draw a wire across the page to reach a net. And a label or wire only
connects when it touches the **end** of a pin; if a small square stays
visible at the pin end, it isn't connected.

After each sheet: **Cmd+S**, then run that sheet's checker (the command
is at the end of each section). It says `ALL NETS MATCH` when the sheet
is done.

---

## 1. Sheet 08 — Test Points (1 minute)

1. Find **`R53`** (Value `DNP`), right of centre near the `LED_STRIP_1_CLK` label.
2. Double-click it → **Value** `10k` → **untick Do not populate** → OK.

Check: `python3 tools/checknet.py hardware/pro/sheets/08-testpoints.net.yaml`

## 2. Sheet 07 — Sensor Expansion (2 minutes)

The three 1 k resistors in series with the digital inputs are **`R40`**,
**`R47`** and **`R52`** (each sits between a sensor connector and its
BAT54S clamp). For each one:

1. Double-click → **Value** `2.2k`
2. **Footprint** `Resistor_SMD:R_1206_3216Metric` → OK.

Part: UNI-ROYAL 1206W4F2201T5E, LCSC `C17948`, 0.25 W.

Check: `python3 tools/checknet.py hardware/pro/sheets/07-sensors-expansion.net.yaml`

## 3. Sheet 05 — LEDs (10 minutes)

**a. The two bulk capacitors.** `C43` and `C45` (Value `1000u/16V`, right
side of the sheet). For each:

1. Double-click → **Value** `220u/16V`
2. **Footprint** `Capacitor_THT:CP_Radial_D6.3mm_P2.50mm` → OK.

Part: Rubycon 16YXJ220M6.3X11, LCSC `C88757`.

**b. Four input pulldowns.** Each pulls one of `U11`'s inputs to ground.
Place them in any free space left of `U11`. For each of the four label
texts below:

1. **A** → `Device:R` → drop it. **Value** `10k`, **Footprint**
   `Resistor_SMD:R_0603_1608Metric`.
2. **Add Global Label** on its top pin with the text from the table.
3. **P** → `GND` on its bottom pin.

| Resistor | Global label text on its top pin |
|---|---|
| 1st | `LED_STRIP_1_DATA` |
| 2nd | `LED_STRIP_2_DATA` |
| 3rd | `LED_STRIP_2_CLK` |
| 4th | `STATUS_LED` |

Not `LED_STRIP_1_CLK`: that one's pulldown is `R53` (step 1). *(Colin drew `R53` on this sheet beside the other four — fine; the specs follow, 2026-10-02.)*
Part: 10 k 0603, LCSC `C25804` (Basic).

Check: `python3 tools/checknet.py hardware/pro/sheets/05-led.net.yaml`

## 4. Sheet 04 — Audio (5 minutes)

The microSD socket **`Card1`** (bottom of the sheet) has two no-connect
flags on its pins **`DAT1(RSV)`** and **`DAT2(RSV)`** (on its left side).

1. Click each of those two **X** flags → **Delete**.
2. Add two resistors like the existing card pull-ups `R31`–`R33`:
   **A** → `Device:R`, **Value** `10k`, **Footprint**
   `Resistor_SMD:R_0603_1608Metric`.
3. Wire one resistor's lower pin to the `DAT1(RSV)` pin and the other's
   to `DAT2(RSV)`; put **P** → `+3V3` on both upper pins.

Check: `python3 tools/checknet.py hardware/pro/sheets/04-audio.net.yaml`

## 5. Sheet 02 — MCU and USB (15 minutes)

**a. USB-power link.** Diode **`D1`** (SS34) stands vertically near the USB
connector, with a `VBUS` label on its bottom pin and the **`+5V`** power
symbol sitting directly on its top pin.

1. Hover the `+5V` symbol on top of `D1`, press **M**, move it up about
   10 mm, click.
2. **A** → `Connector_Generic:Conn_01x02` → drop it between `D1` and the
   `+5V` symbol. **Value** `JP_USB`, **Footprint**
   `Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical`.
3. **W**: `D1`'s top pin → `JP_USB` **pin 2**. `JP_USB` **pin 1** → the
   `+5V` symbol.

Same pin convention as `J48`–`J50`: pin 1 rail side, pin 2 source side.
Part: header LCSC `C124375`. The shunt is **not fitted** by default; see
"USB bench power" at the end.

**b. VBUS capacitor at the ESD chip.** `U1` is the USBLC6-2SC6.

1. **A** → `Device:C`, **Value** `100n`, **Footprint**
   `Capacitor_SMD:C_0603_1608Metric`. Place it beside `U1`.
2. **Add Global Label** `VBUS` on its top pin; **P** → `GND` on its bottom pin.

Part: LCSC `C14663` (Basic).

**c. USB series resistors.** The connector and the ESD chip are joined to
the module by global labels `USB_DM` and `USB_DP`. Rename the six on the
**connector/ESD side**, and leave the two at the module (`U2`) alone.

1. Double-click each label below → change its text → OK:

   | Where | Now | Change to |
   |---|---|---|
   | at `J1` (USB connector), upper | `USB_DM` | `USB_DM_CONN` |
   | at `J1`, lower | `USB_DP` | `USB_DP_CONN` |
   | left of `U1` | `USB_DM` | `USB_DM_CONN` |
   | right of `U1` | `USB_DM` | `USB_DM_CONN` |
   | left of `U1` | `USB_DP` | `USB_DP_CONN` |
   | right of `U1` | `USB_DP` | `USB_DP_CONN` |

2. Add two resistors (**Value** `22R`, **Footprint**
   `Resistor_SMD:R_0603_1608Metric`, LCSC `C23345`, Basic), anywhere free
   near the module:
   - first: **Global Label** `USB_DM_CONN` on one pin, `USB_DM` on the other
   - second: `USB_DP_CONN` on one pin, `USB_DP` on the other
3. Add two capacitors (**Value** `DNP`, **Footprint**
   `Capacitor_SMD:C_0603_1608Metric`, **tick Do not populate**):
   - first: **Global Label** `USB_DM` on the top pin, **P** → `GND` on the bottom
   - second: `USB_DP` on the top pin, `GND` on the bottom

**d. GPIO 37 becomes `PCA_OE`.** Test point **`TP1`** (Value `TP37`) is
wired to the module's `IO37` pin, right of `U2`.

1. Double-click `TP1` → **Value** `PCA_OE` → OK.
2. **Add Global Label** `PCA_OE` on the wire between `IO37` and `TP1` (if `TP1`'s pin sits directly on the `IO37` pin with no wire, put the label's point on that shared pin end).

Check: `python3 tools/checknet.py hardware/pro/sheets/02-mcu-usb.net.yaml`

## 6. Sheet 03 — Outputs — **finish from where you are** (20 minutes)

`U12` is the second PCA9685 you placed, on the right of the sheet. Its
power, decoupling, I²C, and the six `LED_1`–`LED_6` labels on its LED0–LED5
pins are **already right**. What is left, in order:

**a. Delete the copied stepper label (this is the one ERC error).**
`U12` pin 22 (LED15) carries a copied `STEPPER_EN_RAW` label — only `U4`
drives stepper enable, and two outputs are now shorted together.

1. Click that label on `U12` pin 22 → **Delete**. If a wire stub stays on
   the pin, click it → **Delete**.

**b. Delete the two copied I²C pull-ups.** The board has exactly one pair
(`R5`/`R6`). Click **`R59`** (4.7 k) → **Delete**; same for **`R61`**
(4.7 k). Delete any wire or `+3V3` symbol left dangling where they were.

**c. Rename five strap labels — `A…` to `B…`.** Right now `U12`'s address
pins share `U4`'s nets, so both chips would answer at 0x40. Each label
below sits on the wire between one of `U12`'s address pins and its own
10 k resistor. Double-click each → change the text → OK:

| The label sitting over | Now reads | Change to |
|---|---|---|
| `R55` | `A1_STRAP` | `B1_STRAP` |
| `R56` | `A2_STRAP` | `B2_STRAP` |
| `R57` | `A3_STRAP` | `B3_STRAP` |
| `R58` | `A4_STRAP` | `B4_STRAP` |
| `R60` | `A5_STRAP` | `B5_STRAP` |

Leave the five labels of the same name on `U4`'s side (over `R7`–`R12`,
left of the sheet) exactly as they are.

**d. The A0 strap — ✅ already done** (verified in your file, 29 Sep).
`R54` is it: one end on `+3V3`, the other on `U12` pin 1 (A0). That high
strap is exactly what makes this chip 0x41 instead of 0x40. Nothing to
change.

*Optional, for readability only:* the net has KiCad's automatic name
`Net-(U12-A0)`. If you want it to read like the others, **Add Label**
`B0_STRAP` on the wire between `R54` and `U12` pin 1. The checker passes
either way.

**e. Wire the output-enable net, `PCA_OE`.**

*What it is, in one line:* `~OE` is each PCA9685's **output enable**. The
bar over the name means **active low** — hold it LOW and the outputs
work; let it go HIGH and every output on that chip switches off. Both
chips are currently drawn with `~OE` tied straight to ground, which means
"outputs always live", including while the ESP32 is in reset or hung —
that's how a relay could stay energised after a crash. We want the
opposite default: a 10 k resistor (`R54`) pulling `~OE` HIGH so outputs
are off, and GPIO 37 driving it LOW once the firmware has set the chips
up. GPIO 37 joins this net when you do sheet 02 step d.

*What's drawn now:* both `~OE` pins go to GND, and no pull-up exists
yet. On the **left-hand side** of each chip, two pins sit
one above the other — **`EXTCLK` (pin 25)** on top and **`~OE` (pin 23)
just below it** — and both run to one shared **GND** symbol.
`EXTCLK` must stay on GND. Only `~OE` changes.

*Do this, on `U4` first and then identically on `U12`:*

1. Zoom into the left side of the chip until you can read `EXTCLK` and
   `~OE`.
2. Click the short **wire between the `~OE` pin and the GND symbol** —
   the lower of the two wires — and press **Delete**. Leave the `EXTCLK`
   wire and the GND symbol alone. (If clicking selects the GND symbol
   instead of the wire, click on a spot midway along the wire.)
3. **Place → Add Global Label**, type **`PCA_OE`**, and click so the
   label's pointed end touches the now-free **`~OE`** pin end. Check the
   small square at the pin end disappears — that means it's connected.

*Then the pull-up.* This needs a **new** resistor — `R54` is the A0
strap (step d) and every other 10 k on the sheet is already a strap:

4. **A** → `Device:R` → drop it in free space between the two chips.
   **Value** `10k`, **Footprint** `Resistor_SMD:R_0603_1608Metric`.
   (Annotate later gives it the next free number, probably `R62`.)
5. **Place → Add Global Label**, `PCA_OE`, on **one** of its two pins —
   either one, a resistor has no polarity.
6. Press **P** → **`+3V3`** → place it on the **other** pin.

Three things now carry the name `PCA_OE` — `U4` pin 23, `U12` pin 23 and
one end of the new resistor — and because global labels join up by name, they are
one net without any wire drawn between them.

**f. No-connect flags.** Press **Q** and click each empty pin:
`U4` **pins 12, 13, 15, 16, 17, 18** (LED6–LED11, vacated when the DC
channels moved) and `U12` **pins 12, 13, 15, 16, 17, 18, 19, 20, 21, 22**
(LED6–LED15).

**g. The six output FETs → 40 V — ✅ already done** (verified 29 Sep).
`Q1`–`Q6` on this sheet already read `SI2356DS`; the only `AO3400A` left
in the project is `Q8` on the motors sheet, which is correct and stays.

Check: `python3 tools/checknet.py hardware/pro/sheets/03-outputs.net.yaml`

## 7. Finish

1. **Cmd+S.**
2. **Tools → Annotate Schematic…** → choose **Keep existing
   annotations** → **Annotate**. New parts get the next free numbers;
   nothing existing is renumbered.
3. **Inspect → Electrical Rules Checker** → **Run ERC**. Expect 0 errors.
4. All eight checkers, from the repo root:

   ```
   for f in hardware/pro/sheets/0*.net.yaml; do python3 tools/checknet.py "$f" | tail -2 | head -1; done
   ```

   Expect `ALL NETS MATCH` eight times.
5. Tell me, and I'll re-run ERC, the checkers and the merged-net check
   independently before the board update.
6. PCB editor → **F8** (Update PCB from Schematic). New footprints
   arrive in a heap; `C43`, `C45`, `R40`, `R47`, `R52` swap footprint in
   place.

## Where the new parts go on the board

| Part | Put it | Why |
|---|---|---|
| Second PCA9685 + its 100 n (at pin 28) + 10 µ | beside the DC output column (`Q1`–`Q6`, left edge) | its six gate traces stay short |
| Its six address straps | beside it | rework target if a Qwiic device wants 0x41 |
| `PCA_OE` pull-up | near either PCA | |
| `R_USB` 22 Ω × 2 + DNP caps × 2 | at the module's USB pins (13/14), in the pair's path, caps on the module side | Espressif: series R near the MCU |
| VBUS 100 n | at `U1` pin 5 | ST: at the protector |
| `JP_USB` | beside `D1` near the USB connector, reachable with the lid off | it is a bench switch |
| DAT1/DAT2 pull-ups | beside `R31`–`R33` at the card | |
| Four pulldowns | at `U11`'s inputs | |
| `C43`, `C45` (now 6.3 mm) | same place as before, at `J38`/`J39` | |

## USB bench power (what `JP_USB` means in use)

- **Normal use, DC supply connected:** shunt **off**. USB is data only;
  the board runs from the DC input.
- **Bench, USB only, no DC supply:** fit the shunt on `JP_USB` **and pull
  the shunt off `J49`** (JP_5V). USB then feeds the +5V rail but is kept
  away from the 5 V buck's output; with `J49` still fitted, USB would
  back-feed through the buck into the input side.
- Relays and strips on USB power are out of scope: coil pull-in and the
  shifter's 4.5 V minimum are not guaranteed at USB voltage after `D1`.
