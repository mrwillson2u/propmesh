// GENERATED FILE — DO NOT EDIT
// Source: boards/*.yaml   Regenerate: python3 tools/genboards.py

#pragma once
#include <stdint.h>
#include "proto_gen.h"

#define PM_CAP_IN 0x01
#define PM_CAP_OUT 0x02
#define PM_CAP_PULLUP 0x04
#define PM_CAP_PULLDOWN 0x08
#define PM_CAP_ADC 0x10
#define PM_CAP_WAKE 0x20

#define PM_TIER_GOOD 0
#define PM_TIER_CAUTION 1
#define PM_TIER_RESERVED 2

#define PM_FN_MAX_PINS 2

typedef struct {
    uint8_t gpio;
    uint8_t caps;   // PM_CAP_* mask
    uint8_t tier;   // PM_TIER_*
    const char *label;  // silkscreen
    const char *note;   // warning text, or nullptr
} pm_board_pin_t;

typedef struct {
    const char *id;
    const char *name;
    const char *mcu;
    uint8_t board_type;  // pm_board_type_t
    uint8_t ledc_channels;
    uint8_t rmt_tx_channels;
    uint8_t battery_gpio;    // 0 = no battery sense
    float battery_divider;   // VBAT = reading * divider
    uint8_t pin_count;
    const pm_board_pin_t *pins;
} pm_board_t;

typedef struct {
    uint8_t kind;  // pm_channel_kind_t
    const char *name;
    uint8_t pin_count;
    uint8_t need[PM_FN_MAX_PINS];  // PM_CAP_* required per pin
    const char *role[PM_FN_MAX_PINS];
    uint8_t ledc;  // LEDC channels used per instance
    uint8_t rmt;   // RMT TX channels used per instance
    uint32_t pwm_hz;
    int32_t value_min;
    int32_t value_max;
} pm_function_t;

static const pm_function_t PM_FUNCTIONS[] = {
    {PM_CHANNEL_KIND_RELAY, "RELAY", 1, {PM_CAP_OUT}, {"OUT"}, 0, 0, 0, 0, 1},
    {PM_CHANNEL_KIND_LED, "LED", 1, {PM_CAP_OUT}, {"OUT"}, 1, 0, 1000, 0, 1000},
    {PM_CHANNEL_KIND_SERVO, "SERVO", 1, {PM_CAP_OUT}, {"SIGNAL"}, 1, 0, 50, 0, 1000},
    {PM_CHANNEL_KIND_MOTOR, "MOTOR", 2, {PM_CAP_OUT, PM_CAP_OUT}, {"IN1", "IN2"}, 2, 0, 25000, -1000, 1000},
    {PM_CHANNEL_KIND_LED_STRIP, "LED_STRIP", 1, {PM_CAP_OUT}, {"DATA"}, 0, 1, 0, 0, 16777215},
    {PM_CHANNEL_KIND_DIGITAL_IN, "DIGITAL_IN", 1, {PM_CAP_IN}, {"IN"}, 0, 0, 0, 0, 1},
    {PM_CHANNEL_KIND_BLE_LIGHT, "BLE_LIGHT", 0, {0}, {nullptr}, 0, 0, 0, 0, 2147483647},
    {PM_CHANNEL_KIND_SPI_STRIP, "SPI_STRIP", 2, {PM_CAP_OUT, PM_CAP_OUT}, {"DATA", "CLOCK"}, 0, 0, 0, 0, 16777215},
    {PM_CHANNEL_KIND_CANDLE, "CANDLE", 2, {PM_CAP_OUT, PM_CAP_OUT}, {"LIGHT", "COIL"}, 1, 0, 1000, 0, 1000},
};
#define PM_FUNCTION_COUNT 9

// ESP32-C3 SuperMini — ESP32-C3FH4
static const pm_board_pin_t PM_BOARD_ESP32_C3_SUPERMINI_PINS[] = {
    {0, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "0", nullptr},
    {1, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "1", nullptr},
    {2, PM_CAP_OUT, PM_TIER_CAUTION, "2", "STRAPPING: must be HIGH at power-up or the board will not boot. Outputs only, and nothing that holds it low at reset (a PIR's output idles low)"},
    {3, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "3", nullptr},
    {4, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "4", "also JTAG TMS — harmless for anything this board does"},
    {5, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_WAKE, PM_TIER_GOOD, "5", "its analog input is ADC2, which the radio blocks — digital only here"},
    {6, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "6", nullptr},
    {7, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "7", nullptr},
    {10, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "10", nullptr},
    {20, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "20", "UART0 RX — unused here (the console runs on USB)"},
    {8, PM_CAP_OUT, PM_TIER_CAUTION, "8", "STRAPPING + the onboard blue LED (on = LOW; a WS2812 pixel on the Plus). Outputs only; anything holding it low at reset blocks flashing"},
    {9, PM_CAP_IN | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_CAUTION, "9", "STRAPPING + the BOOT button: low at reset = download mode. A button here is fine (don't hold it while resetting); inputs only"},
    {21, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_CAUTION, "21", "UART0 TX: the boot ROM prints here at power-up — fine for a light or strip, not for a relay or motor. The console uses USB, not this pin"},
    {18, 0, PM_TIER_RESERVED, "18", "USB D− — the console and the flasher live on the USB port"},
    {19, 0, PM_TIER_RESERVED, "19", "USB D+ — the console and the flasher live on the USB port"},
};
static const pm_board_t PM_BOARD_ESP32_C3_SUPERMINI = {
    "esp32-c3-supermini", "ESP32-C3 SuperMini", "ESP32-C3FH4",
    PM_BOARD_TYPE_C3_SUPERMINI, 6, 2, 0, 0.0f, 15, PM_BOARD_ESP32_C3_SUPERMINI_PINS,
};

// ESP32-C6 SuperMini — ESP32-C6FH4
static const pm_board_pin_t PM_BOARD_ESP32_C6_SUPERMINI_PINS[] = {
    {0, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "0", nullptr},
    {1, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "1", nullptr},
    {2, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "2", nullptr},
    {3, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "3", nullptr},
    {4, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "4", "strapping pin (SDIO timing) — sampled at power-up but harmless for anything this board does"},
    {5, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "5", "strapping pin (SDIO timing) — sampled at power-up but harmless for anything this board does"},
    {6, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "6", nullptr},
    {7, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_WAKE, PM_TIER_GOOD, "7", nullptr},
    {8, PM_CAP_OUT, PM_TIER_CAUTION, "8", "STRAPPING + the onboard RGB pixel's data line (WS2812). LED_STRIP with 1 pixel lights it; nothing else belongs here"},
    {9, PM_CAP_IN | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_CAUTION, "9", "STRAPPING + the BOOT button: low at reset = download mode. A button here is fine (don't hold it while resetting); inputs only"},
    {15, PM_CAP_OUT, PM_TIER_CAUTION, "15", "STRAPPING + the blue status LED on most boards: outputs only, and nothing that pulls it low at reset"},
    {16, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_CAUTION, "16", "UART0 TX: the boot ROM prints here at power-up — fine for a light or strip, not for a relay or motor. The console uses USB, not this pin"},
    {17, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "17", "UART0 RX — unused here (the console runs on USB)"},
    {14, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "14", nullptr},
    {18, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "18", nullptr},
    {19, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "19", nullptr},
    {20, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "20", nullptr},
    {21, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "21", nullptr},
    {22, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "22", nullptr},
    {23, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "23", nullptr},
    {12, 0, PM_TIER_RESERVED, "12", "USB D− — the console and the flasher live on the USB port"},
    {13, 0, PM_TIER_RESERVED, "13", "USB D+ — the console and the flasher live on the USB port"},
};
static const pm_board_t PM_BOARD_ESP32_C6_SUPERMINI = {
    "esp32-c6-supermini", "ESP32-C6 SuperMini", "ESP32-C6FH4",
    PM_BOARD_TYPE_C6_SUPERMINI, 6, 2, 0, 0.0f, 22, PM_BOARD_ESP32_C6_SUPERMINI_PINS,
};

// ESP32 DevKit V1 (30-pin) — ESP32-WROOM-32
static const pm_board_pin_t PM_BOARD_ESP32_DEVKIT_V1_PINS[] = {
    {36, PM_CAP_IN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "VP", "input only, no internal pull — a button here needs an external resistor"},
    {39, PM_CAP_IN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "VN", "input only, no internal pull — a button here needs an external resistor"},
    {34, PM_CAP_IN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "D34", "input only, no internal pull — a button here needs an external resistor"},
    {35, PM_CAP_IN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "D35", "input only, no internal pull — a button here needs an external resistor"},
    {32, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "D32", nullptr},
    {33, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "D33", nullptr},
    {25, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_WAKE, PM_TIER_GOOD, "D25", nullptr},
    {26, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_WAKE, PM_TIER_GOOD, "D26", nullptr},
    {27, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_WAKE, PM_TIER_GOOD, "D27", nullptr},
    {14, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_WAKE, PM_TIER_CAUTION, "D14", "pulses briefly at power-up — a relay or motor here may twitch on boot"},
    {12, PM_CAP_OUT, PM_TIER_CAUTION, "D12", "STRAPPING: must be LOW at power-up or the board will not boot. Outputs only, and nothing that pulls it high (many relay modules do)"},
    {13, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_WAKE, PM_TIER_GOOD, "D13", nullptr},
    {23, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "D23", nullptr},
    {22, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "D22", nullptr},
    {1, 0, PM_TIER_RESERVED, "TX0", "USB serial — the console and the flasher live here"},
    {3, 0, PM_TIER_RESERVED, "RX0", "USB serial — the console and the flasher live here"},
    {21, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "D21", nullptr},
    {19, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "D19", nullptr},
    {18, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "D18", nullptr},
    {5, PM_CAP_OUT, PM_TIER_CAUTION, "D5", "STRAPPING: pulled high and pulses at power-up — fine for an LED or strip, not for a relay or motor"},
    {17, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "TX2", nullptr},
    {16, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "RX2", nullptr},
    {4, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_WAKE, PM_TIER_GOOD, "D4", nullptr},
    {2, PM_CAP_OUT, PM_TIER_CAUTION, "D2", "STRAPPING + the onboard blue LED. Outputs only; anything holding it high blocks flashing"},
    {15, PM_CAP_OUT, PM_TIER_CAUTION, "D15", "STRAPPING: pulled high and pulses at power-up — fine for an LED or strip, not for a relay or motor"},
};
static const pm_board_t PM_BOARD_ESP32_DEVKIT_V1 = {
    "esp32-devkit-v1", "ESP32 DevKit V1 (30-pin)", "ESP32-WROOM-32",
    PM_BOARD_TYPE_DEVKIT, 16, 8, 0, 0.0f, 25, PM_BOARD_ESP32_DEVKIT_V1_PINS,
};

// Adafruit HUZZAH32 Feather — ESP32-WROOM-32
static const pm_board_pin_t PM_BOARD_ESP32_HUZZAH32_PINS[] = {
    {26, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_WAKE, PM_TIER_GOOD, "A0", "also DAC2"},
    {25, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_WAKE, PM_TIER_GOOD, "A1", "also DAC1"},
    {34, PM_CAP_IN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "A2", "input only, no internal pull — a button here needs an external resistor"},
    {39, PM_CAP_IN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "A3", "input only, no internal pull — a button here needs an external resistor"},
    {36, PM_CAP_IN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "A4", "input only, no internal pull — a button here needs an external resistor"},
    {4, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "A5", nullptr},
    {5, PM_CAP_OUT, PM_TIER_CAUTION, "SCK", "STRAPPING: pulled high and pulses at power-up — fine for an LED or strip, not for a relay or motor"},
    {18, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "MO", nullptr},
    {19, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "MI", nullptr},
    {16, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "RX", nullptr},
    {17, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "TX", nullptr},
    {21, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "21", nullptr},
    {23, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "SDA", nullptr},
    {22, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN, PM_TIER_GOOD, "SCL", nullptr},
    {14, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_WAKE, PM_TIER_CAUTION, "14", "pulses briefly at power-up — a relay or motor here may twitch on boot"},
    {32, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "32", nullptr},
    {15, PM_CAP_OUT, PM_TIER_CAUTION, "15", "STRAPPING: pulled high and pulses at power-up — fine for an LED or strip, not for a relay or motor"},
    {33, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_ADC | PM_CAP_WAKE, PM_TIER_GOOD, "33", nullptr},
    {27, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_WAKE, PM_TIER_GOOD, "27", nullptr},
    {12, PM_CAP_OUT, PM_TIER_CAUTION, "12", "STRAPPING: must be LOW at power-up or the board will not boot. Outputs only, and nothing that pulls it high (many relay modules do)"},
    {13, PM_CAP_IN | PM_CAP_OUT | PM_CAP_PULLUP | PM_CAP_PULLDOWN | PM_CAP_WAKE, PM_TIER_CAUTION, "13", "the onboard red LED shares this pin, and it pulses at power-up — a light, not a relay or motor"},
    {35, 0, PM_TIER_RESERVED, "A13", "battery voltage (VBAT/2) — read by the firmware for the battery gauge"},
    {1, 0, PM_TIER_RESERVED, "TX0", "USB serial — the console and the flasher live here"},
    {3, 0, PM_TIER_RESERVED, "RX0", "USB serial — the console and the flasher live here"},
};
static const pm_board_t PM_BOARD_ESP32_HUZZAH32 = {
    "esp32-huzzah32", "Adafruit HUZZAH32 Feather", "ESP32-WROOM-32",
    PM_BOARD_TYPE_HUZZAH32, 16, 8, 35, 2.0f, 24, PM_BOARD_ESP32_HUZZAH32_PINS,
};
