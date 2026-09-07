# 04-audio — wiring diagrams

Generated from `04-audio.net.yaml` by `tools/checknet.py --mermaid`. Read each diagram left to right along the signal path. **Boxes are parts, rounded nodes are nets, the label on a line is the pin.** A part's power-rail pins are written inside its box. A multi-unit chip (a quad gate) appears once per unit — one box per triangle, exactly as KiCad places it. Open the `.html` next to this file in any browser to see it rendered.

## I²S amp → speaker (mono mix, 12 dB)

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_I2S_DOUT(["I2S_DOUT"]):::net
  P_U_AMP["<b>U_AMP</b><br/>MAX98357AETE+T<br/><i>pin VDD → +5V</i><br/><i>pin VDD → +5V</i><br/><i>pin GND → GND</i><br/><i>pin GND → GND</i><br/><i>pin GND → GND</i><br/><i>pin GAIN_SLOT → GND</i><br/><i>pin EP → GND</i>"]:::part
  P_U_AMP --"DIN"--> N_I2S_DOUT
  P_U_DAC["<b>U_DAC</b><br/>PCM5102APWR<br/><i>pin DVDD → +3V3</i><br/><i>pin AVDD → +3V3</i><br/><i>pin CPVDD → +3V3</i><br/><i>pin DGND → GND</i><br/><i>pin AGND → GND</i><br/><i>pin CPGND → GND</i><br/><i>pin FLT → GND</i><br/><i>pin FMT → GND</i><br/><i>pin DEMP → GND</i><br/><i>pin SCK → GND</i>"]:::part
  N_I2S_DOUT --"DIN"--> P_U_DAC
  N_I2S_BCLK(["I2S_BCLK"]):::net
  P_U_AMP --"BCLK"--> N_I2S_BCLK
  P_U_DAC --"BCK"--> N_I2S_BCLK
  N_I2S_LRCLK(["I2S_LRCLK"]):::net
  P_U_AMP --"LRCLK"--> N_I2S_LRCLK
  P_U_DAC --"LRCK"--> N_I2S_LRCLK
  N_SDM(["SDM"]):::net
  P_U_AMP --"~{SD_MODE}"--> N_SDM
  P_R_SDM["<b>R_SDM</b><br/>620k<br/><i>pin 2 → +3V3</i>"]:::part
  N_SDM --"1"--> P_R_SDM
  N_AMP_P(["AMP_P"]):::net
  P_U_AMP --"OUTP"--> N_AMP_P
  P_FB_P["<b>FB_P</b><br/>BLM21PG221SN1D"]:::part
  N_AMP_P --"1"--> P_FB_P
  N_SPK_P(["SPK_P"]):::net
  P_FB_P --"2"--> N_SPK_P
  P_C_FBP["<b>C_FBP</b><br/>100pF<br/><i>pin 2 → GND</i>"]:::part
  N_SPK_P --"1"--> P_C_FBP
  P_J_SPK["<b>J_SPK</b><br/>SPEAKER"]:::part
  N_SPK_P --"1"--> P_J_SPK
  N_AMP_N(["AMP_N"]):::net
  P_U_AMP --"OUTN"--> N_AMP_N
  P_FB_N["<b>FB_N</b><br/>BLM21PG221SN1D"]:::part
  N_AMP_N --"1"--> P_FB_N
  N_SPK_N(["SPK_N"]):::net
  P_FB_N --"2"--> N_SPK_N
  P_C_FBN["<b>C_FBN</b><br/>100pF<br/><i>pin 2 → GND</i>"]:::part
  N_SPK_N --"1"--> P_C_FBN
  P_J_SPK --"2"--> N_SPK_N
```

| Net | connect every one of these |
|---|---|
| **I2S_DOUT** | `U_AMP.DIN`, `U_DAC.DIN` |
| **I2S_BCLK** | `U_AMP.BCLK`, `U_DAC.BCK` |
| **I2S_LRCLK** | `U_AMP.LRCLK`, `U_DAC.LRCK` |
| **SDM** | `U_AMP.~{SD_MODE}`, `R_SDM.1` |
| **AMP_P** | `U_AMP.OUTP`, `FB_P.1` |
| **SPK_P** | `FB_P.2`, `C_FBP.1`, `J_SPK.1` |
| **AMP_N** | `U_AMP.OUTN`, `FB_N.1` |
| **SPK_N** | `FB_N.2`, `C_FBN.1`, `J_SPK.2` |

## Line-out DAC (PCM5102A) → 3.5 mm jack

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_XSMT(["XSMT"]):::net
  P_U_DAC["<b>U_DAC</b><br/>PCM5102APWR<br/><i>pin DVDD → +3V3</i><br/><i>pin AVDD → +3V3</i><br/><i>pin CPVDD → +3V3</i><br/><i>pin DGND → GND</i><br/><i>pin AGND → GND</i><br/><i>pin CPGND → GND</i><br/><i>pin FLT → GND</i><br/><i>pin FMT → GND</i><br/><i>pin DEMP → GND</i><br/><i>pin SCK → GND</i>"]:::part
  P_U_DAC --"XSMT"--> N_XSMT
  P_R_XSMT["<b>R_XSMT</b><br/>10k<br/><i>pin 2 → +3V3</i>"]:::part
  N_XSMT --"1"--> P_R_XSMT
  N_CP_FLY_P(["CP_FLY_P"]):::net
  P_U_DAC --"CAPP"--> N_CP_FLY_P
  P_C_CP["<b>C_CP</b><br/>2.2uF"]:::part
  N_CP_FLY_P --"1"--> P_C_CP
  N_CP_FLY_M(["CP_FLY_M"]):::net
  P_U_DAC --"CAPM"--> N_CP_FLY_M
  P_C_CP --"2"--> N_CP_FLY_M
  N_VNEG_N(["VNEG_N"]):::net
  P_U_DAC --"VNEG"--> N_VNEG_N
  P_C_VNEG["<b>C_VNEG</b><br/>2.2uF<br/><i>pin 2 → GND</i>"]:::part
  N_VNEG_N --"1"--> P_C_VNEG
  N_LDO_N(["LDO_N"]):::net
  P_U_DAC --"LDOO"--> N_LDO_N
  P_C_LDO1["<b>C_LDO1</b><br/>10uF/16V<br/><i>pin 2 → GND</i>"]:::part
  N_LDO_N --"1"--> P_C_LDO1
  P_C_LDO2["<b>C_LDO2</b><br/>100nF<br/><i>pin 2 → GND</i>"]:::part
  N_LDO_N --"1"--> P_C_LDO2
  N_OUT_L(["OUT_L"]):::net
  P_U_DAC --"OUTL"--> N_OUT_L
  P_R_OL["<b>R_OL</b><br/>470R"]:::part
  N_OUT_L --"1"--> P_R_OL
  N_LINE_L(["LINE_L"]):::net
  P_R_OL --"2"--> N_LINE_L
  P_C_OL["<b>C_OL</b><br/>2.2nF<br/><i>pin 2 → GND</i>"]:::part
  N_LINE_L --"1"--> P_C_OL
  P_J_LINE["<b>J_LINE</b><br/>LINE_OUT<br/><i>pin 2 → GND</i><br/><i>pin 5 → GND</i>"]:::part
  N_LINE_L --"4"--> P_J_LINE
  N_OUT_R(["OUT_R"]):::net
  P_U_DAC --"OUTR"--> N_OUT_R
  P_R_OR["<b>R_OR</b><br/>470R"]:::part
  N_OUT_R --"1"--> P_R_OR
  N_LINE_R(["LINE_R"]):::net
  P_R_OR --"2"--> N_LINE_R
  P_C_OR["<b>C_OR</b><br/>2.2nF<br/><i>pin 2 → GND</i>"]:::part
  N_LINE_R --"1"--> P_C_OR
  P_J_LINE --"3"--> N_LINE_R
```

| Net | connect every one of these |
|---|---|
| **XSMT** | `U_DAC.XSMT`, `R_XSMT.1` |
| **CP_FLY_P** | `U_DAC.CAPP`, `C_CP.1` |
| **CP_FLY_M** | `U_DAC.CAPM`, `C_CP.2` |
| **VNEG_N** | `U_DAC.VNEG`, `C_VNEG.1` |
| **LDO_N** | `U_DAC.LDOO`, `C_LDO1.1`, `C_LDO2.1` |
| **OUT_L** | `U_DAC.OUTL`, `R_OL.1` |
| **LINE_L** | `R_OL.2`, `C_OL.1`, `J_LINE.4` |
| **OUT_R** | `U_DAC.OUTR`, `R_OR.1` |
| **LINE_R** | `R_OR.2`, `C_OR.1`, `J_LINE.3` |

## microSD — SDMMC 1-bit

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  N_SD_CLK(["SD_CLK"]):::net
  P_U_SD["<b>U_SD</b><br/>TF-01A<br/><i>pin VDD → +3V3</i><br/><i>pin VSS → GND</i><br/><i>pin GND → GND</i><br/><i>pin GND → GND</i><br/><i>pin GND → GND</i><br/><i>pin GND → GND</i>"]:::part
  P_U_SD --"CLK(SCLK)"--> N_SD_CLK
  N_SD_CMD(["SD_CMD"]):::net
  P_U_SD --"CMD(DI)"--> N_SD_CMD
  P_R_CMD["<b>R_CMD</b><br/>10k<br/><i>pin 2 → +3V3</i>"]:::part
  N_SD_CMD --"1"--> P_R_CMD
  N_SD_D0(["SD_D0"]):::net
  P_U_SD --"DAT0(D0)"--> N_SD_D0
  P_R_D0["<b>R_D0</b><br/>10k<br/><i>pin 2 → +3V3</i>"]:::part
  N_SD_D0 --"1"--> P_R_D0
  N_SD_D3(["SD_D3"]):::net
  P_U_SD --"CDDAT3(CS)"--> N_SD_D3
  P_R_DAT3["<b>R_DAT3</b><br/>10k<br/><i>pin 2 → +3V3</i>"]:::part
  N_SD_D3 --"1"--> P_R_DAT3
  N_CARD_DET(["CARD_DET"]):::net
  P_U_SD --"CD"--> N_CARD_DET
  P_TP_CD["<b>TP_CD</b><br/>TP_CD"]:::part
  N_CARD_DET --"1"--> P_TP_CD
```

| Net | connect every one of these |
|---|---|
| **SD_CLK** | `U_SD.CLK(SCLK)` |
| **SD_CMD** | `U_SD.CMD(DI)`, `R_CMD.1` |
| **SD_D0** | `U_SD.DAT0(D0)`, `R_D0.1` |
| **SD_D3** | `U_SD.CDDAT3(CS)`, `R_DAT3.1` |
| **CARD_DET** | `U_SD.CD`, `TP_CD.1` |

## Rail-only parts ×10 — decoupling; wire each pin to its rail symbol, place beside its chip

```mermaid
graph LR
  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666
  P_C_A1["<b>C_A1</b><br/>10uF/16V<br/><i>pin 1 → +5V</i><br/><i>pin 2 → GND</i>"]:::part
  P_C_A2["<b>C_A2</b><br/>100nF<br/><i>pin 1 → +5V</i><br/><i>pin 2 → GND</i>"]:::part
  P_C_SD1["<b>C_SD1</b><br/>10uF/16V<br/><i>pin 1 → +3V3</i><br/><i>pin 2 → GND</i>"]:::part
  P_C_SD2["<b>C_SD2</b><br/>100nF<br/><i>pin 1 → +3V3</i><br/><i>pin 2 → GND</i>"]:::part
  P_C_DV1["<b>C_DV1</b><br/>10uF/16V<br/><i>pin 1 → +3V3</i><br/><i>pin 2 → GND</i>"]:::part
  P_C_DV2["<b>C_DV2</b><br/>100nF<br/><i>pin 1 → +3V3</i><br/><i>pin 2 → GND</i>"]:::part
  P_C_AV1["<b>C_AV1</b><br/>10uF/16V<br/><i>pin 1 → +3V3</i><br/><i>pin 2 → GND</i>"]:::part
  P_C_AV2["<b>C_AV2</b><br/>100nF<br/><i>pin 1 → +3V3</i><br/><i>pin 2 → GND</i>"]:::part
  P_C_CPV1["<b>C_CPV1</b><br/>10uF/16V<br/><i>pin 1 → +3V3</i><br/><i>pin 2 → GND</i>"]:::part
  P_C_CPV2["<b>C_CPV2</b><br/>100nF<br/><i>pin 1 → +3V3</i><br/><i>pin 2 → GND</i>"]:::part
```

| Net | connect every one of these |
|---|---|

## GND

Every pin below goes to the GND symbol:

`U_AMP.GND`, `U_AMP.GND`, `U_AMP.GND`, `U_AMP.GAIN_SLOT`, `U_AMP.EP`, `C_FBP.2`, `C_FBN.2`, `C_A1.2`, `C_A2.2`, `U_SD.VSS`, `U_SD.GND`, `U_SD.GND`, `U_SD.GND`, `U_SD.GND`, `C_SD1.2`, `C_SD2.2`, `U_DAC.DGND`, `U_DAC.AGND`, `U_DAC.CPGND`, `U_DAC.FLT`, `U_DAC.FMT`, `U_DAC.DEMP`, `U_DAC.SCK`, `C_VNEG.2`, `C_OL.2`, `C_OR.2`, `C_DV1.2`, `C_DV2.2`, `C_LDO1.2`, `C_LDO2.2`, `C_AV1.2`, `C_AV2.2`, `C_CPV1.2`, `C_CPV2.2`, `J_LINE.2`, `J_LINE.5`

## +5V

Every pin below goes to the +5V symbol:

`U_AMP.VDD`, `U_AMP.VDD`, `C_A1.1`, `C_A2.1`

## +3V3

Every pin below goes to the +3V3 symbol:

`U_SD.VDD`, `C_SD1.1`, `C_SD2.1`, `R_CMD.2`, `R_D0.2`, `R_DAT3.2`, `R_SDM.2`, `U_DAC.DVDD`, `U_DAC.AVDD`, `U_DAC.CPVDD`, `R_XSMT.2`, `C_DV1.1`, `C_DV2.1`, `C_AV1.1`, `C_AV2.1`, `C_CPV1.1`, `C_CPV2.1`
