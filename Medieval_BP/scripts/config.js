// Medieval Arsenal - balance table.
// Every number that affects gameplay lives here so it can be tuned in one place.
// Times are in ticks (20 ticks = 1 second). Cooldowns match the item JSON
// "minecraft:cooldown" durations so the vanilla cooldown bar stays in sync.

export const NS = "mdv";

export const STAMINA = {
  base: 100, // starting max stamina
  cap: 200, // max reachable with Valor Medals
  medalBonus: 20,
  regenPerSecond: 6,
  regenDelay: 30, // ticks after spending before regen resumes
  tonicRestore: 50,
};

export const WEAPONS = {
  "mdv:knight_longsword": {
    ability: "charge_slash",
    stamina: 20,
    cooldown: 40,
    damage: 9,
    dashForce: 2.4,
    dashTicks: 8,
    hitRadius: 2.2,
  },
  "mdv:warhammer": {
    ability: "ground_slam",
    stamina: 35,
    cooldown: 80,
    damage: 12,
    radius: 5.5,
    heightBonusPerBlock: 1.5,
    heightBonusMax: 10,
  },
  "mdv:battle_axe": {
    ability: "whirlwind",
    stamina: 30,
    cooldown: 70,
    damage: 7,
    radius: 3.6,
    pulses: 3,
    pulseInterval: 10,
    bleedChance: 0.25, // passive, on normal hits
  },
  "mdv:halberd": {
    ability: "piercing_thrust",
    stamina: 18,
    cooldown: 30,
    damage: 11,
    range: 6.5,
    width: 1.1,
  },
  "mdv:heavy_crossbow": {
    ability: "crossbow",
    fullCharge: 25, // ticks to fully wind (quick_charge removes 5 per level)
    minRatio: 0.35,
    damageMin: 6,
    damageMax: 20,
    boltBonus: 2, // extra damage when firing mdv:crossbow_bolt instead of arrows
    speedMin: 2.0,
    speedMax: 4.5,
    critMultiplier: 1.25,
  },
  "mdv:dagger": {
    ability: "shadow_step",
    stamina: 20,
    cooldown: 100,
    damage: 6,
    backstabMultiplier: 2.0,
    backstabDot: -0.35,
    invisTicks: 60,
  },
  "mdv:morning_star": {
    ability: "stunning_blow",
    stamina: 15,
    cooldown: 60,
    damage: 10,
    stunChance: 0.2, // passive
    stunTicks: 40,
    heavyStunTicks: 60,
    heavyBonus: 6,
    armedTicks: 100,
  },
  "mdv:javelin": {
    ability: "throw_javelin",
    stamina: 10,
    cooldown: 16,
    damage: 12,
    speed: 2.6,
  },
  "mdv:fire_pot": {
    ability: "throw_fire_pot",
    stamina: 0,
    cooldown: 20,
    damage: 4,
    radius: 3.2,
    burnSeconds: 6,
    speed: 1.4,
  },
  // 신초의 검 - 태초의 마법진: 발밑에 마법진을 펼쳐 적을 끌어당겨 묶고,
  // 마법진 폭발 + 앞으로 뻗는 빛의 참격 3연발. 부서지지 않는다.
  "mdv:primordial_blade": {
    ability: "primordial_circle",
    stamina: 60,
    cooldown: 200,
    damage: 16,
    chargeTicks: 20, // 마법진 전개 시간
    circleRadius: 6, // 마법진 반지름 (블록)
    pullForce: 0.55, // 전개 중 4틱마다 중심으로 끌어당기는 힘
    circleDamage: 20, // 마법진 폭발 피해
    waves: 3,
    waveInterval: 6,
    waveDamage: 18,
    waveRange: 16,
    waveSpeed: 1.6, // 틱당 블록
    waveWidth: 1.6, // 시작 폭(반)
    waveGrow: 0.18, // 거리당 넓어지는 폭
    riftChance: 0.25, // 패시브: 평타 적중 시 균열
    riftDamage: 8,
  },
  "mdv:war_horn": {
    ability: "rally",
    stamina: 40,
    cooldown: 1200,
    allyRadius: 16,
    enemyRadius: 12,
    buffTicks: 200,
  },
};

// Items that show the stamina HUD while held
export const HUD_ITEMS = new Set([
  ...Object.keys(WEAPONS),
  "mdv:stamina_tonic",
  "mdv:valor_medal",
]);

export const BLEED = { ticks: 3, damage: 1.5, interval: 20 };

export const PROJECTILE_TYPES = ["mdv:crossbow_bolt", "mdv:thrown_javelin", "mdv:thrown_fire_pot"];

export const IGNORE_TYPES = [
  "minecraft:item",
  "minecraft:xp_orb",
  "minecraft:arrow",
  "minecraft:armor_stand",
  "minecraft:painting",
  "minecraft:leash_knot",
  ...PROJECTILE_TYPES,
];
