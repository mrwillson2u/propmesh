// GENERATED FILE — DO NOT EDIT
// Source: schema/messages.yaml   Regenerate: python3 tools/genmsg.py
// All values little-endian, matching the packed C structs.

export const PM_MAGIC = 20557; // 0x504d
export const PM_PROTO_VERSION = 0;
export const PM_MAX_PAYLOAD = 200;
export const PM_DEFAULT_TTL = 4;
export const PM_HEARTBEAT_PERIOD_MS = 5000; // 0x1388
export const PM_DEDUP_WINDOW = 32;
export const PM_MAX_NEIGHBORS = 8;
export const PM_BROADCAST_GROUP = 65535; // 0xffff

export const MsgType = {
  HEARTBEAT: 1,
  TIME: 2,
  CUE: 3,
  STATE: 4,
  CONFIG: 5,
  OTA_ANNOUNCE: 6,
  OTA_CHUNK: 7,
  OTA_NAK: 8,
} as const;
export type MsgType = (typeof MsgType)[keyof typeof MsgType];

export const BoardType = {
  DEVKIT: 0,
  PRO: 1,
  MINI: 2,
} as const;
export type BoardType = (typeof BoardType)[keyof typeof BoardType];

export const NodeRole = {
  LEAF: 0,
  RELAY: 1,
  CONDUCTOR: 2,
  BRIDGE: 4,
} as const;
export type NodeRole = (typeof NodeRole)[keyof typeof NodeRole];

export const StateKind = {
  SENSOR_TRIGGER: 1,
  SENSOR_CLEAR: 2,
  SEQUENCE_STARTED: 3,
  SEQUENCE_ENDED: 4,
  FAULT: 5,
} as const;
export type StateKind = (typeof StateKind)[keyof typeof StateKind];

export interface Neighbor {
  node_id: number;
  rssi: number;  // dBm, from esp-now rx_ctrl
}
export const Neighbor_SIZE = 5;
export function decodeNeighbor(dv: DataView, off = 0): Neighbor {
  let o = off;
  const node_id = dv.getUint32(o, true); o += 4;
  const rssi = dv.getInt8(o); o += 1;
  return { node_id, rssi };
}
export function encodeNeighbor(v: Neighbor, dv: DataView, off = 0): number {
  let o = off;
  dv.setUint32(o, v.node_id, true); o += 4;
  dv.setInt8(o, v.rssi); o += 1;
  return o - off;
}

export interface FrameHeader {
  magic: number;
  proto_version: number;
  net_id: number;  // derived from network key
  src_id: number;  // last 4 bytes of efuse MAC
  seq: number;
  ttl: number;
  msg_type: number;  // MsgType
  flags: number;
  auth_tag: number;  // truncated CMAC; 0 in v0
}
export const FrameHeader_SIZE = 18;
export function decodeFrameHeader(dv: DataView, off = 0): FrameHeader {
  let o = off;
  const magic = dv.getUint16(o, true); o += 2;
  const proto_version = dv.getUint8(o); o += 1;
  const net_id = dv.getUint16(o, true); o += 2;
  const src_id = dv.getUint32(o, true); o += 4;
  const seq = dv.getUint16(o, true); o += 2;
  const ttl = dv.getUint8(o); o += 1;
  const msg_type = dv.getUint8(o); o += 1;
  const flags = dv.getUint8(o); o += 1;
  const auth_tag = dv.getUint32(o, true); o += 4;
  return { magic, proto_version, net_id, src_id, seq, ttl, msg_type, flags, auth_tag };
}
export function encodeFrameHeader(v: FrameHeader, dv: DataView, off = 0): number {
  let o = off;
  dv.setUint16(o, v.magic, true); o += 2;
  dv.setUint8(o, v.proto_version); o += 1;
  dv.setUint16(o, v.net_id, true); o += 2;
  dv.setUint32(o, v.src_id, true); o += 4;
  dv.setUint16(o, v.seq, true); o += 2;
  dv.setUint8(o, v.ttl); o += 1;
  dv.setUint8(o, v.msg_type); o += 1;
  dv.setUint8(o, v.flags); o += 1;
  dv.setUint32(o, v.auth_tag, true); o += 4;
  return o - off;
}

export interface Heartbeat {
  uptime_s: number;
  battery_mv: number;  // 0 = mains powered
  board: number;  // BoardType
  role: number;  // NodeRole flags
  fw_version: number;
  free_heap_kb: number;
  neighbor_count: number;
  neighbors: Neighbor[];  // first neighbor_count valid
}
export const Heartbeat_SIZE = 53;
export function decodeHeartbeat(dv: DataView, off = 0): Heartbeat {
  let o = off;
  const uptime_s = dv.getUint32(o, true); o += 4;
  const battery_mv = dv.getUint16(o, true); o += 2;
  const board = dv.getUint8(o); o += 1;
  const role = dv.getUint8(o); o += 1;
  const fw_version = dv.getUint16(o, true); o += 2;
  const free_heap_kb = dv.getUint16(o, true); o += 2;
  const neighbor_count = dv.getUint8(o); o += 1;
  const neighbors = [];
  for (let i = 0; i < 8; i++) { neighbors.push(decodeNeighbor(dv, o)); o += Neighbor_SIZE; }
  return { uptime_s, battery_mv, board, role, fw_version, free_heap_kb, neighbor_count, neighbors };
}
export function encodeHeartbeat(v: Heartbeat, dv: DataView, off = 0): number {
  let o = off;
  dv.setUint32(o, v.uptime_s, true); o += 4;
  dv.setUint16(o, v.battery_mv, true); o += 2;
  dv.setUint8(o, v.board); o += 1;
  dv.setUint8(o, v.role); o += 1;
  dv.setUint16(o, v.fw_version, true); o += 2;
  dv.setUint16(o, v.free_heap_kb, true); o += 2;
  dv.setUint8(o, v.neighbor_count); o += 1;
  for (let i = 0; i < 8; i++) { encodeNeighbor(v.neighbors[i], dv, o); o += Neighbor_SIZE; }
  return o - off;
}

export interface Time {
  mesh_time_us: bigint;  // conductor clock at send
  hop: number;  // incremented per relay for latency comp
  conductor_id: number;
}
export const Time_SIZE = 13;
export function decodeTime(dv: DataView, off = 0): Time {
  let o = off;
  const mesh_time_us = dv.getBigUint64(o, true); o += 8;
  const hop = dv.getUint8(o); o += 1;
  const conductor_id = dv.getUint32(o, true); o += 4;
  return { mesh_time_us, hop, conductor_id };
}
export function encodeTime(v: Time, dv: DataView, off = 0): number {
  let o = off;
  dv.setBigUint64(o, v.mesh_time_us, true); o += 8;
  dv.setUint8(o, v.hop); o += 1;
  dv.setUint32(o, v.conductor_id, true); o += 4;
  return o - off;
}

export interface Cue {
  cue_id: number;
  sequence_id: number;
  target_group: number;  // PM_BROADCAST_GROUP = all
  fire_at_us: bigint;  // mesh time; future T absorbs hop jitter
  flags: number;
}
export const Cue_SIZE = 15;
export function decodeCue(dv: DataView, off = 0): Cue {
  let o = off;
  const cue_id = dv.getUint16(o, true); o += 2;
  const sequence_id = dv.getUint16(o, true); o += 2;
  const target_group = dv.getUint16(o, true); o += 2;
  const fire_at_us = dv.getBigUint64(o, true); o += 8;
  const flags = dv.getUint8(o); o += 1;
  return { cue_id, sequence_id, target_group, fire_at_us, flags };
}
export function encodeCue(v: Cue, dv: DataView, off = 0): number {
  let o = off;
  dv.setUint16(o, v.cue_id, true); o += 2;
  dv.setUint16(o, v.sequence_id, true); o += 2;
  dv.setUint16(o, v.target_group, true); o += 2;
  dv.setBigUint64(o, v.fire_at_us, true); o += 8;
  dv.setUint8(o, v.flags); o += 1;
  return o - off;
}

export interface State {
  kind: number;  // StateKind
  source_channel: number;  // logical channel index
  value: number;
  at_us: bigint;  // mesh time of the event
}
export const State_SIZE = 14;
export function decodeState(dv: DataView, off = 0): State {
  let o = off;
  const kind = dv.getUint8(o); o += 1;
  const source_channel = dv.getUint8(o); o += 1;
  const value = dv.getInt32(o, true); o += 4;
  const at_us = dv.getBigUint64(o, true); o += 8;
  return { kind, source_channel, value, at_us };
}
export function encodeState(v: State, dv: DataView, off = 0): number {
  let o = off;
  dv.setUint8(o, v.kind); o += 1;
  dv.setUint8(o, v.source_channel); o += 1;
  dv.setInt32(o, v.value, true); o += 4;
  dv.setBigUint64(o, v.at_us, true); o += 8;
  return o - off;
}

export interface OtaAnnounce {
  image_size: number;
  image_crc: number;
  fw_version: number;
  board: number;  // BoardType target
  chunk_size: number;
}
export const OtaAnnounce_SIZE = 13;
export function decodeOtaAnnounce(dv: DataView, off = 0): OtaAnnounce {
  let o = off;
  const image_size = dv.getUint32(o, true); o += 4;
  const image_crc = dv.getUint32(o, true); o += 4;
  const fw_version = dv.getUint16(o, true); o += 2;
  const board = dv.getUint8(o); o += 1;
  const chunk_size = dv.getUint16(o, true); o += 2;
  return { image_size, image_crc, fw_version, board, chunk_size };
}
export function encodeOtaAnnounce(v: OtaAnnounce, dv: DataView, off = 0): number {
  let o = off;
  dv.setUint32(o, v.image_size, true); o += 4;
  dv.setUint32(o, v.image_crc, true); o += 4;
  dv.setUint16(o, v.fw_version, true); o += 2;
  dv.setUint8(o, v.board); o += 1;
  dv.setUint16(o, v.chunk_size, true); o += 2;
  return o - off;
}

export interface OtaNak {
  fw_version: number;
  first_missing_chunk: number;
  missing_count: number;
}
export const OtaNak_SIZE = 6;
export function decodeOtaNak(dv: DataView, off = 0): OtaNak {
  let o = off;
  const fw_version = dv.getUint16(o, true); o += 2;
  const first_missing_chunk = dv.getUint16(o, true); o += 2;
  const missing_count = dv.getUint16(o, true); o += 2;
  return { fw_version, first_missing_chunk, missing_count };
}
export function encodeOtaNak(v: OtaNak, dv: DataView, off = 0): number {
  let o = off;
  dv.setUint16(o, v.fw_version, true); o += 2;
  dv.setUint16(o, v.first_missing_chunk, true); o += 2;
  dv.setUint16(o, v.missing_count, true); o += 2;
  return o - off;
}
