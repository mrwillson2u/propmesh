#!/usr/bin/env python3
"""Serve the node firmware for over-the-air updates.

    python3 tools/ota_serve.py            # serve the last build
    python3 tools/ota_serve.py --build    # pio run first

Prints the URL to paste into the console's Update firmware panel. The
boards fetch firmware.bin over your WiFi; the console fetches
version.json (CORS open) to show which build is on offer.
docs/generic-boards.md §6c.
"""
import argparse, http.server, json, os, socket, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Every board's image: <build root>/<env>/firmware.bin — the console picks
# the env from each board's profile (boards/<id>.yaml ↔ [env:<id>]).
BUILD_ROOT = os.path.join(ROOT, "firmware", "node", ".pio", "build")
ENVS = ["esp32-devkit-v1", "esp32-huzzah32", "esp32-c6-supermini", "esp32-c3-supermini"]
BUILD_DIR = os.path.join(BUILD_ROOT, ENVS[0])

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=BUILD_ROOT, **kw)
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, fmt, *args):
        if "firmware.bin" in (args[0] if args else ""):
            print(f"{self.client_address[0]} fetched firmware.bin", flush=True)

def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--build", action="store_true", help="run pio run before serving")
    ap.add_argument("--port", type=int, default=8266)
    a = ap.parse_args()
    if a.build:
        for env in ENVS:
            subprocess.check_call([os.path.expanduser("~/.platformio/penv/bin/pio"), "run", "-e", env], cwd=os.path.join(ROOT, "firmware", "node"))
    found = []
    for env in ENVS:
        ver = os.path.join(BUILD_ROOT, env, "version.json")
        if os.path.exists(os.path.join(BUILD_ROOT, env, "firmware.bin")) and os.path.exists(ver):
            info = json.load(open(ver)); found.append(f"  {env}: build {info['build']} ({info['size']} bytes)")
    if not found:
        sys.exit("no build found — run with --build (or pio run -d firmware/node)")
    url = f"http://{lan_ip()}:{a.port}/{ENVS[0]}/firmware.bin"
    print("serving:\n" + "\n".join(found) + f"\n  {url}\npaste that URL into the console's Update firmware panel — it picks each board's own image from the same place; Ctrl-C to stop", flush=True)
    http.server.ThreadingHTTPServer(("", a.port), Handler).serve_forever()

if __name__ == "__main__":
    main()
