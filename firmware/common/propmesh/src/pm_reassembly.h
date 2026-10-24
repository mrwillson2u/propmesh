// Reassembles chunked API messages (API_REQ / API_RESP) into the JSON
// text they carry. Chunks arrive flooded, so out of order and
// duplicated; a message is complete when every chunk index has arrived.
// Header-only, no Arduino/ESP includes: tested host-native.
#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "proto_gen.h"

#define PM_API_MAX_CHUNKS 24                                 // 32-bit mask
#define PM_API_MAX_BYTES (PM_API_MAX_CHUNKS * PM_API_CHUNK)  // 4320
#define PM_REASM_SLOTS 3
#define PM_REASM_TIMEOUT_MS 2000

// Chunks needed for `len` bytes (0 = too big to send).
inline uint8_t pm_api_chunk_count(size_t len) {
  size_t n = len ? (len + PM_API_CHUNK - 1) / PM_API_CHUNK : 1;
  return n > PM_API_MAX_CHUNKS ? 0 : (uint8_t)n;
}

// A slot's 4.3 KB buffer exists only while a message is coming in: three
// static slots were 13 KB of a bridge's RAM held for nothing most of the
// time, and the WiFi driver's receive buffers come from that same RAM
// (docs §6j, 2026-10-23). Allocated when a slot is claimed, kept until the
// next call after the message completes or the slot goes stale.
class PmReassembly {
 public:
  ~PmReassembly() { for (Slot &s : m_slots) free(s.buf); }
  // Feed one chunk. Returns the complete message (NUL-terminated, valid
  // until the next call) when this chunk finishes it, else nullptr.
  const char *add(uint32_t src, uint16_t req_id, uint8_t chunk, uint8_t chunks,
                  const uint8_t *data, uint8_t len, uint32_t now_ms,
                  size_t *out_len = nullptr) {
    release_idle(now_ms);
    if (!chunks || chunks > PM_API_MAX_CHUNKS || chunk >= chunks ||
        len > PM_API_CHUNK || (chunk + 1 < chunks && len != PM_API_CHUNK))
      return nullptr;
    Slot &s = slot(src, req_id, chunks, now_ms);
    if (!s.buf) s.buf = (uint8_t *)malloc(PM_API_MAX_BYTES + 1);
    if (!s.buf) { s.used = false; return nullptr; }  // no memory: drop the chunk, a retry comes
    s.last_ms = now_ms;
    uint32_t bit = 1u << chunk;
    if (s.mask & bit) return nullptr;  // duplicate via another relay path
    memcpy(s.buf + chunk * PM_API_CHUNK, data, len);
    s.mask |= bit;
    if (chunk + 1 == chunks) s.total = chunk * PM_API_CHUNK + len;
    if (s.mask != full(chunks)) return nullptr;
    s.buf[s.total] = 0;
    s.used = false;  // a retry of the same req_id starts fresh
    if (out_len) *out_len = s.total;
    return (const char *)s.buf;
  }

 private:
  struct Slot {
    bool used = false;
    uint32_t src = 0;
    uint16_t req_id = 0;
    uint8_t chunks = 0;
    uint32_t mask = 0;
    size_t total = 0;
    uint32_t last_ms = 0;
    uint8_t *buf = nullptr;  // heap, only while in use (see above)
  };
  Slot m_slots[PM_REASM_SLOTS];

  // Give back the buffers of finished and stale slots. The message returned
  // by the previous call lived in a finished slot: it was valid until now.
  void release_idle(uint32_t now_ms) {
    for (Slot &s : m_slots) {
      bool live = s.used && (uint32_t)(now_ms - s.last_ms) <= PM_REASM_TIMEOUT_MS;
      if (!live && s.buf) { free(s.buf); s.buf = nullptr; s.used = false; }
    }
  }

  static uint32_t full(uint8_t chunks) {
    return chunks >= 32 ? 0xFFFFFFFFu : (1u << chunks) - 1;
  }

  Slot &slot(uint32_t src, uint16_t req_id, uint8_t chunks, uint32_t now_ms) {
    Slot *victim = &m_slots[0];
    for (Slot &s : m_slots) {
      bool live = s.used && (uint32_t)(now_ms - s.last_ms) <= PM_REASM_TIMEOUT_MS;
      if (live && s.src == src && s.req_id == req_id && s.chunks == chunks)
        return s;
      if (!live) s.used = false;
      if (!s.used) victim = &s;
      else if (victim->used && s.last_ms < victim->last_ms) victim = &s;
    }
    victim->used = true;
    victim->src = src;
    victim->req_id = req_id;
    victim->chunks = chunks;
    victim->mask = 0;
    victim->total = 0;
    return *victim;
  }
};
