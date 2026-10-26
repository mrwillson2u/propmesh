// GENERATED FILE — DO NOT EDIT
// Source: schema/messages.yaml   Regenerate: python3 tools/genmsg.py

#pragma once
#include <stdint.h>

#define PM_MAGIC 20557  // 0x504d
#define PM_PROTO_VERSION 0
#define PM_MAX_PAYLOAD 200
#define PM_DEFAULT_TTL 4
#define PM_HEARTBEAT_PERIOD_MS 5000  // 0x1388
#define PM_DEDUP_WINDOW 32
#define PM_MAX_NEIGHBORS 8
#define PM_BROADCAST_GROUP 65535  // 0xffff
#define PM_API_CHUNK 180

typedef enum {
    PM_MSG_TYPE_HEARTBEAT = 1,
    PM_MSG_TYPE_TIME = 2,
    PM_MSG_TYPE_CUE = 3,
    PM_MSG_TYPE_STATE = 4,
    PM_MSG_TYPE_CONFIG = 5,
    PM_MSG_TYPE_OTA_ANNOUNCE = 6,
    PM_MSG_TYPE_OTA_CHUNK = 7,
    PM_MSG_TYPE_OTA_NAK = 8,
    PM_MSG_TYPE_API_REQ = 9,
    PM_MSG_TYPE_API_RESP = 10,
} pm_msg_type_t;

typedef enum {
    PM_BOARD_TYPE_DEVKIT = 0,
    PM_BOARD_TYPE_PRO = 1,
    PM_BOARD_TYPE_MINI = 2,
    PM_BOARD_TYPE_HUZZAH32 = 3,
    PM_BOARD_TYPE_C6_SUPERMINI = 4,
    PM_BOARD_TYPE_C3_SUPERMINI = 5,
} pm_board_type_t;

typedef enum {
    PM_NODE_ROLE_LEAF = 0,
    PM_NODE_ROLE_RELAY = 1,
    PM_NODE_ROLE_CONDUCTOR = 2,
    PM_NODE_ROLE_BRIDGE = 4,
    PM_NODE_ROLE_SLEEPING = 8,
} pm_node_role_t;

typedef enum {
    PM_STATE_KIND_SENSOR_TRIGGER = 1,
    PM_STATE_KIND_SENSOR_CLEAR = 2,
    PM_STATE_KIND_SEQUENCE_STARTED = 3,
    PM_STATE_KIND_SEQUENCE_ENDED = 4,
    PM_STATE_KIND_FAULT = 5,
} pm_state_kind_t;

typedef enum {
    PM_CHANNEL_KIND_RELAY = 1,
    PM_CHANNEL_KIND_LED = 2,
    PM_CHANNEL_KIND_SERVO = 3,
    PM_CHANNEL_KIND_MOTOR = 4,
    PM_CHANNEL_KIND_LED_STRIP = 5,
    PM_CHANNEL_KIND_DIGITAL_IN = 6,
    PM_CHANNEL_KIND_BLE_LIGHT = 7,
    PM_CHANNEL_KIND_SPI_STRIP = 8,
    PM_CHANNEL_KIND_CANDLE = 9,
    PM_CHANNEL_KIND_BATTERY = 10,
} pm_channel_kind_t;

#pragma pack(push, 1)

typedef struct {
    uint32_t node_id;
    int8_t rssi;  // dBm, from esp-now rx_ctrl
} pm_neighbor_t;

typedef struct {
    uint16_t magic;
    uint8_t proto_version;
    uint16_t net_id;  // derived from network key
    uint32_t src_id;  // last 4 bytes of efuse MAC
    uint16_t seq;
    uint16_t boot_id;  // random per boot, never 0: a changed boot_id tells receivers the sender restarted and its seq began again (2026-10-05 — without it a rebooted bridge was ignored until its seq passed the old one)
    uint8_t ttl;
    uint8_t msg_type;  // MsgType
    uint8_t flags;
    uint32_t auth_tag;  // truncated CMAC; 0 in v0
} pm_frame_header_t;

typedef struct {
    uint32_t uptime_s;
    uint16_t battery_mv;  // 0 = mains powered
    uint8_t board;  // BoardType
    uint8_t role;  // NodeRole flags
    uint16_t fw_version;
    uint16_t free_heap_kb;
    uint8_t neighbor_count;
    pm_neighbor_t neighbors[8];  // first neighbor_count valid
    uint8_t channel;  // WiFi channel the sender is on; 0 = unknown (pre-2026-10-07 firmware). Nodes follow the bridge's.
    uint16_t listen_ms;  // a battery board in its show tier listens a window every listen_ms; senders repeat into it. 0 = always listening
} pm_heartbeat_t;

typedef struct {
    uint64_t mesh_time_us;  // conductor clock at send
    uint8_t hop;  // incremented per relay for latency comp
    uint32_t conductor_id;
    uint8_t priority;  // 1 = bridge. Election ranks (priority, conductor_id): a bridge beats any plain node, whatever its id (decided 2026-10-05)
    uint64_t wall_ms;  // UTC ms since 1970 at send (relays re-stamp); valid if wall_flags bit 0. Show schedule, software-plan §4.1 (2026-10-09). Beacons before this are 14 bytes and still read
    uint8_t wall_flags;  // bit 0 = wall_ms valid, bit 1 = the tz_* fields valid
    int16_t tz_offset_min;  // local − UTC now, minutes (−240 = EDT)
    uint32_t tz_next_change_s;  // UTC s of the next UTC-offset change (DST); 0 = none known
    int16_t tz_next_offset_min;  // the offset from then on
    uint8_t mode_manual;  // a mode set by hand (STOP ALL, Off/Ambient/Armed) the conductor is holding: PmMode, 0xFF = none. Followers apply the newest (mode_at), so STOP ALL reaches a board that missed it
    uint32_t mode_at;  // UTC s that mode was set (the console's clock); 0 = none ever
    uint32_t mode_until;  // UTC s the hold ends; 0 = not worked out yet
    uint32_t sched_at;  // UTC s the schedule was last edited; a follower with an older one pulls it (pull_schedule)
    uint32_t show_at;  // UTC s of the newest sequence/trigger edit the conductor holds for ANY board; a follower that hasn't synced since pulls its own part (pull_index / pull_seq / pull_rules)
    uint32_t floods_at;  // UTC s the floods key / light list last changed; a sending board (holds a key) with an older copy pulls it (pull_floods)
} pm_time_t;

typedef struct {
    uint16_t cue_id;
    uint16_t sequence_id;
    uint16_t target_group;  // PM_BROADCAST_GROUP = all
    uint64_t fire_at_us;  // mesh time; future T absorbs hop jitter
    uint32_t start_offset_ms;  // play the sequence from this far into itself — the console's play-from-cursor (decided 2026-09-05); 0 = from the top
    uint8_t flags;
} pm_cue_t;

typedef struct {
    uint8_t kind;  // StateKind
    uint8_t source_channel;  // logical channel index
    int32_t value;
    uint64_t at_us;  // mesh time of the event
} pm_state_t;

typedef struct {
    uint32_t image_size;
    uint32_t image_crc;
    uint16_t fw_version;
    uint8_t board;  // BoardType target
    uint16_t chunk_size;
} pm_ota_announce_t;

typedef struct {
    uint32_t dst;  // target node id
    uint16_t req_id;  // per requester; a retry reuses it
    uint8_t chunk;
    uint8_t chunks;
    uint8_t len;  // valid bytes in data
    uint8_t data[180];
} pm_api_request_t;

typedef struct {
    uint32_t dst;  // the requester
    uint16_t req_id;  // echoes the request
    uint8_t chunk;
    uint8_t chunks;
    uint8_t len;
    uint8_t data[180];
} pm_api_response_t;

typedef struct {
    uint16_t fw_version;
    uint16_t first_missing_chunk;
    uint16_t missing_count;
} pm_ota_nak_t;

#pragma pack(pop)
