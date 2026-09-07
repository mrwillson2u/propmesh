// GENERATED FILE — DO NOT EDIT
// Source: pinmap.yaml   Regenerate: python3 tools/genpins.py

#ifndef PROPMESH_PINS_PRO_H
#define PROPMESH_PINS_PRO_H

// Board: pro   MCU: ESP32-S3-WROOM-1U-N8R2

#define PIN_BOOT_BUTTON           0  // strapping
#define PIN_ANALOG_IN_1           1  // ADC1 — ADC2 unusable with WiFi
#define PIN_ANALOG_IN_2           2  // ADC1
#define PIN_LED_STRIP_1_CLK       3  // APA102 CLK via the 74AHCT541 octal shifter; 3-/4-wire is a firmware setting (mode jumper dropped 2026-09-06). Was IR_RX until 2026-09-05 — onboard IR is useless on a hidden board; a plug-in receiver goes on any DIGITAL_IN. Strapping (JTAG select): drives only a shifter input, internal pulldown holds the default at reset
#define PIN_LED_STRIP_1_DATA      4  // RMT TX, via the 74AHCT541; APA102 DATA in 4-wire mode
#define PIN_LED_STRIP_2_DATA      5  // RMT TX, via the 74AHCT541; APA102 DATA in 4-wire mode
#define PIN_LED_STRIP_2_CLK       6  // APA102 CLK via the 74AHCT541; 3-/4-wire is a firmware setting (mode jumper dropped 2026-09-06)
#define PIN_I2S_BCLK              7
#define PIN_I2C_SDA               8  // PCA9685 + Qwiic
#define PIN_I2C_SCL               9
#define PIN_DIGITAL_IN_1          10  // pull-up, clamp diodes, 1k series
#define PIN_DIGITAL_IN_2          11
#define PIN_DIGITAL_IN_3          12
#define PIN_STEPPER_1_STEP        13  // LEDC-capable — required for DC socket mode
#define PIN_STEPPER_1_DIR         14  // LEDC-capable
#define PIN_I2S_LRCLK             15
#define PIN_I2S_DOUT              16
#define PIN_TMC_UART_TX           17  // shared bus, MS1/MS2 address strapping
#define PIN_TMC_UART_RX           18
#define PIN_USB_DM                19  // native USB — console lives here
#define PIN_USB_DP                20
#define PIN_STEPPER_2_STEP        21  // LEDC-capable
#define PIN_MOTOR_B_IN1           35  // LEDC 25 kHz. Moved from GPIO33 2026-09-03: 33/34 are NOT BONDED on any WROOM-1 (Espressif DS v1.8 pin table). 35 is free on N8R2, octal-PSRAM on R8/R16V
#define PIN_MOTOR_B_IN2           36  // LEDC 25 kHz. Moved from GPIO34 — same finding as MOTOR_B_IN1
#define PIN_STATUS_LED            38  // WS2812B-mini @ 5V — data via buffer 4 of the 74AHCT541
#define PIN_SD_CLK                39  // SDMMC 1-bit
#define PIN_SD_CMD                40  // 10k pull-up
#define PIN_SD_D0                 41  // 10k pull-up
#define PIN_STEPPER_1_DIAG        42  // StallGuard; JP1 frees it for expansion
#define PIN_STEPPER_2_DIAG        43  // StallGuard; JP2 frees it for expansion. U0TXD — ROM boot log drives it at reset; 1k series R
#define PIN_MOTOR_A_IN1           44  // LEDC 25 kHz
#define PIN_EXPANSION_1           45  // STRAPPING — must be LOW at reset. 10k pulldown + 100R series.
#define PIN_EXPANSION_2           46  // STRAPPING — must be LOW at reset. 10k pulldown + 100R series.
#define PIN_STEPPER_2_DIR         47  // LEDC-capable
#define PIN_MOTOR_A_IN2           48  // LEDC 25 kHz

#define PCA9685_ADDR 0x40

#define PCA_SERVO_1             0
#define PCA_SERVO_2             1
#define PCA_SERVO_3             2
#define PCA_SERVO_4             3
#define PCA_SERVO_5             4
#define PCA_SERVO_6             5
#define PCA_LED_1               6
#define PCA_LED_2               7
#define PCA_LED_3               8
#define PCA_LED_4               9
#define PCA_LED_5               10
#define PCA_LED_6               11
#define PCA_RELAY_1             12
#define PCA_RELAY_2             13
#define PCA_RELAY_3             14
#define PCA_STEPPER_ENABLE      15

#define MOTOR_PWM_HZ 25000
#define SERVO_PWM_HZ 50
#define LED_PWM_HZ 1000

#endif  // PROPMESH_PINS_PRO_H
