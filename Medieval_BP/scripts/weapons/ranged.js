// Ranged & thrown weapons: Heavy Crossbow (charge + release), Javelin, Fire Pot.
import { system } from "@minecraft/server";
import { WEAPONS } from "../config.js";
import { Cause, hurt, knock, nearby } from "../util/combat.js";
import { particle, playerSound, shake, sound, tell } from "../util/fx.js";
import { consumeMainhand, dropItem, enchantLevel, hasAny, isCreative, takeAmmo, wearMainhand } from "../util/items.js";
import { add, centre, flat, mul, norm, yaw } from "../util/vec.js";
import { launch, muzzle, registerProjectile } from "../systems/projectiles.js";
import { getWorldSetting } from "../systems/settings.js";

const AMMO = ["mdv:crossbow_bolt", "minecraft:arrow"];

// ---------------------------------------------------------------------------
// 중석궁 (Heavy Crossbow): hold use to wind, release to fire.
// ---------------------------------------------------------------------------
const charging = new Map(); // playerId -> { start, full, notified, run }

export function crossbowChargeRatio(player) {
  const s = charging.get(player.id);
  if (!s) return undefined;
  return Math.min(1, (system.currentTick - s.start) / s.full);
}

export function crossbowStart(player, item) {
  const c = WEAPONS["mdv:heavy_crossbow"];
  if (!hasAny(player, AMMO)) {
    playerSound(player, "mdv.stamina.empty", 1.4);
    tell(player, "mdv.msg.no_ammo");
    return;
  }
  const quick = enchantLevel(item, "quick_charge");
  const full = Math.max(10, c.fullCharge - quick * 5);
  const s = { start: system.currentTick, full, notified: false, run: 0 };
  sound(player.dimension, "mdv.crossbow.wind", player.location, 1 + quick * 0.15);
  s.run = system.runInterval(() => {
    if (!player.isValid || charging.get(player.id) !== s) {
      system.clearRun(s.run);
      return;
    }
    if (!s.notified && system.currentTick - s.start >= s.full) {
      s.notified = true;
      playerSound(player, "mdv.hitmarker", 0.8, 1);
      particle(player.dimension, "mdv:charge_glint", muzzle(player, 0.7, 0.3));
    }
  }, 2);
  charging.set(player.id, s);
}

export function crossbowCancel(player) {
  const s = charging.get(player.id);
  if (!s) return;
  // deferred so a release event in the same tick can still read the charge
  system.run(() => {
    if (charging.get(player.id) === s) {
      system.clearRun(s.run);
      charging.delete(player.id);
    }
  });
}

export function crossbowRelease(player, item) {
  const c = WEAPONS["mdv:heavy_crossbow"];
  const s = charging.get(player.id);
  if (!s) return;
  charging.delete(player.id);
  system.clearRun(s.run);
  const ratio = Math.min(1, (system.currentTick - s.start) / s.full);
  if (ratio < c.minRatio) return;
  const ammo = takeAmmo(player, AMMO);
  if (!ammo) {
    tell(player, "mdv.msg.no_ammo");
    return;
  }
  const full = ratio >= 1;
  const multishot = enchantLevel(item, "multishot") > 0;
  const pierce = enchantLevel(item, "piercing");
  const power = enchantLevel(item, "power");
  let dmg = c.damageMin + (c.damageMax - c.damageMin) * ratio + (ammo === "mdv:crossbow_bolt" ? c.boltBonus : 0);
  dmg *= 1 + 0.15 * power;
  if (full) dmg *= c.critMultiplier;
  const speed = c.speedMin + (c.speedMax - c.speedMin) * ratio;
  const dir = player.getViewDirection();
  const spreads = multishot ? [-8, 0, 8] : [0];
  for (const deg of spreads) {
    const d = deg === 0 ? dir : norm(yaw(dir, deg));
    launch(player, "mdv:crossbow_bolt", muzzle(player), mul(d, speed), {
      kind: "bolt",
      damage: deg === 0 ? dmg : dmg * 0.6,
      pierce,
      crit: full,
      speed,
      dir: d,
      ammo: deg === 0 ? ammo : undefined,
    });
  }
  sound(player.dimension, "mdv.crossbow.fire", player.location, full ? 0.9 : 1.1);
  if (full) {
    const fd = flat(dir);
    try {
      player.applyKnockback({ x: -fd.x * 0.35, z: -fd.z * 0.35 }, 0.05);
    } catch {
      /* ignore */
    }
  }
  // slot rewrite is safe now that the use has ended
  system.run(() => wearMainhand(player, 1));
}

registerProjectile("bolt", {
  onEntity({ data, projectile, target, location }) {
    if (!target) return;
    hurt(target, data.damage, data.owner, Cause.projectile, projectile);
    knock(target, data.dir, data.crit ? 0.9 : 0.5, 0.2);
    particle(target.dimension, data.crit ? "mdv:spark" : "mdv:trail", centre(target));
    sound(target.dimension, "mdv.bolt.hit", location);
    if (data.owner?.isValid) playerSound(data.owner, "mdv.hitmarker", data.crit ? 0.8 : 1.1);
    // Piercing: re-launch a fresh bolt just past the target
    if (data.pierce > 0 && data.owner?.isValid) {
      const from = add(centre(target), mul(data.dir, 0.9));
      launch(data.owner, "mdv:crossbow_bolt", from, mul(data.dir, data.speed), {
        ...data,
        damage: data.damage * 0.85,
        pierce: data.pierce - 1,
        ammo: undefined,
      });
    }
  },
  onBlock({ data, dimension, location }) {
    sound(dimension, "mdv.bolt.hit", location, 1.3, 0.6);
    // recover real bolts that hit terrain (arrows are not refunded, like vanilla crossbows)
    if (data.ammo === "mdv:crossbow_bolt" && data.owner?.isValid && !isCreative(data.owner) && Math.random() < 0.5) {
      dropItem(dimension, "mdv:crossbow_bolt", location);
    }
  },
});

// ---------------------------------------------------------------------------
// 투창 (Javelin)
// ---------------------------------------------------------------------------
export function throwJavelin(player) {
  const c = WEAPONS["mdv:javelin"];
  const dir = player.getViewDirection();
  const creative = isCreative(player);
  launch(player, "mdv:thrown_javelin", muzzle(player, 1.0, 0.1), mul(dir, c.speed), {
    kind: "javelin",
    damage: c.damage,
    dir,
    refund: !creative,
  });
  sound(player.dimension, "mdv.javelin.throw", player.location);
  consumeMainhand(player);
  return true;
}

registerProjectile("javelin", {
  onEntity({ data, projectile, target, location, dimension }) {
    if (target) {
      hurt(target, data.damage, data.owner, Cause.projectile, projectile);
      knock(target, data.dir, 1.0, 0.35);
      particle(dimension, "mdv:spark", centre(target));
      if (data.owner?.isValid) playerSound(data.owner, "mdv.hitmarker");
    }
    sound(dimension, "mdv.bolt.hit", location, 0.8);
    if (data.refund) dropItem(dimension, "mdv:javelin", location);
  },
  onBlock({ data, dimension, location }) {
    sound(dimension, "mdv.bolt.hit", location, 0.7);
    if (data.refund) dropItem(dimension, "mdv:javelin", add(location, mul(data.dir, -0.4)));
  },
});

// ---------------------------------------------------------------------------
// 화염 항아리 (Fire Pot) - medieval "greek fire" grenade
// ---------------------------------------------------------------------------
export function throwFirePot(player) {
  const c = WEAPONS["mdv:fire_pot"];
  const dir = player.getViewDirection();
  const vel = add(mul(dir, c.speed), { x: 0, y: 0.15, z: 0 });
  launch(player, "mdv:thrown_fire_pot", muzzle(player, 0.8, 0.1), vel, { kind: "fire_pot" });
  sound(player.dimension, "mdv.javelin.throw", player.location, 1.3, 0.7);
  consumeMainhand(player);
  return true;
}

function firePotBurst(owner, dimension, location) {
  const c = WEAPONS["mdv:fire_pot"];
  particle(dimension, "mdv:flame_burst", location);
  particle(dimension, "mdv:smoke_burst", add(location, { x: 0, y: 0.5, z: 0 }));
  sound(dimension, "mdv.fire_pot.shatter", location);
  shake(dimension, location, 10, 0.3, 0.3);
  for (const t of nearby(dimension, location, c.radius, owner?.isValid ? owner : undefined)) {
    try {
      t.setOnFire(c.burnSeconds, true);
    } catch {
      /* ignore */
    }
    hurt(t, c.damage, owner, Cause.fire);
  }
  if (getWorldSetting("mdv:fire_spread")) spreadFire(dimension, location);
}

function spreadFire(dimension, location) {
  for (let i = 0; i < 14; i++) {
    const p = {
      x: Math.floor(location.x + (Math.random() * 2 - 1) * 2.5),
      y: Math.floor(location.y),
      z: Math.floor(location.z + (Math.random() * 2 - 1) * 2.5),
    };
    try {
      for (let dy = 1; dy >= -2; dy--) {
        const b = dimension.getBlock({ x: p.x, y: p.y + dy, z: p.z });
        const below = b?.below();
        if (b?.isAir && below && !below.isAir && !below.isLiquid) {
          b.setType("minecraft:fire");
          break;
        }
      }
    } catch {
      /* unloaded */
    }
  }
}

registerProjectile("fire_pot", {
  onEntity: ({ data, dimension, location }) => firePotBurst(data.owner, dimension, location),
  onBlock: ({ data, dimension, location }) => firePotBurst(data.owner, dimension, location),
});

export function crossbowHud(player) {
  const r = crossbowChargeRatio(player);
  if (r === undefined) return undefined;
  const n = Math.round(r * 12);
  const col = r >= 1 ? "§6" : "§e";
  return [{ translate: "mdv.hud.draw" }, { text: ` ${col}${"|".repeat(n * 2)}§8${"|".repeat((12 - n) * 2)}` }];
}

