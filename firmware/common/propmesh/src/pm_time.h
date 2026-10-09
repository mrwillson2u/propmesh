// Mesh clock — one shared timebase so every node fires a cue together.
//
// Cues carry an absolute mesh time in the near future rather than "fire
// now", so hop latency and relay jitter are absorbed by the schedule
// instead of showing up as a visible stagger across the yard.
// Header-only, host-testable.
#pragma once
#include <stdint.h>

// A beacon older than this means the conductor is gone; any conductor
// is then better than none.
#define PM_SYNC_STALE_MS (PM_HEARTBEAT_PERIOD_MS * 4)

// Offset corrections below this are smoothed rather than applied whole,
// so the clock never steps backwards under normal jitter. A delta this
// large means a reboot or a new conductor — jump instead.
#define PM_SYNC_JUMP_US 100000  // 100 ms

class PmClock {
 public:
  // The conductor is its own time authority.
  void become_conductor(uint32_t self_id, uint8_t priority, uint32_t now_ms) {
    m_conductor = self_id;
    m_priority = priority;
    m_hop = 0;
    m_offset_us = 0;
    m_synced = true;
    m_self = true;
    m_last_ms = now_ms;
  }

  // Only the node that took the role — not a follower that hears the
  // conductor directly, which is also at hop 0. Until 2026-10-08 that
  // follower counted as a conductor too and sent its own time beacons.
  bool is_conductor() const { return m_synced && m_self; }

  // Stop being the authority; the next beacon heard is adopted.
  void resign() { m_synced = false; m_self = false; m_hop = 0xFF; }

  // Election order: priority first (a bridge is 1), then node id.
  static uint64_t rank(uint8_t priority, uint32_t id) {
    return ((uint64_t)priority << 32) | id;
  }

  // Election: highest (priority, node id) wins, so the mesh converges
  // on one conductor without negotiation — the bridge when there is
  // one, else the highest id. A closer path to the SAME conductor is
  // preferred (fewer hops = less accumulated error). A stale sync loses
  // to anything — a show must not stop because the bridge died.
  bool should_adopt(uint32_t conductor, uint8_t priority, uint8_t hop,
                    uint32_t now_ms) const {
    if (!m_synced) return true;
    if (stale(now_ms)) return true;
    if (conductor != m_conductor)
      return rank(priority, conductor) > rank(m_priority, m_conductor);
    return hop <= m_hop;
  }

  // `offset_us` is (beacon mesh time) - (local time at receipt).
  void adopt(uint32_t conductor, uint8_t priority, uint8_t hop,
             int64_t offset_us, uint32_t now_ms) {
    int64_t delta = offset_us - m_offset_us;
    bool jump = !m_synced || conductor != m_conductor ||
                delta > PM_SYNC_JUMP_US || delta < -PM_SYNC_JUMP_US;
    m_offset_us = jump ? offset_us : m_offset_us + delta / 4;
    m_conductor = conductor;
    m_priority = priority;
    m_hop = hop;
    m_synced = true;
    m_self = false;
    m_last_ms = now_ms;
  }

  int64_t mesh_us(int64_t local_us) const { return local_us + m_offset_us; }

  // Local time at which a given mesh time arrives — how a scheduled cue
  // becomes a local deadline.
  int64_t local_us(int64_t mesh_time_us) const {
    return mesh_time_us - m_offset_us;
  }

  bool synced(uint32_t now_ms) const { return m_synced && !stale(now_ms); }
  // A follower's sync ages from the last beacon heard. The conductor IS
  // the clock: it never goes stale. (Until 2026-10-08 it did, 20 s after
  // taking the role — so a cue fired from the console through the bridge
  // carried no mesh time, and each board started it on arrival instead
  // of together.)
  bool stale(uint32_t now_ms) const {
    if (m_self) return false;
    return (uint32_t)(now_ms - m_last_ms) > PM_SYNC_STALE_MS;
  }

  uint32_t conductor() const { return m_conductor; }
  uint8_t hop() const { return m_hop; }
  int64_t offset_us() const { return m_offset_us; }

 private:
  uint32_t m_conductor = 0;
  uint8_t m_priority = 0;
  uint32_t m_last_ms = 0;
  int64_t m_offset_us = 0;
  uint8_t m_hop = 0xFF;
  bool m_synced = false;
  bool m_self = false;  // this node took the conductor role (become_conductor)
};
