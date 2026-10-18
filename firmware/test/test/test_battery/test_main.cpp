// The LiPo percentage curve (pm_battery.h) and the BATTERY input's config.
#include <unity.h>
#include "pm_battery.h"
#include "pm_pinrules.h"
#include "pm_config_json.h"

void setUp() {}
void tearDown() {}

static void test_lipo_curve_endpoints_and_middle() {
  TEST_ASSERT_EQUAL_UINT8(100, pm_lipo_pct(4200));
  TEST_ASSERT_EQUAL_UINT8(100, pm_lipo_pct(4300));
  TEST_ASSERT_EQUAL_UINT8(0, pm_lipo_pct(3270));
  TEST_ASSERT_EQUAL_UINT8(0, pm_lipo_pct(3000));
  TEST_ASSERT_EQUAL_UINT8(50, pm_lipo_pct(3840));
  TEST_ASSERT_EQUAL_UINT8(5, pm_lipo_pct(3610));
  uint8_t last = 0;  // monotonic through the whole range
  for (uint16_t mv = 3000; mv <= 4300; mv += 10) { uint8_t p = pm_lipo_pct(mv); TEST_ASSERT_TRUE(p >= last); last = p; }
}

static void test_battery_input_config() {
  PmNodeConfig c;
  c.channel_count = 1;
  PmChannelCfg &ch = c.channels[0];
  ch.kind = PM_CHANNEL_KIND_BATTERY;
  ch.index = 1;
  ch.pin_count = 1;
  ch.pins[0] = 34;  // DevKit: input-only, ADC
  ch.batt_div100 = 200;
  JsonDocument doc;
  pm_config_to_json(c, doc.to<JsonObject>());
  TEST_ASSERT_EQUAL_FLOAT(2.0f, doc["channels"][0]["divider"].as<float>());
  PmNodeConfig back;
  TEST_ASSERT_NULL(pm_config_from_json(doc.as<JsonVariantConst>(), back));
  TEST_ASSERT_EQUAL_UINT16(200, back.channels[0].batt_div100);
  TEST_ASSERT_EQUAL_UINT8(0, pm_validate(PM_BOARD_ESP32_DEVKIT_V1, back).errors);
  back.channels[0].pins[0] = 23;  // no ADC on 23
  TEST_ASSERT_TRUE(pm_validate(PM_BOARD_ESP32_DEVKIT_V1, back).has("pin_cannot"));
  back.channels[0].pins[0] = 34;
  back.channels[0].batt_div100 = 50;  // a divider can't step voltage up
  TEST_ASSERT_TRUE(pm_validate(PM_BOARD_ESP32_DEVKIT_V1, back).has("battery_divider"));
  back.channels[0].batt_div100 = 200;
  back.channel_count = 2;
  back.channels[1] = back.channels[0];
  back.channels[1].index = 2;
  back.channels[1].pins[0] = 35;
  TEST_ASSERT_TRUE(pm_validate(PM_BOARD_ESP32_DEVKIT_V1, back).has("battery_dup"));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_lipo_curve_endpoints_and_middle);
  RUN_TEST(test_battery_input_config);
  return UNITY_END();
}
