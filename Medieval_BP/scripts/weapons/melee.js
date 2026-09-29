// Melee weapon abilities (right click) and on-hit passives.
import { system, world } from "@minecraft/server";
import { WEAPONS } from "../config.js";
import { Cause, addEffect, alongLine, awayFrom, hurt, isValidTarget, knock, nearby } from "../util/combat.js";
import { actionbar, particle, particleLine, playerSound, shake, sound } from "../util/fx.js";
import { enchantLevel, getMainhand, wearMainhand } from "../util/items.js";
import { add, centre, dot, flat, mul, sub } from "../util/vec.js";
import { applyBleed, applyStun } from "../systems/status.js";

const cfg = (id) => WEAPONS[id];

function sharpnessBonus(player) {
  const lvl = enchantLevel(getMainhand(player), "sharpness");
  return lvl > 0 ? 0.5 * lvl + 0.5 : 0;
}

// ---------------------------------------------------------------------------
// 기사의 롱소드 - 돌진 베기 (Charge Slash): dash forward cutting everything in the path
// ---------------------------------------------------------------------------
export function chargeSlash(player) {
  const c = cfg("mdv:knight_longsword");
  const dir = flat(player.getViewDirection());
  const dmg = c.damage + sharpnessBonus(player);
  try {
    player.applyKnockback({ x: dir.x * c.dashForce, z: dir.z * c.dashForce }, 0.12);
  } catch {
    /* ignore */
  }
  addEffect(player, "resistance", c.dashTicks + 4, 1, false);
  sound(player.dimension, "mdv.sword.dash", player.location);
  const hit = new Set();
  let tick = 0;
  const run = system.runInterval(() => {
    if (!player.isValid || tick++ >= c.dashTicks) {
      system.clearRun(run);
      return;
    }
    const at = centre(player);
    particle(player.dimension, "mdv:slash", add(at, mul(dir, 0.8)));
    for (const t of nearby(player.dimension, at, c.hitRadius, player)) {
      if (hit.has(t.id)) continue;
      hit.add(t.id);
      hurt(t, dmg, player);
      knock(t, dir, 0.9, 0.25);
      particle(t.dimension, "mdv:spark", centre(t));
      sound(t.dimension, "mdv.sword.hit", t.location, 0.9 + Math.random() * 0.2);
    }
  }, 1);
  return true;
}

// ---------------------------------------------------------------------------
// 전투 망치 - 대지 강타 (Ground Slam): leap and crash down, shockwave on landing
// ---------------------------------------------------------------------------
export function groundSlam(player) {
  const c = cfg("mdv:warhammer");
  const dir = flat(player.getViewDirection());
  const airborne = !player.isOnGround;
  let peakY = player.location.y;
  try {
    if (airborne) player.applyKnockback({ x: 0, z: 0 }, -2.2);
    else player.applyKnockback({ x: dir.x * 1.0, z: dir.z * 1.0 }, 0.85);
  } catch {
    /* ignore */
  }
  // Resistance V makes the landing (fall damage) harmless.
  addEffect(player, "resistance", 80, 4, false);
  sound(player.dimension, "mdv.hammer.leap", player.location);
  let tick = 0;
  const run = system.runInterval(() => {
    tick++;
    if (!player.isValid || tick > 80) {
      system.clearRun(run);
      return;
    }
    peakY = Math.max(peakY, player.location.y);
    if ((airborne || tick > 4) && player.isOnGround) {
      system.clearRun(run);
      shockwave(player, c, peakY - player.location.y);
      system.runTimeout(() => {
        try {
          player.removeEffect("resistance");
        } catch {
          /* ignore */
        }
      }, 3);
    }
  }, 1);
  return true;
}

function shockwave(player, c, fallen) {
  const loc = player.location;
  const dim = player.dimension;
  const bonus = Math.min(c.heightBonusMax, Math.max(0, fallen) * c.heightBonusPerBlock);
  const base = c.damage + bonus + sharpnessBonus(player);
  particle(dim, "mdv:dust_ring", { x: loc.x, y: loc.y + 0.1, z: loc.z });
  particle(dim, "mdv:debris", { x: loc.x, y: loc.y + 0.2, z: loc.z });
  sound(dim, "mdv.hammer.slam", loc, 0.9 + Math.random() * 0.15, 1.2);
  shake(dim, loc, 18, 0.9, 0.45);
  for (const t of nearby(dim, loc, c.radius, player)) {
    const d = Math.hypot(t.location.x - loc.x, t.location.z - loc.z);
    const k = 1 - Math.min(1, d / c.radius);
    hurt(t, base * (0.5 + 0.5 * k), player);
    knock(t, awayFrom(loc, t), 0.5 + 1.3 * k, 0.45 + 0.35 * k);
  }
}

// ---------------------------------------------------------------------------
// 전투 도끼 - 회전 베기 (Whirlwind): three spinning sweeps that cause bleeding
// ---------------------------------------------------------------------------
export function whirlwind(player) {
  const c = cfg("mdv:battle_axe");
  sound(player.dimension, "mdv.axe.whirl", player.location);
  addEffect(player, "resistance", c.pulses * c.pulseInterval, 0, false);
  const dmg = c.damage + sharpnessBonus(player);
  let pulse = 0;
  const doPulse = () => {
    if (!player.isValid) return;
    const at = add(player.location, { x: 0, y: 1, z: 0 });
    particle(player.dimension, "mdv:whirl", at);
    for (const t of nearby(player.dimension, at, c.radius, player)) {
      hurt(t, dmg, player);
      knock(t, awayFrom(player.location, t), 0.55, 0.2);
      applyBleed(t, player);
      particle(t.dimension, "mdv:spark", centre(t));
    }
    if (++pulse < c.pulses) system.runTimeout(doPulse, c.pulseInterval);
  };
  doPulse();
  return true;
}

// ---------------------------------------------------------------------------
// 미늘창 - 관통 찌르기 (Piercing Thrust): skewer every enemy in a 6.5 block line
// ---------------------------------------------------------------------------
export function piercingThrust(player) {
  const c = cfg("mdv:halberd");
  const dir = player.getViewDirection();
  const from = player.getHeadLocation();
  let range = c.range;
  try {
    const block = player.getBlockFromViewDirection({ maxDistance: c.range });
    if (block) {
      const b = block.block.location;
      const f = block.faceLocation;
      range = Math.min(range, Math.hypot(b.x + f.x - from.x, b.y + f.y - from.y, b.z + f.z - from.z));
    }
  } catch {
    /* ignore */
  }
  const to = add(from, mul(dir, range));
  try {
    const fd = flat(dir);
    player.applyKnockback({ x: fd.x * 0.6, z: fd.z * 0.6 }, 0.05);
  } catch {
    /* ignore */
  }
  sound(player.dimension, "mdv.halberd.thrust", player.location);
  particleLine(player.dimension, "mdv:trail", add(from, mul(dir, 0.8)), to, 0.35);
  particle(player.dimension, "mdv:thrust", to);
  const dmg = c.damage + sharpnessBonus(player);
  for (const t of alongLine(player.dimension, from, to, c.width, player)) {
    hurt(t, dmg, player);
    knock(t, dir, 1.4, 0.2);
    particle(t.dimension, "mdv:spark", centre(t));
    sound(t.dimension, "mdv.sword.hit", t.location, 0.75);
  }
  return true;
}

// ---------------------------------------------------------------------------
// 단검 - 그림자 걸음 (Shadow Step): leap backwards and vanish
// ---------------------------------------------------------------------------
export function shadowStep(player) {
  const c = cfg("mdv:dagger");
  const dir = flat(player.getViewDirection());
  particle(player.dimension, "mdv:smoke_burst", add(player.location, { x: 0, y: 1, z: 0 }));
  sound(player.dimension, "mdv.dagger.vanish", player.location);
  try {
    player.applyKnockback({ x: -dir.x * 1.9, z: -dir.z * 1.9 }, 0.3);
  } catch {
    /* ignore */
  }
  addEffect(player, "invisibility", c.invisTicks, 0, false);
  addEffect(player, "speed", c.invisTicks, 1, false);
  return true;
}

// ---------------------------------------------------------------------------
// 모닝스타 - 기절 강타 (Stunning Blow): arm the next hit for a guaranteed heavy stun
// ---------------------------------------------------------------------------
const armed = new Map(); // playerId -> expire tick

export function stunningBlow(player) {
  const c = cfg("mdv:morning_star");
  armed.set(player.id, system.currentTick + c.armedTicks);
  sound(player.dimension, "mdv.mace.ready", player.location);
  particle(player.dimension, "mdv:charge_glint", add(player.getHeadLocation(), mul(player.getViewDirection(), 0.8)));
  actionbar(player, [{ translate: "mdv.msg.stun_ready" }]);
  return true;
}

export function isArmed(player) {
  const t = armed.get(player.id);
  return t !== undefined && t > system.currentTick;
}

// ---------------------------------------------------------------------------
// Passives on regular melee hits
// ---------------------------------------------------------------------------
function isBehind(attacker, target, threshold) {
  try {
    const look = flat(target.getViewDirection());
    const toAttacker = flat(sub(attacker.location, target.location));
    return dot(look, toAttacker) < threshold;
  } catch {
    return false;
  }
}

world.afterEvents.entityHitEntity.subscribe(({ damagingEntity: player, hitEntity: target }) => {
  if (player?.typeId !== "minecraft:player" || !target?.isValid) return;
  const item = getMainhand(player);
  const id = item?.typeId;
  if (!id?.startsWith("mdv:") || !WEAPONS[id]) return;
  if (!isValidTarget(target, player) && target.typeId !== "minecraft:player") return;

  // every melee hit wears the weapon (custom items don't do this on their own)
  if (id !== "mdv:javelin" && id !== "mdv:fire_pot" && id !== "mdv:heavy_crossbow") wearMainhand(player, 1);

  switch (id) {
    case "mdv:knight_longsword":
      sound(target.dimension, "mdv.sword.hit", target.location, 0.95 + Math.random() * 0.1, 0.7);
      particle(target.dimension, "mdv:slash", centre(target));
      break;

    case "mdv:battle_axe": {
      const c = cfg(id);
      sound(target.dimension, "mdv.axe.hit", target.location, 0.9 + Math.random() * 0.2, 0.8);
      if (Math.random() < c.bleedChance) applyBleed(target, player);
      break;
    }

    case "mdv:warhammer":
      sound(target.dimension, "mdv.axe.hit", target.location, 0.6, 0.9);
      knock(target, awayFrom(player.location, target), 0.9, 0.3);
      break;

    case "mdv:halberd":
      // polearm: keeps enemies at bay
      knock(target, awayFrom(player.location, target), 0.8, 0.15);
      break;

    case "mdv:dagger": {
      const c = cfg(id);
      if (isBehind(player, target, c.backstabDot)) {
        const total = (c.damage + sharpnessBonus(player)) * c.backstabMultiplier;
        // applyDamage during hurt-cooldown only deals the difference, so pass the full total
        hurt(target, total, player);
        applyBleed(target, player, 2);
        particle(target.dimension, "mdv:bleed", centre(target));
        sound(target.dimension, "mdv.dagger.backstab", target.location);
        actionbar(player, [{ translate: "mdv.msg.backstab" }]);
      }
      break;
    }

    case "mdv:morning_star": {
      const c = cfg(id);
      if (isArmed(player)) {
        armed.delete(player.id);
        hurt(target, c.damage + c.heavyBonus + sharpnessBonus(player), player);
        applyStun(target, c.heavyStunTicks);
        sound(target.dimension, "mdv.mace.stun", target.location);
        shake(target.dimension, target.location, 8, 0.4, 0.25);
      } else if (Math.random() < c.stunChance) {
        applyStun(target, c.stunTicks);
        sound(target.dimension, "mdv.mace.stun", target.location, 1.2, 0.7);
      }
      break;
    }
    default:
      sound(target.dimension, "mdv.sword.swing", target.location, 1.1, 0.6);
      break;
  }
});
