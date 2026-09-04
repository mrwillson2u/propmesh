# Mesh testbed node

The ESP-NOW flood mesh running on devkits, months before the real
boards exist. Flash three or more, leave them on a shelf, and this is
the soak test; carry one around the yard and it is the range test.

```
pio run -e supermini-c3 -t upload -t monitor   # ESP32-C3 Super Mini
pio run -e esp32-devkit -t upload -t monitor   # classic ESP32 devkit
pio run -e c6-devkit    -t upload -t monitor   # ESP32-C6 devkit
```

**Every node runs the same image** — no per-board configuration. All
nodes must share `PM_CHANNEL` (default 1) and `PM_NET_ID`.

## What you should see

Each node prints the heartbeats it hears, then a status line every 30 s:

```
propmesh testbed node a1b2c3d4 up, channel 1
elected self conductor (a1b2c3d4)
[9f8e7d6c] heartbeat  up=35s heap=214KB nbrs=2 ttl=4 rssi=-46
stats: rx=142 tx=71 relayed=68 dupes=203 bad=0 over=0
sync:  conductor=a1b2c3d4 hop=0 mesh_time=312s
```

- **`ttl=4`** means the frame arrived directly; a lower TTL means it was
  relayed, and the difference is the hop count.
- **`dupes`** climbing fast is normal and healthy — it is the flood
  working. Every node hears each frame once per relay path and discards
  all but the first.
- **`over`** (relay queue overrun) should stay at 0. If it climbs, the
  mesh is busier than the 8-slot relay queue can absorb.
- **`sync:`** should show the same conductor id on every node within a
  few seconds of boot, with `hop` growing with distance from it.

## Things worth trying

- **Kill the conductor.** Unplug it; within ~20 s the surviving node
  with the highest id elects itself and everyone re-syncs to it.
- **Force a multi-hop path.** Separate two nodes until they can only
  reach each other through a third; watch `ttl` drop and `hop` rise.
- **Range test.** Walk one node away from the others and watch its
  neighbors' RSSI fall. Below about −85 dBm links get unreliable — that
  is the spacing limit for a real yard layout.

## What is implemented

Flood transport with per-source dedup, TTL, jittered relay, neighbor
tracking with RSSI, and mesh time sync with conductor election. Not yet:
cues, the config store, OTA, and frame authentication (`auth_tag` is
present in the header but zero — see `docs/software-plan.md` §3).

The pure logic (`pm_dedup.h`, `pm_neighbors.h`, `pm_time.h`) is
header-only and has host-native unit tests in `firmware/test`:

```
pio test -d ../test -e native
```
