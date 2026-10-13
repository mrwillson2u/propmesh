# 06-motors — wiring diagrams

Generated from `06-motors.net.yaml` by `tools/checknet.py --mermaid`. Read each diagram left to right along the signal path. **Boxes are parts, rounded nodes are nets, the label on a line is the pin.** A part's power-rail pins are written inside its box. A multi-unit chip (a quad gate) appears once per unit — one box per triangle, exactly as KiCad places it. Open the `.html` next to this file in any browser to see it rendered.

## Stepper socket 1 — logic row + straps

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_STEPPER_1_STEP(["STEPPER_1_STEP"]):::net
  P_J_S1L["<b>J_S1L</b><br/>SOCKET_1x8"]:::part
  P_J_S1L --"7"--> N_STEPPER_1_STEP
  N_STEPPER_1_DIR(["STEPPER_1_DIR"]):::net
  P_J_S1L --"8"--> N_STEPPER_1_DIR
  N_S1_MS1(["S1_MS1"]):::net
  P_J_S1L --"2"--> N_S1_MS1
  P_JP11["<b>JP11</b><br/>MS_SEL<br/><i>pin 3 → GND</i><br/><i>pin 1 → +3V3</i>"]:::part
  N_S1_MS1 --"2"--> P_JP11
  N_S1_MS2(["S1_MS2"]):::net
  P_J_S1L --"3"--> N_S1_MS2
  P_JP12["<b>JP12</b><br/>MS_SEL<br/><i>pin 3 → GND</i><br/><i>pin 1 → +3V3</i>"]:::part
  N_S1_MS2 --"2"--> P_JP12
  N_S1_MS3(["S1_MS3"]):::net
  P_J_S1L --"4"--> N_S1_MS3
  P_JP13["<b>JP13</b><br/>MS_SEL<br/><i>pin 3 → GND</i><br/><i>pin 1 → +3V3</i>"]:::part
  N_S1_MS3 --"2"--> P_JP13
  N_STEPPER_1_DIAG(["STEPPER_1_DIAG"]):::net
  P_JP_D1["<b>JP_D1</b><br/>SJ"]:::part
  N_STEPPER_1_DIAG --"A"--> P_JP_D1
  N_D1_HDR(["D1_HDR"]):::net
  P_JP_D1 --"B"--> N_D1_HDR
  P_J_DIAG1["<b>J_DIAG1</b><br/>DIAG_AUX<br/><i>pin 2 → GND</i>"]:::part
  N_D1_HDR --"1"--> P_J_DIAG1
```

| Net | connect every one of these |
|---|---|
| **STEPPER_1_STEP** | `J_S1L.7` |
| **STEPPER_1_DIR** | `J_S1L.8` |
| **S1_MS1** | `J_S1L.2`, `JP11.2` |
| **S1_MS2** | `J_S1L.3`, `JP12.2` |
| **S1_MS3** | `J_S1L.4`, `JP13.2` |
| **STEPPER_1_DIAG** | `JP_D1.A` |
| **D1_HDR** | `JP_D1.B`, `J_DIAG1.1` |

## Stepper socket 2 — logic row + straps

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_STEPPER_2_STEP(["STEPPER_2_STEP"]):::net
  P_J_S2L["<b>J_S2L</b><br/>SOCKET_1x8"]:::part
  P_J_S2L --"7"--> N_STEPPER_2_STEP
  N_STEPPER_2_DIR(["STEPPER_2_DIR"]):::net
  P_J_S2L --"8"--> N_STEPPER_2_DIR
  N_S2_MS1(["S2_MS1"]):::net
  P_J_S2L --"2"--> N_S2_MS1
  P_JP21["<b>JP21</b><br/>MS_SEL<br/><i>pin 3 → GND</i><br/><i>pin 1 → +3V3</i>"]:::part
  N_S2_MS1 --"2"--> P_JP21
  N_S2_MS2(["S2_MS2"]):::net
  P_J_S2L --"3"--> N_S2_MS2
  P_JP22["<b>JP22</b><br/>MS_SEL<br/><i>pin 3 → GND</i><br/><i>pin 1 → +3V3</i>"]:::part
  N_S2_MS2 --"2"--> P_JP22
  N_S2_MS3(["S2_MS3"]):::net
  P_J_S2L --"4"--> N_S2_MS3
  P_JP23["<b>JP23</b><br/>MS_SEL<br/><i>pin 3 → GND</i><br/><i>pin 1 → +3V3</i>"]:::part
  N_S2_MS3 --"2"--> P_JP23
  N_STEPPER_2_DIAG(["STEPPER_2_DIAG"]):::net
  P_R_DG2["<b>R_DG2</b><br/>1k"]:::part
  N_STEPPER_2_DIAG --"1"--> P_R_DG2
  N_D2_MID(["D2_MID"]):::net
  P_R_DG2 --"2"--> N_D2_MID
  P_JP_D2["<b>JP_D2</b><br/>SJ"]:::part
  N_D2_MID --"A"--> P_JP_D2
  N_D2_HDR(["D2_HDR"]):::net
  P_JP_D2 --"B"--> N_D2_HDR
  P_J_DIAG2["<b>J_DIAG2</b><br/>DIAG_AUX<br/><i>pin 2 → GND</i>"]:::part
  N_D2_HDR --"1"--> P_J_DIAG2
```

| Net | connect every one of these |
|---|---|
| **STEPPER_2_STEP** | `J_S2L.7` |
| **STEPPER_2_DIR** | `J_S2L.8` |
| **S2_MS1** | `J_S2L.2`, `JP21.2` |
| **S2_MS2** | `J_S2L.3`, `JP22.2` |
| **S2_MS3** | `J_S2L.4`, `JP23.2` |
| **STEPPER_2_DIAG** | `R_DG2.1` |
| **D2_MID** | `R_DG2.2`, `JP_D2.A` |
| **D2_HDR** | `JP_D2.B`, `J_DIAG2.1` |

## Shared: EN inverter + UART bus

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_STEPPER_EN_RAW(["STEPPER_EN_RAW"]):::net
  P_Q_EN["<b>Q_EN</b><br/>AO3400A<br/><i>pin S → GND</i>"]:::part
  P_Q_EN --"G"--> N_STEPPER_EN_RAW
  N_STEPPER_EN(["STEPPER_EN"]):::net
  P_Q_EN --"D"--> N_STEPPER_EN
  P_R_ENP["<b>R_ENP</b><br/>10k<br/><i>pin 2 → +3V3</i>"]:::part
  N_STEPPER_EN --"1"--> P_R_ENP
  P_J_S1L["<b>J_S1L</b><br/>SOCKET_1x8"]:::part
  N_STEPPER_EN --"1"--> P_J_S1L
  P_J_S2L["<b>J_S2L</b><br/>SOCKET_1x8"]:::part
  N_STEPPER_EN --"1"--> P_J_S2L
  N_TMC_UART_RX(["TMC_UART_RX"]):::net
  P_R_UTX["<b>R_UTX</b><br/>1k"]:::part
  N_TMC_UART_RX --"2"--> P_R_UTX
  P_J_S1L --"5"--> N_TMC_UART_RX
  P_J_S1L --"6"--> N_TMC_UART_RX
  P_J_S2L --"5"--> N_TMC_UART_RX
  P_J_S2L --"6"--> N_TMC_UART_RX
  N_TMC_UART_TX(["TMC_UART_TX"]):::net
  P_R_UTX --"1"--> N_TMC_UART_TX
```

| Net | connect every one of these |
|---|---|
| **STEPPER_EN_RAW** | `Q_EN.G` |
| **STEPPER_EN** | `Q_EN.D`, `R_ENP.1`, `J_S1L.1`, `J_S2L.1` |
| **TMC_UART_RX** | `R_UTX.2`, `J_S1L.5`, `J_S1L.6`, `J_S2L.5`, `J_S2L.6` |
| **TMC_UART_TX** | `R_UTX.1` |

## Power rows + coils

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_VIN_PROT(["VIN_PROT"]):::rail
  P_J_S1R["<b>J_S1R</b><br/>SOCKET_1x8<br/><i>pin 2 → GND</i><br/><i>pin 8 → GND</i><br/><i>pin 7 → +3V3</i>"]:::part
  P_J_S1R --"1"--> N_VIN_PROT
  P_J_S2R["<b>J_S2R</b><br/>SOCKET_1x8<br/><i>pin 2 → GND</i><br/><i>pin 8 → GND</i><br/><i>pin 7 → +3V3</i>"]:::part
  N_VIN_PROT --"1"--> P_J_S2R
  P_C_BS1["<b>C_BS1</b><br/>100uF/63V<br/><i>pin 2 → GND</i>"]:::part
  N_VIN_PROT --"1"--> P_C_BS1
  P_C_BS2["<b>C_BS2</b><br/>100uF/63V<br/><i>pin 2 → GND</i>"]:::part
  N_VIN_PROT --"1"--> P_C_BS2
  P_U_MA["<b>U_MA</b><br/>DRV8871DDAR<br/><i>pin GND → GND</i><br/><i>pin PGND → GND</i><br/><i>pin EP → GND</i>"]:::part
  N_VIN_PROT --"VM"--> P_U_MA
  P_U_MB["<b>U_MB</b><br/>DRV8871DDAR<br/><i>pin GND → GND</i><br/><i>pin PGND → GND</i><br/><i>pin EP → GND</i>"]:::part
  N_VIN_PROT --"VM"--> P_U_MB
  P_C_MA1["<b>C_MA1</b><br/>100uF/63V<br/><i>pin 2 → GND</i>"]:::part
  N_VIN_PROT --"1"--> P_C_MA1
  P_C_MA2["<b>C_MA2</b><br/>100nF<br/><i>pin 2 → GND</i>"]:::part
  N_VIN_PROT --"1"--> P_C_MA2
  P_C_MB1["<b>C_MB1</b><br/>100uF/63V<br/><i>pin 2 → GND</i>"]:::part
  N_VIN_PROT --"1"--> P_C_MB1
  P_C_MB2["<b>C_MB2</b><br/>100nF<br/><i>pin 2 → GND</i>"]:::part
  N_VIN_PROT --"1"--> P_C_MB2
  N_S1_2B(["S1_2B"]):::net
  P_J_S1R --"3"--> N_S1_2B
  P_XH1["<b>XH1</b><br/>STEPPER_COIL"]:::part
  N_S1_2B --"1"--> P_XH1
  N_S1_2A(["S1_2A"]):::net
  P_J_S1R --"4"--> N_S1_2A
  P_XH1 --"2"--> N_S1_2A
  N_S1_1A(["S1_1A"]):::net
  P_J_S1R --"5"--> N_S1_1A
  P_XH1 --"3"--> N_S1_1A
  N_S1_1B(["S1_1B"]):::net
  P_J_S1R --"6"--> N_S1_1B
  P_XH1 --"4"--> N_S1_1B
  N_S2_2B(["S2_2B"]):::net
  P_J_S2R --"3"--> N_S2_2B
  P_XH2["<b>XH2</b><br/>STEPPER_COIL"]:::part
  N_S2_2B --"1"--> P_XH2
  N_S2_2A(["S2_2A"]):::net
  P_J_S2R --"4"--> N_S2_2A
  P_XH2 --"2"--> N_S2_2A
  N_S2_1A(["S2_1A"]):::net
  P_J_S2R --"5"--> N_S2_1A
  P_XH2 --"3"--> N_S2_1A
  N_S2_1B(["S2_1B"]):::net
  P_J_S2R --"6"--> N_S2_1B
  P_XH2 --"4"--> N_S2_1B
```

| Net | connect every one of these |
|---|---|
| **VIN_PROT** | `J_S1R.1`, `J_S2R.1`, `C_BS1.1`, `C_BS2.1`, `U_MA.VM`, `U_MB.VM`, `C_MA1.1`, `C_MA2.1`, `C_MB1.1`, `C_MB2.1` |
| **S1_2B** | `J_S1R.3`, `XH1.1` |
| **S1_2A** | `J_S1R.4`, `XH1.2` |
| **S1_1A** | `J_S1R.5`, `XH1.3` |
| **S1_1B** | `J_S1R.6`, `XH1.4` |
| **S2_2B** | `J_S2R.3`, `XH2.1` |
| **S2_2A** | `J_S2R.4`, `XH2.2` |
| **S2_1A** | `J_S2R.5`, `XH2.3` |
| **S2_1B** | `J_S2R.6`, `XH2.4` |

## Brushed DC ×2 (DRV8871)

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_MOTOR_A_IN1(["MOTOR_A_IN1"]):::net
  P_U_MA["<b>U_MA</b><br/>DRV8871DDAR<br/><i>pin GND → GND</i><br/><i>pin PGND → GND</i><br/><i>pin EP → GND</i>"]:::part
  P_U_MA --"IN1"--> N_MOTOR_A_IN1
  N_MOTOR_A_IN2(["MOTOR_A_IN2"]):::net
  P_U_MA --"IN2"--> N_MOTOR_A_IN2
  N_MA_ILIM(["MA_ILIM"]):::net
  P_U_MA --"ILIM"--> N_MA_ILIM
  P_R_ILA["<b>R_ILA</b><br/>30k<br/><i>pin 2 → GND</i>"]:::part
  N_MA_ILIM --"1"--> P_R_ILA
  N_MA_OUT1(["MA_OUT1"]):::net
  P_U_MA --"OUT1"--> N_MA_OUT1
  P_J_MA["<b>J_MA</b><br/>MOTOR_OUT"]:::part
  N_MA_OUT1 --"1"--> P_J_MA
  N_MA_OUT2(["MA_OUT2"]):::net
  P_U_MA --"OUT2"--> N_MA_OUT2
  P_J_MA --"2"--> N_MA_OUT2
  N_MOTOR_B_IN1(["MOTOR_B_IN1"]):::net
  P_U_MB["<b>U_MB</b><br/>DRV8871DDAR<br/><i>pin GND → GND</i><br/><i>pin PGND → GND</i><br/><i>pin EP → GND</i>"]:::part
  N_MOTOR_B_IN1 --"IN1"--> P_U_MB
  N_MOTOR_B_IN2(["MOTOR_B_IN2"]):::net
  P_U_MB --"IN2"--> N_MOTOR_B_IN2
  N_MB_ILIM(["MB_ILIM"]):::net
  P_U_MB --"ILIM"--> N_MB_ILIM
  P_R_ILB["<b>R_ILB</b><br/>30k<br/><i>pin 2 → GND</i>"]:::part
  N_MB_ILIM --"1"--> P_R_ILB
  N_MB_OUT1(["MB_OUT1"]):::net
  P_U_MB --"OUT1"--> N_MB_OUT1
  P_J_MB["<b>J_MB</b><br/>MOTOR_OUT"]:::part
  N_MB_OUT1 --"1"--> P_J_MB
  N_MB_OUT2(["MB_OUT2"]):::net
  P_U_MB --"OUT2"--> N_MB_OUT2
  P_J_MB --"2"--> N_MB_OUT2
```

| Net | connect every one of these |
|---|---|
| **MOTOR_A_IN1** | `U_MA.IN1` |
| **MOTOR_A_IN2** | `U_MA.IN2` |
| **MA_ILIM** | `U_MA.ILIM`, `R_ILA.1` |
| **MA_OUT1** | `U_MA.OUT1`, `J_MA.1` |
| **MA_OUT2** | `U_MA.OUT2`, `J_MA.2` |
| **MOTOR_B_IN1** | `U_MB.IN1` |
| **MOTOR_B_IN2** | `U_MB.IN2` |
| **MB_ILIM** | `U_MB.ILIM`, `R_ILB.1` |
| **MB_OUT1** | `U_MB.OUT1`, `J_MB.1` |
| **MB_OUT2** | `U_MB.OUT2`, `J_MB.2` |

## GND

Every pin below goes to the GND symbol:

`Q_EN.S`, `J_S1R.2`, `J_S1R.8`, `J_S2R.2`, `J_S2R.8`, `JP11.3`, `JP12.3`, `JP13.3`, `JP21.3`, `JP22.3`, `JP23.3`, `J_DIAG1.2`, `J_DIAG2.2`, `C_BS1.2`, `C_BS2.2`, `U_MA.GND`, `U_MA.PGND`, `U_MA.EP`, `U_MB.GND`, `U_MB.PGND`, `U_MB.EP`, `R_ILA.2`, `R_ILB.2`, `C_MA1.2`, `C_MA2.2`, `C_MB1.2`, `C_MB2.2`

## +3V3

Every pin below goes to the +3V3 symbol:

`J_S1R.7`, `J_S2R.7`, `R_ENP.2`, `JP11.1`, `JP12.1`, `JP13.1`, `JP21.1`, `JP22.1`, `JP23.1`
