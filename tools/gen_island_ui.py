"""Generates the textures for the Java ItemsAdder island (skyblock) menu UI.

Everything is hand-placed pixel art: icons are ASCII pixel maps, the background
uses flat colour bands + checker dithering like vanilla textures (no gradients
or anti-aliasing).

Usage: python3 tools/gen_island_ui.py
"""
import os
import random

from PIL import Image

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


def hexc(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


# ───────────────────────── background ─────────────────────────
W, H = 176, 222
SKY = [hexc("7EB6F2"), hexc("8DC2F5"), hexc("9DCDF7"), hexc("AEDAFA")]
CLOUD, CLOUD_SH = hexc("FFFFFF"), hexc("D5E6F7")
SEA, SEA_HI, SEA_DK = hexc("3E6FD8"), hexc("6E98EC"), hexc("2F58B4")
GRASS, GRASS_HI, GRASS_DK = hexc("6AA83E"), hexc("85C24E"), hexc("4E8A2C")
DIRT = [hexc("8A5D3B"), hexc("7A5032"), hexc("966A45")]
STONE = [hexc("7D7D7D"), hexc("6A6A6A")]
LOG, LOG_DK = hexc("6B4F2A"), hexc("4F3A1E")
LEAF = [hexc("3F7F25"), hexc("4E9430"), hexc("2F6619")]
WOOD = [hexc("B8945F"), hexc("A4824E"), hexc("8D6C3D")]
WOOD_LINE, WOOD_OUT = hexc("6A4F2B"), hexc("2B1D0E")
GUI, GUI_HI, GUI_SH = hexc("C6C6C6"), hexc("FFFFFF"), hexc("555555")
SLOT, SLOT_SH, SLOT_HI = hexc("8B8B8B"), hexc("373737"), hexc("FFFFFF")
GOLD, GOLD_HI, GOLD_DK = hexc("E8B83A"), hexc("FCE68A"), hexc("A2721C")


class Canvas:
    def __init__(self, w, h):
        self.img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.px = self.img.load()
        self.w, self.h = w, h

    def put(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, c)


def sky(cv, x0, y0, x1, y1):
    band_h = (y1 - y0 + 1) / len(SKY)
    for y in range(y0, y1 + 1):
        i = min(len(SKY) - 1, int((y - y0) / band_h))
        local = (y - y0) - i * band_h
        for x in range(x0, x1 + 1):
            c = SKY[i]
            # 2-row checker dither into the next band
            if i + 1 < len(SKY) and local >= band_h - 2 and (x + y) % 2 == 0:
                c = SKY[i + 1]
            cv.put(x, y, c)


CLOUD_SHAPES = [
    ["...####.....",
     ".########...",
     "############",
     ".==========."],
    ["..###...",
     ".######.",
     "########",
     ".======."],
]


def cloud(cv, x, y, shape):
    for j, row in enumerate(shape):
        for i, ch in enumerate(row):
            if ch == "#":
                cv.put(x + i, y + j, CLOUD)
            elif ch == "=":
                cv.put(x + i, y + j, CLOUD_SH)


def island(cv, cx, top, half, rng, tree=True):
    """Pixel floating island: 2 rows of grass, dirt body tapering down, stone tip."""
    depth = half + 2
    for d in range(depth):
        w = half - (d * half) // depth if d > 1 else half
        for x in range(cx - w, cx + w + 1):
            y = top + d
            if d == 0:
                c = GRASS_HI if rng.random() < 0.3 else GRASS
            elif d == 1:
                c = GRASS_DK if rng.random() < 0.5 else GRASS
            elif d >= depth - 2:
                c = rng.choice(STONE)
            else:
                c = rng.choice(DIRT)
            cv.put(x, y, c)
        # grass drips over the edge
    cv.put(cx - half, top + 2, GRASS_DK)
    cv.put(cx + half, top + 2, GRASS_DK)
    if tree:
        tx = cx - half // 3
        for y in range(top - 4, top):
            cv.put(tx, y, LOG)
            cv.put(tx + 1, y, LOG_DK)
        leaf = ["..###..",
                ".#####.",
                "#######",
                "#######",
                ".#####."]
        for j, row in enumerate(leaf):
            for i, ch in enumerate(row):
                if ch == "#":
                    c = LEAF[1]
                    if j <= 1 and i <= 3:
                        c = LEAF[1] if rng.random() < 0.5 else hexc("5DA83A")
                    elif j >= 3 or i >= 5:
                        c = LEAF[2] if rng.random() < 0.6 else LEAF[0]
                    cv.put(tx - 3 + i, top - 9 + j, c)


def wood_frame(cv, x0, y0, x1, y1, t=4):
    rng = random.Random(3)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            inner = x0 + t <= x <= x1 - t and y0 + t <= y <= y1 - t
            if inner:
                continue
            c = WOOD[(y // 4) % 2] if rng.random() > 0.12 else WOOD[2]
            if (y - y0) % 4 == 3 and y0 + t <= y <= y1 - t:
                c = WOOD_LINE
            cv.put(x, y, c)
    # outline with rounded corners
    for x in range(x0 + 1, x1):
        cv.put(x, y0, WOOD_OUT)
        cv.put(x, y1, WOOD_OUT)
    for y in range(y0 + 1, y1):
        cv.put(x0, y, WOOD_OUT)
        cv.put(x1, y, WOOD_OUT)
    for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
        cv.put(x, y, (0, 0, 0, 0))
    for x, y in ((x0 + 1, y0 + 1), (x1 - 1, y0 + 1), (x0 + 1, y1 - 1), (x1 - 1, y1 - 1)):
        cv.put(x, y, WOOD_OUT)
    # inner edge shadow (top/left) and highlight (bottom/right)
    for x in range(x0 + t - 1, x1 - t + 2):
        cv.put(x, y0 + t - 1, WOOD_LINE)
        cv.put(x, y1 - t + 1, WOOD[0])
    for y in range(y0 + t - 1, y1 - t + 2):
        cv.put(x0 + t - 1, y, WOOD_LINE)
        cv.put(x1 - t + 1, y, WOOD[0])


def vanilla_slot(cv, x, y):
    cv.rect(x, y, x + 17, y + 17, SLOT)
    cv.rect(x, y, x + 16, y, SLOT_SH)
    cv.rect(x, y, x, y + 16, SLOT_SH)
    cv.rect(x + 1, y + 17, x + 17, y + 17, SLOT_HI)
    cv.rect(x + 17, y + 1, x + 17, y + 17, SLOT_HI)


def gold_slot(cv, x, y):
    # 2px gold rim around a vanilla slot
    cv.rect(x - 2, y - 2, x + 19, y + 19, WOOD_OUT)
    cv.rect(x - 1, y - 1, x + 18, y + 18, GOLD)
    cv.rect(x - 1, y - 1, x + 18, y - 1, GOLD_HI)
    cv.rect(x - 1, y - 1, x - 1, y + 18, GOLD_HI)
    cv.rect(x - 1, y + 18, x + 18, y + 18, GOLD_DK)
    cv.rect(x + 18, y - 1, x + 18, y + 18, GOLD_DK)
    for cx, cy in ((x - 2, y - 2), (x + 19, y - 2), (x - 2, y + 19), (x + 19, y + 19)):
        cv.put(cx, cy, (0, 0, 0, 0))
    vanilla_slot(cv, x, y)


def slot_xy(slot):
    r, c = divmod(slot, 9)
    return 7 + 18 * c, 17 + 18 * r


def background():
    cv = Canvas(W, H)
    rng = random.Random(11)

    # scene inside the top frame (menu rows: y 17..124)
    sky(cv, 4, 4, W - 5, 123)
    for x, y, s in ((10, 22, 0), (120, 18, 1), (64, 46, 1), (140, 60, 0), (8, 84, 1),
                    (150, 92, 1)):
        cloud(cv, x, y, CLOUD_SHAPES[s])
    # sea + waves
    cv.rect(4, 116, W - 5, 127, SEA)
    cv.rect(4, 124, W - 5, 127, SEA_DK)
    for x in range(4, W - 5):
        if x % 7 in (0, 1):
            cv.put(x, 116 + (x // 7) % 2, SEA_HI)
        if x % 11 == 5:
            cv.put(x, 120, SEA_HI)

    # islands in the empty cells (cell centres between button slots)
    island(cv, 18, 44, 7, rng)
    island(cv, 158, 44, 7, rng)
    island(cv, 36, 63, 5, rng, tree=False)
    island(cv, 88, 63, 6, rng)
    island(cv, 140, 63, 5, rng, tree=False)
    island(cv, 24, 97, 6, rng)
    island(cv, 152, 97, 6, rng)
    island(cv, 88, 99, 4, rng, tree=False)
    island(cv, 136, 112, 4, rng, tree=False)

    # top wood frame with a title plank
    wood_frame(cv, 0, 0, W - 1, 131)
    cv.rect(4, 4, W - 5, 14, WOOD[1])
    for x in range(4, W - 4):
        cv.put(x, 14, WOOD_LINE)
        cv.put(x, 15, hexc("5E86C9"))  # shadow the plank casts on the sky
        if rng.random() < 0.15:
            cv.put(x, 4 + rng.randint(0, 9), WOOD[2])
    for nx in (7, W - 8):
        cv.put(nx, 9, hexc("3A3A3A"))
        cv.put(nx, 8, hexc("9A9A9A"))

    # button slots
    for slot in BUTTON_SLOTS:
        x, y = slot_xy(slot)
        if slot in BIG_SLOTS:
            gold_slot(cv, x, y)
        else:
            vanilla_slot(cv, x, y)

    # player inventory: vanilla panel
    y0 = 132
    cv.rect(0, y0, W - 1, H - 1, GUI)
    cv.rect(1, y0, W - 2, H - 2, GUI)
    cv.rect(0, y0, 0, H - 2, hexc("000000"))
    cv.rect(W - 1, y0, W - 1, H - 2, hexc("000000"))
    cv.rect(1, H - 1, W - 2, H - 1, hexc("000000"))
    cv.rect(1, y0, 2, H - 3, GUI_HI)
    cv.rect(W - 3, y0, W - 2, H - 3, GUI_SH)
    cv.rect(3, H - 3, W - 2, H - 2, GUI_SH)
    cv.put(W - 2, H - 2, (0, 0, 0, 0))
    cv.put(0, H - 1, (0, 0, 0, 0))
    for r in range(3):
        for c in range(9):
            vanilla_slot(cv, 7 + 18 * c, 139 + 18 * r)
    for c in range(9):
        vanilla_slot(cv, 7 + 18 * c, 197)
    save(cv.img, "gui/island_menu.png")


# ───────────────────────── icons (16x16 pixel maps) ─────────────────────────
ICONS = {
    "home": ({
        "o": "3B1A12", "r": "B83A2E", "R": "DE5A43", "w": "E9D9B0", "W": "C9B489",
        "b": "6FB7F0", "d": "7A4E2D", "D": "5A3820", "c": "8A8A8A"},
        ["................",
         "..........oo....",
         ".......oo.oco...",
         "......oRRooco...",
         ".....oRRrrocco..",
         "....oRRrrrrro...",
         "...oRRrrrrrrro..",
         "..oRRrrrrrrrrro.",
         ".ooooooooooooooo",
         "..owwwwwwwwwwWo.",
         "..owbbwwwwwbbWo.",
         "..owbbwwddwbbWo.",
         "..owwwwwddwwwWo.",
         "..owwwwwdDwwwWo.",
         "..oWWWWWdDWWWWo.",
         "..oooooooooooooo"]),
    "upgrade": ({"o": "1E4A1A", "L": "B8F59A", "G": "5CC23E", "D": "3A8A26"},
        ["................",
         ".......oo.......",
         "......oLGo......",
         ".....oLGGDo.....",
         "....oLGGGGDo....",
         "...oLGGGGGGDo...",
         "..oLGGGGGGGGDo..",
         "..ooooLGGDoooo..",
         ".....oLGGDo.....",
         ".....oLGGDo.....",
         ".....oLGGDo.....",
         ".....oLGGDo.....",
         ".....oLGGDo.....",
         ".....oDDDDo.....",
         ".....oooooo.....",
         "................"]),
    "top": ({"o": "4A2E05", "L": "FFF3B0", "Y": "F2C230", "D": "B5800F",
             "w": "6B4423", "W": "8A5A30"},
        ["................",
         "..oooooooooooo..",
         ".ooLLYYYYYYYDoo.",
         "oYoLYYYYYYYYDoYo",
         "oYoLYYYYYYYYDoYo",
         ".ooLYYYYYYYYDoo.",
         "...oLYYYYYYDo...",
         "....oLYYYYDo....",
         ".....ooYDoo.....",
         "......oYDo......",
         "......oYDo......",
         ".....oLYYDo.....",
         "....ooooooooo...",
         "....oWWWWWWWo...",
         "....owwwwwwwo...",
         "....ooooooooo..."]),
    "sethome": ({"o": "2A1A0C", "p": "C8A36A", "P": "8E6C3C", "r": "D93B3B",
                 "R": "F06A5A", "k": "9E2424", "g": "6AA83E", "G": "85C24E", "d": "8A5D3B"},
        ["................",
         "...oo...........",
         "...opoooooooo...",
         "...opRRRrrrrko..",
         "...opRrrrrrrko..",
         "...oprrrrrrkko..",
         "...oprrrrrkko...",
         "...opoooooooo...",
         "...opPo.........",
         "...opPo.........",
         "...opPo.........",
         "...opPo.........",
         ".oooopPoooooooo.",
         "oGGGGGGGGGGGgggo",
         "odddddddddddddd.",
         ".ooooooooooooo.."]),
    "members": ({"o": "1F1A16", "h": "4A2F1C", "s": "E8B48A", "S": "C88E64",
                 "e": "2E4A9E", "b": "3E7FD8", "B": "2A5CA8", "a": "E8892E", "A": "B5651C",
                 "y": "6B4A2A"},
        ["................",
         ".oooooo.........",
         ".ohhhho.........",
         ".osesso.oooooo..",
         ".ossssS.oyyyyo..",
         ".oSssSo.osesso..",
         ".oooooo.ossssS..",
         "obbbbbbooSssSo..",
         "obbbbbBoooooooo.",
         "obBbbBoaaaaaaaao",
         "obBbbBoaaaaaaAao",
         "obBbbBoaAaaaAAao",
         "oooooooaAaaaAAao",
         ".......aAaaaAAao",
         ".......oooooooo.",
         "................"]),
    "warp": ({"o": "1A0A2E", "p": "5B1E9E", "P": "8A3FE0", "L": "C79BFF", "w": "F2E6FF",
              "k": "2B2B38", "K": "45455A"},
        ["................",
         "...oooooooooo...",
         "..okKkKkKkKkko..",
         "..oKoooooooooK..",
         "..okoppPPppoko..",
         "..oKopPLLPpoKo..",
         "..okoPLwwLPoko..",
         "..oKoPLwwLPoKo..",
         "..okoPLwwLPoko..",
         "..oKoPLwwLPoKo..",
         "..okopPLLPpoko..",
         "..oKoppPPppoKo..",
         "..okoooooooooko.",
         "..oKkKkKkKkKkKo.",
         "..oooooooooooo..",
         "................"]),
    "settings": ({"o": "26272E", "g": "9EA3AE", "G": "C9CDD6", "d": "6E7380", "h": "3A3D47"},
        ["................",
         "......oooo......",
         "......oGgo......",
         "..ooo.oGgo.ooo..",
         "..oGgooGgooggo..",
         "..ooGGGGgggdoo..",
         "....oGgoooggo...",
         "..oooGgohhogdooo",
         "..oGGGgohhoggddo",
         "..oooGgoooogdooo",
         "....oGggggddo...",
         "..oogggggddddoo.",
         "..oggoogdoodddo.",
         "..ooo.ogdo.ooo..",
         "......oddo......",
         "......oooo......"]),
    "biome": ({"o": "1B2E10", "l": "3F7F25", "L": "5DA83A", "H": "8AD15A", "t": "6B4F2A",
               "T": "4F3A1E", "g": "6AA83E", "G": "85C24E", "d": "8A5D3B", "D": "6E4A2E"},
        ["................",
         ".....oooooo.....",
         "....oHHLLLlo....",
         "...oHLLLLLllo...",
         "..oHLLLLLLlllo..",
         "..oLLLLLLlllllo.",
         "..oLLLLLllllllo.",
         "...olLLlllllo...",
         "....oollllloo...",
         "......otTo......",
         "......otTo......",
         "......otTo......",
         ".ooooootToooooo.",
         "oGGGGGGgggggggGo",
         "odDddDddDddDddDo",
         ".oooooooooooooo."]),
    "value": ({"o": "0F3A40", "w": "E6FFFF", "L": "9AF2F5", "c": "3FD6DE", "C": "22A9B5",
               "d": "137A86"},
        ["................",
         "................",
         "....oooooooo....",
         "...owLLcccLco...",
         "..owLLccccLcco..",
         ".oooooooooooooo.",
         ".oLLccccccCCddo.",
         "..oLcccccCCddo..",
         "...oLcccCCddo...",
         "....oLcCCddo....",
         ".....oLCddo.....",
         "......oCdo......",
         ".......oo.......",
         "................",
         "................",
         "................"]),
    "visitors": ({"o": "1F1F28", "w": "F4F4F4", "W": "C8C8D0", "b": "3E86D8", "B": "2457A0",
                  "k": "101018", "h": "FFFFFF"},
        ["................",
         "................",
         "................",
         ".....oooooo.....",
         "...oowwwwwwoo...",
         "..owwwbbbbwwWo..",
         ".owwwbBkkBbwWWo.",
         "owwwwbkhkkbwWWWo",
         "owwwwbkkkkbwWWWo",
         ".owwwbBkkBbWWWo.",
         "..owwWbbbbWWWo..",
         "...ooWWWWWWoo...",
         ".....oooooo.....",
         "................",
         "................",
         "................"]),
    "bank": ({"o": "4A3205", "L": "FFF0A0", "Y": "F2C230", "D": "B5800F", "d": "8A5E0A"},
        ["................",
         "................",
         "......oooooo....",
         ".....oLLYYYDo...",
         ".....oYYYYYDo...",
         "....oooooooooo..",
         "...oLLYYYYYYDo..",
         "...oYYYYYYYYDo..",
         "...odddddddddo..",
         "..oooooooooooo..",
         ".oLLYYYYYYYYDo..",
         ".oYYYYYYYYYYDo..",
         ".oddddddddddddo.",
         ".oYYYYYYYYYYDDo.",
         ".oddddddddddddo.",
         "..oooooooooooo.."]),
    "missions": ({"o": "3A2A14", "p": "F2E2B8", "P": "D9C08A", "r": "B88A4A", "R": "8E6430",
                  "g": "3E9E3A", "l": "8E7A5A"},
        ["................",
         ".oooooooooooo...",
         "orRRRRRRRRRRro..",
         ".oppppppppppPo..",
         ".opgpppppppPPo..",
         ".opggpllllpPPo..",
         ".ogpgppppppPPo..",
         ".oppppppppppPo..",
         ".opgpppppppPPo..",
         ".opggpllllpPPo..",
         ".ogpgppppppPPo..",
         ".oppppppppppPo..",
         ".oppppllllppPo..",
         "orRRRRRRRRRRro..",
         ".oooooooooooo...",
         "................"]),
    "close": ({"o": "3A0A0A", "r": "E04848", "R": "FF8A7A", "d": "A02626"},
        ["................",
         ".ooo........ooo.",
         "oRrdo......oRrdo",
         "orrrdo....oRrrdo",
         ".odrrdo..oRrrdo.",
         "..odrrdooRrrdo..",
         "...odrrRRrrdo...",
         "....odrrrrdo....",
         "....oRrrrrdo....",
         "...oRrrddrrdo...",
         "..oRrrdoodrrdo..",
         ".oRrrdo..odrrdo.",
         "oRrrdo....odrrdo",
         "orrdo......odrdo",
         ".ooo........ooo.",
         "................"]),
    "help": ({"o": "0E1F4A", "b": "3E6FD8", "B": "6E98EC", "d": "2A4EA8", "w": "FFFFFF",
              "W": "C9D8F5"},
        ["................",
         ".....oooooo.....",
         "...ooBBBbbboo...",
         "..oBBbwwwwbbdo..",
         "..oBbwwbbwwbdo..",
         ".oBbbWWbbwwbbdo.",
         ".oBbbbbbbwwbbdo.",
         ".obbbbbwwwbbbdo.",
         ".obbbbbwwbbbbdo.",
         ".obbbbbWWbbbbdo.",
         ".obbbbbbbbbbddo.",
         "..obbbbwwbbbdo..",
         "..odbbbWWbbddo..",
         "...ooddddddoo...",
         ".....oooooo.....",
         "................"]),
    "island_compass": ({"o": "3A2A0A", "y": "E8B83A", "Y": "FCE68A", "D": "A2721C",
                        "s": "7EB6F2", "S": "AEDAFA", "g": "6AA83E", "d": "8A5D3B",
                        "l": "3F7F25", "r": "E03A3A"},
        ["................",
         ".....oooooo.....",
         "...ooYYYyyyoo...",
         "..oYyySSSSyyDo..",
         "..oYySSSrSSyDo..",
         ".oYySSSSrSSSyDo.",
         ".oYsSSSlllSSyDo.",
         ".oYssSllllSsyDo.",
         ".oyssgggggssyDo.",
         ".oysssddddssyDo.",
         ".oyssssddsssyDo.",
         "..oyssssssssDo..",
         "..oDyysssyyDDo..",
         "...ooDDDDDDoo...",
         ".....oooooo.....",
         "................"]),
}


def build_icon(name, palette, rows):
    assert len(rows) == 16, (name, len(rows))
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(rows):
        assert len(row) == 16, (name, y, len(row), row)
        for x, ch in enumerate(row):
            if ch != ".":
                px[x, y] = hexc(palette[ch])
    save(img, f"icon/{name}.png")


if __name__ == "__main__":
    background()
    for n, (pal, rows) in ICONS.items():
        build_icon(n, pal, rows)
