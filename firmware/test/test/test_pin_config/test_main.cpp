#include <unity.h>
#include "pm_pinrules.h"
#include "pm_config_json.h"

void setUp() {}
void tearDown() {}

static const pm_board_t &B = PM_BOARD_ESP32_DEVKIT_V1;

static PmChannelCfg ch(uint8_t kind, uint8_t index, uint8_t pin, int pin2 = -1) {
  PmChannelCfg c;
  c.kind = kind;
  c.index = index;
  c.pins[c.pin_count++] = pin;
  if (pin2 >= 0) c.pins[c.pin_count++] = (uint8_t)pin2;
  return c;
}

static PmNodeConfig cfg(std::initializer_list<PmChannelCfg> chans) {
  PmNodeConfig n;
  for (const PmChannelCfg &c : chans) n.channels[n.channel_count++] = c;
  return n;
}

// --- pin rules -------------------------------------------------------

static void test_plain_config_is_clean() {
  PmChannelCfg in = ch(PM_CHANNEL_KIND_DIGITAL_IN, 1, 27);
  in.pull = PM_PULL_UP;
  PmIssues r = pm_validate(B, cfg({ch(PM_CHANNEL_KIND_SERVO, 1, 13),
                                   ch(PM_CHANNEL_KIND_RELAY, 1, 4),
                                   ch(PM_CHANNEL_KIND_MOTOR, 1, 25, 26),
                                   ch(PM_CHANNEL_KIND_LED_STRIP, 1, 16), in}));
  TEST_ASSERT_EQUAL(0, r.count);
}

static void test_empty_config_is_valid() {
  TEST_ASSERT_EQUAL(0, pm_validate(B, PmNodeConfig()).count);
}

// 34-39 have no output driver at all — the classic devkit mistake.
static void test_output_on_input_only_pin_rejected() {
  PmIssues r = pm_validate(B, cfg({ch(PM_CHANNEL_KIND_RELAY, 1, 34)}));
  TEST_ASSERT_TRUE(r.has("pin_cannot"));
  TEST_ASSERT_EQUAL(1, r.errors);
}

static void test_input_on_input_only_pin_ok_but_no_pull() {
  PmChannelCfg in = ch(PM_CHANNEL_KIND_DIGITAL_IN, 1, 34);
  TEST_ASSERT_EQUAL(0, pm_validate(B, cfg({in})).errors);
  in.pull = PM_PULL_UP;
  TEST_ASSERT_TRUE(pm_validate(B, cfg({in})).has("no_pull"));
}

// GPIO 12 high at reset selects 1.8 V flash and the board will not boot:
// a sensor that idles high must never be offered this pin.
static void test_input_on_gpio12_rejected() {
  PmIssues r = pm_validate(B, cfg({ch(PM_CHANNEL_KIND_DIGITAL_IN, 1, 12)}));
  TEST_ASSERT_TRUE(r.has("pin_cannot"));
}

static void test_strapping_output_is_warning_not_error() {
  PmIssues r = pm_validate(B, cfg({ch(PM_CHANNEL_KIND_LED, 1, 2)}));
  TEST_ASSERT_TRUE(r.has("pin_caution"));
  TEST_ASSERT_EQUAL(0, r.errors);
}

static void test_usb_serial_pins_reserved() {
  TEST_ASSERT_TRUE(pm_validate(B, cfg({ch(PM_CHANNEL_KIND_RELAY, 1, 1)})).has("pin_reserved"));
  TEST_ASSERT_TRUE(pm_validate(B, cfg({ch(PM_CHANNEL_KIND_DIGITAL_IN, 1, 3)})).has("pin_reserved"));
}

// Flash pins (6-11) and GPIO 0 are not on the 30-pin header at all.
static void test_pin_not_on_board_rejected() {
  TEST_ASSERT_TRUE(pm_validate(B, cfg({ch(PM_CHANNEL_KIND_RELAY, 1, 6)})).has("no_such_pin"));
  TEST_ASSERT_TRUE(pm_validate(B, cfg({ch(PM_CHANNEL_KIND_RELAY, 1, 0)})).has("no_such_pin"));
}

static void test_pin_used_twice_rejected() {
  PmIssues r = pm_validate(B, cfg({ch(PM_CHANNEL_KIND_SERVO, 1, 13),
                                   ch(PM_CHANNEL_KIND_RELAY, 1, 13)}));
  TEST_ASSERT_TRUE(r.has("pin_taken"));
  TEST_ASSERT_EQUAL(1, r.items[0].channel);  // blamed on the later channel
}

static void test_motor_needs_two_different_pins() {
  TEST_ASSERT_TRUE(pm_validate(B, cfg({ch(PM_CHANNEL_KIND_MOTOR, 1, 25, 25)})).has("pin_taken"));
  TEST_ASSERT_TRUE(pm_validate(B, cfg({ch(PM_CHANNEL_KIND_MOTOR, 1, 25)})).has("pin_count"));
}

static void test_duplicate_channel_rejected() {
  PmIssues r = pm_validate(B, cfg({ch(PM_CHANNEL_KIND_SERVO, 1, 13),
                                   ch(PM_CHANNEL_KIND_SERVO, 1, 4)}));
  TEST_ASSERT_TRUE(r.has("duplicate_channel"));
}

static void test_same_index_different_kind_ok() {
  PmIssues r = pm_validate(B, cfg({ch(PM_CHANNEL_KIND_SERVO, 1, 13),
                                   ch(PM_CHANNEL_KIND_RELAY, 1, 4)}));
  TEST_ASSERT_EQUAL(0, r.count);
}

static void test_unknown_kind_and_zero_index_rejected() {
  TEST_ASSERT_TRUE(pm_validate(B, cfg({ch(99, 1, 13)})).has("unknown_kind"));
  TEST_ASSERT_TRUE(pm_validate(B, cfg({ch(PM_CHANNEL_KIND_RELAY, 0, 13)})).has("bad_index"));
}

static void test_servo_range_checked() {
  PmChannelCfg s = ch(PM_CHANNEL_KIND_SERVO, 1, 13);
  s.min_us = 2000;  // reversed: allowed
  s.max_us = 1000;
  TEST_ASSERT_FALSE(pm_validate(B, cfg({s})).has("servo_range"));
  s.min_us = 100;   // below the absolute floor
  s.max_us = 2000;
  TEST_ASSERT_TRUE(pm_validate(B, cfg({s})).has("servo_range"));
  s.min_us = 2000;  // ends captured at the same spot
  s.max_us = 2020;
  TEST_ASSERT_TRUE(pm_validate(B, cfg({s})).has("servo_range"));
  s.min_us = 2700;  // reversed but beyond the ceiling
  s.max_us = 1000;
  TEST_ASSERT_TRUE(pm_validate(B, cfg({s})).has("servo_range"));
}

static void test_servo_motion_limits() {
  PmChannelCfg s = ch(PM_CHANNEL_KIND_SERVO, 1, 13);
  s.travel_ms = 600;
  s.ease_ms = 200;
  TEST_ASSERT_EQUAL(0, pm_validate(B, cfg({s})).count);
  s.travel_ms = PM_MAX_TRAVEL_MS + 1;
  TEST_ASSERT_TRUE(pm_validate(B, cfg({s})).has("servo_motion"));
}

static void test_servo_motion_round_trips() {
  JsonDocument d, out;
  deserializeJson(d, "{\"channels\":[{\"kind\":\"SERVO\",\"index\":1,\"pins\":[13],\"travel_ms\":600,\"ease_ms\":200}]}");
  PmNodeConfig c;
  TEST_ASSERT_NULL(pm_config_from_json(d.as<JsonVariantConst>(), c));
  TEST_ASSERT_EQUAL(600, c.channels[0].travel_ms);
  TEST_ASSERT_EQUAL(200, c.channels[0].ease_ms);
  pm_config_to_json(c, out.to<JsonObject>());
  TEST_ASSERT_EQUAL(600, out["channels"][0]["travel_ms"].as<int>());
}

// Reverse = min above max: value 0 is the high pulse.
static void test_reversed_servo_maps_backwards() {
  PmChannelCfg s = ch(PM_CHANNEL_KIND_SERVO, 1, 13);
  s.min_us = 2000;
  s.max_us = 1000;
  TEST_ASSERT_EQUAL_UINT32(2000, pm_servo_pulse_us(s, 0));
  TEST_ASSERT_EQUAL_UINT32(1500, pm_servo_pulse_us(s, 500));
  TEST_ASSERT_EQUAL_UINT32(1000, pm_servo_pulse_us(s, 1000));
  TEST_ASSERT_EQUAL_INT32(250, pm_servo_value_of(s, 1750));
}

static void test_calibration_pulse_clamped() {
  TEST_ASSERT_EQUAL_UINT32(PM_SERVO_MIN_US, pm_servo_clamp_us(0));
  TEST_ASSERT_EQUAL_UINT32(PM_SERVO_MAX_US, pm_servo_clamp_us(9000));
  TEST_ASSERT_EQUAL_UINT32(1234, pm_servo_clamp_us(1234));
}

static void test_pixel_count_checked() {
  PmChannelCfg s = ch(PM_CHANNEL_KIND_LED_STRIP, 1, 16);
  s.pixels = 0;
  TEST_ASSERT_TRUE(pm_validate(B, cfg({s})).has("pixel_count"));
  s.pixels = PM_STRIP_MAX_PIXELS + 1;
  TEST_ASSERT_TRUE(pm_validate(B, cfg({s})).has("pixel_count"));
}

// A board with few PWM channels (the C3 has 6) must refuse a config
// that fits the pin count but not the peripheral.
static void test_pwm_budget_enforced() {
  pm_board_t small = B;
  small.ledc_channels = 3;
  PmIssues r = pm_validate(small, cfg({ch(PM_CHANNEL_KIND_MOTOR, 1, 25, 26),
                                       ch(PM_CHANNEL_KIND_SERVO, 1, 13),
                                       ch(PM_CHANNEL_KIND_LED, 1, 4)}));
  TEST_ASSERT_TRUE(r.has("pwm_budget"));
  small.ledc_channels = 4;
  TEST_ASSERT_EQUAL(0, pm_validate(small, cfg({ch(PM_CHANNEL_KIND_MOTOR, 1, 25, 26),
                                               ch(PM_CHANNEL_KIND_SERVO, 1, 13),
                                               ch(PM_CHANNEL_KIND_LED, 1, 4)})).errors);
}

// Every profile must leave something to assign, and every non-good pin
// must carry the warning text the UI shows.
static void test_board_profile_is_sane() {
  int outs = 0;
  for (uint8_t i = 0; i < B.pin_count; i++) {
    const pm_board_pin_t &p = B.pins[i];
    if (p.caps & PM_CAP_OUT) outs++;
    if (p.tier != PM_TIER_GOOD) TEST_ASSERT_NOT_NULL(p.note);
    if (p.gpio >= 34) TEST_ASSERT_FALSE(p.caps & (PM_CAP_OUT | PM_CAP_PULLUP));
  }
  TEST_ASSERT_GREATER_THAN(10, outs);
}

// --- value mapping ---------------------------------------------------

static void test_servo_pulse_spans_end_stops() {
  PmChannelCfg s = ch(PM_CHANNEL_KIND_SERVO, 1, 13);
  s.min_us = 1000;
  s.max_us = 2000;
  TEST_ASSERT_EQUAL_UINT32(1000, pm_servo_pulse_us(s, 0));
  TEST_ASSERT_EQUAL_UINT32(1500, pm_servo_pulse_us(s, 500));
  TEST_ASSERT_EQUAL_UINT32(2000, pm_servo_pulse_us(s, 1000));
  TEST_ASSERT_EQUAL_UINT32(2000, pm_servo_pulse_us(s, 5000));  // clamped
  TEST_ASSERT_EQUAL_UINT32(1000, pm_servo_pulse_us(s, -5));
}

static void test_duty_math() {
  TEST_ASSERT_EQUAL_UINT32(0, pm_duty(0, 12));
  TEST_ASSERT_EQUAL_UINT32(4095, pm_duty(1000, 12));
  TEST_ASSERT_EQUAL_UINT32(2048, pm_duty(500, 12));
  // 1500 us of a 20 ms frame at 14 bits = 7.5 % of 16384
  TEST_ASSERT_EQUAL_UINT32(1228, pm_pulse_duty(1500, 50, 14));
}

static void test_value_clamped_to_function_range() {
  const pm_function_t *m = pm_function(PM_CHANNEL_KIND_MOTOR);
  TEST_ASSERT_EQUAL_INT32(-1000, pm_clamp_value(*m, -4000));
  TEST_ASSERT_EQUAL_INT32(1000, pm_clamp_value(*m, 4000));
  TEST_ASSERT_EQUAL_INT32(1, pm_clamp_value(*pm_function(PM_CHANNEL_KIND_RELAY), 7));
}

// --- JSON codec ------------------------------------------------------

static const char *SAMPLE =
    "{\"v\":1,\"name\":\"Porch skeleton\",\"channels\":["
    "{\"kind\":\"SERVO\",\"index\":1,\"label\":\"jaw\",\"pins\":[13],\"min_us\":600,\"max_us\":2400},"
    "{\"kind\":\"RELAY\",\"index\":2,\"label\":\"fogger\",\"pins\":[4],\"active_low\":true},"
    "{\"kind\":\"MOTOR\",\"index\":1,\"pins\":[25,26]},"
    "{\"kind\":\"LED_STRIP\",\"index\":1,\"pins\":[16],\"pixels\":60},"
    "{\"kind\":\"DIGITAL_IN\",\"index\":1,\"label\":\"PIR\",\"pins\":[27],\"pull\":\"down\"}]}";

static void test_json_parses() {
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, SAMPLE));
  PmNodeConfig c;
  TEST_ASSERT_NULL(pm_config_from_json(doc.as<JsonVariantConst>(), c));
  TEST_ASSERT_EQUAL_STRING("Porch skeleton", c.name);
  TEST_ASSERT_EQUAL(5, c.channel_count);
  TEST_ASSERT_EQUAL(PM_CHANNEL_KIND_SERVO, c.channels[0].kind);
  TEST_ASSERT_EQUAL(600, c.channels[0].min_us);
  TEST_ASSERT_TRUE(c.channels[1].active_low);
  TEST_ASSERT_EQUAL(2, c.channels[2].pin_count);
  TEST_ASSERT_EQUAL(26, c.channels[2].pins[1]);
  TEST_ASSERT_EQUAL(60, c.channels[3].pixels);
  TEST_ASSERT_EQUAL(PM_PULL_DOWN, c.channels[4].pull);
  TEST_ASSERT_EQUAL(0, pm_validate(B, c).count);
}

static void test_json_round_trips() {
  JsonDocument doc, out, back;
  deserializeJson(doc, SAMPLE);
  PmNodeConfig a, b;
  pm_config_from_json(doc.as<JsonVariantConst>(), a);
  pm_config_to_json(a, out.to<JsonObject>());
  char buf[1024];
  serializeJson(out, buf, sizeof(buf));
  TEST_ASSERT_FALSE(deserializeJson(back, buf));
  TEST_ASSERT_NULL(pm_config_from_json(back.as<JsonVariantConst>(), b));
  TEST_ASSERT_EQUAL(a.channel_count, b.channel_count);
  for (uint8_t i = 0; i < a.channel_count; i++) {
    TEST_ASSERT_EQUAL(a.channels[i].kind, b.channels[i].kind);
    TEST_ASSERT_EQUAL(a.channels[i].index, b.channels[i].index);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(a.channels[i].pins, b.channels[i].pins, PM_FN_MAX_PINS);
    TEST_ASSERT_EQUAL_STRING(a.channels[i].label, b.channels[i].label);
    TEST_ASSERT_EQUAL(a.channels[i].active_low, b.channels[i].active_low);
    TEST_ASSERT_EQUAL(a.channels[i].pull, b.channels[i].pull);
    TEST_ASSERT_EQUAL(a.channels[i].min_us, b.channels[i].min_us);
    TEST_ASSERT_EQUAL(a.channels[i].pixels, b.channels[i].pixels);
  }
}

static void test_json_rejects_bad_shape() {
  PmNodeConfig c;
  JsonDocument d1, d2, d3, d4;
  deserializeJson(d1, "[1,2]");
  TEST_ASSERT_NOT_NULL(pm_config_from_json(d1.as<JsonVariantConst>(), c));
  deserializeJson(d2, "{\"channels\":[{\"kind\":\"LASER\",\"index\":1,\"pins\":[4]}]}");
  TEST_ASSERT_NOT_NULL(pm_config_from_json(d2.as<JsonVariantConst>(), c));
  deserializeJson(d3, "{\"channels\":[{\"kind\":\"RELAY\",\"pins\":[4]}]}");
  TEST_ASSERT_NOT_NULL(pm_config_from_json(d3.as<JsonVariantConst>(), c));
  deserializeJson(d4, "{\"channels\":[{\"kind\":\"RELAY\",\"index\":1,\"pins\":[4,5,6]}]}");
  TEST_ASSERT_NOT_NULL(pm_config_from_json(d4.as<JsonVariantConst>(), c));
}

// A misspelt pull must not silently become "none" and float an input.
static void test_json_bad_pull_fails_validation() {
  JsonDocument d;
  deserializeJson(d, "{\"channels\":[{\"kind\":\"DIGITAL_IN\",\"index\":1,\"pins\":[27],\"pull\":\"sideways\"}]}");
  PmNodeConfig c;
  TEST_ASSERT_NULL(pm_config_from_json(d.as<JsonVariantConst>(), c));
  TEST_ASSERT_TRUE(pm_validate(B, c).has("no_pull"));
}

static void test_long_label_truncated_not_overflowed() {
  JsonDocument d;
  deserializeJson(d, "{\"name\":\"0123456789012345678901234567890123456789\",\"channels\":[]}");
  PmNodeConfig c;
  TEST_ASSERT_NULL(pm_config_from_json(d.as<JsonVariantConst>(), c));
  TEST_ASSERT_EQUAL(PM_NAME_LEN - 1, strlen(c.name));
}

// A bridge is the console's way into the mesh — it must not also be
// driving props, or a config push could twitch a prop on the bridge.
static void test_bridge_with_pins_rejected() {
  PmNodeConfig c = cfg({ch(PM_CHANNEL_KIND_RELAY, 1, 4)});
  c.bridge = true;
  TEST_ASSERT_TRUE(pm_validate(B, c).has("bridge_has_pins"));
  c.channel_count = 0;
  TEST_ASSERT_EQUAL(0, pm_validate(B, c).count);
}

static void test_bridge_flag_round_trips() {
  JsonDocument d, out;
  deserializeJson(d, "{\"name\":\"Bridge\",\"bridge\":true,\"channels\":[]}");
  PmNodeConfig c;
  TEST_ASSERT_NULL(pm_config_from_json(d.as<JsonVariantConst>(), c));
  TEST_ASSERT_TRUE(c.bridge);
  pm_config_to_json(c, out.to<JsonObject>());
  TEST_ASSERT_TRUE(out["bridge"].as<bool>());
}

// BLE lights use no pin; they need the BRMesh key and distinct numbers.
static void test_ble_light_rules() {
  PmChannelCfg a; a.kind = PM_CHANNEL_KIND_BLE_LIGHT; a.index = 1; a.light_id = 1;
  PmChannelCfg b = a; b.index = 2; b.light_id = 2;
  PmNodeConfig c = cfg({a, b});
  TEST_ASSERT_TRUE(pm_validate(B, c).has("ble_no_key"));
  c.has_brmesh_key = true;
  TEST_ASSERT_EQUAL(0, pm_validate(B, c).count);
  c.channels[1].light_id = 1;
  TEST_ASSERT_TRUE(pm_validate(B, c).has("ble_light_dup"));
  c.channels[1].light_id = 0;
  TEST_ASSERT_TRUE(pm_validate(B, c).has("ble_light_id"));
}

static void test_ble_light_json() {
  JsonDocument d, out;
  deserializeJson(d, "{\"brmesh_key\":\"5a13c79e\",\"channels\":[{\"kind\":\"BLE_LIGHT\",\"index\":1,\"label\":\"porch flood\",\"pins\":[],\"light\":3}]}");
  PmNodeConfig c;
  TEST_ASSERT_NULL(pm_config_from_json(d.as<JsonVariantConst>(), c));
  TEST_ASSERT_TRUE(c.has_brmesh_key);
  TEST_ASSERT_EQUAL_HEX8(0x5a, c.brmesh_key[0]);
  TEST_ASSERT_EQUAL_HEX8(0x9e, c.brmesh_key[3]);
  TEST_ASSERT_EQUAL(3, c.channels[0].light_id);
  TEST_ASSERT_EQUAL(0, c.channels[0].pin_count);
  TEST_ASSERT_EQUAL(0, pm_validate(B, c).count);
  pm_config_to_json(c, out.to<JsonObject>());
  TEST_ASSERT_EQUAL_STRING("5a13c79e", out["brmesh_key"]);
  TEST_ASSERT_EQUAL(3, out["channels"][0]["light"].as<int>());
  deserializeJson(d, "{\"brmesh_key\":\"5a13zz9e\",\"channels\":[]}");
  TEST_ASSERT_NOT_NULL(pm_config_from_json(d.as<JsonVariantConst>(), c));
}

// The board's flash must keep the bridge's WiFi password across a reboot;
// what a console reads must not contain it (2026-10-08: the file got the
// console's version, and the bridge lost its WiFi at its first reboot).
static void test_wifi_password_kept_in_flash_not_shown() {
  PmNodeConfig c;
  pm_copy(c.name, "Bridge", sizeof(c.name));
  c.bridge = true;
  pm_copy(c.wifi_ssid, "home", sizeof(c.wifi_ssid));
  pm_copy(c.wifi_pass, "s3cret", sizeof(c.wifi_pass));
  JsonDocument file, console;
  pm_config_to_json(c, file.to<JsonObject>(), true);
  pm_config_to_json(c, console.to<JsonObject>());
  PmNodeConfig back;
  TEST_ASSERT_NULL(pm_config_from_json(file.as<JsonVariantConst>(), back));
  TEST_ASSERT_EQUAL_STRING("home", back.wifi_ssid);
  TEST_ASSERT_EQUAL_STRING("s3cret", back.wifi_pass);
  TEST_ASSERT_TRUE(console["wifi"]["pass"].isNull());
  TEST_ASSERT_TRUE(console["wifi"]["pass_set"].as<bool>());
}

// A battery repeater (docs §6m) keeps its relay setting through flash and
// the console; a plain battery board doesn't grow one, and a mains board
// writes no sleep block at all.
static void test_battery_repeater_setting_round_trips() {
  PmNodeConfig c;
  c.battery = true;
  c.sleep_relay = true;
  JsonDocument doc;
  pm_config_to_json(c, doc.to<JsonObject>());
  TEST_ASSERT_TRUE(doc["sleep"]["relay"].as<bool>());
  PmNodeConfig back;
  TEST_ASSERT_NULL(pm_config_from_json(doc.as<JsonVariantConst>(), back));
  TEST_ASSERT_TRUE(back.battery);
  TEST_ASSERT_TRUE(back.sleep_relay);

  c.sleep_relay = false;
  JsonDocument plain;
  pm_config_to_json(c, plain.to<JsonObject>());
  TEST_ASSERT_TRUE(plain["sleep"]["relay"].isNull());

  c.battery = false;
  JsonDocument mains;
  pm_config_to_json(c, mains.to<JsonObject>());
  TEST_ASSERT_TRUE(mains["sleep"].isNull());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_plain_config_is_clean);
  RUN_TEST(test_empty_config_is_valid);
  RUN_TEST(test_output_on_input_only_pin_rejected);
  RUN_TEST(test_input_on_input_only_pin_ok_but_no_pull);
  RUN_TEST(test_input_on_gpio12_rejected);
  RUN_TEST(test_strapping_output_is_warning_not_error);
  RUN_TEST(test_usb_serial_pins_reserved);
  RUN_TEST(test_pin_not_on_board_rejected);
  RUN_TEST(test_pin_used_twice_rejected);
  RUN_TEST(test_motor_needs_two_different_pins);
  RUN_TEST(test_duplicate_channel_rejected);
  RUN_TEST(test_same_index_different_kind_ok);
  RUN_TEST(test_unknown_kind_and_zero_index_rejected);
  RUN_TEST(test_servo_range_checked);
  RUN_TEST(test_reversed_servo_maps_backwards);
  RUN_TEST(test_servo_motion_limits);
  RUN_TEST(test_servo_motion_round_trips);
  RUN_TEST(test_calibration_pulse_clamped);
  RUN_TEST(test_pixel_count_checked);
  RUN_TEST(test_pwm_budget_enforced);
  RUN_TEST(test_board_profile_is_sane);
  RUN_TEST(test_servo_pulse_spans_end_stops);
  RUN_TEST(test_duty_math);
  RUN_TEST(test_value_clamped_to_function_range);
  RUN_TEST(test_json_parses);
  RUN_TEST(test_json_round_trips);
  RUN_TEST(test_json_rejects_bad_shape);
  RUN_TEST(test_json_bad_pull_fails_validation);
  RUN_TEST(test_long_label_truncated_not_overflowed);
  RUN_TEST(test_bridge_with_pins_rejected);
  RUN_TEST(test_bridge_flag_round_trips);
  RUN_TEST(test_ble_light_rules);
  RUN_TEST(test_ble_light_json);
  RUN_TEST(test_wifi_password_kept_in_flash_not_shown);
  RUN_TEST(test_battery_repeater_setting_round_trips);
  return UNITY_END();
}
