#!/usr/bin/env python3
"""Medieval Arsenal (중세 무기고) asset generator.

Regenerates every procedurally-built file of the add-on:
  * 3D weapon/projectile geometry + matching box-UV textures   (RP)
  * 2D inventory icons rendered from the same 3D models          (RP)
  * misc item icons, particle atlas, pack icons                  (RP/BP)
  * attachables, hold animations, item_texture.json              (RP)
  * item definition JSON                                          (BP)
  * sound effects (.wav)                                          (RP)

Usage:  python3 tools/generate_assets.py
Stdlib only - no pip installs needed.
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pngkit import Canvas, lerp_c, shade  # noqa: E402
import models as M  # noqa: E402
import sounds  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, "Medieval_RP")
BP = os.path.join(ROOT, "Medieval_BP")
NS = "mdv"

GLOW_ALPHA = 36          # alpha that marks emissive texels for entity_emissive_alpha
WHITE = (255, 255, 255)


def path(*p):
    full = os.path.join(*p)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    return full


def dump(obj, *p):
    with open(path(*p), "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def hash01(*v):
    """Stable pseudo random 0..1 from integers (so rows keep the same grain)."""
    h = 2166136261
    for x in v:
        h = ((h ^ (int(x) & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
    return (h % 1000) / 1000.0


# ===========================================================================
# Material shading shared by model textures and icons.
#   a = position along the long axis, b = position across it (both in cells)
#   blen = number of cells across, edge flags tell where the bevel is.
# ===========================================================================
def material_color(mat, a, b, blen, seed, rng):
    base, glow = M.MATERIALS[mat]
    if glow:
        t = abs(b - (blen - 1) / 2) / max(1.0, blen / 2)
        return lerp_c(base, WHITE, 0.55 * (1 - t)), True
    c = base
    if mat in ("wood", "dark_wood"):
        c = shade(c, 0.86 + 0.2 * hash01(seed, b))
        if hash01(seed, b, a // 5) > 0.85:
            c = shade(c, 0.78)
    elif mat == "leather":
        c = shade(c, 0.72 if (a + b) % 3 == 0 else 1.0)
    elif mat == "steel":
        mid = (blen - 1) / 2
        if blen >= 3 and abs(b - mid) < 0.6:
            c = shade(c, 0.78)                     # fuller
        elif b == 0 or b == blen - 1:
            c = lerp_c(c, WHITE, 0.45)             # honed edge
        c = shade(c, 0.95 + 0.1 * hash01(seed, a))
    elif mat in ("gold", "brass"):
        if hash01(seed, a, b) > 0.82:
            c = lerp_c(c, (255, 240, 180), 0.5)
    elif mat in ("cloth_red", "cloth_blue"):
        c = shade(c, 0.85 if (a + b) % 2 == 0 else 1.05)
    elif mat == "rope":
        c = shade(c, 0.7 if (a - b) % 3 == 0 else 1.0)
    elif mat == "clay":
        c = shade(c, 0.9 + 0.16 * rng.random())
    elif mat == "feather":
        c = shade(c, 0.82 if b % 2 else 1.0)
    elif mat == "abyss":
        # 칠흑 바탕에 보랏빛 날, 별가루 같은 반점
        if blen >= 3 and (b == 0 or b == blen - 1):
            c = lerp_c(c, (150, 110, 230), 0.55)
        else:
            c = shade(c, 0.85 + 0.25 * hash01(seed, a, b))
        if hash01(seed, a * 7, b * 3) > 0.96:
            c = lerp_c(c, (220, 200, 255), 0.7)
    elif mat in ("iron", "dark_iron", "string"):
        c = shade(c, 0.93 + 0.12 * rng.random())
        if mat != "string" and rng.random() < 0.04:
            c = lerp_c(c, WHITE, 0.3)              # scratches
    return c, False


# ===========================================================================
# 1. Model -> geometry + texture atlas
# ===========================================================================
def face_rects(u, v, w, h, d):
    """Bedrock box-UV layout for a cube of size (w,h,d) placed at (u,v)."""
    return {
        "up":    (u + d, v, w, d),
        "down":  (u + d + w, v, w, d),
        "east":  (u, v + d, d, h),
        "north": (u + d, v + d, w, h),
        "west":  (u + d + w, v + d, d, h),
        "south": (u + 2 * d + w, v + d, w, h),
    }


FACE_LIGHT = {"up": 1.18, "down": 0.62, "north": 0.9, "south": 0.84, "east": 1.0, "west": 1.0}


def paint_face(cv, rect, mat, face, seed, rng):
    x0, y0, w, h = rect
    if w <= 0 or h <= 0:
        return
    k = FACE_LIGHT[face]
    horizontal = w >= h
    for yy in range(h):
        for xx in range(w):
            a, b, blen = (xx, yy, h) if horizontal else (yy, xx, w)
            c, glow = material_color(mat, a, b, blen, seed, rng)
            if glow:
                cv.set(x0 + xx, y0 + yy, (*c, GLOW_ALPHA))
                continue
            c = shade(c, k)
            if w >= 3 and h >= 3 and mat not in ("steel",):
                if yy == 0 or xx == 0:
                    c = shade(c, 1.12)
                elif yy == h - 1 or xx == w - 1:
                    c = shade(c, 0.74)
            cv.set(x0 + xx, y0 + yy, (*c, 255))
    if mat in ("iron", "dark_iron") and w >= 4 and h >= 4:
        for (rx, ry) in ((1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)):
            cv.set(x0 + rx, y0 + ry, (*shade(M.MATERIALS[mat][0], k * 1.45), 255))


def pack_cubes(cubes):
    rects = []
    for i, c in enumerate(cubes):
        w, h, d = c["size"]
        rects.append((i, 2 * d + 2 * w, d + h))
    widest = max(r[1] for r in rects)
    tex_w = 32
    while tex_w < widest:
        tex_w *= 2
    while True:
        placed = {}
        x = y = row_h = 0
        for i, rw, rh in sorted(rects, key=lambda r: -r[2]):
            if x + rw > tex_w:
                x = 0
                y += row_h
                row_h = 0
            placed[i] = (x, y)
            x += rw
            row_h = max(row_h, rh)
        total_h = y + row_h
        tex_h = 16
        while tex_h < total_h:
            tex_h *= 2
        if tex_h <= tex_w * 2 or tex_w >= 256:
            return placed, tex_w, tex_h
        tex_w *= 2


def build_model(name, cubes, bound, seed):
    rng = random.Random(seed)
    placed, tw, th = pack_cubes(cubes)
    cv = Canvas(tw, th)
    geo_cubes = []
    for i, c in enumerate(cubes):
        u, v = placed[i]
        w, h, d = c["size"]
        for face, rect in face_rects(u, v, w, h, d).items():
            paint_face(cv, rect, c["mat"], face, seed * 31 + i, rng)
        gc = {"origin": c["origin"], "size": c["size"], "uv": [u, v]}
        if c["rot"]:
            gc["rotation"] = c["rot"]
            gc["pivot"] = c["pivot"] or [0, 0, 0]
        geo_cubes.append(gc)

    if bound:
        bones = [
            {"name": "root", "pivot": [0, 0, 0], "binding": "q.item_slot_to_bone_name(c.item_slot)"},
            {"name": "weapon", "parent": "root", "pivot": [0, 0, 0], "cubes": geo_cubes},
        ]
    else:
        bones = [{"name": "body", "pivot": [0, 0, 0], "cubes": geo_cubes}]

    geo = {
        "format_version": "1.16.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": f"geometry.{NS}.{name}",
                "texture_width": tw,
                "texture_height": th,
                "visible_bounds_width": 4,
                "visible_bounds_height": 4,
                "visible_bounds_offset": [0, 0.5, 0],
            },
            "bones": bones,
        }],
    }
    return geo, cv


# ===========================================================================
# 2. Inventory icons: real 3D renders of the same models
#    A tiny orthographic ray tracer (ray/box slabs, X-rotated cubes,
#    per-face lambert lighting, material patterns in texel space).
#    views: diag  - 3/4 side view rotated 45 deg (swords, axes, polearms)
#           top   - 3/4 top-down view (crossbow)
#           side  - 3/4 side view (pots, small items)
# ===========================================================================
def v_add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def v_sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def v_mul(a, k): return (a[0] * k, a[1] * k, a[2] * k)
def v_dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def v_cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def v_norm(a):
    l = math.sqrt(v_dot(a, a)) or 1.0
    return (a[0] / l, a[1] / l, a[2] / l)


def rot_x(y, z, a_deg, py, pz, inverse=False):
    """Bedrock X rotation (positive pitches -Z down) in the (y,z) plane."""
    t = math.radians(-a_deg)
    if inverse:
        t = -t
    y -= py
    z -= pz
    return (y * math.cos(t) - z * math.sin(t) + py, y * math.sin(t) + z * math.cos(t) + pz)


def _to_local(c, p, is_dir=False):
    if not c["rot"]:
        return p
    pv = (0, 0, 0) if is_dir else (c["pivot"] or [0, 0, 0])
    y, z = rot_x(p[1], p[2], c["rot"][0], pv[1], pv[2], inverse=True)
    return (p[0], y, z)


def _to_world(c, p, is_dir=False):
    if not c["rot"]:
        return p
    pv = (0, 0, 0) if is_dir else (c["pivot"] or [0, 0, 0])
    y, z = rot_x(p[1], p[2], c["rot"][0], pv[1], pv[2])
    return (p[0], y, z)


def _rotate_about(v, axis, ang):
    """Rodrigues rotation."""
    c, s = math.cos(ang), math.sin(ang)
    return v_add(v_add(v_mul(v, c), v_mul(v_cross(axis, v), s)), v_mul(axis, v_dot(axis, v) * (1 - c)))


def camera(view):
    if view == "top":
        d, right, up = (0, -1, 0), (0, 0, -1), (1, 0, 0)
        tilt = math.radians(35)
        d, up = _rotate_about(d, right, -tilt), _rotate_about(up, right, -tilt)
    else:
        p = math.radians(28)
        d = (-math.cos(p), -math.sin(p), 0)
        right = (0, 0, -1)
        up = v_cross(right, d)
        yaw = math.radians(-18)
        d, right, up = (_rotate_about(x, (0, 1, 0), yaw) for x in (d, right, up))
    if view == "diag":
        ang = math.radians(45)
        right, up = _rotate_about(right, d, ang), _rotate_about(up, d, ang)
    return v_norm(d), v_norm(right), v_norm(up)


LIGHT = v_norm((0.55, 0.8, -0.25))


def _hit_cube(c, ro, rd):
    o, s = c["origin"], c["size"]
    lo, ld = _to_local(c, ro), _to_local(c, rd, True)
    tnear, tfar, axis = -1e9, 1e9, -1
    for i in range(3):
        if abs(ld[i]) < 1e-9:
            if lo[i] < o[i] or lo[i] > o[i] + s[i]:
                return None
            continue
        t1 = (o[i] - lo[i]) / ld[i]
        t2 = (o[i] + s[i] - lo[i]) / ld[i]
        if t1 > t2:
            t1, t2 = t2, t1
        if t1 > tnear:
            tnear, axis = t1, i
        tfar = min(tfar, t2)
        if tnear > tfar:
            return None
    if axis < 0 or tfar < 0:
        return None
    n = [0, 0, 0]
    n[axis] = -1 if ld[axis] > 0 else 1
    p = v_add(lo, v_mul(ld, tnear))
    return tnear, axis, tuple(n), p


def render_icon(cubes, view, size=32, max_scale=2.3):
    d, right, up = camera(view)
    pts = []
    for c in cubes:
        o, s = c["origin"], c["size"]
        for dx in (0, s[0]):
            for dy in (0, s[1]):
                for dz in (0, s[2]):
                    w = _to_world(c, (o[0] + dx, o[1] + dy, o[2] + dz))
                    pts.append((v_dot(w, right), v_dot(w, up)))
    umin, umax = min(p[0] for p in pts), max(p[0] for p in pts)
    vmin, vmax = min(p[1] for p in pts), max(p[1] for p in pts)
    room = size - 3
    s = min(room / (umax - umin), room / (vmax - vmin), max_scale)
    e = 1.0 / s
    uc, vc = (umin + umax) / 2, (vmin + vmax) / 2
    cv = Canvas(size, size)
    for py in range(size):
        for px in range(size):
            u = (px + 0.5 - size / 2) / s + uc
            v = (size / 2 - (py + 0.5)) / s + vc
            ro = v_add(v_add(v_mul(right, u), v_mul(up, v)), v_mul(d, -200))
            best = None
            for i, c in enumerate(cubes):
                h = _hit_cube(c, ro, d)
                if h and (best is None or h[0] < best[0]):
                    best = (h[0], h[1], h[2], h[3], i, c)
            if not best:
                continue
            _, axis, n, p, i, c = best
            o, sz = c["origin"], c["size"]
            j, k = [a for a in range(3) if a != axis]
            cj, ck = p[j] - o[j], p[k] - o[k]
            if sz[j] >= sz[k]:
                a, b, blen = int(cj), int(ck), max(1, int(sz[k]))
            else:
                a, b, blen = int(ck), int(cj), max(1, int(sz[j]))
            b = min(max(b, 0), blen - 1)
            col, glow = material_color(c["mat"], a, b, blen, 7 * i + 1, random.Random(px * 97 + py))
            if not glow:
                nw = _to_world(c, n, True)
                lum = 0.5 + 0.62 * max(0.0, v_dot(nw, LIGHT))
                if min(cj, sz[j] - cj, ck, sz[k] - ck) < e * 0.6:
                    lum *= 0.86
                col = shade(col, lum)
            cv.set(px, py, (*col, 255))
    cv.outline()
    return cv

# ===========================================================================
# 3. Hand-drawn misc icons
# ===========================================================================
def icon_crossbow_bolt():
    cv = Canvas(32, 32)
    for k in range(20):
        x, y = 7 + k, 25 - k
        cv.set(x, y, (78, 52, 32))
        cv.set(x + 1, y, (124, 86, 50))
    cv.polygon([(26, 3), (29, 3), (29, 6), (25, 9), (23, 7)], (196, 204, 214))
    cv.set(27, 4, (255, 255, 255))
    cv.polygon([(3, 24), (8, 22), (10, 24), (8, 26)], (236, 236, 232))
    cv.polygon([(6, 29), (8, 24), (10, 26), (8, 31)], (200, 200, 196))
    cv.outline()
    return cv


def icon_tempered_steel():
    cv = Canvas(32, 32)
    cv.polygon([(5, 15), (21, 10), (27, 14), (11, 19)], (206, 212, 222))
    cv.polygon([(5, 15), (11, 19), (11, 25), (5, 21)], (104, 110, 122))
    cv.polygon([(11, 19), (27, 14), (27, 20), (11, 25)], (150, 156, 168))
    for x in range(12, 27, 3):
        y = int(round(22 - (x - 11) * 5 / 16))
        cv.set(x, y, (90, 96, 108))
    cv.line(6, 15, 20, 11, (250, 252, 255))
    cv.rect(14, 12, 3, 1, (130, 150, 200))      # tempering tint
    cv.outline()
    return cv


def icon_stamina_tonic():
    cv = Canvas(32, 32)
    cv.rect(14, 3, 4, 3, (124, 86, 50))                       # cork
    cv.rect(13, 6, 6, 5, (200, 220, 220))                     # neck glass
    cv.circle(16, 20, 9, (210, 230, 230))                     # flask
    cv.circle(16, 21, 7.5, (60, 170, 70))                     # green tonic
    cv.rect(8, 12, 16, 5, (0, 0, 0, 0))
    cv.circle(16, 20, 9, (210, 230, 230), soft=0)             # redraw glass rim
    cv.circle(16, 21, 7.5, (60, 170, 70))
    for yy in range(12, 17):
        for xx in range(8, 25):
            if cv.get(xx, yy)[:3] == (60, 170, 70):
                cv.set(xx, yy, (200, 225, 225))
    cv.circle(12.5, 17, 1.5, (240, 255, 255))
    cv.rect(13, 10, 6, 1, (150, 32, 36))                      # ribbon
    cv.outline()
    return cv


def icon_valor_medal():
    cv = Canvas(32, 32)
    cv.polygon([(10, 2), (15, 2), (17, 12), (13, 12)], (40, 62, 140))
    cv.polygon([(17, 2), (22, 2), (19, 12), (15, 12)], (150, 32, 36))
    cv.circle(16, 20, 9, (176, 132, 62))
    cv.circle(16, 20, 7.5, (230, 186, 70))
    star = [(16 + (6 if k % 2 == 0 else 2.6) * math.sin(k * math.pi / 5),
             20 - (6 if k % 2 == 0 else 2.6) * math.cos(k * math.pi / 5)) for k in range(10)]
    cv.polygon(star, (255, 236, 150))
    cv.set(14, 17, (255, 255, 255))
    cv.outline()
    return cv


def icon_war_horn():
    cv = Canvas(32, 32)
    for k in range(22):
        t = k / 21
        x = 5 + k
        y = 24 - 14 * math.sin(t * math.pi * 0.55)
        r = 1.2 + t * 3.6
        col = lerp_c((236, 222, 190), (190, 160, 110), t)
        cv.circle(x, y, r, col)
    cv.circle(26.5, 12.2, 4.8, (120, 90, 50))
    cv.circle(26.5, 12.2, 3.2, (40, 28, 18))
    for x in (11, 18):
        y = 24 - 14 * math.sin((x - 5) / 21 * math.pi * 0.55)
        cv.rect(x, int(y - 3), 2, 7, (214, 170, 60))
    cv.rect(3, 23, 3, 3, (214, 170, 60))
    cv.outline()
    return cv


def icon_knights_codex():
    cv = Canvas(32, 32)
    cv.rect(6, 4, 21, 25, (110, 30, 32))            # cover
    cv.rect(7, 5, 19, 23, (150, 32, 36))
    cv.rect(24, 6, 3, 21, (236, 226, 200))          # page edges
    for y in range(7, 27, 2):
        cv.rect(24, y, 3, 1, (200, 190, 160))
    cv.rect(6, 4, 2, 25, (80, 20, 22))              # spine
    cv.polygon([(16, 9), (21, 11), (21, 16), (16, 21), (11, 16), (11, 11)], (214, 170, 60))  # crest
    cv.polygon([(16, 11), (19, 12), (19, 15), (16, 18), (13, 15), (13, 12)], (40, 62, 140))
    cv.rect(15, 11, 2, 7, (236, 236, 232))
    cv.rect(13, 13, 6, 2, (236, 236, 232))
    for (x, y) in ((8, 6), (22, 6), (8, 25), (22, 25)):
        cv.rect(x, y, 2, 2, (214, 170, 60))
    cv.outline()
    return cv


# ===========================================================================
# 4. Particle atlas (white, tinted in particle JSON)  - 64x64
# ===========================================================================
def particle_atlas():
    cv = Canvas(64, 64)
    # (0,0) soft dot 8x8
    for y in range(8):
        for x in range(8):
            d = math.hypot(x + 0.5 - 4, y + 0.5 - 4) / 4
            cv.set(x, y, (255, 255, 255, max(0.0, 1 - d) ** 1.4 * 255))
    # (8,0) spark 8x8
    for i in range(8):
        a = (1 - abs(i - 3.5) / 4) * 255
        cv.set(8 + i, 3, (255, 255, 255, a))
        cv.set(8 + i, 4, (255, 255, 255, a))
        cv.set(11, i, (255, 255, 255, a))
        cv.set(12, i, (255, 255, 255, a))
    # (16,0) ring 16x16
    for y in range(16):
        for x in range(16):
            d = math.hypot(x + 0.5 - 8, y + 0.5 - 8)
            cv.set(16 + x, y, (255, 255, 255, max(0.0, 1 - abs(d - 6.3) / 1.4) * 255))
    # (32,0) 5-point star 8x8 (stun)
    star = [(36 + (3.8 if k % 2 == 0 else 1.6) * math.sin(k * math.pi / 5),
             4 - (3.8 if k % 2 == 0 else 1.6) * math.cos(k * math.pi / 5)) for k in range(10)]
    cv.polygon(star, (255, 255, 255, 255))
    # (40,0) hard 4x4 chip
    cv.rect(42, 2, 4, 4, (255, 255, 255, 255))
    # (48,0) slash streak 16x4
    for x in range(16):
        a = 1 - abs(x - 7.5) / 8
        for y in range(4):
            cv.set(48 + x, y, (255, 255, 255, a * (255 if y in (1, 2) else 90)))
    # (0,16) smoke/dust puff 16x16
    rng = random.Random(3)
    for y in range(16):
        for x in range(16):
            d = math.hypot(x + 0.5 - 8, y + 0.5 - 8) / 8
            cv.set(x, 16 + y, (255, 255, 255, max(0.0, 1 - d) * rng.uniform(0.6, 1.0) * 200))
    # (16,16) flame tongue 8x16
    for y in range(16):
        for x in range(8):
            t = y / 15
            half = 3.8 * math.sin(t * math.pi) ** 0.8 * (0.4 + 0.6 * t)
            dx = abs(x + 0.5 - 4)
            if dx < half:
                cv.set(16 + x, 16 + y, (255, 255, 255, (1 - dx / half) ** 0.6 * 255))
    # (24,16) blood/drop 8x8
    cv.circle(28, 21.5, 2.5, (255, 255, 255, 255))
    cv.polygon([(26, 21), (30, 21), (28, 17)], (255, 255, 255, 255))
    return cv


# ===========================================================================
# 4b. Magic circle (신초의 검 능력) - white, tinted in particle JSON  128x128
# ===========================================================================
def magic_circle(n=128):
    cv = Canvas(n, n)
    c = n / 2
    alpha = [[0.0] * n for _ in range(n)]

    def seg_dist(px, py, ax, ay, bx, by):
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - ax - dx * t, py - ay - dy * t)

    def pt(r, ang):
        return (c + r * math.cos(ang), c + r * math.sin(ang))

    # hexagram + inner square, as line segments
    segs = []
    for tri in (0, 1):
        p3 = [pt(44, -math.pi / 2 + tri * math.pi / 3 + k * 2 * math.pi / 3) for k in range(3)]
        segs += [(p3[k], p3[(k + 1) % 3]) for k in range(3)]
    sq = [pt(22, math.pi / 4 + k * math.pi / 2) for k in range(4)]
    segs += [(sq[k], sq[(k + 1) % 4]) for k in range(4)]
    nodes = [pt(44, -math.pi / 2 + k * math.pi / 3) for k in range(6)]

    for y in range(n):
        for x in range(n):
            px, py = x + 0.5, y + 0.5
            d = math.hypot(px - c, py - c)
            ang = math.atan2(py - c, px - c)
            a = 0.0
            for r, w in ((62, 1.2), (58.5, 0.8), (47, 1.1), (44, 0.7), (22, 0.8), (9, 1.0)):
                a = max(a, 1 - abs(d - r) / w)
            # rune band between 47 and 58.5: glyph blocks and ticks
            if 48.5 < d < 57:
                cell = int((ang + math.pi) / (2 * math.pi) * 48)
                local = ((ang + math.pi) / (2 * math.pi) * 48) % 1
                h = hash01(cell, 7)
                if h > 0.15 and 0.18 < local < 0.82:
                    row = int((d - 48.5) / 2.9)
                    if hash01(cell, row, 3) > 0.45:
                        a = max(a, 0.9)
                elif local < 0.08:
                    a = max(a, 0.55)
            for (ax, ay), (bx, by) in segs:
                a = max(a, 1 - seg_dist(px, py, ax, ay, bx, by) / 1.0)
            for (nx, ny) in nodes:
                a = max(a, 1 - abs(math.hypot(px - nx, py - ny) - 3.2) / 0.8)
            if d < 4:
                a = max(a, 1 - d / 4)
            alpha[y][x] = max(0.0, min(1.0, a))
    for y in range(n):
        for x in range(n):
            if alpha[y][x] > 0:
                cv.set(x, y, (255, 255, 255, alpha[y][x] * 255))
    return cv


# ===========================================================================
# 5. Pack icons
# ===========================================================================
GLYPHS = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "11110", "10001", "10001", "10001", "11110"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10001", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "R": ["11110", "10001", "11110", "10100", "10010", "10001", "10001"],
    "S": ["01111", "10000", "01110", "00001", "00001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
    " ": ["00000"] * 7,
}


def draw_text(cv, text, x, y, scale, col, shadow=(20, 12, 8)):
    for pass_col, off in ((shadow, 1), (col, 0)):
        xx = x
        for ch in text:
            for gy, row in enumerate(GLYPHS[ch]):
                for gx, bit in enumerate(row):
                    if bit == "1":
                        cv.rect(xx + gx * scale + off, y + gy * scale + off, scale, scale, pass_col)
            xx += 6 * scale


def pack_icon(left, right, field, label):
    n = 128
    cv = Canvas(n, n)
    rng = random.Random(label)
    # stone wall background
    for y in range(n):
        for x in range(n):
            row = y // 12
            brick = (x + (6 if row % 2 else 0) * 2) // 24
            mortar = y % 12 == 0 or (x + (6 if row % 2 else 0) * 2) % 24 == 0
            base = 46 + int(14 * hash01(row, brick)) + rng.randint(-4, 4)
            col = (base - 16, base - 16, base - 12) if mortar else (base, base, base + 6)
            cv.set(x, y, col)
    # kite shield
    shield = [(64, 108), (30, 58), (30, 18), (98, 18), (98, 58)]
    cv.polygon([(p[0], p[1] + 2) for p in shield], (20, 14, 10))
    cv.polygon(shield, (214, 170, 60))
    inner = [(64, 102), (35, 57), (35, 23), (93, 23), (93, 57)]
    cv.polygon(inner, field)
    for y in range(23, 104):
        for x in range(35, 64):
            if cv.get(x, y)[:3] == field:
                cv.set(x, y, shade(field, 0.82))
    # crossed weapons over the shield
    cv.paste(left, 16, 18, scale=3)
    flipped = Canvas(32, 32)
    for y in range(32):
        for x in range(32):
            flipped.set(31 - x, y, right.get(x, y))
    cv.paste(flipped, 16, 18, scale=3)
    draw_text(cv, "MEDIEVAL", 64 - 47, 110, 2, (240, 214, 130))
    draw_text(cv, label, 104, 4, 2, (240, 214, 130))
    return cv


# ===========================================================================
# 6. Item definitions (behavior pack)
# ===========================================================================
ITEMS = {
    "knight_longsword": dict(damage=9, durability=1400, slot="sword", cooldown=2.0, tags=["mdv:melee"]),
    "warhammer":        dict(damage=12, durability=1600, slot="sword", cooldown=4.0, tags=["mdv:melee"]),
    "battle_axe":       dict(damage=11, durability=1300, slot="sword", cooldown=3.5, tags=["mdv:melee"]),
    "halberd":          dict(damage=10, durability=1500, slot="sword", cooldown=1.5, tags=["mdv:melee"]),
    "heavy_crossbow":   dict(damage=3, durability=700, slot="crossbow", use=3600, move=0.4, anim="bow", tags=["mdv:ranged"]),
    "dagger":           dict(damage=6, durability=900, slot="sword", cooldown=5.0, tags=["mdv:melee"]),
    "morning_star":     dict(damage=10, durability=1300, slot="sword", cooldown=3.0, tags=["mdv:melee"]),
    "javelin":          dict(damage=7, stack=8, cooldown=0.8, tags=["mdv:throwable"]),
    "fire_pot":         dict(damage=1, stack=16, cooldown=1.0, tags=["mdv:throwable"]),
    # 내구도 없음(부서지지 않음), 마법부여 가능, 반짝임, 에픽 등급
    "primordial_blade": dict(damage=16, slot="sword", cooldown=10.0, glint=True, rarity="epic", tags=["mdv:melee"]),
}

MISC_ITEMS = {
    "crossbow_bolt":  dict(stack=64),
    "tempered_steel": dict(stack=64),
    "stamina_tonic":  dict(stack=16, use=1.2, move=0.5, anim="drink"),
    "valor_medal":    dict(stack=16, use=1.5, move=0.3, glint=True),
    "war_horn":       dict(stack=1, cooldown=60.0),
    "knights_codex":  dict(stack=1),
}


def item_json(name, spec, weapon):
    comps = {
        "minecraft:icon": {"textures": {"default": f"{NS}_{name}"}},
        "minecraft:display_name": {"value": f"item.{NS}:{name}.name"},
        "minecraft:max_stack_size": spec.get("stack", 1),
        "minecraft:tags": {"tags": ([f"{NS}:weapon"] + spec["tags"]) if weapon else [f"{NS}:item"]},
    }
    if weapon:
        comps["minecraft:hand_equipped"] = True
        comps["minecraft:damage"] = {"value": spec["damage"]}
        if "durability" in spec:
            comps["minecraft:durability"] = {"max_durability": spec["durability"]}
        if "slot" in spec:
            comps["minecraft:enchantable"] = {"slot": spec["slot"], "value": 14}
        if "durability" in spec:
            comps["minecraft:repairable"] = {"repair_items": [
                {"items": [f"{NS}:tempered_steel"], "repair_amount": spec["durability"] // 4}
            ]}
    if spec.get("cooldown"):
        comps["minecraft:cooldown"] = {"category": f"{NS}:{name}", "duration": spec["cooldown"]}
    if spec.get("use"):
        comps["minecraft:use_modifiers"] = {"use_duration": spec["use"], "movement_modifier": spec.get("move", 1.0)}
    if spec.get("anim"):
        comps["minecraft:use_animation"] = spec["anim"]
    if spec.get("glint"):
        comps["minecraft:glint"] = True
    if spec.get("rarity"):
        comps["minecraft:rarity"] = spec["rarity"]
    return {
        "format_version": "1.21.90",
        "minecraft:item": {
            "description": {
                "identifier": f"{NS}:{name}",
                "menu_category": {"category": "equipment" if weapon else "items"},
            },
            "components": comps,
        },
    }


# ===========================================================================
# main
# ===========================================================================
def main():
    item_textures = {}
    icons = {}

    # --- weapons ------------------------------------------------------------
    styles = set()
    for i, (name, (cubes, hold, view)) in enumerate(M.WEAPONS.items()):
        geo, tex = build_model(name, cubes, bound=True, seed=100 + i)
        dump(geo, RP, "models", "entity", NS, f"{name}.geo.json")
        tex.save(path(RP, "textures", "models", NS, f"{name}.png"))

        icon = render_icon(cubes, view)
        icon.save(path(RP, "textures", "items", NS, f"{name}.png"))
        icons[name] = icon
        item_textures[f"{NS}_{name}"] = {"textures": f"textures/items/{NS}/{name}"}

        styles.add(hold)
        attach = {
            "format_version": "1.10.0",
            "minecraft:attachable": {
                "description": {
                    "identifier": f"{NS}:{name}",
                    "materials": {"default": "entity_emissive_alpha", "enchanted": "entity_alphatest_glint"},
                    "textures": {"default": f"textures/models/{NS}/{name}",
                                 "enchanted": "textures/misc/enchanted_item_glint"},
                    "geometry": {"default": f"geometry.{NS}.{name}"},
                    "animations": {
                        "first_person": f"animation.{NS}.hold.{hold}.first_person",
                        "third_person": f"animation.{NS}.hold.{hold}.third_person",
                    },
                    "scripts": {"animate": [
                        {"first_person": "c.is_first_person"},
                        {"third_person": "!c.is_first_person"},
                    ]},
                    "render_controllers": [f"controller.render.{NS}_default"],
                }
            },
        }
        dump(attach, RP, "attachables", f"{name}.json")
        dump(item_json(name, ITEMS[name], True), BP, "items", f"{name}.json")

    anims = {"format_version": "1.8.0", "animations": {}}
    for style in sorted(styles):
        tp, fp = M.HOLD[style]
        for view, (r, p, s) in (("third_person", tp), ("first_person", fp)):
            anims["animations"][f"animation.{NS}.hold.{style}.{view}"] = {
                "loop": True,
                "bones": {"weapon": {"rotation": r, "position": p, "scale": s}},
            }
    dump(anims, RP, "animations", f"{NS}_hold.animation.json")

    # --- projectiles --------------------------------------------------------
    for i, (name, cubes) in enumerate(M.PROJECTILES.items()):
        geo, tex = build_model(name, cubes, bound=False, seed=500 + i)
        dump(geo, RP, "models", "entity", NS, f"{name}.geo.json")
        tex.save(path(RP, "textures", "entity", NS, f"{name}.png"))

    # --- misc icons ----------------------------------------------------------
    for name, fn in (("crossbow_bolt", icon_crossbow_bolt), ("tempered_steel", icon_tempered_steel),
                     ("stamina_tonic", icon_stamina_tonic), ("valor_medal", icon_valor_medal),
                     ("war_horn", icon_war_horn), ("knights_codex", icon_knights_codex)):
        fn().save(path(RP, "textures", "items", NS, f"{name}.png"))
        item_textures[f"{NS}_{name}"] = {"textures": f"textures/items/{NS}/{name}"}
        dump(item_json(name, MISC_ITEMS[name], False), BP, "items", f"{name}.json")

    dump({"resource_pack_name": "medieval_arsenal", "texture_name": "atlas.items", "texture_data": item_textures},
         RP, "textures", "item_texture.json")

    # --- particles / pack icons ---------------------------------------------
    particle_atlas().save(path(RP, "textures", "particle", f"{NS}_fx.png"))
    magic_circle().save(path(RP, "textures", "particle", f"{NS}_circle.png"))
    pack_icon(icons["knight_longsword"], icons["battle_axe"], (150, 32, 36), "RP").save(path(RP, "pack_icon.png"))
    pack_icon(icons["halberd"], icons["warhammer"], (40, 62, 140), "BP").save(path(BP, "pack_icon.png"))

    # --- sounds --------------------------------------------------------------
    snd_dir = os.path.join(RP, "sounds", NS)
    os.makedirs(snd_dir, exist_ok=True)
    sounds.generate(snd_dir)

    print("assets generated:", len(M.WEAPONS), "weapons,", len(M.PROJECTILES), "projectiles,",
          len(MISC_ITEMS), "misc items,", len(sounds.SOUNDS), "sounds")


if __name__ == "__main__":
    main()
