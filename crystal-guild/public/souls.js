// 크리스탈 소울: 다크 소울 느낌의 픽셀 액션 RPG.
// 체력·스태미나, 약공/강공, 구르기(무적 시간), 에스트 병, 화톳불(휴식·레벨 업·적 부활),
// 죽으면 그 자리에 소울을 떨어뜨림(다시 죽으면 잃음), 지름길 문, 안개 문 너머 2페이즈 보스.
// 진행은 이 기기(localStorage)에 저장되고, 보스를 쓰러뜨리면 기록이 순위에 올라간다.
import { makeScreen, text, center, loop, sprite } from './arcade.js';
import { PAL, KNIGHT, HOLLOW, ARCHER, DARK_KNIGHT, BOSS } from './souls-art.js';
import * as G from './souls-gfx.js';

const T = 16;
const VW = 320, VH = 200;
const SAVE_KEY = 'crystal.souls.v1';

// ---------- 지도 ----------
const MW = 64, MH = 56;
function buildMap() {
  const g = Array.from({ length: MH }, () => Array(MW).fill('#'));
  const carve = (x, y, w, h, ch = '.') => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) g[j][i] = ch; };
  carve(2, 44, 12, 10);            // 시작 사당
  carve(14, 47, 10, 3);            // 복도 1
  carve(24, 40, 16, 14);           // 큰 홀
  for (const [x, y] of [[28, 44], [34, 44], [28, 49], [34, 49]]) carve(x, y, 2, 2, '#'); // 기둥
  carve(30, 30, 4, 10);            // 북쪽 복도
  carve(18, 16, 28, 14, ',');      // 재의 안뜰
  carve(9, 17, 3, 26);             // 서쪽 지름길 복도
  carve(12, 17, 6, 3);             // 안뜰 서쪽 입구
  carve(9, 43, 3, 1, 'D');         // 지름길 문 (북쪽에서만 열림)
  carve(46, 20, 6, 3);             // 동쪽 복도
  carve(52, 18, 8, 8);             // 두 번째 화톳불 방
  carve(54, 11, 4, 7);             // 보스 앞 복도
  carve(54, 10, 4, 1, 'F');        // 안개 문
  carve(42, 1, 20, 9);             // 보스 방
  return g;
}

const BONFIRES = [
  { id: 'shrine', x: 7 * T + 8, y: 48 * T + 8, name: '시작의 사당' },
  { id: 'tower', x: 55 * T + 8, y: 22 * T + 8, name: '수호자의 탑 아래' },
];
const CHESTS = [
  { id: 'c1', x: 37 * T + 8, y: 52 * T + 8, give: 'estus', text: '에스트 병을 얻었어요! (최대 +1)' },
  { id: 'c2', x: 44 * T + 8, y: 28 * T + 8, give: 'str', text: '용사의 파편을 얻었어요! (힘 +1)' },
  { id: 'c3', x: 3 * T + 8, y: 45 * T + 8, give: 'souls', text: '잃어버린 소울 300을 주웠어요.' },
];
const SPAWNS = [
  ['hollow', 18, 48], ['hollow', 31, 42], ['hollow', 37, 47], ['hollow', 30, 52], ['hollow', 31, 34],
  ['archer', 22, 18], ['archer', 42, 18], ['knight', 32, 22], ['hollow', 25, 26], ['hollow', 40, 27],
  ['hollow', 10, 30], ['knight', 48, 21], ['archer', 56, 13],
];

// 맞았을 때 하얗게 번쩍이는 그림, 2페이즈 보스 색
const WHITE = Object.fromEntries(Object.keys(PAL).map((k) => [k, '#ffffff']));
const BOSS_P2 = { ...PAL, i: '#ff70d0', h: '#ffb0e8', j: '#8a2a6a' };

function defaultSave() {
  return { lvl: 1, vit: 0, end: 0, str: 0, souls: 0, bonfire: 'shrine', lit: [], estusMax: 3, shortcut: false, boss: false, deaths: 0, playMs: 0, chests: [], stain: null, cleared: false };
}
function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s && s.lvl ? { ...defaultSave(), ...s } : null; } catch { return null; }
}
function writeSave(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* 저장 못 해도 진행 */ } }

export function crystalSouls(area, { onClear }) {
  area.innerHTML = `<div class="sl-wrap" id="sl-wrap">
      <div class="sl-screen" id="sl-screen"></div>
      <div class="sl-ui hidden" id="sl-ui"></div>
      <div class="sl-toast" id="sl-toast"></div>
    </div>
    <div class="sl-pad" id="sl-pad">
      <div class="sl-stick" id="sl-stick"><div class="sl-knob" id="sl-knob"></div></div>
      <div class="sl-btns">
        <button type="button" data-b="heavy">강공</button><button type="button" data-b="light">공격</button>
        <button type="button" data-b="heal">회복</button><button type="button" data-b="roll">구르기</button>
        <button type="button" data-b="use" class="wide">상호작용</button>
      </div>
    </div>`;
  const $ = (q) => area.querySelector(q);
  const { cv, ctx } = makeScreen($('#sl-screen'), VW, VH, 960);
  const spr = {
    p: [KNIGHT.idle, KNIGHT.walk1, KNIGHT.idle, KNIGHT.walk2].map((r) => sprite(r, PAL)), pR: sprite(KNIGHT.roll, PAL),
    hollow: [sprite(HOLLOW.idle, PAL), sprite(HOLLOW.walk, PAL), sprite(HOLLOW.idle, WHITE)],
    archer: [sprite(ARCHER.idle, PAL), sprite(ARCHER.walk, PAL), sprite(ARCHER.idle, WHITE)],
    knight: [sprite(DARK_KNIGHT.idle, PAL), sprite(DARK_KNIGHT.walk, PAL), sprite(DARK_KNIGHT.idle, WHITE)],
    boss: sprite(BOSS.body, PAL), boss2: sprite(BOSS.body, BOSS_P2), bossW: sprite(BOSS.body, WHITE),
  };
  const map = buildMap();
  const avoid = [...BONFIRES, ...CHESTS].map((o) => [Math.floor(o.x / T), Math.floor(o.y / T)]).concat([[10, 43], [55, 10], [56, 10], [52, 5], [32, 46]]);
  const gfx = G.buildTiles(map, MW, MH, avoid);
  const darkness = G.makeDark(VW, VH);
  const title = G.makeTitle(VW, VH);
  const hud = { hpLag: 0, lagT: 0 };

  let save = loadSave() || defaultSave();
  const stats = () => ({
    hpMax: 90 + save.vit * 12,
    stMax: 80 + save.end * 10,
    light: 14 + save.str * 3,
    heavy: 26 + save.str * 5,
  });
  const P = { x: 0, y: 0, hp: 1, st: 1, face: { x: 1, y: 0 }, act: null, actT: 0, combo: 0, iframe: 0, stun: 0, estus: 3, stDelay: 0, hits: new Set(), walk: 0 };
  let enemies = [];
  let boss = null;
  let shots = [];
  let fx = [];
  let mode = 'title'; // title | play | menu | dead | victory
  let deadT = 0;
  let banner = null;
  let inArena = false;
  let toastT = null;
  let paused = false;
  const input = { x: 0, y: 0, light: false, heavy: false, roll: false, heal: false, use: false };

  const toast = (msg) => {
    const el = $('#sl-toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('on'), 2200);
  };

  // ---------- 지도 판정 ----------
  const tileAt = (px, py) => {
    const c = Math.floor(px / T), r = Math.floor(py / T);
    if (r < 0 || r >= MH || c < 0 || c >= MW) return '#';
    return map[r][c];
  };
  const solidTile = (ch) => ch === '#' || (ch === 'D' && !save.shortcut) || (ch === 'F' && !save.boss); // 보스를 잡으면 안개가 걷힘
  const blocked = (x, y, r) => solidTile(tileAt(x - r, y - r)) || solidTile(tileAt(x + r, y - r)) || solidTile(tileAt(x - r, y + r)) || solidTile(tileAt(x + r, y + r));
  function moveBody(b, dx, dy, r = 5) {
    if (!blocked(b.x + dx, b.y, r)) b.x += dx;
    if (!blocked(b.x, b.y + dy, r)) b.y += dy;
  }
  const lineOfSight = (a, b) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 8);
    for (let i = 1; i < n; i++) if (solidTile(tileAt(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n))) return false;
    return true;
  };

  // ---------- 적 ----------
  const TYPES = {
    hollow: { hp: 34, speed: 0.045, range: 18, windup: 480, active: 150, recover: 560, dmg: 18, souls: 40, aggro: 100, poise: 2 },
    archer: { hp: 22, speed: 0.04, range: 120, windup: 650, active: 60, recover: 1000, dmg: 14, souls: 60, aggro: 130, poise: 1 },
    knight: { hp: 95, speed: 0.034, range: 22, windup: 720, active: 200, recover: 700, dmg: 34, souls: 160, aggro: 110, poise: 4 },
  };
  function spawnEnemies() {
    enemies = SPAWNS.map(([type, cx, cy]) => {
      const t = TYPES[type];
      return { type, ...t, x: cx * T + 8, y: cy * T + 8, hx: cx * T + 8, hy: cy * T + 8, hpMax: t.hp, state: 'idle', timer: 0, dir: { x: 1, y: 0 }, poiseDmg: 0, flash: 0, walk: Math.random() * 1000, dead: false };
    });
    boss = save.boss ? null : {
      x: 52 * T, y: 4 * T, hp: 900, hpMax: 900, state: 'wait', timer: 0, dir: { x: 0, y: 1 }, flash: 0, phase: 1, cool: 1200, vx: 0, vy: 0, poiseDmg: 0, hits: 0,
    };
    shots = [];
  }

  function hurtPlayer(dmg, from) {
    if (P.iframe > 0 || mode !== 'play') return;
    P.hp -= dmg;
    P.iframe = 450;
    P.stun = 240;
    P.act = null;
    if (from) { const d = Math.hypot(P.x - from.x, P.y - from.y) || 1; moveBody(P, ((P.x - from.x) / d) * 6, ((P.y - from.y) / d) * 6); }
    fx.push({ kind: 'spark', x: P.x, y: P.y - 6, t: 0, c: '#ff4040' });
    if (P.hp <= 0) die();
  }

  function die() {
    P.hp = 0;
    mode = 'dead';
    deadT = 0;
    save.deaths++;
    // 소울은 죽은 자리에 (전에 떨어뜨린 건 사라짐)
    save.stain = save.souls > 0 ? { x: P.x, y: P.y, souls: save.souls } : null;
    save.souls = 0;
    writeSave(save);
  }

  function respawn(atBonfireId = save.bonfire) {
    const b = BONFIRES.find((x) => x.id === atBonfireId) || BONFIRES[0];
    const s = stats();
    Object.assign(P, { x: b.x, y: b.y + 18, hp: s.hpMax, st: s.stMax, estus: save.estusMax, act: null, iframe: 600, stun: 0 });
    inArena = false;
    spawnEnemies();
    fx = [];
  }

  // ---------- 화톳불 메뉴 ----------
  const levelCost = () => 100 + save.lvl * 60;
  function openBonfire(b) {
    mode = 'menu';
    if (!save.lit.includes(b.id)) { save.lit.push(b.id); banner = { s: 'BONFIRE LIT', t: 0, c: '#ffb040' }; }
    save.bonfire = b.id;
    respawnFromRest(b);
    renderMenu(b);
  }
  function respawnFromRest(b) {
    const s = stats();
    P.hp = s.hpMax; P.st = s.stMax; P.estus = save.estusMax;
    spawnEnemies();
    P.x = b.x; P.y = b.y + 18;
    writeSave(save);
  }
  function renderMenu(b, page = 'main') {
    const ui = $('#sl-ui');
    ui.classList.remove('hidden');
    const s = stats();
    if (page === 'main') {
      ui.innerHTML = `<div class="sl-panel"><h3>${b.name}</h3><p>쉬었어요. 체력과 에스트 병이 다시 찼고, 적들이 되살아났어요.</p>
        <div class="sl-menu"><button data-m="level">레벨 업 (소울 ${levelCost()})</button>${save.lit.length > 1 ? '<button data-m="warp">다른 화톳불로 이동</button>' : ''}<button data-m="leave">떠나기</button></div></div>`;
    } else if (page === 'level') {
      const cost = levelCost();
      const can = save.souls >= cost;
      ui.innerHTML = `<div class="sl-panel"><h3>레벨 ${save.lvl} <span>· 필요 소울 ${cost} / 보유 ${save.souls}</span></h3>
        <ul class="sl-stats"><li>체력 <b>${10 + save.vit}</b><span>최대 체력 ${s.hpMax}</span></li><li>지구력 <b>${10 + save.end}</b><span>스태미나 ${s.stMax}</span></li><li>힘 <b>${10 + save.str}</b><span>공격력 ${s.light}/${s.heavy}</span></li></ul>
        <div class="sl-menu">${['vit', 'end', 'str'].map((k) => `<button data-up="${k}"${can ? '' : ' disabled'}>${{ vit: '체력', end: '지구력', str: '힘' }[k]} +1</button>`).join('')}<button data-m="main">돌아가기</button></div></div>`;
    } else if (page === 'warp') {
      ui.innerHTML = `<div class="sl-panel"><h3>화톳불 이동</h3><div class="sl-menu">${BONFIRES.filter((x) => save.lit.includes(x.id)).map((x) => `<button data-w="${x.id}">${x.name}</button>`).join('')}<button data-m="main">돌아가기</button></div></div>`;
    }
    ui.querySelectorAll('[data-m]').forEach((el) => (el.onclick = () => {
      if (el.dataset.m === 'leave') { ui.classList.add('hidden'); mode = 'play'; } else renderMenu(b, el.dataset.m);
    }));
    ui.querySelectorAll('[data-up]').forEach((el) => (el.onclick = () => {
      const cost = levelCost();
      if (save.souls < cost) return;
      save.souls -= cost;
      save.lvl++;
      save[el.dataset.up]++;
      const s2 = stats();
      P.hp = s2.hpMax; P.st = s2.stMax;
      writeSave(save);
      renderMenu(b, 'level');
    }));
    ui.querySelectorAll('[data-w]').forEach((el) => (el.onclick = () => {
      const nb = BONFIRES.find((x) => x.id === el.dataset.w);
      save.bonfire = nb.id;
      respawnFromRest(nb);
      renderMenu(nb);
    }));
  }

  function titleScreen() {
    mode = 'title';
    const ui = $('#sl-ui');
    ui.classList.remove('hidden');
    const has = loadSave();
    ui.innerHTML = `<div class="sl-panel title"><p>잿더미가 된 크리스탈 성채. 타락한 수호자를 쓰러뜨리세요.</p>
      <div class="sl-menu">${has ? `<button data-t="cont">이어하기 <span>(레벨 ${has.lvl} · 사망 ${has.deaths})</span></button>` : ''}<button data-t="new">새로 시작</button></div></div>`;
    ui.querySelectorAll('[data-t]').forEach((el) => (el.onclick = () => {
      if (el.dataset.t === 'new') {
        if (has && !confirm('저장된 진행을 지우고 새로 시작할까요?')) return;
        save = defaultSave();
        writeSave(save);
      } else save = loadSave();
      ui.classList.add('hidden');
      respawn();
      mode = 'play';
      banner = { s: 'CRYSTAL SOULS', t: 0, c: '#a8d8ff' };
    }));
  }

  // ---------- 상호작용 ----------
  function nearby() {
    for (const b of BONFIRES) if (Math.hypot(P.x - b.x, P.y - b.y) < 22) return { kind: 'bonfire', b, label: save.lit.includes(b.id) ? '쉬기' : '화톳불 붙이기' };
    for (const c of CHESTS) if (!save.chests.includes(c.id) && Math.hypot(P.x - c.x, P.y - c.y) < 20) return { kind: 'chest', c, label: '열기' };
    if (!save.shortcut && tileAt(P.x, P.y - 12) === 'D') return { kind: 'door', label: '문 열기' };
    if (!save.shortcut && tileAt(P.x, P.y + 12) === 'D') return { kind: 'doorLocked', label: '문 살펴보기' };
    if (tileAt(P.x, P.y - 12) === 'F' && boss) return { kind: 'fog', label: '안개 속으로' };
    return null;
  }
  function interact() {
    const n = nearby();
    if (!n) return;
    if (n.kind === 'bonfire') openBonfire(n.b);
    if (n.kind === 'chest') {
      save.chests.push(n.c.id);
      if (n.c.give === 'estus') { save.estusMax++; P.estus++; }
      if (n.c.give === 'str') save.str++;
      if (n.c.give === 'souls') save.souls += 300;
      writeSave(save);
      toast(n.c.text);
    }
    if (n.kind === 'door') { save.shortcut = true; writeSave(save); toast('지름길이 열렸어요. 시작의 사당으로 이어져요.'); }
    if (n.kind === 'doorLocked') toast('반대편에서 잠겨 있어요.');
    if (n.kind === 'fog') {
      P.y = 9 * T + 4;
      inArena = true;
      boss.state = 'intro';
      boss.timer = 1600;
      banner = { s: 'CORRUPTED WARDEN', t: 0, c: '#d0a0ff' };
    }
  }

  // ---------- 플레이어 ----------
  const ACTS = {
    light: { dur: 380, a0: 110, a1: 240, cost: 18, range: 24, arc: 1.25 },
    heavy: { dur: 680, a0: 330, a1: 470, cost: 32, range: 28, arc: 1.6 },
    roll: { dur: 400, cost: 22 },
    heal: { dur: 950 },
  };
  function startAct(kind) {
    const a = ACTS[kind];
    if (P.act || P.stun > 0) return;
    if (a.cost && P.st <= 0) return;
    if (kind === 'heal' && P.estus <= 0) { toast('에스트 병이 비었어요.'); return; }
    if (a.cost) { P.st -= a.cost; P.stDelay = 500; }
    P.act = kind;
    P.actT = 0;
    P.hits = new Set();
    // 가까운 적 쪽으로 자동 조준
    if (kind === 'light' || kind === 'heavy') {
      const targets = [...enemies.filter((e) => !e.dead), ...(boss && inArena && boss.hp > 0 ? [boss] : [])];
      let best = null;
      for (const e of targets) {
        const d = Math.hypot(e.x - P.x, e.y - P.y);
        if (d < 56 && (!best || d < best.d)) best = { e, d };
      }
      if (best) P.face = { x: (best.e.x - P.x) / best.d, y: (best.e.y - P.y) / best.d };
    }
    if (kind === 'roll') {
      const m = Math.hypot(input.x, input.y);
      if (m > 0.2) P.face = { x: input.x / m, y: input.y / m };
    }
  }

  function swingHits(range, arc, dmg, poise) {
    const targets = [...enemies.filter((e) => !e.dead), ...(boss && inArena && boss.hp > 0 ? [boss] : [])];
    for (const e of targets) {
      if (P.hits.has(e)) continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = Math.hypot(dx, dy);
      const reach = range + (e === boss ? 14 : 6);
      if (d > reach) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * P.face.x + dy * P.face.y) / (d || 1))));
      if (d > 8 && ang > arc) continue;
      P.hits.add(e);
      e.hp -= dmg;
      e.flash = 120;
      fx.push({ kind: 'spark', x: e.x, y: e.y - 6, t: 0, c: '#ffffff' });
      e.poiseDmg = (e.poiseDmg || 0) + poise;
      if (e !== boss && e.poiseDmg >= e.poise) { e.state = 'stagger'; e.timer = 380; e.poiseDmg = 0; }
      if (e === boss && e.poiseDmg >= 12) { e.state = 'stagger'; e.timer = 700; e.poiseDmg = 0; }
      if (e.hp <= 0) killEnemy(e);
    }
  }

  function killEnemy(e) {
    if (e === boss) { bossDown(); return; }
    e.dead = true;
    e.timer = 600;
    save.souls += e.souls;
  }

  function updatePlayer(dt) {
    const s = stats();
    P.iframe = Math.max(0, P.iframe - dt);
    P.stun = Math.max(0, P.stun - dt);
    P.stDelay = Math.max(0, P.stDelay - dt);
    if (!P.act && P.stDelay <= 0) P.st = Math.min(s.stMax, P.st + 0.06 * dt);
    if (input.light) startAct('light');
    if (input.heavy) startAct('heavy');
    if (input.roll) startAct('roll');
    if (input.heal) startAct('heal');
    if (input.use && !P.act) interact();
    input.light = input.heavy = input.roll = input.heal = input.use = false;
    if (mode !== 'play') return;
    const m = Math.hypot(input.x, input.y);
    if (P.act) {
      P.actT += dt;
      const a = ACTS[P.act];
      if (P.act === 'roll') {
        const sp = P.actT < 300 ? 0.16 : 0.05;
        moveBody(P, P.face.x * sp * dt, P.face.y * sp * dt);
        if (P.actT > 50 && P.actT < 310) P.iframe = Math.max(P.iframe, 1);
      } else if (P.act === 'heal') {
        if (m > 0.2) moveBody(P, (input.x / m) * 0.025 * dt, (input.y / m) * 0.025 * dt);
        if (P.actT >= 520 && !P.healed) { P.healed = true; P.estus--; P.hp = Math.min(s.hpMax, P.hp + 55); fx.push({ kind: 'heal', x: P.x, y: P.y, t: 0 }); }
      } else {
        if (P.actT < a.a0) moveBody(P, P.face.x * 0.02 * dt, P.face.y * 0.02 * dt); // 한 발 내딛기
        if (P.actT >= a.a0 && P.actT <= a.a1) swingHits(a.range, a.arc, P.act === 'heavy' ? s.heavy : s.light, P.act === 'heavy' ? 2 : 1);
      }
      if (P.actT >= a.dur) { P.act = null; P.healed = false; }
    } else if (P.stun <= 0 && m > 0.15) {
      const k = Math.min(1, m);
      P.face = { x: input.x / m, y: input.y / m };
      moveBody(P, (input.x / m) * 0.07 * k * dt, (input.y / m) * 0.07 * k * dt);
      P.walk += dt;
    }
    // 핏자국(소울) 되찾기
    if (save.stain && Math.hypot(P.x - save.stain.x, P.y - save.stain.y) < 12) {
      save.souls += save.stain.souls;
      toast(`소울 ${save.stain.souls}을 되찾았어요.`);
      save.stain = null;
      writeSave(save);
    }
  }

  // ---------- 적 AI ----------
  function updateEnemy(e, dt) {
    e.flash = Math.max(0, e.flash - dt);
    if (e.dead) { e.timer -= dt; return; }
    const dx = P.x - e.x, dy = P.y - e.y, d = Math.hypot(dx, dy);
    e.timer -= dt;
    if (e.state === 'stagger') { if (e.timer <= 0) e.state = 'chase'; return; }
    const home = Math.hypot(e.hx - e.x, e.hy - e.y);
    if (e.state === 'idle') {
      if (d < e.aggro && lineOfSight(e, P)) e.state = 'chase';
      return;
    }
    if (e.state === 'return') {
      moveBody(e, ((e.hx - e.x) / (home || 1)) * e.speed * dt, ((e.hy - e.y) / (home || 1)) * e.speed * dt);
      e.walk += dt;
      if (home < 4) { e.state = 'idle'; e.hp = e.hpMax; }
      return;
    }
    if (e.state === 'chase') {
      if (home > 240 || d > 220) { e.state = 'return'; return; }
      if (e.type === 'archer') {
        if (d < 60) { moveBody(e, (-dx / d) * e.speed * dt, (-dy / d) * e.speed * dt); e.walk += dt; }
        else if (d > 110) { moveBody(e, (dx / d) * e.speed * dt, (dy / d) * e.speed * dt); e.walk += dt; }
        if (d < 150 && e.timer <= 0 && lineOfSight(e, P)) { e.state = 'windup'; e.timer = e.windup; e.dir = { x: dx / d, y: dy / d }; }
        return;
      }
      if (d > e.range) { moveBody(e, (dx / d) * e.speed * dt, (dy / d) * e.speed * dt); e.walk += dt; }
      if (d <= e.range + 4 && e.timer <= 0) {
        e.state = 'windup';
        e.timer = e.windup;
        e.dir = { x: dx / (d || 1), y: dy / (d || 1) };
        e.lunge = e.type === 'knight' && Math.random() < 0.35;
      }
      return;
    }
    if (e.state === 'windup') {
      if (e.timer <= 0) {
        e.state = 'active';
        e.timer = e.active;
        e.didHit = false;
        if (e.type === 'archer') {
          const dd = Math.hypot(P.x - e.x, P.y - e.y) || 1;
          shots.push({ kind: 'arrow', x: e.x, y: e.y - 4, vx: ((P.x - e.x) / dd) * 0.17, vy: ((P.y - e.y) / dd) * 0.17, dmg: e.dmg, life: 1600 });
        }
      }
      return;
    }
    if (e.state === 'active') {
      if (e.lunge) moveBody(e, e.dir.x * 0.13 * dt, e.dir.y * 0.13 * dt);
      if (e.type !== 'archer' && !e.didHit) {
        const ax = e.x + e.dir.x * 10, ay = e.y + e.dir.y * 10;
        if (Math.hypot(P.x - ax, P.y - ay) < (e.type === 'knight' ? 18 : 14)) { e.didHit = true; hurtPlayer(e.dmg, e); }
      }
      if (e.timer <= 0) { e.state = 'recover'; e.timer = e.recover; }
      return;
    }
    if (e.state === 'recover' && e.timer <= 0) { e.state = 'chase'; e.timer = 200 + Math.random() * 500; }
  }

  // ---------- 보스 ----------
  function updateBoss(dt) {
    const b = boss;
    if (!b || !inArena) return;
    b.flash = Math.max(0, b.flash - dt);
    b.timer -= dt;
    const dx = P.x - b.x, dy = P.y - b.y, d = Math.hypot(dx, dy) || 1;
    if (b.hp <= b.hpMax / 2 && b.phase === 1) { b.phase = 2; b.state = 'roar'; b.timer = 1300; banner = { s: 'THE CRYSTAL AWAKENS', t: 0, c: '#ff70d0' }; }
    const fast = b.phase === 2 ? 0.75 : 1;
    switch (b.state) {
      case 'intro': case 'roar': if (b.timer <= 0) { b.state = 'chase'; b.timer = 600; } break;
      case 'stagger': if (b.timer <= 0) { b.state = 'chase'; b.timer = 300; } break;
      case 'chase': {
        if (d > 30) moveBody(b, (dx / d) * 0.04 * dt, (dy / d) * 0.04 * dt, 9);
        b.dir = { x: dx / d, y: dy / d };
        if (b.timer <= 0) {
          const r = Math.random();
          let pick;
          if (d < 40) pick = r < 0.5 ? 'sweep' : 'slam';
          else if (d > 90) pick = b.phase === 2 && r < 0.5 ? 'shards' : 'charge';
          else pick = r < 0.35 ? 'charge' : r < 0.6 ? 'slam' : b.phase === 2 ? 'rain' : 'sweep';
          b.state = `w_${pick}`;
          b.timer = { sweep: 650, slam: 900, charge: 700, shards: 800, rain: 700 }[pick] * fast;
          b.target = { x: P.x, y: P.y };
          if (pick === 'rain') for (let i = 0; i < 5; i++) fx.push({ kind: 'mark', x: P.x + (Math.random() - 0.5) * 90, y: P.y + (Math.random() - 0.5) * 70, t: 0, dur: 1000 * fast, r: 14 });
        }
        break;
      }
      case 'w_sweep': if (b.timer <= 0) { b.state = 'sweep'; b.timer = 220; b.didHit = false; } break;
      case 'sweep':
        if (!b.didHit && d < 44 && (dx * b.dir.x + dy * b.dir.y) / d > -0.2) { b.didHit = true; hurtPlayer(32, b); }
        if (b.timer <= 0) { b.state = 'recover'; b.timer = 600 * fast; }
        break;
      case 'w_slam': if (b.timer <= 0) { b.state = 'slam'; b.timer = 200; b.didHit = false; fx.push({ kind: 'ring', x: b.x, y: b.y + 6, t: 0, r: 46 }); } break;
      case 'slam':
        if (!b.didHit && d < 46) { b.didHit = true; hurtPlayer(42, b); }
        if (b.timer <= 0) { b.state = 'recover'; b.timer = 800 * fast; }
        break;
      case 'w_charge':
        b.dir = { x: (b.target.x - b.x) / (Math.hypot(b.target.x - b.x, b.target.y - b.y) || 1), y: (b.target.y - b.y) / (Math.hypot(b.target.x - b.x, b.target.y - b.y) || 1) };
        if (b.timer <= 0) { b.state = 'charge'; b.timer = 520; b.didHit = false; }
        break;
      case 'charge':
        moveBody(b, b.dir.x * 0.24 * dt, b.dir.y * 0.24 * dt, 9);
        if (!b.didHit && d < 20) { b.didHit = true; hurtPlayer(36, b); }
        if (b.timer <= 0) { b.state = 'recover'; b.timer = 700 * fast; }
        break;
      case 'w_shards':
        if (b.timer <= 0) {
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 + Math.random() * 0.2;
            shots.push({ kind: 'shard', x: b.x, y: b.y, vx: Math.cos(a) * 0.12, vy: Math.sin(a) * 0.12, dmg: 22, life: 2200 });
          }
          b.state = 'recover';
          b.timer = 900 * fast;
        }
        break;
      case 'w_rain': if (b.timer <= 0) { b.state = 'recover'; b.timer = 700; } break;
      case 'recover': if (b.timer <= 0) { b.state = 'chase'; b.timer = (b.phase === 2 ? 350 : 650) + Math.random() * 400; } break;
      default: break;
    }
  }

  function bossDown() {
    const b = boss;
    b.hp = 0;
    save.souls += 3000;
    save.boss = true;
    const first = !save.cleared;
    save.cleared = true;
    writeSave(save);
    boss = null;
    inArena = false;
    shots = [];
    banner = { s: 'VICTORY ACHIEVED', t: 0, c: '#ffd860' };
    fx.push({ kind: 'burst', x: b.x, y: b.y, t: 0 });
    toast('타락한 수호자를 쓰러뜨렸어요! 소울 3000');
    if (first) onClear?.({ ms: save.playMs, deaths: save.deaths, lvl: save.lvl });
  }

  function updateShots(dt) {
    for (const s of shots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (solidTile(tileAt(s.x, s.y))) s.life = 0;
      if (s.life > 0 && Math.hypot(P.x - s.x, P.y - 4 - s.y) < 7) { s.life = 0; hurtPlayer(s.dmg, s); }
    }
    shots = shots.filter((s) => s.life > 0);
    for (const f of fx) {
      f.t += dt;
      if (f.kind === 'mark' && !f.done && f.t >= f.dur) {
        f.done = true;
        if (Math.hypot(P.x - f.x, P.y - f.y) < f.r + 4) hurtPlayer(30, f);
      }
    }
    fx = fx.filter((f) => f.t < (f.kind === 'mark' ? f.dur + 200 : f.kind === 'burst' ? 1500 : 500));
  }

  // ---------- 그리기 ----------
  // 도트 원 / 테두리 있는 막대 (부드러운 선 대신)
  function pcircle(cx, cy, r, col, size) {
    ctx.fillStyle = col;
    const n = Math.max(8, Math.round(r * 1.2));
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), size, size); }
  }
  function pline(x, y, ang, from, to, col, tip) {
    ctx.fillStyle = PAL[0];
    for (let i = from; i < to; i++) ctx.fillRect(Math.round(x + Math.cos(ang) * i) - 1, Math.round(y + Math.sin(ang) * i) - 1, 3, 3);
    for (let i = from; i < to; i++) { ctx.fillStyle = i >= to - 2 && tip ? tip : col; ctx.fillRect(Math.round(x + Math.cos(ang) * i), Math.round(y + Math.sin(ang) * i), 1, 1); }
  }

  function shadow(x, y) {
    x = Math.round(x); y = Math.round(y);
    ctx.fillStyle = PAL[0]; ctx.globalAlpha = 0.5;
    ctx.fillRect(x - 4, y + 1, 9, 1); ctx.fillRect(x - 6, y + 2, 13, 1); ctx.fillRect(x - 4, y + 3, 9, 1);
    ctx.globalAlpha = 1;
  }
  function drawFlip(img, x, y, flip, w = 16) {
    ctx.save();
    ctx.translate(Math.round(x) + (flip ? w : 0), Math.round(y));
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  function drawBoss(b, ox, oy, t) {
    const x = Math.round(b.x - ox), y = Math.round(b.y - oy);
    const tele = b.state.startsWith('w_');
    const shake = tele || b.state === 'roar' ? (Math.floor(t / 40) % 2) : 0;
    const flip = (b.dir?.x ?? -1) < 0;
    const X = x - 16 + shake, Y = y - 36;
    ctx.fillStyle = PAL[0]; ctx.globalAlpha = 0.45; ctx.fillRect(x - 13, y + 1, 26, 3); ctx.fillRect(x - 10, y, 20, 5); ctx.globalAlpha = 1;
    // 크리스탈 대검: 공격 준비 땐 머리 위로, 평소엔 비스듬히 아래로
    const hx = X + (flip ? 3 : 29), hy = Y + 20;
    const ang = tele ? -Math.PI / 2 + (flip ? -0.5 : 0.5) : b.state === 'sweep' || b.state === 'slam' || b.state === 'charge' ? Math.atan2(b.dir?.y ?? 0, b.dir?.x ?? 1) : Math.PI / 2 + (flip ? 0.6 : -0.6);
    const glow = b.phase === 2 ? '#ff70d0' : PAL.h;
    for (let i = 0; i < 26; i++) {
      const sx = Math.round(hx + Math.cos(ang) * i), sy = Math.round(hy + Math.sin(ang) * i);
      ctx.fillStyle = PAL[0]; ctx.fillRect(sx - 1, sy - 1, 3, 3);
    }
    for (let i = 0; i < 26; i++) {
      const sx = Math.round(hx + Math.cos(ang) * i), sy = Math.round(hy + Math.sin(ang) * i);
      ctx.fillStyle = i < 4 ? PAL.a : i % 5 === 2 ? PAL[7] : glow; ctx.fillRect(sx, sy, 1, 1);
    }
    drawFlip(b.flash ? spr.bossW : b.phase === 2 ? spr.boss2 : spr.boss, X, Y, flip, 32);
    if (tele && Math.floor(t / 70) % 2) { ctx.fillStyle = PAL[7]; ctx.fillRect(X + 15, Y + 16, 2, 2); }
  }

  function draw(t) {
    const camX = Math.max(0, Math.min(MW * T - VW, P.x - VW / 2));
    const camY = Math.max(0, Math.min(MH * T - VH, P.y - VH / 2));
    const ox = Math.round(camX), oy = Math.round(camY);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VW, VH);
    const c0 = Math.floor(ox / T), r0 = Math.floor(oy / T);
    for (let r = r0; r <= r0 + Math.ceil(VH / T); r++) for (let c = c0; c <= c0 + Math.ceil(VW / T); c++) {
      if (r < 0 || r >= MH || c < 0 || c >= MW) continue;
      G.drawTile(ctx, gfx, map, MW, MH, map[r][c], c, r, c * T - ox, r * T - oy, save, t);
    }
    const onScreen = (x, y, m = 24) => x > ox - m && x < ox + VW + m && y > oy - m && y < oy + VH + m;
    for (const p of gfx.props) if (onScreen(p.x, p.y)) ctx.drawImage(gfx.propImg[p.kind], p.x - ox, p.y - oy);
    for (const tr of gfx.torches) if (onScreen(tr.x, tr.y)) G.drawTorch(ctx, tr.x - ox, tr.y - oy, t, tr.c);
    // 바닥 표시들
    if (save.stain) {
      const x = Math.round(save.stain.x - ox), y = Math.round(save.stain.y - oy);
      ctx.fillStyle = PAL.b; ctx.fillRect(x - 5, y - 1, 10, 3); ctx.fillRect(x - 2, y - 3, 4, 7); ctx.fillStyle = PAL.c; ctx.fillRect(x - 3, y, 3, 1); ctx.fillRect(x - 1, y - 2, 2, 2);
      ctx.fillStyle = Math.floor(t / 150) % 2 ? '#50ffb4' : '#2a9a6a'; ctx.fillRect(x - 1, y - 8 - Math.floor((t / 120) % 6), 2, 2); ctx.fillRect(x, y - 12 - Math.floor((t / 90) % 5), 1, 1);
    }
    for (const f of fx) {
      if (f.kind === 'mark') {
        const k = Math.min(1, f.t / f.dur);
        pcircle(f.x - ox, f.y - oy, f.r * (f.done ? 1 : k), f.done ? PAL[7] : Math.floor(t / 100) % 2 ? '#ff70d0' : PAL.i, 1);
        if (f.done) { ctx.fillStyle = PAL[0]; ctx.fillRect(Math.round(f.x - ox) - 3, Math.round(f.y - oy) - 11, 6, 12); ctx.fillStyle = '#ff70d0'; ctx.fillRect(Math.round(f.x - ox) - 2, Math.round(f.y - oy) - 10, 4, 10); ctx.fillStyle = PAL[7]; ctx.fillRect(Math.round(f.x - ox) - 1, Math.round(f.y - oy) - 10, 1, 8); }
      }
      if (f.kind === 'ring' && f.t < 400) pcircle(f.x - ox, f.y - oy, f.r * (0.3 + f.t / 500), f.t < 200 ? PAL[7] : PAL.i, 2);
    }
    for (const b of BONFIRES) if (onScreen(b.x, b.y)) G.drawBonfire(ctx, Math.round(b.x - ox), Math.round(b.y - oy), save.lit.includes(b.id), t);
    for (const c of CHESTS) if (!save.chests.includes(c.id)) G.drawChest(ctx, Math.round(c.x - ox), Math.round(c.y - oy));
    // 사람들 (아래쪽이 앞에 오게)
    const bodies = [...enemies.map((e) => ({ e, y: e.y })), { e: P, y: P.y }, ...(boss && (inArena || save.lit.length) ? [{ e: boss, y: boss.y }] : [])].sort((a, b) => a.y - b.y);
    for (const { e } of bodies) {
      if (e === P) { drawPlayer(ox, oy, t); continue; }
      if (e === boss) { drawBoss(e, ox, oy, t); continue; }
      if (e.dead) { if (e.timer > 0) { ctx.globalAlpha = e.timer / 600; drawEnemy(e, ox, oy, t); ctx.globalAlpha = 1; } continue; }
      drawEnemy(e, ox, oy, t);
    }
    for (const s of shots) {
      const x = Math.round(s.x - ox), y = Math.round(s.y - oy);
      const ang = Math.atan2(s.vy, s.vx);
      if (s.kind === 'arrow') { pline(x, y, ang, -7, 0, PAL.a, PAL[6]); ctx.fillStyle = PAL.k; ctx.fillRect(Math.round(x - Math.cos(ang) * 7), Math.round(y - Math.sin(ang) * 7), 1, 1); }
      else { ctx.fillStyle = PAL[0]; ctx.fillRect(x - 3, y - 3, 6, 6); ctx.fillStyle = '#ff70d0'; ctx.fillRect(x - 2, y - 2, 4, 4); ctx.fillStyle = PAL[7]; ctx.fillRect(x - 1, y - 2, 1, 2); }
    }
    for (const f of fx) {
      if (f.kind === 'spark') { ctx.fillStyle = f.c; const k = f.t / 6; for (const [a, b2] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7]]) ctx.fillRect(Math.round(f.x - ox + a * k), Math.round(f.y - oy + b2 * k), 2, 2); }
      if (f.kind === 'heal') { ctx.fillStyle = f.t < 250 ? PAL.e : PAL.d; for (let i = 0; i < 6; i++) ctx.fillRect(Math.round(f.x - ox - 8 + i * 3), Math.round(f.y - oy - 4 - (f.t / 20) - (i % 3) * 3), 2, 2); }
      if (f.kind === 'burst') { ctx.fillStyle = f.t < 500 ? PAL[7] : f.t < 1000 ? '#ff70d0' : PAL.j; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ctx.fillRect(Math.round(f.x - ox + Math.cos(a) * f.t / 15), Math.round(f.y - oy + Math.sin(a) * f.t / 15), 3, 3); } }
    }
    // 어둠: 플레이어·화톳불·횃불·촛불 주변만 단계별로 밝게
    const fl = (k) => Math.sin(t / 90 + k) * 2 + Math.sin(t / 37 + k * 3);
    const lights = [{ x: P.x - ox, y: P.y - oy - 6, r: inArena ? 175 : 110 }];
    for (const b of BONFIRES) if (save.lit.includes(b.id)) lights.push({ x: b.x - ox, y: b.y - oy - 4, r: 88 + fl(1) });
    for (const tr of gfx.torches) if (onScreen(tr.x, tr.y, 80)) lights.push({ x: tr.x - ox, y: tr.y - oy, r: 64 + fl(tr.c) });
    for (const p of gfx.props) if (p.kind === 'candles' && onScreen(p.x, p.y, 40)) lights.push({ x: p.x - ox + 4, y: p.y - oy, r: 34 + fl(p.x) });
    if (boss && inArena) lights.push({ x: boss.x - ox, y: boss.y - oy - 16, r: 70 });
    darkness.draw(ctx, lights);
    drawHud(t);
  }

  function drawPlayer(ox, oy, t) {
    const x = P.x - ox - 8, y = P.y - oy - 17;
    const flip = P.face.x < -0.1;
    shadow(P.x - ox, P.y - oy);
    if (P.iframe > 0 && P.act !== 'roll' && Math.floor(t / 60) % 2) return;
    if (P.act === 'roll') { drawFlip(spr.pR, x, y, flip); return; }
    const img = spr.p[Math.floor(P.walk / 120) % 4];
    drawFlip(img, x, y, flip);
    // 칼 휘두르기
    if (P.act === 'light' || P.act === 'heavy') {
      const a = ACTS[P.act];
      const base = Math.atan2(P.face.y, P.face.x);
      const k = Math.min(1, Math.max(0, (P.actT - a.a0 + 60) / (a.a1 - a.a0 + 60)));
      const swing = base - a.arc + k * a.arc * 2;
      const len = a.range - 2;
      const cx = P.x - ox, cy = P.y - oy - 6;
      if (P.actT >= a.a0 && P.actT <= a.a1) {
        // 휘두른 자리: 두 줄 도트 궤적
        for (let s2 = -a.arc; s2 <= swing - base; s2 += 0.12) {
          ctx.fillStyle = PAL[6]; ctx.fillRect(Math.round(cx + Math.cos(base + s2) * len), Math.round(cy + Math.sin(base + s2) * len), 1, 1);
          ctx.fillStyle = PAL[5]; ctx.fillRect(Math.round(cx + Math.cos(base + s2) * (len - 3)), Math.round(cy + Math.sin(base + s2) * (len - 3)), 1, 1);
        }
      }
      pline(cx, cy, swing, 4, 7, PAL.a);
      pline(cx, cy, swing, 7, len, P.act === 'heavy' ? PAL.e : PAL[6], PAL[7]);
    } else if (P.act === 'heal') {
      const hx = Math.round(P.x - ox) + (flip ? -8 : 4), hy = Math.round(P.y - oy) - 15;
      ctx.fillStyle = PAL[0]; ctx.fillRect(hx - 1, hy - 1, 6, 9);
      ctx.fillStyle = PAL.d; ctx.fillRect(hx, hy + 2, 4, 5); ctx.fillStyle = PAL.e; ctx.fillRect(hx + 1, hy + 2, 1, 4); ctx.fillStyle = PAL[7]; ctx.fillRect(hx + 1, hy, 2, 2);
    } else {
      // 들고 있는 칼
      const sx = Math.round(P.x - ox) + (flip ? -7 : 6), sy = Math.round(P.y - oy) - 6;
      pline(sx, sy, -Math.PI / 2 + (flip ? -0.25 : 0.25), 0, 3, PAL.a);
      pline(sx, sy, -Math.PI / 2 + (flip ? -0.25 : 0.25), 3, 13, PAL[6], PAL[7]);
      ctx.fillStyle = PAL[0]; ctx.fillRect(sx - 2, sy - 4, 5, 3); ctx.fillStyle = PAL[5]; ctx.fillRect(sx - 1, sy - 3, 3, 1);
    }
  }

  function drawEnemy(e, ox, oy, t) {
    const x = e.x - ox - 8, y = e.y - oy - 17;
    const flip = (e.state === 'windup' || e.state === 'active' ? e.dir.x : P.x - e.x) < 0;
    const step = Math.floor(e.walk / 160) % 2;
    const set = e.type === 'knight' ? spr.knight : e.type === 'archer' ? spr.archer : spr.hollow;
    const img = e.flash > 0 ? set[2] : set[step];
    shadow(e.x - ox, e.y - oy);
    drawFlip(img, x, y, flip);
    // 공격 예고: 무기를 들어 올리고 빛남
    const wx = Math.round(e.x - ox + (flip ? -7 : 6)), wy = Math.round(e.y - oy) - 6;
    if (e.type === 'archer') {
      // 활: 몸 앞의 굽은 도트 + 시위
      const d = flip ? -1 : 1;
      ctx.fillStyle = PAL[0]; ctx.fillRect(wx - 1, wy - 8, 4, 15);
      ctx.fillStyle = PAL.a; for (let i = -6; i <= 6; i++) ctx.fillRect(wx + (Math.abs(i) < 4 ? d : 0), wy + i, 1, 1);
      ctx.fillStyle = PAL.k; ctx.fillRect(wx - (e.state === 'windup' ? 2 * d : 0), wy - 5, 1, 11);
      if (e.state === 'windup' && Math.floor(t / 80) % 2) { ctx.fillStyle = PAL.e; ctx.fillRect(wx + 2 * d, wy, 1, 1); }
    } else {
      const ang = e.state === 'windup' ? -Math.PI / 2 - (flip ? -0.9 : 0.9) : e.state === 'active' ? Math.atan2(e.dir.y, e.dir.x) : -Math.PI / 2 + (flip ? -0.3 : 0.3);
      const len = e.type === 'knight' ? 15 : 10;
      pline(wx, wy, ang, 0, 3, PAL[9]);
      pline(wx, wy, ang, 3, len, e.type === 'knight' ? PAL[5] : PAL.l, e.state === 'windup' && Math.floor(t / 80) % 2 ? PAL.c : null);
      if (e.state === 'active') {
        const base = Math.atan2(e.dir.y, e.dir.x);
        ctx.fillStyle = PAL[6];
        for (let s2 = -1; s2 <= 1; s2 += 0.14) ctx.fillRect(Math.round(wx + Math.cos(base + s2) * len), Math.round(wy + Math.sin(base + s2) * len), 1, 1);
      }
    }
    // 다친 적은 머리 위 체력
    if (e.hp < e.hpMax && !e.dead) {
      const hx = Math.round(e.x - ox) - 8, hy = Math.round(e.y - oy) - 22;
      ctx.fillStyle = PAL[0]; ctx.fillRect(hx - 1, hy - 1, 18, 4);
      ctx.fillStyle = PAL.b; ctx.fillRect(hx, hy, 16, 2);
      ctx.fillStyle = PAL.c; ctx.fillRect(hx, hy, Math.round((16 * e.hp) / e.hpMax), 2);
    }
  }

  function drawHud(t) {
    const s = stats();
    // 깎인 체력은 노란 자국으로 잠깐 남았다가 따라 내려감
    if (P.hp >= hud.hpLag) { hud.hpLag = P.hp; hud.lagT = t; } else if (t - hud.lagT > 600) hud.hpLag = Math.max(P.hp, hud.hpLag - 1.5);
    G.bar(ctx, 8, 8, Math.round(s.hpMax * 0.9), 4, P.hp, s.hpMax, PAL.c, '#e05a48', hud.hpLag);
    G.bar(ctx, 8, 17, Math.round(s.stMax * 0.9), 3, Math.max(0, P.st), s.stMax, '#4e8a3a', '#7cc060');
    G.itemSlot(ctx, 8, VH - 28, P.estus);
    G.soulBox(ctx, VW - 8, VH - 18, save.souls);
    if (boss && inArena) {
      text(ctx, 'CORRUPTED WARDEN', 44, VH - 26, PAL[7]);
      G.bar(ctx, 44, VH - 16, VW - 96, 4, boss.hp, boss.hpMax, boss.phase === 2 ? '#c03a90' : '#8a2020', boss.phase === 2 ? '#ff70d0' : PAL.c);
    }
    const n = mode === 'play' ? nearby() : null;
    if (n) {
      const label = `F ${n.kind === 'bonfire' ? 'REST' : n.kind === 'chest' ? 'OPEN' : n.kind === 'fog' ? 'ENTER' : 'OPEN DOOR'}`;
      G.frame(ctx, Math.round(VW / 2 - textWidth(label) / 2) - 4, VH - 46, textWidth(label) + 8, 11);
      center(ctx, label, VH - 44, VW, PAL[7], null);
    }
    if (banner) {
      banner.t += 16;
      const a = banner.t < 300 ? banner.t / 300 : banner.t > 2200 ? Math.max(0, 1 - (banner.t - 2200) / 600) : 1;
      ctx.globalAlpha = a;
      ctx.fillStyle = PAL[0]; ctx.fillRect(0, VH / 2 - 14, VW, 24);
      ctx.fillStyle = PAL[2]; ctx.fillRect(0, VH / 2 - 14, VW, 1); ctx.fillRect(0, VH / 2 + 9, VW, 1);
      center(ctx, banner.s, VH / 2 - 7, VW, banner.c, null);
      ctx.globalAlpha = 1;
      if (banner.t > 2800) banner = null;
    }
    if (mode === 'dead') {
      const a = Math.min(1, deadT / 900);
      ctx.fillStyle = `rgba(0,0,0,${a * 0.6})`; ctx.fillRect(0, 0, VW, VH);
      ctx.globalAlpha = a;
      ctx.fillStyle = PAL[0]; ctx.fillRect(0, VH / 2 - 16, VW, 28);
      G.bigText(ctx, 'YOU DIED', VW / 2, VH / 2 - 11, PAL.c, 2, PAL[0]);
      ctx.globalAlpha = 1;
    }
  }
  const textWidth = (s2) => s2.length * 6 - 1;

  // ---------- 입력 ----------
  const keys = new Set();
  const updateAxis = () => {
    input.x = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    input.y = (keys.has('down') ? 1 : 0) - (keys.has('up') ? 1 : 0);
  };
  const KEYMAP = {
    ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down',
    j: 'light', J: 'light', k: 'heavy', K: 'heavy', ' ': 'roll', Shift: 'roll', e: 'heal', E: 'heal', r: 'heal', R: 'heal', f: 'use', F: 'use',
  };
  const onKey = (down) => (ev) => {
    if (!area.isConnected || area.closest('.hidden')) return;
    const k = KEYMAP[ev.key];
    if (!k) return;
    if (ev.target.closest?.('input,textarea')) return;
    ev.preventDefault();
    if (['left', 'right', 'up', 'down'].includes(k)) { down ? keys.add(k) : keys.delete(k); updateAxis(); return; }
    if (down && !ev.repeat && mode === 'play') input[k] = true;
  };
  const kd = onKey(true), ku = onKey(false);
  document.addEventListener('keydown', kd);
  document.addEventListener('keyup', ku);
  cv.addEventListener('pointerdown', (ev) => { if (ev.pointerType === 'mouse' && mode === 'play') input.light = true; });
  cv.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (mode === 'play') input.heavy = true; });
  // 폰: 왼쪽 조이스틱 + 오른쪽 버튼
  const stick = $('#sl-stick'), knob = $('#sl-knob');
  let stickId = null;
  const stickMove = (ev) => {
    const r = stick.getBoundingClientRect();
    let dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
    const max = r.width / 2 - 10, m = Math.hypot(dx, dy);
    if (m > max) { dx = (dx / m) * max; dy = (dy / m) * max; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.x = dx / max; input.y = dy / max;
  };
  stick.addEventListener('pointerdown', (ev) => { ev.preventDefault(); stickId = ev.pointerId; stick.setPointerCapture(ev.pointerId); stickMove(ev); });
  stick.addEventListener('pointermove', (ev) => { if (ev.pointerId === stickId) stickMove(ev); });
  const stickEnd = (ev) => { if (ev.pointerId !== stickId) return; stickId = null; knob.style.transform = ''; input.x = 0; input.y = 0; };
  stick.addEventListener('pointerup', stickEnd);
  stick.addEventListener('pointercancel', stickEnd);
  area.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); if (mode === 'play') input[b.dataset.b] = true; }));

  // ---------- 진행 ----------
  let lastSave = 0;
  const stop = loop((dt) => {
    const t = performance.now();
    if (mode === 'play' && !paused) {
      save.playMs += dt;
      updatePlayer(dt);
      for (const e of enemies) updateEnemy(e, dt);
      updateBoss(dt);
      updateShots(dt);
      if (t - lastSave > 10000) { lastSave = t; writeSave(save); }
    } else if (mode === 'dead') {
      deadT += dt;
      if (deadT > 2600) { respawn(); mode = 'play'; }
    }
    if (mode !== 'title') draw(t);
    else title.draw(ctx, t);
  });
  titleScreen();
  // 테스트용 (주소에 ?debug 가 있을 때만)
  if (location.search.includes('debug')) window.__souls = { P, get boss() { return boss; }, get inArena() { return inArena; }, get mode() { return mode; }, save: () => save };

  const onHide = () => { if (document.visibilityState === 'hidden' && mode !== 'title') writeSave(save); };
  document.addEventListener('visibilitychange', onHide);
  return () => {
    if (mode !== 'title') writeSave(save);
    stop();
    document.removeEventListener('keydown', kd);
    document.removeEventListener('keyup', ku);
    document.removeEventListener('visibilitychange', onHide);
  };
}
