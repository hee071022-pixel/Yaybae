"""Generates the textures for the Java ItemsAdder island (skyblock) menu UI.

Usage: python3 tools/gen_island_ui.py
"""
import math
import os
import random

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..", "Java_IslandUI", "plugins",
                    "ItemsAdder", "contents", "yaybae_island", "resourcepack",
                    "assets", "yaybae_island", "textures")

# slots (0-53) that hold a button in island_menu.yml
BUTTON_SLOTS = [4, 11, 13, 15, 28, 29, 30, 31, 32, 33, 34, 39, 41, 45, 49]
BIG_SLOTS = [11, 13, 15]


def save(img, rel):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print("wrote", os.path.relpath(path))


def lerp(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def slot_xy(slot):
    r, c = divmod(slot, 9)
    return 7 + 18 * c, 17 + 18 * r


def frame(d, x, y, w, h, outer, light, dark, fill):
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=outer)
    d.rectangle([x + 1, y + 1, x + w - 2, y + h - 2], fill=dark)
    d.rectangle([x + 1, y + 1, x + w - 3, y + h - 3], fill=light)
    d.rectangle([x + 2, y + 2, x + w - 3, y + h - 3], fill=fill)


def island(d, cx, cy, s):
    # small floating island: grass top, dirt wedge, hanging stones
    d.rectangle([cx - s, cy, cx + s, cy + 1], fill=(92, 178, 76))
    d.rectangle([cx - s, cy + 2, cx + s, cy + 2], fill=(66, 140, 58))
    for i in range(s):
        d.line([cx - s + i, cy + 3 + i // 2, cx + s - i, cy + 3 + i // 2],
               fill=(134, 96, 67) if i % 2 else (115, 80, 55))
    d.rectangle([cx - 1, cy - 4, cx, cy - 1], fill=(100, 70, 45))
    d.rectangle([cx - 3, cy - 7, cx + 2, cy - 4], fill=(70, 150, 60))


def background():
    W, H = 176, 222
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    random.seed(7)

    # outer panel (menu area: y 0..135)
    d.rounded_rectangle([0, 0, W - 1, 135], radius=4, fill=(30, 40, 70))
    for y in range(2, 134):
        t = (y - 2) / 132
        d.line([2, y, W - 3, y], fill=lerp((120, 190, 255), (40, 110, 190), t))
    # clouds
    for _ in range(9):
        x, y = random.randint(4, W - 20), random.randint(14, 110)
        for k in range(3):
            d.ellipse([x + k * 5, y - (k % 2) * 2, x + k * 5 + 9, y + 5],
                      fill=(225, 240, 255, 150))
    # sea at the bottom of the menu area
    for y in range(118, 134):
        d.line([2, y, W - 3, y], fill=lerp((50, 130, 210), (25, 80, 160), (y - 118) / 16))
    for x in range(2, W - 3, 6):
        d.point((x + (x // 6) % 3, 119), fill=(200, 235, 255))
    # floating islands in the gaps
    for cx, cy, s in ((22, 44, 7), (154, 44, 7), (34, 66, 6), (88, 64, 8), (142, 66, 6),
                      (22, 98, 5), (154, 98, 5), (70, 112, 6), (106, 112, 6)):
        island(d, cx, cy, s)
    # title bar
    d.rounded_rectangle([3, 2, W - 4, 13], radius=3, fill=(25, 35, 60, 210))
    d.line([6, 12, W - 7, 12], fill=(255, 214, 90))

    # button frames
    for slot in BUTTON_SLOTS:
        x, y = slot_xy(slot)
        if slot in BIG_SLOTS:
            frame(d, x - 2, y - 2, 22, 22, (40, 30, 15), (255, 230, 140), (170, 120, 40),
                  (60, 50, 80))
        else:
            frame(d, x, y, 18, 18, (25, 30, 50), (190, 210, 240), (60, 75, 110),
                  (45, 55, 85))

    # player inventory area (y 136..221) — classic slots with a stone panel
    d.rounded_rectangle([0, 128, W - 1, H - 1], radius=4, fill=(30, 40, 70))
    d.rectangle([2, 130, W - 3, H - 3], fill=(198, 198, 198))
    d.rectangle([2, 130, W - 3, 131], fill=(240, 240, 240))
    for r in range(4):
        y = 139 + 18 * r + (4 if r == 3 else 0)
        for c in range(9):
            x = 7 + 18 * c
            d.rectangle([x, y, x + 17, y + 17], fill=(139, 139, 139))
            d.line([x, y, x + 16, y], fill=(55, 55, 55))
            d.line([x, y, x, y + 16], fill=(55, 55, 55))
            d.line([x + 17, y + 1, x + 17, y + 17], fill=(255, 255, 255))
            d.line([x + 1, y + 17, x + 17, y + 17], fill=(255, 255, 255))
    save(img, "gui/island_menu.png")


# ───────────────── 16x16 icons ─────────────────
def icon(fn, name):
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    fn(ImageDraw.Draw(img), img.load())
    save(img, f"icon/{name}.png")


def i_home(d, p):
    d.polygon([(8, 1), (1, 8), (15, 8)], fill=(200, 60, 50))
    d.line([(8, 1), (1, 8)], fill=(240, 110, 90))
    d.rectangle([3, 8, 13, 14], fill=(235, 215, 170))
    d.rectangle([7, 10, 9, 14], fill=(120, 80, 50))
    d.rectangle([4, 9, 5, 10], fill=(130, 200, 255))
    d.rectangle([11, 9, 12, 10], fill=(130, 200, 255))


def i_sethome(d, p):
    d.line([(4, 1), (4, 14)], fill=(110, 80, 50), width=2)
    d.polygon([(5, 1), (13, 4), (5, 7)], fill=(255, 80, 80))
    d.rectangle([1, 14, 14, 15], fill=(92, 178, 76))
    d.point((10, 12), fill=(255, 255, 120))


def i_members(d, p):
    for cx, col in ((5, (90, 150, 255)), (11, (255, 160, 80))):
        d.ellipse([cx - 3, 2, cx + 2, 7], fill=(240, 200, 160))
        d.rounded_rectangle([cx - 4, 8, cx + 3, 15], radius=2, fill=col)


def i_upgrade(d, p):
    d.polygon([(8, 1), (2, 8), (6, 8), (6, 14), (10, 14), (10, 8), (14, 8)], fill=(90, 220, 110))
    d.line([(8, 1), (2, 8)], fill=(180, 255, 190))
    d.line([(6, 14), (10, 14)], fill=(40, 120, 60))


def i_top(d, p):
    d.rectangle([4, 2, 11, 8], fill=(255, 205, 60))
    d.ellipse([1, 2, 5, 7], outline=(255, 205, 60))
    d.ellipse([10, 2, 14, 7], outline=(255, 205, 60))
    d.rectangle([7, 9, 8, 11], fill=(220, 160, 40))
    d.rectangle([4, 12, 11, 14], fill=(140, 90, 40))
    d.point((6, 4), fill=(255, 250, 200))


def i_settings(d, p):
    c = 7.5
    for i in range(8):
        a = i * math.pi / 4
        x, y = c + math.cos(a) * 6, c + math.sin(a) * 6
        d.rectangle([x - 1, y - 1, x + 1, y + 1], fill=(170, 175, 190))
    d.ellipse([2, 2, 13, 13], fill=(150, 155, 170))
    d.ellipse([5, 5, 10, 10], fill=(60, 65, 80))


def i_warp(d, p):
    d.ellipse([2, 1, 13, 14], fill=(120, 40, 200))
    d.ellipse([4, 3, 11, 12], fill=(190, 110, 255))
    d.ellipse([6, 5, 9, 10], fill=(250, 220, 255))


def i_biome(d, p):
    d.rectangle([7, 9, 8, 14], fill=(110, 75, 45))
    d.ellipse([2, 1, 13, 11], fill=(60, 160, 60))
    d.ellipse([4, 2, 9, 6], fill=(110, 210, 90))
    d.rectangle([1, 14, 14, 15], fill=(92, 178, 76))


def i_value(d, p):
    d.polygon([(4, 2), (11, 2), (14, 6), (7.5, 14), (1, 6)], fill=(70, 220, 230))
    d.polygon([(4, 2), (7.5, 6), (1, 6)], fill=(170, 250, 255))
    d.line([(1, 6), (14, 6)], fill=(30, 160, 180))


def i_visitors(d, p):
    d.ellipse([1, 4, 14, 11], fill=(245, 245, 245))
    d.ellipse([5, 4, 10, 11], fill=(70, 130, 220))
    d.ellipse([6, 6, 9, 9], fill=(20, 25, 40))
    d.point((7, 6), fill=(255, 255, 255))


def i_bank(d, p):
    for k, y in enumerate((11, 8, 5)):
        d.ellipse([3, y, 12, y + 4], fill=(230, 180, 40))
        d.ellipse([4, y, 11, y + 2], fill=(255, 225, 90))
    d.point((7, 6), fill=(255, 255, 220))


def i_missions(d, p):
    d.rectangle([3, 1, 12, 14], fill=(240, 225, 185))
    d.rectangle([3, 1, 12, 2], fill=(200, 160, 100))
    for y in (5, 8, 11):
        d.line([(5, y), (6, y + 1), (8, y - 1)], fill=(60, 170, 70))
        d.line([(9, y), (11, y)], fill=(140, 120, 90))


def i_close(d, p):
    d.line([(3, 3), (12, 12)], fill=(230, 60, 60), width=3)
    d.line([(12, 3), (3, 12)], fill=(230, 60, 60), width=3)


def i_help(d, p):
    d.ellipse([1, 1, 14, 14], fill=(70, 120, 220))
    d.arc([5, 3, 10, 8], 180, 90, fill=(255, 255, 255), width=2)
    d.rectangle([7, 8, 8, 9], fill=(255, 255, 255))
    d.rectangle([7, 11, 8, 12], fill=(255, 255, 255))


def i_menu(d, p):
    # island compass (the item that opens the menu)
    d.ellipse([1, 1, 14, 14], fill=(200, 150, 50))
    d.ellipse([3, 3, 12, 12], fill=(80, 160, 230))
    island(d, 8, 7, 3)
    d.point((8, 3), fill=(255, 60, 60))


ICONS = {
    "home": i_home, "sethome": i_sethome, "members": i_members, "upgrade": i_upgrade,
    "top": i_top, "settings": i_settings, "warp": i_warp, "biome": i_biome,
    "value": i_value, "visitors": i_visitors, "bank": i_bank, "missions": i_missions,
    "close": i_close, "help": i_help, "island_compass": i_menu,
}

if __name__ == "__main__":
    background()
    for n, f in ICONS.items():
        icon(f, n)
