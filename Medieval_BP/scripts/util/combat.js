// Targeting and damage helpers shared by every weapon.
import { EntityDamageCause } from "@minecraft/server";
import { IGNORE_TYPES } from "../config.js";
import { getWorldSetting } from "../systems/settings.js";
import { centre, distToSegment, flat, sub } from "./vec.js";

const CAUSE_ATTACK = EntityDamageCause?.entityAttack ?? "entityAttack";
const CAUSE_PROJECTILE = EntityDamageCause?.projectile ?? "projectile";
const CAUSE_MAGIC = EntityDamageCause?.magic ?? "magic";
const CAUSE_FIRE = EntityDamageCause?.fire ?? "fire";

export const Cause = { attack: CAUSE_ATTACK, projectile: CAUSE_PROJECTILE, magic: CAUSE_MAGIC, fire: CAUSE_FIRE };

/** Can `attacker` hurt `target` with an ability? */
export function isValidTarget(target, attacker) {
  try {
    if (!target?.isValid || target.id === attacker?.id) return false;
    if (IGNORE_TYPES.includes(target.typeId)) return false;
    if (!target.getComponent("minecraft:health")) return false;
    if (target.typeId === "minecraft:player") {
      if (!getWorldSetting("mdv:pvp")) return false;
    }
    const tame = target.getComponent("minecraft:tameable");
    if (attacker && tame?.isTamed && tame.tamedToPlayerId === attacker.id) return false;
    const ride = attacker?.getComponent?.("minecraft:riding");
    if (ride?.entityRidingOn?.id === target.id) return false;
    return true;
  } catch {
    return false;
  }
}

export function nearby(dimension, location, radius, attacker) {
  try {
    return dimension
      .getEntities({ location, maxDistance: radius, excludeFamilies: ["inanimate"], excludeTypes: IGNORE_TYPES })
      .filter((e) => isValidTarget(e, attacker));
  } catch {
    return [];
  }
}

/** Every valid target whose body is within `width` of the segment a->b. */
export function alongLine(dimension, a, b, width, attacker) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  const half = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 2 + width + 1;
  return nearby(dimension, mid, half, attacker).filter((e) => {
    const c = centre(e);
    return Math.min(distToSegment(c, a, b), distToSegment(e.location, a, b)) <= width;
  });
}

export function hurt(target, amount, attacker, cause = CAUSE_ATTACK, projectile) {
  try {
    const opts = { cause };
    if (attacker?.isValid) opts.damagingEntity = attacker;
    if (projectile?.isValid) opts.damagingProjectile = projectile;
    return target.applyDamage(amount, opts);
  } catch {
    try {
      return target.applyDamage(amount);
    } catch {
      return false;
    }
  }
}

/** Knock target along an XZ direction. Works for players and mobs (2.0 signature). */
export function knock(target, dir, horizontal, vertical) {
  const d = flat(dir);
  try {
    target.applyKnockback({ x: d.x * horizontal, z: d.z * horizontal }, vertical);
  } catch {
    /* some entities (e.g. ender dragon) refuse knockback */
  }
}

/** Direction pushing `target` away from `origin`. */
export function awayFrom(origin, target) {
  return flat(sub(target.location, origin));
}

export function addEffect(entity, id, ticks, amplifier = 0, showParticles = true) {
  try {
    entity.addEffect(id, ticks, { amplifier, showParticles });
  } catch {
    /* ignore */
  }
}
