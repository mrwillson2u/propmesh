#!/usr/bin/env python3
"""Generate protocol bindings from schema/messages.yaml.

Usage:
    python3 tools/genmsg.py           regenerate C header + TS module
    python3 tools/genmsg.py --check   exit 1 if generated files are stale (CI)

Emits packed little-endian structs for firmware and DataView codecs for
the console, so the two ends are mechanically unable to drift apart.
"""
import sys, pathlib, yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "schema" / "messages.yaml"
OUTPUTS = {
    "c":  ROOT / "firmware" / "common" / "propmesh" / "src" / "proto_gen.h",
    "ts": ROOT / "console" / "src" / "lib" / "proto_gen.ts",
}

#              c type      size  DataView accessor  ts type
PRIM = {"u8":  ("uint8_t",  1, "Uint8",     "number"),
        "u16": ("uint16_t", 2, "Uint16",    "number"),
        "u32": ("uint32_t", 4, "Uint32",    "number"),
        "u64": ("uint64_t", 8, "BigUint64", "bigint"),
        "i8":  ("int8_t",   1, "Int8",      "number"),
        "i16": ("int16_t",  2, "Int16",     "number"),
        "i32": ("int32_t",  4, "Int32",     "number"),
        "f32": ("float",    4, "Float32",   "number")}


def parse_type(t):
    """-> (base, count) where count is None for scalars."""
    if t.endswith("]"):
        base, n = t[:-1].split("[")
        return base, int(n)
    return t, None


def struct_size(fields, sizes):
    total = 0
    for f in fields:
        base, count = parse_type(f["type"])
        sz = PRIM[base][1] if base in PRIM else sizes[base]
        total += sz * (count or 1)
    return total


def validate(data):
    errs, sizes = [], {}
    for name, fields in data.get("structs", {}).items():
        for f in fields:
            base, _ = parse_type(f["type"])
            if base not in PRIM and base not in sizes:
                errs.append(f"struct {name}.{f['name']}: unknown type {base}")
        if not errs:
            sizes[name] = struct_size(fields, sizes)
    max_payload = data["constants"]["PM_MAX_PAYLOAD"]
    for name, msg in data.get("messages", {}).items():
        seen = set()
        for f in msg["fields"]:
            if f["name"] in seen:
                errs.append(f"message {name}: duplicate field {f['name']}")
            seen.add(f["name"])
            base, _ = parse_type(f["type"])
            if base not in PRIM and base not in sizes:
                errs.append(f"message {name}.{f['name']}: unknown type {base}")
        if not errs:
            sizes[name] = sz = struct_size(msg["fields"], sizes)
            if sz > max_payload:
                errs.append(f"message {name}: {sz} bytes exceeds "
                            f"PM_MAX_PAYLOAD ({max_payload})")
        if msg["type"] not in data["enums"]["MsgType"]:
            errs.append(f"message {name}: type {msg['type']} not in MsgType")
    for ename, vals in data.get("enums", {}).items():
        if len(set(vals.values())) != len(vals) and ename != "NodeRole":
            errs.append(f"enum {ename}: duplicate values")
    return errs, sizes


def snake(name):
    out = []
    for i, ch in enumerate(name):
        if ch.isupper() and i and (not name[i - 1].isupper()):
            out.append("_")
        out.append(ch.lower())
    return "".join(out)


def render_c(data, sizes):
    L = ["// GENERATED FILE — DO NOT EDIT",
         "// Source: schema/messages.yaml   Regenerate: python3 tools/genmsg.py",
         "", "#pragma once", "#include <stdint.h>", ""]
    for k, v in data["constants"].items():
        hint = f"  // {hex(v)}" if v > 255 else ""
        L.append(f"#define {k} {v}{hint}")
    for ename, vals in data["enums"].items():
        L += ["", f"typedef enum {{"]
        for k, v in vals.items():
            L.append(f"    PM_{snake(ename).upper()}_{k} = {v},")
        L.append(f"}} pm_{snake(ename)}_t;")
    L += ["", "#pragma pack(push, 1)"]

    def emit_struct(cname, fields):
        L.append("")
        L.append(f"typedef struct {{")
        for f in fields:
            base, count = parse_type(f["type"])
            ctype = PRIM[base][0] if base in PRIM else f"pm_{snake(base)}_t"
            arr = f"[{count}]" if count else ""
            note = f"  // {f['note']}" if f.get("note") else ""
            L.append(f"    {ctype} {f['name']}{arr};{note}")
        L.append(f"}} pm_{snake(cname)}_t;")

    for name, fields in data["structs"].items():
        emit_struct(name, fields)
    for name, msg in data["messages"].items():
        emit_struct(name, msg["fields"])
    L += ["", "#pragma pack(pop)", ""]
    return "\n".join(L)


def render_ts(data, sizes):
    L = ["// GENERATED FILE — DO NOT EDIT",
         "// Source: schema/messages.yaml   Regenerate: python3 tools/genmsg.py",
         "// All values little-endian, matching the packed C structs.", ""]
    for k, v in data["constants"].items():
        hint = f" // {hex(v)}" if v > 255 else ""
        L.append(f"export const {k} = {v};{hint}")
    for ename, vals in data["enums"].items():
        L += ["", f"export const {ename} = {{"]
        for k, v in vals.items():
            L.append(f"  {k}: {v},")
        L += ["} as const;",
              f"export type {ename} = (typeof {ename})[keyof typeof {ename}];"]

    def emit_iface(name, fields):
        L.append("")
        L.append(f"export interface {name} {{")
        for f in fields:
            base, count = parse_type(f["type"])
            tstype = PRIM[base][3] if base in PRIM else base
            if count:
                tstype += "[]"
            note = f"  // {f['note']}" if f.get("note") else ""
            L.append(f"  {f['name']}: {tstype};{note}")
        L.append("}")
        L.append(f"export const {name}_SIZE = {sizes[name]};")

    def codec_lines(fields, mode):
        # mode: "decode" builds an object literal; "encode" writes fields
        out = []
        for f in fields:
            base, count = parse_type(f["type"])
            if base in PRIM:
                _, sz, acc, _ = PRIM[base]
                le = ", true" if sz > 1 else ""  # getUint8 takes no endian arg
                if count:
                    if mode == "decode":
                        out.append(f"  const {f['name']} = [];")
                        out.append(f"  for (let i = 0; i < {count}; i++) "
                                   f"{{ {f['name']}.push(dv.get{acc}(o{le})); o += {sz}; }}")
                    else:
                        out.append(f"  for (let i = 0; i < {count}; i++) "
                                   f"{{ dv.set{acc}(o, v.{f['name']}[i] ?? {'0n' if acc == 'BigUint64' else '0'}{le}); o += {sz}; }}")
                else:
                    if mode == "decode":
                        out.append(f"  const {f['name']} = dv.get{acc}(o{le}); o += {sz};")
                    else:
                        out.append(f"  dv.set{acc}(o, v.{f['name']}{le}); o += {sz};")
            else:  # nested struct
                if count:
                    if mode == "decode":
                        out.append(f"  const {f['name']} = [];")
                        out.append(f"  for (let i = 0; i < {count}; i++) "
                                   f"{{ {f['name']}.push(decode{base}(dv, o)); o += {base}_SIZE; }}")
                    else:
                        out.append(f"  for (let i = 0; i < {count}; i++) "
                                   f"{{ encode{base}(v.{f['name']}[i], dv, o); o += {base}_SIZE; }}")
                else:
                    if mode == "decode":
                        out.append(f"  const {f['name']} = decode{base}(dv, o); o += {base}_SIZE;")
                    else:
                        out.append(f"  encode{base}(v.{f['name']}, dv, o); o += {base}_SIZE;")
        return out

    def emit_codecs(name, fields):
        L.append(f"export function decode{name}(dv: DataView, off = 0): {name} {{")
        L.append("  let o = off;")
        L.extend(codec_lines(fields, "decode"))
        L.append("  return { " + ", ".join(f["name"] for f in fields) + " };")
        L.append("}")
        L.append(f"export function encode{name}(v: {name}, dv: DataView, off = 0): number {{")
        L.append("  let o = off;")
        L.extend(codec_lines(fields, "encode"))
        L.append("  return o - off;")
        L.append("}")

    for name, fields in data["structs"].items():
        emit_iface(name, fields)
        emit_codecs(name, fields)
    for name, msg in data["messages"].items():
        emit_iface(name, msg["fields"])
        emit_codecs(name, msg["fields"])
    L.append("")
    return "\n".join(L)


def main():
    check = "--check" in sys.argv
    data = yaml.safe_load(SCHEMA.read_text())
    errs, sizes = validate(data)
    if errs:
        print("schema validation FAILED:", file=sys.stderr)
        for e in errs:
            print("  -", e, file=sys.stderr)
        return 1

    rendered = {"c": render_c(data, sizes), "ts": render_ts(data, sizes)}
    stale = []
    for kind, path in OUTPUTS.items():
        if check:
            if not path.exists() or path.read_text() != rendered[kind]:
                stale.append(path.relative_to(ROOT))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(rendered[kind])
            print(f"wrote {path.relative_to(ROOT)}")

    if check:
        if stale:
            print("stale bindings — run tools/genmsg.py:", file=sys.stderr)
            for p in stale:
                print("  -", p, file=sys.stderr)
            return 1
        print("bindings match schema/messages.yaml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
