// Spawning custom projectiles and routing their hits back to the weapon code.
import { system, world } from "@minecraft/server";
import { PROJECTILE_TYPES } from "../config.js";
import { add, mul } from "../util/vec.js";

const meta = new Map(); // projectile entity id -> data given at launch
const handlers = new Map(); // kind -> { onEntity(ctx), onBlock(ctx) }

export function registerProjectile(kind, handler) {
  handlers.set(kind, handler);
}

/**
 * Launch `typeId` from `origin` with `velocity`. `data.kind` selects the hit handler.
 * Returns the entity or undefined.
 */
export function launch(owner, typeId, origin, velocity, data) {
  let proj;
  try {
    proj = owner.dimension.spawnEntity(typeId, origin);
  } catch {
    return undefined;
  }
  meta.set(proj.id, { ...data, owner, spawnTick: system.currentTick });
  try {
    const comp = proj.getComponent("minecraft:projectile");
    if (comp) {
      comp.owner = owner;
      comp.shoot(velocity, { uncertainty: 0 });
      return proj;
    }
  } catch {
    /* fall through to impulse */
  }
  try {
    proj.applyImpulse(velocity);
  } catch {
    /* ignore */
  }
  return proj;
}

/** Point just in front of the eyes, used as muzzle / release position. */
export function muzzle(player, forward = 0.9, drop = 0.15) {
  const head = player.getHeadLocation();
  const dir = player.getViewDirection();
  return add(add(head, mul(dir, forward)), { x: 0, y: -drop, z: 0 });
}

function route(ev, isEntity) {
  const proj = ev.projectile;
  if (!proj || !PROJECTILE_TYPES.includes(proj.typeId)) return;
  const data = meta.get(proj.id);
  if (!data) return;
  meta.delete(proj.id);
  const h = handlers.get(data.kind);
  if (!h) return;
  const ctx = { data, projectile: proj, dimension: ev.dimension, location: ev.location, hitVector: ev.hitVector };
  try {
    if (isEntity) {
      const hit = ev.getEntityHit()?.entity;
      if (hit?.id === data.owner?.id) return;
      h.onEntity?.({ ...ctx, target: hit });
    } else {
      h.onBlock?.({ ...ctx, block: ev.getBlockHit()?.block });
    }
  } catch (e) {
    console.warn(`[mdv] projectile handler ${data.kind} failed: ${e}`);
  }
}

world.afterEvents.projectileHitEntity.subscribe((ev) => route(ev, true));
world.afterEvents.projectileHitBlock.subscribe((ev) => route(ev, false));

// forget projectiles that despawned without hitting anything
system.runInterval(() => {
  const now = system.currentTick;
  for (const [id, d] of meta) if (now - d.spawnTick > 20 * 15) meta.delete(id);
}, 200);
