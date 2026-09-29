// Support items: War Horn (rally), Stamina Tonic, Valor Medal.
import { world } from "@minecraft/server";
import { STAMINA, WEAPONS } from "../config.js";
import { addEffect, isValidTarget } from "../util/combat.js";
import { particle, playerSound, sound, tell } from "../util/fx.js";
import { consumeMainhand } from "../util/items.js";
import { add } from "../util/vec.js";
import { addMaxStamina, getStamina, setStamina } from "../systems/stamina.js";

// ---------------------------------------------------------------------------
// 전쟁 뿔피리 - 집결 (Rally)
// ---------------------------------------------------------------------------
export function rally(player) {
  const c = WEAPONS["mdv:war_horn"];
  const dim = player.dimension;
  const loc = player.location;
  sound(dim, "mdv.horn.blow", loc, 1, 2);
  particle(dim, "mdv:rally", add(loc, { x: 0, y: 0.2, z: 0 }));
  particle(dim, "mdv:rally_glint", add(loc, { x: 0, y: 1, z: 0 }));

  const allies = dim.getPlayers({ location: loc, maxDistance: c.allyRadius });
  for (const ally of allies) {
    addEffect(ally, "strength", c.buffTicks, 0);
    addEffect(ally, "speed", c.buffTicks, 0);
    addEffect(ally, "resistance", c.buffTicks, 0);
    particle(dim, "mdv:rally_glint", add(ally.location, { x: 0, y: 1, z: 0 }));
    if (ally.id !== player.id) tell(ally, "mdv.msg.rallied", ` §7(${player.name})`);
  }
  // tamed wolves fight harder too
  try {
    for (const pet of dim.getEntities({ location: loc, maxDistance: c.allyRadius, type: "minecraft:wolf" })) {
      if (pet.getComponent("minecraft:tameable")?.isTamed) addEffect(pet, "strength", c.buffTicks, 0);
    }
  } catch {
    /* ignore */
  }
  // the horn demoralises nearby monsters
  try {
    for (const foe of dim.getEntities({ location: loc, maxDistance: c.enemyRadius, families: ["monster"] })) {
      if (!isValidTarget(foe, player)) continue;
      addEffect(foe, "weakness", 160, 0);
      addEffect(foe, "slowness", 60, 0);
    }
  } catch {
    /* ignore */
  }
  tell(player, "mdv.msg.rally", ` §7(${allies.length})`);
  return true;
}

// ---------------------------------------------------------------------------
// Consumables (called on itemCompleteUse)
// ---------------------------------------------------------------------------
export function drinkTonic(player) {
  const s = getStamina(player);
  setStamina(player, s.cur + STAMINA.tonicRestore);
  addEffect(player, "regeneration", 60, 0);
  sound(player.dimension, "mdv.tonic.drink", player.location);
  consumeMainhand(player);
}

export function useMedal(player) {
  if (!addMaxStamina(player, STAMINA.medalBonus)) {
    tell(player, "mdv.msg.medal_max", ` §7(${STAMINA.cap})`);
    playerSound(player, "mdv.stamina.empty", 1.3);
    return;
  }
  const s = getStamina(player);
  particle(player.dimension, "mdv:rally_glint", add(player.location, { x: 0, y: 1, z: 0 }));
  sound(player.dimension, "mdv.medal.use", player.location);
  tell(player, "mdv.msg.medal", ` §6${s.max}`);
  consumeMainhand(player);
}

world.afterEvents.itemCompleteUse.subscribe(({ source: player, itemStack }) => {
  if (player?.typeId !== "minecraft:player") return;
  if (itemStack?.typeId === "mdv:stamina_tonic") drinkTonic(player);
  else if (itemStack?.typeId === "mdv:valor_medal") useMedal(player);
});
