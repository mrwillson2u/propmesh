// BRMesh ("fastcon") BLE flood lights: build the advertisement that sets
// one light's colour. The lights listen for BLE advertisements with
// manufacturer id 0xFFF0 carrying a whitened, key-XORed, CRC'd 24-byte
// payload — no pairing, no connection, nothing comes back.
//
// Ported from reference/brmesh-to-mqtt/src/main.cpp (which worked with
// Colin's lights) without its mallocs; pm_brmesh tests compare the
// output byte-for-byte with that code. The 4-byte key comes from the
// BRMesh app (adb logcat) and lives only in the node's config.
// Header-only, no Arduino/ESP includes: tested host-native.
#pragma once
#include <stdint.h>
#include <string.h>

#define PM_BRMESH_ADV_LEN 31

namespace pm_brmesh {

static const uint8_t ADDR[3] = {0xC1, 0xC2, 0xC3};  // DEFAULT_BLE_FASTCON_ADDRESS

inline uint8_t rev8(uint8_t d) {
  uint8_t r = 0;
  for (uint8_t k = 0; k < 8; k++) r |= ((d >> k) & 1) << (7 - k);
  return r;
}

inline uint16_t rev16(uint16_t d) {
  uint16_t r = 0;
  for (uint8_t k = 0; k < 16; k++) r |= ((d >> k) & 1) << (15 - k);
  return r;
}

inline void crc_step(uint16_t &crc) {
  for (uint8_t ii = 0; ii < 4; ii++) {
    uint16_t tmp = crc << 1;
    if (crc & 0x8000) tmp ^= 0x1021;
    crc = tmp << 1;
    if (tmp & 0x8000) crc ^= 0x1021;
  }
}

inline uint16_t crc16(const uint8_t *data, uint8_t len) {
  uint16_t crc = 0xffff;
  for (int8_t i = 2; i >= 0; i--) { crc ^= ADDR[i] << 8; crc_step(crc); }
  for (uint8_t i = 0; i < len; i++) { crc ^= rev8(data[i]) << 8; crc_step(crc); }
  return ~rev16(crc) & 0xffff;
}

inline void whiten(uint8_t *buf, int len) {
  uint8_t ctx[7] = {1, (0x25 >> 5) & 1, (0x25 >> 4) & 1, (0x25 >> 3) & 1, (0x25 >> 2) & 1, (0x25 >> 1) & 1, 0x25 & 1};
  for (int i = 0; i < len; i++) {
    int varC = ctx[3], var14 = ctx[5], var18 = ctx[6], var10 = ctx[4];
    int var8 = var14 ^ ctx[2], var4 = var10 ^ ctx[1], v = var18 ^ varC, var0 = v ^ ctx[0];
    int c = buf[i];
    buf[i] = ((c & 0x80) ^ ((var8 ^ var18) << 7)) + ((c & 0x40) ^ (var0 << 6)) +
             ((c & 0x20) ^ (var4 << 5)) + ((c & 0x10) ^ (var8 << 4)) + ((c & 0x08) ^ (v << 3)) +
             ((c & 0x04) ^ (var10 << 2)) + ((c & 0x02) ^ (var14 << 1)) + ((c & 0x01) ^ (var18 << 0));
    ctx[2] = var4; ctx[3] = var8; ctx[4] = var8 ^ varC; ctx[5] = var0 ^ var10;
    ctx[6] = var4 ^ var14; ctx[0] = var8 ^ var18; ctx[1] = var0;
  }
}

}  // namespace pm_brmesh

// The 6-byte light command:
//   off/brightness: {0x22, light, brightness 0..127, 0, 0, 0}
//   colour:         {0x72, light, brightness 0..127, blue, red, green}
inline void pm_brmesh_command(uint8_t light, uint32_t rgb, uint8_t out[6]) {
  uint8_t r = rgb >> 16, g = rgb >> 8, b = rgb;
  uint8_t peak = r > g ? (r > b ? r : b) : (g > b ? g : b);
  memset(out, 0, 6);
  out[1] = light;
  if (!peak) { out[0] = 0x22; return; }  // black = off
  // Brightness from the colour's peak; the colour itself sent at full
  // scale, so a dim red is "red at low brightness", as the lights expect.
  out[0] = 0x72;
  out[2] = (uint8_t)((peak * 127 + 127) / 255);
  out[3] = (uint8_t)((b * 255 + peak / 2) / peak);
  out[4] = (uint8_t)((r * 255 + peak / 2) / peak);
  out[5] = (uint8_t)((g * 255 + peak / 2) / peak);
}

// The full 31-byte BLE advertising payload for one command.
inline void pm_brmesh_adv(const uint8_t key[4], uint8_t seq, const uint8_t cmd[6],
                          uint8_t adv[PM_BRMESH_ADV_LEN]) {
  using namespace pm_brmesh;
  // body: header (type 5, forward) · seq · key[3] · checksum · 12 data bytes
  uint8_t body[16] = {};
  body[0] = (5 & 7) << 4 | 0x80;
  body[1] = seq;
  body[2] = key[3];
  memcpy(body + 4, cmd, 6);
  uint8_t sum = 0;
  for (int j = 0; j < 10; j++) if (j != 3) sum += body[j];
  body[3] = sum;
  for (int j = 0; j < 12; j++) body[4 + j] ^= key[j & 3];

  // rf frame: preamble 71 0F 55 · address (reversed) · body · crc
  uint8_t rf[39] = {};
  rf[15] = 0x71; rf[16] = 0x0F; rf[17] = 0x55;
  for (int j = 0; j < 3; j++) rf[18 + 3 - j - 1] = ADDR[j];
  memcpy(rf + 21, body, 16);
  for (int i = 15; i < 21; i++) rf[i] = rev8(rf[i]);
  uint16_t crc = crc16(body, 16);
  rf[37] = crc & 0xff;
  rf[38] = crc >> 8;
  whiten(rf, 39);

  // advertisement: flags (BR/EDR not supported) · manufacturer 0xFFF0 · rf[15..38]
  static const uint8_t HEAD[7] = {0x02, 0x01, 0x04, 0x1B, 0xFF, 0xF0, 0xFF};
  memcpy(adv, HEAD, 7);
  memcpy(adv + 7, rf + 15, 24);
}
