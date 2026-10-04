"""Weapon model definitions for Medieval Arsenal (중세 무기고).

Every model is a list of boxes in Bedrock pixel units (16 px = 1 block).
Conventions (see README "3D 모델 좌표계"):
  * origin [0,0,0] is the centre of the hand (the bound rightItem/leftItem bone)
  * -Z is "forward" (blade / shaft direction), +Y is up
From one definition the generator produces the geometry (box UV), the
matching texture and the 2D inventory icon, so they always agree.
"""

# name -> (base rgb, emissive?)
MATERIALS = {
    "iron":      ((150, 154, 160), False),
    "dark_iron": ((70, 72, 80), False),
    "steel":     ((196, 204, 214), False),   # polished blade steel (fuller + bright edges)
    "gold":      ((214, 170, 60), False),
    "brass":     ((176, 132, 62), False),
    "wood":      ((124, 86, 50), False),
    "dark_wood": ((78, 52, 32), False),
    "leather":   ((96, 58, 36), False),
    "cloth_red": ((150, 32, 36), False),
    "cloth_blue": ((40, 62, 140), False),
    "string":    ((226, 218, 196), False),
    "rope":      ((168, 140, 96), False),
    "clay":      ((164, 92, 60), False),
    "feather":   ((236, 236, 232), False),
    # emissive accents (gems, embers) - rendered with entity_emissive_alpha
    "ruby":      ((230, 40, 60), True),
    "sapphire":  ((60, 120, 255), True),
    "ember":     ((255, 140, 40), True),
    # 신초의 검
    "abyss":     ((38, 26, 62), False),      # 빛을 삼키는 칠흑의 검신
    "astral":    ((190, 150, 255), True),    # 검신을 흐르는 태초의 빛
    "starlight": ((255, 236, 170), True),    # 금빛 별 보석
}


def box(origin, size, mat, rot=None, pivot=None):
    return {"origin": list(origin), "size": list(size), "mat": mat, "rot": rot, "pivot": pivot}


# ---------------------------------------------------------------------------
# Weapons
# ---------------------------------------------------------------------------
KNIGHT_LONGSWORD = [
    box([-1, -1, 4], [2, 2, 2], "gold"),             # pommel
    box([-1.5, -0.5, 4.5], [3, 1, 1], "ruby"),        # pommel gem
    box([-1, -1, -2], [2, 2, 6], "leather"),          # grip
    box([-1, -4, -3], [2, 8, 1], "gold"),             # crossguard
    box([-1.5, -0.5, -3], [3, 1, 1], "ruby"),         # guard gem
    box([-0.5, -1, -5], [1, 2, 2], "iron"),           # ricasso
    box([-0.5, -1.5, -24], [1, 3, 19], "steel"),      # blade
    box([-0.5, -1, -26], [1, 2, 2], "steel"),         # taper
    box([-0.5, -0.5, -27], [1, 1, 1], "steel"),       # point
]

WARHAMMER = [
    box([-1.5, -1.5, 6], [3, 3, 2], "iron"),          # pommel
    box([-1, -1, -14], [2, 2, 20], "dark_wood"),      # haft
    box([-1.5, -1.5, -1], [3, 3, 4], "leather"),      # grip wrap
    box([-1.5, -1.5, -17], [3, 3, 3], "iron"),        # languets
    box([-2, -2.5, -21], [4, 5, 4], "dark_iron"),     # head
    box([-2.5, 2.5, -21.5], [5, 3, 5], "iron"),       # striking face
    box([-1, -7, -20], [2, 5, 2], "steel"),           # back spike
    box([-0.5, -9, -19.5], [1, 2, 1], "steel"),       # spike tip
    box([-1, -1, -24], [2, 2, 3], "steel"),           # top spike
    box([-2.5, -1, -21.5], [5, 1, 5], "brass"),       # decorative band
]

BATTLE_AXE = [
    box([-1.5, -1.5, 6], [3, 3, 1], "iron"),          # pommel cap
    box([-1, -1, -16], [2, 2, 22], "wood"),           # haft
    box([-1.5, -1.5, -1], [3, 3, 4], "leather"),      # grip
    box([-1.5, -1.5, -18], [3, 3, 4], "dark_iron"),   # socket
    box([-1, -1, -19], [2, 2, 1], "iron"),            # top cap
    box([-0.5, 1.5, -18.5], [1, 3, 5], "iron"),       # neck
    box([-0.5, 4.5, -21], [1, 3, 9], "iron"),         # cheek
    box([-0.5, 7.5, -22.5], [1, 2, 12], "steel"),     # bearded edge
    box([-0.5, -4.5, -17.5], [1, 3, 3], "iron"),      # back spike
]

HALBERD = [
    box([-1.5, -1.5, 8], [3, 3, 2], "iron"),          # butt cap
    box([-1, -1, -22], [2, 2, 30], "wood"),           # shaft
    box([-1.5, -1.5, -1], [3, 3, 4], "cloth_red"),    # grip wrap
    box([-1.5, -1.5, -25], [3, 3, 3], "dark_iron"),   # socket
    box([-2, -2, -24], [4, 1, 1], "cloth_red"),       # tassel band
    box([-0.5, -1, -32], [1, 2, 7], "steel"),         # spear point
    box([-0.5, -0.5, -33], [1, 1, 1], "steel"),
    box([-0.5, 1.5, -25], [1, 2, 3], "iron"),         # axe neck
    box([-0.5, 3.5, -27.5], [1, 4, 6], "steel"),      # axe blade
    box([-0.5, -3.5, -25], [1, 2, 2], "iron"),        # back hook
    box([-0.5, -5.5, -24], [1, 2, 1], "iron"),        # hook tip
]

HEAVY_CROSSBOW = [
    box([-1, -1, -8], [2, 3, 18], "wood"),            # tiller
    box([-1.5, -2, 8], [3, 4, 3], "dark_wood"),       # butt
    box([-9, 0.5, -9], [18, 1, 2], "iron"),           # steel prod (limbs)
    box([-10, 0.5, -8], [1, 1, 2], "dark_iron"),      # limb tip L
    box([9, 0.5, -8], [1, 1, 2], "dark_iron"),        # limb tip R
    box([-10, 1, -7], [1, 1, 4], "string"),           # string L
    box([9, 1, -7], [1, 1, 4], "string"),             # string R
    box([-9, 1.5, -4], [18, 1, 1], "string"),         # drawn string
    box([-1.5, 1.5, -5], [3, 1, 2], "brass"),         # latch
    box([-0.5, 2, -11], [1, 1, 7], "dark_wood"),      # loaded bolt
    box([-0.5, 2, -12], [1, 1, 1], "iron"),           # bolt head
    box([-0.5, -4, 2], [1, 3, 1], "iron"),            # trigger lever
    box([-2, -1, -11], [4, 1, 1], "iron"),            # stirrup
    box([-2, -1, -11], [1, 1, 3], "iron"),
    box([1, -1, -11], [1, 1, 3], "iron"),
]

DAGGER = [
    box([-1, -1, 3], [2, 2, 1], "gold"),              # pommel
    box([-1, -1, 0], [2, 2, 3], "leather"),           # grip
    box([-0.5, -3, -1], [1, 6, 1], "gold"),           # guard
    box([-1, -0.5, -1], [2, 1, 1], "sapphire"),       # guard gem
    box([-0.5, -1, -9], [1, 2, 8], "steel"),          # blade
    box([-0.5, -0.5, -10], [1, 1, 1], "steel"),       # point
]

MORNING_STAR = [
    box([-1.5, -1.5, 4], [3, 3, 1], "iron"),          # pommel
    box([-1, -1, -10], [2, 2, 14], "dark_wood"),      # handle
    box([-1.5, -1.5, -1], [3, 3, 3], "leather"),      # grip
    box([-2.5, -2.5, -16], [5, 5, 6], "dark_iron"),   # head
    box([-3, -3, -13.5], [6, 6, 1], "iron"),          # band
    box([-0.5, 2.5, -14.5], [1, 2, 1], "steel"),      # spikes
    box([-0.5, -4.5, -14.5], [1, 2, 1], "steel"),
    box([-0.5, -0.5, -18], [1, 1, 2], "steel"),
    box([2.5, -0.5, -14.5], [2, 1, 1], "steel"),
    box([-4.5, -0.5, -14.5], [2, 1, 1], "steel"),
    box([-0.5, 2.5, -11.5], [1, 1, 1], "steel"),
    box([-0.5, -3.5, -11.5], [1, 1, 1], "steel"),
    box([-0.5, 1.5, -17], [1, 1, 1], "steel"),
    box([-0.5, -2.5, -17], [1, 1, 1], "steel"),
]

JAVELIN = [
    box([-0.5, -0.5, -14], [1, 1, 26], "wood"),       # shaft
    box([-1, -1, -15], [2, 2, 2], "iron"),            # socket
    box([-0.5, -1.5, -19], [1, 3, 4], "steel"),       # head
    box([-0.5, -0.5, -21], [1, 1, 2], "steel"),       # point
    box([-1, -1, -2], [2, 2, 4], "leather"),          # throwing grip
    box([-0.5, -1.5, 10], [1, 3, 2], "cloth_red"),    # tail streamer
]

FIRE_POT = [
    box([-2.5, -3, -2.5], [5, 5, 5], "clay"),         # pot body
    box([-3, -1, -3], [6, 1, 6], "rope"),             # cord
    box([-1.5, 2, -1.5], [3, 1, 3], "clay"),          # neck
    box([-1, 3, -1], [2, 2, 2], "cloth_red"),         # oily rag
    box([-0.5, 5, -0.5], [1, 2, 1], "ember"),         # flame
]

# 신초의 검 (Primordial Blade): 칠흑의 대검, 검신 가운데로 태초의 빛이 흐르고
# 날개처럼 펼쳐진 금빛 가드 위로 빛의 파편이 떠 있다.
PRIMORDIAL_BLADE = [
    box([-1.5, -1.5, 7], [3, 3, 2], "gold"),           # pommel
    box([-0.5, -0.5, 9], [1, 1, 1], "starlight"),      # pommel star
    box([-1, -1, -2], [2, 2, 9], "abyss"),             # grip
    box([-1.5, -1.5, 1], [3, 1, 1], "gold"),           # grip rings
    box([-1.5, -1.5, 4], [3, 1, 1], "gold"),
    box([-1.5, -7, -4], [3, 14, 2], "gold"),           # crossguard
    box([-1.5, 6, -7], [3, 2, 3], "gold"),             # guard wings (swept forward)
    box([-1.5, -8, -7], [3, 2, 3], "gold"),
    box([-1, 7, -9], [2, 1, 2], "starlight"),          # wing tips
    box([-1, -8, -9], [2, 1, 2], "starlight"),
    box([-2, -2, -5], [4, 4, 3], "astral"),            # heart gem
    box([-1, -3, -38], [2, 6, 33], "abyss"),           # blade
    box([-1.5, -0.5, -35], [3, 1, 29], "astral"),      # light channel (shows on both faces)
    box([-1, -2, -41], [2, 4, 3], "abyss"),            # taper
    box([-0.5, -1, -43], [1, 2, 2], "abyss"),
    box([-0.5, -0.5, -44], [1, 1, 1], "astral"),       # point
    box([-0.5, 5, -18], [1, 1, 1], "astral"),          # floating shards
    box([-0.5, -6, -27], [1, 1, 1], "astral"),
    box([-0.5, 5, -33], [1, 1, 1], "starlight"),
]

# Projectiles (entity models, centred on the entity; -Z = flight direction)
CROSSBOW_BOLT = [
    box([-0.5, -0.5, -4], [1, 1, 9], "dark_wood"),
    box([-0.5, -0.5, -6], [1, 1, 2], "iron"),
    box([-1.5, -0.5, 3], [3, 1, 2], "feather"),
    box([-0.5, -1.5, 3], [1, 3, 2], "feather"),
]
THROWN_JAVELIN = [
    box([-0.5, -0.5, -10], [1, 1, 22], "wood"),
    box([-1, -1, -11], [2, 2, 2], "iron"),
    box([-0.5, -1.5, -15], [1, 3, 4], "steel"),
    box([-0.5, -0.5, -17], [1, 1, 2], "steel"),
    box([-0.5, -1.5, 10], [1, 3, 2], "cloth_red"),
]
THROWN_FIRE_POT = [
    box([-2.5, 0, -2.5], [5, 5, 5], "clay"),
    box([-3, 2, -3], [6, 1, 6], "rope"),
    box([-1, 5, -1], [2, 2, 2], "cloth_red"),
    box([-0.5, 7, -0.5], [1, 2, 1], "ember"),
]

# id -> (model, hold style, icon view)
WEAPONS = {
    "knight_longsword": (KNIGHT_LONGSWORD, "sword", "diag"),
    "warhammer":        (WARHAMMER, "polearm", "diag"),
    "battle_axe":       (BATTLE_AXE, "polearm", "diag"),
    "halberd":          (HALBERD, "long_polearm", "diag"),
    "heavy_crossbow":   (HEAVY_CROSSBOW, "crossbow", "top"),
    "dagger":           (DAGGER, "sword", "diag"),
    "morning_star":     (MORNING_STAR, "sword", "diag"),
    "javelin":          (JAVELIN, "spear", "diag"),
    "fire_pot":         (FIRE_POT, "throwable", "side"),
    "primordial_blade": (PRIMORDIAL_BLADE, "greatsword", "diag"),
}

PROJECTILES = {
    "crossbow_bolt": CROSSBOW_BOLT,
    "thrown_javelin": THROWN_JAVELIN,
    "thrown_fire_pot": THROWN_FIRE_POT,
}

# ---------------------------------------------------------------------------
# Hold transforms for the attachables (Bedrock degrees / pixels).
# These are the only knobs to tweak if a model sits oddly in your hand:
# edit, run `python3 tools/generate_assets.py`, then `python3 tools/build.py`.
# ---------------------------------------------------------------------------
HOLD = {
    #                third person (rot, pos, scale)        first person (rot, pos, scale)
    "sword":        (([-10, 0, 0], [0, 0, 0], 1.0),       ([45, 0, 0], [0, 0, 0], 1.0)),
    "polearm":      (([-10, 0, 0], [0, 0, 4], 1.0),       ([45, 0, 0], [0, 0, 4], 0.9)),
    "long_polearm": (([-10, 0, 0], [0, 0, 7], 1.0),       ([45, 0, 0], [0, 0, 7], 0.85)),
    "spear":        (([-10, 0, 0], [0, 0, 0], 1.0),       ([45, 0, 0], [0, 0, 2], 0.9)),
    "crossbow":     (([10, 0, 0], [0, 1.5, 0], 1.0),      ([90, 0, 0], [0, 2, -2], 0.9)),
    "throwable":    (([0, 0, 0], [0, 0, 0], 1.0),         ([0, 0, 0], [0, 0, 0], 1.0)),
    "greatsword":   (([-10, 0, 0], [0, 0, 1], 1.0),       ([45, 0, 0], [0, 0, 2], 0.8)),
}
