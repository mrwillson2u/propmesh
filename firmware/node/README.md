# Node firmware for generic ESP32 boards

Pins are assigned from the console, not compiled in. Everything —
functions, pin rules, the serial protocol, the bench test — is in
[`docs/generic-boards.md`](../../docs/generic-boards.md).

```
pio run -e esp32-devkit-v1 -t upload      # flash (close any serial monitor first)
pio run -e esp32-devkit-v1 -t uploadfs    # optional: push data/config.json
```
