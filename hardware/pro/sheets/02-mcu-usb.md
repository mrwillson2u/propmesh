# Sheet 02 — MCU + USB

**Everything needed to draw this sheet is in this file.**

**Nets on this sheet** (exact pinmap names): `BOOT_BUTTON` (GPIO 0),
`USB_DM` (GPIO 19), `USB_DP` (GPIO 20). Plus `+3V3`, `+5V`, `VBUS`.
Every other GPIO leaves this sheet as a hierarchical label named
exactly as in `pinmap.yaml` — this sheet owns the module symbol, the
other sheets own the circuits.

## Module

| Part | Symbol | Criteria |
|---|---|---|
| ESP32-S3-WROOM-1U-**N8R2** | `RF_Module:ESP32-S3-WROOM-1U` | The suffix is load-bearing: **N8R2 = quad PSRAM**, which keeps GPIO 33–37 usable (open item #1). An R8/R16 substitute silently breaks the pin map. U = U.FL connector **on the module itself** — the BOM's "U.FL antenna + pigtail" is a boxed accessory, not a board part; nothing to place. ⚠ verify the N8R2 variant's LCSC number and stock — LCSC lists a dozen WROOM-1 variants and the wrong one passes every visual check. |

Support (none of this is a BOM line — it's all "passives"):

- **Decoupling at the 3V3 pin: 10 µF + 100 nF**, as close as routing allows.
- **EN reset RC: 10 kΩ pull-up to 3V3 + 1 µF to GND** — Espressif's
  required power-on-reset delay. Reset button pulls EN to GND (the cap
  doubles as its debounce).
- **Boot button: GPIO 0 → button → GND, 10 kΩ pull-up to 3V3.**
- GPIO 3 (`IR_RX`) is strapping (JTAG select) but safe as an input with
  its internal pulldown — nothing to add here; the IR circuit lives on
  sheet 07.
- **Test points on GPIO 35, 36, 37** — the only unallocated pins.
  Label silkscreen `TP35/36/37`.

## USB

| Part | Criteria |
|---|---|
| USB-C receptacle, 16-pin | **USB 2.0-only 16-pin type** (not 24-pin full-featured). De-facto JLC part: HRO **TYPE-C-31-M-12** (⚠ verify LCSC C165948). The footprint must match the exact vendor part — USB-C mechanicals are not interchangeable. |
| USBLC6-2SC6 | ESD, on D+/D− and VBUS, next to the connector. |

Support:

- **2× 5.1 kΩ, CC1 and CC2 to GND** — without these a USB-C host or
  charger never enables VBUS. The #1 forgotten USB-C component.
- **Schottky (SS34-class) VBUS → +5V rail** — a USB cable alone boots
  the board during bring-up; the diode blocks backfeed into the laptop
  when bench power is connected.
- D+/D− route directly to GPIO 19/20 — the S3's USB needs no external
  series resistors or pull-ups.

## Checklist before calling this sheet done

- [ ] EN RC present; boot button pulled up
- [ ] CC pulldowns present
- [ ] VBUS Schottky present
- [ ] All off-sheet GPIO labeled exactly per pinmap.yaml
- [ ] TP35–37 placed
