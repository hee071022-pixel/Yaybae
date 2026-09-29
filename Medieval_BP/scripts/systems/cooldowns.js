// Per-player ability cooldowns (tick based).
import { system } from "@minecraft/server";

const ready = new Map(); // `${playerId}|${key}` -> tick when usable again

export function remaining(player, key) {
  return Math.max(0, (ready.get(`${player.id}|${key}`) ?? 0) - system.currentTick);
}

export function onCooldown(player, key) {
  return remaining(player, key) > 0;
}

export function start(player, key, ticks) {
  ready.set(`${player.id}|${key}`, system.currentTick + ticks);
}

// A same-tick guard so itemUse + playerInteractWithBlock never double fire.
const lastTrigger = new Map();
export function firstThisTick(player) {
  const t = system.currentTick;
  if (lastTrigger.get(player.id) === t) return false;
  lastTrigger.set(player.id, t);
  return true;
}
