# 05-led — wiring diagrams

Generated from `05-led.net.yaml` by `tools/checknet.py --mermaid`. Read each diagram left to right along the signal path. **Boxes are parts, rounded nodes are nets, the label on a line is the pin.** A part's power-rail pins are written inside its box. Open the `.html` next to this file in any browser to see it rendered.

## Level shifter — gate inputs

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_LED_STRIP_1_DATA(["LED_STRIP_1_DATA"]):::net
  P_U_LS["<b>U_LS</b><br/>SN74AHCT125<br/><i>pin 7 → GND</i><br/><i>pin 1 → GND</i><br/><i>pin 4 → GND</i><br/><i>pin 10 → GND</i><br/><i>pin 13 → GND</i><br/><i>pin 14 → +5V</i>"]:::part
  P_U_LS --"2"--> N_LED_STRIP_1_DATA
  N_LED_STRIP_2_DATA(["LED_STRIP_2_DATA"]):::net
  P_U_LS --"5"--> N_LED_STRIP_2_DATA
  N_LED_STRIP_2_CLK(["LED_STRIP_2_CLK"]):::net
  P_U_LS --"9"--> N_LED_STRIP_2_CLK
  N_STATUS_LED(["STATUS_LED"]):::net
  P_U_LS --"12"--> N_STATUS_LED
```

| Net | connect every one of these |
|---|---|
| **LED_STRIP_1_DATA** | `U_LS.2` |
| **LED_STRIP_2_DATA** | `U_LS.5` |
| **LED_STRIP_2_CLK** | `U_LS.9` |
| **STATUS_LED** | `U_LS.12` |

## Strip 1 (3-wire)

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_LED1_5V(["LED1_5V"]):::net
  P_U_LS["<b>U_LS</b><br/>SN74AHCT125<br/><i>pin 7 → GND</i><br/><i>pin 1 → GND</i><br/><i>pin 4 → GND</i><br/><i>pin 10 → GND</i><br/><i>pin 13 → GND</i><br/><i>pin 14 → +5V</i>"]:::part
  P_U_LS --"3"--> N_LED1_5V
  P_R_S1["<b>R_S1</b><br/>330R"]:::part
  N_LED1_5V --"1"--> P_R_S1
  N_LED1_OUT(["LED1_OUT"]):::net
  P_R_S1 --"2"--> N_LED1_OUT
  P_J_ST1["<b>J_ST1</b><br/>LED_STRIP_1<br/><i>pin 2 → GND</i><br/><i>pin 1 → +5V</i>"]:::part
  N_LED1_OUT --"3"--> P_J_ST1
```

| Net | connect every one of these |
|---|---|
| **LED1_5V** | `U_LS.3`, `R_S1.1` |
| **LED1_OUT** | `R_S1.2`, `J_ST1.3` |

## Strip 2 (3/4-wire + mode SJ)

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_LED2_5V(["LED2_5V"]):::net
  P_U_LS["<b>U_LS</b><br/>SN74AHCT125<br/><i>pin 7 → GND</i><br/><i>pin 1 → GND</i><br/><i>pin 4 → GND</i><br/><i>pin 10 → GND</i><br/><i>pin 13 → GND</i><br/><i>pin 14 → +5V</i>"]:::part
  P_U_LS --"6"--> N_LED2_5V
  P_R_S2D["<b>R_S2D</b><br/>330R"]:::part
  N_LED2_5V --"1"--> P_R_S2D
  N_LED2_OUT(["LED2_OUT"]):::net
  P_R_S2D --"2"--> N_LED2_OUT
  P_J_ST2B["<b>J_ST2B</b><br/>LED2_SIG"]:::part
  N_LED2_OUT --"1"--> P_J_ST2B
  N_CLK_5V(["CLK_5V"]):::net
  P_U_LS --"8"--> N_CLK_5V
  P_R_S2C["<b>R_S2C</b><br/>330R"]:::part
  N_CLK_5V --"1"--> P_R_S2C
  N_CLK_J(["CLK_J"]):::net
  P_R_S2C --"2"--> N_CLK_J
  P_JP_M["<b>JP_M</b><br/>STRIP2_MODE"]:::part
  N_CLK_J --"A"--> P_JP_M
  N_CLK_OUT(["CLK_OUT"]):::net
  P_JP_M --"B"--> N_CLK_OUT
  P_J_ST2B --"2"--> N_CLK_OUT
```

| Net | connect every one of these |
|---|---|
| **LED2_5V** | `U_LS.6`, `R_S2D.1` |
| **LED2_OUT** | `R_S2D.2`, `J_ST2B.1` |
| **CLK_5V** | `U_LS.8`, `R_S2C.1` |
| **CLK_J** | `R_S2C.2`, `JP_M.A` |
| **CLK_OUT** | `JP_M.B`, `J_ST2B.2` |

## Status pixel

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_ST_5V(["ST_5V"]):::net
  P_U_LS["<b>U_LS</b><br/>SN74AHCT125<br/><i>pin 7 → GND</i><br/><i>pin 1 → GND</i><br/><i>pin 4 → GND</i><br/><i>pin 10 → GND</i><br/><i>pin 13 → GND</i><br/><i>pin 14 → +5V</i>"]:::part
  P_U_LS --"11"--> N_ST_5V
  P_R_ST["<b>R_ST</b><br/>330R"]:::part
  N_ST_5V --"1"--> P_R_ST
  N_ST_DIN(["ST_DIN"]):::net
  P_R_ST --"2"--> N_ST_DIN
  P_D_ST["<b>D_ST</b><br/>WS2812B-MINI<br/><i>pin 4 → GND</i><br/><i>pin 2 → +5V</i>"]:::part
  N_ST_DIN --"1"--> P_D_ST
```

| Net | connect every one of these |
|---|---|
| **ST_5V** | `U_LS.11`, `R_ST.1` |
| **ST_DIN** | `R_ST.2`, `D_ST.1` |

## Rail-only parts ×5 — decoupling; wire each pin to its rail symbol, place beside its chip

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  P_C_LS["<b>C_LS</b><br/>100nF<br/><i>pin 2 → GND</i><br/><i>pin 1 → +5V</i>"]:::part
  P_C_B1["<b>C_B1</b><br/>1000uF/16V<br/><i>pin 2 → GND</i><br/><i>pin 1 → +5V</i>"]:::part
  P_C_B2["<b>C_B2</b><br/>1000uF/16V<br/><i>pin 2 → GND</i><br/><i>pin 1 → +5V</i>"]:::part
  P_J_ST2A["<b>J_ST2A</b><br/>LED2_PWR<br/><i>pin 2 → GND</i><br/><i>pin 1 → +5V</i>"]:::part
  P_C_ST["<b>C_ST</b><br/>100nF<br/><i>pin 2 → GND</i><br/><i>pin 1 → +5V</i>"]:::part
```

| Net | connect every one of these |
|---|---|

## GND

Every pin below goes to the GND symbol:

`U_LS.7`, `U_LS.1`, `U_LS.4`, `U_LS.10`, `U_LS.13`, `C_LS.2`, `J_ST1.2`, `J_ST2A.2`, `C_B1.2`, `C_B2.2`, `D_ST.4`, `C_ST.2`

## +5V

Every pin below goes to the +5V symbol:

`U_LS.14`, `C_LS.1`, `J_ST1.1`, `J_ST2A.1`, `C_B1.1`, `C_B2.1`, `D_ST.2`, `C_ST.1`
