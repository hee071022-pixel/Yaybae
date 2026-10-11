#!/usr/bin/env python3
"""Validates the Haulers packs and packages them into dist/.

Usage: python3 Haulers/tools/build.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
BP = os.path.join(ROOT, "Haulers_BP")
RP = os.path.join(ROOT, "Haulers_RP")
DIST = os.path.normpath(os.path.join(ROOT, "..", "dist"))

errors = []


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:  # noqa: BLE001
        errors.append(f"{os.path.relpath(path, ROOT)}: invalid JSON ({e})")
        return None


def walk_json(base):
    for d, _, files in os.walk(base):
        for f in files:
            if f.endswith(".json"):
                yield os.path.join(d, f)


def check():
    for base in (BP, RP):
        for p in walk_json(base):
            load(p)

    # texture atlas entries must point at real files
    atlases = {}
    for atlas in ("item_texture.json", "terrain_texture.json"):
        data = load(os.path.join(RP, "textures", atlas)) or {}
        for key, entry in data.get("texture_data", {}).items():
            atlases[key] = atlas
            tex = entry["textures"]
            if not os.path.exists(os.path.join(RP, tex + ".png")):
                errors.append(f"{atlas}: '{key}' -> missing {tex}.png")

    # items / blocks must reference atlas keys that exist
    for p in walk_json(os.path.join(BP, "items")):
        icon = (load(p) or {}).get("minecraft:item", {}).get("components", {}).get("minecraft:icon")
        if icon and atlases.get(icon) != "item_texture.json":
            errors.append(f"{os.path.basename(p)}: icon '{icon}' not in item_texture.json")
    for p in walk_json(os.path.join(BP, "blocks")):
        comps = (load(p) or {}).get("minecraft:block", {}).get("components", {})
        for face, inst in comps.get("minecraft:material_instances", {}).items():
            if atlases.get(inst["texture"]) != "terrain_texture.json":
                errors.append(f"{os.path.basename(p)}: {face} texture '{inst['texture']}' not in terrain_texture.json")

    # UI icons used by the script
    script = open(os.path.join(BP, "scripts", "main.js"), encoding="utf-8").read()
    for tex in set(re.findall(r'"(textures/ui/[a-z_]+)"', script)):
        if not os.path.exists(os.path.join(RP, tex + ".png")):
            errors.append(f"main.js: missing {tex}.png")

    # client entity animations must exist
    anims = set((load(os.path.join(RP, "animations", "haul.animation.json")) or {}).get("animations", {}))
    for p in walk_json(os.path.join(RP, "entity")):
        desc = (load(p) or {}).get("minecraft:client_entity", {}).get("description", {})
        for short, full in desc.get("animations", {}).items():
            if full not in anims:
                errors.append(f"{os.path.basename(p)}: unknown animation {full}")

    # manifests agree on versions / dependencies
    bpm, rpm = load(os.path.join(BP, "manifest.json")), load(os.path.join(RP, "manifest.json"))
    if bpm and rpm:
        if bpm["header"]["version"] != rpm["header"]["version"]:
            errors.append("BP/RP manifest versions differ")
        dep = [d for d in bpm["dependencies"] if d.get("uuid") == rpm["header"]["uuid"]]
        if not dep or dep[0]["version"] != rpm["header"]["version"]:
            errors.append("BP dependency on RP has wrong uuid/version")

    if shutil.which("node"):
        r = subprocess.run(["node", "--check", os.path.join(BP, "scripts", "main.js")], capture_output=True, text=True)
        if r.returncode:
            errors.append("main.js syntax error:\n" + r.stderr)


def zip_dir(src, zf, prefix):
    for d, _, files in os.walk(src):
        for f in sorted(files):
            full = os.path.join(d, f)
            zf.write(full, os.path.join(prefix, os.path.relpath(full, src)))


def package():
    os.makedirs(DIST, exist_ok=True)
    out = {}
    for name, src in (("Haulers_BP", BP), ("Haulers_RP", RP)):
        path = os.path.join(DIST, f"{name}.mcpack")
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
            zip_dir(src, zf, "")
        out[name] = path
    addon = os.path.join(DIST, "Haulers.mcaddon")
    with zipfile.ZipFile(addon, "w", zipfile.ZIP_DEFLATED) as zf:
        zip_dir(BP, zf, "behavior_pack")
        zip_dir(RP, zf, "resource_pack")
    for p in [*out.values(), addon]:
        print("wrote", os.path.relpath(p, os.path.join(ROOT, "..")), f"({os.path.getsize(p) // 1024} KB)")


if __name__ == "__main__":
    check()
    if errors:
        print("Validation failed:")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print("Validation OK")
    package()
