import {
  world, system, ItemStack, MolangVariableMap, EasingType, HudVisibility, InputPermissionCategory,
} from "@minecraft/server";
import { ActionFormData, ModalFormData, uiManager } from "@minecraft/server-ui";

// ───────── 보물 정의 ─────────
// min/max: 가치 범위, frag: 피해 1당 깎이는 가치, weight: 등장 확률, heavy: 들고 있으면 느려짐
const VALUABLES = {
  "haul:small_vase":  { name: "작은 꽃병",   min: 100,  max: 400,  frag: 15, weight: 30 },
  "haul:painting":    { name: "고풍 그림",   min: 200,  max: 800,  frag: 10, weight: 25 },
  "haul:gold_cup":    { name: "황금 컵",     min: 300,  max: 900,  frag: 5,  weight: 20 },
  "haul:old_clock":   { name: "골동품 시계", min: 300,  max: 1100, frag: 20, weight: 15 },
  "haul:crystal_orb": { name: "수정 구슬",   min: 600,  max: 1600, frag: 40, weight: 7 },
  "haul:gold_safe":   { name: "황금 금고",   min: 2000, max: 4000, frag: 3,  weight: 4, heavy: true },
  "haul:jade_statue": { name: "옥 조각상",   min: 800,  max: 2000, frag: 25, weight: 3 },
};

const UPGRADES = [
  { key: "haul:up_health", name: "체력", effect: "health_boost" },
  { key: "haul:up_speed",  name: "속도", effect: "speed" },
  { key: "haul:up_power",  name: "힘",   effect: "strength" },
  { key: "haul:up_jump",   name: "점프", effect: "jump_boost" },
];
const MAX_UP = 5;
const SHOP_ITEMS = [
  { name: "치료 키트",   cost: 300 },
  { name: "보물 탐지기", cost: 400, item: "haul:scanner" },
  { name: "충격봉",     cost: 600, item: "haul:stun_baton" },
];

const BASE_TIME = 600;       // 레벨 1 제한 시간(초)
const TIME_PER_LEVEL = 60;   // 레벨마다 추가 시간
const BATON_COOLDOWN = 160;  // 충격봉 재사용 대기 (틱)
const SCANNER_COOLDOWN = 40; // 탐지기 재사용 대기 (틱)

// ───────── 유틸 ─────────
const rnd = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const fragLabel = (f) => (f <= 8 ? "§a낮음" : f <= 20 ? "§e보통" : "§c높음");
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const diff = () => world.getDynamicProperty("haul:difficulty") ?? 1; // 0 쉬움, 1 보통, 2 어려움
const DIFF_NAMES = ["§a쉬움", "§e보통", "§c어려움"];
// 맵 크기: 0 보통, 1 크게(기본), 2 아주 크게 → 한 변의 방 개수
const mapScale = () => world.getDynamicProperty("haul:map_scale") ?? 1;
const SCALE_NAMES = ["§7보통", "§e크게", "§c아주 크게"];
const mapGrid = (level) => {
  const base = level <= 2 ? 3 : level <= 4 ? 4 : level <= 7 ? 5 : 6;
  return Math.min(9, base + [0, 2, 3][mapScale()]);
};
// 제한 시간: 기본 + 레벨당 추가 + 3x3보다 큰 방 하나당 20초
const timeLimit = (level) => Math.round(
  (BASE_TIME + TIME_PER_LEVEL * (level - 1) + 20 * (mapGrid(level) ** 2 - 9)) * [1.5, 1, 0.75][diff()]);

function pickType() {
  const ids = Object.keys(VALUABLES);
  const total = ids.reduce((s, id) => s + VALUABLES[id].weight, 0);
  let r = Math.random() * total;
  for (const id of ids) { r -= VALUABLES[id].weight; if (r <= 0) return id; }
  return ids[0];
}

function setValue(item, v) {
  const d = VALUABLES[item.typeId];
  const lore = [`§r§6가치: $${v}`, `§r§7파손 위험: ${fragLabel(d.frag)}`];
  if (d.heavy) lore.push("§r§8무거움: 들고 있으면 느려짐");
  item.setLore(lore);
}

function getValue(item) {
  if (!item || !VALUABLES[item.typeId]) return null;
  for (const line of item.getLore()) {
    const m = line.match(/\$(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

function makeValuable(id) {
  const d = VALUABLES[id];
  const item = new ItemStack(id, 1);
  setValue(item, rnd(d.min, d.max));
  return item;
}

const container = (p) => p.getComponent("minecraft:inventory")?.container;

function ensureValue(c, i, item) {
  let v = getValue(item);
  if (v === null) {
    const d = VALUABLES[item.typeId];
    v = rnd(d.min, d.max);
    setValue(item, v);
    c.setItem(i, item);
  }
  return v;
}

function giveItem(p, item) {
  const left = container(p)?.addItem(item);
  if (left) p.dimension.spawnItem(left, p.location);
}

// ───────── 연출 (파티클·사운드) ─────────
// 파티클/사운드는 실패해도 게임 진행에 영향이 없도록 모두 감싸서 호출
function fx(dim, particle, loc) {
  try { dim.spawnParticle(particle, loc); } catch {}
}
function ring(dim, particle, c, r, n) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    fx(dim, particle, { x: c.x + Math.cos(a) * r, y: c.y, z: c.z + Math.sin(a) * r });
  }
}
function sound(dim, id, loc, volume = 1, pitch = 1) {
  try { dim.playSound(id, loc, { volume, pitch }); } catch {}
}
function coloredDust(dim, loc, r, g, b) {
  try {
    const m = new MolangVariableMap();
    m.setColorRGBA("variable.color", { red: r, green: g, blue: b, alpha: 1 });
    dim.spawnParticle("minecraft:colored_flame_particle", loc, m);
  } catch {}
}
const progressBar = (v, max, n = 10) => {
  const f = Math.max(0, Math.min(n, Math.floor((v / max) * n)));
  return "§a" + "■".repeat(f) + "§8" + "■".repeat(n - f);
};

// ───────── 월드 상태 (팀 공유) ─────────
const G = (k, d) => world.getDynamicProperty(k) ?? d;
const S = (k, v) => world.setDynamicProperty(k, v);
const state = () => ({
  level: G("haul:level", 1),
  quota: G("haul:quota", 1000),
  deposited: G("haul:deposited", 0),
  money: G("haul:money", 0),
  time: G("haul:time", timeLimit(G("haul:level", 1))),
  timerOn: G("haul:timer_on", true),
});

function resetGame(reason) {
  S("haul:level", 1); S("haul:quota", 1000); S("haul:deposited", 0); S("haul:money", 0);
  S("haul:time", timeLimit(1));
  for (const p of world.getAllPlayers()) for (const u of UPGRADES) p.setDynamicProperty(u.key, 0);
  world.sendMessage(reason ?? "§e[Haulers] 게임이 초기화되었습니다. 레벨 1, 할당량 $1000");
}

// ───────── 보물 상자 위치 기록 (탐지기용) ─────────
const MAX_CRATES = 300;
const getCrates = () => JSON.parse(G("haul:crates", "[]"));
const saveCrates = (list) => S("haul:crates", JSON.stringify(list.slice(-MAX_CRATES)));
function addCrate(b) {
  const list = getCrates();
  list.push({ x: b.x, y: b.y, z: b.z, d: b.dimension.id });
  saveCrates(list);
}
function removeCrate(b) {
  saveCrates(getCrates().filter((c) => !(c.x === b.x && c.y === b.y && c.z === b.z && c.d === b.dimension.id)));
}

// ───────── 추출 지점 ─────────
function extract(p) {
  const c = container(p);
  if (!c) return;
  let total = 0, count = 0;
  const names = new Map();
  for (let i = 0; i < c.size; i++) {
    const item = c.getItem(i);
    if (!item || !VALUABLES[item.typeId]) continue;
    total += ensureValue(c, i, item);
    count++;
    const n = VALUABLES[item.typeId].name;
    names.set(n, (names.get(n) ?? 0) + 1);
    c.setItem(i, undefined);
  }
  if (count === 0) {
    p.sendMessage("§7가지고 있는 보물이 없습니다. 보물 상자를 찾아보세요!");
    return;
  }
  const s = state();
  let deposited = s.deposited + total;
  let money = s.money + total;
  const list = [...names].map(([n, k]) => (k > 1 ? `${n} x${k}` : n)).join(", ");
  world.sendMessage(`§a${p.name}님이 보물 ${count}개를 추출했습니다! §6+$${total}\n§7(${list})`);
  p.playSound("random.orb");
  p.onScreenDisplay.setTitle(" ", { subtitle: `§6+$${total}`, fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 10 });
  const dim = p.dimension, at = { x: p.location.x, y: p.location.y + 1, z: p.location.z };
  sound(dim, "beacon.power", at, 1, 1.4);
  fx(dim, "minecraft:totem_particle", at);
  ring(dim, "minecraft:villager_happy", p.location, 1.2, 12);
  S("haul:total", G("haul:total", 0) + total);
  addNoise(p, 15);

  if (deposited >= s.quota) {
    const level = s.level + 1;
    const quota = Math.round((s.quota * 1.4 + 500) / 100) * 100;
    // 클리어 보너스: 레벨 보너스 + 남은 시간 1초당 $2
    const bonus = 200 * s.level + (s.timerOn ? s.time * 2 : 0);
    money += bonus;
    S("haul:level", level); S("haul:quota", quota); S("haul:time", timeLimit(level));
    if (level > G("haul:best", 1)) S("haul:best", level);
    deposited = 0;
    world.sendMessage(`§b레벨 클리어 보너스 +$${bonus}`);
    for (const pl of world.getAllPlayers()) {
      pl.onScreenDisplay.setTitle("§a할당량 달성!", {
        subtitle: `§e레벨 ${level} · 할당량 $${quota} · 제한 ${fmtTime(timeLimit(level))}`,
        fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 20,
      });
      pl.playSound("random.levelup");
      pl.playSound("random.totem", { volume: 0.6 });
    }
    if (G("haul:map_mode", false)) scheduleMap(level);
  }
  S("haul:deposited", deposited);
  S("haul:money", money);
}

// ───────── 상점 ─────────
function applyUpgrades(p) {
  for (const u of UPGRADES) {
    const lvl = p.getDynamicProperty(u.key) ?? 0;
    if (lvl > 0) p.addEffect(u.effect, 400, { amplifier: lvl - 1, showParticles: false });
  }
}

const upCost = (lvl) => 500 * (lvl + 1);

async function openShop(p) {
  const s = state();
  const form = new ActionFormData()
    .title(UI + "§2업그레이드 상점")
    .body(
      `팀 돈: §b$${s.money}§r\n업그레이드는 각자 적용됩니다.\n\n` +
      UPGRADES.map((u) => `§7${u.name} ${"§a★".repeat(p.getDynamicProperty(u.key) ?? 0)}${"§8☆".repeat(MAX_UP - (p.getDynamicProperty(u.key) ?? 0))}`).join("\n")
    );
  for (const u of UPGRADES) {
    const lvl = p.getDynamicProperty(u.key) ?? 0;
    form.button(lvl >= MAX_UP ? `${u.name} §8(MAX)` : `${u.name} Lv.${lvl} → ${lvl + 1}\n§8$${upCost(lvl)}`);
  }
  for (const it of SHOP_ITEMS) form.button(`${it.name}\n§8$${it.cost}`);

  const res = await form.show(p);
  if (res.canceled || res.selection === undefined) return;
  const money = state().money;

  if (res.selection >= UPGRADES.length) {
    const it = SHOP_ITEMS[res.selection - UPGRADES.length];
    if (money < it.cost) return p.sendMessage("§c돈이 부족합니다.");
    S("haul:money", money - it.cost);
    if (it.item) {
      giveItem(p, new ItemStack(it.item, 1));
      p.sendMessage(`§a${it.name}을(를) 구매했습니다.`);
    } else {
      p.addEffect("instant_health", 1, { amplifier: 1 });
      p.addEffect("regeneration", 200, { amplifier: 0 });
      p.sendMessage("§a치료 키트를 사용했습니다.");
    }
    p.playSound("random.pop");
    return;
  }

  const u = UPGRADES[res.selection];
  const lvl = p.getDynamicProperty(u.key) ?? 0;
  if (lvl >= MAX_UP) return p.sendMessage("§7이미 최대 레벨입니다.");
  const cost = upCost(lvl);
  if (money < cost) return p.sendMessage("§c돈이 부족합니다.");
  S("haul:money", money - cost);
  p.setDynamicProperty(u.key, lvl + 1);
  applyUpgrades(p);
  p.playSound("random.anvil_use");
  p.sendMessage(`§a${u.name} 업그레이드 Lv.${lvl + 1}!`);
}

// ───────── 도구: 탐지기 & 충격봉 ─────────
function dirWord(p, tx, tz) {
  const dx = tx - p.location.x, dz = tz - p.location.z;
  const target = (Math.atan2(-dx, dz) * 180) / Math.PI;
  let rel = target - p.getRotation().y;
  rel = ((rel + 540) % 360) - 180;
  const a = Math.abs(rel), side = rel > 0 ? "오른쪽" : "왼쪽";
  if (a < 22.5) return "앞";
  if (a < 67.5) return `앞쪽 ${side}`;
  if (a < 112.5) return side;
  if (a < 157.5) return `뒤쪽 ${side}`;
  return "뒤";
}

function useScanner(p) {
  const now = system.currentTick;
  if ((scannerReady.get(p.id) ?? 0) > now) return;
  scannerReady.set(p.id, now + SCANNER_COOLDOWN);
  try { p.startItemCooldown("haul_scanner", SCANNER_COOLDOWN); } catch {}
  const dimId = p.dimension.id;
  let list = getCrates(), best = null, bestDist = Infinity;
  const alive = [];
  for (const c of list) {
    let ok = true;
    if (c.d === dimId) {
      try {
        const b = p.dimension.getBlock(c);
        if (b && b.typeId !== "haul:loot_crate") ok = false; // 이미 사라진 상자
      } catch {}
    }
    if (!ok) continue;
    alive.push(c);
    if (c.d !== dimId) continue;
    const dist = Math.hypot(c.x - p.location.x, c.y - p.location.y, c.z - p.location.z);
    if (dist < bestDist) { bestDist = dist; best = c; }
  }
  if (alive.length !== list.length) saveCrates(alive);
  if (!best) return p.sendMessage("§7[탐지기] 신호 없음... 근처에 보물 상자가 없습니다.");
  const dy = Math.round(best.y - p.location.y);
  const h = dy > 1 ? `, 위로 ${dy}칸` : dy < -1 ? `, 아래로 ${-dy}칸` : "";
  p.sendMessage(`§a[탐지기] §f가장 가까운 보물 상자: §e${dirWord(p, best.x + 0.5, best.z + 0.5)} ${Math.round(bestDist)}블록${h}`);
  // 상자 방향으로 빛줄기 (최대 8블록)
  const from = { x: p.location.x, y: p.location.y + 1.2, z: p.location.z };
  const to = { x: best.x + 0.5, y: best.y + 0.5, z: best.z + 0.5 };
  const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) || 1;
  const steps = Math.min(16, Math.floor(len * 2));
  for (let i = 2; i <= steps; i++) {
    const t = i / 2 / len;
    coloredDust(p.dimension, {
      x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t,
    }, 0.3, 1, 0.5);
  }
  // 가까울수록 높은 음
  p.playSound("note.pling", { pitch: Math.max(0.6, 2 - bestDist / 25) });
}
const scannerReady = new Map();

const batonReady = new Map();
function useBaton(p) {
  const now = system.currentTick;
  const ready = batonReady.get(p.id) ?? 0;
  if (ready > now) return p.sendMessage(`§7충격봉 충전 중... ${Math.ceil((ready - now) / 20)}초`);
  batonReady.set(p.id, now + BATON_COOLDOWN);
  try { p.startItemCooldown("haul_baton", BATON_COOLDOWN); } catch {}
  const mobs = p.dimension.getEntities({ location: p.location, maxDistance: 6, families: ["monster"] });
  for (const m of mobs) {
    try {
      m.applyDamage(4, { cause: "entityAttack", damagingEntity: p });
      m.addEffect("slowness", 100, { amplifier: 4 });
      m.addEffect("weakness", 100, { amplifier: 1 });
      const dx = m.location.x - p.location.x, dz = m.location.z - p.location.z;
      const len = Math.hypot(dx, dz) || 1;
      m.applyKnockback({ x: (dx / len) * 1.5, z: (dz / len) * 1.5 }, 0.4);
    } catch {}
  }
  const dim = p.dimension;
  fx(dim, "minecraft:sonic_explosion", { x: p.location.x, y: p.location.y + 1, z: p.location.z });
  for (const r of [1.5, 3, 4.5]) ring(dim, "minecraft:electric_spark_particle", { x: p.location.x, y: p.location.y + 0.3, z: p.location.z }, r, Math.round(r * 8));
  for (const m of mobs) fx(dim, "minecraft:electric_spark_particle", { x: m.location.x, y: m.location.y + 1, z: m.location.z });
  sound(dim, "mob.blaze.shoot", p.location, 1, 0.8);
  sound(dim, "random.explode", p.location, 0.4, 1.8);
  addNoise(p, 50);
  p.sendMessage(mobs.length ? `§b충격파! 몬스터 ${mobs.length}마리 기절` : "§7주변에 몬스터가 없습니다.");
}

world.afterEvents.itemUse.subscribe((e) => {
  const id = e.itemStack?.typeId;
  if (id === "haul:scanner") useScanner(e.source);
  else if (id === "haul:stun_baton") useBaton(e.source);
  else if (id === "haul:start_key") useStartKey(e.source);
});

// ───────── 블록 상호작용 ─────────
const cooldown = new Map();
world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
  const id = e.block.typeId;
  if (id !== "haul:extraction_point" && id !== "haul:shop") return;
  e.cancel = true;
  const p = e.player;
  const now = system.currentTick;
  if ((cooldown.get(p.id) ?? 0) > now) return;
  cooldown.set(p.id, now + 10);
  system.run(() => (id === "haul:shop" ? openShop(p) : extract(p)));
});

world.afterEvents.playerPlaceBlock.subscribe((e) => {
  if (e.block.typeId === "haul:loot_crate") addCrate(e.block);
  if (e.block.typeId === "haul:extraction_point") addExtract(e.block);
});

world.afterEvents.playerBreakBlock.subscribe((e) => {
  if (e.brokenBlockPermutation.type.id === "haul:extraction_point") return removeExtract(e.block);
  if (e.brokenBlockPermutation.type.id !== "haul:loot_crate") return;
  const b = e.block;
  removeCrate(b);
  const loc = { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 };
  const n = Math.random() < 0.3 ? 2 : 1;
  for (let i = 0; i < n; i++) b.dimension.spawnItem(makeValuable(pickType()), loc);
  e.player.playSound("random.chestopen");
  fx(b.dimension, "minecraft:totem_particle", loc);
  if (n > 1) e.player.sendMessage("§d보물이 두 개 들어 있었다!");
  addNoise(e.player, 35);
});

// ───────── 피격: 보물 가치 하락 + 도둑 ─────────
world.afterEvents.entityHurt.subscribe((e) => {
  const p = e.hurtEntity;
  const c = container(p);
  if (!c) return;
  const attacker = e.damageSource.damagingEntity;

  if (attacker?.typeId === "haul:thief") {
    const slots = [];
    for (let i = 0; i < c.size; i++) if (VALUABLES[c.getItem(i)?.typeId]) slots.push(i);
    if (slots.length) {
      const i = slots[rnd(0, slots.length - 1)];
      const item = c.getItem(i);
      const v = ensureValue(c, i, item);
      const stolen = JSON.parse(attacker.getDynamicProperty("haul:stolen") ?? "[]");
      stolen.push({ id: item.typeId, v });
      attacker.setDynamicProperty("haul:stolen", JSON.stringify(stolen));
      attacker.nameTag = `§e훔친 보물 x${stolen.length}`;
      try { attacker.triggerEvent("haul:flee"); } catch {}
      fx(attacker.dimension, "minecraft:basic_smoke_particle", { x: attacker.location.x, y: attacker.location.y + 0.6, z: attacker.location.z });
      sound(attacker.dimension, "mob.vex.charge", attacker.location, 1, 1.5);
      c.setItem(i, undefined);
      p.sendMessage(`§e도둑 고블린이 ${VALUABLES[item.typeId].name}을(를) 훔쳤습니다! 잡으면 되찾을 수 있어요.`);
    }
  }

  let lost = 0, broke = false;
  for (let i = 0; i < c.size; i++) {
    const item = c.getItem(i);
    if (!item || !VALUABLES[item.typeId]) continue;
    const d = VALUABLES[item.typeId];
    const v = ensureValue(c, i, item);
    const loss = Math.max(1, Math.round(e.damage * d.frag * (0.6 + Math.random() * 0.8)));
    if (v - loss <= 0) {
      c.setItem(i, undefined);
      p.sendMessage(`§c${d.name}이(가) 부서졌습니다!`);
      lost += v; broke = true;
    } else {
      setValue(item, v - loss);
      c.setItem(i, item);
      lost += loss;
    }
  }
  if (lost > 0) p.sendMessage(`§c충격으로 보물 가치 -$${lost}`);
  if (broke) { p.playSound("random.glass"); addNoise(p, 45); }
  addNoise(p, 10);
}, { entityTypes: ["minecraft:player"] });

world.afterEvents.entityDie.subscribe((e) => {
  const d = e.deadEntity;
  try {
    const loc = d.location, dim = d.dimension;
    if (d.typeId === "haul:watcher") {
      dim.spawnItem(makeValuable(pickType()), loc);
      return;
    }
    const s = d.getDynamicProperty("haul:stolen");
    if (!s) return;
    d.setDynamicProperty("haul:stolen", undefined);
    for (const x of JSON.parse(s)) {
      const item = new ItemStack(x.id, 1);
      setValue(item, x.v);
      dim.spawnItem(item, loc);
    }
    fx(dim, "minecraft:totem_particle", loc);
    world.sendMessage("§a도둑 고블린을 잡았다! 훔친 보물을 되찾았습니다.");
  } catch {}
}, { entityTypes: ["haul:thief", "haul:watcher"] });

// ───────── 매초: HUD, 타이머, 무거운 보물 ─────────
system.runInterval(() => {
  const players = world.getAllPlayers();
  if (!players.length) return;
  let s = state();

  const mapMode = G("haul:map_mode", false);
  if (mapMode && s.timerOn && !G("haul:building", false)) {
    const t = s.time - 1;
    if (t <= 0) {
      for (const pl of players) {
        pl.onScreenDisplay.setTitle("§c실패!", {
          subtitle: "§7시간 안에 할당량을 채우지 못했습니다",
          fadeInDuration: 10, stayDuration: 80, fadeOutDuration: 20,
        });
        pl.playSound("mob.wither.death");
      }
      resetGame(`§c[Haulers] 게임 오버! 레벨 ${s.level}에서 탈락. 레벨 1부터 다시 시작합니다.`);
      if (G("haul:map_mode", false)) scheduleMap(1);
      return;
    }
    S("haul:time", t);
    if (t === 60 || t === 30) {
      world.sendMessage(`§e남은 시간 ${t}초! 서둘러 납품하세요!`);
      for (const pl of players) {
        pl.onScreenDisplay.setTitle(" ", { subtitle: `§c남은 시간 ${t}초!`, fadeInDuration: 5, stayDuration: 30, fadeOutDuration: 10 });
        pl.playSound("note.bass", { pitch: 0.7 });
      }
    }
    if (t <= 10) for (const pl of players) pl.playSound("random.click", { pitch: 1 + (10 - t) * 0.08 });
    s = state();
  }

  for (const p of players) {
    if (inLobby(p)) continue;
    const c = container(p);
    let carried = 0, heavy = false;
    if (c) for (let i = 0; i < c.size; i++) {
      const item = c.getItem(i);
      carried += getValue(item) ?? 0;
      if (item && VALUABLES[item.typeId]?.heavy) heavy = true;
    }
    if (heavy) p.addEffect("slowness", 30, { amplifier: 1, showParticles: false });
    const nv = tickNoise(p);
    const timer = mapMode && s.timerOn ? ` §f| ${s.time <= 60 ? "§c" : "§f"}${fmtTime(s.time)}` : "";
    p.onScreenDisplay.setActionBar(
      `§e레벨 ${s.level} ${progressBar(s.deposited, s.quota)} §a$${s.deposited}§f/§6$${s.quota} §f| 팀 돈 §b$${s.money}` +
      (carried ? ` §f| 소지 §d$${carried}` : "") + timer +
      (G("haul:noise_on", true) ? `\n§7소음 ${noiseBar(nv)}${micBar(p)}` : "")
    );
  }
}, 20);

system.runInterval(() => { for (const p of world.getAllPlayers()) applyUpgrades(p); }, 200);

// 보물 상자 자동 생성 (1분마다, 플레이어 근처)
system.runInterval(() => {
  if (G("haul:map_mode", false)) return; // 맵 모드에서는 맵 생성 때 상자가 배치됨
  for (const p of world.getAllPlayers()) {
    if (Math.random() > 0.6) continue;
    const dim = p.dimension, base = p.location;
    for (let t = 0; t < 12; t++) {
      const x = Math.floor(base.x) + rnd(-20, 20), z = Math.floor(base.z) + rnd(-20, 20);
      let placed = false;
      for (let y = Math.floor(base.y) + 6; y >= Math.floor(base.y) - 6; y--) {
        try {
          const b = dim.getBlock({ x, y, z });
          if (!b) break;
          const below = b.below();
          if (b.isAir && below && !below.isAir && !below.isLiquid) {
            b.setType("haul:loot_crate");
            addCrate(b);
            const dist = Math.round(Math.hypot(x - base.x, z - base.z));
            p.sendMessage(`§6근처 어딘가에 보물 상자가 나타났다... §7(약 ${dist}블록)`);
            placed = true;
            break;
          }
        } catch { break; }
      }
      if (placed) break;
    }
  }
}, 1200);

// ───────── 추출 지점 위치 기록 & 표시 ─────────
// 추출 지점은 멀리서도 보이도록 빛기둥 파티클을 뿜음
const getExtracts = () => JSON.parse(G("haul:extracts", "[]"));
const saveExtracts = (list) => S("haul:extracts", JSON.stringify(list.slice(-12)));
function addExtract(b) {
  const list = getExtracts().filter((c) => !(c.x === b.x && c.y === b.y && c.z === b.z && c.d === b.dimension.id));
  list.push({ x: b.x, y: b.y, z: b.z, d: b.dimension.id });
  saveExtracts(list);
}
function removeExtract(b) {
  saveExtracts(getExtracts().filter((c) => !(c.x === b.x && c.y === b.y && c.z === b.z && c.d === b.dimension.id)));
}

let beamTick = 0;
system.runInterval(() => {
  const players = world.getAllPlayers();
  if (!players.length) return;
  beamTick++;
  for (const c of getExtracts()) {
    const near = players.some((p) => p.dimension.id === c.d &&
      Math.hypot(p.location.x - c.x, p.location.y - c.y, p.location.z - c.z) < 64);
    if (!near) continue;
    let dim;
    try { dim = world.getDimension(c.d); if (dim.getBlock(c)?.typeId !== "haul:extraction_point") continue; } catch { continue; }
    const cx = c.x + 0.5, cz = c.z + 0.5;
    for (let y = 1; y <= 4; y++) coloredDust(dim, { x: cx, y: c.y + y * 0.9, z: cz }, 0.25, 1, 0.45);
    const a = beamTick * 0.6;
    for (let k = 0; k < 3; k++) {
      const b = a + (k * Math.PI * 2) / 3;
      fx(dim, "minecraft:villager_happy", { x: cx + Math.cos(b) * 0.9, y: c.y + 0.3, z: cz + Math.sin(b) * 0.9 });
    }
  }
}, 10);

// ───────── 명령어 & 안내 ─────────
// /scriptevent haul:reset        게임 초기화
// /scriptevent haul:money 1000   팀 돈 추가 (테스트용)
// /scriptevent haul:timer off    제한 시간 끄기 (on 으로 다시 켜기)
system.afterEvents.scriptEventReceive.subscribe((e) => {
  if (e.id === "haul:reset") resetGame();
  if (e.id === "haul:money") {
    S("haul:money", state().money + (Number(e.message) || 0));
    world.sendMessage(`§b팀 돈: $${state().money}`);
  }
  if (e.id === "haul:timer") {
    const on = e.message.trim() !== "off";
    S("haul:timer_on", on);
    if (on) S("haul:time", timeLimit(state().level));
    world.sendMessage(on ? "§e제한 시간이 켜졌습니다." : "§7제한 시간이 꺼졌습니다.");
  }
  if (e.id === "haul:start") startMapGame();
  if (e.id === "haul:menu") for (const p of world.getAllPlayers()) enterLobby(p);
  if (e.id === "haul:stop") stopMapGame();
  if (e.id === "haul:mic") onMic(e);
});

world.afterEvents.playerSpawn.subscribe((e) => {
  if (!e.initialSpawn) return;
  const p = e.player;
  // 지난 접속에서 로비 화면 상태로 나갔을 수 있으므로 먼저 원상 복구
  setLocked(p, false);
  try { p.camera.clear(); } catch {}
  system.runTimeout(() => {
    if (!p.getDynamicProperty("haul:got_key")) {
      p.setDynamicProperty("haul:got_key", true);
      giveItem(p, new ItemStack("haul:start_key", 1));
      p.sendMessage("§e[Haulers] §f출발 열쇠를 받았습니다! 사용하면 메인 메뉴가 열립니다.");
    }
    if (G("haul:needs_rebuild", false) && G("haul:map_mode", false)) {
      S("haul:needs_rebuild", false);
      world.sendMessage("§7[Haulers] 맵 생성이 중단되었던 것 같습니다. 맵을 다시 만듭니다.");
      scheduleMap(state().level);
      return;
    }
    if (G("haul:building", false)) return;
    enterLobby(p, true);
  }, 40);
});

world.afterEvents.playerLeave.subscribe((e) => lobby.delete(e.playerId));

// 월드를 맵 생성 도중 종료했다면 '생성 중' 상태가 남아 타이머·맵 생성이 멈춤 → 복구
world.afterEvents.worldLoad.subscribe(() => {
  if (G("haul:building", false)) {
    S("haul:building", false);
    S("haul:needs_rebuild", true);
  }
});

// ═════════ 리포 맵 생성 ═════════
// 레벨마다 하늘 위 먼 곳에 방 여러 개짜리 건물을 새로 짓고, 보물 상자·추출 지점·몬스터를 배치함
const THEMES = [
  { name: "버려진 저택", floor: "dark_oak_planks", wall: "spruce_planks", ceil: "dark_oak_planks",
    light: 'lantern ["hanging"=true]', lightDown: true, decor: ["bookshelf", "barrel", "cobweb", "bookshelf", "pumpkin"] },
  { name: "북극 기지", floor: "white_concrete", wall: "packed_ice", ceil: "light_gray_concrete",
    light: "sea_lantern", decor: ["blue_ice", "powder_snow", "barrel", "snow", "blue_ice"] },
  { name: "비밀 연구소", floor: "polished_deepslate", wall: "smooth_stone", ceil: "quartz_block",
    light: "sea_lantern", decor: ["iron_bars", "cauldron", "barrel", "iron_block", "cobweb"] },
  { name: "잊혀진 유적", floor: "mossy_stone_bricks", wall: "cracked_stone_bricks", ceil: "stone_bricks",
    light: 'lantern ["hanging"=true]', lightDown: true, decor: ["mossy_cobblestone", "cobweb", "decorated_pot", "chiseled_stone_bricks", "moss_block"] },
];
const CELL = 10;      // 방 한 칸 크기 (벽 포함)
const MAP_Y = 150;    // 바닥 높이
const WAIT_Y = 210;   // 생성 중 대기 높이

const overworld = () => world.getDimension("overworld");

function scheduleMap(level) {
  world.sendMessage("§75초 후 다음 맵으로 이동합니다...");
  system.runTimeout(() => buildMap(level), 100);
}

function useStartKey(p) {
  enterLobby(p);
}

function startMapGame() {
  S("haul:map_mode", true);
  S("haul:games", G("haul:games", 0) + 1);
  resetGame(`§6[Haulers] 리포 모드 시작! 난이도 ${DIFF_NAMES[diff()]}§6, 레벨 1부터 시작합니다.`);
  buildMap(1);
}

function stopMapGame() {
  S("haul:map_mode", false);
  S("haul:building", false);
  try { overworld().runCommand("tickingarea remove haul_map"); } catch {}
  for (const p of world.getAllPlayers()) {
    try { p.setSpawnPoint(); } catch {}
    enterLobby(p);
  }
  world.sendMessage("§7[Haulers] 게임을 종료하고 트럭으로 돌아왔습니다.");
}

// 미로 형태로 방 연결 (DFS) + 루프용 추가 문
function makeMaze(size) {
  const doors = new Set();
  const seen = new Set(["0,0"]);
  const stack = [[0, 0]];
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dz]) => [x + dx, z + dz])
      .filter(([nx, nz]) => nx >= 0 && nz >= 0 && nx < size && nz < size && !seen.has(`${nx},${nz}`));
    if (!next.length) { stack.pop(); continue; }
    const [nx, nz] = next[rnd(0, next.length - 1)];
    seen.add(`${nx},${nz}`);
    doors.add([x, z, nx, nz].join(","));
    stack.push([nx, nz]);
  }
  for (let i = 0; i < size; i++) {
    const x = rnd(0, size - 2), z = rnd(0, size - 1);
    doors.add([x, z, x + 1, z].join(","));
  }
  return [...doors].map((s) => s.split(",").map(Number));
}

// 시작 방에서 가장 먼 방 찾기 (추출 지점 위치)
function farthestRoom(size, doors) {
  const adj = new Map();
  const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
  for (const [x1, z1, x2, z2] of doors) { link(`${x1},${z1}`, `${x2},${z2}`); link(`${x2},${z2}`, `${x1},${z1}`); }
  const dist = new Map([["0,0", 0]]);
  const q = ["0,0"];
  while (q.length) {
    const cur = q.shift();
    for (const n of adj.get(cur) ?? []) if (!dist.has(n)) { dist.set(n, dist.get(cur) + 1); q.push(n); }
  }
  let best = "0,0";
  for (const [k, d] of dist) if (d > dist.get(best)) best = k;
  return { room: best.split(",").map(Number), dist };
}

function runCommands(cmds, done) {
  let i = 0, tries = 0;
  const job = system.runInterval(() => {
    for (let n = 0; n < 25 && i < cmds.length; n++) {
      try { overworld().runCommand(cmds[i]); i++; tries = 0; }
      catch {
        // 이미 같은 블록이면 실패로 처리되므로 짧게만 재시도하고 넘어감
        if (++tries > 2) { i++; tries = 0; }
        return;
      }
    }
    if (i >= cmds.length) { system.clearRun(job); done(); }
  }, 1);
}

// 이전 맵에 남은 몬스터·떨어진 아이템을 정리 (청크가 계속 쌓이는 것 방지)
function clearOldMap() {
  const raw = G("haul:map_box", "");
  if (!raw) return;
  try {
    const box = JSON.parse(raw);
    const ents = overworld().getEntities({ location: { x: box.x, y: box.y, z: box.z }, volume: { x: box.w, y: 8, z: box.w } });
    for (const e of ents) {
      if (e.typeId === "haul:watcher" || e.typeId === "haul:thief" || e.typeId === "minecraft:item") e.remove();
    }
  } catch {}
  saveExtracts(getExtracts().filter((c) => !(c.x >= 30000 && c.z >= 30000)));
}

function buildMap(level) {
  if (G("haul:building", false)) return;
  S("haul:building", true);
  const n = G("haul:map_n", 0) + 1;
  S("haul:map_n", n);

  clearOldMap();
  const theme = THEMES[(level - 1) % THEMES.length];
  const size = mapGrid(level);
  const W = size * CELL + 1;
  const X0 = 30000 + n * 200, Z0 = 30000, Y0 = MAP_Y;
  const center = { x: X0 + W / 2, y: WAIT_Y, z: Z0 + W / 2 };
  S("haul:map_box", JSON.stringify({ x: X0, y: Y0, z: Z0, w: W }));

  startLoadingScreen();
  for (const p of world.getAllPlayers()) {
    leaveLobbyState(p);
    p.addEffect("slow_falling", 400, { showParticles: false });
    p.addEffect("resistance", 400, { amplifier: 4, showParticles: false });
    p.teleport(center, { dimension: overworld() });
    p.onScreenDisplay.setTitle(`§6레벨 ${level}`, {
      subtitle: `§f${theme.name} §7· ${size}x${size} 방 · 맵 생성 중...`, fadeInDuration: 10, stayDuration: 80, fadeOutDuration: 10,
    });
  }

  // 큰 맵은 플레이어 주변 청크만으로는 다 불러와지지 않으므로 티킹 영역으로 맵 전체를 붙잡아 둠
  try { overworld().runCommand("tickingarea remove haul_map"); } catch {}
  try { overworld().runCommand(`tickingarea add ${X0} ${Y0} ${Z0} ${X0 + W - 1} ${Y0 + 6} ${Z0 + W - 1} haul_map true`); } catch {}

  // 맵 영역 청크가 모두 불러와질 때까지 대기
  let waited = 0;
  const loaded = () => [[X0, Z0], [X0 + W - 1, Z0], [X0, Z0 + W - 1], [X0 + W - 1, Z0 + W - 1]]
    .every(([x, z]) => { try { return !!overworld().getBlock({ x, y: Y0, z }); } catch { return false; } });
  const waitLoad = system.runInterval(() => {
    waited += 10;
    if (!loaded() && waited < 600) return;
    system.clearRun(waitLoad);
    generate();
  }, 10);

  const generate = () => {
    const cmds = [];
    // /fill 은 한 번에 32768블록까지 → 큰 영역은 x 방향으로 나눠서 채움
    const fill = (x1, y1, z1, x2, y2, z2, b) => {
      const per = (Math.abs(y2 - y1) + 1) * (Math.abs(z2 - z1) + 1);
      const step = Math.max(1, Math.floor(32768 / per));
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += step) {
        cmds.push(`fill ${x} ${y1} ${z1} ${Math.min(x + step - 1, Math.max(x1, x2))} ${y2} ${z2} ${b}`);
      }
    };
    const setb = (x, y, z, b) => cmds.push(`setblock ${x} ${y} ${z} ${b}`);
    const X1 = X0 + W - 1, Z1 = Z0 + W - 1;

    // 외벽 + 내부 비우기, 바닥, 천장
    // (hollow 은 나눠 채우면 안쪽 벽이 생기므로 통째로 채운 뒤 안쪽을 비움)
    fill(X0, Y0, Z0, X1, Y0 + 6, Z1, theme.wall);
    fill(X0 + 1, Y0 + 1, Z0 + 1, X1 - 1, Y0 + 5, Z1 - 1, "air");
    fill(X0, Y0, Z0, X1, Y0, Z1, theme.floor);
    fill(X0, Y0 + 6, Z0, X1, Y0 + 6, Z1, theme.ceil);
    // 방 사이 벽
    for (let i = 1; i < size; i++) {
      fill(X0 + i * CELL, Y0 + 1, Z0, X0 + i * CELL, Y0 + 5, Z1, theme.wall);
      fill(X0, Y0 + 1, Z0 + i * CELL, X1, Y0 + 5, Z0 + i * CELL, theme.wall);
    }
    // 문 뚫기
    const doors = makeMaze(size);
    for (const [x1, z1, x2, z2] of doors) {
      // 일부 연결은 벽 전체를 허물어 넓은 홀로 만듦 (시작 방 제외)
      const hall = size >= 4 && Math.random() < 0.18 && !(x1 === 0 && z1 === 0);
      const [a, b, h] = hall ? [1, 9, 5] : [4, 6, 3];
      if (x1 !== x2) {
        const wx = X0 + Math.max(x1, x2) * CELL, bz = Z0 + z1 * CELL;
        fill(wx, Y0 + 1, bz + a, wx, Y0 + h, bz + b, "air");
      } else {
        const wz = Z0 + Math.max(z1, z2) * CELL, bx = X0 + x1 * CELL;
        fill(bx + a, Y0 + 1, wz, bx + b, Y0 + h, wz, "air");
      }
    }
    // 방 꾸미기 (조명, 장식)
    for (let rx = 0; rx < size; rx++) for (let rz = 0; rz < size; rz++) {
      const bx = X0 + rx * CELL, bz = Z0 + rz * CELL;
      if (Math.random() < 0.65 || (rx === 0 && rz === 0)) {
        if (theme.lightDown) setb(bx + 5, Y0 + 5, bz + 5, theme.light);
        else setb(bx + 5, Y0 + 6, bz + 5, theme.light);
      }
      if (rx === 0 && rz === 0) continue;
      const count = rnd(3, 6);
      for (let k = 0; k < count; k++) {
        // 벽에 붙여서 배치 (문 위치 3~7은 피함)
        const along = [1, 2, 8, 9][rnd(0, 3)];
        const side = rnd(0, 3);
        const [ox, oz] = side === 0 ? [1, along] : side === 1 ? [9, along] : side === 2 ? [along, 1] : [along, 9];
        const b = theme.decor[rnd(0, theme.decor.length - 1)];
        setb(bx + ox, Y0 + 1, bz + oz, b);
        if (b === "bookshelf" && Math.random() < 0.5) setb(bx + ox, Y0 + 2, bz + oz, b);
      }
    }

    runCommands(cmds, () => populate(level, theme, size, doors, X0, Y0, Z0));
  };
}

function populate(level, theme, size, doors, X0, Y0, Z0) {
  const dim = overworld();
  const crates = [];
  const used = new Set();
  const place = (x, y, z, type) => {
    try {
      const b = dim.getBlock({ x, y, z });
      if (!b) return false;
      b.setType(type);
      return b;
    } catch { return false; }
  };

  // 시작 방: 상점 + 스폰
  const startPos = { x: X0 + 5.5, y: Y0 + 1, z: Z0 + 5.5 };
  S("haul:start_pos", JSON.stringify(startPos));
  place(X0 + 2, Y0 + 1, Z0 + 2, "haul:shop");

  // 추출 지점: 가장 먼 방 + (큰 맵이면) 서로 멀리 떨어진 방 몇 곳
  const { dist } = farthestRoom(size, doors);
  const extCount = size * size >= 36 ? 3 : size * size >= 20 ? 2 : 1;
  const byDist = [...dist.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k.split(",").map(Number));
  const exits = [];
  for (const [rx, rz] of byDist) {
    if (exits.length >= extCount) break;
    if (rx + rz < Math.ceil(size / 2)) continue; // 시작 방 근처 제외
    if (exits.some(([x, z]) => Math.abs(x - rx) + Math.abs(z - rz) < size / 2)) continue;
    exits.push([rx, rz]);
  }
  for (const [ex, ez] of exits) {
    const ext = place(X0 + ex * CELL + 5, Y0 + 1, Z0 + ez * CELL + 5, "haul:extraction_point");
    if (ext) addExtract(ext);
    used.add(`${ex * CELL + 5},${ez * CELL + 5}`);
  }

  // 보물 상자
  const perRoom = level >= 5 ? 3 : level >= 3 ? 2 : 1;
  for (let rx = 0; rx < size; rx++) for (let rz = 0; rz < size; rz++) {
    if (rx === 0 && rz === 0) continue;
    const count = perRoom + (Math.random() < 0.5 ? 1 : 0);
    for (let k = 0; k < count; k++) {
      const ox = rx * CELL + rnd(3, 7), oz = rz * CELL + rnd(3, 7);
      if (used.has(`${ox},${oz}`)) continue;
      used.add(`${ox},${oz}`);
      const b = place(X0 + ox, Y0 + 1, Z0 + oz, "haul:loot_crate");
      if (b) crates.push({ x: b.x, y: b.y, z: b.z, d: dim.id });
    }
  }
  saveCrates(crates);

  // 몬스터: 시작 방에서 2칸 이상 떨어진 방에만
  const far = [...dist.entries()].filter(([, d]) => d >= 2).map(([k]) => k.split(",").map(Number));
  const mobCount = Math.min(size * size - 2, Math.max(1, Math.round((1 + level + (size * size) / 8) * [0.6, 1, 1.6][diff()])));
  for (let i = 0; i < mobCount && far.length; i++) {
    const [rx, rz] = far[rnd(0, far.length - 1)];
    const type = Math.random() < 0.4 + Math.min(0.3, level * 0.03) ? "haul:watcher" : "haul:thief";
    try { dim.spawnEntity(type, { x: X0 + rx * CELL + 5.5, y: Y0 + 1, z: Z0 + rz * CELL + 5.5 }); } catch {}
  }

  // 플레이어 입장
  S("haul:time", timeLimit(level));
  S("haul:building", false);
  stopLoadingScreen();
  for (const p of world.getAllPlayers()) {
    p.teleport(startPos, { dimension: dim });
    p.removeEffect("slow_falling");
    try { p.setSpawnPoint({ ...startPos, dimension: dim }); } catch {}
    p.onScreenDisplay.setTitle("§a시작!", {
      subtitle: `§f${theme.name} · 보물 상자 ${crates.length}개 · 할당량 $${state().quota}`,
      fadeInDuration: 5, stayDuration: 50, fadeOutDuration: 15,
    });
    p.playSound("random.levelup");
  }
  world.sendMessage(`§6[레벨 ${level}] §f${theme.name} §7(${size}x${size} 방). §f추출 지점 ${exits.length}곳 — 초록 빛기둥을 찾으세요. 상점은 시작 방에 있어요.`);
}


// ═════════ 소음 시스템 ═════════
// 플레이어 행동(달리기·점프·상자 부수기 …)과 마이크 음량으로 소음을 계산함.
// 소음이 50을 넘으면 주변 몬스터가 벽 너머에서도 플레이어를 쫓아옴 (10초간).
const noise = new Map();
const lastWarn = new Map();

// ───────── 마이크 연동 ─────────
// 애드온은 마이크에 직접 접근할 수 없으므로, PC에서 실행하는 동반 프로그램(tools/haulers_mic.py)이
// 마이크 음량(0~100)을 측정해 /connect(WebSocket)로 `/scriptevent haul:mic <음량> [플레이어 이름]`을 보냄.
const MIC_TIMEOUT = 60;   // 이 틱 동안 신호가 없으면 마이크 연결 끊김으로 봄
const MIC_TALK = 25;      // 이 음량부터 말소리로 침
const MIC_YELL = 80;      // 이 음량 이상이면 외침 → 즉시 큰 소음
const mic = new Map();    // player.id → { level, peak, at }
const micOn = () => G("haul:mic_on", true);

function micState(p) {
  const m = mic.get(p.id);
  return m && system.currentTick - m.at <= MIC_TIMEOUT ? m : null;
}

function onMic(e) {
  const [raw, ...nameParts] = e.message.trim().split(/\s+/);
  const name = nameParts.join(" ");
  const players = world.getAllPlayers();
  let p = e.sourceEntity?.typeId === "minecraft:player" ? e.sourceEntity : undefined;
  if (!p && name) p = players.find((x) => x.name === name);
  if (!p && players.length === 1) p = players[0];
  if (!p) return;
  if (raw === "off") {
    mic.delete(p.id);
    p.sendMessage("§7[마이크] 연결이 해제되었습니다.");
    return;
  }
  const level = Math.max(0, Math.min(100, Number(raw) || 0));
  const prev = micState(p);
  if (!prev) {
    p.sendMessage(micOn()
      ? "§b[마이크] 연결되었습니다! §7말소리가 몬스터에게 들립니다. 조용히 하세요..."
      : "§7[마이크] 신호를 받았지만 설정에서 마이크 연동이 꺼져 있습니다.");
  }
  mic.set(p.id, { level, peak: Math.max(level, prev?.peak ?? 0), at: system.currentTick });
  // 외침은 1초를 기다리지 않고 바로 반영
  if (micOn() && level >= MIC_YELL) addNoise(p, (level - MIC_YELL) * 1.5 + 20);
}

// 1초 동안의 최고 음량 → 소음 증가량 (보통 대화 ≈ +10, 큰 목소리 ≈ +25)
function micNoise(p) {
  const m = micState(p);
  if (!m || !micOn()) return 0;
  const peak = m.peak;
  m.peak = m.level;
  return peak < MIC_TALK ? 0 : (peak - MIC_TALK) * 0.45 + 4;
}

function micBar(p) {
  const m = micState(p);
  if (!m || !micOn()) return "";
  const n = Math.round(m.level / 20);
  const col = m.level >= MIC_YELL ? "§c" : m.level >= MIC_TALK ? "§e" : "§b";
  return `  §7마이크 ${col}${"■".repeat(n)}§8${"■".repeat(5 - n)}`;
}

function addNoise(p, n) {
  if (!G("haul:noise_on", true)) return;
  const v = Math.min(100, (noise.get(p.id) ?? 0) + n);
  noise.set(p.id, v);
  if (v >= 50) alertMobs(p, v);
}

function tickNoise(p) {
  if (!G("haul:noise_on", true)) return 0;
  let v = noise.get(p.id) ?? 0;
  if (p.isSprinting) v += 14;
  if (p.isJumping) v += 8;
  v += micNoise(p);
  v -= p.isSneaking ? 25 : 12;
  v = Math.max(0, Math.min(100, v));
  noise.set(p.id, v);
  if (v >= 50) alertMobs(p, v);
  return v;
}

function alertMobs(p, v) {
  const radius = 8 + v / 4;
  let heard = 0;
  for (const type of ["haul:watcher", "haul:thief"]) {
    for (const m of p.dimension.getEntities({ type, location: p.location, maxDistance: radius })) {
      try { m.triggerEvent("haul:alert"); heard++; } catch {}
    }
  }
  const now = system.currentTick;
  if (heard && (lastWarn.get(p.id) ?? 0) < now) {
    lastWarn.set(p.id, now + 200);
    p.sendMessage("§c...무언가 소리를 들었다.");
    p.playSound("ambient.cave");
  }
}

function noiseBar(v) {
  const n = Math.round(v / 10);
  const col = v >= 50 ? "§c" : v >= 30 ? "§e" : "§a";
  return col + "|".repeat(n) + "§8" + "|".repeat(10 - n) + (v >= 50 ? " §c들킴!" : p_quiet(v));
}
const p_quiet = (v) => (v === 0 ? " §8조용함" : "");

// ═════════ 트럭 로비 (리포식 시작 화면) ═════════
// 접속하면 하늘 위 트럭 안으로 이동 → 카메라가 천천히 움직이는 장면 위에 메인 메뉴가 뜸.
// 트럭 내부: 폭 x 0~8, 높이 y 0~5, 길이 z 0~14 (z=0 앞쪽 모니터, z=14 뒷문)
const LOBBY = { x: 29000, y: 150, z: 30000 };
const LOBBY_VER = 2; // 트럭 디자인을 바꾸면 올려서 다시 짓게 함
const L = (dx, dy, dz) => ({ x: LOBBY.x + dx, y: LOBBY.y + dy, z: LOBBY.z + dz });
const SHOTS = [
  { location: L(4.5, 3.4, 13.3), facing: L(4.5, 3, 0) },   // 뒤에서 모니터를 바라봄
  { location: L(2.4, 2.5, 7.5), facing: L(4.5, 3.1, 0) },  // 왼쪽 벤치 옆에서 비스듬히
  { location: L(6.6, 3.7, 9.5), facing: L(3, 1.6, 3) },    // 위에서 내려다봄
];
const SEATS = [[1.5, 5.5], [7.5, 5.5], [1.5, 7.5], [7.5, 7.5], [1.5, 9.5], [7.5, 9.5], [1.5, 11.5], [7.5, 11.5]];
const HOLO = [L(4.5, 3.55, 1.2), L(4.5, 2.95, 1.2), L(4.5, 2.5, 1.2)];
const lobby = new Map(); // player.id → { shot }
const inLobby = (p) => lobby.has(p.id);
const isHaulArea = (loc) => loc.x >= 28900 && loc.z >= 29900;
let departing = false;

function fade(p, fadeInTime, holdTime, fadeOutTime) {
  try { p.camera.fade({ fadeTime: { fadeInTime, holdTime, fadeOutTime }, fadeColor: { red: 0, green: 0, blue: 0 } }); } catch {}
}

function setLocked(p, locked) {
  try { p.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, !locked); } catch {}
  try { p.onScreenDisplay.setHudVisibility(locked ? HudVisibility.Hide : HudVisibility.Reset); } catch {}
}

function setShot(p, i, easeTime) {
  const s = SHOTS[i];
  try {
    p.camera.setCamera("minecraft:free", {
      location: s.location, facingLocation: s.facing,
      easeOptions: easeTime ? { easeTime, easeType: EasingType.InOutSine } : undefined,
    });
  } catch {}
}

function lobbyCommands() {
  const c = [];
  const at = (x, y, z) => `${LOBBY.x + x} ${LOBBY.y + y} ${LOBBY.z + z}`;
  const fill = (a, b, block) => c.push(`fill ${at(...a)} ${at(...b)} ${block}`);
  const set = (a, block) => c.push(`setblock ${at(...a)} ${block}`);
  fill([-1, -1, -1], [9, 6, 15], "air");
  fill([0, 0, 0], [8, 5, 14], "gray_concrete hollow");            // 차체
  fill([1, 0, 1], [7, 0, 13], "polished_deepslate");              // 철판 바닥
  fill([0, 1, 1], [0, 2, 13], "light_gray_concrete");             // 벽 아래 패널
  fill([8, 1, 1], [8, 2, 13], "light_gray_concrete");
  for (const z of [3, 6, 9, 12]) {                                // 갈빗대
    fill([0, 1, z], [0, 4, z], "iron_block");
    fill([8, 1, z], [8, 4, z], "iron_block");
    fill([1, 5, z], [7, 5, z], "iron_block");
  }
  for (const z of [2, 5, 8, 11]) set([4, 5, z], "ochre_froglight"); // 따뜻한 천장 조명
  fill([1, 1, 0], [7, 4, 0], "polished_blackstone");              // 모니터 틀
  fill([2, 2, 0], [6, 4, 0], "black_concrete");                   // 모니터 화면
  fill([1, 1, 1], [7, 1, 1], "polished_blackstone");              // 계기판
  set([1, 2, 1], "lantern");
  set([7, 2, 1], "lantern");
  fill([1, 1, 3], [1, 1, 12], "spruce_slab");                     // 벤치
  fill([7, 1, 3], [7, 1, 12], "spruce_slab");
  fill([1, 1, 13], [1, 2, 13], "barrel");                         // 짐
  fill([7, 1, 13], [7, 1, 13], "barrel");
  set([6, 1, 13], "chest");
  fill([2, 1, 14], [6, 4, 14], "iron_block");                     // 뒷문
  fill([4, 1, 14], [4, 4, 14], "polished_blackstone");
  for (let x = 1; x <= 7; x++) set([x, 0, 13], x % 2 ? "yellow_concrete" : "black_concrete"); // 문 앞 경고 줄무늬
  for (let x = 1; x <= 7; x++) set([x, 0, 2], x % 2 ? "yellow_concrete" : "black_concrete");  // 모니터 앞 경고 줄무늬
  set([3, 1, 1], "verdant_froglight");                            // 계기판 표시등
  set([5, 1, 1], "verdant_froglight");
  set([4, 1, 1], "redstone_block");
  fill([7, 1, 11], [7, 1, 12], "barrel");                         // 쌓인 화물
  set([7, 2, 12], "barrel");
  set([1, 3, 13], "barrel");
  return c;
}

// 트럭이 아직 없으면 지음 (청크가 불러와질 때까지 기다린 뒤)
let lobbyBuilding = false;
const lobbyWaiters = [];
function ensureLobby(done) {
  if (G("haul:lobby_ver", 0) === LOBBY_VER) return done();
  lobbyWaiters.push(done);
  if (lobbyBuilding) return;
  lobbyBuilding = true;
  let waited = 0;
  const loaded = () => [L(0, 0, 0), L(8, 5, 14)].every((b) => { try { return !!overworld().getBlock(b); } catch { return false; } });
  const job = system.runInterval(() => {
    waited += 10;
    if (!loaded() && waited < 400) return;
    system.clearRun(job);
    runCommands(lobbyCommands(), () => {
      S("haul:lobby_ver", LOBBY_VER);
      lobbyBuilding = false;
      for (const fn of lobbyWaiters.splice(0)) fn();
    });
  }, 10);
}

function returnDest(p) {
  const raw = p.getDynamicProperty("haul:return");
  if (raw) {
    try {
      const r = JSON.parse(raw);
      return { loc: { x: r.x, y: r.y, z: r.z }, dim: world.getDimension(r.d) };
    } catch {}
  }
  const sp = world.getDefaultSpawnLocation();
  return { loc: { x: sp.x + 0.5, y: sp.y > 300 ? 120 : sp.y + 1, z: sp.z + 0.5 }, dim: overworld(), fall: sp.y > 300 };
}

function enterLobby(p, intro = false) {
  if (inLobby(p)) return openMainMenu(p);
  if (!isHaulArea(p.location)) {
    const l = p.location;
    p.setDynamicProperty("haul:return", JSON.stringify({ x: l.x, y: l.y, z: l.z, d: p.dimension.id }));
  }
  const [sx, sz] = SEATS[lobby.size % SEATS.length];
  lobby.set(p.id, { shot: 0 });
  try { uiManager.closeAllForms(p); } catch {}
  fade(p, intro ? 0 : 0.4, 2, 1.2);
  system.runTimeout(() => {
    if (!inLobby(p)) return;
    setLocked(p, true);
    p.addEffect("resistance", 400, { amplifier: 4, showParticles: false });
    p.addEffect("slow_falling", 200, { showParticles: false });
    const seat = L(sx, 1.5, sz);
    const face = L(sx < 4 ? 8 : 0, 2, sz);
    p.teleport(seat, { dimension: overworld(), facingLocation: face });
    ensureLobby(() => {
      if (!inLobby(p)) return;
      p.teleport(seat, { dimension: overworld(), facingLocation: face });
      setShot(p, 0, 0);
      fade(p, 0, 0.3, 1.5);
      updateHolograms();
      p.playSound("beacon.activate", { pitch: 0.7, volume: 0.7 });
      if (intro) {
        p.onScreenDisplay.setTitle("§l§6H.A.U.L.E.R.S", {
          subtitle: "§7보물 회수 협동 작전", fadeInDuration: 20, stayDuration: 50, fadeOutDuration: 20,
        });
      }
      system.runTimeout(() => openMainMenu(p), intro ? 90 : 25);
    });
  }, 10);
}

// 로비 상태만 해제 (카메라·이동·HUD 복구). 위치 이동은 호출한 쪽에서 함
function leaveLobbyState(p) {
  if (!lobby.delete(p.id)) return false;
  try { uiManager.closeAllForms(p); } catch {}
  try { p.camera.clear(); } catch {}
  setLocked(p, false);
  return true;
}

function exitLobby(p, dest) {
  fade(p, 0.3, 0.5, 1);
  system.runTimeout(() => {
    leaveLobbyState(p);
    if (dest.fall) p.addEffect("slow_falling", 600, { showParticles: false });
    p.teleport(dest.loc, { dimension: dest.dim });
  }, 8);
}

// 게임 시작: 문이 닫히고 트럭이 덜컹거리며 출발 → 암전 → 맵 생성
function departTruck() {
  if (departing || G("haul:building", false)) return;
  departing = true;
  updateHolograms();
  const riders = world.getAllPlayers().filter(inLobby);
  for (const p of riders) {
    try { uiManager.closeAllForms(p); } catch {}
    p.playSound("random.door_close", { pitch: 0.6 });
    p.onScreenDisplay.setTitle("§6출발합니다", {
      subtitle: "§7목적지로 이동 중...", fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 10,
    });
  }
  system.runTimeout(() => {
    for (const p of riders) {
      p.playSound("ambient.weather.thunder", { pitch: 0.5, volume: 0.35 });
      try { p.runCommand("camerashake add @s 0.18 4 positional"); } catch {}
    }
  }, 20);
  system.runTimeout(() => {
    for (const p of riders) fade(p, 1, 4, 0.5);
  }, 70);
  system.runTimeout(() => {
    departing = false;
    startMapGame();
  }, 95);
}

// 맵 생성 동안 화면을 계속 검게 유지 (리포의 로딩 화면)
let loadingJob;
function startLoadingScreen() {
  stopLoadingScreen();
  const tick = () => { for (const p of world.getAllPlayers()) fade(p, 0.5, 6, 0.5); };
  tick();
  loadingJob = system.runInterval(tick, 100);
}
function stopLoadingScreen() {
  if (loadingJob === undefined) return;
  system.clearRun(loadingJob);
  loadingJob = undefined;
  for (const p of world.getAllPlayers()) fade(p, 0, 0.4, 1.5);
}

// 모니터 글자 (이름표만 보이는 투명 엔티티 3줄)
function holoText() {
  const s = state();
  if (departing) return ["§l§c출발!", "§7목적지로 이동 중...", ""];
  const inGame = G("haul:map_mode", false);
  return [
    "§l§6H.A.U.L.E.R.S",
    inGame ? `§f레벨 ${s.level}   §a$${s.deposited}§7/§6$${s.quota}` : "§7출발 대기 중",
    `§8탑승 ${lobby.size}명  ·  최고 레벨 ${G("haul:best", 1)}`,
  ];
}

function updateHolograms() {
  if (!lobby.size || lobbyBuilding) return;
  const dim = overworld();
  let ents;
  try { ents = dim.getEntities({ type: "haul:hologram", location: HOLO[1], maxDistance: 3 }); } catch { return; }
  const text = holoText();
  for (let i = 0; i < HOLO.length; i++) {
    let e = ents.find((x) => x.getDynamicProperty("haul:line") === i);
    if (!e) {
      try { e = dim.spawnEntity("haul:hologram", HOLO[i]); e.setDynamicProperty("haul:line", i); } catch { continue; }
    }
    if (e.nameTag !== text[i]) e.nameTag = text[i];
  }
}

let lobbyTick = 0;
system.runInterval(() => {
  if (!lobby.size) return;
  lobbyTick++;
  updateHolograms();
  for (const p of world.getAllPlayers()) {
    const st = lobby.get(p.id);
    if (!st) continue;
    if (lobbyTick % 10 === 0) {                    // 10초마다 다음 카메라 구도로 천천히 이동
      st.shot = (st.shot + 1) % SHOTS.length;
      setShot(p, st.shot, 9.5);
    }
    if (lobbyTick % 15 === 0) p.addEffect("resistance", 400, { amplifier: 4, showParticles: false });
    if (lobbyTick % 23 === 0) p.playSound("ambient.cave", { volume: 0.25, pitch: 0.6 });
  }
}, 20);

// ═════════ 메인 메뉴 UI ═════════
const sleep = (t) => new Promise((r) => system.runTimeout(r, t));
// 창 제목 맨 앞에 붙이는 보이지 않는 표시 → 리소스팩(ui/server_form.json)이 이걸 보고 리포 스타일 창으로 그림
const UI = "§h§a§u§l";

async function show(p, form) {
  for (let i = 0; i < 20; i++) {
    const res = await form.show(p);
    if (res.canceled && res.cancelationReason === "UserBusy") { await sleep(20); continue; }
    return res;
  }
  return { canceled: true };
}

// 리포 메인 메뉴처럼: 아이콘 없는 글자 버튼, 트럭 안 장면이 배경으로 보임
async function openMainMenu(p) {
  if (!inLobby(p)) return enterLobby(p);
  const s = state();
  const inGame = G("haul:map_mode", false);
  const body =
    "§8━━━━━━━━━━━━━━━━━━━━\n" +
    "§7     보물 회수 협동 작전\n" +
    "§8━━━━━━━━━━━━━━━━━━━━\n\n" +
    (inGame
      ? `§f진행 중  §6레벨 ${s.level}  §a$${s.deposited}§7/§6$${s.quota}\n`
      : "§7트럭이 출발을 기다리고 있습니다.\n") +
    `§8최고 기록 레벨 ${G("haul:best", 1)}  ·  난이도 ${DIFF_NAMES[diff()]}  §8·  탑승 ${lobby.size}명\n`;

  const actions = [];
  const form = new ActionFormData().title(UI + "§l§6H . A . U . L . E . R . S").body(body);
  const add = (label, fn) => { form.button(label); actions.push(fn); };

  if (inGame) {
    add("§l§6이어하기", () => continueGame(p));
    add("§l처음부터 다시", () => confirmRestart(p));
  } else {
    add("§l§6게임 시작", () => departTruck());
  }
  add("§l튜토리얼", () => openHelp(p));
  add("§l설정", () => openSettings(p));
  add("§l기록", () => openRecords(p));
  if (inGame) add("§l§c게임 종료", () => stopMapGame());
  else add("§l§7트럭에서 내리기", () => exitLobby(p, returnDest(p)));

  const res = await show(p, form);
  if (!inLobby(p) || departing) return;
  if (res.canceled || res.selection === undefined) {
    // 리포처럼 메뉴는 닫히지 않음 — 잠시 뒤 다시 표시
    system.runTimeout(() => { if (inLobby(p) && !departing) openMainMenu(p); }, 40);
    return;
  }
  if (G("haul:building", false) && res.selection === 0) {
    p.sendMessage("§7맵 생성 중입니다...");
    return openMainMenu(p);
  }
  p.playSound("random.click", { pitch: 0.8 });
  actions[res.selection]();
}

function continueGame(p) {
  const raw = G("haul:start_pos", "");
  if (!raw || G("haul:building", false)) return openMainMenu(p);
  exitLobby(p, { loc: JSON.parse(raw), dim: overworld() });
}

async function confirmRestart(p) {
  const res = await show(p, new ActionFormData()
    .title(UI + "§l처음부터 다시")
    .body("§f지금 진행 중인 게임과 업그레이드가 모두 초기화됩니다.\n정말 다시 시작할까요?")
    .button("§l§c다시 시작", "textures/ui/haul_restart")
    .button("§l취소", "textures/ui/haul_exit"));
  if (!res.canceled && res.selection === 0) departTruck();
  else openMainMenu(p);
}

async function openHelp(p) {
  const text = [
    "§6■ 목표",
    "§f제한 시간 안에 보물을 §a추출 지점§f에 납품해 할당량을 채우세요.",
    "",
    "§6■ 보물",
    "§f상자를 부수면 보물이 나옵니다. §c맞거나 떨어지면 가치가 깎이고§f, 0이 되면 부서집니다.",
    "§f황금 금고는 비싸지만 무거워서 느려집니다.",
    "",
    "§6■ 소음",
    "§f달리기·점프·상자 부수기·보물 깨짐은 소리를 냅니다.",
    "§f화면 아래 소음 막대가 §c빨간색§f이 되면 몬스터가 벽 너머에서도 쫓아옵니다.",
    "§a웅크리면§f 소음이 빨리 줄어듭니다.",
    "§b마이크 연동§f을 켜면 실제 목소리도 소음이 됩니다. §c소리치면§f 바로 들킵니다!",
    "§7(PC에서 haulers_mic 프로그램 실행 → 채팅에 /connect localhost:3000)",
    "",
    "§6■ 몬스터",
    "§f공허의 감시자: 느리지만 한 방이 셉니다.",
    "§f도둑 고블린: 보물을 훔쳐 §e달아납니다§f. 잡으면 되찾을 수 있습니다.",
    "",
    "§6■ 상점 (시작 방)",
    "§f업그레이드, 치료 키트, 보물 탐지기, 충격봉을 살 수 있습니다.",
    "§f보물 탐지기는 가장 가까운 상자 쪽으로 §a빛줄기§f를 보여 줍니다.",
    "",
    "§6■ 추출 지점",
    "§f초록 빛기둥이 솟는 곳입니다. 우클릭하면 가진 보물을 모두 납품합니다.",
    "§f큰 맵에는 추출 지점이 §a2~3곳§f 있습니다. 가까운 곳을 찾으세요.",
    "",
    "§6■ 맵",
    "§f레벨이 오를수록 맵이 커집니다. 설정에서 §e맵 크기§f를 고를 수 있습니다.",
  ].join("\n");
  await show(p, new ActionFormData().title(UI + "§l게임 방법").body(text).button("§l뒤로", "textures/ui/haul_exit"));
  openMainMenu(p);
}

async function openSettings(p) {
  const form = new ModalFormData()
    .title(UI + "§l설정")
    .dropdown("난이도 (다음 게임부터 제한 시간·몬스터 수에 적용)", ["쉬움", "보통", "어려움"], { defaultValueIndex: diff() })
    .dropdown("맵 크기 (다음 맵부터 적용)", ["보통 (3~6칸)", "크게 (5~8칸)", "아주 크게 (6~9칸)"], { defaultValueIndex: mapScale() })
    .toggle("제한 시간", { defaultValue: G("haul:timer_on", true) })
    .toggle("소음 시스템 (몬스터가 소리를 들음)", { defaultValue: G("haul:noise_on", true) })
    .toggle("마이크 연동 (PC 동반 프로그램 필요)", { defaultValue: micOn() });
  const res = await show(p, form);
  if (!res.canceled && res.formValues) {
    const [d, scale, timer, noiseOn, micEnabled] = res.formValues;
    S("haul:difficulty", d);
    S("haul:map_scale", scale);
    if (timer && !G("haul:timer_on", true)) S("haul:time", timeLimit(state().level));
    S("haul:timer_on", timer);
    S("haul:noise_on", noiseOn);
    S("haul:mic_on", micEnabled);
    world.sendMessage(`§7[설정] 난이도 ${DIFF_NAMES[d]}§7 · 맵 ${SCALE_NAMES[scale]}§7 · 제한 시간 ${timer ? "켜짐" : "꺼짐"} · 소음 ${noiseOn ? "켜짐" : "꺼짐"} · 마이크 ${micEnabled ? "켜짐" : "꺼짐"}`);
  }
  openMainMenu(p);
}

async function openRecords(p) {
  const body =
    `§e최고 레벨: §f${G("haul:best", 1)}\n` +
    `§e누적 납품액: §f$${G("haul:total", 0)}\n` +
    `§e플레이한 게임 수: §f${G("haul:games", 0)}\n`;
  await show(p, new ActionFormData().title(UI + "§l기록").body(body).button("§l뒤로", "textures/ui/haul_exit"));
  openMainMenu(p);
}
