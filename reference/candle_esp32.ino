// ESP32 flame candle controller — reusing the YMT-LZ06 board (U3 and U4 removed)
//
//  Hookup (see wiring notes in chat):
//    BAT+  -> ESP32 VIN           (stock slide switch becomes the power switch)
//    BAT+  -> 100 ohm -> LED+     (charge pump bypassed)
//    GPIO LED  -> U4 pin 5 pad    (sinks LED-, ACTIVE LOW)
//    GPIO COIL -> XQK test point  (-> R2 -> Q3 base, active high)
//    GPIO IR   <- YK test point   (optional, IR receiver output)
//    GPIO VBAT <- BAT+ via 100k/100k divider (optional, brightness compensation)
//    GPIO MODE <- switch throw pin that used to go to U4 (optional, 4h/8h side)
//
//  Behavior:
//    - Layered LED flicker: slow wander + fast shimmer + random gusts + rare sputters
//    - Coil: stock-style burst/rest idle (bursts of kicks at ~swingHz, then a rest),
//      and long in-phase bursts during gusts for a big swing
//    - Optional battery compensation so brightness doesn't sag as the LiPo drains
//    - Optional auto-off timer (4h / 8h by switch side), ESP32 deep-sleeps after
//
//  Target: Arduino-ESP32 core 3.x (ledcAttach / ledcWrite by pin). Pins suit an
//  ESP32-C3 SuperMini; change for your board.
//
//  Serial tuning (115200 baud):
//    + / -   swing frequency +/- 0.05 Hz     [ / ]   kick width -/+ 2 ms
//    k       steady kicking (resonance hunt) c       coil on/off
//    g       gust now                        s       sputter now
//    d / D   drama -/+ 0.1                   b       print battery voltage
//    ?       print settings

#include <Arduino.h>
#include <math.h>

// ---------------- Pins ----------------
const int PIN_LED  = 2;    // -> U4 pin 5 pad (active low)
const int PIN_COIL = 4;    // -> XQK
const int PIN_VBAT = 0;    // ADC, battery divider. Set to -1 to disable compensation
const int PIN_MODE = 5;    // switch sense. Set to -1 to disable the auto-off timer

// ---------------- LED ----------------
const int   LED_PWM_FREQ = 5000;
const int   LED_PWM_BITS = 12;
const int   LED_MAX      = (1 << LED_PWM_BITS) - 1;
const float GAMMA        = 2.2f;
const bool  LED_ACTIVE_LOW = true;

// Battery compensation: LED current ~ (Vbat - Vf) / R. Normalize to full-charge current.
const float LED_VF       = 2.9f;   // warm-white forward voltage
const float VBAT_FULL    = 4.2f;
const float VBAT_DIVIDER = 2.0f;   // 100k/100k

// ---------------- Flicker tuning ----------------
float drama           = 1.0f;    // scales every effect (0 = calm, 1.5 = wild)
float brightnessFloor = 0.03f;
float gustMeanSec     = 18.0f;   // mean seconds between gusts (exponential)
float sputterMeanSec  = 150.0f;  // mean seconds between near-blowouts

// ---------------- Coil tuning ----------------
float swingHz   = 2.7f;    // measured on the stock board; sweep +/-0.3 to find peak
int   kickMs    = 25;      // stock used ~40 ms on alkalines; LiPo pushes ~40% more current
bool  coilEnabled = true;
bool  steadyKick  = false; // kick every cycle, no rest (resonance hunting)

// Idle burst/rest pattern (mimics stock: ~1 s of kicks, ~1 s rest, randomized)
int   idleBurstMin = 3,  idleBurstMax = 5;      // kicks per burst
int   idleRestMinMs = 500, idleRestMaxMs = 1500;
float idleJitter   = 0.05f;                     // period jitter (fraction)

// ---------------- Auto-off ----------------
const uint32_t TIMER_A_MS = 4UL * 3600UL * 1000UL;
const uint32_t TIMER_B_MS = 8UL * 3600UL * 1000UL;
const bool     MODE_PIN_HIGH_IS_B = true;  // which side of the switch means 8h

// ---------------- Timing ----------------
const uint32_t STEP_MS = 5;  // 200 Hz flicker update

// ---------------- Helpers ----------------
float frand() { return (float)esp_random() / 4294967295.0f; }
float frandRange(float a, float b) { return a + (b - a) * frand(); }
int   irand(int a, int b) { return a + (int)(frand() * (b - a + 1)); }
float expRand(float mean) { return -logf(1.0f - frand() * 0.9999f) * mean; }
float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
float lerpf(float a, float b, float t) { return a + (b - a) * clampf(t, 0, 1); }

// ---------------- Flicker state ----------------
float wander = 0.85f, wanderTarget = 0.85f;
uint32_t nextWanderMs = 0;
float shimmer = 0, shimmerTarget = 0;
uint32_t nextShimmerMs = 0;

bool gustActive = false;
uint32_t gustStartMs = 0, gustDurMs = 0, nextGustMs = 0;
float gustDepth = 0, gustHz = 10, gustPhase = 0;

bool sputterActive = false;
uint32_t sputterStartMs = 0, nextSputterMs = 0, nextStutterMs = 0;
float stutterVal = 0.05f;

float batComp = 1.0f;        // PWM multiplier from battery compensation
float vbat = VBAT_FULL;
uint32_t nextBatMs = 0;

// ---------------- Coil state ----------------
uint32_t nextKickMs = 0, coilOffMs = 0;
bool coilOn = false;
int  kicksLeftInBurst = 0;

// ---------------------------------------------------------------
void startGust(uint32_t now) {
  gustActive  = true;
  gustStartMs = now;
  gustDurMs   = (uint32_t)frandRange(600, 2200);
  gustDepth   = clampf(frandRange(0.5f, 0.8f) * drama, 0, 0.92f);
  gustHz      = frandRange(8.0f, 12.0f);
}

void startSputter(uint32_t now) {
  sputterActive  = true;
  sputterStartMs = now;
  nextStutterMs  = now;
  startGust(now);
  gustDurMs = 1600;
}

// Gust envelope: quick attack, hold, slow squared decay
float gustEnvelope(uint32_t now) {
  if (!gustActive) return 0;
  float t = now - gustStartMs, d = gustDurMs;
  if (t >= d) { gustActive = false; return 0; }
  if (t < 150) return t / 150.0f;
  if (t < 0.6f * d) return 1.0f;
  float x = 1.0f - (t - 0.6f * d) / (0.4f * d);
  return x * x;
}

// Per-cycle dip: brightness falls fast, recovers slow
float dipShape(float phase) {
  float p = phase - floorf(phase);
  return p < 0.3f ? p / 0.3f : 1.0f - (p - 0.3f) / 0.7f;
}

float sputterMult(uint32_t now) {
  if (!sputterActive) return 1.0f;
  uint32_t t = now - sputterStartMs;
  if (t < 80)   return lerpf(1.0f, 0.05f, t / 80.0f);
  if (t < 700) {
    if (now >= nextStutterMs) {
      stutterVal    = frandRange(0.03f, 0.45f);
      nextStutterMs = now + (uint32_t)frandRange(30, 70);
    }
    return stutterVal;
  }
  if (t < 1100) return lerpf(0.45f, 1.18f, (t - 700) / 400.0f);  // overshoot
  if (t < 1500) return lerpf(1.18f, 1.0f, (t - 1100) / 400.0f);
  sputterActive = false;
  return 1.0f;
}

void writeLed(float b) {
  b = clampf(b, brightnessFloor, 1.0f);
  float duty = powf(b, GAMMA) * batComp;
  uint32_t v = (uint32_t)(clampf(duty, 0, 1) * LED_MAX);
  ledcWrite(PIN_LED, LED_ACTIVE_LOW ? LED_MAX - v : v);
}

void updateBattery(uint32_t now) {
  if (PIN_VBAT < 0 || now < nextBatMs) return;
  nextBatMs = now + 2000;
  // analogReadMilliVolts handles the ESP32's ADC calibration
  float v = analogReadMilliVolts(PIN_VBAT) / 1000.0f * VBAT_DIVIDER;
  vbat += (v - vbat) * 0.3f;
  // Current scales with (Vbat - Vf); boost duty to hold full-charge brightness
  float iNow = max(vbat - LED_VF, 0.15f);
  batComp = clampf((VBAT_FULL - LED_VF) / iNow, 1.0f, 3.0f);
}

void updateFlicker(uint32_t now) {
  // Layer 1: slow wander
  if (now >= nextWanderMs) {
    wanderTarget = frandRange(0.76f, 0.92f);
    nextWanderMs = now + (uint32_t)frandRange(300, 1500);
  }
  wander += (wanderTarget - wander) * (STEP_MS / 600.0f);

  // Layer 2: fast shimmer (~8-12 Hz content)
  if (now >= nextShimmerMs) {
    shimmerTarget = frandRange(-0.05f, 0.05f) * drama;
    nextShimmerMs = now + (uint32_t)frandRange(40, 120);
  }
  shimmer += (shimmerTarget - shimmer) * 0.25f;

  // Event scheduling (exponential gaps: never feels periodic)
  if (!gustActive && !sputterActive && now >= nextGustMs) {
    startGust(now);
    nextGustMs = now + (uint32_t)(expRand(gustMeanSec) * 1000);
  }
  if (!sputterActive && now >= nextSputterMs) {
    startSputter(now);
    nextSputterMs = now + (uint32_t)(expRand(sputterMeanSec) * 1000);
  }

  // Layer 3: gust dips
  float env = gustEnvelope(now), gMult = 1.0f;
  if (env > 0) {
    gustPhase += (STEP_MS / 1000.0f) * gustHz * frandRange(0.85f, 1.15f);
    gMult = 1.0f - gustDepth * env * dipShape(gustPhase);
  }

  // Layer 4: sputter
  writeLed((wander + shimmer) * gMult * sputterMult(now));
}

void updateCoil(uint32_t now) {
  if (coilOn && now >= coilOffMs) {
    digitalWrite(PIN_COIL, LOW);
    coilOn = false;
  }
  if (now < nextKickMs) return;

  float periodMs = 1000.0f / swingHz;
  bool gusting = gustActive || sputterActive;
  int width;
  uint32_t nextDelay;

  if (steadyKick) {
    width = kickMs;
    nextDelay = (uint32_t)periodMs;
  } else if (gusting) {
    // Pump continuously in phase: amplitude builds for the whole gust
    width = (int)(kickMs * 1.4f);
    nextDelay = (uint32_t)(periodMs * (1.0f + 0.02f * frandRange(-1, 1)));
    kicksLeftInBurst = 0;  // force a fresh burst/rest decision after the gust
  } else {
    if (kicksLeftInBurst <= 0) {
      // Rest between bursts, then start a new burst
      kicksLeftInBurst = irand(idleBurstMin, idleBurstMax);
      nextKickMs = now + irand(idleRestMinMs, idleRestMaxMs);
      return;
    }
    kicksLeftInBurst--;
    width = kickMs;
    nextDelay = (uint32_t)(periodMs * (1.0f + idleJitter * frandRange(-1, 1)));
  }

  if (coilEnabled) {
    digitalWrite(PIN_COIL, HIGH);
    coilOn = true;
    coilOffMs = now + width;
  }
  nextKickMs = now + nextDelay;
}

void checkAutoOff(uint32_t now) {
  if (PIN_MODE < 0) return;
  bool sideB = digitalRead(PIN_MODE) == (MODE_PIN_HIGH_IS_B ? HIGH : LOW);
  uint32_t limit = sideB ? TIMER_B_MS : TIMER_A_MS;
  if (now < limit) return;
  // Shut everything down and sleep. The slide switch cycling off/on resets the ESP32.
  digitalWrite(PIN_COIL, LOW);
  ledcWrite(PIN_LED, LED_ACTIVE_LOW ? LED_MAX : 0);
  Serial.println("Auto-off timer reached, sleeping.");
  delay(50);
  esp_deep_sleep_start();
}

void printSettings() {
  Serial.printf("swingHz=%.2f kickMs=%d drama=%.1f coil=%s steady=%s vbat=%.2f comp=%.2f\n",
                swingHz, kickMs, drama, coilEnabled ? "on" : "off",
                steadyKick ? "on" : "off", vbat, batComp);
}

void handleSerial(uint32_t now) {
  while (Serial.available()) {
    char c = Serial.read();
    switch (c) {
      case '+': swingHz += 0.05f; break;
      case '-': swingHz = max(0.5f, swingHz - 0.05f); break;
      case ']': kickMs = min(80, kickMs + 2); break;
      case '[': kickMs = max(4, kickMs - 2); break;
      case 'k': steadyKick = !steadyKick; break;
      case 'c': coilEnabled = !coilEnabled; break;
      case 'g': startGust(now); break;
      case 's': startSputter(now); break;
      case 'd': drama = max(0.0f, drama - 0.1f); break;
      case 'D': drama = min(1.5f, drama + 0.1f); break;
      case 'b': case '?': break;
      default: continue;
    }
    printSettings();
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_COIL, OUTPUT);
  digitalWrite(PIN_COIL, LOW);
  ledcAttach(PIN_LED, LED_PWM_FREQ, LED_PWM_BITS);
  writeLed(0.0f);
  if (PIN_MODE >= 0) pinMode(PIN_MODE, INPUT_PULLDOWN);
  if (PIN_VBAT >= 0) { pinMode(PIN_VBAT, INPUT); analogReadResolution(12); }

  uint32_t now = millis();
  nextGustMs    = now + (uint32_t)(expRand(gustMeanSec) * 1000);
  nextSputterMs = now + (uint32_t)(expRand(sputterMeanSec) * 1000);
  printSettings();
}

void loop() {
  static uint32_t last = 0;
  uint32_t now = millis();
  handleSerial(now);
  updateCoil(now);  // every loop, for accurate pulse widths
  if (now - last >= STEP_MS) {
    last = now;
    updateBattery(now);
    updateFlicker(now);
    checkAutoOff(now);
  }
}
