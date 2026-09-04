// GENERATED FILE — DO NOT EDIT
// Source: pinmap.yaml   Regenerate: python3 tools/genpins.py

#ifndef PROPMESH_PINS_MINI_H
#define PROPMESH_PINS_MINI_H

// Board: mini   MCU: ESP32-C3-MINI-1U-N4

#define PIN_ANALOG_IN_1           0  // ADC1
#define PIN_BATTERY_SENSE         1  // 1M divider + FET disconnect for sleep
#define PIN_RAIL_5V_ENABLE        2  // STRAPPING — ACTIVE-LOW. Pull-up = strap-safe boot AND rail off in deep sleep with the pin released (no GPIO hold). Drive LOW to enable. MANDATORY for sleep current.
#define PIN_IR_RX                 3  // RMT RX; RTC-capable — can wake from deep sleep
#define PIN_DIGITAL_IN_1          4  // RTC-capable — the deep-sleep wake input (PIR)
#define PIN_I2S_LRCLK             5
#define PIN_I2S_DOUT              6
#define PIN_LED_STRIP_1_DATA      7  // RMT TX, via 74AHCT1G125
#define PIN_I2C_SDA               8  // STRAPPING — I2C pull-up holds it high at boot
#define PIN_BOOT_BUTTON           9  // strapping
#define PIN_I2C_SCL               10
#define PIN_USB_DM                18  // console over native USB Serial/JTAG
#define PIN_USB_DP                19
#define PIN_I2S_BCLK              20  // U0RXD repurposed
#define PIN_DIGITAL_IN_2          21  // U0TXD repurposed — ROM boot log drives it at reset; 1k series R

#define PCA9685_ADDR 0x40

#define PCA_SERVO_1      0
#define PCA_SERVO_2      1
#define PCA_SERVO_3      2
#define PCA_LED_1        3
#define PCA_LED_2        4
#define PCA_LED_3        5
#define PCA_LED_4        6
#define PCA_RELAY_1      7

#define MOTOR_PWM_HZ 25000
#define SERVO_PWM_HZ 50
#define LED_PWM_HZ 1000

#endif  // PROPMESH_PINS_MINI_H
