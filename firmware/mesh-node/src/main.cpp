// PropMesh mesh testbed node.
// Every node heartbeats into the flood and prints what it hears, with
// RSSI — put a few on a shelf and this is the soak test; carry one
// around the yard and it's the range test.
//
// All nodes run the same image: the highest node id elects itself
// conductor, so there is nothing to configure per board.
#include <Arduino.h>
#include "pm_mesh.h"

#ifndef PM_CHANNEL
#define PM_CHANNEL 1
#endif
#ifndef PM_NET_ID
#define PM_NET_ID 0xCAFE
#endif

// Wait this long before claiming the conductor role, so every node has
// had a chance to be heard before anyone decides it is the highest id.
#define ELECTION_SETTLE_MS (PM_HEARTBEAT_PERIOD_MS * 3)

static uint32_t last_heartbeat, last_stats;
static uint32_t highest_seen;    // highest node id heard, including self
static uint32_t unsynced_since;  // 0 while synced

static void led(bool on) {
#ifdef PM_LED_PIN
#ifdef PM_LED_ACTIVE_LOW
  digitalWrite(PM_LED_PIN, !on);
#else
  digitalWrite(PM_LED_PIN, on);
#endif
#endif
}

static void on_frame(const pm_frame_header_t *hdr, const uint8_t *payload,
                     uint8_t len, int8_t rssi) {
  led(true);
  if (hdr->src_id > highest_seen) highest_seen = hdr->src_id;

  if (hdr->msg_type == PM_MSG_TYPE_HEARTBEAT &&
      len >= sizeof(pm_heartbeat_t)) {
    pm_heartbeat_t hb;
    memcpy(&hb, payload, sizeof(hb));
    Serial.printf("[%08lx] heartbeat  up=%lus heap=%uKB nbrs=%u ttl=%u rssi=%d\n",
                  (unsigned long)hdr->src_id, (unsigned long)hb.uptime_s,
                  hb.free_heap_kb, hb.neighbor_count, hdr->ttl, rssi);
  } else if (hdr->msg_type == PM_MSG_TYPE_TIME) {
    // Beacons are frequent and uninteresting once sync is up; the
    // periodic stats line reports sync health instead.
  } else {
    Serial.printf("[%08lx] type=%u len=%u ttl=%u rssi=%d\n",
                  (unsigned long)hdr->src_id, hdr->msg_type, len, hdr->ttl,
                  rssi);
  }
}

void setup() {
  Serial.begin(115200);
#ifdef PM_LED_PIN
  pinMode(PM_LED_PIN, OUTPUT);
  led(false);
#endif
  delay(500);

  // Testbed devkits are all mains powered — everyone relays. Battery
  // Minis will run as PM_NODE_ROLE_LEAF and never rebroadcast.
  if (!pm_mesh_init(PM_CHANNEL, PM_NET_ID, PM_NODE_ROLE_RELAY)) {
    Serial.println("pm_mesh_init FAILED");
    while (true) delay(1000);
  }
  pm_on_receive(on_frame);
  highest_seen = pm_node_id();
  Serial.printf("propmesh testbed node %08lx up, channel %d\n",
                (unsigned long)pm_node_id(), PM_CHANNEL);
}

void loop() {
  pm_mesh_loop();
  led(false);
  uint32_t now = millis();

  // Elect: with no conductor to follow, the highest id promotes itself
  // after a settling period. The high-water mark is reset whenever sync
  // is lost, so a dead conductor's id can't block the next election;
  // stepping back down is handled in the mesh core.
  if (pm_time_synced()) {
    unsynced_since = 0;
  } else if (!unsynced_since) {
    unsynced_since = now ? now : 1;
    highest_seen = pm_node_id();
  } else if ((uint32_t)(now - unsynced_since) > ELECTION_SETTLE_MS &&
             highest_seen == pm_node_id() &&
             !(pm_role() & PM_NODE_ROLE_CONDUCTOR)) {
    pm_set_role(pm_role() | PM_NODE_ROLE_CONDUCTOR);
    Serial.printf("elected self conductor (%08lx)\n",
                  (unsigned long)pm_node_id());
  }

  if (now - last_heartbeat >= PM_HEARTBEAT_PERIOD_MS) {
    last_heartbeat = now;
    pm_heartbeat_t hb = {};
    hb.uptime_s = now / 1000;
    hb.battery_mv = 0;  // devkits are mains
    hb.board = PM_BOARD_TYPE_DEVKIT;
    hb.role = pm_role();
    hb.fw_version = 1;
    hb.free_heap_kb = ESP.getFreeHeap() / 1024;
    hb.neighbor_count = pm_neighbor_snapshot(hb.neighbors, PM_MAX_NEIGHBORS);
    pm_send(PM_MSG_TYPE_HEARTBEAT, &hb, sizeof(hb));
  }

  if (now - last_stats >= 30000) {
    last_stats = now;
    const pm_stats_t *s = pm_stats();
    Serial.printf("stats: rx=%lu tx=%lu relayed=%lu dupes=%lu bad=%lu over=%lu\n",
                  (unsigned long)s->rx, (unsigned long)s->tx,
                  (unsigned long)s->relayed, (unsigned long)s->dropped_dupe,
                  (unsigned long)s->dropped_bad,
                  (unsigned long)s->relay_overrun);
    if (pm_time_synced())
      Serial.printf("sync:  conductor=%08lx hop=%u mesh_time=%llds\n",
                    (unsigned long)pm_conductor_id(), pm_sync_hop(),
                    (long long)(pm_mesh_time_us() / 1000000));
    else
      Serial.println("sync:  UNSYNCED");
  }
}
