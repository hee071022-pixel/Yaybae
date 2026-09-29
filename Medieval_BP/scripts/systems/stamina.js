// Stamina (기력): the shared resource every weapon ability spends.
// Kept in memory for speed and mirrored into player dynamic properties.
import { system, world } from "@minecraft/server";
import { STAMINA } from "../config.js";
import { playerSound, tell } from "../util/fx.js";
import { isCreative } from "../util/items.js";

const state = new Map(); // playerId -> { cur, max, lastSpend, dirty }

function load(player) {
  let s = state.get(player.id);
  if (s) return s;
  let max = STAMINA.base;
  let cur = STAMINA.base;
  try {
    max = Number(player.getDynamicProperty("mdv:stamina_max") ?? STAMINA.base);
    cur = Number(player.getDynamicProperty("mdv:stamina") ?? max);
  } catch {
    /* ignore */
  }
  s = { cur: Math.min(cur, max), max, lastSpend: -9999, dirty: false };
  state.set(player.id, s);
  return s;
}

export function getStamina(player) {
  const s = load(player);
  return { cur: s.cur, max: s.max, lastSpend: s.lastSpend };
}

export function setStamina(player, value) {
  const s = load(player);
  s.cur = Math.max(0, Math.min(s.max, value));
  s.dirty = true;
}

export function addMaxStamina(player, amount) {
  const s = load(player);
  if (s.max >= STAMINA.cap) return false;
  s.max = Math.min(STAMINA.cap, s.max + amount);
  s.cur = s.max;
  s.dirty = true;
  return true;
}

/** Try to pay `cost`. Plays a tired sound + message when short. */
export function spend(player, cost) {
  if (cost <= 0) return true;
  const s = load(player);
  if (isCreative(player)) {
    s.lastSpend = system.currentTick;
    return true;
  }
  if (s.cur < cost) {
    playerSound(player, "mdv.stamina.empty");
    tell(player, "mdv.msg.no_stamina");
    return false;
  }
  s.cur -= cost;
  s.lastSpend = system.currentTick;
  s.dirty = true;
  return true;
}

// regen + persistence
system.runInterval(() => {
  const now = system.currentTick;
  const perStep = STAMINA.regenPerSecond / 4;
  for (const player of world.getAllPlayers()) {
    const s = load(player);
    if (s.cur < s.max && now - s.lastSpend > STAMINA.regenDelay) {
      const sprinting = player.isSprinting ? 0.35 : 1;
      s.cur = Math.min(s.max, s.cur + perStep * sprinting);
      s.dirty = true;
    }
    if (s.dirty && now % 20 === 0) {
      try {
        player.setDynamicProperty("mdv:stamina", Math.round(s.cur * 10) / 10);
        player.setDynamicProperty("mdv:stamina_max", s.max);
        s.dirty = false;
      } catch {
        /* ignore */
      }
    }
  }
}, 5);

world.afterEvents.playerLeave.subscribe(({ playerId }) => state.delete(playerId));
