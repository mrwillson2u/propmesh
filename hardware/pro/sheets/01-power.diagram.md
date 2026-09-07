# 01-power — wiring diagrams

Generated from `01-power.net.yaml` by `tools/checknet.py --mermaid`. Read each diagram left to right along the signal path. **Boxes are parts, rounded nodes are nets, the label on a line is the pin.** A part's power-rail pins are written inside its box. A multi-unit chip (a quad gate) appears once per unit — one box per triangle, exactly as KiCad places it. Open the `.html` next to this file in any browser to see it rendered.

## Staged-power links (bring-up)

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_VIN_BUCK(["VIN_BUCK"]):::net
  P_JP_VIN["<b>JP_VIN</b><br/>JP_VIN"]:::part
  P_JP_VIN --"2"--> N_VIN_BUCK
  P_C1a["<b>C1a</b><br/>10uF/100V<br/><i>pin 2 → GND</i>"]:::part
  N_VIN_BUCK --"1"--> P_C1a
  P_C1b["<b>C1b</b><br/>10uF/100V<br/><i>pin 2 → GND</i>"]:::part
  N_VIN_BUCK --"1"--> P_C1b
  P_U1["<b>U1</b><br/>AP64350SP-13<br/><i>pin GND → GND</i><br/><i>pin EP → GND</i>"]:::part
  N_VIN_BUCK --"VIN"--> P_U1
  P_U1 --"EN"--> N_VIN_BUCK
  N_5V_BUCK(["5V_BUCK"]):::net
  P_L1["<b>L1</b><br/>6.8uH"]:::part
  N_5V_BUCK --"2"--> P_L1
  P_C2a["<b>C2a</b><br/>22uF<br/><i>pin 2 → GND</i>"]:::part
  N_5V_BUCK --"1"--> P_C2a
  P_C2b["<b>C2b</b><br/>22uF<br/><i>pin 2 → GND</i>"]:::part
  N_5V_BUCK --"1"--> P_C2b
  P_R1["<b>R1</b><br/>115k"]:::part
  N_5V_BUCK --"1"--> P_R1
  P_C4["<b>C4</b><br/>DNP"]:::dnp
  N_5V_BUCK --"1"--> P_C4
  P_JP_5V["<b>JP_5V</b><br/>JP_5V"]:::part
  N_5V_BUCK --"2"--> P_JP_5V
  N_3V3_BUCK(["3V3_BUCK"]):::net
  P_L2["<b>L2</b><br/>2.2uH"]:::part
  N_3V3_BUCK --"2"--> P_L2
  P_C_out["<b>C_out</b><br/>22uF<br/><i>pin 2 → GND</i>"]:::part
  N_3V3_BUCK --"1"--> P_C_out
  P_R_FB1["<b>R_FB1</b><br/>453k"]:::part
  N_3V3_BUCK --"1"--> P_R_FB1
  P_C_FF["<b>C_FF</b><br/>6.8pF"]:::part
  N_3V3_BUCK --"1"--> P_C_FF
  P_JP_3V3["<b>JP_3V3</b><br/>JP_3V3"]:::part
  N_3V3_BUCK --"2"--> P_JP_3V3
```

| Net | connect every one of these |
|---|---|
| **VIN_BUCK** | `JP_VIN.2`, `C1a.1`, `C1b.1`, `U1.VIN`, `U1.EN` |
| **5V_BUCK** | `L1.2`, `C2a.1`, `C2b.1`, `R1.1`, `C4.1`, `JP_5V.2` |
| **3V3_BUCK** | `L2.2`, `C_out.1`, `R_FB1.1`, `C_FF.1`, `JP_3V3.2` |

## Protection stage: J1 → VIN_PROT

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_VIN_RAW(["VIN_RAW"]):::rail
  P_J1["<b>J1</b><br/>DC_IN<br/><i>pin 2 → GND</i>"]:::part
  P_J1 --"1"--> N_VIN_RAW
  P_J2["<b>J2</b><br/>DC_JACK<br/><i>pin 2 → GND</i><br/><i>pin 3 → GND</i>"]:::part
  N_VIN_RAW --"1"--> P_J2
  P_F1["<b>F1</b><br/>7.5A"]:::part
  N_VIN_RAW --"1"--> P_F1
  N_VIN_FUSED(["VIN_FUSED"]):::net
  P_F1 --"2"--> N_VIN_FUSED
  P_Q1["<b>Q1</b><br/>AOD4185"]:::part
  N_VIN_FUSED --"D"--> P_Q1
  N_VIN_PROT(["VIN_PROT"]):::rail
  P_Q1 --"S"--> N_VIN_PROT
  P_D_Z["<b>D_Z</b><br/>BZT52C10"]:::part
  N_VIN_PROT --"K"--> P_D_Z
  P_D1["<b>D1</b><br/>SMAJ33A<br/><i>pin A → GND</i>"]:::part
  N_VIN_PROT --"K"--> P_D1
  P_C_bulk["<b>C_bulk</b><br/>100uF/63V<br/><i>pin 2 → GND</i>"]:::part
  N_VIN_PROT --"1"--> P_C_bulk
  P_JP_VIN["<b>JP_VIN</b><br/>JP_VIN"]:::part
  N_VIN_PROT --"1"--> P_JP_VIN
  N_Q1_GATE(["Q1_GATE"]):::net
  P_Q1 --"G"--> N_Q1_GATE
  P_D_Z --"A"--> N_Q1_GATE
  P_R_G["<b>R_G</b><br/>100k<br/><i>pin 2 → GND</i>"]:::part
  N_Q1_GATE --"1"--> P_R_G
```

| Net | connect every one of these |
|---|---|
| **VIN_RAW** | `J1.1`, `J2.1`, `F1.1` |
| **VIN_FUSED** | `F1.2`, `Q1.D` |
| **VIN_PROT** | `Q1.S`, `D_Z.K`, `D1.K`, `C_bulk.1`, `JP_VIN.1` |
| **Q1_GATE** | `Q1.G`, `D_Z.A`, `R_G.1` |

## Rail 1: AP64350, VIN_PROT → +5V

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_BST_5V(["BST_5V"]):::net
  P_U1["<b>U1</b><br/>AP64350SP-13<br/><i>pin GND → GND</i><br/><i>pin EP → GND</i>"]:::part
  P_U1 --"BST"--> N_BST_5V
  P_C3["<b>C3</b><br/>100nF"]:::part
  N_BST_5V --"1"--> P_C3
  N_SW_5V(["SW_5V"]):::net
  P_U1 --"SW"--> N_SW_5V
  P_C3 --"2"--> N_SW_5V
  P_L1["<b>L1</b><br/>6.8uH"]:::part
  N_SW_5V --"1"--> P_L1
  N__5V(["+5V"]):::rail
  P_JP_5V["<b>JP_5V</b><br/>JP_5V"]:::part
  N__5V --"1"--> P_JP_5V
  P_R_5V["<b>R_5V</b><br/>680R"]:::part
  N__5V --"1"--> P_R_5V
  P_U2["<b>U2</b><br/>TLV62569DBV<br/><i>pin GND → GND</i>"]:::part
  N__5V --"VIN"--> P_U2
  P_U2 --"EN"--> N__5V
  P_C_in["<b>C_in</b><br/>10uF/16V<br/><i>pin 2 → GND</i>"]:::part
  N__5V --"1"--> P_C_in
  N_FB_5V(["FB_5V"]):::net
  P_R1["<b>R1</b><br/>115k"]:::part
  N_FB_5V --"2"--> P_R1
  P_R2["<b>R2</b><br/>22.1k<br/><i>pin 2 → GND</i>"]:::part
  N_FB_5V --"1"--> P_R2
  P_C4["<b>C4</b><br/>DNP"]:::dnp
  N_FB_5V --"2"--> P_C4
  P_U1 --"FB"--> N_FB_5V
  N_RT_5V(["RT_5V"]):::net
  P_U1 --"RT/CLK"--> N_RT_5V
  P_RT["<b>RT</b><br/>200k<br/><i>pin 2 → GND</i>"]:::part
  N_RT_5V --"1"--> P_RT
  N_COMP_5V(["COMP_5V"]):::net
  P_U1 --"COMP"--> N_COMP_5V
  P_R5["<b>R5</b><br/>14k"]:::part
  N_COMP_5V --"1"--> P_R5
  P_C6["<b>C6</b><br/>47pF<br/><i>pin 2 → GND</i>"]:::part
  N_COMP_5V --"1"--> P_C6
  N_COMP_RC(["COMP_RC"]):::net
  P_R5 --"2"--> N_COMP_RC
  P_C5["<b>C5</b><br/>3.3nF<br/><i>pin 2 → GND</i>"]:::part
  N_COMP_RC --"1"--> P_C5
  N_LED_5V(["LED_5V"]):::net
  P_R_5V --"2"--> N_LED_5V
  P_D_5V["<b>D_5V</b><br/>LED_BLUE<br/><i>pin K → GND</i>"]:::part
  N_LED_5V --"A"--> P_D_5V
```

| Net | connect every one of these |
|---|---|
| **BST_5V** | `U1.BST`, `C3.1` |
| **SW_5V** | `U1.SW`, `C3.2`, `L1.1` |
| **+5V** | `JP_5V.1`, `R_5V.1`, `U2.VIN`, `U2.EN`, `C_in.1` |
| **FB_5V** | `R1.2`, `R2.1`, `C4.2`, `U1.FB` |
| **RT_5V** | `U1.RT/CLK`, `RT.1` |
| **COMP_5V** | `U1.COMP`, `R5.1`, `C6.1` |
| **COMP_RC** | `R5.2`, `C5.1` |
| **LED_5V** | `R_5V.2`, `D_5V.A` |

## Rail 2: TLV62569, +5V → +3V3

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_SW_3V3(["SW_3V3"]):::net
  P_U2["<b>U2</b><br/>TLV62569DBV<br/><i>pin GND → GND</i>"]:::part
  P_U2 --"SW"--> N_SW_3V3
  P_L2["<b>L2</b><br/>2.2uH"]:::part
  N_SW_3V3 --"1"--> P_L2
  N__3V3(["+3V3"]):::rail
  P_JP_3V3["<b>JP_3V3</b><br/>JP_3V3"]:::part
  N__3V3 --"1"--> P_JP_3V3
  P_R_3V3["<b>R_3V3</b><br/>680R"]:::part
  N__3V3 --"1"--> P_R_3V3
  N_FB_3V3(["FB_3V3"]):::net
  P_U2 --"FB"--> N_FB_3V3
  P_R_FB1["<b>R_FB1</b><br/>453k"]:::part
  N_FB_3V3 --"2"--> P_R_FB1
  P_R_FB2["<b>R_FB2</b><br/>100k<br/><i>pin 2 → GND</i>"]:::part
  N_FB_3V3 --"1"--> P_R_FB2
  P_C_FF["<b>C_FF</b><br/>6.8pF"]:::part
  N_FB_3V3 --"2"--> P_C_FF
  N_LED_3V3(["LED_3V3"]):::net
  P_R_3V3 --"2"--> N_LED_3V3
  P_D_3V3["<b>D_3V3</b><br/>LED_YELLOW<br/><i>pin K → GND</i>"]:::part
  N_LED_3V3 --"A"--> P_D_3V3
```

| Net | connect every one of these |
|---|---|
| **SW_3V3** | `U2.SW`, `L2.1` |
| **+3V3** | `JP_3V3.1`, `R_3V3.1` |
| **FB_3V3** | `U2.FB`, `R_FB1.2`, `R_FB2.1`, `C_FF.2` |
| **LED_3V3** | `R_3V3.2`, `D_3V3.A` |

## GND

Every pin below goes to the GND symbol:

`J1.2`, `J2.2`, `J2.3`, `R_G.2`, `D1.A`, `C1a.2`, `C1b.2`, `C_bulk.2`, `U1.GND`, `U1.EP`, `RT.2`, `R2.2`, `C5.2`, `C6.2`, `C2a.2`, `C2b.2`, `D_5V.K`, `U2.GND`, `C_in.2`, `C_out.2`, `R_FB2.2`, `D_3V3.K`
