// Neighbor table — who this node hears directly, and how strongly.
//
// Feeds the heartbeat's neighbor list, which is what the console's
// survey view renders as the mesh topology. Header-only, host-testable.
#pragma once
#include <stdint.h>
#include <string.h>
#include "proto_gen.h"

// A neighbor is a node heard DIRECTLY (its frame had not been relayed).
// Entries not refreshed within PM_NEIGHBOR_TTL_MS are dropped, so a
// node that goes to sleep or dies falls off the topology on its own.
#define PM_NEIGHBOR_TTL_MS (PM_HEARTBEAT_PERIOD_MS * 3)

class PmNeighbors {
 public:
  // Single-packet RSSI is noisy; smooth it so the survey view doesn't
  // flicker between colors on an otherwise steady link.
  void observe(uint32_t id, int8_t rssi, uint32_t now_ms) {
    Entry *e = claim(id, now_ms);
    e->rssi = e->primed ? (int8_t)((e->rssi * 3 + rssi) / 4) : rssi;
    e->primed = true;
    e->last_ms = now_ms;
  }

  void age(uint32_t now_ms, uint32_t ttl_ms = PM_NEIGHBOR_TTL_MS) {
    for (uint8_t i = 0; i < PM_MAX_NEIGHBORS; i++)
      if (m_e[i].used && (uint32_t)(now_ms - m_e[i].last_ms) > ttl_ms)
        m_e[i] = {};
  }

  // Fills `out` with live neighbors, strongest first. Returns the count.
  uint8_t snapshot(pm_neighbor_t *out, uint8_t max, uint32_t now_ms,
                   uint32_t ttl_ms = PM_NEIGHBOR_TTL_MS) const {
    uint8_t n = 0;
    for (uint8_t i = 0; i < PM_MAX_NEIGHBORS && n < max; i++) {
      const Entry &e = m_e[i];
      if (!e.used || (uint32_t)(now_ms - e.last_ms) > ttl_ms) continue;
      uint8_t at = n++;
      while (at > 0 && out[at - 1].rssi < e.rssi) {  // insertion sort
        out[at] = out[at - 1];
        at--;
      }
      out[at].node_id = e.id;
      out[at].rssi = e.rssi;
    }
    return n;
  }

  uint8_t count(uint32_t now_ms, uint32_t ttl_ms = PM_NEIGHBOR_TTL_MS) const {
    uint8_t n = 0;
    for (uint8_t i = 0; i < PM_MAX_NEIGHBORS; i++)
      if (m_e[i].used && (uint32_t)(now_ms - m_e[i].last_ms) <= ttl_ms) n++;
    return n;
  }

  void reset() { memset(m_e, 0, sizeof(m_e)); }

 private:
  struct Entry {
    uint32_t id;
    uint32_t last_ms;
    int8_t rssi;
    bool used;
    bool primed;
  };
  Entry m_e[PM_MAX_NEIGHBORS] = {};

  // Existing slot, else free, else evict the weakest — when more nodes
  // are in earshot than the table holds, the strong links are the ones
  // worth reporting.
  Entry *claim(uint32_t id, uint32_t now_ms) {
    Entry *free_slot = nullptr;
    Entry *weakest = &m_e[0];
    for (uint8_t i = 0; i < PM_MAX_NEIGHBORS; i++) {
      Entry *e = &m_e[i];
      if (e->used && e->id == id) return e;
      if (!e->used && !free_slot) free_slot = e;
      if (e->used && e->rssi < weakest->rssi) weakest = e;
    }
    Entry *e = free_slot ? free_slot : weakest;
    *e = {};
    e->id = id;
    e->used = true;
    e->last_ms = now_ms;
    return e;
  }
};
