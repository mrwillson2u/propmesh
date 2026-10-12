// GENERATED FILE — DO NOT EDIT
// Source: boards/*.yaml   Regenerate: python3 tools/genboards.py

import { ChannelKind } from "./proto_gen";

export const Cap = {
  IN: 0x01,
  OUT: 0x02,
  PULLUP: 0x04,
  PULLDOWN: 0x08,
  ADC: 0x10,
  WAKE: 0x20,
} as const;

export type PinTier = "good" | "caution" | "reserved";

export interface BoardPin {
  gpio: number;
  label: string; // silkscreen
  caps: number; // Cap mask
  tier: PinTier;
  note?: string; // warning text
  best?: ChannelKindName; // recommended use (advice only)
  also?: ChannelKindName[]; // other good uses
}

export interface Board {
  id: string;
  name: string;
  mcu: string;
  ledcChannels: number;
  rmtTxChannels: number;
  battery?: { gpio: number; divider: number }; // VBAT sense pin, VBAT = reading * divider
  pins: BoardPin[];
  guide: Partial<Record<ChannelKindName, string>>; // why those pins, per function
}

export type ChannelKindName = keyof typeof ChannelKind;

export interface FunctionDef {
  kind: ChannelKindName;
  label: string;
  pins: { role: string; need: number }[];
  ledc: number;
  rmt: number;
  pwmHz: number;
  min: number;
  max: number;
}

export const FUNCTIONS: Record<ChannelKindName, FunctionDef> = {
  RELAY: { kind: "RELAY", label: "Relay / on-off output", pins: [{ role: "OUT", need: 0x02 }], ledc: 0, rmt: 0, pwmHz: 0, min: 0, max: 1 },
  LED: { kind: "LED", label: "LED dimmer (PWM)", pins: [{ role: "OUT", need: 0x02 }], ledc: 1, rmt: 0, pwmHz: 1000, min: 0, max: 1000 },
  SERVO: { kind: "SERVO", label: "Servo", pins: [{ role: "SIGNAL", need: 0x02 }], ledc: 1, rmt: 0, pwmHz: 50, min: 0, max: 1000 },
  MOTOR: { kind: "MOTOR", label: "DC motor (H-bridge IN1/IN2)", pins: [{ role: "IN1", need: 0x02 }, { role: "IN2", need: 0x02 }], ledc: 2, rmt: 0, pwmHz: 25000, min: -1000, max: 1000 },
  LED_STRIP: { kind: "LED_STRIP", label: "LED strip (WS2812)", pins: [{ role: "DATA", need: 0x02 }], ledc: 0, rmt: 1, pwmHz: 0, min: 0, max: 16777215 },
  DIGITAL_IN: { kind: "DIGITAL_IN", label: "Sensor / button input", pins: [{ role: "IN", need: 0x01 }], ledc: 0, rmt: 0, pwmHz: 0, min: 0, max: 1 },
  BLE_LIGHT: { kind: "BLE_LIGHT", label: "BLE flood light (BRMesh)", pins: [], ledc: 0, rmt: 0, pwmHz: 0, min: 0, max: 2147483647 },
  SPI_STRIP: { kind: "SPI_STRIP", label: "LED strip (SK9822 / APA102, clocked)", pins: [{ role: "DATA", need: 0x02 }, { role: "CLOCK", need: 0x02 }], ledc: 0, rmt: 0, pwmHz: 0, min: 0, max: 16777215 },
};

export const BOARDS: Record<string, Board> = {
  "esp32-c6-supermini": {
    id: "esp32-c6-supermini",
    name: "ESP32-C6 SuperMini",
    mcu: "ESP32-C6FH4",
    ledcChannels: 6,
    rmtTxChannels: 2,
    battery: undefined,
    pins: [
      { gpio: 0, label: "0", caps: 0x3f, tier: "good", best: "DIGITAL_IN", also: ["SERVO", "RELAY"] },
      { gpio: 1, label: "1", caps: 0x3f, tier: "good", best: "DIGITAL_IN", also: ["SERVO", "RELAY"] },
      { gpio: 2, label: "2", caps: 0x3f, tier: "good", best: "DIGITAL_IN", also: ["SERVO", "RELAY"] },
      { gpio: 3, label: "3", caps: 0x3f, tier: "good", best: "DIGITAL_IN", also: ["SERVO", "RELAY"] },
      { gpio: 4, label: "4", caps: 0x3f, tier: "good", note: "strapping pin (SDIO timing) — sampled at power-up but harmless for anything this board does", best: "DIGITAL_IN", also: ["SERVO", "RELAY"] },
      { gpio: 5, label: "5", caps: 0x3f, tier: "good", note: "strapping pin (SDIO timing) — sampled at power-up but harmless for anything this board does", best: "DIGITAL_IN", also: ["SERVO", "RELAY"] },
      { gpio: 6, label: "6", caps: 0x3f, tier: "good", best: "DIGITAL_IN", also: ["SERVO", "RELAY"] },
      { gpio: 7, label: "7", caps: 0x2f, tier: "good", best: "SERVO", also: ["MOTOR", "RELAY", "LED"] },
      { gpio: 8, label: "8", caps: 0x02, tier: "caution", note: "STRAPPING + the onboard RGB pixel's data line (WS2812). LED_STRIP with 1 pixel lights it; nothing else belongs here", best: "LED_STRIP" },
      { gpio: 9, label: "9", caps: 0x0d, tier: "caution", note: "STRAPPING + the BOOT button: low at reset = download mode. A button here is fine (don't hold it while resetting); inputs only", best: "DIGITAL_IN" },
      { gpio: 15, label: "15", caps: 0x02, tier: "caution", note: "STRAPPING + the blue status LED on most boards: outputs only, and nothing that pulls it low at reset", best: "LED", also: ["LED_STRIP"] },
      { gpio: 16, label: "16", caps: 0x0f, tier: "caution", note: "UART0 TX: the boot ROM prints here at power-up — fine for a light or strip, not for a relay or motor. The console uses USB, not this pin", best: "LED", also: ["LED_STRIP"] },
      { gpio: 17, label: "17", caps: 0x0f, tier: "good", note: "UART0 RX — unused here (the console runs on USB)", best: "RELAY", also: ["SERVO", "MOTOR"] },
      { gpio: 14, label: "14", caps: 0x0f, tier: "good", best: "SERVO", also: ["MOTOR", "RELAY", "LED"] },
      { gpio: 18, label: "18", caps: 0x0f, tier: "good", best: "MOTOR", also: ["SERVO", "RELAY"] },
      { gpio: 19, label: "19", caps: 0x0f, tier: "good", best: "MOTOR", also: ["SERVO", "RELAY"] },
      { gpio: 20, label: "20", caps: 0x0f, tier: "good", best: "LED_STRIP", also: ["RELAY", "SERVO", "LED"] },
      { gpio: 21, label: "21", caps: 0x0f, tier: "good", best: "LED_STRIP", also: ["RELAY", "SERVO", "LED"] },
      { gpio: 22, label: "22", caps: 0x0f, tier: "good", best: "RELAY", also: ["SERVO", "MOTOR"] },
      { gpio: 23, label: "23", caps: 0x0f, tier: "good", best: "RELAY", also: ["SERVO", "MOTOR"] },
      { gpio: 12, label: "12", caps: 0x00, tier: "reserved", note: "USB D− — the console and the flasher live on the USB port" },
      { gpio: 13, label: "13", caps: 0x00, tier: "reserved", note: "USB D+ — the console and the flasher live on the USB port" },
    ],
    guide: {
      SERVO: "Quiet at power-up, so nothing twitches while the board boots.",
      MOTOR: "A quiet pair side by side for IN1 / IN2 — a motor never lurches at boot.",
      RELAY: "Quiet at power-up, so a relay never clicks on during boot.",
      LED_STRIP: "Any output can drive a strip; the C6 has two strip engines (RMT), so two strips at most. 3.3 V board — use a 74AHCT-type level shifter for 5 V strips.",
      LED: "The boot-quirk pins — a flicker at power-up doesn't matter for a light. 15 is the blue status LED on most SuperMinis.",
      DIGITAL_IN: "GPIO 0–7 are the low-power pins: the only ones that can wake the board from deep sleep on battery. All have internal pull-ups, so buttons need no resistor. 0–6 also read analog.",
    },
  },
  "esp32-devkit-v1": {
    id: "esp32-devkit-v1",
    name: "ESP32 DevKit V1 (30-pin)",
    mcu: "ESP32-WROOM-32",
    ledcChannels: 16,
    rmtTxChannels: 8,
    battery: undefined,
    pins: [
      { gpio: 36, label: "VP", caps: 0x31, tier: "good", note: "input only, no internal pull — a button here needs an external resistor", best: "DIGITAL_IN" },
      { gpio: 39, label: "VN", caps: 0x31, tier: "good", note: "input only, no internal pull — a button here needs an external resistor", best: "DIGITAL_IN" },
      { gpio: 34, label: "D34", caps: 0x31, tier: "good", note: "input only, no internal pull — a button here needs an external resistor", best: "DIGITAL_IN" },
      { gpio: 35, label: "D35", caps: 0x31, tier: "good", note: "input only, no internal pull — a button here needs an external resistor", best: "DIGITAL_IN" },
      { gpio: 32, label: "D32", caps: 0x3f, tier: "good", best: "DIGITAL_IN", also: ["SERVO", "RELAY"] },
      { gpio: 33, label: "D33", caps: 0x3f, tier: "good", best: "DIGITAL_IN", also: ["SERVO", "RELAY"] },
      { gpio: 25, label: "D25", caps: 0x2f, tier: "good", best: "SERVO", also: ["MOTOR", "RELAY", "LED"] },
      { gpio: 26, label: "D26", caps: 0x2f, tier: "good", best: "SERVO", also: ["MOTOR", "RELAY", "LED"] },
      { gpio: 27, label: "D27", caps: 0x2f, tier: "good", best: "SERVO", also: ["MOTOR", "RELAY", "LED"] },
      { gpio: 14, label: "D14", caps: 0x2f, tier: "caution", note: "pulses briefly at power-up — a relay or motor here may twitch on boot", best: "LED", also: ["LED_STRIP"] },
      { gpio: 12, label: "D12", caps: 0x02, tier: "caution", note: "STRAPPING: must be LOW at power-up or the board will not boot. Outputs only, and nothing that pulls it high (many relay modules do)", best: "LED" },
      { gpio: 13, label: "D13", caps: 0x2f, tier: "good", best: "SERVO", also: ["RELAY", "MOTOR"] },
      { gpio: 23, label: "D23", caps: 0x0f, tier: "good", best: "RELAY", also: ["SERVO", "MOTOR"] },
      { gpio: 22, label: "D22", caps: 0x0f, tier: "good", best: "RELAY", also: ["SERVO", "MOTOR"] },
      { gpio: 1, label: "TX0", caps: 0x00, tier: "reserved", note: "USB serial — the console and the flasher live here" },
      { gpio: 3, label: "RX0", caps: 0x00, tier: "reserved", note: "USB serial — the console and the flasher live here" },
      { gpio: 21, label: "D21", caps: 0x0f, tier: "good", best: "RELAY", also: ["SERVO", "MOTOR"] },
      { gpio: 19, label: "D19", caps: 0x0f, tier: "good", best: "MOTOR", also: ["SERVO", "RELAY"] },
      { gpio: 18, label: "D18", caps: 0x0f, tier: "good", best: "MOTOR", also: ["SERVO", "RELAY"] },
      { gpio: 5, label: "D5", caps: 0x02, tier: "caution", note: "STRAPPING: pulled high and pulses at power-up — fine for an LED or strip, not for a relay or motor", best: "LED", also: ["LED_STRIP"] },
      { gpio: 17, label: "TX2", caps: 0x0f, tier: "good", best: "LED_STRIP", also: ["RELAY", "SERVO", "LED"] },
      { gpio: 16, label: "RX2", caps: 0x0f, tier: "good", best: "LED_STRIP", also: ["RELAY", "SERVO", "LED"] },
      { gpio: 4, label: "D4", caps: 0x2f, tier: "good", best: "SERVO", also: ["RELAY", "MOTOR"] },
      { gpio: 2, label: "D2", caps: 0x02, tier: "caution", note: "STRAPPING + the onboard blue LED. Outputs only; anything holding it high blocks flashing", best: "LED" },
      { gpio: 15, label: "D15", caps: 0x02, tier: "caution", note: "STRAPPING: pulled high and pulses at power-up — fine for an LED or strip, not for a relay or motor", best: "LED", also: ["LED_STRIP"] },
    ],
    guide: {
      SERVO: "Quiet at power-up, so nothing twitches while the board boots.",
      MOTOR: "A quiet pair side by side for IN1 / IN2 — a motor never lurches at boot.",
      RELAY: "Quiet at power-up, so a relay never clicks on during boot.",
      LED_STRIP: "Any output can drive a strip; these keep strips together. Use a 74AHCT-type level shifter for 5 V strips.",
      LED: "The boot-quirk pins — a flicker at power-up doesn't matter for a light, and it keeps the quiet pins free. D2 is the onboard blue LED.",
      DIGITAL_IN: "Input-only pins don't use up outputs. VP / VN / D34 / D35 have no pull resistor — fine for PIR and beam sensors, which drive their own output. Buttons go on D32 / D33, which have internal pull-ups.",
    },
  },
  "esp32-huzzah32": {
    id: "esp32-huzzah32",
    name: "Adafruit HUZZAH32 Feather",
    mcu: "ESP32-WROOM-32",
    ledcChannels: 16,
    rmtTxChannels: 8,
    battery: {"gpio": 35, "divider": 2.0},
    pins: [
      { gpio: 26, label: "A0", caps: 0x2f, tier: "good", note: "also DAC2", best: "SERVO", also: ["MOTOR", "RELAY", "LED"] },
      { gpio: 25, label: "A1", caps: 0x2f, tier: "good", note: "also DAC1", best: "SERVO", also: ["MOTOR", "RELAY", "LED"] },
      { gpio: 34, label: "A2", caps: 0x31, tier: "good", note: "input only, no internal pull — a button here needs an external resistor", best: "DIGITAL_IN" },
      { gpio: 39, label: "A3", caps: 0x31, tier: "good", note: "input only, no internal pull — a button here needs an external resistor", best: "DIGITAL_IN" },
      { gpio: 36, label: "A4", caps: 0x31, tier: "good", note: "input only, no internal pull — a button here needs an external resistor", best: "DIGITAL_IN" },
      { gpio: 4, label: "A5", caps: 0x3f, tier: "good", best: "SERVO", also: ["RELAY", "MOTOR"] },
      { gpio: 5, label: "SCK", caps: 0x02, tier: "caution", note: "STRAPPING: pulled high and pulses at power-up — fine for an LED or strip, not for a relay or motor", best: "LED", also: ["LED_STRIP"] },
      { gpio: 18, label: "MO", caps: 0x0f, tier: "good", best: "MOTOR", also: ["SERVO", "RELAY"] },
      { gpio: 19, label: "MI", caps: 0x0f, tier: "good", best: "MOTOR", also: ["SERVO", "RELAY"] },
      { gpio: 16, label: "RX", caps: 0x0f, tier: "good", best: "LED_STRIP", also: ["RELAY", "SERVO", "LED"] },
      { gpio: 17, label: "TX", caps: 0x0f, tier: "good", best: "LED_STRIP", also: ["RELAY", "SERVO", "LED"] },
      { gpio: 21, label: "21", caps: 0x0f, tier: "good", best: "RELAY", also: ["SERVO", "MOTOR"] },
      { gpio: 23, label: "SDA", caps: 0x0f, tier: "good", best: "RELAY", also: ["SERVO", "MOTOR"] },
      { gpio: 22, label: "SCL", caps: 0x0f, tier: "good", best: "RELAY", also: ["SERVO", "MOTOR"] },
      { gpio: 14, label: "14", caps: 0x2f, tier: "caution", note: "pulses briefly at power-up — a relay or motor here may twitch on boot", best: "LED", also: ["LED_STRIP"] },
      { gpio: 32, label: "32", caps: 0x3f, tier: "good", best: "DIGITAL_IN", also: ["SERVO", "RELAY"] },
      { gpio: 15, label: "15", caps: 0x02, tier: "caution", note: "STRAPPING: pulled high and pulses at power-up — fine for an LED or strip, not for a relay or motor", best: "LED", also: ["LED_STRIP"] },
      { gpio: 33, label: "33", caps: 0x3f, tier: "good", best: "DIGITAL_IN", also: ["SERVO", "RELAY"] },
      { gpio: 27, label: "27", caps: 0x2f, tier: "good", best: "SERVO", also: ["MOTOR", "RELAY", "LED"] },
      { gpio: 12, label: "12", caps: 0x02, tier: "caution", note: "STRAPPING: must be LOW at power-up or the board will not boot. Outputs only, and nothing that pulls it high (many relay modules do)", best: "LED" },
      { gpio: 13, label: "13", caps: 0x2f, tier: "caution", note: "the onboard red LED shares this pin, and it pulses at power-up — a light, not a relay or motor", best: "LED", also: ["LED_STRIP"] },
      { gpio: 35, label: "A13", caps: 0x00, tier: "reserved", note: "battery voltage (VBAT/2) — read by the firmware for the battery gauge" },
      { gpio: 1, label: "TX0", caps: 0x00, tier: "reserved", note: "USB serial — the console and the flasher live here" },
      { gpio: 3, label: "RX0", caps: 0x00, tier: "reserved", note: "USB serial — the console and the flasher live here" },
    ],
    guide: {
      SERVO: "Quiet at power-up, so nothing twitches while the board boots.",
      MOTOR: "A quiet pair side by side for IN1 / IN2 — a motor never lurches at boot.",
      RELAY: "Quiet at power-up, so a relay never clicks on during boot.",
      LED_STRIP: "Any output can drive a strip. The Feather is 3.3 V with no 5 V pin when on battery — a 5 V strip needs its own supply and a level shifter.",
      LED: "GPIO 13 is the onboard red LED. The boot-quirk pins (5, 12, 15) suit a light, where a flicker at power-up doesn't matter.",
      DIGITAL_IN: "A2 / A3 / A4 (GPIO 34 / 39 / 36) are input-only with no pull — fine for PIR and beam sensors. Buttons go on 32 / 33 / 27, which have internal pull-ups. On battery the wake-up sensor goes on one of these.",
    },
  },
};
