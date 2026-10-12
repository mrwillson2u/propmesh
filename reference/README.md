# Reference — pre-PropMesh prototypes (2024–2025)

Imported 2026-09-01 from local files (never on GitHub). These are the
experiments PropMesh's mesh scheme grows out of. **Read-only history** —
port ideas out of here into `firmware/`; don't develop in here.

**Credentials were scrubbed before tracking** (WiFi, MQTT, mesh passwords,
BLE keys → placeholders). The raw unscrubbed dump lives in
`reference/old_files/`, which is gitignored — never commit it.

## Inventory

| Project | What it is | Status | Worth porting |
|---|---|---|---|
| `prop-mesh` | **Node firmware.** painlessMesh on ESP32-C3 Super Mini. JSON messages: `action` (set pins) and `config` (pin modes, persisted to NVS). Role-based mesh OTA. | Worked | Message-type pattern, NVS config persistence, OTA-by-role concept |
| `prop-mesh-bridge` | **Bridge/root node.** painlessMesh root + home-WiFi station, MQTT gateway: `painlessMesh/to/<id|broadcast|gateway>`, `from/<id>`, `getNodes` topology query, node list published on every topology change. | Worked | The addressing scheme, topology-on-change reporting (seed of the survey view) |
| `light-mesh-bridge-node` | Earlier experiment: OSC-over-serial → mesh broadcast. | Doesn't compile (half-finished refactor) | Nothing — historical |
| ~~`brmesh-to-mqtt`~~ | BLE bridge for BRMesh floodlights → Home Assistant, built on dsclee1/BRmesh-esp32-mqtt. **Not published**: that project has no license, so it can't be redistributed. Kept locally in `reference/old_files/brmesh-to-mqtt/` (2026-10-12). | Worked | The protocol only — `pm_brmesh.h` reimplements it (THIRD_PARTY.md) |
| `halloween-stepper` | TMC2209 UART + AccelStepper animation state machine. Prop lid choreography test. | Worked | Library choice (TMCStepper + AccelStepper), UART config sequence, animation state-machine pattern → Pro stepper driver |
| `lantern-fire-test` | FastLED fire effect on SK9822 (APA102-class, 4-wire) with reusable `Fire2023Lib`. | Worked | The fire effect → stock effect library; proves the Pro's APA102 path |

## Key lessons encoded in this code

- **The mesh channel is hardcoded** (`mesh.init(..., 11)`) and the bridge
  joins home WiFi on the same radio — the channel-coupling constraint was
  real and handled by matching the router manually. (A stale comment says
  channel 6; the code says 11.)
- **`prop-mesh` commands address raw GPIO numbers** over the mesh. Fine
  for tests; the product must address logical channels (`RELAY_1`,
  `SERVO_2` — from `pinmap.yaml`) so messages are board-portable and
  can't touch strapping pins.
- **`halloween-stepper` drives EN low at boot** — the exact
  drivers-enabled-at-power-on failure the Pro now fixes in hardware with
  the EN inverter (hardware-spec §2.5).
- The painlessMesh stack (AP+STA WiFi, TCP, JSON) ran fine on a C3 for
  **powered, always-on** test nodes. It was never run with sleeping
  nodes or >4 nodes — see the transport decision in the main spec.
