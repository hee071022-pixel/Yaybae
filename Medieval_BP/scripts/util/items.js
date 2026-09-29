// Inventory / equipment helpers.
import { EquipmentSlot, ItemStack } from "@minecraft/server";
import { sound } from "./fx.js";

export function isCreative(player) {
  try {
    return String(player.getGameMode()).toLowerCase() === "creative";
  } catch {
    return false;
  }
}

export function getMainhand(player) {
  try {
    return player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
  } catch {
    return undefined;
  }
}

export function setMainhand(player, item) {
  try {
    player.getComponent("minecraft:equippable")?.setEquipment(EquipmentSlot.Mainhand, item);
  } catch {
    /* ignore */
  }
}

export function enchantLevel(item, id) {
  try {
    return item?.getComponent("minecraft:enchantable")?.getEnchantment(id)?.level ?? 0;
  } catch {
    return 0;
  }
}

/** Starts the vanilla cooldown bar for the held item (visual only). */
export function startItemCooldown(player, item) {
  try {
    item?.getComponent("minecraft:cooldown")?.startCooldown(player);
  } catch {
    /* ignore */
  }
}

/**
 * Damages the held item, honouring Unbreaking. Must NOT be called while the
 * player is mid-use (charging the crossbow) because rewriting the slot cancels use.
 */
export function wearMainhand(player, amount = 1) {
  if (isCreative(player)) return;
  const item = getMainhand(player);
  const dur = item?.getComponent("minecraft:durability");
  if (!dur) return;
  const unbreaking = enchantLevel(item, "unbreaking");
  let wear = 0;
  for (let i = 0; i < amount; i++) if (Math.random() < 1 / (unbreaking + 1)) wear++;
  if (wear === 0) return;
  if (dur.damage + wear >= dur.maxDurability) {
    setMainhand(player, undefined);
    sound(player.dimension, "random.break", player.location);
    return;
  }
  dur.damage += wear;
  setMainhand(player, item);
}

/** Removes one of the held item (mainhand) unless in creative. */
export function consumeMainhand(player) {
  if (isCreative(player)) return;
  const item = getMainhand(player);
  if (!item) return;
  if (item.amount > 1) {
    item.amount -= 1;
    setMainhand(player, item);
  } else {
    setMainhand(player, undefined);
  }
}

/** Finds and removes one item of the first matching type. Returns the type used or undefined. */
export function takeAmmo(player, typeIds) {
  if (isCreative(player)) return typeIds[0];
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return undefined;
  for (const typeId of typeIds) {
    for (let slot = 0; slot < container.size; slot++) {
      const it = container.getItem(slot);
      if (it?.typeId !== typeId) continue;
      if (it.amount > 1) {
        it.amount -= 1;
        container.setItem(slot, it);
      } else {
        container.setItem(slot, undefined);
      }
      return typeId;
    }
  }
  return undefined;
}

export function hasAny(player, typeIds) {
  if (isCreative(player)) return true;
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return false;
  for (let slot = 0; slot < container.size; slot++) {
    if (typeIds.includes(container.getItem(slot)?.typeId)) return true;
  }
  return false;
}

export function giveItem(player, typeId, amount = 1) {
  try {
    const container = player.getComponent("minecraft:inventory")?.container;
    const left = container?.addItem(new ItemStack(typeId, amount));
    if (left) player.dimension.spawnItem(left, player.location);
  } catch {
    /* ignore */
  }
}

export function dropItem(dimension, typeId, location) {
  try {
    dimension.spawnItem(new ItemStack(typeId, 1), location);
  } catch {
    /* ignore */
  }
}
