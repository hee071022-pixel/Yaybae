"""Procedural medieval sound effects (16-bit mono WAV, stdlib only)."""
import math
import random
import struct
import wave

SR = 22050
TAU = 2 * math.pi


def _write(path, samples, gain=0.9):
    peak = max(1e-9, max(abs(s) for s in samples))
    k = gain / peak
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s * k)) * 32767)) for s in samples))


class Osc:
    """Phase-accumulating oscillator so frequency sweeps stay click free."""
    def __init__(self):
        self.ph = 0.0

    def step(self, f):
        self.ph += TAU * f / SR
        return self.ph


def lowpass(xs, a):
    y = 0.0
    out = []
    for x in xs:
        y += a * (x - y)
        out.append(y)
    return out


def highpass(xs, a):
    y = px = 0.0
    out = []
    for x in xs:
        y = a * (y + x - px)
        px = x
        out.append(y)
    return out


def noise(n, rng):
    return [rng.uniform(-1, 1) for _ in range(n)]


def attack(t, a=0.004):
    return min(1.0, t / a)


def mix(*tracks):
    n = max(len(t) for t in tracks)
    return [sum(t[i] for t in tracks if i < len(t)) for i in range(n)]


def delay(xs, seconds):
    return [0.0] * int(SR * seconds) + list(xs)


def scale(xs, k):
    return [x * k for x in xs]


# --- building blocks ---------------------------------------------------------
def whoosh(rng, dur, cut=0.22, rise=1.5):
    n = int(SR * dur)
    band = highpass(lowpass(noise(n, rng), cut), 0.9)
    return [band[i] * math.sin(math.pi * i / n) ** rise * 1.6 for i in range(n)]


def metal_ring(rng, dur, freqs, decay=6.0, strike=0.5):
    """Inharmonic partials = struck metal."""
    n = int(SR * dur)
    oscs = [(Osc(), f * rng.uniform(0.995, 1.005), rng.uniform(0.4, 1.0)) for f in freqs]
    out = []
    for i in range(n):
        t = i / SR
        s = sum(a * math.sin(o.step(f)) * math.exp(-t * decay * (0.7 + f / 4000)) for o, f, a in oscs)
        s += strike * rng.uniform(-1, 1) * math.exp(-t * 90)
        out.append(s * attack(t, 0.001))
    return out


def thud(rng, dur, f0=110, f1=45, decay=10.0, grit=0.5):
    n = int(SR * dur)
    o = Osc()
    nz = lowpass(noise(n, rng), 0.12)
    out = []
    for i in range(n):
        t = i / SR
        s = math.sin(o.step(f1 + (f0 - f1) * math.exp(-t * 18))) * math.exp(-t * decay)
        s += grit * 3 * nz[i] * math.exp(-t * decay * 0.8)
        out.append(s * attack(t, 0.002))
    return out


def pluck(rng, dur, freq, damp=0.996):
    """Karplus-Strong plucked string (the crossbow twang)."""
    n = int(SR * dur)
    period = max(2, int(SR / freq))
    buf = [rng.uniform(-1, 1) for _ in range(period)]
    out = []
    for i in range(n):
        v = buf[i % period]
        nxt = buf[(i + 1) % period]
        buf[i % period] = damp * 0.5 * (v + nxt)
        out.append(v)
    return out


# --- sounds -------------------------------------------------------------------
def sword_swing(rng):
    return whoosh(rng, 0.32)


def sword_dash(rng):
    return mix(whoosh(rng, 0.55, cut=0.3, rise=1.0), scale(metal_ring(rng, 0.55, [1760, 2630, 3950], 8, 0.1), 0.25))


def sword_hit(rng):
    return mix(metal_ring(rng, 0.5, [1250, 1870, 2960, 4100], 9, 0.8), scale(thud(rng, 0.2, 160, 80, 20, 0.4), 0.6))


def hammer_leap(rng):
    return whoosh(rng, 0.5, cut=0.12, rise=1.2)


def hammer_slam(rng):
    rubble = []
    for k in range(10):
        rubble = mix(rubble, delay(scale(thud(rng, 0.12, 300, 150, 40, 1.0), rng.uniform(0.1, 0.3)), 0.05 + k * 0.05))
    return mix(thud(rng, 1.3, 140, 32, 3.2, 0.7), rubble)


def axe_whirl(rng):
    out = []
    for k in range(3):
        out = mix(out, delay(whoosh(rng, 0.3, 0.25), k * 0.28))
    return out


def axe_hit(rng):
    return mix(thud(rng, 0.3, 220, 90, 14, 0.9), scale(metal_ring(rng, 0.25, [900, 1450], 16, 0.3), 0.35))


def halberd_thrust(rng):
    return mix(whoosh(rng, 0.25, 0.35, 0.8), delay(thud(rng, 0.25, 180, 70, 16, 0.6), 0.16))


def crossbow_wind(rng):
    """Ratchet: a train of short clicks."""
    out = []
    for k in range(9):
        click = [rng.uniform(-1, 1) * math.exp(-i / SR * 400) for i in range(int(SR * 0.03))]
        out = mix(out, delay(scale(highpass(click, 0.7), 0.8), k * 0.085))
    return out


def crossbow_fire(rng):
    return mix(scale(pluck(rng, 0.7, 110, 0.994), 1.0), scale(thud(rng, 0.2, 200, 90, 25, 0.3), 0.8),
               delay(whoosh(rng, 0.25, 0.4, 0.8), 0.02))


def bolt_hit(rng):
    return mix(thud(rng, 0.25, 240, 120, 22, 0.8), scale(pluck(rng, 0.25, 320, 0.98), 0.3))


def dagger_backstab(rng):
    slice_ = highpass(noise(int(SR * 0.18), rng), 0.9)
    slice_ = [s * math.exp(-i / SR * 18) for i, s in enumerate(slice_)]
    return mix(slice_, scale(metal_ring(rng, 0.6, [2100, 3150, 4700], 7, 0.2), 0.6))


def dagger_vanish(rng):
    n = int(SR * 0.6)
    puff = lowpass(noise(n, rng), 0.08)
    return mix([puff[i] * 4 * math.exp(-i / SR * 6) * attack(i / SR, 0.01) for i in range(n)],
               scale(whoosh(rng, 0.4, 0.2), 0.6))


def mace_stun(rng):
    return mix(scale(thud(rng, 0.35, 180, 70, 12, 0.8), 1.2), delay(metal_ring(rng, 1.2, [660, 1017, 1571, 2200], 3.0, 0.2), 0.02))


def mace_ready(rng):
    out = []
    for k in range(3):
        out = mix(out, delay(scale(metal_ring(rng, 0.2, [1400, 2100], 22, 0.4), 0.7), k * 0.09))
    return out


def javelin_throw(rng):
    return whoosh(rng, 0.45, 0.18, 1.0)


def fire_pot_shatter(rng):
    n = int(SR * 1.1)
    shards = []
    for k in range(16):
        f = rng.uniform(1800, 5200)
        shards = mix(shards, delay(scale(metal_ring(rng, 0.12, [f, f * 1.37], 30, 0.6), rng.uniform(0.1, 0.35)), rng.uniform(0, 0.12)))
    roar = lowpass(noise(n, rng), 0.05)
    whoomp = [roar[i] * 5 * (1 - math.exp(-i / SR * 20)) * math.exp(-i / SR * 2.4) for i in range(n)]
    return mix(shards, whoomp, thud(rng, 0.4, 120, 50, 9, 0.3))


def war_horn(rng):
    dur = 2.2
    n = int(SR * dur)
    oscs = [Osc() for _ in range(6)]
    out = []
    for i in range(n):
        t = i / SR
        vib = 1 + 0.008 * math.sin(TAU * 5.2 * t) * min(1, t / 0.6)
        f = 146.8 * vib * (0.94 + 0.06 * min(1.0, t / 0.12))
        s = 0.0
        for k, o in enumerate(oscs):
            s += math.sin(o.step(f * (k + 1))) / (k + 1) ** 0.9
        env = min(1.0, t / 0.18) * (1 if t < dur - 0.4 else max(0.0, (dur - t) / 0.4))
        out.append(s * env)
    return lowpass(out, 0.3)


def drink(rng):
    out = []
    for k in range(3):
        n = int(SR * 0.16)
        o = Osc()
        g = [math.sin(o.step(300 + 500 * (i / n))) * math.sin(math.pi * i / n) for i in range(n)]
        out = mix(out, delay(g, k * 0.22))
    return out


def medal(rng):
    notes = [523.3, 659.3, 784.0, 1046.5]
    out = []
    for k, f in enumerate(notes):
        out = mix(out, delay(metal_ring(rng, 1.2, [f, f * 2.0, f * 3.01], 3.5, 0.05), k * 0.1))
    return out


def page_flip(rng):
    n = int(SR * 0.3)
    nz = highpass(noise(n, rng), 0.8)
    return [nz[i] * math.sin(math.pi * i / n) ** 3 for i in range(n)]


def stamina_empty(rng):
    n = int(SR * 0.35)
    o = Osc()
    breath = lowpass(noise(n, rng), 0.15)
    return [breath[i] * 3 * math.sin(math.pi * i / n) + 0.15 * math.sin(o.step(180)) * math.sin(math.pi * i / n)
            for i in range(n)]


def hitmarker(rng):
    return scale(metal_ring(rng, 0.08, [2600], 40, 0.1), 0.6)


SOUNDS = {
    "sword_swing": sword_swing,
    "sword_dash": sword_dash,
    "sword_hit": sword_hit,
    "hammer_leap": hammer_leap,
    "hammer_slam": hammer_slam,
    "axe_whirl": axe_whirl,
    "axe_hit": axe_hit,
    "halberd_thrust": halberd_thrust,
    "crossbow_wind": crossbow_wind,
    "crossbow_fire": crossbow_fire,
    "bolt_hit": bolt_hit,
    "dagger_backstab": dagger_backstab,
    "dagger_vanish": dagger_vanish,
    "mace_stun": mace_stun,
    "mace_ready": mace_ready,
    "javelin_throw": javelin_throw,
    "fire_pot_shatter": fire_pot_shatter,
    "war_horn": war_horn,
    "drink": drink,
    "medal": medal,
    "page_flip": page_flip,
    "stamina_empty": stamina_empty,
    "hitmarker": hitmarker,
}


def generate(out_dir, seed=11):
    for name, fn in SOUNDS.items():
        rng = random.Random(f"{seed}:{name}")
        _write(f"{out_dir}/{name}.wav", fn(rng))
