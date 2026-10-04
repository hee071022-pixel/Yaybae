// 기사의 교본 (Knight's Codex): weapon encyclopedia, status page and settings.
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { STAMINA, WEAPONS } from "../config.js";
import { playerSound, tell } from "../util/fx.js";
import { getStamina } from "../systems/stamina.js";
import { canEditWorld, getWorldSetting, hudEnabled, setHud, setWorldSetting } from "../systems/settings.js";

const T = (key) => ({ translate: key });
const raw = (...parts) => ({ rawtext: parts.map((p) => (typeof p === "string" ? { text: p } : p)) });

const ENTRIES = [
  "mdv:knight_longsword",
  "mdv:warhammer",
  "mdv:battle_axe",
  "mdv:halberd",
  "mdv:heavy_crossbow",
  "mdv:dagger",
  "mdv:morning_star",
  "mdv:javelin",
  "mdv:fire_pot",
  "mdv:primordial_blade",
  "mdv:war_horn",
  "mdv:stamina_tonic",
  "mdv:valor_medal",
];

const icon = (id) => `textures/items/mdv/${id.split(":")[1]}`;

export async function openCodex(player) {
  playerSound(player, "mdv.codex.open");
  const s = getStamina(player);
  const form = new ActionFormData()
    .title(raw(T("mdv.ui.title")))
    .body(raw(T("mdv.ui.body"), `\n\n§6`, T("mdv.hud.stamina"), `§f ${Math.floor(s.cur)} / ${s.max}`))
    .button(raw(T("mdv.ui.armory")), "textures/items/mdv/knight_longsword")
    .button(raw(T("mdv.ui.guide")), "textures/items/mdv/knights_codex")
    .button(raw(T("mdv.ui.settings")), "textures/items/mdv/tempered_steel");
  const res = await form.show(player);
  if (res.canceled) return;
  if (res.selection === 0) return armory(player);
  if (res.selection === 1) return guide(player);
  if (res.selection === 2) return settings(player);
}

async function armory(player) {
  const form = new ActionFormData().title(raw(T("mdv.ui.armory"))).body(raw(T("mdv.ui.armory_body")));
  for (const id of ENTRIES) form.button(raw(T(`item.${id}.name`)), icon(id));
  const res = await form.show(player);
  if (res.canceled || res.selection === undefined) return openCodex(player);
  return entry(player, ENTRIES[res.selection]);
}

async function entry(player, id) {
  playerSound(player, "mdv.codex.open", 1.2);
  const c = WEAPONS[id];
  const stats = [];
  if (c?.damage) stats.push("\n§c", T("mdv.ui.stat_damage"), ` §f${c.damage}`);
  if (c?.stamina) stats.push("\n§a", T("mdv.ui.stat_stamina"), ` §f${c.stamina}`);
  if (c?.cooldown) stats.push("\n§b", T("mdv.ui.stat_cooldown"), ` §f${(c.cooldown / 20).toFixed(1)}s`);
  const form = new ActionFormData()
    .title(raw(T(`item.${id}.name`)))
    .body(raw(T(`mdv.desc.${id.split(":")[1]}`), stats.length ? "\n" : "", ...stats))
    .button(raw(T("mdv.ui.back")));
  await form.show(player);
  return armory(player);
}

async function guide(player) {
  const form = new ActionFormData()
    .title(raw(T("mdv.ui.guide")))
    .body(raw(T("mdv.ui.guide_body"), `\n\n§7${STAMINA.base} → ${STAMINA.cap}`))
    .button(raw(T("mdv.ui.back")));
  await form.show(player);
  return openCodex(player);
}

async function settings(player) {
  const op = canEditWorld(player);
  const form = new ModalFormData()
    .title(raw(T("mdv.ui.settings")))
    .toggle(raw(T("mdv.ui.opt_hud")), { defaultValue: hudEnabled(player) })
    .toggle(raw(T("mdv.ui.opt_pvp")), { defaultValue: !!getWorldSetting("mdv:pvp") })
    .toggle(raw(T("mdv.ui.opt_fire")), { defaultValue: !!getWorldSetting("mdv:fire_spread") });
  const res = await form.show(player);
  if (res.canceled || !res.formValues) return;
  const [hud, pvp, fire] = res.formValues;
  setHud(player, !!hud);
  if (op) {
    setWorldSetting("mdv:pvp", !!pvp);
    setWorldSetting("mdv:fire_spread", !!fire);
  } else if (pvp !== !!getWorldSetting("mdv:pvp") || fire !== !!getWorldSetting("mdv:fire_spread")) {
    tell(player, "mdv.msg.op_only");
  }
  tell(player, "mdv.msg.saved");
}
