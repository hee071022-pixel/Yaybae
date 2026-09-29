// Action-bar HUD: stamina bar, ability cooldown and crossbow draw meter.
import { system, world } from "@minecraft/server";
import { HUD_ITEMS, WEAPONS } from "../config.js";
import { actionbar } from "../util/fx.js";
import { getMainhand } from "../util/items.js";
import { remaining } from "./cooldowns.js";
import { hudEnabled } from "./settings.js";
import { getStamina } from "./stamina.js";
import { crossbowHud } from "../weapons/ranged.js";
import { isArmed } from "../weapons/melee.js";

const SEGMENTS = 20;

function staminaBar(cur, max) {
  const n = Math.round((cur / max) * SEGMENTS);
  const col = cur / max > 0.5 ? "§a" : cur / max > 0.2 ? "§e" : "§c";
  return `§8[${col}${"|".repeat(n)}§8${"|".repeat(SEGMENTS - n)}§8] §f${Math.floor(cur)}§7/${max}`;
}

system.runInterval(() => {
  const now = system.currentTick;
  for (const player of world.getAllPlayers()) {
    if (!hudEnabled(player)) continue;
    const id = getMainhand(player)?.typeId;
    const s = getStamina(player);
    const recentlySpent = now - s.lastSpend < 60;
    if (!HUD_ITEMS.has(id) && !(recentlySpent && s.cur < s.max)) continue;

    const draw = id === "mdv:heavy_crossbow" ? crossbowHud(player) : undefined;
    if (draw) {
      actionbar(player, draw);
      continue;
    }
    const parts = [{ text: "§6" }, { translate: "mdv.hud.stamina" }, { text: ` ${staminaBar(s.cur, s.max)}` }];
    const c = WEAPONS[id];
    if (c?.cooldown) {
      const left = remaining(player, c.ability);
      parts.push({ text: "  §8| " });
      if (left > 0) parts.push({ text: `§c${(left / 20).toFixed(1)}s` });
      else parts.push({ text: "§a" }, { translate: "mdv.hud.ready" });
    }
    if (id === "mdv:morning_star" && isArmed(player)) parts.push({ text: "  §e★" });
    actionbar(player, parts);
  }
}, 4);
