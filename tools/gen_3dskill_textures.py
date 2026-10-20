"""Generates the textures for the Java MagicSpells + ItemsAdder 3D skill pack.

Usage: python3 tools/gen_3dskill_textures.py
"""
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..", "Java_3DSkills", "plugins",
                    "ItemsAdder", "contents", "yaybae_skill", "resourcepack",
                    "assets", "yaybae_skill", "textures")


def save(img, rel):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print("wrote", os.path.relpath(path))


def blend(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def heaven_blade():
    # 16x16 atlas: blade (0-7 x), guard (8-11), grip (12-13), pommel/gem (14-15)
    img = Image.new("RGBA", (16, 16))
    px = img.load()
    for y in range(16):
        for x in range(8):
            edge = x in (0, 7)
            core = x in (3, 4)
            base = (190, 225, 255) if not edge else (240, 252, 255)
            if core:
                base = (120, 190, 255)
            glow = 0.15 * math.sin(y * 0.8)
            px[x, y] = blend(base, (255, 255, 255), max(0, glow)) + (255,)
        for x in range(8, 12):
            px[x, y] = ((255, 214, 90) if (x + y) % 3 else (200, 150, 40)) + (255,)
        for x in range(12, 14):
            px[x, y] = ((70, 40, 90) if y % 2 else (100, 60, 130)) + (255,)
        for x in range(14, 16):
            px[x, y] = (130, 240, 255, 255) if 5 < y < 11 else (255, 214, 90, 255)
    save(img, "skill/heaven_blade.png")


def ring_texture(size, draw_fn):
    # draw at 4x and downscale for smooth edges
    big = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(big), size * 4)
    return big.resize((size, size), Image.LANCZOS)


def magic_circle_outer():
    def fn(d, s):
        c = s / 2
        col = (140, 90, 255, 255)
        bright = (210, 180, 255, 255)
        for r, w in ((0.48, 10), (0.42, 5), (0.30, 6)):
            d.ellipse([c - s * r, c - s * r, c + s * r, c + s * r], outline=col, width=w)
        # runes between the two outer rings
        for i in range(24):
            a = i / 24 * math.tau
            r = s * 0.45
            x, y = c + math.cos(a) * r, c + math.sin(a) * r
            k = s * 0.012
            if i % 2:
                d.rectangle([x - k, y - k * 2, x + k, y + k * 2], fill=bright)
            else:
                d.ellipse([x - k * 1.6, y - k * 1.6, x + k * 1.6, y + k * 1.6], fill=bright)
        # hexagram
        for off in (0, math.pi / 3):
            pts = [(c + math.cos(off + i * math.tau / 3) * s * 0.42,
                    c + math.sin(off + i * math.tau / 3) * s * 0.42) for i in range(3)]
            d.polygon(pts, outline=bright, width=6)
    save(ring_texture(64, fn), "skill/magic_circle_outer.png")


def magic_circle_inner():
    def fn(d, s):
        c = s / 2
        col = (255, 120, 220, 255)
        d.ellipse([c - s * 0.2, c - s * 0.2, c + s * 0.2, c + s * 0.2], outline=col, width=6)
        pts = [(c + math.cos(-math.pi / 2 + i * 2 * math.tau / 5) * s * 0.28,
                c + math.sin(-math.pi / 2 + i * 2 * math.tau / 5) * s * 0.28) for i in range(5)]
        d.line(pts + [pts[0]], fill=col, width=6)
        for i in range(8):
            a = i / 8 * math.tau
            x1, y1 = c + math.cos(a) * s * 0.3, c + math.sin(a) * s * 0.3
            x2, y2 = c + math.cos(a) * s * 0.38, c + math.sin(a) * s * 0.38
            d.line([x1, y1, x2, y2], fill=(255, 200, 240, 255), width=5)
    save(ring_texture(64, fn), "skill/magic_circle_inner.png")


def crescent():
    # crescent bulging toward the top of the texture (north / local -Z)
    s = 64
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    px = img.load()
    c = s / 2
    R = s * 0.48
    for y in range(s):
        for x in range(s):
            dx, dy = x + 0.5 - c, y + 0.5 - c
            d_outer = math.hypot(dx, dy)
            d_inner = math.hypot(dx, dy - s * 0.16)
            if d_outer < R and d_inner > R * 0.92 and dy < s * 0.1:
                # thickness 0..1 (thicker in the middle)
                t = min(1.0, (d_inner - R * 0.92) / (R * 0.25))
                core = blend((90, 200, 255), (255, 255, 255), t)
                alpha = int(120 + 135 * t)
                px[x, y] = core + (alpha,)
    save(img, "skill/crescent_slash.png")


def skill_sword():
    # 16x16 hand-held item icon (diagonal sword)
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    blade = [(13, 2), (12, 3), (11, 4), (10, 5), (9, 6), (8, 7), (7, 8), (6, 9)]
    for x, y in blade:
        px[x, y] = (200, 235, 255, 255)
        px[x + 1, y] = (120, 190, 255, 255)
        px[x, y - 1 if y > 0 else y] = (240, 252, 255, 255)
    px[14, 1] = (255, 255, 255, 255)
    for x, y in ((3, 8), (4, 9), (5, 10), (7, 12), (8, 13)):
        px[x, y] = (255, 214, 90, 255)
    for x, y in ((5, 11), (4, 12), (3, 13)):
        px[x, y] = (100, 60, 130, 255)
    px[2, 14] = (130, 240, 255, 255)
    px[6, 11] = (200, 150, 40, 255)
    save(img, "item/arcane_blade.png")


if __name__ == "__main__":
    heaven_blade()
    magic_circle_outer()
    magic_circle_inner()
    crescent()
    skill_sword()
