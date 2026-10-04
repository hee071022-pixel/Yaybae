#!/usr/bin/env python3
"""마법진 보스 5종 -> Blockbench(.bbmodel) 파일 생성기 (애니메이션 포함).

    python3 tools/bosses.py        ->  bosses/*.bbmodel, bosses/preview/*.png

각 보스는 뼈대(bone) 목록 + 애니메이션으로 정의한다.
좌표는 Blockbench 픽셀 단위(16 = 1블록), 발바닥 y=0, 앞쪽이 -Z(north), 오른손이 -X.
회전은 Blockbench 값 그대로(도): +X 는 팔을 앞으로 들어 올리고 얼굴을 위로 젖힌다.
마법진은 두께 0인 판(cube)에 마법진 무늬를 칠해서 만든다.
텍스처는 무기 생성기(generate_assets)의 재질 음영/박스 UV 배치를 그대로 쓴다.
"""
import base64
import json
import math
import os
import random
import sys
import tempfile
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import generate_assets as GA  # noqa: E402
import models as M  # noqa: E402
from pngkit import Canvas, lerp_c, shade  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "bosses")

# ---------------------------------------------------------------------------
# 재질 추가 (이름, 기본색, 발광 여부)
# ---------------------------------------------------------------------------
M.MATERIALS.update({
    "rune_stone": ((92, 98, 116), False),
    "dark_stone": ((52, 54, 66), False),
    "rune_glow":  ((80, 230, 255), True),
    "arcane":     ((230, 90, 255), True),
    "robe":       ((44, 30, 82), False),
    "robe_dark":  ((24, 18, 44), False),
    "bone":       ((222, 214, 190), False),
    "eye_white":  ((236, 232, 224), False),
    "iris":       ((255, 196, 60), True),
    "pupil":      ((12, 8, 20), False),
    "crystal":    ((140, 210, 255), True),
    "armor":      ((60, 66, 96), False),
    "light":      ((255, 250, 220), True),
})
# 마법진 판: 큰 면에 마법진 무늬, (색, 투명도)
CIRCLE_COLORS = {
    "circle_violet": (200, 150, 255),
    "circle_gold":   (255, 220, 130),
    "circle_cyan":   (110, 235, 255),
}
for k, c in CIRCLE_COLORS.items():
    M.MATERIALS[k] = (c, True)

_base_material = GA.material_color


def material_color(mat, a, b, blen, seed, rng):
    if mat in ("rune_stone", "dark_stone"):
        base = M.MATERIALS[mat][0]
        c = shade(base, 0.86 + 0.24 * GA.hash01(seed, a // 2, b // 2))
        if GA.hash01(seed, a, b) > 0.93:
            c = shade(c, 0.7)  # 금
        return c, False
    if mat in ("robe", "robe_dark"):
        base = M.MATERIALS[mat][0]
        return shade(base, 0.82 if (a + 2 * b) % 5 == 0 else 1.0 + 0.08 * GA.hash01(seed, b)), False
    if mat == "bone":
        return shade(M.MATERIALS[mat][0], 0.9 + 0.14 * rng.random()), False
    if mat == "armor":
        c = shade(M.MATERIALS[mat][0], 0.95 + 0.1 * GA.hash01(seed, a))
        if b == 0 or b == blen - 1:
            c = lerp_c(c, (150, 160, 210), 0.35)
        return c, False
    if mat in ("eye_white", "pupil"):
        return shade(M.MATERIALS[mat][0], 0.95 + 0.06 * rng.random()), False
    return _base_material(mat, a, b, blen, seed, rng)


GA.material_color = material_color

_CIRCLE_SRC = GA.magic_circle(128)
_base_paint = GA.paint_face


def paint_face(cv, rect, mat, face, seed, rng):
    if mat not in CIRCLE_COLORS:
        _base_paint(cv, rect, mat, face, seed, rng)
        # 무기 팩은 발광 텍셀을 알파 36으로 표시하지만(emissive 재질용),
        # 블록벤치/일반 엔티티에서는 반투명 회색으로 보이므로 불투명하게 칠한다
        if M.MATERIALS[mat][1]:
            x0, y0, w, h = rect
            for yy in range(y0, y0 + h):
                for xx in range(x0, x0 + w):
                    r, g, b, a = cv.get(xx, yy)
                    if a == GA.GLOW_ALPHA:
                        cv.set(xx, yy, (r, g, b, 255))
        return
    x0, y0, w, h = rect
    if w < 6 or h < 6:
        return  # 판의 옆면은 투명
    col = CIRCLE_COLORS[mat]
    for yy in range(h):
        for xx in range(w):
            sx = int((xx + 0.5) / w * 128)
            sy = int((yy + 0.5) / h * 128)
            a = _CIRCLE_SRC.get(sx, sy)[3]
            if a > 30:
                cv.set(x0 + xx, y0 + yy, (*lerp_c(col, (255, 255, 255), 0.35 * a / 255), min(255, a + 40)))


GA.paint_face = paint_face


# ---------------------------------------------------------------------------
# 모델 정의 도우미
# ---------------------------------------------------------------------------
def box(origin, size, mat, rot=None, pivot=None):
    return M.box(origin, size, mat, rot, pivot)


def bone(name, pivot, cubes=(), parent=None, rot=None):
    return {"name": name, "pivot": list(pivot), "cubes": list(cubes), "parent": parent, "rot": rot}


def mirror(cubes):
    """X축 대칭 복사 (왼쪽 <-> 오른쪽)."""
    out = []
    for c in cubes:
        o, s = c["origin"], c["size"]
        out.append(box([-o[0] - s[0], o[1], o[2]], s, c["mat"]))
    return out


def ring_of(radius, y, n, size, mat, phase=0.0):
    """원형으로 늘어선 작은 큐브들 (떠다니는 파편/룬석)."""
    out = []
    for k in range(n):
        a = phase + k * 2 * math.pi / n
        cx, cz = radius * math.cos(a), radius * math.sin(a)
        out.append(box([round(cx - size / 2, 2), y, round(cz - size / 2, 2)], [size, size, size], mat))
    return out


# ---------------------------------------------------------------------------
# 애니메이션 도우미: {뼈: {채널: [(시간, [x,y,z]), ...]}}
# ---------------------------------------------------------------------------
def anim(name, length, loop, **bones):
    return {"name": name, "length": length, "loop": loop, "bones": bones}


def ch(*frames):
    return list(frames)


def bob(amp, length, n=4):
    return [(length * k / n, [0, round(amp * math.sin(2 * math.pi * k / n), 3), 0]) for k in range(n + 1)]


def sway(axis, amp, length, n=4, offset=0.0):
    out = []
    for k in range(n + 1):
        v = [0, 0, 0]
        v[axis] = round(amp * math.sin(2 * math.pi * k / n + offset), 3)
        out.append((length * k / n, v))
    return out


def spin(axis, length, turns=1, n=4):
    out = []
    for k in range(n + 1):
        v = [0, 0, 0]
        v[axis] = round(360 * turns * k / n, 3)
        out.append((length * k / n, v))
    return out


# ===========================================================================
# 1. 마법진 수호자 (Circle Warden)
# ===========================================================================
def circle_warden():
    bones = [
        bone("root", [0, 0, 0]),
        bone("body", [0, 20, 0], parent="root", cubes=[
            box([-4, 8, -3], [8, 12, 6], "armor"),            # 허리 아래 (떠 있는 하체)
            box([-3, 2, -2], [6, 6, 4], "armor"),
            box([-2, -2, -1], [4, 4, 2], "rune_glow"),        # 아래로 흐르는 빛
            box([-7, 20, -4], [14, 14, 8], "armor"),          # 흉갑
            box([-2, 25, -5], [4, 4, 1], "rune_glow"),        # 가슴 룬
            box([-7.5, 33, -4.5], [15, 2, 9], "gold"),        # 목 장식
        ]),
        bone("head", [0, 35, 0], parent="body", cubes=[
            box([-4, 35, -4], [8, 9, 8], "armor"),
            box([-3, 39, -5], [6, 1, 1], "rune_glow"),        # 눈 틈
            box([-1, 44, -1], [2, 4, 2], "gold"),             # 볏
            box([-4.5, 41, -4.5], [9, 1, 9], "gold"),
        ]),
        bone("right_arm", [-8, 32, 0], parent="body", cubes=[
            box([-12, 29, -3], [5, 5, 6], "gold"),            # 어깨
            box([-11, 17, -2], [4, 12, 4], "armor"),
            box([-11.5, 13, -2.5], [5, 5, 5], "dark_iron"),   # 건틀릿
            box([-11, 15, -3], [4, 1, 1], "rune_glow"),
        ]),
        bone("left_arm", [8, 32, 0], parent="body", cubes=mirror([
            box([-12, 29, -3], [5, 5, 6], "gold"),
            box([-11, 17, -2], [4, 12, 4], "armor"),
            box([-11.5, 13, -2.5], [5, 5, 5], "dark_iron"),
        ])),
        bone("left_shield", [13, 18, 0], parent="left_arm", cubes=[
            box([13, 8, -10], [0, 20, 20], "circle_cyan"),    # 팔에 붙은 방패 마법진
        ]),
        bone("halo", [0, 30, 8], parent="body", cubes=[
            box([-20, 10, 8], [40, 40, 0], "circle_violet"),  # 등 뒤 마법진
        ]),
        bone("halo_inner", [0, 30, 9], parent="body", cubes=[
            box([-11, 19, 9], [22, 22, 0], "circle_gold"),
        ]),
        bone("ground_circle", [0, 0.2, 0], parent="root", cubes=[
            box([-24, 0.2, -24], [48, 0, 48], "circle_violet"),
        ]),
    ]
    L = 3.0
    anims = [
        anim("idle", L, "loop",
             body={"position": bob(1.2, L)},
             head={"rotation": sway(1, 6, L)},
             right_arm={"rotation": sway(0, 3, L)},
             left_arm={"rotation": sway(0, -3, L)},
             halo={"rotation": spin(2, L, 0.25)},
             halo_inner={"rotation": spin(2, L, -0.5)},
             ground_circle={"scale": ch((0, [0, 0, 0]))}),
        anim("move", 1.5, "loop",
             body={"rotation": ch((0, [12, 0, 0])), "position": bob(0.8, 1.5)},
             right_arm={"rotation": sway(0, 14, 1.5)},
             left_arm={"rotation": sway(0, -14, 1.5)},
             halo={"rotation": spin(2, 1.5, 0.5)},
             ground_circle={"scale": ch((0, [0, 0, 0]))}),
        anim("attack", 1.0, "once",
             body={"rotation": ch((0, [0, 0, 0]), (0.3, [0, 25, 0]), (0.45, [8, -20, 0]), (1.0, [0, 0, 0]))},
             right_arm={"rotation": ch((0, [0, 0, 0]), (0.3, [40, 0, 20]), (0.45, [95, 0, -5]), (0.7, [95, 0, -5]), (1.0, [0, 0, 0]))},
             halo={"rotation": spin(2, 1.0, 1), "scale": ch((0, [1, 1, 1]), (0.45, [1.3, 1.3, 1]), (1.0, [1, 1, 1]))},
             ground_circle={"scale": ch((0, [0, 0, 0]))}),
        anim("cast_circle", 2.5, "once",
             body={"position": ch((0, [0, 0, 0]), (0.6, [0, 6, 0]), (2.0, [0, 6, 0]), (2.5, [0, 0, 0]))},
             right_arm={"rotation": ch((0, [0, 0, 0]), (0.6, [20, 0, 80]), (2.0, [20, 0, 80]), (2.5, [0, 0, 0]))},
             left_arm={"rotation": ch((0, [0, 0, 0]), (0.6, [20, 0, -80]), (2.0, [20, 0, -80]), (2.5, [0, 0, 0]))},
             halo={"rotation": spin(2, 2.5, 3, 8)},
             halo_inner={"rotation": spin(2, 2.5, -4, 8)},
             ground_circle={"scale": ch((0, [0, 0, 0]), (0.6, [1, 1, 1]), (2.0, [1.15, 1, 1.15]), (2.5, [0, 0, 0])),
                            "rotation": spin(1, 2.5, 1, 4)}),
        anim("death", 2.0, "hold",
             root={"rotation": ch((0, [0, 0, 0]), (1.2, [-15, 0, 0]), (2.0, [-80, 0, 0])),
                   "position": ch((0, [0, 0, 0]), (2.0, [0, -2, 6]))},
             halo={"position": ch((0, [0, 0, 0]), (1.5, [0, -26, 0])), "rotation": ch((0, [0, 0, 0]), (1.5, [70, 0, 30]))},
             head={"rotation": ch((0, [0, 0, 0]), (1.0, [-25, 0, 10]))},
             right_arm={"rotation": ch((0, [0, 0, 0]), (1.2, [-20, 0, 25]))},
             left_arm={"rotation": ch((0, [0, 0, 0]), (1.2, [-20, 0, -25]))},
             ground_circle={"scale": ch((0, [0, 0, 0]))}),
    ]
    return "circle_warden", "마법진 수호자", bones, anims


# ===========================================================================
# 2. 룬 골렘 (Rune Golem)
# ===========================================================================
def rune_golem():
    rune = "rune_glow"
    bones = [
        bone("root", [0, 0, 0]),
        bone("body", [0, 20, 0], parent="root", cubes=[
            box([-10, 20, -6], [20, 18, 12], "rune_stone"),
            box([-8, 16, -5], [16, 4, 10], "dark_stone"),
            box([-11, 34, -7], [22, 6, 14], "dark_stone"),   # 어깨 바위
            box([-6, 24, -6.5], [1, 8, 1], rune),            # 룬 줄
            box([5, 24, -6.5], [1, 8, 1], rune),
            box([-3, 37, -7.5], [6, 1, 1], rune),
        ]),
        bone("chest_circle", [0, 29, -6.6], parent="body", cubes=[
            box([-7, 22, -6.6], [14, 14, 0], "circle_cyan"),
        ]),
        bone("head", [0, 38, -2], parent="body", cubes=[
            box([-4, 38, -7], [8, 7, 8], "rune_stone"),
            box([-3, 41, -7.5], [2, 1, 1], rune),
            box([1, 41, -7.5], [2, 1, 1], rune),
            box([-5, 44, -6], [10, 2, 6], "dark_stone"),
        ]),
        bone("right_arm", [-12, 36, 0], parent="body", cubes=[
            box([-17, 30, -4], [7, 8, 8], "dark_stone"),
            box([-16, 14, -3.5], [6, 16, 7], "rune_stone"),
            box([-17, 4, -4.5], [8, 10, 9], "dark_stone"),   # 주먹
            box([-14, 22, -4], [1, 6, 1], rune),
        ]),
        bone("right_palm", [-13, 4, 0], parent="right_arm", cubes=[
            box([-19, 3.9, -6], [12, 0, 12], "circle_cyan"),
        ]),
        bone("left_arm", [12, 36, 0], parent="body", cubes=mirror([
            box([-17, 30, -4], [7, 8, 8], "dark_stone"),
            box([-16, 14, -3.5], [6, 16, 7], "rune_stone"),
            box([-17, 4, -4.5], [8, 10, 9], "dark_stone"),
            box([-14, 22, -4], [1, 6, 1], rune),
        ])),
        bone("left_palm", [13, 4, 0], parent="left_arm", cubes=[
            box([7, 3.9, -6], [12, 0, 12], "circle_cyan"),
        ]),
        bone("right_leg", [-5, 16, 0], parent="root", cubes=[
            box([-9, 0, -4], [8, 16, 8], "rune_stone"),
            box([-9.5, 0, -5], [9, 3, 9], "dark_stone"),
        ]),
        bone("left_leg", [5, 16, 0], parent="root", cubes=[
            box([1, 0, -4], [8, 16, 8], "rune_stone"),
            box([0.5, 0, -5], [9, 3, 9], "dark_stone"),
        ]),
        bone("runestones", [0, 30, 0], parent="root", cubes=ring_of(18, 30, 4, 3, "crystal")),
    ]
    anims = [
        anim("idle", 3.0, "loop",
             body={"position": bob(0.5, 3.0)},
             right_arm={"rotation": sway(2, 2, 3.0)},
             left_arm={"rotation": sway(2, -2, 3.0)},
             chest_circle={"rotation": spin(2, 3.0, 0.25)},
             runestones={"rotation": spin(1, 3.0, 0.5), "position": bob(1.5, 3.0)}),
        anim("walk", 1.6, "loop",
             right_leg={"rotation": sway(0, 22, 1.6)},
             left_leg={"rotation": sway(0, -22, 1.6)},
             right_arm={"rotation": sway(0, -14, 1.6)},
             left_arm={"rotation": sway(0, 14, 1.6)},
             body={"position": ch((0, [0, 0, 0]), (0.4, [0, -1, 0]), (0.8, [0, 0, 0]), (1.2, [0, -1, 0]), (1.6, [0, 0, 0])),
                   "rotation": sway(1, 4, 1.6)},
             runestones={"rotation": spin(1, 1.6, 0.5)}),
        anim("smash", 1.6, "once",
             body={"rotation": ch((0, [0, 0, 0]), (0.6, [-14, 0, 0]), (0.85, [22, 0, 0]), (1.6, [0, 0, 0]))},
             right_arm={"rotation": ch((0, [0, 0, 0]), (0.6, [165, 0, -10]), (0.85, [60, 0, 0]), (1.6, [0, 0, 0]))},
             left_arm={"rotation": ch((0, [0, 0, 0]), (0.6, [165, 0, 10]), (0.85, [60, 0, 0]), (1.6, [0, 0, 0]))},
             right_palm={"scale": ch((0, [1, 1, 1]), (0.85, [2.2, 1, 2.2]), (1.2, [1, 1, 1]))},
             left_palm={"scale": ch((0, [1, 1, 1]), (0.85, [2.2, 1, 2.2]), (1.2, [1, 1, 1]))}),
        anim("rune_burst", 2.0, "once",
             body={"rotation": ch((0, [0, 0, 0]), (0.5, [-10, 0, 0]), (1.6, [-10, 0, 0]), (2.0, [0, 0, 0]))},
             right_arm={"rotation": ch((0, [0, 0, 0]), (0.5, [0, 0, 60]), (1.6, [0, 0, 60]), (2.0, [0, 0, 0]))},
             left_arm={"rotation": ch((0, [0, 0, 0]), (0.5, [0, 0, -60]), (1.6, [0, 0, -60]), (2.0, [0, 0, 0]))},
             chest_circle={"rotation": spin(2, 2.0, 3, 8),
                           "scale": ch((0, [1, 1, 1]), (0.5, [2.4, 2.4, 1]), (1.6, [2.6, 2.6, 1]), (2.0, [1, 1, 1]))},
             runestones={"rotation": spin(1, 2.0, 3, 8),
                         "scale": ch((0, [1, 1, 1]), (0.5, [1.6, 1, 1.6]), (2.0, [1, 1, 1]))}),
        anim("death", 2.2, "hold",
             body={"rotation": ch((0, [0, 0, 0]), (1.0, [12, 0, 6]), (2.2, [35, 0, 10])),
                   "position": ch((0, [0, 0, 0]), (2.2, [0, -12, -4]))},
             head={"position": ch((0, [0, 0, 0]), (0.8, [0, 2, 0]), (1.8, [4, -30, -10])),
                   "rotation": ch((0, [0, 0, 0]), (1.8, [50, 30, 0]))},
             right_arm={"position": ch((0, [0, 0, 0]), (1.6, [-6, -22, 0])), "rotation": ch((0, [0, 0, 0]), (1.6, [0, 0, -70]))},
             left_arm={"position": ch((0, [0, 0, 0]), (1.7, [6, -22, 0])), "rotation": ch((0, [0, 0, 0]), (1.7, [0, 0, 70]))},
             chest_circle={"scale": ch((0, [1, 1, 1]), (0.6, [0, 0, 0]))},
             runestones={"position": ch((0, [0, 0, 0]), (1.2, [0, -28, 0]))}),
    ]
    return "rune_golem", "룬 골렘", bones, anims


# ===========================================================================
# 3. 심연의 대마법사 (Abyss Archmage)
# ===========================================================================
def abyss_archmage():
    bones = [
        bone("root", [0, 0, 0]),
        bone("body", [0, 22, 0], parent="root", cubes=[
            box([-5, 6, -4], [10, 16, 8], "robe"),            # 로브 자락
            box([-6, 6, -5], [12, 4, 10], "robe_dark"),
            box([-5, 22, -3], [10, 12, 6], "robe"),           # 상체
            box([-1, 22, -3.5], [2, 12, 1], "gold"),          # 앞 장식
            box([-6, 32, -4], [12, 3, 8], "robe_dark"),       # 망토 깃
        ]),
        bone("head", [0, 34, 0], parent="body", cubes=[
            box([-4, 34, -4], [8, 8, 8], "robe_dark"),        # 두건
            box([-3, 35, -4.5], [6, 6, 1], "pupil"),          # 그림자 진 얼굴
            box([-2, 38, -5], [1, 1, 1], "arcane"),           # 눈
            box([1, 38, -5], [1, 1, 1], "arcane"),
            box([-1, 42, -1], [2, 3, 3], "robe_dark"),        # 두건 끝
        ]),
        bone("right_arm", [-6, 32, 0], parent="body", cubes=[
            box([-9, 20, -2], [4, 13, 4], "robe"),
            box([-9.5, 19, -2.5], [5, 3, 5], "robe_dark"),
            box([-8.5, 17, -1.5], [3, 2, 3], "bone"),         # 손
        ]),
        bone("staff", [-7, 18, 0], parent="right_arm", cubes=[
            box([-8, 0, -1], [2, 36, 2], "dark_wood"),
            box([-9, 34, -2], [4, 2, 4], "gold"),
            box([-9.5, 36, -2.5], [5, 5, 5], "arcane"),       # 오브
            box([-10, 35.5, -0.5], [6, 0, 1], "gold"),
        ]),
        bone("left_arm", [6, 32, 0], parent="body", cubes=mirror([
            box([-9, 20, -2], [4, 13, 4], "robe"),
            box([-9.5, 19, -2.5], [5, 3, 5], "robe_dark"),
            box([-8.5, 17, -1.5], [3, 2, 3], "bone"),
        ])),
        bone("hand_circle", [8, 16, -6], parent="left_arm", cubes=[
            box([2, 10, -6], [12, 12, 0], "circle_violet"),
        ]),
        bone("tomes", [0, 26, 0], parent="root", cubes=ring_of(14, 26, 3, 4, "cloth_red") + ring_of(14, 30, 3, 2, "arcane", 0.4)),
        bone("ground_circle", [0, 0.2, 0], parent="root", cubes=[
            box([-20, 0.2, -20], [40, 0, 40], "circle_violet"),
        ]),
        bone("ground_circle_inner", [0, 0.3, 0], parent="root", cubes=[
            box([-11, 0.3, -11], [22, 0, 22], "circle_gold"),
        ]),
    ]
    anims = [
        anim("idle", 3.0, "loop",
             body={"position": bob(1.5, 3.0)},
             head={"rotation": sway(1, 8, 3.0)},
             staff={"rotation": sway(2, 3, 3.0)},
             tomes={"rotation": spin(1, 3.0, 0.5), "position": bob(1.5, 3.0)},
             ground_circle={"rotation": spin(1, 3.0, 0.25)},
             ground_circle_inner={"rotation": spin(1, 3.0, -0.5)},
             hand_circle={"scale": ch((0, [0, 0, 0]))}),
        anim("move", 1.5, "loop",
             body={"rotation": ch((0, [10, 0, 0])), "position": bob(1, 1.5)},
             right_arm={"rotation": ch((0, [-10, 0, 0]))},
             tomes={"rotation": spin(1, 1.5, 0.5)},
             ground_circle={"rotation": spin(1, 1.5, 0.25)},
             hand_circle={"scale": ch((0, [0, 0, 0]))}),
        anim("cast", 1.8, "once",
             right_arm={"rotation": ch((0, [0, 0, 0]), (0.5, [150, 0, 0]), (1.3, [150, 0, 0]), (1.8, [0, 0, 0]))},
             left_arm={"rotation": ch((0, [0, 0, 0]), (0.5, [80, 0, 0]), (1.3, [80, 0, 0]), (1.8, [0, 0, 0]))},
             hand_circle={"scale": ch((0, [0, 0, 0]), (0.5, [1, 1, 1]), (1.3, [1.4, 1.4, 1]), (1.8, [0, 0, 0])),
                          "rotation": spin(2, 1.8, 2, 8)},
             ground_circle={"rotation": spin(1, 1.8, 2, 8)},
             ground_circle_inner={"rotation": spin(1, 1.8, -3, 8)},
             tomes={"rotation": spin(1, 1.8, 2, 8)}),
        anim("summon", 2.4, "once",
             body={"position": ch((0, [0, 0, 0]), (0.6, [0, 8, 0]), (1.9, [0, 8, 0]), (2.4, [0, 0, 0]))},
             right_arm={"rotation": ch((0, [0, 0, 0]), (0.6, [170, 0, 20]), (1.9, [170, 0, 20]), (2.4, [0, 0, 0]))},
             left_arm={"rotation": ch((0, [0, 0, 0]), (0.6, [170, 0, -20]), (1.9, [170, 0, -20]), (2.4, [0, 0, 0]))},
             tomes={"rotation": spin(1, 2.4, 4, 8), "scale": ch((0, [1, 1, 1]), (0.6, [1.8, 1, 1.8]), (2.4, [1, 1, 1]))},
             ground_circle={"scale": ch((0, [1, 1, 1]), (0.6, [1.6, 1, 1.6]), (1.9, [1.6, 1, 1.6]), (2.4, [1, 1, 1])),
                            "rotation": spin(1, 2.4, 2, 8)},
             hand_circle={"scale": ch((0, [0, 0, 0]))}),
        anim("death", 2.4, "hold",
             body={"position": ch((0, [0, 0, 0]), (2.4, [0, -14, 0])),
                   "scale": ch((0, [1, 1, 1]), (1.6, [1, 1, 1]), (2.4, [0.2, 0.2, 0.2]))},
             head={"rotation": ch((0, [0, 0, 0]), (1.0, [-30, 0, 0]))},
             staff={"position": ch((0, [0, 0, 0]), (1.2, [-4, -18, 0])), "rotation": ch((0, [0, 0, 0]), (1.2, [0, 0, 80]))},
             tomes={"position": ch((0, [0, 0, 0]), (1.0, [0, -24, 0]))},
             ground_circle={"scale": ch((0, [1, 1, 1]), (2.4, [0, 1, 0]))},
             ground_circle_inner={"scale": ch((0, [1, 1, 1]), (1.8, [0, 1, 0]))},
             hand_circle={"scale": ch((0, [0, 0, 0]))}),
    ]
    return "abyss_archmage", "심연의 대마법사", bones, anims


# ===========================================================================
# 4. 별의 눈 (Astral Eye)
# ===========================================================================
def astral_eye():
    bones = [
        bone("root", [0, 0, 0]),
        bone("eye", [0, 30, 0], parent="root", cubes=[
            box([-9, 21, -9], [18, 18, 18], "eye_white"),
            box([-10, 26, -7], [1, 8, 14], "robe"),           # 핏줄 같은 테
            box([9, 26, -7], [1, 8, 14], "robe"),
        ]),
        bone("iris", [0, 30, -9], parent="eye", cubes=[
            box([-5, 25, -10], [10, 10, 1], "iris"),
        ]),
        bone("pupil", [0, 30, -10], parent="iris", cubes=[
            box([-2, 27, -11], [4, 6, 1], "pupil"),
        ]),
        bone("lid_top", [0, 39, 0], parent="eye", cubes=[
            box([-9.5, 37, -9.5], [19, 3, 19], "dark_stone"),
        ]),
        bone("lid_bottom", [0, 21, 0], parent="eye", cubes=[
            box([-9.5, 20, -9.5], [19, 3, 19], "dark_stone"),
        ]),
        bone("ring_x", [0, 30, 0], parent="root", cubes=[
            box([0, 12, -18], [0, 36, 36], "circle_violet"),  # YZ 평면
        ]),
        bone("ring_y", [0, 30, 0], parent="root", cubes=[
            box([-20, 30, -20], [40, 0, 40], "circle_gold"),  # XZ 평면
        ]),
        bone("ring_z", [0, 30, 0], parent="root", cubes=[
            box([-16, 14, 0], [32, 32, 0], "circle_cyan"),    # XY 평면
        ]),
        bone("shards", [0, 30, 0], parent="root", cubes=ring_of(24, 28, 6, 3, "crystal") + ring_of(20, 36, 3, 2, "crystal", 0.5)),
    ]
    anims = [
        anim("idle", 4.0, "loop",
             eye={"position": bob(2, 4.0)},
             iris={"position": ch((0, [0, 0, 0]), (1.0, [2, 1, 0]), (2.0, [0, -1, 0]), (3.0, [-2, 1, 0]), (4.0, [0, 0, 0]))},
             lid_top={"position": ch((0, [0, 0, 0]), (3.4, [0, 0, 0]), (3.55, [0, -8, 0]), (3.7, [0, 0, 0]), (4.0, [0, 0, 0]))},
             lid_bottom={"position": ch((0, [0, 0, 0]), (3.4, [0, 0, 0]), (3.55, [0, 8, 0]), (3.7, [0, 0, 0]), (4.0, [0, 0, 0]))},
             ring_x={"rotation": spin(0, 4.0, 1)},
             ring_y={"rotation": spin(1, 4.0, -1)},
             ring_z={"rotation": spin(2, 4.0, 0.5)},
             shards={"rotation": spin(1, 4.0, 0.5), "position": bob(1.5, 4.0)}),
        anim("stare", 1.5, "loop",
             eye={"rotation": sway(1, 10, 1.5)},
             pupil={"scale": ch((0, [1, 1, 1]), (0.75, [0.5, 1.4, 1]), (1.5, [1, 1, 1]))},
             ring_x={"rotation": spin(0, 1.5, 1)},
             ring_y={"rotation": spin(1, 1.5, -1)},
             ring_z={"rotation": spin(2, 1.5, 1)}),
        anim("beam", 2.4, "once",
             eye={"position": ch((0, [0, 0, 0]), (0.6, [0, 0, 6]), (0.8, [0, 0, -4]), (2.0, [0, 0, -4]), (2.4, [0, 0, 0]))},
             lid_top={"position": ch((0, [0, 0, 0]), (0.6, [0, 2, 0]), (2.0, [0, 2, 0]), (2.4, [0, 0, 0]))},
             lid_bottom={"position": ch((0, [0, 0, 0]), (0.6, [0, -2, 0]), (2.0, [0, -2, 0]), (2.4, [0, 0, 0]))},
             iris={"scale": ch((0, [1, 1, 1]), (0.8, [1.3, 1.3, 1]), (2.0, [1.3, 1.3, 1]), (2.4, [1, 1, 1]))},
             ring_z={"rotation": spin(2, 2.4, 4, 8),
                     "position": ch((0, [0, 0, 0]), (0.8, [0, 0, -14]), (2.0, [0, 0, -14]), (2.4, [0, 0, 0])),
                     "scale": ch((0, [1, 1, 1]), (0.8, [0.6, 0.6, 1]), (2.0, [0.6, 0.6, 1]), (2.4, [1, 1, 1]))},
             ring_x={"rotation": spin(0, 2.4, 3, 8)},
             ring_y={"rotation": spin(1, 2.4, -3, 8)}),
        anim("death", 2.6, "hold",
             eye={"position": ch((0, [0, 0, 0]), (0.4, [0, 3, 0]), (2.0, [0, -20, 0])),
                  "rotation": ch((0, [0, 0, 0]), (2.0, [40, 0, 25]))},
             lid_top={"position": ch((0, [0, 0, 0]), (1.0, [0, -8, 0]))},
             lid_bottom={"position": ch((0, [0, 0, 0]), (1.0, [0, 8, 0]))},
             ring_x={"position": ch((0, [0, 0, 0]), (1.6, [0, -30, 0])), "rotation": ch((0, [0, 0, 0]), (1.6, [0, 0, 80]))},
             ring_y={"position": ch((0, [0, 0, 0]), (1.8, [0, -29.8, 0]))},
             ring_z={"position": ch((0, [0, 0, 0]), (1.4, [0, -30, 0])), "rotation": ch((0, [0, 0, 0]), (1.4, [85, 0, 0]))},
             shards={"position": ch((0, [0, 0, 0]), (1.2, [0, -28, 0])),
                     "scale": ch((0, [1, 1, 1]), (1.2, [1.4, 1, 1.4]))}),
    ]
    return "astral_eye", "별의 눈", bones, anims


# ===========================================================================
# 5. 태초의 군주 (Primordial Sovereign) - 신초의 검을 든 최종 보스
# ===========================================================================
def sword_in_hand(hand_x, hand_y):
    """무기 생성기의 신초의 검 모델을 손 위치로 옮김 (칼끝 -Z 그대로)."""
    out = []
    for c in M.PRIMORDIAL_BLADE:
        o = c["origin"]
        out.append(box([o[0] + hand_x, o[1] + hand_y, o[2]], c["size"], c["mat"]))
    return out


def primordial_sovereign():
    bones = [
        bone("root", [0, 0, 0]),
        bone("body", [0, 24, 0], parent="root", cubes=[
            box([-6, 24, -3], [12, 14, 6], "abyss"),
            box([-6.5, 30, -3.5], [13, 1, 7], "gold"),
            box([-1, 26, -3.6], [2, 10, 1], "astral"),        # 가슴의 빛
            box([-5, 20, -3], [10, 4, 6], "gold"),            # 허리띠
            box([-6, 10, -4], [12, 10, 8], "robe_dark"),      # 앞자락
        ]),
        bone("head", [0, 38, 0], parent="body", cubes=[
            box([-4, 38, -4], [8, 8, 8], "abyss"),
            box([-3, 42, -4.5], [6, 1, 1], "astral"),         # 눈빛
            box([-4.5, 45, -4.5], [9, 1, 9], "gold"),         # 관
            box([-4.5, 46, -4.5], [1, 3, 1], "starlight"),
            box([3.5, 46, -4.5], [1, 3, 1], "starlight"),
            box([-0.5, 46, -4.5], [1, 4, 1], "starlight"),
        ]),
        bone("crown_circle", [0, 52, 0], parent="head", cubes=[
            box([-9, 52, -9], [18, 0, 18], "circle_gold"),     # 머리 위 후광
        ]),
        bone("right_arm", [-7, 36, 0], parent="body", cubes=[
            box([-11, 33, -3], [5, 5, 6], "gold"),
            box([-10, 23, -2], [4, 11, 4], "abyss"),
            box([-10.5, 21, -2.5], [5, 3, 5], "gold"),
        ]),
        bone("sword", [-8, 22, 0], parent="right_arm", cubes=sword_in_hand(-8, 22)),
        bone("left_arm", [7, 36, 0], parent="body", cubes=mirror([
            box([-11, 33, -3], [5, 5, 6], "gold"),
            box([-10, 23, -2], [4, 11, 4], "abyss"),
            box([-10.5, 21, -2.5], [5, 3, 5], "gold"),
        ])),
        bone("right_wing", [-3, 34, 4], parent="body", cubes=[
            box([-31, 22, 4], [28, 20, 0], "circle_violet"),   # 빛의 날개 (마법진 무늬)
            box([-20, 36, 4], [17, 2, 1], "astral"),
        ]),
        bone("left_wing", [3, 34, 4], parent="body", cubes=[
            box([3, 22, 4], [28, 20, 0], "circle_violet"),
            box([3, 36, 4], [17, 2, 1], "astral"),
        ]),
        bone("right_leg", [-3, 20, 0], parent="root", cubes=[
            box([-5, 0, -2], [4, 20, 4], "abyss"),
            box([-5.5, 0, -3], [5, 3, 5], "gold"),
        ]),
        bone("left_leg", [3, 20, 0], parent="root", cubes=[
            box([1, 0, -2], [4, 20, 4], "abyss"),
            box([0.5, 0, -3], [5, 3, 5], "gold"),
        ]),
        bone("ground_circle", [0, 0.2, 0], parent="root", cubes=[
            box([-32, 0.2, -32], [64, 0, 64], "circle_violet"),
        ]),
        bone("ground_circle_inner", [0, 0.3, 0], parent="root", cubes=[
            box([-17, 0.3, -17], [34, 0, 34], "circle_gold"),
        ]),
    ]
    anims = [
        anim("idle", 3.0, "loop",
             body={"position": bob(0.6, 3.0)},
             right_wing={"rotation": sway(1, -10, 3.0)},
             left_wing={"rotation": sway(1, 10, 3.0)},
             crown_circle={"rotation": spin(1, 3.0, 0.5)},
             sword={"rotation": sway(0, 4, 3.0)},
             ground_circle={"scale": ch((0, [0, 0, 0]))},
             ground_circle_inner={"scale": ch((0, [0, 0, 0]))}),
        anim("walk", 1.4, "loop",
             right_leg={"rotation": sway(0, 25, 1.4)},
             left_leg={"rotation": sway(0, -25, 1.4)},
             left_arm={"rotation": sway(0, 18, 1.4)},
             right_arm={"rotation": sway(0, -8, 1.4)},
             body={"rotation": sway(1, 4, 1.4)},
             right_wing={"rotation": sway(1, -6, 1.4)},
             left_wing={"rotation": sway(1, 6, 1.4)},
             ground_circle={"scale": ch((0, [0, 0, 0]))},
             ground_circle_inner={"scale": ch((0, [0, 0, 0]))}),
        anim("slash", 1.1, "once",
             body={"rotation": ch((0, [0, 0, 0]), (0.35, [0, 35, 0]), (0.55, [6, -30, 0]), (1.1, [0, 0, 0]))},
             right_arm={"rotation": ch((0, [0, 0, 0]), (0.35, [150, 0, 30]), (0.55, [40, 0, -30]), (0.8, [40, 0, -30]), (1.1, [0, 0, 0]))},
             sword={"rotation": ch((0, [0, 0, 0]), (0.35, [-20, 0, 0]), (0.55, [10, 0, 0]), (1.1, [0, 0, 0]))},
             right_wing={"rotation": ch((0, [0, 0, 0]), (0.55, [0, -30, 0]), (1.1, [0, 0, 0]))},
             left_wing={"rotation": ch((0, [0, 0, 0]), (0.55, [0, 30, 0]), (1.1, [0, 0, 0]))},
             ground_circle={"scale": ch((0, [0, 0, 0]))},
             ground_circle_inner={"scale": ch((0, [0, 0, 0]))}),
        anim("primordial_circle", 3.0, "once",
             body={"position": ch((0, [0, 0, 0]), (0.8, [0, 4, 0]), (1.8, [0, 4, 0]), (2.0, [0, -2, 0]), (3.0, [0, 0, 0]))},
             right_arm={"rotation": ch((0, [0, 0, 0]), (0.8, [175, 0, 0]), (1.8, [175, 0, 0]), (2.0, [70, 0, 0]), (3.0, [0, 0, 0]))},
             left_arm={"rotation": ch((0, [0, 0, 0]), (0.8, [175, 0, 0]), (1.8, [175, 0, 0]), (2.0, [70, 0, 0]), (3.0, [0, 0, 0]))},
             right_wing={"rotation": ch((0, [0, 0, 0]), (0.8, [0, -40, 20]), (2.0, [0, -40, 20]), (3.0, [0, 0, 0]))},
             left_wing={"rotation": ch((0, [0, 0, 0]), (0.8, [0, 40, -20]), (2.0, [0, 40, -20]), (3.0, [0, 0, 0]))},
             crown_circle={"rotation": spin(1, 3.0, 4, 12)},
             ground_circle={"scale": ch((0, [0, 0, 0]), (0.8, [0.8, 1, 0.8]), (1.8, [1, 1, 1]), (2.0, [1.4, 1, 1.4]), (2.6, [0, 1, 0]), (3.0, [0, 0, 0])),
                            "rotation": spin(1, 3.0, 1.5, 12)},
             ground_circle_inner={"scale": ch((0, [0, 0, 0]), (0.8, [1, 1, 1]), (2.0, [1.6, 1, 1.6]), (2.5, [0, 1, 0]), (3.0, [0, 0, 0])),
                                  "rotation": spin(1, 3.0, -3, 12)}),
        anim("death", 3.0, "hold",
             root={"rotation": ch((0, [0, 0, 0]), (1.0, [0, 0, 0]), (2.2, [-85, 0, 0])),
                   "position": ch((0, [0, 0, 0]), (2.2, [0, 0, 8]))},
             right_arm={"rotation": ch((0, [0, 0, 0]), (1.0, [120, 0, 0]), (2.2, [30, 0, 40]))},
             sword={"position": ch((0, [0, 0, 0]), (1.6, [0, 0, 0]), (2.4, [-6, -10, 0]))},
             right_wing={"scale": ch((0, [1, 1, 1]), (2.6, [0, 0, 0]))},
             left_wing={"scale": ch((0, [1, 1, 1]), (2.6, [0, 0, 0]))},
             crown_circle={"position": ch((0, [0, 0, 0]), (1.4, [0, 20, 0])), "scale": ch((0, [1, 1, 1]), (1.4, [2, 1, 2]), (2.0, [0, 0, 0]))},
             ground_circle={"scale": ch((0, [0, 0, 0]), (0.5, [1, 1, 1]), (3.0, [0, 1, 0]))},
             ground_circle_inner={"scale": ch((0, [0, 0, 0]))}),
    ]
    return "primordial_sovereign", "태초의 군주", bones, anims


BOSSES = [circle_warden, rune_golem, abyss_archmage, astral_eye, primordial_sovereign]


# ===========================================================================
# Blockbench .bbmodel 쓰기
# ===========================================================================
def uid(*parts):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "mdv-boss:" + ":".join(map(str, parts))))


def png_data_uri(cv):
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        tmp = f.name
    cv.save(tmp)
    with open(tmp, "rb") as f:
        data = f.read()
    os.unlink(tmp)
    return "data:image/png;base64," + base64.b64encode(data).decode()


CIRCLE_RES = 128


def build_bbmodel(key, title, bones, anims):
    cubes = []
    owner = []
    for b in bones:
        for c in b["cubes"]:
            cubes.append(c)
            owner.append(b["name"])
    # 일반 큐브는 박스 UV로 배치, 마법진 판은 고해상도(128px) 마법진 그림을 면 UV로 붙인다
    normal = [i for i, c in enumerate(cubes) if c["mat"] not in CIRCLE_COLORS]
    packed, tw, th = GA.pack_cubes([cubes[i] for i in normal])
    placed = {normal[k]: pos for k, pos in packed.items()}
    colors = sorted({c["mat"] for c in cubes if c["mat"] in CIRCLE_COLORS})
    circle_at = {}
    if colors:
        tw = max(tw, CIRCLE_RES * len(colors))
        w2 = 16
        while w2 < tw:
            w2 *= 2
        tw = w2
        for n, mat in enumerate(colors):
            circle_at[mat] = (n * CIRCLE_RES, th)
        th += CIRCLE_RES
        h2 = 16
        while h2 < th:
            h2 *= 2
        th = h2
    rng = random.Random(key)
    tex = Canvas(tw, th)
    seed = sum(map(ord, key))
    for i in normal:
        c = cubes[i]
        u, v = placed[i]
        w, h, d = [int(x) for x in c["size"]]
        for face, rect in GA.face_rects(u, v, w, h, d).items():
            paint_face(tex, rect, c["mat"], face, seed * 31 + i, rng)
    for mat, (cx, cy) in circle_at.items():
        paint_face(tex, (cx, cy, CIRCLE_RES, CIRCLE_RES), mat, "up", 0, rng)

    pivots = {b["name"]: b["pivot"] for b in bones}
    elements = []
    cube_ids = {}
    for i, c in enumerate(cubes):
        o, s = c["origin"], c["size"]
        w, h, d = [int(x) for x in s]
        faces = {}
        circle = c["mat"] in CIRCLE_COLORS
        if circle:
            u, v = 0, 0
            cx, cy = circle_at[c["mat"]]
            for face, (_, _, fw, fh) in GA.face_rects(0, 0, w, h, d).items():
                if fw >= 6 and fh >= 6:
                    faces[face] = {"uv": [cx, cy, cx + CIRCLE_RES, cy + CIRCLE_RES], "texture": 0}
                else:
                    faces[face] = {"uv": [0, 0, 0, 0], "texture": None}
        else:
            u, v = placed[i]
            for face, (fx, fy, fw, fh) in GA.face_rects(u, v, w, h, d).items():
                faces[face] = {"uv": [fx, fy, fx + fw, fy + fh], "texture": 0}
        cid = uid(key, "cube", i)
        cube_ids.setdefault(owner[i], []).append(cid)
        el = {
            "name": f"{owner[i]}_{len(cube_ids[owner[i]])}",
            "box_uv": not circle, "rescale": False, "locked": False, "render_order": "default",
            "allow_mirror_modeling": True,
            "from": [round(x, 4) for x in o],
            "to": [round(o[k] + s[k], 4) for k in range(3)],
            "autouv": 0, "color": i % 8,
            "origin": c["pivot"] or pivots[owner[i]],
            "uv_offset": [u, v],
            "faces": faces, "type": "cube", "uuid": cid,
        }
        if c["rot"]:
            el["rotation"] = c["rot"]
        elements.append(el)

    group_ids = {b["name"]: uid(key, "bone", b["name"]) for b in bones}

    def group(b):
        children = list(cube_ids.get(b["name"], []))
        children += [group(x) for x in bones if x["parent"] == b["name"]]
        return {
            "name": b["name"], "origin": b["pivot"], "rotation": b["rot"] or [0, 0, 0],
            "color": 0, "uuid": group_ids[b["name"]], "export": True, "mirror_uv": False,
            "isOpen": True, "locked": False, "visibility": True, "autouv": 0, "children": children,
        }

    outliner = [group(b) for b in bones if b["parent"] is None]

    animations = []
    for a in anims:
        animators = {}
        for bname, channels in a["bones"].items():
            kfs = []
            for channel, frames in channels.items():
                for t, val in frames:
                    kfs.append({
                        "channel": channel,
                        "data_points": [{"x": val[0], "y": val[1], "z": val[2]}],
                        "uuid": uid(key, a["name"], bname, channel, t),
                        "time": round(t, 4), "color": -1, "interpolation": "linear",
                    })
            animators[group_ids[bname]] = {"name": bname, "type": "bone", "keyframes": kfs}
        animations.append({
            "uuid": uid(key, "anim", a["name"]),
            "name": f"animation.mdv.{key}.{a['name']}",
            "loop": a["loop"], "override": False, "length": a["length"], "snapping": 24,
            "selected": False, "anim_time_update": "", "blend_weight": "", "start_delay": "", "loop_delay": "",
            "animators": animators,
        })

    height = max(c["origin"][1] + c["size"][1] for c in cubes)
    width = max(max(abs(c["origin"][0]), abs(c["origin"][0] + c["size"][0])) for c in cubes)
    model = {
        "meta": {"format_version": "4.10", "model_format": "bedrock", "box_uv": True},
        "name": title,
        "model_identifier": f"mdv_{key}",
        "visible_box": [math.ceil(width * 2 / 16) + 1, math.ceil(height / 16) + 1, 0],
        "variable_placeholders": "", "variable_placeholder_buttons": [],
        "timeline_setups": [], "unhandled_root_fields": {},
        "resolution": {"width": tw, "height": th},
        "elements": elements,
        "outliner": outliner,
        "textures": [{
            "path": "", "name": f"{key}.png", "folder": "", "namespace": "", "id": "0",
            "width": tw, "height": th, "uv_width": tw, "uv_height": th,
            "particle": False, "layers_enabled": False, "sync_to_project": "", "render_mode": "default",
            "render_sides": "auto", "frame_time": 1, "frame_order_type": "loop", "frame_order": "",
            "frame_interpolate": False, "visible": True, "internal": True, "saved": False,
            "uuid": uid(key, "texture"), "source": png_data_uri(tex),
        }],
        "animations": animations,
    }
    return model, tex, cubes


# ---------------------------------------------------------------------------
# 미리보기 렌더 (기본 자세, 앞쪽 3/4 시점)
# ---------------------------------------------------------------------------
def camera_front34(view):
    yaw, pitch = math.radians(-30), math.radians(18)
    d = GA.v_norm((math.sin(-yaw) * math.cos(pitch), -math.sin(pitch), math.cos(yaw) * math.cos(pitch)))
    right = GA.v_norm(GA.v_cross((0, 1, 0), d))
    up = GA.v_norm(GA.v_cross(d, right))
    return d, right, up


_base_hit = GA._hit_cube


def _hit_with_circles(c, ro, rd):
    """마법진 판은 무늬가 있는 곳만 맞은 것으로 친다 (나머지는 비쳐 보임)."""
    h = _base_hit(c, ro, rd)
    if not h or c["mat"] not in CIRCLE_COLORS:
        return h
    o, sz = c["origin"], c["size"]
    j, k = [ax for ax in range(3) if sz[ax] > 0][:2]
    p = h[3]
    u = (p[j] - o[j]) / sz[j]
    v = (p[k] - o[k]) / sz[k]
    if _CIRCLE_SRC.get(min(127, int(u * 128)), min(127, int(v * 128)))[3] < 60:
        return None
    return h


def preview(cubes, size=300):
    old_cam, old_hit = GA.camera, GA._hit_cube
    GA.camera, GA._hit_cube = camera_front34, _hit_with_circles
    try:
        img = GA.render_icon(cubes, "front", size=size, max_scale=8)
    finally:
        GA.camera, GA._hit_cube = old_cam, old_hit
    bg = Canvas(size, size)
    for y in range(size):
        bg.rect(0, y, size, 1, lerp_c((26, 20, 44), (60, 46, 86), y / size))
    bg.paste(img, 0, 0)
    return bg


def main():
    os.makedirs(os.path.join(OUT, "preview"), exist_ok=True)
    sheet_cells = []
    summary = []
    for fn in BOSSES:
        key, title, bones, anims = fn()
        model, tex, cubes = build_bbmodel(key, title, bones, anims)
        with open(os.path.join(OUT, f"{key}.bbmodel"), "w", encoding="utf-8") as f:
            json.dump(model, f, ensure_ascii=False)
        tex.save(os.path.join(OUT, "preview", f"{key}_texture.png"))
        img = preview(cubes)
        img.save(os.path.join(OUT, "preview", f"{key}.png"))
        sheet_cells.append(img)
        summary.append(f"{title} ({key}): 뼈 {len(bones)}, 큐브 {len(cubes)}, 애니메이션 {', '.join(a['name'] for a in anims)}")
    cell = 300
    sheet = Canvas(cell * len(sheet_cells), cell)
    for i, img in enumerate(sheet_cells):
        sheet.paste(img, i * cell, 0)
    sheet.save(os.path.join(OUT, "preview", "all_bosses.png"))
    print("\n".join(summary))


if __name__ == "__main__":
    main()
