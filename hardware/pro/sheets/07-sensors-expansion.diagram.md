# 07-sensors-expansion — wiring diagrams

Generated from `07-sensors-expansion.net.yaml` by `tools/checknet.py --mermaid`. Read each diagram left to right along the signal path. **Boxes are parts, rounded nodes are nets, the label on a line is the pin.** A part's power-rail pins are written inside its box. A multi-unit chip (a quad gate) appears once per unit — one box per triangle, exactly as KiCad places it. Open the `.html` next to this file in any browser to see it rendered.

## Digital in 1 (+ PIR header)

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_DI1_RAW(["DI1_RAW"]):::net
  P_J_DI1["<b>J_DI1</b><br/>DIG_IN<br/><i>pin 1 → +5V</i><br/><i>pin 2 → GND</i>"]:::part
  P_J_DI1 --"3"--> N_DI1_RAW
  P_J_PIR["<b>J_PIR</b><br/>PIR_HDR<br/><i>pin 1 → +5V</i><br/><i>pin 2 → GND</i>"]:::part
  N_DI1_RAW --"3"--> P_J_PIR
  P_R_D1["<b>R_D1</b><br/>2.2k"]:::part
  N_DI1_RAW --"1"--> P_R_D1
  N_DIGITAL_IN_1(["DIGITAL_IN_1"]):::net
  P_R_D1 --"2"--> N_DIGITAL_IN_1
  P_D_C1["<b>D_C1</b><br/>BAT54S<br/><i>pin A → GND</i><br/><i>pin K → +3V3</i>"]:::part
  N_DIGITAL_IN_1 --"COM"--> P_D_C1
  P_R_P1["<b>R_P1</b><br/>10k<br/><i>pin 2 → +3V3</i>"]:::part
  N_DIGITAL_IN_1 --"1"--> P_R_P1
```

| Net | connect every one of these |
|---|---|
| **DI1_RAW** | `J_DI1.3`, `J_PIR.3`, `R_D1.1` |
| **DIGITAL_IN_1** | `R_D1.2`, `D_C1.COM`, `R_P1.1` |

## Digital in 2

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_DI2_RAW(["DI2_RAW"]):::net
  P_J_DI2["<b>J_DI2</b><br/>DIG_IN<br/><i>pin 1 → +5V</i><br/><i>pin 2 → GND</i>"]:::part
  P_J_DI2 --"3"--> N_DI2_RAW
  P_R_D2["<b>R_D2</b><br/>2.2k"]:::part
  N_DI2_RAW --"1"--> P_R_D2
  N_DIGITAL_IN_2(["DIGITAL_IN_2"]):::net
  P_R_D2 --"2"--> N_DIGITAL_IN_2
  P_D_C2["<b>D_C2</b><br/>BAT54S<br/><i>pin A → GND</i><br/><i>pin K → +3V3</i>"]:::part
  N_DIGITAL_IN_2 --"COM"--> P_D_C2
  P_R_P2["<b>R_P2</b><br/>10k<br/><i>pin 2 → +3V3</i>"]:::part
  N_DIGITAL_IN_2 --"1"--> P_R_P2
```

| Net | connect every one of these |
|---|---|
| **DI2_RAW** | `J_DI2.3`, `R_D2.1` |
| **DIGITAL_IN_2** | `R_D2.2`, `D_C2.COM`, `R_P2.1` |

## Digital in 3

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_DI3_RAW(["DI3_RAW"]):::net
  P_J_DI3["<b>J_DI3</b><br/>DIG_IN<br/><i>pin 1 → +5V</i><br/><i>pin 2 → GND</i>"]:::part
  P_J_DI3 --"3"--> N_DI3_RAW
  P_R_D3["<b>R_D3</b><br/>2.2k"]:::part
  N_DI3_RAW --"1"--> P_R_D3
  N_DIGITAL_IN_3(["DIGITAL_IN_3"]):::net
  P_R_D3 --"2"--> N_DIGITAL_IN_3
  P_D_C3["<b>D_C3</b><br/>BAT54S<br/><i>pin A → GND</i><br/><i>pin K → +3V3</i>"]:::part
  N_DIGITAL_IN_3 --"COM"--> P_D_C3
  P_R_P3["<b>R_P3</b><br/>10k<br/><i>pin 2 → +3V3</i>"]:::part
  N_DIGITAL_IN_3 --"1"--> P_R_P3
```

| Net | connect every one of these |
|---|---|
| **DI3_RAW** | `J_DI3.3`, `R_D3.1` |
| **DIGITAL_IN_3** | `R_D3.2`, `D_C3.COM`, `R_P3.1` |

## Analog in 1

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_AN1_RAW(["AN1_RAW"]):::net
  P_J_AN1["<b>J_AN1</b><br/>ANA_IN<br/><i>pin 1 → +5V</i><br/><i>pin 2 → GND</i>"]:::part
  P_J_AN1 --"3"--> N_AN1_RAW
  P_R_A1T["<b>R_A1T</b><br/>100k"]:::part
  N_AN1_RAW --"1"--> P_R_A1T
  N_ANALOG_IN_1(["ANALOG_IN_1"]):::net
  P_R_A1T --"2"--> N_ANALOG_IN_1
  P_R_A1B["<b>R_A1B</b><br/>100k<br/><i>pin 2 → GND</i>"]:::part
  N_ANALOG_IN_1 --"1"--> P_R_A1B
  P_C_AN1["<b>C_AN1</b><br/>100nF<br/><i>pin 2 → GND</i>"]:::part
  N_ANALOG_IN_1 --"1"--> P_C_AN1
```

| Net | connect every one of these |
|---|---|
| **AN1_RAW** | `J_AN1.3`, `R_A1T.1` |
| **ANALOG_IN_1** | `R_A1T.2`, `R_A1B.1`, `C_AN1.1` |

## Analog in 2

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_AN2_RAW(["AN2_RAW"]):::net
  P_J_AN2["<b>J_AN2</b><br/>ANA_IN<br/><i>pin 1 → +5V</i><br/><i>pin 2 → GND</i>"]:::part
  P_J_AN2 --"3"--> N_AN2_RAW
  P_R_A2T["<b>R_A2T</b><br/>100k"]:::part
  N_AN2_RAW --"1"--> P_R_A2T
  N_ANALOG_IN_2(["ANALOG_IN_2"]):::net
  P_R_A2T --"2"--> N_ANALOG_IN_2
  P_R_A2B["<b>R_A2B</b><br/>100k<br/><i>pin 2 → GND</i>"]:::part
  N_ANALOG_IN_2 --"1"--> P_R_A2B
  P_C_AN2["<b>C_AN2</b><br/>100nF<br/><i>pin 2 → GND</i>"]:::part
  N_ANALOG_IN_2 --"1"--> P_C_AN2
```

| Net | connect every one of these |
|---|---|
| **AN2_RAW** | `J_AN2.3`, `R_A2T.1` |
| **ANALOG_IN_2** | `R_A2T.2`, `R_A2B.1`, `C_AN2.1` |

## Qwiic + expansion header

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_I2C_SDA(["I2C_SDA"]):::net
  P_J_QW["<b>J_QW</b><br/>QWIIC<br/><i>pin 1 → GND</i><br/><i>pin 2 → +3V3</i>"]:::part
  P_J_QW --"3"--> N_I2C_SDA
  P_J_EXP["<b>J_EXP</b><br/>EXPANSION<br/><i>pin 2 → +5V</i><br/><i>pin 3 → GND</i><br/><i>pin 10 → GND</i><br/><i>pin 1 → +3V3</i>"]:::part
  N_I2C_SDA --"6"--> P_J_EXP
  N_I2C_SCL(["I2C_SCL"]):::net
  P_J_QW --"4"--> N_I2C_SCL
  P_J_EXP --"7"--> N_I2C_SCL
  N_EXPANSION_1(["EXPANSION_1"]):::net
  P_R_E1S["<b>R_E1S</b><br/>100R"]:::part
  N_EXPANSION_1 --"1"--> P_R_E1S
  P_R_E1P["<b>R_E1P</b><br/>10k<br/><i>pin 2 → GND</i>"]:::part
  N_EXPANSION_1 --"1"--> P_R_E1P
  N_EXP1_HDR(["EXP1_HDR"]):::net
  P_R_E1S --"2"--> N_EXP1_HDR
  P_J_EXP --"4"--> N_EXP1_HDR
  N_EXPANSION_2(["EXPANSION_2"]):::net
  P_R_E2S["<b>R_E2S</b><br/>100R"]:::part
  N_EXPANSION_2 --"1"--> P_R_E2S
  P_R_E2P["<b>R_E2P</b><br/>10k<br/><i>pin 2 → GND</i>"]:::part
  N_EXPANSION_2 --"1"--> P_R_E2P
  N_EXP2_HDR(["EXP2_HDR"]):::net
  P_R_E2S --"2"--> N_EXP2_HDR
  P_J_EXP --"5"--> N_EXP2_HDR
  N_STEPPER_1_DIAG(["STEPPER_1_DIAG"]):::net
  P_J_EXP --"8"--> N_STEPPER_1_DIAG
  N_D2_MID(["D2_MID"]):::net
  P_J_EXP --"9"--> N_D2_MID
```

| Net | connect every one of these |
|---|---|
| **I2C_SDA** | `J_QW.3`, `J_EXP.6` |
| **I2C_SCL** | `J_QW.4`, `J_EXP.7` |
| **EXPANSION_1** | `R_E1S.1`, `R_E1P.1` |
| **EXP1_HDR** | `R_E1S.2`, `J_EXP.4` |
| **EXPANSION_2** | `R_E2S.1`, `R_E2P.1` |
| **EXP2_HDR** | `R_E2S.2`, `J_EXP.5` |
| **STEPPER_1_DIAG** | `J_EXP.8` |
| **D2_MID** | `J_EXP.9` |

## GND

Every pin below goes to the GND symbol:

`J_DI1.2`, `J_DI2.2`, `J_DI3.2`, `J_PIR.2`, `J_AN1.2`, `J_AN2.2`, `D_C1.A`, `D_C2.A`, `D_C3.A`, `R_A1B.2`, `R_A2B.2`, `C_AN1.2`, `C_AN2.2`, `J_QW.1`, `J_EXP.3`, `J_EXP.10`, `R_E1P.2`, `R_E2P.2`

## +5V

Every pin below goes to the +5V symbol:

`J_DI1.1`, `J_DI2.1`, `J_DI3.1`, `J_PIR.1`, `J_AN1.1`, `J_AN2.1`, `J_EXP.2`

## +3V3

Every pin below goes to the +3V3 symbol:

`D_C1.K`, `D_C2.K`, `D_C3.K`, `R_P1.2`, `R_P2.2`, `R_P3.2`, `J_QW.2`, `J_EXP.1`
