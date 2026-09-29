// World-wide and per-player settings stored as dynamic properties.
import { world } from "@minecraft/server";

const WORLD_DEFAULTS = {
  "mdv:pvp": false, // abilities can hurt other players
  "mdv:fire_spread": false, // fire pots place fire blocks
};

export function getWorldSetting(key) {
  try {
    const v = world.getDynamicProperty(key);
    return v === undefined ? WORLD_DEFAULTS[key] : v;
  } catch {
    return WORLD_DEFAULTS[key];
  }
}

export function setWorldSetting(key, value) {
  try {
    world.setDynamicProperty(key, value);
  } catch {
    /* ignore */
  }
}

export function hudEnabled(player) {
  try {
    return player.getDynamicProperty("mdv:hud") !== false;
  } catch {
    return true;
  }
}

export function setHud(player, value) {
  try {
    player.setDynamicProperty("mdv:hud", value);
  } catch {
    /* ignore */
  }
}

/** Operators (or worlds where the level can't be read) may change world settings. */
export function canEditWorld(player) {
  try {
    const lvl = player.playerPermissionLevel;
    if (lvl === undefined) return true;
    return Number(lvl) >= 2 || String(lvl).toLowerCase() === "operator";
  } catch {
    return true;
  }
}
