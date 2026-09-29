"""Tiny dependency-free RGBA canvas + PNG writer used by the asset generator."""
import math
import struct
import zlib


class Canvas:
    def __init__(self, w, h, fill=(0, 0, 0, 0)):
        self.w = w
        self.h = h
        self.px = [fill] * (w * h)

    # --- pixel access -----------------------------------------------------
    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y * self.w + x]
        return (0, 0, 0, 0)

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            if len(c) == 3:
                c = (c[0], c[1], c[2], 255)
            self.px[y * self.w + x] = tuple(max(0, min(255, int(round(v)))) for v in c)

    def blend(self, x, y, c, a):
        """Alpha-blend colour c over the pixel with opacity a (0..1)."""
        if not (0 <= x < self.w and 0 <= y < self.h) or a <= 0:
            return
        r, g, b, da = self.get(x, y)
        a = min(1.0, a)
        out_a = a + (da / 255.0) * (1 - a)
        if out_a <= 0:
            return
        def mix(s, d):
            return (s * a + d * (da / 255.0) * (1 - a)) / out_a
        self.set(x, y, (mix(c[0], r), mix(c[1], g), mix(c[2], b), out_a * 255))

    def add(self, x, y, c, a):
        """Additive glow."""
        if not (0 <= x < self.w and 0 <= y < self.h) or a <= 0:
            return
        r, g, b, da = self.get(x, y)
        self.set(x, y, (r + c[0] * a, g + c[1] * a, b + c[2] * a, max(da, min(255, a * 255 + da))))

    # --- primitives ---------------------------------------------------------
    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, c)

    def circle(self, cx, cy, r, c, soft=0.0):
        for yy in range(int(cy - r - 2), int(cy + r + 3)):
            for xx in range(int(cx - r - 2), int(cx + r + 3)):
                d = math.hypot(xx + 0.5 - cx, yy + 0.5 - cy)
                if soft > 0:
                    a = max(0.0, min(1.0, (r - d) / soft))
                    if a > 0:
                        self.blend(xx, yy, c, a)
                elif d <= r:
                    self.set(xx, yy, c)

    def polygon(self, pts, c):
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        for yy in range(int(min(ys)) - 1, int(max(ys)) + 2):
            for xx in range(int(min(xs)) - 1, int(max(xs)) + 2):
                if point_in_poly(xx + 0.5, yy + 0.5, pts):
                    self.set(xx, yy, c)

    def line(self, x0, y0, x1, y1, c):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1):
            t = i / max(1, n)
            self.set(int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t)), c)

    def outline(self, c=(18, 18, 26, 255), threshold=40):
        """Paint a 1px outline on transparent pixels that touch opaque ones."""
        marks = []
        for y in range(self.h):
            for x in range(self.w):
                if self.get(x, y)[3] < threshold:
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        if self.get(x + dx, y + dy)[3] >= threshold:
                            marks.append((x, y))
                            break
        for x, y in marks:
            self.set(x, y, c)

    def paste(self, other, ox, oy, scale=1):
        for y in range(other.h * scale):
            for x in range(other.w * scale):
                c = other.get(x // scale, y // scale)
                if c[3] > 0:
                    self.blend(ox + x, oy + y, c[:3], c[3] / 255.0)

    # --- output -------------------------------------------------------------
    def save(self, path):
        raw = bytearray()
        for y in range(self.h):
            raw.append(0)
            for x in range(self.w):
                raw.extend(self.px[y * self.w + x])
        def chunk(tag, data):
            body = tag + data
            return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        png = b"\x89PNG\r\n\x1a\n"
        png += chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 6, 0, 0, 0))
        png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        png += chunk(b"IEND", b"")
        with open(path, "wb") as f:
            f.write(png)


def point_in_poly(x, y, pts):
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c[:3])


def lerp_c(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
