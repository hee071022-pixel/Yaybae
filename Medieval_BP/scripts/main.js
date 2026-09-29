// Medieval Arsenal (중세 무기고) - entry point.
// Wires item-use events to weapon abilities; each system registers its own
// intervals/events on import.
import { system, world } from "@minecraft/server";
import { WEAPONS } from "./config.js";
import { playerSound, tell } from "./util/fx.js";
import { giveItem, startItemCooldown, wearMainhand } from "./util/items.js";
import * as cooldowns from "./systems/cooldowns.js";
import { setStamina, spend } from "./systems/stamina.js";
import "./systems/status.js";
import "./systems/hud.js";
import { chargeSlash, groundSlam, piercingThrust, shadowStep, stunningBlow, whirlwind } from "./weapons/melee.js";
import { crossbowCancel, crossbowRelease, crossbowStart, throwFirePot, throwJavelin } from "./weapons/ranged.js";
import { rally } from "./weapons/support.js";
import { openCodex } from "./ui/codex.js";

const ABILITIES = {
  charge_slash: { run: chargeSlash, wear: 2 },
  ground_slam: { run: groundSlam, wear: 3 },
  whirlwind: { run: whirlwind, wear: 3 },
  piercing_thrust: { run: piercingThrust, wear: 2 },
  shadow_step: { run: shadowStep, wear: 1 },
  stunning_blow: { run: stunningBlow, wear: 0 },
  throw_javelin: { run: throwJavelin, wear: 0 },
  throw_fire_pot: { run: throwFirePot, wear: 0 },
  rally: { run: rally, wear: 0 },
};

function useAbility(player, item) {
  const c = WEAPONS[item.typeId];
  const ability = c && ABILITIES[c.ability];
  if (!ability) return;
  if (!cooldowns.firstThisTick(player)) return;
  if (cooldowns.onCooldown(player, c.ability)) {
    playerSound(player, "mdv.stamina.empty", 1.6, 0.4);
    return;
  }
  if (!spend(player, c.stamina ?? 0)) return;
  let ok = false;
  try {
    ok = ability.run(player, item);
  } catch (e) {
    console.warn(`[mdv] ability ${c.ability} failed: ${e}`);
  }
  if (!ok) return;
  cooldowns.start(player, c.ability, c.cooldown ?? 0);
  // vanilla cooldown bar (visual), then durability wear on the next tick
  startItemCooldown(player, item);
  if (ability.wear > 0) system.run(() => wearMainhand(player, ability.wear));
}

// --- item events -------------------------------------------------------------
world.afterEvents.itemUse.subscribe(({ source: player, itemStack: item }) => {
  if (player?.typeId !== "minecraft:player" || !item?.typeId.startsWith("mdv:")) return;
  if (item.typeId === "mdv:knights_codex") {
    openCodex(player).catch((e) => console.warn(`[mdv] codex: ${e}`));
    return;
  }
  if (item.typeId === "mdv:heavy_crossbow") return; // handled by start/release
  useAbility(player, item);
});

// Right-clicking a block with a weapon (e.g. slamming the ground) also triggers the ability,
// except on blocks that have their own interaction (doors, chests, levers...).
const INTERACTIVE =
  /door|gate|chest|barrel|button|lever|table|furnace|smoker|anvil|bed|shulker|bell|lectern|hopper|dispenser|dropper|brewing|loom|stonecutter|grindstone|beacon|noteblock|repeater|comparator|cake|jukebox|campfire|crafter|sign|frame|pot|composter|cauldron|respawn_anchor/;

world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
  const player = ev.player;
  const item = ev.itemStack ?? ev.beforeItemStack;
  if (ev.isFirstEvent === false || !item?.typeId.startsWith("mdv:")) return;
  if (item.typeId === "mdv:heavy_crossbow" || item.typeId === "mdv:knights_codex") return;
  if (INTERACTIVE.test(ev.block?.typeId ?? "")) return;
  useAbility(player, item);
});

world.afterEvents.itemStartUse.subscribe(({ source: player, itemStack: item }) => {
  if (item?.typeId === "mdv:heavy_crossbow" && player?.typeId === "minecraft:player") crossbowStart(player, item);
});

world.afterEvents.itemReleaseUse.subscribe(({ source: player, itemStack: item }) => {
  if (item?.typeId === "mdv:heavy_crossbow" && player?.typeId === "minecraft:player") crossbowRelease(player, item);
});

world.afterEvents.itemStopUse.subscribe(({ source: player, itemStack: item }) => {
  if (item?.typeId === "mdv:heavy_crossbow" && player?.typeId === "minecraft:player") crossbowCancel(player);
});

// --- welcome: hand every new knight a codex ------------------------------------
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  try {
    if (player.getDynamicProperty("mdv:welcomed")) return;
    player.setDynamicProperty("mdv:welcomed", true);
  } catch {
    return;
  }
  system.runTimeout(() => {
    if (!player.isValid) return;
    giveItem(player, "mdv:knights_codex");
    tell(player, "mdv.msg.welcome");
  }, 40);
});

// --- /scriptevent helpers (cheats / testing) --------------------------------
//   /scriptevent mdv:kit          -> every weapon + supplies
//   /scriptevent mdv:stamina 100  -> set stamina
system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
  if (sourceEntity?.typeId !== "minecraft:player") return;
  if (id === "mdv:kit") {
    for (const w of Object.keys(WEAPONS)) {
      if (w === "mdv:javelin") giveItem(sourceEntity, w, 8);
      else if (w === "mdv:fire_pot") giveItem(sourceEntity, w, 16);
      else giveItem(sourceEntity, w);
    }
    giveItem(sourceEntity, "mdv:crossbow_bolt", 64);
    giveItem(sourceEntity, "mdv:stamina_tonic", 8);
    giveItem(sourceEntity, "mdv:valor_medal", 5);
    giveItem(sourceEntity, "mdv:tempered_steel", 16);
    giveItem(sourceEntity, "mdv:knights_codex");
  } else if (id === "mdv:stamina") {
    setStamina(sourceEntity, Number(message) || 0);
  }
});

console.info("[mdv] Medieval Arsenal loaded");
