# PropMesh Mini

**Selected module: ESP32-S3-WROOM-1U-N16R2**, accepted 2026-09-19.
The [module decision](module-selection-2026-09-19.md) records the tradeoffs and
supersedes the earlier C3/C6 recommendations.

The Mini is currently a plan in [hardware-spec §3](../../docs/hardware-spec.md#3-mini-board--propmesh-mini).
[pinmap.yaml](../../pinmap.yaml) and the generated Mini header still describe
the legacy C3 baseline and require an S3 allocation before schematic capture.
No KiCad schematic or PCB has been created yet.

Current scope prioritizes power, audio, Wi-Fi/ESP-NOW and sensor/timer wake.
BLE standby and Thread/Zigbee work are deferred. Reserve S3 GPIO15/16 and
footprints for an optional **DNP 32.768 kHz crystal and supporting passives**
when creating the schematic/PCB; see the module decision for details.

Read the [2026-09-16 plan audit](review-2026-09-16.md) before schematic capture.
Open items include power domains and sleep current, rail switching and charging,
flash/OTA capacity, shared PWM frequency, module revision, and the complete
driver/connector BOM. The audit records recommendations; it does not implement
those hardware or pinmap changes.

The [recommended revision](recommendations-2026-09-16.md) turns those findings
into a proposed power tree, GPIO/PWM changes, storage budget and sleep modes.
It is a proposal for review, not an implemented design.

The [2026-09-19 GPIO and module comparison](gpio-module-options-2026-09-19.md)
records the current C3 allocation and evaluates compact module alternatives,
including the C6-MINI-1U with more GPIO in the same body dimensions.

The [2026-10-09 solar-charging options](solar-options-2026-10-09.md) size the
panel for October sun per node behavior and compare off-the-shelf charger
modules: the Mini's on-board TP4056 needs no module (a 6 V panel wires to its
solar terminal); devkit nodes take a DFRobot DFR0559; CN3791 adds MPPT.
