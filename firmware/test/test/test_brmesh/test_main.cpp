// pm_brmesh.h against dsclee1/BRmesh-esp32-mqtt (the pairing-capable
// code; its control path is identical to Colin's working BRMeshToMQTT
// with the real default key), reproduced here in its logic — mallocs and
// all — as the golden reference.
#include <unity.h>
#include <stdlib.h>
#include <stdio.h>
#include "pm_brmesh.h"

void setUp() {}
void tearDown() {}

namespace ref {
static uint8_t my_key[4];
static const uint8_t default_key[] = {0x5e, 0x36, 0x7b, 0xc4};  // the real constant
static uint8_t SEND_SEQ = 0, SEND_COUNT = 1;
static const uint8_t ADDR[] = {0xC1, 0xC2, 0xC3};
static const uint8_t addrLength = 3;

uint8_t package_ble_fastcon_body(int i, int i2, uint8_t sequence, uint8_t safe_key, int forward, const uint8_t* data, int length, const uint8_t* key, uint8_t*& payload) {
  uint8_t payloadLength = 4 + 12;
  payload = (uint8_t*)malloc(payloadLength);
  payload[0] = (i2 & 0b1111) << 0 | (i & 0b111) << 4 | (forward & 0xff) << 7;
  payload[1] = sequence & 0xff;
  payload[2] = safe_key;
  payload[3] = 0;
  for (int j = 4; j < payloadLength; j++) payload[j] = 0;
  memcpy(payload + 4, data, length);
  uint8_t checksum = 0;
  for (int j = 0; j < length + 4; j++) { if (j == 3) continue; checksum = (checksum + payload[j]) & 0xff; }
  payload[3] = checksum;
  for (int j = 0; j < 4; j++) payload[j] = default_key[j & 3] ^ payload[j];
  for (int j = 0; j < 12; j++) payload[4 + j] = key[j & 3] ^ payload[4 + j];
  return payloadLength;
}
uint8_t get_payload_with_inner_retry(int i, const uint8_t* data, int length, int i2, const uint8_t* key, int forward, uint8_t*& payload) {
  SEND_COUNT++;
  SEND_SEQ = SEND_COUNT;
  uint8_t safe_key = 0xff;
  bool hasKey = false;
  for (int k = 0; k < 4; k++) if (key[k] != 0) { hasKey = true; break; }
  if (hasKey) safe_key = key[3];
  uint8_t result = package_ble_fastcon_body(i, i2, SEND_SEQ, safe_key, forward, data, length, key, payload);
  if (!hasKey) for (int k = 4; k < 16; k++) payload[k] = default_key[k & 3];
  return result;
}
void whiteningInit(uint8_t val, uint8_t* ctx) {
  ctx[0] = 1; ctx[1] = (val >> 5) & 1; ctx[2] = (val >> 4) & 1; ctx[3] = (val >> 3) & 1;
  ctx[4] = (val >> 2) & 1; ctx[5] = (val >> 1) & 1; ctx[6] = val & 1;
}
void whiteningEncode(const uint8_t* data, int len, uint8_t* ctx, uint8_t* result) {
  memcpy(result, data, len);
  for (int i = 0; i < len; i++) {
    int varC = ctx[3], var14 = ctx[5], var18 = ctx[6], var10 = ctx[4];
    int var8 = var14 ^ ctx[2], var4 = var10 ^ ctx[1], _var = var18 ^ varC, var0 = _var ^ ctx[0];
    int c = result[i];
    result[i] = ((c & 0x80) ^ ((var8 ^ var18) << 7)) + ((c & 0x40) ^ (var0 << 6)) + ((c & 0x20) ^ (var4 << 5)) + ((c & 0x10) ^ (var8 << 4)) + ((c & 0x08) ^ (_var << 3)) + ((c & 0x04) ^ (var10 << 2)) + ((c & 0x02) ^ (var14 << 1)) + ((c & 0x01) ^ (var18 << 0));
    ctx[2] = var4; ctx[3] = var8; ctx[4] = var8 ^ varC; ctx[5] = var0 ^ var10; ctx[6] = var4 ^ var14; ctx[0] = var8 ^ var18; ctx[1] = var0;
  }
}
uint8_t reverse_8(uint8_t d) { uint8_t r = 0; for (uint8_t k = 0; k < 8; k++) r |= ((d >> k) & 1) << (7 - k); return r; }
uint16_t reverse_16(uint16_t d) { uint16_t r = 0; for (uint8_t k = 0; k < 16; k++) r |= ((d >> k) & 1) << (15 - k); return r; }
uint16_t crc16(const uint8_t* addr, const uint8_t* data, uint8_t dataLength) {
  uint16_t crc = 0xffff;
  for (int8_t i = addrLength - 1; i >= 0; i--) {
    crc ^= addr[i] << 8;
    for (uint8_t ii = 0; ii < 4; ii++) { uint16_t tmp = crc << 1; if ((crc & 0x8000) != 0) tmp ^= 0x1021; crc = tmp << 1; if ((tmp & 0x8000) != 0) crc ^= 0x1021; }
  }
  for (uint8_t i = 0; i < dataLength; i++) {
    crc ^= reverse_8(data[i]) << 8;
    for (uint8_t ii = 0; ii < 4; ii++) { uint16_t tmp = crc << 1; if ((crc & 0x8000) != 0) tmp ^= 0x1021; crc = tmp << 1; if ((tmp & 0x8000) != 0) crc ^= 0x1021; }
  }
  crc = ~reverse_16(crc) & 0xffff;
  return crc;
}
uint8_t get_rf_payload(const uint8_t* addr, const uint8_t* data, uint8_t dataLength, uint8_t*& rfPayload) {
  uint8_t data_offset = 0x12, inverse_offset = 0x0f;
  uint8_t result_data_size = data_offset + addrLength + dataLength + 2;
  uint8_t* resultbuf = (uint8_t*)malloc(result_data_size);
  memset(resultbuf, 0, result_data_size);
  resultbuf[0x0f] = 0x71; resultbuf[0x10] = 0x0f; resultbuf[0x11] = 0x55;
  for (uint8_t j = 0; j < addrLength; j++) resultbuf[data_offset + addrLength - j - 1] = addr[j];
  for (int j = 0; j < dataLength; j++) resultbuf[data_offset + addrLength + j] = data[j];
  for (int i = inverse_offset; i < inverse_offset + addrLength + 3; i++) resultbuf[i] = reverse_8(resultbuf[i]);
  int crc = crc16(addr, data, dataLength);
  resultbuf[result_data_size - 2] = crc & 0xff;
  resultbuf[result_data_size - 1] = (crc >> 8) & 0xff;
  rfPayload = resultbuf;
  return result_data_size;
}
uint8_t do_generate_command(int i, const uint8_t* data, uint8_t length, const uint8_t* key, int forward, int, int i2, uint8_t*& rfPayload) {
  if (i2 < 0) i2 = 0;
  uint8_t* payload = 0; uint8_t* rfPayloadTmp = 0;
  uint8_t payloadLength = get_payload_with_inner_retry(i, data, length, i2, key, forward, payload);
  uint8_t rfPayloadLength = get_rf_payload(ADDR, payload, payloadLength, rfPayloadTmp);
  free(payload);
  uint8_t ctx[7];
  whiteningInit(0x25, &ctx[0]);
  uint8_t* result = (uint8_t*)malloc(rfPayloadLength);
  whiteningEncode(rfPayloadTmp, rfPayloadLength, ctx, result);
  rfPayload = (uint8_t*)malloc(rfPayloadLength - 15);
  memcpy(rfPayload, result + 15, rfPayloadLength - 15);
  free(result); free(rfPayloadTmp);
  return rfPayloadLength - 15;
}
// What single_control()+send() put on air: flags 02 01 04 (setFlags(0x04)),
// then the AD structure built from ble_adv_data[4..] + rfPayload.
int frame(int cls, int forward, const uint8_t* key, const uint8_t* cmd, int len, uint8_t* out) {
  const uint8_t ble_adv_data[] = {0x02, 0x01, 0x1A, 0x1B, 0xFF, 0xF0, 0xFF};
  uint8_t* rf = 0;
  uint8_t n = do_generate_command(cls, cmd, len, key, forward, true, 0, rf);
  uint8_t pkt[64];
  memcpy(pkt, ble_adv_data, 7);
  memcpy(pkt + 7, rf, n);
  free(rf);
  int total = 7 + n;
  out[0] = 0x02; out[1] = 0x01; out[2] = 0x04;  // setFlags(0x04)
  out[3] = (uint8_t)(total - 4);                  // strServiceData length byte
  memcpy(out + 4, pkt + 4, total - 4);
  return 3 + 1 + (total - 4);
}
int advertisement(const uint8_t* key, const uint8_t* cmd, uint8_t* out) { return frame(5, true, key, cmd, 8, out); }
}  // namespace ref

static void check(const uint8_t key[4], uint8_t light, uint32_t rgb) {
  memcpy(ref::my_key, key, 4);
  uint8_t cmd[8];
  pm_brmesh_command(light, rgb, cmd);
  uint8_t want[64];
  ref::SEND_COUNT = 41;  // next seq the reference will use: 42
  int n = ref::advertisement(key, cmd, want);
  TEST_ASSERT_EQUAL(PM_BRMESH_ADV_LEN, n);
  uint8_t got[PM_BRMESH_ADV_LEN];
  pm_brmesh_adv(key, 42, cmd, got);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(want, got, PM_BRMESH_ADV_LEN);
}

static void test_matches_reference_colour() {
  const uint8_t k[4] = {0x5A, 0x13, 0xC7, 0x9E};
  check(k, 1, 0xFF6600);
  check(k, 2, 0x00FF00);
  check(k, 7, 0x102030);
}

static void test_matches_reference_off_and_other_keys() {
  const uint8_t k1[4] = {0, 0, 0, 0}, k2[4] = {0xFF, 0x01, 0x80, 0x7F};
  check(k1, 1, 0);
  check(k2, 3, 0);
  check(k2, 255, 0xFFFFFF);
}

static void test_command_bytes() {
  uint8_t c[8];
  pm_brmesh_command(4, 0, c);              // off
  TEST_ASSERT_EQUAL_HEX8(0x22, c[0]);
  TEST_ASSERT_EQUAL(4, c[1]);
  TEST_ASSERT_EQUAL(0, c[2]);
  pm_brmesh_command(1, 0xFF0000, c);       // full red
  TEST_ASSERT_EQUAL_HEX8(0x72, c[0]);
  TEST_ASSERT_EQUAL(127, c[2]);            // brightness
  TEST_ASSERT_EQUAL(0, c[3]);              // blue
  TEST_ASSERT_EQUAL(255, c[4]);            // red
  TEST_ASSERT_EQUAL(0, c[5]);              // green
  pm_brmesh_command(1, 0x400000, c);       // dim red: same hue, low brightness
  TEST_ASSERT_EQUAL(255, c[4]);
  TEST_ASSERT_TRUE(c[2] > 25 && c[2] < 40);
  pm_brmesh_command(1, 0x804000, c);       // orange, half brightness
  TEST_ASSERT_EQUAL(255, c[4]);
  TEST_ASSERT_EQUAL(128, c[5]);
  TEST_ASSERT_EQUAL(0, c[6]);
  pm_brmesh_command(2, 0x7F000000, c);     // white, full
  TEST_ASSERT_EQUAL_HEX8(0x72, c[0]);
  TEST_ASSERT_EQUAL(127, c[2]);
  TEST_ASSERT_EQUAL(0, c[4]);
  TEST_ASSERT_EQUAL(127, c[6]);
  TEST_ASSERT_EQUAL(127, c[7]);
  pm_brmesh_command(2, 0x40FF0000, c);     // white half + a colour: white wins, no RGB (lights reject a mix)
  TEST_ASSERT_EQUAL(64, c[2]);
  TEST_ASSERT_EQUAL(0, c[4]);
  TEST_ASSERT_EQUAL(127, c[6]);
}

// The reference's colour-temperature command: 0x72, number, brightness,
// no RGB, bytes 6–7 = 127 127 (the only white values the floods accept).
static void test_white_matches_reference() {
  const uint8_t k[4] = {0x5A, 0x13, 0xC7, 0x9E};
  memcpy(ref::my_key, k, 4);
  const uint8_t data[8] = {0x72, 5, 100, 0, 0, 0, 127, 127};
  uint8_t want[64], got[PM_BRMESH_ADV_LEN], cmd[8];
  ref::SEND_COUNT = 41;
  ref::frame(5, true, k, data, 8, want);
  pm_brmesh_command(5, 100u << 24, cmd);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(data, cmd, 8);
  pm_brmesh_adv(k, 42, cmd, got);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(want, got, PM_BRMESH_ADV_LEN);
}

// Wake (class 0, no key) and add-device (class 2, default key, 12 bytes:
// light mac, number, group 1, new key) — the pairing frames.
static void test_pairing_frames_match_reference() {
  uint8_t want[64], got[PM_BRMESH_ADV_LEN];
  const uint8_t zero6[6] = {}, nokey[4] = {};
  ref::SEND_COUNT = 9;
  TEST_ASSERT_EQUAL(PM_BRMESH_ADV_LEN, ref::frame(0, false, nokey, zero6, 6, want));
  pm_brmesh_wake(10, got);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(want, got, PM_BRMESH_ADV_LEN);

  const uint8_t mac[6] = {0x11, 0x22, 0x33, 0x44, 0x55, 0x66}, newkey[4] = {0xA5, 0x0F, 0x3C, 0x99};
  uint8_t d[12] = {0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 3, 0x01, 0xA5, 0x0F, 0x3C, 0x99};
  ref::SEND_COUNT = 99;
  TEST_ASSERT_EQUAL(PM_BRMESH_ADV_LEN, ref::frame(2, false, ref::default_key, d, 12, want));
  pm_brmesh_add(mac, 3, newkey, 100, got);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(want, got, PM_BRMESH_ADV_LEN);
}

static void test_parse_light_advert() {
  uint8_t m[18] = {0xF0, 0xFF, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 0xA0, 0xA8, 0x5E, 0x36, 0x7B, 0xC4};
  PmBrmeshSeen s;
  TEST_ASSERT_TRUE(pm_brmesh_parse(m, 18, s));
  TEST_ASSERT_TRUE(pm_brmesh_unpaired(s));
  TEST_ASSERT_EQUAL_STRING("RGB", pm_brmesh_type_name(s.type));
  TEST_ASSERT_EQUAL_HEX8(1, s.mac[0]);
  m[14] = 0x00;  // a light holding some other key
  pm_brmesh_parse(m, 18, s);
  TEST_ASSERT_FALSE(pm_brmesh_unpaired(s));
  TEST_ASSERT_FALSE(pm_brmesh_parse(m, 17, s));
  const uint8_t key[4] = {0, 0x40, 0, 0};
  m[7] = 0x43;  // number 3, XORed with key[1]
  TEST_ASSERT_EQUAL(3, pm_brmesh_number(m, key));
}

// A real Melpo RGBW flood heard unpaired on 2026-10-07 (from the placeholder
// address 11:22:33:44:55:66 every light uses). Bytes 6..17 are XORed with the
// key it holds: the key slot is zero underneath, and the type code is the
// one the reference lists for RGBW only once the default key is XORed out.
static void test_real_advert_identity_survives_key_change() {
  const uint8_t m[18] = {0xf0, 0xff, 0x4e, 0x56, 0x7a, 0x02, 0xec, 0x0b, 0xf1, 0x1a, 0x3f, 0xf8,
                         0xa1, 0xa8, 0x5e, 0x36, 0x7b, 0xc4};
  PmBrmeshSeen s;
  TEST_ASSERT_TRUE(pm_brmesh_parse(m, 18, s));
  TEST_ASSERT_TRUE(pm_brmesh_unpaired(s));
  TEST_ASSERT_EQUAL_STRING("RGBW", pm_brmesh_type_name(s));
  uint8_t clean[12];
  pm_brmesh_clean(m, s.key, clean);
  for (int j = 8; j < 12; j++) TEST_ASSERT_EQUAL_HEX8(0, clean[j]);
  uint8_t id_before[8], id_after[8];
  pm_brmesh_id(m, s.key, id_before);
  // The same light after it takes key 1a2b3c4d as light 7: bytes 6..17 re-XORed.
  const uint8_t k[4] = {0x1a, 0x2b, 0x3c, 0x4d};
  uint8_t m2[18];
  memcpy(m2, m, 18);
  clean[1] = 7;
  for (int j = 0; j < 12; j++) m2[6 + j] = clean[j] ^ k[j & 3];
  PmBrmeshSeen s2;
  pm_brmesh_parse(m2, 18, s2);
  TEST_ASSERT_FALSE(pm_brmesh_unpaired(s2));
  TEST_ASSERT_EQUAL_HEX8_ARRAY(k, s2.key, 4);       // the key slot reads as the key
  TEST_ASSERT_EQUAL_STRING("RGBW", pm_brmesh_type_name(s2));
  TEST_ASSERT_EQUAL(7, pm_brmesh_number(m2, k));
  pm_brmesh_id(m2, s2.key, id_after);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(id_before, id_after, 8);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_matches_reference_colour);
  RUN_TEST(test_matches_reference_off_and_other_keys);
  RUN_TEST(test_command_bytes);
  RUN_TEST(test_white_matches_reference);
  RUN_TEST(test_pairing_frames_match_reference);
  RUN_TEST(test_parse_light_advert);
  RUN_TEST(test_real_advert_identity_survives_key_change);
  return UNITY_END();
}
