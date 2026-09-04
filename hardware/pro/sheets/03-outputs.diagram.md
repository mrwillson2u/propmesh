# 03-outputs — wiring diagrams

Generated from `03-outputs.net.yaml` by `tools/checknet.py --mermaid`. Read each diagram left to right along the signal path. **Boxes are parts, rounded nodes are nets, the label on a line is the pin.** A part's power-rail pins are written inside its box. Open the `.html` next to this file in any browser to see it rendered.

## I²C + PCA9685 core

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
  P_U_PCA["<b>U_PCA</b><br/>PCA9685PW<br/><i>pin VSS → GND</i><br/><i>pin ~{OE} → GND</i><br/><i>pin EXTCLK → GND</i>"]:::part
  P_U_PCA --"SDA"--> N_I2C_SDA
  P_R_SDA["<b>R_SDA</b><br/>4.7k"]:::part
  N_I2C_SDA --"1"--> P_R_SDA
  N_I2C_SCL(["I2C_SCL"]):::net
  P_U_PCA --"SCL"--> N_I2C_SCL
  P_R_SCL["<b>R_SCL</b><br/>4.7k"]:::part
  N_I2C_SCL --"1"--> P_R_SCL
  N__3V3(["+3V3"]):::rail
  P_U_PCA --"VDD"--> N__3V3
  P_R_SDA --"2"--> N__3V3
  P_R_SCL --"2"--> N__3V3
  P_C_P1["<b>C_P1</b><br/>100nF<br/><i>pin 2 → GND</i>"]:::part
  N__3V3 --"1"--> P_C_P1
  P_C_P2["<b>C_P2</b><br/>10uF/16V<br/><i>pin 2 → GND</i>"]:::part
  N__3V3 --"1"--> P_C_P2
  N_A0_STRAP(["A0_STRAP"]):::net
  P_U_PCA --"A0"--> N_A0_STRAP
  P_R_A0["<b>R_A0</b><br/>10k<br/><i>pin 2 → GND</i>"]:::part
  N_A0_STRAP --"1"--> P_R_A0
  N_A1_STRAP(["A1_STRAP"]):::net
  P_U_PCA --"A1"--> N_A1_STRAP
  P_R_A1["<b>R_A1</b><br/>10k<br/><i>pin 2 → GND</i>"]:::part
  N_A1_STRAP --"1"--> P_R_A1
  N_A2_STRAP(["A2_STRAP"]):::net
  P_U_PCA --"A2"--> N_A2_STRAP
  P_R_A2["<b>R_A2</b><br/>10k<br/><i>pin 2 → GND</i>"]:::part
  N_A2_STRAP --"1"--> P_R_A2
  N_A3_STRAP(["A3_STRAP"]):::net
  P_U_PCA --"A3"--> N_A3_STRAP
  P_R_A3["<b>R_A3</b><br/>10k<br/><i>pin 2 → GND</i>"]:::part
  N_A3_STRAP --"1"--> P_R_A3
  N_A4_STRAP(["A4_STRAP"]):::net
  P_U_PCA --"A4"--> N_A4_STRAP
  P_R_A4["<b>R_A4</b><br/>10k<br/><i>pin 2 → GND</i>"]:::part
  N_A4_STRAP --"1"--> P_R_A4
  N_A5_STRAP(["A5_STRAP"]):::net
  P_U_PCA --"A5"--> N_A5_STRAP
  P_R_A5["<b>R_A5</b><br/>10k<br/><i>pin 2 → GND</i>"]:::part
  N_A5_STRAP --"1"--> P_R_A5
  N_STEPPER_EN_RAW(["STEPPER_EN_RAW"]):::net
  P_U_PCA --"LED15"--> N_STEPPER_EN_RAW
```

| Net | connect every one of these |
|---|---|
| **I2C_SDA** | `U_PCA.SDA`, `R_SDA.1` |
| **I2C_SCL** | `U_PCA.SCL`, `R_SCL.1` |
| **+3V3** | `U_PCA.VDD`, `R_SDA.2`, `R_SCL.2`, `C_P1.1`, `C_P2.1` |
| **A0_STRAP** | `U_PCA.A0`, `R_A0.1` |
| **A1_STRAP** | `U_PCA.A1`, `R_A1.1` |
| **A2_STRAP** | `U_PCA.A2`, `R_A2.1` |
| **A3_STRAP** | `U_PCA.A3`, `R_A3.1` |
| **A4_STRAP** | `U_PCA.A4`, `R_A4.1` |
| **A5_STRAP** | `U_PCA.A5`, `R_A5.1` |
| **STEPPER_EN_RAW** | `U_PCA.LED15` |

## Relay channels ×3

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_RELAY_1(["RELAY_1"]):::net
  P_U_PCA["<b>U_PCA</b><br/>PCA9685PW<br/><i>pin VSS → GND</i><br/><i>pin ~{OE} → GND</i><br/><i>pin EXTCLK → GND</i>"]:::part
  P_U_PCA --"LED12"--> N_RELAY_1
  P_U_REL["<b>U_REL</b><br/>ULN2003A<br/><i>pin COM → +5V</i><br/><i>pin GND → GND</i>"]:::part
  N_RELAY_1 --"I1"--> P_U_REL
  N_REL1_COIL(["REL1_COIL"]):::net
  P_U_REL --"O1"--> N_REL1_COIL
  P_K1["<b>K1</b><br/>HK4100F<br/><i>pin 4 → +5V</i>"]:::part
  N_REL1_COIL --"3"--> P_K1
  N_REL1_NO(["REL1_NO"]):::net
  P_K1 --"1"--> N_REL1_NO
  P_J_REL1["<b>J_REL1</b><br/>RELAY_OUT"]:::part
  N_REL1_NO --"1"--> P_J_REL1
  N_REL1_COM(["REL1_COM"]):::net
  P_K1 --"5"--> N_REL1_COM
  P_K1 --"6"--> N_REL1_COM
  P_J_REL1 --"2"--> N_REL1_COM
  N_REL1_NC(["REL1_NC"]):::net
  P_K1 --"2"--> N_REL1_NC
  P_J_REL1 --"3"--> N_REL1_NC
  N_RELAY_2(["RELAY_2"]):::net
  P_U_PCA --"LED13"--> N_RELAY_2
  P_U_REL --"I2"--> N_RELAY_2
  N_REL2_COIL(["REL2_COIL"]):::net
  P_U_REL --"O2"--> N_REL2_COIL
  P_K2["<b>K2</b><br/>HK4100F<br/><i>pin 4 → +5V</i>"]:::part
  N_REL2_COIL --"3"--> P_K2
  N_REL2_NO(["REL2_NO"]):::net
  P_K2 --"1"--> N_REL2_NO
  P_J_REL2["<b>J_REL2</b><br/>RELAY_OUT"]:::part
  N_REL2_NO --"1"--> P_J_REL2
  N_REL2_COM(["REL2_COM"]):::net
  P_K2 --"5"--> N_REL2_COM
  P_K2 --"6"--> N_REL2_COM
  P_J_REL2 --"2"--> N_REL2_COM
  N_REL2_NC(["REL2_NC"]):::net
  P_K2 --"2"--> N_REL2_NC
  P_J_REL2 --"3"--> N_REL2_NC
  N_RELAY_3(["RELAY_3"]):::net
  P_U_PCA --"LED14"--> N_RELAY_3
  P_U_REL --"I3"--> N_RELAY_3
  N_REL3_COIL(["REL3_COIL"]):::net
  P_U_REL --"O3"--> N_REL3_COIL
  P_K3["<b>K3</b><br/>HK4100F<br/><i>pin 4 → +5V</i>"]:::part
  N_REL3_COIL --"3"--> P_K3
  N_REL3_NO(["REL3_NO"]):::net
  P_K3 --"1"--> N_REL3_NO
  P_J_REL3["<b>J_REL3</b><br/>RELAY_OUT"]:::part
  N_REL3_NO --"1"--> P_J_REL3
  N_REL3_COM(["REL3_COM"]):::net
  P_K3 --"5"--> N_REL3_COM
  P_K3 --"6"--> N_REL3_COM
  P_J_REL3 --"2"--> N_REL3_COM
  N_REL3_NC(["REL3_NC"]):::net
  P_K3 --"2"--> N_REL3_NC
  P_J_REL3 --"3"--> N_REL3_NC
```

| Net | connect every one of these |
|---|---|
| **RELAY_1** | `U_PCA.LED12`, `U_REL.I1` |
| **REL1_COIL** | `U_REL.O1`, `K1.3` |
| **REL1_NO** | `K1.1`, `J_REL1.1` |
| **REL1_COM** | `K1.5`, `K1.6`, `J_REL1.2` |
| **REL1_NC** | `K1.2`, `J_REL1.3` |
| **RELAY_2** | `U_PCA.LED13`, `U_REL.I2` |
| **REL2_COIL** | `U_REL.O2`, `K2.3` |
| **REL2_NO** | `K2.1`, `J_REL2.1` |
| **REL2_COM** | `K2.5`, `K2.6`, `J_REL2.2` |
| **REL2_NC** | `K2.2`, `J_REL2.3` |
| **RELAY_3** | `U_PCA.LED14`, `U_REL.I3` |
| **REL3_COIL** | `U_REL.O3`, `K3.3` |
| **REL3_NO** | `K3.1`, `J_REL3.1` |
| **REL3_COM** | `K3.5`, `K3.6`, `J_REL3.2` |
| **REL3_NC** | `K3.2`, `J_REL3.3` |

## DC switch/dim channels ×6 (AO3400A low-side, supply-voltage loads)

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_LED_1(["LED_1"]):::net
  P_U_PCA["<b>U_PCA</b><br/>PCA9685PW<br/><i>pin VSS → GND</i><br/><i>pin ~{OE} → GND</i><br/><i>pin EXTCLK → GND</i>"]:::part
  P_U_PCA --"LED6"--> N_LED_1
  P_Q_LED1["<b>Q_LED1</b><br/>AO3400A<br/><i>pin S → GND</i>"]:::part
  N_LED_1 --"G"--> P_Q_LED1
  N_LED1_K(["LED1_K"]):::net
  P_Q_LED1 --"D"--> N_LED1_K
  P_J_LED1["<b>J_LED1</b><br/>LED_OUT<br/><i>pin 1 → VIN_PROT</i>"]:::part
  N_LED1_K --"2"--> P_J_LED1
  P_D_FB1["<b>D_FB1</b><br/>SS34<br/><i>pin K → VIN_PROT</i>"]:::part
  N_LED1_K --"A"--> P_D_FB1
  N_LED_2(["LED_2"]):::net
  P_U_PCA --"LED7"--> N_LED_2
  P_Q_LED2["<b>Q_LED2</b><br/>AO3400A<br/><i>pin S → GND</i>"]:::part
  N_LED_2 --"G"--> P_Q_LED2
  N_LED2_K(["LED2_K"]):::net
  P_Q_LED2 --"D"--> N_LED2_K
  P_J_LED2["<b>J_LED2</b><br/>LED_OUT<br/><i>pin 1 → VIN_PROT</i>"]:::part
  N_LED2_K --"2"--> P_J_LED2
  P_D_FB2["<b>D_FB2</b><br/>SS34<br/><i>pin K → VIN_PROT</i>"]:::part
  N_LED2_K --"A"--> P_D_FB2
  N_LED_3(["LED_3"]):::net
  P_U_PCA --"LED8"--> N_LED_3
  P_Q_LED3["<b>Q_LED3</b><br/>AO3400A<br/><i>pin S → GND</i>"]:::part
  N_LED_3 --"G"--> P_Q_LED3
  N_LED3_K(["LED3_K"]):::net
  P_Q_LED3 --"D"--> N_LED3_K
  P_J_LED3["<b>J_LED3</b><br/>LED_OUT<br/><i>pin 1 → VIN_PROT</i>"]:::part
  N_LED3_K --"2"--> P_J_LED3
  P_D_FB3["<b>D_FB3</b><br/>SS34<br/><i>pin K → VIN_PROT</i>"]:::part
  N_LED3_K --"A"--> P_D_FB3
  N_LED_4(["LED_4"]):::net
  P_U_PCA --"LED9"--> N_LED_4
  P_Q_LED4["<b>Q_LED4</b><br/>AO3400A<br/><i>pin S → GND</i>"]:::part
  N_LED_4 --"G"--> P_Q_LED4
  N_LED4_K(["LED4_K"]):::net
  P_Q_LED4 --"D"--> N_LED4_K
  P_J_LED4["<b>J_LED4</b><br/>LED_OUT<br/><i>pin 1 → VIN_PROT</i>"]:::part
  N_LED4_K --"2"--> P_J_LED4
  P_D_FB4["<b>D_FB4</b><br/>SS34<br/><i>pin K → VIN_PROT</i>"]:::part
  N_LED4_K --"A"--> P_D_FB4
  N_LED_5(["LED_5"]):::net
  P_U_PCA --"LED10"--> N_LED_5
  P_Q_LED5["<b>Q_LED5</b><br/>AO3400A<br/><i>pin S → GND</i>"]:::part
  N_LED_5 --"G"--> P_Q_LED5
  N_LED5_K(["LED5_K"]):::net
  P_Q_LED5 --"D"--> N_LED5_K
  P_J_LED5["<b>J_LED5</b><br/>LED_OUT<br/><i>pin 1 → VIN_PROT</i>"]:::part
  N_LED5_K --"2"--> P_J_LED5
  P_D_FB5["<b>D_FB5</b><br/>SS34<br/><i>pin K → VIN_PROT</i>"]:::part
  N_LED5_K --"A"--> P_D_FB5
  N_LED_6(["LED_6"]):::net
  P_U_PCA --"LED11"--> N_LED_6
  P_Q_LED6["<b>Q_LED6</b><br/>AO3400A<br/><i>pin S → GND</i>"]:::part
  N_LED_6 --"G"--> P_Q_LED6
  N_LED6_K(["LED6_K"]):::net
  P_Q_LED6 --"D"--> N_LED6_K
  P_J_LED6["<b>J_LED6</b><br/>LED_OUT<br/><i>pin 1 → VIN_PROT</i>"]:::part
  N_LED6_K --"2"--> P_J_LED6
  P_D_FB6["<b>D_FB6</b><br/>SS34<br/><i>pin K → VIN_PROT</i>"]:::part
  N_LED6_K --"A"--> P_D_FB6
```

| Net | connect every one of these |
|---|---|
| **LED_1** | `U_PCA.LED6`, `Q_LED1.G` |
| **LED1_K** | `Q_LED1.D`, `J_LED1.2`, `D_FB1.A` |
| **LED_2** | `U_PCA.LED7`, `Q_LED2.G` |
| **LED2_K** | `Q_LED2.D`, `J_LED2.2`, `D_FB2.A` |
| **LED_3** | `U_PCA.LED8`, `Q_LED3.G` |
| **LED3_K** | `Q_LED3.D`, `J_LED3.2`, `D_FB3.A` |
| **LED_4** | `U_PCA.LED9`, `Q_LED4.G` |
| **LED4_K** | `Q_LED4.D`, `J_LED4.2`, `D_FB4.A` |
| **LED_5** | `U_PCA.LED10`, `Q_LED5.G` |
| **LED5_K** | `Q_LED5.D`, `J_LED5.2`, `D_FB5.A` |
| **LED_6** | `U_PCA.LED11`, `Q_LED6.G` |
| **LED6_K** | `Q_LED6.D`, `J_LED6.2`, `D_FB6.A` |

## Servo headers ×6

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_SERVO_1(["SERVO_1"]):::net
  P_U_PCA["<b>U_PCA</b><br/>PCA9685PW<br/><i>pin VSS → GND</i><br/><i>pin ~{OE} → GND</i><br/><i>pin EXTCLK → GND</i>"]:::part
  P_U_PCA --"LED0"--> N_SERVO_1
  P_J_SRV1["<b>J_SRV1</b><br/>SERVO<br/><i>pin 2 → +5V</i><br/><i>pin 1 → GND</i>"]:::part
  N_SERVO_1 --"3"--> P_J_SRV1
  N_SERVO_2(["SERVO_2"]):::net
  P_U_PCA --"LED1"--> N_SERVO_2
  P_J_SRV2["<b>J_SRV2</b><br/>SERVO<br/><i>pin 2 → +5V</i><br/><i>pin 1 → GND</i>"]:::part
  N_SERVO_2 --"3"--> P_J_SRV2
  N_SERVO_3(["SERVO_3"]):::net
  P_U_PCA --"LED2"--> N_SERVO_3
  P_J_SRV3["<b>J_SRV3</b><br/>SERVO<br/><i>pin 2 → +5V</i><br/><i>pin 1 → GND</i>"]:::part
  N_SERVO_3 --"3"--> P_J_SRV3
  N_SERVO_4(["SERVO_4"]):::net
  P_U_PCA --"LED3"--> N_SERVO_4
  P_J_SRV4["<b>J_SRV4</b><br/>SERVO<br/><i>pin 2 → +5V</i><br/><i>pin 1 → GND</i>"]:::part
  N_SERVO_4 --"3"--> P_J_SRV4
  N_SERVO_5(["SERVO_5"]):::net
  P_U_PCA --"LED4"--> N_SERVO_5
  P_J_SRV5["<b>J_SRV5</b><br/>SERVO<br/><i>pin 2 → +5V</i><br/><i>pin 1 → GND</i>"]:::part
  N_SERVO_5 --"3"--> P_J_SRV5
  N_SERVO_6(["SERVO_6"]):::net
  P_U_PCA --"LED5"--> N_SERVO_6
  P_J_SRV6["<b>J_SRV6</b><br/>SERVO<br/><i>pin 2 → +5V</i><br/><i>pin 1 → GND</i>"]:::part
  N_SERVO_6 --"3"--> P_J_SRV6
```

| Net | connect every one of these |
|---|---|
| **SERVO_1** | `U_PCA.LED0`, `J_SRV1.3` |
| **SERVO_2** | `U_PCA.LED1`, `J_SRV2.3` |
| **SERVO_3** | `U_PCA.LED2`, `J_SRV3.3` |
| **SERVO_4** | `U_PCA.LED3`, `J_SRV4.3` |
| **SERVO_5** | `U_PCA.LED4`, `J_SRV5.3` |
| **SERVO_6** | `U_PCA.LED5`, `J_SRV6.3` |

## GND

Every pin below goes to the GND symbol:

`U_PCA.VSS`, `U_PCA.~{OE}`, `U_PCA.EXTCLK`, `U_REL.GND`, `R_A0.2`, `R_A1.2`, `R_A2.2`, `R_A3.2`, `R_A4.2`, `R_A5.2`, `C_P1.2`, `C_P2.2`, `Q_LED1.S`, `Q_LED2.S`, `Q_LED3.S`, `Q_LED4.S`, `Q_LED5.S`, `Q_LED6.S`, `J_SRV1.1`, `J_SRV2.1`, `J_SRV3.1`, `J_SRV4.1`, `J_SRV5.1`, `J_SRV6.1`

## +5V

Every pin below goes to the +5V symbol:

`K1.4`, `K2.4`, `K3.4`, `U_REL.COM`, `J_SRV1.2`, `J_SRV2.2`, `J_SRV3.2`, `J_SRV4.2`, `J_SRV5.2`, `J_SRV6.2`

## VIN_PROT

Every pin below goes to the VIN_PROT symbol:

`J_LED1.1`, `J_LED2.1`, `J_LED3.1`, `J_LED4.1`, `J_LED5.1`, `J_LED6.1`, `D_FB1.K`, `D_FB2.K`, `D_FB3.K`, `D_FB4.K`, `D_FB5.K`, `D_FB6.K`
