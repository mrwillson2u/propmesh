# PropMesh Mini

The Mini is currently a plan in [hardware-spec §3](../../docs/hardware-spec.md#3-mini-board--propmesh-mini),
with GPIO assignments in [pinmap.yaml](../../pinmap.yaml). No KiCad schematic
or PCB has been created yet.

Read the [2026-09-16 plan audit](review-2026-09-16.md) before schematic capture.
Open items include power domains and sleep current, rail switching and charging,
flash/OTA capacity, shared PWM frequency, module revision, and the complete
driver/connector BOM. The audit records recommendations; it does not implement
those hardware or pinmap changes.

The [recommended revision](recommendations-2026-09-16.md) turns those findings
into a proposed power tree, GPIO/PWM changes, storage budget and sleep modes.
It is a proposal for review, not an implemented design.
