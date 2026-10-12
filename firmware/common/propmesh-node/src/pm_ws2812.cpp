#include "pm_ws2812.h"
#include <string.h>
#include <Arduino.h>
#include <driver/rmt_tx.h>
#include <driver/rmt_encoder.h>
#include <soc/soc_caps.h>

// WS2812 timing at a 10 MHz tick (0.1 µs): 0 = 0.4 µs high, 0.85 µs low;
// 1 = 0.8 µs high, 0.45 µs low. Within spec for WS2812B/SK6812 and the
// usual clones; the reset latch (>50 µs low) is simply the gap between
// shows.
#define RES_HZ 10000000
#define T0H 4
#define T0L 9
#define T1H 8
#define T1L 5

bool PmStrip::begin(uint8_t gpio, uint16_t pixels, uint8_t ord) {
  end();
  buf = (uint8_t *)calloc(pixels, 3);
  if (!buf) return false;
  order = ord;
  rmt_tx_channel_config_t tx = {};
  tx.gpio_num = (gpio_num_t)gpio;
  tx.clk_src = RMT_CLK_SRC_DEFAULT;
  tx.resolution_hz = RES_HZ;
  tx.mem_block_symbols = SOC_RMT_MEM_WORDS_PER_CHANNEL;  // one block: 64 on the ESP32, 48 on the C6
  tx.trans_queue_depth = 1;  // one frame in flight; show() waits for the last
  rmt_channel_handle_t ch = nullptr;
  if (rmt_new_tx_channel(&tx, &ch) != ESP_OK) { free(buf); buf = nullptr; return false; }
  rmt_bytes_encoder_config_t be = {};
  be.bit0.level0 = 1; be.bit0.duration0 = T0H; be.bit0.level1 = 0; be.bit0.duration1 = T0L;
  be.bit1.level0 = 1; be.bit1.duration0 = T1H; be.bit1.level1 = 0; be.bit1.duration1 = T1L;
  be.flags.msb_first = 1;
  rmt_encoder_handle_t e = nullptr;
  if (rmt_new_bytes_encoder(&be, &e) != ESP_OK || rmt_enable(ch) != ESP_OK) {
    if (e) rmt_del_encoder(e);
    rmt_del_channel(ch);
    free(buf); buf = nullptr;
    return false;
  }
  chan = ch; enc = e; n = pixels; pin = gpio;
  show();  // all off
  return true;
}

void PmStrip::end() {
  if (chan) {
    fill(0);
    show();
    rmt_tx_wait_all_done((rmt_channel_handle_t)chan, 100);
    rmt_disable((rmt_channel_handle_t)chan);
    rmt_del_encoder((rmt_encoder_handle_t)enc);
    rmt_del_channel((rmt_channel_handle_t)chan);
    chan = enc = nullptr;
  }
  free(buf); buf = nullptr;
  n = 0;
}

void PmStrip::show() {
  if (!chan) return;
  // A fade steps faster than a long strip clocks out: wait for the previous
  // frame (300 px ≈ 9 ms) rather than drop this one.
  rmt_tx_wait_all_done((rmt_channel_handle_t)chan, 50);
  rmt_transmit_config_t cfg = {};
  rmt_transmit((rmt_channel_handle_t)chan, (rmt_encoder_handle_t)enc, buf, (size_t)n * 3, &cfg);
}
