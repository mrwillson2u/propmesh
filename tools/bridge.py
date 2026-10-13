#!/usr/bin/env python3
"""Talk to a PropMesh bridge over its WebSocket (port 81) from a terminal.

The same JSON requests the console sends (docs/generic-boards.md §6 and
after). Standard library only. The bridge takes two consoles at once, so
this works alongside an open console tab.

    python3 tools/bridge.py ask hello
    python3 tools/bridge.py ask get_schedule --node 3214b4a8
    python3 tools/bridge.py ask mesh                      # the boards the bridge hears
    python3 tools/bridge.py status 3214b4a8 cef07a18     # hello + schedule sync per board
    python3 tools/bridge.py ota 3214b4a8 firmware/node/.pio/build/esp32-devkit-v1/firmware.bin

Bridge address: --host, else $PROPMESH_BRIDGE, else propmesh.local.
Never touches a serial port (opening a devkit's USB port resets it).
"""
import argparse, base64, hashlib, json, os, socket, struct, sys, time


class Bridge:
    """One WebSocket connection; replies matched to requests by id."""

    def __init__(self, host):
        self.s = socket.create_connection((host, 81), timeout=5)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(f"GET / HTTP/1.1\r\nHost: {host}:81\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                       f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.s.recv(1024)
            if not chunk:
                raise ConnectionError("bridge closed the connection during the handshake")
            head += chunk
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise ConnectionError(head.split(b"\r\n", 1)[0].decode(errors="replace"))
        self.buf = head.split(b"\r\n\r\n", 1)[1]
        self.n = 1000
        self.events = []  # unsolicited messages (heartbeats, sensor events) seen while waiting

    def send(self, obj):
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        n = len(data)
        hdr = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n))
        self.s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def frames(self, timeout):
        self.s.settimeout(0.2)
        end = time.time() + timeout
        while time.time() < end:
            try:
                self.buf += self.s.recv(8192)
            except socket.timeout:
                pass
            while len(self.buf) >= 2:
                n, pos = self.buf[1] & 0x7F, 2
                if n == 126:
                    if len(self.buf) < 4:
                        break
                    n, pos = struct.unpack(">H", self.buf[2:4])[0], 4
                if len(self.buf) < pos + n:
                    break
                payload, self.buf = self.buf[pos:pos + n], self.buf[pos + n:]
                try:
                    yield json.loads(payload)
                except ValueError:
                    pass

    def ask(self, cmd, timeout=8, **body):
        """Send one request; return its reply, or None on timeout."""
        self.n += 1
        i = self.n
        self.send({"cmd": cmd, "id": i, **body})
        for m in self.frames(timeout):
            if m.get("id") == i:
                return m
            if "evt" in m:
                self.events.append(m)
        return None


def connect(host, tries=6):
    for k in range(tries):
        try:
            return Bridge(host)
        except OSError as e:
            if k == tries - 1:
                sys.exit(f"can't reach the bridge at {host}:81 — {e}")
            time.sleep(5)


def cmd_ask(b, a):
    body = json.loads(a.body) if a.body else {}
    if a.node:
        body["node"] = a.node
    print(json.dumps(b.ask(a.cmd, timeout=a.timeout, **body), indent=2))


def cmd_status(b, a):
    for node in [None, *a.nodes]:
        kw = {"node": node} if node else {}
        h = b.ask("hello", timeout=12, **kw)
        s = b.ask("get_schedule", timeout=12, **kw)
        name = (h or {}).get("name") or node or "bridge"
        if not h or not s or not h.get("ok", True):
            print(f"{name:14} NO REPLY {h}")
            continue
        print(f"{name:14} build {h.get('build')} · sync {h.get('sync')} · "
              f"{len((s.get('schedule') or {}).get('windows', []))} schedule windows at {s.get('at')} · "
              f"mode {s.get('mode')} ({s.get('reason')})")


def cmd_ota(b, a):
    """Stream an app image (firmware.bin, not .factory.bin) to one board: WiFi → bridge → mesh."""
    img = open(a.image, "rb").read()
    sha = hashlib.sha256(img).hexdigest()
    r = b.ask("ota_begin", node=a.node, size=len(img), sha256=sha, timeout=12)
    print("begin:", r, flush=True)
    if not r or not r.get("ok"):
        sys.exit(1)
    chunk, off, misses, t0, last = r.get("chunk", 2700), 0, 0, time.time(), 0
    while off < len(img):
        r = b.ask("ota_data", node=a.node, off=off, data=base64.b64encode(img[off:off + chunk]).decode(), timeout=9)
        if r and r.get("ok"):
            off, misses = r["written"], 0
        elif r and "offset" in (r.get("error") or ""):
            off = r["written"]  # the board already has more than we thought: resume there
        else:
            misses += 1
            if misses > 20:
                sys.exit(f"gave up at {off}: {r}")
            time.sleep(0.5)
        if time.time() - last > 20:
            last = time.time()
            print(f"  {off * 100 // len(img)} %  {time.time() - t0:.0f} s", flush=True)
    print("end:", b.ask("ota_end", node=a.node, timeout=12), f"after {time.time() - t0:.0f} s", flush=True)
    time.sleep(15)
    for _ in range(8):
        h = b.ask("hello", node=a.node, timeout=12)
        if h and h.get("ok"):
            print("back:", h.get("build"), "reset:", h.get("reset"))
            return
        time.sleep(4)
    print("no hello from the board yet — check the console")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--host", default=os.environ.get("PROPMESH_BRIDGE", "propmesh.local"))
    sub = p.add_subparsers(dest="what", required=True)
    s = sub.add_parser("ask", help="send one request, print the reply")
    s.add_argument("cmd")
    s.add_argument("body", nargs="?", help="JSON object of extra fields")
    s.add_argument("--node", help="a remote board's id (default: the bridge itself)")
    s.add_argument("--timeout", type=float, default=12)
    s = sub.add_parser("status", help="build, sync and schedule for the bridge and the given boards")
    s.add_argument("nodes", nargs="*")
    s = sub.add_parser("ota", help="update one board's firmware over the mesh")
    s.add_argument("node")
    s.add_argument("image")
    a = p.parse_args()
    b = connect(a.host)
    {"ask": cmd_ask, "status": cmd_status, "ota": cmd_ota}[a.what](b, a)


if __name__ == "__main__":
    main()
