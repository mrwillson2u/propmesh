# PropMesh Pro — component and datasheet review, 2026-09-16

**Conclusion:** the basic component choices and most local support circuits are
reasonable, but the board is not ready to route unchanged. The largest problems
are interactions between otherwise plausible circuits: USB feeding the whole
5 V rail, large downstream capacitors loading both regulators, protection that
does not match semiconductor voltage limits, and a shared PWM frequency.

This review covers every fitted IC type (U1–U11), the principal power/switching
discretes, relays, status pixel, recommended TMC2209 carrier interface, and their
supporting parts. It compares manufacturer documentation with the saved KiCad
netlist and PCB, not just the drawing guides. It complements the
[routing audit](review-2026-09-16.md). Mini has no implemented PCB to inspect.

**Only review documentation changed.** Proposed component additions and placement
changes below have not been applied to the schematic, PCB, or connection YAML.
An omission against a manufacturer recommendation is distinguished from a
predicted failure; startup, stability, EMC and thermal performance need physical
validation. Alternate StepStick modules, every connector's mechanics, and exact
capacitor bias curves are not universally certified by this review.

## Findings to resolve before routing

### 1. USB powers over 2,000 µF and all 5 V loads without controlled inrush

**Confirmed topology; high priority.** D1 connects VBUS directly to +5V through
an SS34. C43 and C45 are each 1,000 µF on that rail, alongside the amplifier,
servo and strip connections and the 3.3 V regulator. Removing J49 isolates the
5 V buck output, but leaves both large capacitors connected to USB.

D1 provides reverse blocking toward the host; it does not limit charging current
or enforce the available USB current. Firmware keeping outputs off does not
remove capacitor inrush. A passive pair of CC pulldowns also does not by itself
establish permission to draw arbitrary load current. TI describes the USB
attachment capacitance limit and controlled charging in its
[USB Type-C inrush explanation](https://www.ti.com/document-viewer/lit/html/SSZTB15/GUID-9C081873-D60C-462A-ABFB-9A4E87F564F0)
and [USB power-switch application note](https://www.ti.com/lit/an/slva129/slva129.pdf).

**Action:** define a USB bench-power path with controlled inrush/current and an
explicit load budget, preferably separating logic from servo/strip power. Also
check the buck's behavior when USB drives its output with VIN absent; no separate
reverse-blocking element is present in that path. Treat USB-only operation as a
distinct operating mode: the SS34 drop can also put the AHCT buffer below its
4.5 V recommended supply minimum at low host voltage.

### 2. Regulator calculations omitted capacitors elsewhere on their rails

**Confirmed omission; startup/stability risk requires validation.** With J49
closed, the 5 V buck sees C9+C10 = 44 µF, C43+C45 = 2,000 µF, C15+C28 = 20 µF,
and three 100 nF bypasses: approximately **2,064.3 µF nominal**, before external
loads. The [AP64350 datasheet](https://www.diodes.com/datasheet/download/AP64350.pdf)
specifies typical 2 ms soft start and 4.25/5/5.75 A minimum/typical/maximum
high-side peak current limit. Charging that nominal capacitance to 4.96 V in
2 ms requires **5.12 A average**, before normal loads and inductor ripple.

This calculation flags possible current limiting, delayed startup or hiccup; it
does not prove startup failure, since capacitance, ESR and actual ramp behavior
matter. The existing 14 kΩ / 3.3 nF / 47 pF compensation also needs evaluation
with this complete load network. Reusing a 44 µF reference design does not
validate the additional 2 mF. Consider staged charging of strip bulk and evaluate
loop response across load, VIN and capacitor tolerance.

The 3.3 V side similarly has **82.6 µF nominal**: C16 = 22 µF, six 10 µF caps
(C3/C4/C34/C36/C38/C40), and six 100 nF caps. This excludes capacitance inside
the module/card and attached peripherals. The
[TLV62569 datasheet, §8.2.2.4](https://www.ti.com/lit/ds/symlink/tlv62569.pdf)
describes 10–47 µF output capacitance. Its local 2.2 µH/22 µF combination is
reasonable, but the assembled rail needs a stability/transient check. Bias
derating may reduce the effective total; it is not evidence of a guaranteed
failure or a reason to remove necessary local decoupling blindly.

The exact PSA and Chinocera catalog PDFs establish nominal ratings, but do not
substantiate the sheet's numerical DC-bias retention estimates for these exact
parts. Obtain curves or measurements before relying on those estimates.

### 3. The input TVS does not protect the lowest-voltage semiconductors

**Confirmed ratings mismatch; high priority.** D9's
[BORN SMAJ33A datasheet](https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/1912111437_BORN-SMAJ33A_C383696.pdf)
gives 33 V stand-off, 36.7–40.6 V breakdown, and 53.3 V maximum clamp at its
specified pulse current. Compare these with:

| Exposed device | Relevant limit | Consequence |
|---|---|---|
| Q1–Q6 AO3400A | 30 V VDS absolute maximum | Particularly little margin at the declared 28 V ceiling; an off output can see the supply through its load |
| TMC2209 | 29 V operating; 32 V inductive-load absolute maximum, 33 V bridge maximum | Input TVS does not constrain VM to these limits |
| U5 AP64350 | VIN 42 V DC / 45 V for 400 ms; EN 42 V absolute maximum | High-voltage capacitors alone do not protect the regulator |
| U7/U8 DRV8871 | 50 V VM absolute maximum | Specified TVS clamp can exceed this too |

Sources: [AO3400A](https://aosmd.com/res/data_sheets/AO3400A.pdf),
[TMC2209 §19–20](https://www.analog.com/media/en/technical-documentation/data-sheets/TMC2209_datasheet_rev1.09.pdf),
[AP64350](https://www.diodes.com/datasheet/download/AP64350.pdf),
[DRV8871](https://www.ti.com/lit/ds/symlink/drv8871.pdf).

**Action:** coordinate operating voltage, overshoot, flyback/regen energy and
clamping or overvoltage cutoff against the weakest device. A lower nominal TVS
voltage cannot be selected safely from its name alone: maximum clamp, source
impedance and pulse energy matter. Higher-rated output FETs alone would leave
the TMC problem. Q7 is reverse-polarity protection, not a surge limiter; its
on-state VDS is not the entire positive rail surge.

### 4. Two microSD pull-ups are missing

**Confirmed manufacturer-guidance omission.** Card1 pin 8 (DAT1) and pin 1
(DAT2) are no-connects. Only CMD, DAT0 and DAT3 have 10 kΩ pull-ups.
[Espressif's ESP32-S3 SD guidance](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/sd_pullup_requirements.html)
requires 10 kΩ on CMD and DAT0–DAT3, including unused lines in 1-bit mode.

**Action:** add two 10 kΩ pull-ups to +3V3 at the socket and remove those two
no-connect flags. No additional MCU GPIO is needed. Update the connection YAML
when implementing the schematic change. The earlier claim that DAT1/DAT2 should
simply be left disconnected is superseded.

### 5. USB support footprints are missing

**Confirmed omissions against recommended implementations.**
[Espressif's USB checklist](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/schematic-checklist.html#usb)
recommends reserving 22/33 Ω series-resistor positions near the MCU and optional
shunt-capacitor positions. Sheet 02's assertion that the S3 wants no series
resistors is incorrect. This is a recommendation, not proof the direct
connection cannot enumerate.

[ST USBLC6-2, Figure 17](https://www.st.com/resource/en/datasheet/usblc6-2.pdf)
shows 100 nF from VBUS to ground beside the protector. The saved VBUS net joins
J1, D1 and U1 pin 5, with no bypass capacitor. Add this small capacitor directly
at U1 and retain a very short ground return. It does not resolve finding 1.
The flow-through signal pin mapping and separate 5.1 kΩ CC pulldowns are correct.

### 6. One PCA9685 means one PWM frequency for servos and dimming

**Confirmed architectural constraint.** All 16 channels share one prescaler:
[PCA9685 datasheet, general description and PRE_SCALE](https://www.nxp.com/docs/en/data-sheet/PCA9685.pdf).
Six servos and six dimmed DC channels occupy that same device. Selecting
approximately 50 Hz for ordinary hobby servos also gives the lighting outputs
approximately 50 Hz PWM, which can cause visible or camera flicker. Programming
a faster lighting frequency changes the servo frame rate too.

**Action:** explicitly accept that limitation for v0.1, or provide an independent
PWM resource if smooth higher-frequency lighting is required. This new
constraint qualifies the original PCA choice; it does not require removing the
PCA or dropping channels. Relays and stepper enable should use true full-on/off
register settings, not narrow recurring pulses.

Separately, OE is grounded. Resetting only the ESP32 does not reset the still
powered PCA's registers: relay, lighting and stepper-enable states can persist.
If outputs must release on MCU reset/hang, reserve a hardware disable mechanism
with defined defaults; firmware initialization alone is not that mechanism.

### 7. Motor-driver heating is substantially underestimated

**Confirmed calculation error.** The DRV8871 typical high-side plus low-side
resistance at 25 °C is 0.565 Ω. At 2 A RMS, conduction alone is
**I²R = 2.26 W per driver**, rather than the layout guide's approximately 1 W.
Resistance and loss increase as the die heats. Switching adds loss.

R_ILIM = 30 kΩ is a valid selection, but 2.13 A is nominal trip current, not a
guaranteed continuous rating. With the datasheet's 59–69 kV ILIM constant and
1% resistance, the limit spans approximately **1.95–2.32 A**. The
[DRV8871 thermal and layout guidance](https://www.ti.com/lit/ds/symlink/drv8871.pdf)
requires useful copper area and thermal paths, not just vias under the package.

**Action:** plan top ground spreading, package-appropriate thermal vias and
substantial bottom ground beneath both drivers. The sparse-bottom preference
must allow this copper. Validate simultaneous operation in the intended enclosure
and ambient; do not derive a board current rating from the trip setting.

TMC2209 carrier ratings also need qualification. Its §20.1 gives 1.4 A RMS as a
continuous design guideline and 2 A with limited duty, rather than a universal
2 A continuous promise. Actual carrier construction and cooling determine the
usable rating. The spec's statement that the motor is always the bottleneck is
too strong.

### 8. The AHCT buffer's used inputs lack defined hardware defaults

**Confirmed schematic gap.** U11's five used inputs come directly from MCU GPIO;
the only optional external bias is R53, DNP, on GPIO3. Both OE pins are grounded.
Unused inputs are correctly grounded. Used inputs can be high impedance during
reset/startup; GPIO3 specifically has no internal pull.

The [SN74AHCT541 datasheet](https://www.ti.com/lit/ds/symlink/sn74ahct541.pdf)
requires defined CMOS input levels. Add appropriate default pulls on all five
signals and populate R53, respecting GPIO3's strap function. OE gating can
suppress outputs but does not by itself eliminate floating input current.

The AHCT family is otherwise an appropriate 3.3-to-5 V choice. Keep C42 at its
VCC pin and the 330 Ω series resistors at the driver. For long APA102 cables,
validate clock rate versus cable capacitance and resistor-induced edge slowing;
330 Ω is not a universal high-speed cable solution.

### 9. Relay pull-in margin is weak on USB power

**Conditional operating-mode risk.** The
[HK4100F manufacturer sheet](https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/2406241551_Ningbo-Keke-New-Era-Appliance-HK4100F-DC5V-SHG_C12072.pdf)
specifies the 0.2 W 5 V coil as 125 Ω / 40 mA and a maximum pull-in threshold of
75% rated voltage at 20 °C. The
[ULN2003A](https://www.ti.com/lit/ds/symlink/uln2003a.pdf)
adds Darlington voltage drop; its often-quoted saturation numbers are measured
at stated collector/base currents, not a universal 1 V drop.

At approximately 4.6 V after D1, coil voltage can approach the 3.75 V pull-in
threshold after the driver drop. Lower USB voltage and hot coils reduce margin
further. Test minimum rail voltage and temperature if USB relay operation is
intended; otherwise specify logic-only USB bring-up. A lower-drop sink is an
option if that operating mode is required. COM to +5V is correct.

The contact rating does not establish an equal inductive-load switching rating;
external loads switched by dry contacts need appropriate suppression. The
existing NO/NC physical continuity check remains open; this review did not
resolve the imported footprint's throw numbering with a physical relay.

### 10. Sensor clamp protection is narrower than the prose claims

**Confirmed limitation, dependent on the required fault envelope.** The saved
1 kΩ-before-BAT54S topology is now correct. However, assuming a 3.6 V clamped
node gives roughly 1.4 mA at 5 V, 8.4 mA at 12 V, and **20.4 mA / 0.416 W in
the resistor at 24 V**. That last dissipation exceeds the ordinary 0603 rating.

The [BAT54S datasheet](https://www.diodes.com/datasheet/download/BAT54S.pdf)
also shows forward voltage varies with current: the clamp is not a precision
3.6 V ceiling. The upper diode injects into +3V3, which is not guaranteed to
sink current; external drive with the board off can back-power it. Replace the
blanket claim that miswires cause no harm with a specified powered/unpowered
fault envelope, and design stronger protection if sustained 12/24 V faults are
required. Check GPIO voltage limits across clamp-current and temperature.

The 100 kΩ/100 kΩ analog dividers and 100 nF caps suit slow 0–5 V sensors:
their Thevenin RC is 5 ms (about 31.8 Hz). They are not a general 24 V input
front end. GPIO45/46 expansion pulldowns define an open-header state, but cannot
override an attached peripheral actively driving a strap high during reset.

### 11. Motor bulk capacitor suitability is not established by voltage rating

C18/C19/C20/C22 use the 100 µF/63 V KNSCHA 189RV0028. Its
[manufacturer table](https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/2309071524_KNSCHA-189RV0028_C7471890.pdf)
lists **135 mA ripple at 105 °C / 120 Hz**, with no specified high-frequency
ESR maximum in that row. This is not evidence that a 2 A motor needs a 2 A
ripple-rated capacitor, but it is also not enough to certify this part for the
actual PWM/regen waveform. Derive capacitor RMS current and heating, including
frequency correction, wiring impedance and local ceramics. Select documented
high-ripple parts if the calculation requires them. Lifetime must use capacitor
core temperature, not ambient alone.

L1 and L2 have ample nominal current headroom. The actual
[SXN catalog](https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/2108131730_SXN-Shun-Xiang-Nuo-Elec-SMMS1050-6R8M_C149542.pdf)
lists L1 SMMS1050-6R8M as 20.6 mΩ typical / **28 mΩ maximum**, 12 A typical
saturation and 8 A temperature-rise current. The old 25 mΩ / 13 A claim belongs
to a different row. L2 SMMS0650-2R2M is 11.2/12.5 mΩ, 12.5 A saturation and
11 A temperature-rise current. The correction does not imply either needs
replacement; L1's 3 A DC copper loss is about 0.252 W at its maximum room-
temperature DCR, before AC and temperature effects.

### 12. Placement instructions need package-specific and circuit-specific fixes

Distances are saved-board pad-center separations, not prescribed maximum trace
lengths. They identify places where routing around the current arrangement
would create unnecessarily large loops.

| Circuit | Current evidence | Placement recommendation |
|---|---|---|
| U5 5 V buck | SW–L1 10.84 mm; BST–C6 11.25 mm; L1–C9/C10 21.61/19.55 mm | Rebuild the compact input hot loop, bootstrap loop and output/filter arrangement; keep FB/COMP away from SW |
| U6 3.3 V buck | SW–L2 7.80 mm; L2–C16 13.13 mm; FB divider over 20 mm from FB | Bring LC and feedback parts around U6; sense quiet output beyond the inductor |
| U2 module | C2 100 nF 7.83 mm away; C3 10 µF 5.29 mm | Move both toward VDD/ground entry, prioritizing the small bypass loop |
| U7/U8 motor drivers | C21/C23 ceramics 6.79 mm from VM | Put ceramic VM/GND loops at the drivers, bulk nearby, and keep motor current out of logic/analog returns |
| Stepper sockets | C18/C19 30.90/30.50 mm from VMOT | Move bulk to each socket's power pair; retain a short return and carrier-local ceramic bypass |
| U9 amplifier | 100 nF C29 about 4.6–5.1 mm from VDD pads | Put C29 closest, with C28 nearby; keep BTL output current paths compact |
| U10 DAC | Supply 100 nF caps approximately 4.7–5.9 mm away, often farther than their 10 µF partners | Put each small bypass at its own supply pin; keep C24 flying-cap and C27 return loops short; keep clocks and buck SW away from outputs |
| Exposed pads | Proposed 3×3 via grid spans 2.6 mm; U9 pad is only 1.5×1.5 mm | Use each manufacturer's land/paste/thermal guidance and the assembler's via treatment; no universal grid |

Keep a continuous ground reference for USB/I²S/SD and quiet analog routes.
Use the fabricator's actual stackup for the USB geometry, as in
[Espressif's layout guidance](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/pcb-layout-design.html).
Heavier copper recommendations in the AP64350 reference design do not prove
the present 1 oz / 0.5 oz stackup fails, but warrant thermal validation.

The PCM5102A's §12.1 does **not** mandate putting its output RC at the jack.
The 470 Ω / 2.2 nF values are sensible, but place the filter as part of a quiet
DAC-to-jack route, preferably avoiding a long unfiltered trace leaving the DAC.
Any separate connector EMI filtering should follow the actual cable problem.

## Component coverage and configurations that look reasonable

| Component | Datasheet / review result |
|---|---|
| U1 USBLC6-2SC6 | [ST Rev 7](https://www.st.com/resource/en/datasheet/usblc6-2.pdf): pin mapping is correct; add local VBUS bypass and tighten ESD return |
| U2 ESP32-S3-WROOM-1U-N8R2 | [Espressif v1.8](https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf): exact quad-PSRAM variant preserves GPIO35–37; 10 kΩ/1 µF EN network is a reasonable starting point; USB/SD and strap issues above remain |
| U3 ULN2003A | [TI Rev T](https://www.ti.com/lit/ds/symlink/uln2003a.pdf): 3.3 V drive is suitable for these small coils; COM supply connection is correct; assess coil voltage at minimum supply |
| U4 PCA9685PW | [NXP Rev 4](https://www.nxp.com/docs/en/data-sheet/PCA9685.pdf): 3.3 V supply, addressing and bypass are appropriate; shared frequency and OE/reset behavior need explicit acceptance |
| U5 AP64350 | [Diodes Rev 5-2](https://www.diodes.com/datasheet/download/AP64350.pdf): 115 kΩ/22.1 kΩ divider gives about 4.96 V; 200 kΩ RT targets 500 kHz; 100 nF bootstrap present; full-rail startup/loop/protection/placement remain open |
| U6 TLV62569DBV | [TI Rev C](https://www.ti.com/lit/ds/symlink/tlv62569.pdf): 453 kΩ/100 kΩ gives 3.318 V; 6.8 pF feed-forward is consistent with the reference guidance; aggregate capacitance and placement remain open |
| U7/U8 DRV8871DDAR | [TI Rev B](https://www.ti.com/lit/ds/symlink/drv8871.pdf): separate 30 kΩ ILIM networks and input-off defaults are correct; continuous thermal rating remains unproven |
| U9 MAX98357A | [ADI Rev 16](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX98357A-MAX98357B.pdf): GAIN grounded selects 12 dB; 620 kΩ SD_MODE pull-up gives mono with useful tolerance margin; 10 µF + 100 nF present; EP grounding appropriate |
| U10 PCM5102A | [TI Rev C](https://www.ti.com/lit/ds/symlink/pcm5102a.pdf): SCK grounded enables BCK PLL use; I²S/format straps, 2.2 µF charge-pump pair, four supply bypass pairs and separate LDOO net are consistent with the reference circuit |
| U11 SN74AHCT541 | [TI Rev Q](https://www.ti.com/lit/ds/symlink/sn74ahct541.pdf): suitable level translation; unused inputs grounded and 100 nF present; define used-input reset levels |
| Q1–Q6/Q8 AO3400A | [AOS](https://aosmd.com/res/data_sheets/AO3400A.pdf): low-voltage gate drive is supported; 48 mΩ maximum at 2.5 V gives 0.192 W at 2 A before hot-resistance increase; Q1–Q6 voltage headroom is the main concern |
| Q7 AOD4185 + D8 | [AOS Rev 4.2](https://aosmd.com/res/data_sheets/AOD4185.pdf): reverse-polarity orientation and 10 V gate clamp are reasonable; assess copper at aggregate current. Q7's KiCad datasheet field points to another manufacturer's part and should be corrected. Exact D8 supplier/tolerance not independently closed in this pass |
| D1/D2–D7 SS34 | [MDD](https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/2407101107_MDD-Microdiode-Semiconductor-SS34_C8678.pdf): USB blocking and load-flyback polarities are correct; 3 A nameplate does not establish thermal capacity for every sustained flyback duty |
| D9 SMAJ33A | [BORN](https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/1912111437_BORN-SMAJ33A_C383696.pdf): present clamp level is not coordinated with semiconductor limits |
| K1–K3 HK4100F | [Huike](https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/2406241551_Ningbo-Keke-New-Era-Appliance-HK4100F-DC5V-SHG_C12072.pdf): 0.2 W coil selection supported; minimum-voltage pull-in and physical NO/NC check remain |
| LED1 WS2812B-MINI-X2 | [Worldsemi V1.0](https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/2307201512_Worldsemi-WS2812B-MINI-X2_C4154873.pdf): DIN/VDD/DOUT/GND = 1/2/3/4; AHCT output addresses VIH = 0.65×VDD; retain bypass and configure reset low time above 280 µs |
| FB1/FB2 BLM21PG221SN1D | [Murata](https://www.murata.com/products/productdata/8796738977822/ENFA0005.pdf): 2 A at 85 °C, derated to 1.25 A at 125 °C; 0.09 Ω maximum DCR. Reasonable against 0.87 A RMS for 3 W/4 Ω, subject to temperature and EMI validation |
| Stepper interface | [TMC2209](https://www.analog.com/media/en/technical-documentation/data-sheets/TMC2209_datasheet_rev1.09.pdf) and [Watterott carrier](https://learn.watterott.com/silentstepstick/pinconfig/tmc2209/): 3.3 V VIO, distinct addresses and 1 kΩ TX isolation are appropriate; exact carrier UART solder bridges and auxiliary DIAG location must be specified |
| D12–D14 BAT54S | [Diodes](https://www.diodes.com/datasheet/download/BAT54S.pdf): series-pair pin mapping and resistor-before-clamp are correct; see fault-envelope limits above |
| L1/L2 and regulator capacitors | [SXN](https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/2108131730_SXN-Shun-Xiang-Nuo-Elec-SMMS1050-6R8M_C149542.pdf), [PSA](https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/2209061730_PSA-Prosperity-Dielectrics-FS32X106K101EGG_C5156756.pdf), [Chinocera](https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/2403201122_Chinocera-HGC1206R7226K160NSPJ_C7472972.pdf), [KNSCHA](https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/2309071524_KNSCHA-189RV0028_C7471890.pdf): nominal choices plausible; corrected inductor ratings, missing exact bias curves and motor ripple qualification above |

Additional audio checks: the 620 kΩ ±1% resistor with 92–108 kΩ internal
pulldown yields approximately 0.384–0.539 V over a conservative 3.0–3.6 V logic
supply range, inside the guaranteed mono selection window. Share an I²S format
and sample rate supported by both DAC and amp (for example, stereo I²S at
48 kHz / 64 BCLKs per frame). Keep both speaker terminals isolated from ground;
the 100 pF/ferrite network still needs testing with the intended speaker cable.
ADI recommends a speaker with sufficient inductance for filterless operation.

PCM5102A XSMT is permanently pulled high. TI describes early muting during
power-down to reduce pops. If pop-free shutdown matters, add controllable mute
or supply-fall detection; a pull-up cannot anticipate loss of power.

## Corrections to earlier reviews and next checks

- Existing ERC and connection checks pass because they check the specified
  circuit; they cannot detect missing requirements such as DAT1/DAT2 pull-ups.
- Increasing L from 5.5 to 6.8 µH lowers the ideal LC resonance by about 10%,
  rather than raising it as stated in the September 8 review. That resonance
  alone is not a stability proof for a current-mode regulator.
- Power-on output defaults do not establish behavior after a separate MCU reset.
- A high capacitor voltage rating does not establish surge protection for ICs.
- Mechanical socket spacing, fabrication drill limits, courtyard overlaps and
  the unresolved VIN_FUSED netclass remain as reported in the routing audit.

Before routing, resolve findings 1–8 at schematic/requirements level, then
re-place the power and bypass circuits. Before manufacturing, verify regulator
startup/load transients with all bulk attached; USB attach and power sequencing;
motor/relay operation at minimum voltage and maximum ambient; motor regen and
input overshoot; SD operation across cards; audio pops/noise; and intended cable
lengths. These are targeted checks arising from the findings, not completed tests.

Review evidence used the fresh XML netlist and measurements from
`/tmp/propmesh-audit-HDpp59/`, with downloaded manufacturer PDFs/text in
`/tmp/propmesh-datasheets-20260916/`. Those temporary paths are session evidence;
the durable citations are linked above. Board/settings hashes are recorded in
the routing audit. No new electrical ERC/DRC run was needed for this documentation-
only pass; the previous clean ERC does not close these datasheet findings.

---

## Disposition (Claude, 2026-09-16 — every claim re-checked against the saved netlist and the manufacturers' documents)

**Verdict on the review:** technically sound. Every topology claim I could
test matches the current netlist (D1 VBUS→+5V, C43/C45 on +5V, DAT1/DAT2
NC, U4 OE grounded, U11 inputs unpulled, R40/R47/R52 0603). Its main
weakness is tone: predicted defects and "go validate" items are mixed at
the same volume. Sorted:

| # | Finding | Verified? | Disposition |
|---|---|---|---|
| 4 | SD DAT1/DAT2 pull-ups | ✅ Espressif page says all four DAT lines "regardless of whether these lines are connected" | **DO** — 2 × 10 k, no GPIO. Sheet 04 doc corrected |
| 5 | USB series-R positions + VBUS 100 nF at U1 | ✅ Espressif checklist + ST Fig. 17 | **DO** — 2 × 0 Ω 0603 fitted, 100 nF. Sheet 02 doc corrected |
| 8 | AHCT inputs float at reset | ✅ no pulls on any of the 5 | **DO** — populate `R53` and add 10 k pulldowns on the other four (strip data held low at boot is a feature) |
| 3 | TVS 53 V clamp vs 30 V `Q1–Q6` | ✅ SMAJ33A clamps 53 V; AO3400A 30 V | **DO** — swap `Q1–Q6` (and `Q8`) to a **60 V SOT-23 N-FET**; there is no TVS that passes 24 V and clamps under 30 V, so the FET rating is the only lever. TMC2209 keeps its own limit — StepSticks at 24 V are the ecosystem norm. Needs sourcing |
| 10 | 1 kΩ clamp resistor at 24 V = 0.42 W | ✅ arithmetic | **DECIDE** — 2.2 kΩ 1206 (recommended) or document 5–12 V ports. Sheet 07 doc corrected |
| 1+2 | USB charges 2 mF; buck starts into 2 mF | ✅ AP64350 DS §7: peak limit 4.25 A min, **hiccup after 512 cycles at limit, restart after 8192** — 2 mF at 2 ms soft-start needs ≈5 A, so it *will* hiccup-start | **DECIDE** — recommended: **C43/C45 → 220 µF/16 V** (hot-plug protection for the strips kept; startup demand ÷ 4.5; USB inrush ÷ 4.5). Plus a **link header in D1's path** so USB power to the rail is opt-in, and "USB = logic only" in the docs (also settles #9 relay pull-in and the AHCT 4.5 V minimum) |
| 6 | One PCA9685 = one PWM frequency | ✅ `U4` drives `SERVO_1–6` and `LED_1–6` | **DECIDE** — v0.1: run the PCA at 50 Hz, accept flicker on dimmed DC channels (they are relays-with-dimming, not lighting). v0.2: second PCA9685 (I²C, no GPIO — the spec's own relief valve). **OE**: the only spare GPIO (37) is the right price for "outputs off while the MCU is in reset" — decide whether TP37 becomes `PCA_OE` |
| 7 | DRV8871 loss 2.3 W not 1 W | ✅ 0.565 Ω typ | **DOC** — layout B3 corrected; spec to rate 1.5 A continuous / 2 A peak until measured |
| 11 | Bulk-cap ripple, L1 DCR row | ✅ | **DOC** — L1 figures corrected; motor-cap ripple = bring-up measurement |
| 12 | Placement distances | ✅ (the packer's output; Colin is hand-placing) | already in progress |
| — | `U9` pad too small for a 3 × 3 via grid (routing audit §3) | ✅ 1.5 × 1.5 mm | **DOC** — A22 corrected: one via |
| — | `VIN_FUSED` not in HighCurrent (routing audit §2) | ✅ `VIN_*` cannot match `/Power/VIN_FUSED` | **DO (Colin, 1 min)** — Board Setup → Design Rules → Net Classes → *Netclass Assignments* → add a row, Pattern `/Power/VIN_FUSED`, Net Class `HighCurrent`. `checksetup.py` now requires it |
| — | Socket rows 12.75 not 12.70 (routing audit §4) | ✅ **my grid snap did this** — 12.70 is not on a 0.25 grid | **FIXED 2026-09-16**: `J20`/`J22` moved back to 12.70; `checksetup.py` now measures it; lock the four rows |
| — | USB pair geometry 0.2/0.25 in Default (routing audit §6) | ✅ | **DO (Colin)** — Net Classes → row **Default** → **DP Width** `0.3`, **DP Gap** `0.2`; then verify ≈90 Ω with Inspect → Calculator Tools → Transmission Line (coupled microstrip, h 0.2104, εr 4.4). Checker updated |

### The three decisions, spelled out

Each is one question with a recommended answer. Say A, B or C for each
and the schematic edits follow.

**Decision 1 — the 5 V rail's bulk capacitors and USB power**

*The problem in one sentence:* `C43` and `C45` (1000 µF each) sit on the
same +5V rail that the USB jack feeds through `D1` and that the 5 V buck
`U5` charges at startup; 2 mF is 200× what USB allows to appear on
plug-in, and the buck's own datasheet says it will trip into hiccup
trying to charge it in its 2 ms soft-start.

| Option | What changes | Result |
|---|---|---|
| **A (recommended)** | `C43`, `C45` → **220 µF/16 V** radial (part to be sourced once chosen; a smaller can than the 10 mm 1000 µF, so the footprint changes to match it). Add a **2-pin link header `JP_USB`** in series with `D1` (like `J48`–`J50`), shunt **removed** by default | Buck starts cleanly; the strips still have hot-plug bulk at the terminal; USB never feeds the rail unless you fit the shunt for a bench session; "USB = logic only" becomes true by construction, which also closes the relay-pull-in and AHCT-4.5 V findings |
| B | Keep 1000 µF; add only the `JP_USB` link | USB inrush solved; buck still hiccup-starts into 2 mF from the DC input — it *probably* comes up after a few retries but it is unproven |
| C | Change nothing; document "use a powered hub, expect a slow start" | Zero edits; two known risks carried into bring-up |

*What you give up with A:* nothing measurable — the 1000 µF advice is for
strips fed by a raw supply through long wire, not from a regulated buck
2 cm away.

**Decision 2 — sensor-input series resistors**

*The problem:* with the (now correct) resistor-first order, a 24 V
miswire into a sensor port puts 0.42 W into a 0603 rated 0.1 W.

| Option | What changes | Result |
|---|---|---|
| **A (recommended)** | `R40`, `R47`, `R52` → **2.2 kΩ, 1206** (part to be sourced once chosen; 1206 is rated 0.25 W) | Survives 24 V indefinitely (0.19 W in a 0.25 W part); no effect on the signal — the GPIO side is high-impedance; 9 mA into the 3V3 rail is absorbed by the board's idle load |
| B | Keep 1 kΩ 0603; silkscreen and document the ports as **5–12 V** | Zero edits; a 24 V mistake burns a resistor (a bodge, not a dead board) |

**Decision 3 — the PCA9685's single PWM frequency, and its OE pin**

*The problem:* `U4` drives the six servo headers *and* the six DC output
FETs from one prescaler. Servos want ~50 Hz; at 50 Hz a dimmed DC channel
visibly flickers (and shows on camera). Separately, OE is grounded, so
when the ESP32 resets or hangs the PCA keeps whatever it was last told.

| Option | What changes | Result |
|---|---|---|
| **A (recommended for v0.1)** | Nothing on the board. Firmware runs the PCA at **50 Hz**; DC channels are documented as switch-with-soft-dim, not lighting dimmers. Second PCA9685 goes on the v0.2 list | Zero edits now; flicker-free dimming waits a revision |
| B | Add a **second PCA9685** now (the same verified `C2678753`, with its own I²C address straps, one 100 nF, one 10 µF) and move the six DC channels to it | Servos stay at 50 Hz, lighting runs at 1 kHz+; costs **$1.84 at 100 ($2.87 at 1)** plus a TSSOP-28 and its straps on the board, and a sheet-03 edit while the board is still unrouted — the cheapest it will ever be |
| C | Move the DC channels to ESP32 LEDC | Not available — no free GPIO |

*OE, independent of A/B:* **wire `U4` pin 23 (OE) to GPIO 37** with a
10 k pull-up to +3V3 instead of to GND. OE is active-low: while the MCU
is in reset its pin is high-impedance, the pull-up wins, and with the
PCA's default `OUTNE` setting every output is held **low** — FETs off,
relays off, stepper EN inverter disabling both drivers, servos limp —
until firmware drives OE low. Needs a `pinmap.yaml` entry (`PCA_OE`,
GPIO 37) and regenerated headers. GPIO 37 is
the board's only spare (today it goes to `TP1`). **Recommended: yes** —
"relays and stepper enable persist through an MCU hang" is exactly the
kind of failure a prop can't have, and a test point is a poor use of the
last pin. `TP1` then moves to the OE net.

### Answers (Colin, 2026-09-16) and what was done

**Decision 1: A. Decision 2: A. Decision 3: B. OE on GPIO 37: yes.**
Written into the connection specs (sheets 02, 03, 04, 05, 07, 08),
`pinmap.yaml` (GPIO 37 = `PCA_OE`; two PCA9685 blocks, 0x40 at 50 Hz and
0x41 at 1 kHz) and the regenerated firmware headers, together with the
agreed fixes (SD DAT1/DAT2 pull-ups, USB 22 Ω pair + DNP caps + VBUS
100 nF, shifter input pulldowns with `R53` fitted). Every part number
checked against JLCPCB's parts API. Drawing procedure:
`schematic-changes-2026-09-16.md`. Cost: +$2.04 per board at 100.

Two corrections to what I told you while writing the options:
- **The USB series resistors are 22 Ω, not 0 Ω.** Espressif gives
  22/33 Ω as the *initial value*; I'd written "fit 0 Ω". Their
  recommended unpopulated cap-to-ground positions are added too.
- **2.2 kΩ does affect the digital inputs slightly.** I wrote "no effect
  on the signal"; in fact the series resistor forms a divider with the
  10 k pull-up. A sensor pulling LOW now leaves 0.60 V at the pin (was
  0.30 V) against the ESP32's 0.83 V input-low limit — still valid, but
  a sensor whose output carries its own ~1 kΩ series resistance would
  sit near 0.8 V. If one turns up at bring-up, raise that input's
  pull-up (`R39`/`R48`/`R51`) to 22 k.

### Decision 4 — the output FETs' voltage rating — **answered: B (Colin, 2026-09-16)**

Applied: `Q1`–`Q6` → Vishay **SI2356DS-T1-GE3**, `C74127`. Verified on
Vishay's datasheet (Doc 62893, Rev A): V_DS 40 V; V_GS ±12 V; V_GS(th)
0.6–1.5 V; R_DS(on) max 51 / 54 / **70 mΩ** at V_GS 10 / 4.5 / **2.5 V**
(2 A); SOT-23 pins **1 = G, 2 = S, 3 = D** — identical to KiCad's
`AO3400A` symbol (extends `Q_NMOS_GSD`), so only the Value changes.
**Loss correction:** compared max to max, 2 A costs 0.28 W, up from the
AO3400A's 0.19 W (48 mΩ max at 2.5 V) — not "up from 0.1 W" as first
written; ≈ 50 °C rise at Vishay's 175 °C/W steady-state limit. Cost
+$1.49 per board at 100 (6 × ($0.3155 − $0.0679)). `Q8` stays AO3400A.


*The problem:* the review's finding 3 is right that the input TVS can't
protect the 30 V `AO3400A`s on the six DC outputs: the SMAJ33A only
*starts* conducting at 36.7–40.6 V, which is already above the FETs'
30 V absolute maximum. I had listed "swap to a 60 V SOT-23 FET" as a
free fix. **It isn't:** JLCPCB's catalogue has no 60 V SOT-23 part rated
at a 2.5–3.3 V gate, which is all the PCA9685 provides; the 60 V parts
that carry 2 A are specified at 4.5–10 V gate drive. `Q8`, the stepper
enable inverter, is not affected: its drain only ever sees 3.3 V.

| Option | What changes | Result |
|---|---|---|
| A | Keep `AO3400A` (30 V, 24 mΩ at 2.5 V). Document the input as a regulated 12–24 V supply only; add a bring-up check: scope `VIN_PROT` while hot-plugging the real supply cable | $0. Relies on `C11`'s damping keeping hot-plug overshoot under 30 V — plausible, unproven |
| **B (recommended)** | `Q1`–`Q6` → **Vishay SI2356DS-T1-GE3**, LCSC `C74127`: 40 V, 4.3 A, **70 mΩ at 2.5 V gate**, SOT-23 (same pinout as the AO3400A — to confirm on the datasheet before the swap) | The TVS starts conducting at or below the FET rating, so the protection is finally coordinated. Conduction loss at 2 A roughly 0.2–0.28 W per channel, up from 0.1 W — fine on the pour. +$1.41 per board at 100; 5.2 k in stock (≈ 870 boards' worth) |
| C | A 60 V logic-level FET in a larger package (DFN or SOT-223) | Proper 60 V headroom, but a footprint and layout change — a v0.2 job |

**Not accepted:** the review's reading that the PCM5102A filter "does not
mandate" placing the RC at the jack is true but changes nothing — the
sheet's reason was cable EMI, not TI's mandate. The relay pull-in on
USB (#9) is real only in the USB-only mode we are ruling out.
