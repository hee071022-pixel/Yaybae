#!/usr/bin/env python3
"""Generates the v1.9 monsters: geometry, painted box-UV textures, client entities.

Each model is a list of bones; each cube has a material (colour + pattern) and optional
front-face decals (eyes, mouths…). UV regions are packed automatically, so the geometry
and texture always match.

Usage: python3 Haulers/tools/mob_models.py   (requires Pillow)
"""
import json
import os
import random

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
RP = os.path.join(ROOT, "Haulers_RP")
PX = 2  # texture pixels per model unit

# ───────── materials: base colour + surface pattern ─────────
MAT = {
    "coat":    ((92, 74, 48), "cloth"),
    "coat_dk": ((62, 50, 34), "cloth"),
    "pants":   ((58, 52, 46), "cloth"),
    "boot":    ((34, 28, 24), "leather"),
    "leather": ((104, 66, 38), "leather"),
    "skin":    ((206, 176, 150), "skin"),
    "pale":    ((188, 190, 176), "skin"),
    "hat":     ((40, 34, 30), "cloth"),
    "wood":    ((112, 76, 44), "wood"),
    "iron":    ((120, 124, 132), "metal"),
    "brute":   ((104, 98, 120), "hide"),
    "brute_dk": ((76, 70, 92), "hide"),
    "bone":    ((226, 218, 190), "skin"),
    "red":     ((176, 40, 36), "cloth"),
    "blue":    ((52, 72, 150), "cloth"),
    "beard":   ((236, 236, 230), "fur"),
    "crate":   ((120, 82, 46), "wood"),
    "crate_dk": ((80, 54, 30), "wood"),
    "tongue":  ((196, 70, 86), "skin"),
    "mouth":   ((40, 8, 12), "flat"),
    "spider":  ((44, 30, 54), "hide"),
    "spider_lt": ((70, 52, 84), "hide"),
    "silk":    ((210, 210, 220), "flat"),
    "owl":     ((122, 92, 62), "fur"),
    "owl_lt":  ((176, 150, 116), "fur"),
    "beak":    ((214, 160, 50), "flat"),
    "glow_yel": ((255, 220, 60), "glow"),
    # 보물 상자 블록 텍스처를 그대로 가져다 씀 (미믹이 진짜 상자와 똑같아 보이도록)
    "crate_lo":  ((0, 0, 0), "img:haul_crate_side:6"),
    "crate_hi":  ((0, 0, 0), "img:haul_crate_side:0"),
    "crate_top": ((0, 0, 0), "img:haul_crate_top:0"),
    "crate_bot": ((0, 0, 0), "img:haul_crate_bottom:0"),
}
GLOW = {"eye_red": (255, 60, 40), "eye_yel": (255, 220, 60), "eye_grn": (120, 255, 120), "eye_wht": (255, 255, 235)}


def cube(o, s, mat, front=None, uv=None):
    return {"o": o, "s": s, "mat": mat, "front": front or []}


def eyes(w, h, color, y=None, gap=1, size=1, pupil=None):
    """Two symmetric eyes on a w×h front face (units)."""
    y = h // 3 if y is None else y
    left = max(0, (w - gap) // 2 - size)
    right = w - left - size
    out = []
    for x0 in (left, right):
        for dx in range(size):
            for dy in range(size):
                out.append((x0 + dx, y + dy, color))
        if pupil:
            out.append((x0 + size // 2, y + size // 2, pupil))
    return out


def row(x0, x1, y, color):
    return [(x, y, color) for x in range(x0, x1)]


# ───────── models ─────────
MODELS = {}

MODELS["hunter"] = dict(tex_w=64, bounds=(1.2, 2.4), bones=[
    ("root", [0, 0, 0], None, []),
    ("leg_l", [2, 13, 0], "root", [cube([0, 0, -2], [3, 3, 4], "boot"), cube([0, 3, -1], [3, 10, 3], "pants")]),
    ("leg_r", [-2, 13, 0], "root", [cube([-3, 0, -2], [3, 3, 4], "boot"), cube([-3, 3, -1], [3, 10, 3], "pants")]),
    ("body", [0, 13, 0], "root", [
        cube([-4, 13, -2], [8, 11, 5], "coat"),
        cube([-5, 8, -3], [10, 6, 6], "coat_dk"),
        cube([-4, 13, -3], [8, 1, 1], "leather"),
        cube([-3, 16, -3], [1, 7, 1], "leather"),
    ]),
    ("head", [0, 24, 0], "body", [
        cube([-3, 24, -3], [6, 7, 6], "pale",
             front=eyes(6, 7, "eye_wht", y=2, gap=2, size=1) + row(1, 5, 5, "mouth")),
        cube([-6, 31, -6], [12, 1, 12], "hat"),
        cube([-4, 32, -4], [8, 3, 8], "hat"),
        cube([-4, 32, -4], [8, 1, 8], "leather"),
    ]),
    ("arm_l", [5, 23, 0], "body", [cube([4, 13, -1], [3, 11, 3], "coat"), cube([4, 11, -1], [3, 2, 3], "pale")]),
    ("arm_r", [-5, 23, 0], "body", [cube([-7, 13, -1], [3, 11, 3], "coat"), cube([-7, 11, -1], [3, 2, 3], "pale")]),
    ("gun", [-5, 12, 0], "arm_r", [
        cube([-6, 11, -14], [1, 2, 10], "iron"),
        cube([-6, 10, -6], [1, 3, 8], "wood"),
    ]),
])

MODELS["brute"] = dict(tex_w=128, bounds=(2.2, 3.4), bones=[
    ("root", [0, 0, 0], None, []),
    ("leg_l", [5, 14, 0], "root", [cube([2, 0, -4], [7, 3, 8], "brute_dk"), cube([2, 3, -3], [7, 11, 6], "brute")]),
    ("leg_r", [-5, 14, 0], "root", [cube([-9, 0, -4], [7, 3, 8], "brute_dk"), cube([-9, 3, -3], [7, 11, 6], "brute")]),
    ("body", [0, 14, 0], "root", [
        cube([-9, 14, -6], [18, 14, 12], "brute"),
        cube([-7, 28, -4], [14, 6, 10], "brute_dk"),
        cube([-8, 14, -7], [16, 4, 1], "leather"),
    ]),
    ("head", [0, 30, -4], "body", [
        cube([-5, 25, -14], [10, 9, 10], "brute",
             front=eyes(10, 9, "eye_red", y=3, gap=2, size=2) + row(2, 8, 6, "mouth") + row(2, 8, 7, "mouth")),
        cube([-4, 23, -15], [2, 3, 2], "bone"),
        cube([2, 23, -15], [2, 3, 2], "bone"),
    ]),
    ("arm_l", [10, 28, 0], "body", [cube([9, 6, -3], [6, 22, 6], "brute"), cube([8, 1, -4], [8, 6, 8], "brute_dk")]),
    ("arm_r", [-10, 28, 0], "body", [cube([-15, 6, -3], [6, 22, 6], "brute"), cube([-16, 1, -4], [8, 6, 8], "brute_dk")]),
])

MODELS["gnome"] = dict(tex_w=64, bounds=(0.6, 1.0), bones=[
    ("root", [0, 0, 0], None, []),
    ("leg_l", [1, 3, 0], "root", [cube([0, 0, -1], [2, 3, 2], "boot")]),
    ("leg_r", [-1, 3, 0], "root", [cube([-2, 0, -1], [2, 3, 2], "boot")]),
    ("body", [0, 3, 0], "root", [cube([-2, 3, -2], [4, 4, 3], "blue"), cube([-2, 3, -2], [4, 1, 3], "leather")]),
    ("head", [0, 7, 0], "body", [
        cube([-2, 7, -2], [4, 4, 4], "skin", front=eyes(4, 4, "eye_red", y=1, gap=0, size=1)),
        cube([-2, 6, -3], [4, 2, 1], "beard"),
        cube([-1, 8, -3], [2, 1, 1], "skin"),
        cube([-3, 11, -3], [6, 1, 6], "red"),
        cube([-2, 12, -2], [4, 2, 4], "red"),
        cube([-1, 14, -1], [2, 2, 2], "red"),
        cube([0, 16, 0], [1, 2, 1], "red"),
    ]),
    ("arm_l", [2, 7, 0], "body", [cube([2, 3, -1], [1, 4, 1], "blue")]),
    ("arm_r", [-2, 7, 0], "body", [cube([-3, 3, -1], [1, 4, 1], "blue")]),
])

MODELS["mimic"] = dict(tex_w=64, bounds=(1.2, 1.4), bones=[
    ("root", [0, 0, 0], None, []),
    ("body", [0, 0, 0], "root", [
        cube([-8, 0, -8], [16, 10, 16], "crate_lo"),
        cube([-7, 9, -7], [14, 1, 14], "mouth"),
        cube([-3, 9, -5], [6, 1, 9], "tongue"),
        cube([-5, 10, -2], [2, 2, 1], "glow_yel"), cube([3, 10, -2], [2, 2, 1], "glow_yel"),
        cube([-6, 10, -7], [1, 2, 1], "bone"), cube([-3, 10, -7], [1, 2, 1], "bone"),
        cube([0, 10, -7], [1, 2, 1], "bone"), cube([3, 10, -7], [1, 2, 1], "bone"),
    ]),
    ("lid", [0, 10, 8], "body", [
        cube([-8, 10, -8], [16, 6, 16], "crate_hi"),
        cube([-5, 9, -7], [1, 1, 1], "bone"), cube([-1, 9, -7], [1, 1, 1], "bone"),
        cube([2, 9, -7], [1, 1, 1], "bone"), cube([5, 9, -7], [1, 1, 1], "bone"),
    ]),
])

_legs = []
for i, (x, z, ry) in enumerate([(5, -3, -30), (5, -1, -10), (5, 1, 10), (5, 3, 30),
                                (-5, -3, 210), (-5, -1, 190), (-5, 1, 170), (-5, 3, 150)]):
    _legs.append((f"leg{i}", [x * 0.8, 9, z], "body", [cube([x * 0.8 - 0.5, 0, z - 0.5], [1, 9, 1], "spider_lt")],
                  [-z * 8, 0, 40 if x > 0 else -40]))
MODELS["dangler"] = dict(tex_w=64, bounds=(1.0, 1.0), bones=[
    ("root", [0, 0, 0], None, []),
    ("body", [0, 9, 0], "root", [
        cube([-4, 7, -4], [8, 6, 8], "spider", front=eyes(8, 6, "eye_grn", y=1, gap=2, size=1) + eyes(8, 6, "eye_grn", y=3, gap=4, size=1)),
        cube([-3, 5, -3], [6, 2, 6], "spider_lt"),
        cube([-1, 13, -1], [2, 1, 2], "spider_lt"),
        cube([0, 14, 0], [1, 20, 1], "silk"),
    ]),
] + _legs)

MODELS["owl"] = dict(tex_w=64, bounds=(1.0, 1.6), bones=[
    ("root", [0, 0, 0], None, []),
    ("head", [0, 14, 0], "root", [
        cube([-5, 9, -5], [10, 10, 10], "owl",
             front=[(x, y, "owl_lt") for x in range(1, 9) for y in range(2, 7)] +
                   eyes(10, 10, "eye_yel", y=3, gap=2, size=3, pupil="mouth") + [(4, 7, "beak"), (5, 7, "beak"), (4, 8, "beak"), (5, 8, "beak")]),
        cube([-5, 19, -2], [2, 3, 2], "owl"),
        cube([3, 19, -2], [2, 3, 2], "owl"),
    ]),
    ("wing_l", [5, 15, 0], "head", [cube([5, 10, -3], [1, 7, 6], "owl")]),
    ("wing_r", [-5, 15, 0], "head", [cube([-6, 10, -3], [1, 7, 6], "owl")]),
])


# ───────── painter ─────────
def noise(seed, x, y):
    h = (x * 73856093 ^ y * 19349663 ^ seed * 83492791) & 0xFFFF
    return (h % 1000) / 1000.0


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


_imgs = {}


def block_tex(name):
    if name not in _imgs:
        _imgs[name] = Image.open(os.path.join(RP, "textures", "blocks", name + ".png")).convert("RGBA")
    return _imgs[name]


def paint_face(img, rx, ry, w, h, mat, face, seed, decals):
    base, pattern = MAT[mat]
    if pattern.startswith("img:"):
        _, tex, row0 = pattern.split(":")
        if face == "up":
            tex, row0 = "haul_crate_top", "0"
        elif face == "down":
            tex, row0 = "haul_crate_bottom", "0"
        src = block_tex(tex)
        for j in range(h * PX):
            for i in range(w * PX):
                sx = min(15, i * 16 // (w * PX))
                sy = min(15, int(row0) + j // PX) if face not in ("up", "down") else min(15, j * 16 // (h * PX))
                img.putpixel((rx * PX + i, ry * PX + j), src.getpixel((sx, sy))[:3] + (255,))
        return
    tone = {"up": 1.12, "down": 0.72}.get(face, 1.0 if face == "north" else 0.92)
    for j in range(h * PX):
        for i in range(w * PX):
            n = noise(seed, rx * PX + i, ry * PX + j)
            k = tone * (0.92 + n * 0.14)
            if pattern == "wood" and (j % (3 * PX) == 0):
                k *= 0.78
            elif pattern == "metal" and (i in (1, w * PX - 2) and j in (1, h * PX - 2)):
                k *= 1.35
            elif pattern == "fur" and (i + j * 3) % 5 == 0:
                k *= 0.85
            elif pattern == "hide" and n > 0.86:
                k *= 0.8
            elif pattern in ("flat", "glow"):
                k = tone
            if face not in ("up", "down"):
                if j == 0:
                    k *= 1.12
                elif j == h * PX - 1:
                    k *= 0.8
            img.putpixel((rx * PX + i, ry * PX + j), shade(base, k) + (120 if pattern == "glow" else 255,))
    if face == "north":
        for (dx, dy, col) in decals:
            if not (0 <= dx < w and 0 <= dy < h):
                continue
            if col in GLOW:
                rgb, a = GLOW[col], 120  # alpha < 255 → glows with entity_emissive_alpha
            else:
                rgb, a = MAT[col][0], 255
            for i in range(PX):
                for j in range(PX):
                    img.putpixel(((rx + dx) * PX + i, (ry + dy) * PX + j), rgb + (a,))


def build(name, spec):
    tw = spec["tex_w"]
    # shelf-pack every cube's box-UV region
    regions, x, y, shelf = [], 0, 0, 0
    for bone in spec["bones"]:
        for c in bone[3]:
            w, h, d = (int(round(v)) for v in c["s"])
            rw, rh = 2 * (w + d), d + h
            if x + rw > tw:
                x, y, shelf = 0, y + shelf, 0
            c["uv"] = [x, y]
            x += rw
            shelf = max(shelf, rh)
    th = 16
    while th < y + shelf:
        th *= 2
    img = Image.new("RGBA", (tw * PX, th * PX), (0, 0, 0, 0))
    seed = 1
    for bone in spec["bones"]:
        for c in bone[3]:
            seed += 1
            w, h, d = (int(round(v)) for v in c["s"])
            u, v = c["uv"]
            faces = {"up": (u + d, v, w, d), "down": (u + d + w, v, w, d), "east": (u, v + d, d, h),
                     "north": (u + d, v + d, w, h), "west": (u + d + w, v + d, d, h), "south": (u + 2 * d + w, v + d, w, h)}
            for face, (fx, fy, fw, fh) in faces.items():
                if fw and fh:
                    paint_face(img, fx, fy, fw, fh, c["mat"], face, seed, c["front"])
    os.makedirs(os.path.join(RP, "textures", "entity"), exist_ok=True)
    img.save(os.path.join(RP, "textures", "entity", f"{name}.png"))

    bw, bh = spec["bounds"]
    geo = {"format_version": "1.12.0", "minecraft:geometry": [{
        "description": {"identifier": f"geometry.haul.{name}", "texture_width": tw, "texture_height": th,
                        "visible_bounds_width": bw + 1, "visible_bounds_height": bh + 1, "visible_bounds_offset": [0, bh / 2, 0]},
        "bones": []}]}
    for bone in spec["bones"]:
        bname, pivot, parent, cubes = bone[:4]
        b = {"name": bname, "pivot": pivot}
        if len(bone) > 4:
            b["rotation"] = bone[4]
        if parent:
            b["parent"] = parent
        if cubes:
            b["cubes"] = [{"origin": c["o"], "size": c["s"], "uv": c["uv"]} for c in cubes]
        geo["minecraft:geometry"][0]["bones"].append(b)
    with open(os.path.join(RP, "models", "entity", f"{name}.geo.json"), "w") as f:
        json.dump(geo, f, indent=2)
        f.write("\n")


# ───────── client entities ─────────
CLIENT = {
    "hunter":  dict(anims={"walk": "animation.haul.walk", "look": "animation.haul.look", "aim": "animation.haul.aim"},
                    animate=["walk", "look", "aim"], egg=("#5c4a30", "#e6e0c8")),
    "brute":   dict(anims={"walk": "animation.haul.walk_heavy", "look": "animation.haul.look", "attack": "animation.haul.attack"},
                    animate=["walk", "look", {"attack": "variable.attack_time > 0"}], egg=("#686078", "#c02820")),
    "gnome":   dict(anims={"walk": "animation.haul.walk_fast", "look": "animation.haul.look", "attack": "animation.haul.attack"},
                    animate=["walk", "look", {"attack": "variable.attack_time > 0"}], egg=("#3448a0", "#b02824")),
    "mimic":   dict(anims={"bite": "animation.haul.mimic_bite"},
                    animate=[{"bite": "q.property('haul:awake')"}], egg=("#78522e", "#ffdc3c")),
    "dangler": dict(anims={"twitch": "animation.haul.dangler_twitch"}, animate=["twitch"], egg=("#2c1e36", "#78ff78")),
    "owl":     dict(anims={"look": "animation.haul.look", "flap": "animation.haul.owl_flap"},
                    animate=["look", "flap"], egg=("#7a5c3e", "#ffdc3c")),
}


def client(name):
    c = CLIENT[name]
    d = {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": f"haul:{name}",
        "materials": {"default": "entity_emissive_alpha"},
        "textures": {"default": f"textures/entity/{name}"},
        "geometry": {"default": f"geometry.haul.{name}"},
        "animations": c["anims"],
        "scripts": {"animate": c["animate"]},
        "render_controllers": ["controller.render.default"],
        "spawn_egg": {"base_color": c["egg"][0], "overlay_color": c["egg"][1]},
    }}}
    with open(os.path.join(RP, "entity", f"{name}.entity.json"), "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    random.seed(0)
    for n, spec in MODELS.items():
        build(n, spec)
        client(n)
        print("built", n)
