# Sheet 02 — MCU + USB

**Everything needed to draw this sheet is in this file.** All parts are
sourced with verified LCSC numbers (2026-09-03); nothing is left to look
up.

## ⚠ The finding that reshaped this sheet (2026-09-03)

**GPIO 33 and 34 do not exist on the WROOM-1 module — any variant.**
Espressif's pin-definition table (DS v1.8) goes IO0…IO21, then jumps to
IO35; 33/34 are consumed internally and never bonded to a castellation.
The pinmap had MOTOR_B on them. **MOTOR_B_IN1/IN2 moved to GPIO 35/36**
(pinmap.yaml updated + headers regenerated), which spends two of the
three spare pins: **IO37 is now the board's only spare** → test point
TP37.

The old open item asked whether 33/34 survive the octal-PSRAM variants.
The real rule: **IO35/36/37 are the octal-PSRAM casualties** — free on
**N8R2** (quad), gone on R8/R16V. With MOTOR_B now living on 35/36,
**the module variant is load-bearing twice over. Order exactly
ESP32-S3-WROOM-1U-N8R2.**

**Alternatives considered after the 33/34 finding (2026-09-03) — keep
the WROOM-1U.** WROOM-**2** is the trap "upgrade": octal-only, so
IO35–37 are gone on every variant. MINI-1U gains nothing and its
under-body pads fight hand assembly. Classic WROOM-32 has no native
USB. P4 has no radio. The S3-WROOM-1 is the most GPIO available in a
hand-solderable WiFi module, and the pin squeeze's relief valve is the
I²C bus (second PCA9685 / MCP23017 at zero extra pins), not a bigger
module.

## Nets and labels

**Cross-sheet GPIO travel by GLOBAL label** (Ctrl+L), spelled **exactly**
as in `pinmap.yaml` — the checker verifies every name against the
netlist. (The earlier draft said hierarchical labels; global is
deliberate: sheets connect by name with no root-sheet wiring, same as
the power rails, and the label text becomes machine-checkable.)

- Power symbols (`P`): `+3V3`, `+5V`, `GND` — already exist from sheet 01.
- **PWR_FLAG on `VBUS`** — it is sourced by a connector, which ERC can't see.
- This sheet's own names: `USB_DM`, `USB_DP`, `BOOT_BUTTON` + the 32
  fan-out labels (list = the yaml's `named:` block).
- **Expect ERC "global label only appears once" warnings** on fan-out
  labels until sheets 03–07 consume them. That is the natural state of
  a half-drawn board, not an error.
- **No-connect flags (`Q` key) on SBU1, SBU2** — the only intentionally
  unconnected pins.

## Connections — see `02-mcu-usb.net.yaml`

**Open `02-mcu-usb.diagram.html` in a browser — that is the drawing
guide.** Three blocks: USB chain, module core, GPIO fan-out. After
capture the same yaml is the checker and writes `02-mcu-usb.check.html`:

```
python3 tools/checknet.py hardware/pro/sheets/02-mcu-usb.net.yaml
```

**KiCad pin-name gotchas on the module symbol** (the netlist speaks
these names, and so does the yaml): GPIO19 = `USB_D-`, GPIO20 =
`USB_D+`, GPIO43 = `TXD0` (carries `STEPPER_2_DIAG`), GPIO44 = `RXD0`
(carries `MOTOR_A_IN1`).

## Module

| Ref | Part | LCSC | Note |
|---|---|---|---|
| MCU | **ESP32-S3-WROOM-1U-N8R2** | **`C3013944`** — $4.98/1, $3.69/100, 6.7 k stock, Extended | ✅ verified: exact N8R2 suffix. The PCB-antenna sibling (WROOM-1-N8R2, `C2913204`) is a drop-in with the same land pattern's inner pads if U.FL supply dries up — but 1U + external antenna is the choice for yard range through an enclosure. **Symbol is `RF_Module:ESP32-S3-WROOM-1`** (one symbol serves both antenna variants); **the -1U is the FOOTPRINT**: `RF_Module:ESP32-S3-WROOM-1U`. Both KiCad-official. |

Support at the module (criteria):

- **Decoupling at 3V3: C_VDD1 10 µF (`C95841`, = sheet 01's C_in) +
  C_VDD2 100 nF (`C14663`, = sheet 01's C3)** — tight to the pin.
- **EN reset RC: R_EN 10 kΩ (`C25804`) to +3V3, C_EN 1 µF to GND** —
  Espressif's required power-on-reset delay; SW_RST shorts EN to GND
  and the cap doubles as its debounce. **C_EN is `C15849`, X5R — a
  documented exception to the X7R rule**: a POR delay tolerates any
  0.5–2 µF at any temperature, and Basic has no 1 µF X7R in 0603
  (the X7R choices are 25 V/0603 *Extended* `C29936` or 0805 Basic
  `C28323`; the exception keeps package and Basic).
- **Boot: R_BOOT 10 kΩ to +3V3, SW_BOOT to GND** on `BOOT_BUTTON`.
  **No auto-program transistors** (asked 2026-09-07): the HUZZAH32-style
  DTR/RTS → EN/IO0 pair exists only because a USB-UART bridge chip needs
  a way to reach those pins. The S3's **native USB Serial/JTAG** resets
  into the bootloader by itself when esptool toggles DTR/RTS over CDC —
  PlatformIO does it on every upload, blank board included. The button
  is the recovery path, not the normal one.
- GPIO 3 (`LED_STRIP_1_CLK` — was `IR_RX` until 2026-09-05) is a
  strapping pin (JTAG select) but safe: it drives only a level-shifter
  input on sheet 05, so nothing external can pull it, and the internal
  pulldown holds the default strap at reset — nothing to add on this
  sheet. (Label renamed on the drawn sheet 2026-09-06.)
- **TP37** on IO37 — `Connector:TestPoint`, pad footprint
  `TestPoint:TestPoint_Pad_1.5x1.5mm`, silkscreen `TP37`.

## USB

| Ref | Part | LCSC | Note |
|---|---|---|---|
| J_USB | **HRO TYPE-C-31-M-12**, 16-pin USB2.0-only receptacle | **`C165948`** — $0.19/1, 306 k stock | ✅ verified (closes the sheet's old ⚠). 5 A / 20 V rated. **KiCad ships the vendor-exact footprint** `Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12` — the reason to buy this exact connector; USB-C mechanicals are not interchangeable. Symbol `Connector:USB_C_Receptacle_USB2.0_16P`. |
| U_ESD | **ST USBLC6-2SC6**, SOT-23-6 | **`C7519`** — $0.18/1, 38 k stock | ESD on D±/VBUS beside the connector. Clones exist at a third of the price (`C2687116` etc.); the ST original is chosen because clamping *is* this part's one job — the brand-tier rule's "pay where the spec depends on it" case. |
| D_VBUS | **SS34** Schottky, SMA | **`C8678`** — $0.03, **Basic**, 5.4 M stock | VBUS → +5V. A USB cable alone boots the board at the bench; the diode blocks the bench supply from backfeeding the laptop. ~0.4 V drop leaves ~4.6 V on the rail — fine for the 3V3 buck and bring-up. |
| SW_BOOT, SW_RST | **XKB TS-1187A-B-A-B** tactile | **`C318884`** — $0.02, **Basic**, 884 k stock | KiCad ships the exact footprint: `Button_Switch_SMD:SW_Push_1P1T_XKB_TS-1187A`. Symbol `Switch:SW_Push`. |
| R_CC1, R_CC2 | **5.1 kΩ 1 %** 0603 | **`C23186`** — **Basic** | CC1/CC2 → GND, one each, **never shared**. Without them a USB-C host or charger refuses to enable VBUS — the #1 forgotten USB-C part. |

- **USBLC6 wiring is flow-through**: pins 1 & 6 are the same line
  (`USB_DM`), pins 3 & 4 the same (`USB_DP`) — route in one pad, out
  the other. Pin 5 = VBUS, pin 2 = GND.
- D+/D− go **directly** to `USB_D+`/`USB_D-` — the S3's USB wants no
  series resistors or pull-ups.
- **Shield → GND** at the connector (all four GND pads + SHIELD).

## KiCad symbols to place

| Ref(s) | Symbol to search (`A` key) |
|---|---|
| MCU | `ESP32-S3-WROOM-1` — **the plain -1; there is no -1U symbol.** The 1U-ness is the footprint |
| J_USB | `USB_C_Receptacle_USB2.0_16P` — **not** 14P, not the 24-pin full-featured ones |
| U_ESD | `USBLC6-2SC6` (Power_Protection) |
| D_VBUS | `Device:D_Schottky` |
| SW_BOOT, SW_RST | `Switch:SW_Push` |
| R_EN, R_BOOT, R_CC1, R_CC2 | `Device:R` |
| C_EN, C_VDD1, C_VDD2 | `Device:C` |
| TP37 | `Connector:TestPoint` |

Power symbols with `P`: `+3V3`, `+5V`, `GND`, plus `PWR_FLAG` on VBUS.
Everything on this sheet uses stock KiCad symbols AND footprints —
import nothing; KiCad-official land patterns are the trusted tier
(unlike easyeda2kicad imports, which must be measured).

## Checklist before calling this sheet done

- [ ] EN RC present; boot button pulled up
- [ ] CC pulldowns present (one per pin)
- [ ] VBUS Schottky present, PWR_FLAG on VBUS
- [ ] USBLC6 wired flow-through (1&6 / 3&4)
- [ ] Every fan-out label spelled per pinmap — `checknet` proves it
- [ ] MOTOR_B on IO35/36 (not 33/34 — they don't exist)
- [ ] STEPPER_2_DIAG on TXD0 pin, MOTOR_A_IN1 on RXD0 pin
- [ ] No-connects on SBU1/SBU2; TP37 placed
- [ ] `checknet` all green, then ERC

## Sourcing status

**Complete — nothing left to look up.** 12 orderable part numbers, 14
placements. Rolled up (§2.4): **$5.53 @ qty 1, $4.11 @ qty 100** — the
spec's $3.72 estimate was $0.39 light, almost entirely the module
($3.69 real vs $3.40 guessed). Shared with sheet 01: `C25804`,
`C95841`, `C14663` add no new part numbers to the board.
