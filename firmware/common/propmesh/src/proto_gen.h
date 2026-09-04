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

typedef enum {
    PM_MSG_TYPE_HEARTBEAT = 1,
    PM_MSG_TYPE_TIME = 2,
    PM_MSG_TYPE_CUE = 3,
    PM_MSG_TYPE_STATE = 4,
    PM_MSG_TYPE_CONFIG = 5,
    PM_MSG_TYPE_OTA_ANNOUNCE = 6,
    PM_MSG_TYPE_OTA_CHUNK = 7,
    PM_MSG_TYPE_OTA_NAK = 8,
} pm_msg_type_t;

typedef enum {
    PM_BOARD_TYPE_DEVKIT = 0,
    PM_BOARD_TYPE_PRO = 1,
    PM_BOARD_TYPE_MINI = 2,
} pm_board_type_t;

typedef enum {
    PM_NODE_ROLE_LEAF = 0,
    PM_NODE_ROLE_RELAY = 1,
    PM_NODE_ROLE_CONDUCTOR = 2,
    PM_NODE_ROLE_BRIDGE = 4,
} pm_node_role_t;

typedef enum {
    PM_STATE_KIND_SENSOR_TRIGGER = 1,
    PM_STATE_KIND_SENSOR_CLEAR = 2,
    PM_STATE_KIND_SEQUENCE_STARTED = 3,
    PM_STATE_KIND_SEQUENCE_ENDED = 4,
    PM_STATE_KIND_FAULT = 5,
} pm_state_kind_t;

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
} pm_heartbeat_t;

typedef struct {
    uint64_t mesh_time_us;  // conductor clock at send
    uint8_t hop;  // incremented per relay for latency comp
    uint32_t conductor_id;
} pm_time_t;

typedef struct {
    uint16_t cue_id;
    uint16_t sequence_id;
    uint16_t target_group;  // PM_BROADCAST_GROUP = all
    uint64_t fire_at_us;  // mesh time; future T absorbs hop jitter
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
    uint16_t fw_version;
    uint16_t first_missing_chunk;
    uint16_t missing_count;
} pm_ota_nak_t;

#pragma pack(pop)
