#!/usr/bin/env python3
"""Validates both packs and packages them for Minecraft Bedrock.

Output (dist/):
  Medieval_Arsenal.mcaddon   - double-click to import both packs at once
  Medieval_Arsenal_BP.mcpack
  Medieval_Arsenal_RP.mcpack

Usage:  python3 tools/build.py [--regen]
  --regen  run generate_assets.py first
"""
import glob
import json
import os
import re
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = {"BP": os.path.join(ROOT, "Medieval_BP"), "RP": os.path.join(ROOT, "Medieval_RP")}
DIST = os.path.join(ROOT, "dist")


def fail(msg):
    print("ERROR:", msg)
    sys.exit(1)


def validate():
    errors = 0
    for name, root in PACKS.items():
        for f in glob.glob(os.path.join(root, "**", "*.json"), recursive=True):
            try:
                with open(f, encoding="utf-8") as fh:
                    json.load(fh)
            except Exception as e:  # noqa: BLE001
                print(f"  bad JSON: {os.path.relpath(f, ROOT)}: {e}")
                errors += 1

    bp = json.load(open(os.path.join(PACKS["BP"], "manifest.json")))
    rp = json.load(open(os.path.join(PACKS["RP"], "manifest.json")))
    deps = [d.get("uuid") for d in bp.get("dependencies", [])]
    if rp["header"]["uuid"] not in deps:
        print("  BP manifest does not depend on the RP uuid")
        errors += 1

    # every item icon must exist in item_texture.json and on disk
    tex = json.load(open(os.path.join(PACKS["RP"], "textures", "item_texture.json")))["texture_data"]
    for f in glob.glob(os.path.join(PACKS["BP"], "items", "*.json")):
        comps = json.load(open(f))["minecraft:item"]["components"]
        icon = comps["minecraft:icon"]["textures"]["default"]
        if icon not in tex:
            print(f"  missing item_texture entry: {icon}")
            errors += 1
        elif not os.path.exists(os.path.join(PACKS["RP"], tex[icon]["textures"] + ".png")):
            print(f"  missing icon png for {icon}")
            errors += 1

    # geometry referenced by attachables / client entities exists
    geos = set()
    for f in glob.glob(os.path.join(PACKS["RP"], "models", "**", "*.geo.json"), recursive=True):
        for g in json.load(open(f))["minecraft:geometry"]:
            geos.add(g["description"]["identifier"])
    for f in glob.glob(os.path.join(PACKS["RP"], "attachables", "*.json")) + \
            glob.glob(os.path.join(PACKS["RP"], "entity", "*.json")):
        d = json.load(open(f))
        desc = (d.get("minecraft:attachable") or d.get("minecraft:client_entity"))["description"]
        for g in desc["geometry"].values():
            if g not in geos:
                print(f"  {os.path.basename(f)} references unknown geometry {g}")
                errors += 1
        for t in desc["textures"].values():
            if t.startswith("textures/misc/"):
                continue
            if not os.path.exists(os.path.join(PACKS["RP"], t + ".png")):
                print(f"  {os.path.basename(f)} references missing texture {t}")
                errors += 1

    # sounds referenced by scripts are defined
    defs = json.load(open(os.path.join(PACKS["RP"], "sounds", "sound_definitions.json")))["sound_definitions"]
    src = "".join(open(f, encoding="utf-8").read()
                  for f in glob.glob(os.path.join(PACKS["BP"], "scripts", "**", "*.js"), recursive=True))
    for s in set(re.findall(r'"(mdv\.(?!msg|hud|ui|desc)[a-z_]+(?:\.[a-z_]+)?)"', src)):
        if s not in defs:
            print(f"  script plays undefined sound {s}")
            errors += 1
    for sid, d in defs.items():
        for s in d["sounds"]:
            if not os.path.exists(os.path.join(PACKS["RP"], s["name"] + ".wav")):
                print(f"  {sid}: missing file {s['name']}.wav")
                errors += 1

    if errors:
        fail(f"{errors} validation error(s)")
    print("validation OK")


def zip_dir(zf, folder, prefix):
    for base, _, files in os.walk(folder):
        for fn in sorted(files):
            full = os.path.join(base, fn)
            rel = os.path.relpath(full, folder)
            zf.write(full, os.path.join(prefix, rel) if prefix else rel)


def package():
    os.makedirs(DIST, exist_ok=True)
    for key, folder in PACKS.items():
        out = os.path.join(DIST, f"Medieval_Arsenal_{key}.mcpack")
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
            zip_dir(zf, folder, "")
        print("wrote", os.path.relpath(out, ROOT))
    out = os.path.join(DIST, "Medieval_Arsenal.mcaddon")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for folder in PACKS.values():
            zip_dir(zf, folder, os.path.basename(folder))
    print("wrote", os.path.relpath(out, ROOT))


if __name__ == "__main__":
    if "--regen" in sys.argv:
        subprocess.check_call([sys.executable, os.path.join(ROOT, "tools", "generate_assets.py")])
    validate()
    package()
