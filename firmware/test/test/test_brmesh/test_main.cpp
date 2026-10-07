// pm_brmesh.h against the code that drove Colin's lights
// (reference/brmesh-to-mqtt/src/main.cpp), reproduced here verbatim in
// its logic — mallocs and all — as the golden reference.
#include <unity.h>
#include <stdlib.h>
#include <stdio.h>
#include "pm_brmesh.h"

void setUp() {}
void tearDown() {}

namespace ref {
static uint8_t my_key[4];
static const uint8_t default_key[] = {0, 0, 0, 0};
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
  for (int j = 0; j < 12; j++) payload[4 + j] = my_key[j & 3] ^ payload[4 + j];
  return payloadLength;
}
uint8_t get_payload_with_inner_retry(int i, const uint8_t* data, int length, int i2, const uint8_t* key, int forward, uint8_t*& payload) {
  SEND_COUNT++;
  SEND_SEQ = SEND_COUNT;
  return package_ble_fastcon_body(i, i2, SEND_SEQ, key[3], forward, data, length, key, payload);
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
int advertisement(const uint8_t* key, const uint8_t* cmd, uint8_t* out) {
  const uint8_t ble_adv_data[] = {0x02, 0x01, 0x1A, 0x1B, 0xFF, 0xF0, 0xFF};
  uint8_t* rf = 0;
  uint8_t n = do_generate_command(5, cmd, 6, key, true, true, 0, rf);
  uint8_t pkt[64];
  memcpy(pkt, ble_adv_data, 7);
  memcpy(pkt + 7, rf, n);
  free(rf);
  int len = 7 + n;
  out[0] = 0x02; out[1] = 0x01; out[2] = 0x04;  // setFlags(0x04)
  out[3] = (uint8_t)(len - 4);                    // strServiceData length byte
  memcpy(out + 4, pkt + 4, len - 4);
  return 3 + 1 + (len - 4);
}
}  // namespace ref

static void check(const uint8_t key[4], uint8_t light, uint32_t rgb) {
  memcpy(ref::my_key, key, 4);
  uint8_t cmd[6];
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
  uint8_t c[6];
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
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_matches_reference_colour);
  RUN_TEST(test_matches_reference_off_and_other_keys);
  RUN_TEST(test_command_bytes);
  return UNITY_END();
}
