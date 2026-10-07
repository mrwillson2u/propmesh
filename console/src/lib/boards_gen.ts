// GENERATED FILE — DO NOT EDIT
// Source: boards/*.yaml   Regenerate: python3 tools/genboards.py

import { ChannelKind } from "./proto_gen";

export const Cap = {
  IN: 0x01,
  OUT: 0x02,
  PULLUP: 0x04,
  PULLDOWN: 0x08,
  ADC: 0x10,
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
};

export const BOARDS: Record<string, Board> = {
  "esp32-devkit-v1": {
    id: "esp32-devkit-v1",
    name: "ESP32 DevKit V1 (30-pin)",
    mcu: "ESP32-WROOM-32",
    ledcChannels: 16,
    rmtTxChannels: 8,
    pins: [
      { gpio: 36, label: "VP", caps: 0x11, tier: "good", note: "input only, no internal pull — a button here needs an external resistor", best: "DIGITAL_IN" },
      { gpio: 39, label: "VN", caps: 0x11, tier: "good", note: "input only, no internal pull — a button here needs an external resistor", best: "DIGITAL_IN" },
      { gpio: 34, label: "D34", caps: 0x11, tier: "good", note: "input only, no internal pull — a button here needs an external resistor", best: "DIGITAL_IN" },
      { gpio: 35, label: "D35", caps: 0x11, tier: "good", note: "input only, no internal pull — a button here needs an external resistor", best: "DIGITAL_IN" },
      { gpio: 32, label: "D32", caps: 0x1f, tier: "good", best: "DIGITAL_IN", also: ["SERVO", "RELAY"] },
      { gpio: 33, label: "D33", caps: 0x1f, tier: "good", best: "DIGITAL_IN", also: ["SERVO", "RELAY"] },
      { gpio: 25, label: "D25", caps: 0x0f, tier: "good", best: "SERVO", also: ["MOTOR", "RELAY", "LED"] },
      { gpio: 26, label: "D26", caps: 0x0f, tier: "good", best: "SERVO", also: ["MOTOR", "RELAY", "LED"] },
      { gpio: 27, label: "D27", caps: 0x0f, tier: "good", best: "SERVO", also: ["MOTOR", "RELAY", "LED"] },
      { gpio: 14, label: "D14", caps: 0x0f, tier: "caution", note: "pulses briefly at power-up — a relay or motor here may twitch on boot", best: "LED", also: ["LED_STRIP"] },
      { gpio: 12, label: "D12", caps: 0x02, tier: "caution", note: "STRAPPING: must be LOW at power-up or the board will not boot. Outputs only, and nothing that pulls it high (many relay modules do)", best: "LED" },
      { gpio: 13, label: "D13", caps: 0x0f, tier: "good", best: "SERVO", also: ["RELAY", "MOTOR"] },
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
      { gpio: 4, label: "D4", caps: 0x0f, tier: "good", best: "SERVO", also: ["RELAY", "MOTOR"] },
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
};
