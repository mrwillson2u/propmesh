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
dirty = subprocess.call(["git", "diff", "--quiet"], stderr=subprocess.DEVNULL) != 0 if commit != "nogit" else False
build = commit + ("+" if dirty else "")
env.Append(CPPDEFINES=[("PM_BUILD", env.StringifyMacro(build))])

def write_version(source, target, env):
    bin_path = str(target[0])
    data = open(bin_path, "rb").read()
    info = {"build": build, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "env": env["PIOENV"]}
    with open(os.path.join(os.path.dirname(bin_path), "version.json"), "w") as f:
        json.dump(info, f)
    print(f"build {build}: firmware.bin {len(data)} bytes")

env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", write_version)
