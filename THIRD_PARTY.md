# Third-party code and credits

## Code included in this repository

### FastLED — MIT

`firmware/common/propmesh-node/src/pm_fire.cpp` ports the **Fire2023**
effect by [@Anderas2](https://github.com/Anderas2) as it
ships in FastLED's examples (`examples/Fire2023`), and
`reference/lantern-fire-test/` contains that example as used in the
lantern prop. FastLED is also a build dependency (its noise and palette
math). FastLED's license:

```
The MIT License (MIT)

Copyright (c) 2013 FastLED

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Build dependencies (fetched by PlatformIO / npm, not in this repository)

Firmware images built from this repository include them; their licenses
travel with those binaries.

| Dependency | License |
|---|---|
| ESP-IDF (Espressif) | Apache-2.0 |
| Arduino core for the ESP32 (Espressif, via pioarduino) | LGPL-2.1 |
| ArduinoJson (Benoît Blanchon) | MIT |
| FastLED | MIT |
| NimBLE (Apache Mynewt, in ESP-IDF) | Apache-2.0 |
| Console: React, Vite and the packages in `console/package.json` | MIT / ISC / BSD (see `console/node_modules/*/LICENSE`) |

## Work this builds on (credit, no code)

- **BRMesh / "fastcon" flood-light protocol** — reverse-engineered by
  [millskyle/BRMesh_homeassistant](https://github.com/millskyle/BRMesh_homeassistant),
  [ArcadeMachinist/brMeshMQTT](https://github.com/ArcadeMachinist/brMeshMQTT) and
  [dsclee1/BRmesh-esp32-mqtt](https://github.com/dsclee1/BRmesh-esp32-mqtt)
  (pairing). Those projects publish no license, so PropMesh contains none
  of their code: `pm_brmesh.h` implements the protocol from its documented
  structure (a textbook CRC-16/CCITT and the Bluetooth spec's whitening
  LFSR), and its tests compare against advert bytes recorded from
  dsclee1's implementation. Thank you to all three.
- **ESPNowMeshClock** (Hemisphere-Project) — the mesh-time approach was
  compared against it; no code taken.
