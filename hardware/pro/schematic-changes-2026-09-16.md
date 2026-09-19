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

Not `LED_STRIP_1_CLK`: that one's pulldown is `R53`, done in step 1.
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

## 6. Sheet 03 — Outputs (25 minutes)

The existing PCA9685 is **`U4`**. The new one gets the six DC output
channels; `U4` keeps the servos, relays and stepper enable.

> **If you copied `U4`'s block to make the new chip** (found 2026-09-19):
> copies of `U4`'s labels came with it. Delete the copied
> `STEPPER_EN_RAW` label from the **new chip's pin 22 (LED15)** — that is
> ERC's "Output and Output connected" error — and delete the copied
> **4.7 k** I²C pull-up. Only `U4` drives stepper enable, and the board
> has exactly one I²C pull-up pair.

**a. Place the second PCA9685** in an empty area of the sheet.

1. **A** → `Driver_LED:PCA9685PW`. **Value** `PCA9685PW`, **Footprint**
   `Package_SO:TSSOP-28_4.4x9.7mm_P0.65mm`. Part LCSC `C2678753`.
2. Power: **VDD** (pin 28) → **P** `+3V3`. **VSS** (pin 14) → `GND`.
   **EXTCLK** (pin 25) → `GND`.
3. Decoupling beside it, copying `U4`'s `C5`/`C4`: a `Device:C` **Value**
   `100n`, **Footprint** `Capacitor_SMD:C_0603_1608Metric`; and a
   `Device:C` **Value** `10u/16V`, **Footprint**
   `Capacitor_SMD:C_0805_2012Metric` (LCSC `C95841`). Each between
   `+3V3` and `GND`.
4. I²C: **Global Label** `I2C_SDA` on its **SDA** pin (27), `I2C_SCL` on
   **SCL** (26).

**b. Address 0x41.** Six `Device:R`, **Value** `10k`, **Footprint**
`Resistor_SMD:R_0603_1608Metric`, one on each address pin, the same way
`U4`'s straps `R7`–`R12` are drawn:

| Pin | Other end of its 10 k |
|---|---|
| **A0** (pin 1) | **`+3V3`** ← the only difference from `U4` |
| A1 (2), A2 (3), A3 (4), A4 (5), A5 (24) | `GND` |

**c. Output-enable for both chips.**

1. On **`U4`**, find the **~OE** pin (pin 23). It is connected to `GND`.
   Click the wire at the pin → **Delete**. If a `GND` symbol sits
   directly on the pin instead, **M** it away and **Delete** it.
2. **Global Label** `PCA_OE` on `U4`'s ~OE pin, and another `PCA_OE`
   on the new PCA's **~OE** pin (23).
3. One more `Device:R` **Value** `10k`, 0603: **Global Label** `PCA_OE` on
   one pin, **P** → `+3V3` on the other. This pull-up keeps every output
   off until the firmware is ready.

**d. Move the six DC-channel labels.** On `U4`'s right side, local labels
**`LED_1`** to **`LED_6`** sit on pins **LED6** to **LED11**. Move each to
the new chip:

| Label | From `U4` pin | To new PCA pin |
|---|---|---|
| `LED_1` | LED6 | **LED0** |
| `LED_2` | LED7 | **LED1** |
| `LED_3` | LED8 | **LED2** |
| `LED_4` | LED9 | **LED3** |
| `LED_5` | LED10 | **LED4** |
| `LED_6` | LED11 | **LED5** |

For each: hover the label, **M**, move its point onto the new pin end,
click. If a leftover wire stub stays on `U4`, click it → **Delete**.

**e. No-connect flags.** **Q** on every pin now left empty: `U4`
**LED6–LED11**, and the new chip's **LED6–LED15**.

**f. The six output FETs → 40 V.** `Q1`–`Q6` (Value `AO3400A`, one beside
each DC output terminal; **not** `Q8` on the motors sheet). For each:

1. Double-click → **Value** `SI2356DS` → OK.

That's all: **keep the symbol and footprint**. The `AO3400A` symbol has
the same pin numbers as the Vishay part (1 = G, 2 = S, 3 = D, checked
against Vishay's datasheet 2026-09-16), so there's no Change Symbol step
and no risk of the pin-mismatch bug from sheet 01. Part: Vishay
SI2356DS-T1-GE3, LCSC `C74127`.

Check: `python3 tools/checknet.py hardware/pro/sheets/03-outputs.net.yaml`

---

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
