#!/usr/bin/env python3
"""Generates the loot crate block textures (side / top / bottom, 16x16).

Usage: python3 Haulers/tools/crate_textures.py   (requires Pillow)
"""
import os
import random

from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Haulers_RP", "textures", "blocks")

WOOD = [(92, 58, 32), (110, 70, 38), (128, 82, 44), (143, 94, 52)]
WOOD_DARK = [(52, 32, 18), (64, 40, 22), (74, 47, 26)]
IRON = [(70, 72, 78), (112, 116, 124), (156, 160, 168), (196, 200, 206)]
GOLD = [(140, 96, 18), (214, 160, 36), (250, 214, 84), (255, 244, 170)]


def jitter(c, rng, amt=8):
    d = rng.randint(-amt, amt)
    return tuple(max(0, min(255, v + d)) for v in c)


def planks(img, rng, horizontal=True):
    """Fills with 4px wide planks, grain streaks and dark seams."""
    for y in range(16):
        for x in range(16):
            a, b = (y, x) if horizontal else (x, y)
            row = a // 4
            base = WOOD[(row * 3 + 1) % len(WOOD)]
            if a % 4 == 3:
                c = WOOD_DARK[1]  # seam
            else:
                c = base
                if (b + row * 5) % 7 == 0 and a % 4 == 1:
                    c = WOOD[0]  # grain streak
            img.putpixel((x, y), jitter(c, rng, 6))


def frame(img, rng):
    for i in range(16):
        for (x, y) in ((i, 0), (i, 15), (0, i), (15, i)):
            img.putpixel((x, y), jitter(WOOD_DARK[0], rng, 4))
        for (x, y) in ((i, 1), (1, i)):
            if 0 < i < 15:
                img.putpixel((x, y), jitter(WOOD_DARK[2], rng, 4))
        for (x, y) in ((i, 14), (14, i)):
            if 0 < i < 15:
                img.putpixel((x, y), jitter(WOOD_DARK[1], rng, 4))


def corners(img):
    """Iron corner brackets with a rivet."""
    for cx, cy, sx, sy in ((0, 0, 1, 1), (15, 0, -1, 1), (0, 15, 1, -1), (15, 15, -1, -1)):
        for k in range(4):
            img.putpixel((cx + sx * k, cy), IRON[1])
            img.putpixel((cx, cy + sy * k), IRON[1])
        img.putpixel((cx + sx, cy + sy), IRON[1])
        img.putpixel((cx + sx * 2, cy + sy), IRON[1])
        img.putpixel((cx + sx, cy + sy * 2), IRON[1])
        img.putpixel((cx + sx, cy + sy), IRON[3])  # rivet highlight
        img.putpixel((cx, cy), IRON[0])


def band(img, y):
    for x in range(16):
        img.putpixel((x, y), IRON[2] if x % 5 else IRON[3])
        img.putpixel((x, y + 1), IRON[0])


def lock(img, cx, cy):
    """Small gold lock plate with keyhole."""
    for y in range(cy - 2, cy + 3):
        for x in range(cx - 2, cx + 2):
            edge = y in (cy - 2, cy + 2) or x in (cx - 2, cx + 1)
            img.putpixel((x, y), GOLD[1] if edge else GOLD[2])
    img.putpixel((cx - 2, cy - 2), GOLD[0])
    img.putpixel((cx + 1, cy + 2), GOLD[0])
    img.putpixel((cx - 1, cy - 1), GOLD[3])
    img.putpixel((cx - 1, cy), (40, 26, 10))
    img.putpixel((cx, cy), (40, 26, 10))
    img.putpixel((cx - 1, cy + 1), (40, 26, 10))


def side():
    rng = random.Random(1)
    img = Image.new("RGBA", (16, 16))
    planks(img, rng)
    frame(img, rng)
    band(img, 4)
    corners(img)
    lock(img, 8, 9)
    return img


def top():
    rng = random.Random(2)
    img = Image.new("RGBA", (16, 16))
    planks(img, rng, horizontal=False)
    frame(img, rng)
    band(img, 7)
    for y in range(16):  # crossing band
        img.putpixel((7, y), IRON[2] if y % 5 else IRON[3])
        img.putpixel((8, y), IRON[0])
    corners(img)
    for (x, y) in ((6, 6), (9, 6), (6, 9), (9, 9)):
        img.putpixel((x, y), GOLD[2])
    return img


def bottom():
    rng = random.Random(3)
    img = Image.new("RGBA", (16, 16))
    planks(img, rng)
    frame(img, rng)
    for y in range(16):
        for x in range(16):
            r, g, b, a = img.getpixel((x, y))
            img.putpixel((x, y), (int(r * 0.75), int(g * 0.75), int(b * 0.75), a))
    return img


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, fn in (("side", side), ("top", top), ("bottom", bottom)):
        path = os.path.join(OUT, f"haul_crate_{name}.png")
        fn().save(path)
        print("wrote", os.path.normpath(path))
