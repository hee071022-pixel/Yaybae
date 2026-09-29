// Particle / sound / camera helpers. Every call is wrapped because spawning
// into unloaded chunks or on invalid entities throws.
import { add, mul, sub, len } from "./vec.js";

export function particle(dimension, id, location) {
  try {
    dimension.spawnParticle(id, location);
  } catch {
    /* chunk unloaded */
  }
}

/** Particles every `step` blocks along a line. */
export function particleLine(dimension, id, from, to, step = 0.5) {
  const d = sub(to, from);
  const n = Math.min(160, Math.max(1, Math.floor(len(d) / step)));
  for (let i = 0; i <= n; i++) particle(dimension, id, add(from, mul(d, i / n)));
}

export function sound(dimension, id, location, pitch = 1, volume = 1) {
  try {
    dimension.playSound(id, location, { pitch, volume });
  } catch {
    /* ignore */
  }
}

export function playerSound(player, id, pitch = 1, volume = 1) {
  try {
    player.playSound(id, { pitch, volume });
  } catch {
    /* ignore */
  }
}

/** Positional camera shake for every player within `radius`. */
export function shake(dimension, location, radius, intensity, seconds) {
  try {
    for (const p of dimension.getPlayers({ location, maxDistance: radius })) {
      const falloff = 1 - Math.min(1, len(sub(p.location, location)) / radius);
      const k = Math.max(0.05, intensity * falloff).toFixed(2);
      p.runCommand(`camerashake add @s ${k} ${seconds} positional`);
    }
  } catch {
    /* camerashake unavailable */
  }
}

export function actionbar(player, rawtext) {
  try {
    player.onScreenDisplay.setActionBar({ rawtext });
  } catch {
    /* ignore */
  }
}

export function tell(player, key, extra = "") {
  try {
    player.sendMessage({ rawtext: [{ translate: key }, { text: extra }] });
  } catch {
    /* ignore */
  }
}
