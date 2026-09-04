// Flood dedup — per-source sequence window.
//
// Header-only and free of Arduino/ESP includes on purpose: this is the
// logic most worth unit-testing on the host (firmware/test).
#pragma once
#include <stdint.h>
#include <string.h>

#ifndef PM_MAX_SOURCES
#define PM_MAX_SOURCES 24
#endif

// Sequence gap beyond which a source is assumed to have rebooted (its
// counter restarts at 1) rather than to be sending a very late frame.
#define PM_REBOOT_GAP 1024

// A (src, seq) pair is a duplicate if it falls inside that source's
// recent window. Per-source rather than one window shared across the
// mesh: a single flooded frame is heard once per relay path, so a
// shared window churns several entries per originated frame and a late
// duplicate arriving over a long path can fall out of it on a busy
// mesh. Per source, 32 deep, the window is a bitmap of the sequence
// numbers behind `newest` — the IPsec anti-replay shape.
class PmDedup {
 public:
  // Records the pair and returns true if it was already seen.
  bool seen(uint32_t src, uint16_t seq, uint32_t now_ms) {
    Src *s = claim(src, now_ms);
    s->last_ms = now_ms;

    if (!s->primed) {  // first frame from this source
      s->primed = true;
      s->newest = seq;
      s->bitmap = 0;
      return false;
    }

    // Signed difference is wrap-safe: 0x0001 - 0xFFFF == +2.
    int16_t diff = (int16_t)(seq - s->newest);

    if (diff > 0) {  // newer than anything seen — slide the window up
      s->bitmap = (diff >= 32) ? 0
                               : ((s->bitmap << diff) | (1u << (diff - 1)));
      s->newest = seq;
      return false;
    }
    if (diff == 0) return true;

    uint16_t back = (uint16_t)(-diff);
    if (back > PM_REBOOT_GAP) {  // source restarted; adopt its new counter
      s->newest = seq;
      s->bitmap = 0;
      return false;
    }
    if (back > 32) return true;  // older than the window — assume duplicate

    uint32_t bit = 1u << (back - 1);
    if (s->bitmap & bit) return true;
    s->bitmap |= bit;
    return false;
  }

  void reset() { memset(m_src, 0, sizeof(m_src)); }

  uint8_t tracked() const {
    uint8_t n = 0;
    for (uint8_t i = 0; i < PM_MAX_SOURCES; i++)
      if (m_src[i].used) n++;
    return n;
  }

 private:
  struct Src {
    uint32_t id;
    uint32_t last_ms;
    uint32_t bitmap;  // bit i set => seq (newest - 1 - i) was seen
    uint16_t newest;
    bool used;
    bool primed;
  };
  Src m_src[PM_MAX_SOURCES] = {};

  // Existing slot, else a free one, else evict the least recently heard
  // (a node that left the mesh should not hold a slot forever).
  Src *claim(uint32_t id, uint32_t now_ms) {
    Src *free_slot = nullptr;
    Src *stalest = &m_src[0];
    for (uint8_t i = 0; i < PM_MAX_SOURCES; i++) {
      Src *s = &m_src[i];
      if (s->used && s->id == id) return s;
      if (!s->used && !free_slot) free_slot = s;
      if (s->used && (int32_t)(s->last_ms - stalest->last_ms) < 0) stalest = s;
    }
    Src *s = free_slot ? free_slot : stalest;
    *s = {};
    s->id = id;
    s->used = true;
    return s;
  }
};
