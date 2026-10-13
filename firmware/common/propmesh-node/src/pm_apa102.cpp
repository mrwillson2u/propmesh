#include "pm_apa102.h"
#include <Arduino.h>

bool PmApa102::begin(uint8_t data, uint8_t clock, uint16_t pixels, uint8_t ord) {
  end();
  buf = (uint8_t *)calloc(pixels, 3);
  if (!buf) return false;
  n = pixels; order = ord; dpin = data; cpin = clock;
  digitalWrite(dpin, LOW); digitalWrite(cpin, LOW);
  pinMode(dpin, OUTPUT); pinMode(cpin, OUTPUT);
  show();  // all off
  return true;
}

void PmApa102::end() {
  if (buf) {
    memset(buf, 0, (size_t)n * 3);
    show();
    pinMode(dpin, INPUT); pinMode(cpin, INPUT);
  }
  free(buf); buf = nullptr; n = 0;
}

void PmApa102::byte(uint8_t b) {
  for (int i = 7; i >= 0; i--) {
    digitalWrite(dpin, (b >> i) & 1);
    digitalWrite(cpin, HIGH);
    digitalWrite(cpin, LOW);
  }
}

void PmApa102::show() {
  if (!buf) return;
  // Start frame, then per pixel: 111 + 5-bit global brightness (full —
  // the colors carry the level, so dimming never steps), then the three
  // color bytes in wire order. End frame: a clock edge per two pixels.
  for (int i = 0; i < 4; i++) byte(0x00);
  for (uint16_t i = 0; i < n; i++) {
    const uint8_t *p = buf + (size_t)i * 3;
    byte(0xFF); byte(p[0]); byte(p[1]); byte(p[2]);
  }
  for (uint16_t i = 0; i < n / 16 + 1; i++) byte(0x00);
}
