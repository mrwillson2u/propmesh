# PlatformIO extra script: stamp the build with the git commit (plus "+"
# if the tree was dirty) as PM_BUILD, and write version.json next to
# firmware.bin for tools/ota_serve.py and the console's update panel.
import hashlib, json, os, subprocess
Import("env")

def git(*args):
    try:
        return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        return ""

commit = git("rev-parse", "--short", "HEAD") or "nogit"

# Uncommitted work gets "+" and a hash of exactly what differs from the
# commit (changed AND new files under the source the image is built
# from). Until 2026-10-09 it was just "+", so two different uncommitted
# builds both read "b99d9a4+" and the console's update panel called a
# board running old code "up to date".
SOURCES = ["firmware", "schema", "boards"]
def dirty_hash():
    h = hashlib.sha1()
    root = git("rev-parse", "--show-toplevel")
    diff = subprocess.run(["git", "diff", "HEAD", "--", *SOURCES], cwd=root, capture_output=True).stdout
    h.update(diff)
    new = git("-C", root, "ls-files", "--others", "--exclude-standard", "--", *SOURCES).splitlines()
    for f in sorted(new):
        h.update(f.encode())
        try:
            h.update(open(os.path.join(root, f), "rb").read())
        except OSError:
            pass
    return h.hexdigest()[:6] if (diff or new) else ""

d = dirty_hash() if commit != "nogit" else ""
build = commit + ("+" + d if d else "")
env.Append(CPPDEFINES=[("PM_BUILD", env.StringifyMacro(build))])

def write_version(source, target, env):
    bin_path = str(target[0])
    data = open(bin_path, "rb").read()
    info = {"build": build, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "env": env["PIOENV"]}
    with open(os.path.join(os.path.dirname(bin_path), "version.json"), "w") as f:
        json.dump(info, f)
    print(f"build {build}: firmware.bin {len(data)} bytes")

env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", write_version)
