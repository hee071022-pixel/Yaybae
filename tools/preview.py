#!/usr/bin/env python3
"""Renders docs/showcase.png: large 3D renders of every weapon model."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pngkit import Canvas, lerp_c  # noqa: E402
import models as M  # noqa: E402
from generate_assets import ROOT, render_icon  # noqa: E402

CELL = 150
COLS = 5


def main():
    items = list(M.WEAPONS.items())
    rows = (len(items) + COLS - 1) // COLS
    sheet = Canvas(CELL * COLS, CELL * rows)
    for y in range(sheet.h):
        col = lerp_c((34, 30, 28), (58, 50, 44), y / sheet.h)
        sheet.rect(0, y, sheet.w, 1, col)
    for i, (name, (cubes, _, view)) in enumerate(items):
        img = render_icon(cubes, view, size=CELL - 10, max_scale=12)
        sheet.paste(img, (i % COLS) * CELL + 5, (i // COLS) * CELL + 5)
    out = os.path.join(ROOT, "docs", "showcase.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main()
