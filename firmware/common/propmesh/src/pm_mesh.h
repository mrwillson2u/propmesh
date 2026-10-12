// PropMesh flood mesh core — ESP-NOW broadcast flooding.
// Design: docs/software-plan.md §3. Connectionless: no peers, no topology
// state. Frames carry (src, seq, ttl); relay-role nodes rebroadcast once
// after jitter; everyone dedups on a (src, seq) sliding window.
#pragma once
#include <stdint.h>
#include "proto_gen.h"
#include "pm_neighbors.h"
#include "pm_time.h"

// Handler receives every valid, non-duplicate frame addressed to the mesh.
// `rssi` is the received signal strength of the last hop (dBm).
typedef void (*pm_rx_handler_t)(const pm_frame_header_t *hdr,
                                const uint8_t *payload, uint8_t len,
                                int8_t rssi);

typedef struct {
  uint32_t rx;            // valid frames delivered to the app
  uint32_t tx;            // frames originated by this node
  uint32_t relayed;       // frames rebroadcast for others
  uint32_t dropped_dupe;  // dedup window hits
  uint32_t dropped_bad;   // wrong magic / net / version / size
  uint32_t relay_overrun; // relay queue full — frame not forwarded
  uint32_t tx_err;        // esp_now_send refused a frame (ours or a relay)
  int32_t last_tx_err;    // its esp_err_t, 0 = none yet
} pm_stats_t;

// Bring up WiFi STA + ESP-NOW on `channel` and join network `net_id`.
// `role` is pm_node_role_t flags; PM_NODE_ROLE_RELAY enables rebroadcast,
// PM_NODE_ROLE_CONDUCTOR makes this node the mesh time authority.
bool pm_mesh_init(uint8_t channel, uint16_t net_id, uint8_t role);

// This node's id (last 4 bytes of the efuse MAC).
uint32_t pm_node_id();

// Roles are runtime state, not a build flag: a node is promoted to
// conductor (or bridge) by config or election, and a conductor steps
// down on its own when it hears a higher-id conductor.
uint8_t pm_role();
void pm_set_role(uint8_t role);

// Broadcast a message into the flood. `len` <= PM_MAX_PAYLOAD.
bool pm_send(pm_msg_type_t type, const void *payload, uint8_t len,
             uint8_t ttl = PM_DEFAULT_TTL);

void pm_on_receive(pm_rx_handler_t handler);

// --- channel -------------------------------------------------------------
// The mesh lives on whatever channel the bridge is on (a bridge on home
// WiFi follows its router). Heartbeats carry it; a node that hasn't heard
// a bridge for a while scans 1-13 for one and moves (docs §6d).
uint8_t pm_mesh_channel();
// Force a channel now (bridge without WiFi, or a bench test).
void pm_mesh_set_channel(uint8_t ch);
// Bring ESP-NOW back after anything that stopped the WiFi driver
// (WiFi.mode(WIFI_OFF), disconnect(true)): the driver drops the ESP-NOW
// registration and every send fails with "esp now not init" until this
// runs. Also sets the channel back to `ch`.
bool pm_mesh_recover(uint8_t ch);

// "Nobody hears me": how long this node has been hearing neighbors'
// heartbeats while none of them lists it as a neighbor — i.e. its own
// frames aren't getting out. 0 = fine, or nothing to judge by (no
// mains-powered neighbor with room in its list heard in the last 20 s).
// Found 2026-10-12: Prop heard the bridge and the Feather at -35 dBm for
// hours while neither heard it, with nothing on any log.
uint32_t pm_mesh_unheard_ms();
void pm_mesh_unheard_reset();  // start judging afresh (after a radio restart)
// Called when this node moves to a new channel (persist it for next boot).
void pm_mesh_on_channel(void (*cb)(uint8_t));
// Seconds since a bridge was last heard; 0xFFFF = never.
uint16_t pm_mesh_bridge_age_s();

// --- sleepy leaves (docs §6f) --------------------------------------------
// The longest listen interval any battery board on the mesh advertised in
// the last minute (0 = everyone listens all the time). Senders repeat a
// cue or a wake-up across it so one copy lands in the board's window.
uint16_t pm_mesh_leaf_listen_ms();
bool pm_mesh_is_leaf(uint32_t id);  // advertised a listen interval recently
// This node's own sync may age this long before counting as stale (a
// leaf that hears one beacon in ten raises it).
void pm_mesh_set_stale_ms(uint32_t ms);
bool pm_mesh_scanning();

// Call every loop(): flushes the jittered relay queue, ages the neighbor
// table, and emits the time beacon when this node is conductor.
void pm_mesh_loop();

// --- Mesh time -------------------------------------------------------
// Shared timebase for cue scheduling. Valid only while pm_time_synced().
int64_t pm_mesh_time_us();
// Local microseconds at which a given mesh time arrives — turns a cue's
// scheduled time into a local deadline.
int64_t pm_local_time_us(int64_t mesh_time_us);
bool pm_time_synced();
uint32_t pm_conductor_id();
uint8_t pm_sync_hop();  // hops from the conductor; 0 = we are it

// Wall clock (show schedule). Set by the console or SNTP; followers take
// the conductor's from its TIME beacon. pm_wall().ok() before trusting it.
PmWallClock &pm_wall();
int64_t pm_wall_utc_ms();

// --- Topology --------------------------------------------------------
// Nodes heard directly, strongest first. Fills the heartbeat's neighbor
// list, which the console renders as the mesh graph.
uint8_t pm_neighbor_snapshot(pm_neighbor_t *out, uint8_t max);

const pm_stats_t *pm_stats();
