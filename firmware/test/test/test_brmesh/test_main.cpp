// pm_brmesh.h against adverts recorded from the BRMesh reverse-engineering
// code (dsclee1/BRmesh-esp32-mqtt — pairing-capable; its control path
// matches the BRMeshToMQTT build that drove Colin's lights).
#include <unity.h>
#include <stdlib.h>
#include <stdio.h>
#include "pm_brmesh.h"

void setUp() {}
void tearDown() {}

// Golden adverts, recorded 2026-10-12 from dsclee1/BRmesh-esp32-mqtt's
// implementation (compiled on its own, seq as noted). That project has no
// license, so its code is not kept here — only what it put on air.
static const uint8_t CTL_K_1_FF6600[31] = {0x02, 0x01, 0x04, 0x1B, 0xFF, 0xF0, 0xFF, 0x6D, 0xB6, 0x43, 0x68, 0x93, 0x1D, 0xDD, 0x2F, 0x3D, 0x91, 0xB0, 0x1A, 0x9C, 0x55, 0x9E, 0x89, 0xB6, 0x3D, 0xAE, 0x46, 0xAF, 0x51, 0xE4, 0xF9};
static const uint8_t CTL_K_2_00FF00[31] = {0x02, 0x01, 0x04, 0x1B, 0xFF, 0xF0, 0xFF, 0x6D, 0xB6, 0x43, 0x68, 0x93, 0x1D, 0xDD, 0x2F, 0x3D, 0xF4, 0xB0, 0x19, 0x9C, 0x55, 0x61, 0x10, 0xB6, 0x3D, 0xAE, 0x46, 0xAF, 0x51, 0x7B, 0x42};
static const uint8_t CTL_K_7_102030[31] = {0x02, 0x01, 0x04, 0x1B, 0xFF, 0xF0, 0xFF, 0x6D, 0xB6, 0x43, 0x68, 0x93, 0x1D, 0xDD, 0x2F, 0x3D, 0x59, 0xB0, 0x1C, 0xFB, 0xAA, 0x34, 0x45, 0xB6, 0x3D, 0xAE, 0x46, 0xAF, 0x51, 0x42, 0xAA};
static const uint8_t CTL_K1_1_OFF[31] = {0x02, 0x01, 0x04, 0x1B, 0xFF, 0xF0, 0xFF, 0x6D, 0xB6, 0x43, 0x68, 0x93, 0x1D, 0xDD, 0x2F, 0x5C, 0x62, 0xC6, 0x3E, 0x5F, 0x0F, 0x65, 0xCA, 0x0A, 0x67, 0xAA, 0x63, 0x13, 0x0B, 0x3B, 0xEA};
static const uint8_t CTL_K2_3_OFF[31] = {0x02, 0x01, 0x04, 0x1B, 0xFF, 0xF0, 0xFF, 0x6D, 0xB6, 0x43, 0x68, 0x93, 0x1D, 0xDD, 0x2F, 0xDC, 0xE0, 0x45, 0x0A, 0xA4, 0xB4, 0xC4, 0xFD, 0xF1, 0xDC, 0x0B, 0x54, 0xE8, 0xB0, 0xF0, 0x8E};
static const uint8_t CTL_K2_255_FFFFFF[31] = {0x02, 0x01, 0x04, 0x1B, 0xFF, 0xF0, 0xFF, 0x6D, 0xB6, 0x43, 0x68, 0x93, 0x1D, 0xDD, 0x2F, 0xDC, 0x18, 0x15, 0xF6, 0xDB, 0x4B, 0x3B, 0x02, 0xF1, 0xDC, 0x0B, 0x54, 0xE8, 0xB0, 0x70, 0xC7};
static const uint8_t WHITE_K_5_100[31] = {0x02, 0x01, 0x04, 0x1B, 0xFF, 0xF0, 0xFF, 0x6D, 0xB6, 0x43, 0x68, 0x93, 0x1D, 0xDD, 0x2F, 0x3D, 0x0F, 0xB0, 0x1E, 0x87, 0x55, 0x61, 0xEF, 0xC9, 0x42, 0xAE, 0x46, 0xAF, 0x51, 0xB1, 0x4D};
static const uint8_t WAKE_SEQ10[31] = {0x02, 0x01, 0x04, 0x1B, 0xFF, 0xF0, 0xFF, 0x6D, 0xB6, 0x43, 0x68, 0x93, 0x1D, 0x0D, 0x0F, 0x5C, 0x77, 0xC6, 0x3E, 0x5F, 0x0F, 0x65, 0xCA, 0x0A, 0x67, 0xAA, 0x63, 0x13, 0x0B, 0xB4, 0xFD};
static const uint8_t ADD_SEQ100[31] = {0x02, 0x01, 0x04, 0x1B, 0xFF, 0xF0, 0xFF, 0x6D, 0xB6, 0x43, 0x68, 0x93, 0x1D, 0x2D, 0x61, 0x67, 0x44, 0xD7, 0x1C, 0x6C, 0x4B, 0x30, 0xAC, 0x09, 0x66, 0x0F, 0x6C, 0x2F, 0x92, 0xA0, 0xBF};


// A control advert at seq 42 for (key, light, color) must equal `want`.
static void check(const uint8_t key[4], uint8_t light, uint32_t rgb, const uint8_t want[31]) {
  uint8_t cmd[8], got[PM_BRMESH_ADV_LEN];
  pm_brmesh_command(light, rgb, cmd);
  pm_brmesh_adv(key, 42, cmd, got);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(want, got, PM_BRMESH_ADV_LEN);
}

static void test_matches_reference_color() {
  const uint8_t k[4] = {0x5A, 0x13, 0xC7, 0x9E};
  check(k, 1, 0xFF6600, CTL_K_1_FF6600);
  check(k, 2, 0x00FF00, CTL_K_2_00FF00);
  check(k, 7, 0x102030, CTL_K_7_102030);
}

static void test_matches_reference_off_and_other_keys() {
  const uint8_t k1[4] = {0, 0, 0, 0}, k2[4] = {0xFF, 0x01, 0x80, 0x7F};
  check(k1, 1, 0, CTL_K1_1_OFF);
  check(k2, 3, 0, CTL_K2_3_OFF);
  check(k2, 255, 0xFFFFFF, CTL_K2_255_FFFFFF);
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
  pm_brmesh_command(2, 0x40FF0000, c);     // white half + a color: white wins, no RGB (lights reject a mix)
  TEST_ASSERT_EQUAL(64, c[2]);
  TEST_ASSERT_EQUAL(0, c[4]);
  TEST_ASSERT_EQUAL(127, c[6]);
}

// The reference's color-temperature command: 0x72, number, brightness,
// no RGB, bytes 6–7 = 127 127 (the only white values the floods accept).
static void test_white_matches_reference() {
  const uint8_t k[4] = {0x5A, 0x13, 0xC7, 0x9E};
  const uint8_t data[8] = {0x72, 5, 100, 0, 0, 0, 127, 127};
  uint8_t got[PM_BRMESH_ADV_LEN], cmd[8];
  pm_brmesh_command(5, 100u << 24, cmd);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(data, cmd, 8);
  pm_brmesh_adv(k, 42, cmd, got);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(WHITE_K_5_100, got, PM_BRMESH_ADV_LEN);
}

// Wake (class 0, no key) and add-device (class 2, default key, 12 bytes:
// light mac, number, group 1, new key) — the pairing frames.
static void test_pairing_frames_match_reference() {
  uint8_t got[PM_BRMESH_ADV_LEN];
  pm_brmesh_wake(10, got);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(WAKE_SEQ10, got, PM_BRMESH_ADV_LEN);

  const uint8_t mac[6] = {0x11, 0x22, 0x33, 0x44, 0x55, 0x66}, newkey[4] = {0xA5, 0x0F, 0x3C, 0x99};
  pm_brmesh_add(mac, 3, newkey, 100, got);
  TEST_ASSERT_EQUAL_HEX8_ARRAY(ADD_SEQ100, got, PM_BRMESH_ADV_LEN);
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
  RUN_TEST(test_matches_reference_color);
  RUN_TEST(test_matches_reference_off_and_other_keys);
  RUN_TEST(test_command_bytes);
  RUN_TEST(test_white_matches_reference);
  RUN_TEST(test_pairing_frames_match_reference);
  RUN_TEST(test_parse_light_advert);
  RUN_TEST(test_real_advert_identity_survives_key_change);
  return UNITY_END();
}
