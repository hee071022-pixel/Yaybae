// Custom status effects: Bleed (출혈) and Stun (기절).
import { system, world } from "@minecraft/server";
import { BLEED } from "../config.js";
import { Cause, addEffect, hurt } from "../util/combat.js";
import { particle } from "../util/fx.js";
import { centre } from "../util/vec.js";

const bleeding = new Map(); // entityId -> { entity, attacker, left }
const stunned = new Map(); // entityId -> { entity, until }

export function applyBleed(target, attacker, ticks = BLEED.ticks) {
  const cur = bleeding.get(target.id);
  bleeding.set(target.id, { entity: target, attacker, left: Math.max(ticks, cur?.left ?? 0) });
  particle(target.dimension, "mdv:bleed", centre(target));
}

export function applyStun(target, ticks) {
  // Heavy slowness roots the target, weakness + fatigue stop it hitting back.
  addEffect(target, "slowness", ticks, 6, false);
  addEffect(target, "weakness", ticks, 1, false);
  addEffect(target, "mining_fatigue", ticks, 2, false);
  if (target.typeId === "minecraft:player") addEffect(target, "nausea", ticks + 40, 0, false);
  const until = system.currentTick + ticks;
  const cur = stunned.get(target.id);
  stunned.set(target.id, { entity: target, until: Math.max(until, cur?.until ?? 0) });
  const l = target.location;
  particle(target.dimension, "mdv:stun_stars", { x: l.x, y: l.y + headHeight(target), z: l.z });
}

export function isStunned(target) {
  const s = stunned.get(target.id);
  return !!s && s.until > system.currentTick;
}

function headHeight(entity) {
  try {
    return entity.getHeadLocation().y - entity.location.y + 0.5;
  } catch {
    return 2.1;
  }
}

system.runInterval(() => {
  for (const [id, b] of bleeding) {
    if (!b.entity?.isValid || b.left <= 0) {
      bleeding.delete(id);
      continue;
    }
    b.left--;
    hurt(b.entity, BLEED.damage, b.attacker?.isValid ? b.attacker : undefined, Cause.magic);
    particle(b.entity.dimension, "mdv:bleed", centre(b.entity));
  }
}, BLEED.interval);

system.runInterval(() => {
  const now = system.currentTick;
  for (const [id, s] of stunned) {
    if (!s.entity?.isValid || s.until <= now) {
      stunned.delete(id);
      continue;
    }
    const l = s.entity.location;
    particle(s.entity.dimension, "mdv:stun_stars", { x: l.x, y: l.y + headHeight(s.entity), z: l.z });
  }
}, 10);

world.afterEvents.entityDie.subscribe(({ deadEntity }) => {
  bleeding.delete(deadEntity.id);
  stunned.delete(deadEntity.id);
});
