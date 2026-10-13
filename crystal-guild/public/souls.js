// 크리스탈 소울: 다크 소울 느낌의 픽셀 액션 RPG.
// 체력·스태미나, 약공/강공, 구르기(무적 시간), 에스트 병, 화톳불(휴식·레벨 업·적 부활),
// 죽으면 그 자리에 소울을 떨어뜨림(다시 죽으면 잃음), 지름길 문, 안개 문 너머 2페이즈 보스.
// 진행은 이 기기(localStorage)에 저장되고, 보스를 쓰러뜨리면 기록이 순위에 올라간다.
import { makeScreen, text, center, loop, sprite } from './arcade.js';

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

// ---------- 그림 ----------
const KNIGHT_A = [
  '.....KK.KK......', '....KWPKWPK.....', '....KWPKWPK.....', '....KLLLLLK.....', '...KLAAAAALK....', '...KADDCDDAK....',
  '...KAAAAAAAK....', '..KRKLAAALKRK...', '..KRALAAALARK...', '..KRAAACAAARK...', '..KRKAAAAAKRK...', '...KKDAAADKK....',
  '....KAD.DAK.....', '....KAK.KAK.....', '...KDDK.KDDK....', '...KKK...KKK....',
];
const KNIGHT_B = [...KNIGHT_A.slice(0, 12), '....KAD.DAK.....', '...KAK...KAK....', '..KDDK...KDDK...', '..KKK.....KKK...'];
const KNIGHT_ROLL = [
  '................', '................', '................', '................', '.....KKKKKK.....', '....KLAAAAAK....',
  '...KAAAACAAAK...', '..KRAAAAAAAARK..', '..KRAADDDDAARK..', '..KRAAAAAAAARK..', '...KRAAAAAARK...', '....KKKKKKKK....',
  '................', '................', '................', '................',
];
const PLAYER_PAL = { K: '#120e18', W: '#f4f0fa', P: '#ffb0c8', L: '#c8ccd8', A: '#8a8fa0', D: '#50546a', C: '#7cc8ff', R: '#6a2a4a' };
const DARK_KNIGHT_PAL = { K: '#08060a', W: '#2a2a36', P: '#2a2a36', L: '#4a4a5c', A: '#30303e', D: '#18181e', C: '#ff3030', R: '#401010' };
const HOLLOW = [
  '......KKKK......', '.....KGGGGK.....', '.....KGEGEK.....', '.....KGGGGK.....', '......KGGK......', '....KKBBBBKK....',
  '...KGKBBBBKGK...', '...KGKBBBBKGK...', '....KKBBBBKK....', '.....KBBBBK.....', '.....KGKKGK.....', '.....KGK.KGK....',
  '....KGK...KGK...', '....KK.....KK...', '................', '................',
];
const HOLLOW_B = [...HOLLOW.slice(0, 10), '.....KGKKGK.....', '....KGK..KGK....', '...KGK....KGK...', '...KK......KK...', '................', '................'];
const HOLLOW_PAL = { K: '#0a0808', G: '#8a8478', E: '#c02020', B: '#5a4630' };
const ARCHER_PAL = { K: '#0a0808', G: '#7a7468', E: '#e0c040', B: '#2f4a2a' };

// 화면 그리기용
function hash(x, y) { return ((x * 73856093) ^ (y * 19349663)) >>> 0; }

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
    pA: sprite(KNIGHT_A, PLAYER_PAL), pB: sprite(KNIGHT_B, PLAYER_PAL), pR: sprite(KNIGHT_ROLL, PLAYER_PAL),
    kA: sprite(KNIGHT_A, DARK_KNIGHT_PAL), kB: sprite(KNIGHT_B, DARK_KNIGHT_PAL),
    hA: sprite(HOLLOW, HOLLOW_PAL), hB: sprite(HOLLOW_B, HOLLOW_PAL), aA: sprite(HOLLOW, ARCHER_PAL), aB: sprite(HOLLOW_B, ARCHER_PAL),
  };
  const map = buildMap();
  const dark = document.createElement('canvas');
  dark.width = VW; dark.height = VH;
  const dctx = dark.getContext('2d');

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
    ui.innerHTML = `<div class="sl-panel title"><h2>CRYSTAL SOULS</h2><p>잿더미가 된 크리스탈 성채. 타락한 수호자를 쓰러뜨리세요.</p>
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
  function drawTile(ch, c, r, sx, sy) {
    const h = hash(c, r);
    if (ch === '#') {
      const below = r + 1 < MH ? map[r + 1][c] : '#';
      if (below !== '#') { // 벽 앞면 (벽돌)
        ctx.fillStyle = '#2c2a36';
        ctx.fillRect(sx, sy, T, T);
        ctx.fillStyle = '#383645';
        const off = (r % 2) * 8;
        for (let y = 0; y < T; y += 5) for (let x = -off; x < T; x += 8) ctx.fillRect(sx + Math.max(0, x), sy + y, Math.min(7, T - Math.max(0, x)), 4);
        ctx.fillStyle = '#1a1922';
        ctx.fillRect(sx, sy + T - 2, T, 2);
      } else {
        ctx.fillStyle = '#121118';
        ctx.fillRect(sx, sy, T, T);
        if (h % 7 === 0) { ctx.fillStyle = '#18171f'; ctx.fillRect(sx + (h % 9), sy + (h % 11), 3, 2); }
      }
      return;
    }
    if (ch === ',') {
      ctx.fillStyle = (h & 1) ? '#3d3b38' : '#403e3a';
      ctx.fillRect(sx, sy, T, T);
      ctx.fillStyle = '#4b4a40';
      if (h % 3 === 0) ctx.fillRect(sx + (h % 12), sy + ((h >> 3) % 12), 2, 3);
      ctx.fillStyle = '#2e2c2a';
      if (h % 5 === 0) ctx.fillRect(sx + ((h >> 2) % 13), sy + ((h >> 5) % 13), 3, 1);
      return;
    }
    // 돌바닥
    ctx.fillStyle = (h % 4 === 0) ? '#34333d' : '#393842';
    ctx.fillRect(sx, sy, T, T);
    ctx.fillStyle = '#2b2a33';
    ctx.fillRect(sx, sy, T, 1);
    ctx.fillRect(sx, sy, 1, T);
    if (h % 6 === 0) { ctx.fillStyle = '#2f2e37'; ctx.fillRect(sx + 4 + (h % 6), sy + 5, 5, 1); ctx.fillRect(sx + 8 + (h % 4), sy + 6, 1, 4); }
    if (ch === 'D' && !save.shortcut) {
      ctx.fillStyle = '#4a3420'; ctx.fillRect(sx, sy, T, T);
      ctx.fillStyle = '#6a4a2c'; ctx.fillRect(sx + 1, sy + 1, T - 2, T - 2);
      ctx.fillStyle = '#2a1a10'; for (let x = 4; x < T; x += 5) ctx.fillRect(sx + x, sy + 1, 1, T - 2);
      ctx.fillStyle = '#a0a0a0'; ctx.fillRect(sx + 7, sy + 8, 2, 2);
    }
    if (ch === 'F' && !save.boss) {
      const tt = performance.now() / 300;
      ctx.fillStyle = `rgba(230,230,255,${0.35 + Math.sin(tt + c) * 0.12})`;
      ctx.fillRect(sx, sy - 4, T, T + 6);
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.fillRect(sx + ((tt * 3 + c * 5) % 14), sy, 2, T);
    }
  }

  function drawFlip(img, x, y, flip) {
    ctx.save();
    ctx.translate(Math.round(x) + (flip ? 16 : 0), Math.round(y));
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  function drawBonfire(b, ox, oy, t) {
    const x = Math.round(b.x - ox), y = Math.round(b.y - oy);
    ctx.fillStyle = '#4a4440'; ctx.fillRect(x - 7, y + 2, 14, 4);
    ctx.fillStyle = '#5c5650'; ctx.fillRect(x - 5, y + 1, 10, 2);
    ctx.fillStyle = '#9aa0b0'; ctx.fillRect(x, y - 12, 2, 14); // 꽂힌 칼
    ctx.fillStyle = '#6a5030'; ctx.fillRect(x - 2, y - 12, 6, 2);
    if (save.lit.includes(b.id)) {
      const f = Math.floor(t / 90) % 3;
      ctx.fillStyle = '#ff7a20'; ctx.fillRect(x - 4 + f, y - 6, 9 - f, 8);
      ctx.fillStyle = '#ffc040'; ctx.fillRect(x - 2, y - 9 + f, 5, 8 - f);
      ctx.fillStyle = '#fff0a0'; ctx.fillRect(x - 1 + (f % 2), y - 4, 2, 4);
    } else {
      ctx.fillStyle = '#802010'; ctx.fillRect(x - 3, y, 2, 1); ctx.fillRect(x + 3, y, 1, 1);
    }
  }

  function drawBoss(b, ox, oy, t) {
    const x = Math.round(b.x - ox), y = Math.round(b.y - oy);
    const glow = b.phase === 2 ? '#ff70d0' : '#a080ff';
    const tele = b.state.startsWith('w_');
    const shake = tele ? (Math.floor(t / 40) % 2) : 0;
    const X = x - 14 + shake, Y = y - 26;
    ctx.fillStyle = '#000'; ctx.globalAlpha = 0.35; ctx.fillRect(x - 12, y + 4, 24, 4); ctx.globalAlpha = 1;
    // 몸통 (돌 갑옷)
    ctx.fillStyle = b.flash ? '#ffffff' : '#3a3450'; ctx.fillRect(X + 4, Y + 8, 20, 18);
    ctx.fillStyle = b.flash ? '#ffffff' : '#4c4468'; ctx.fillRect(X + 6, Y + 10, 16, 6);
    // 다리
    ctx.fillStyle = '#2a2438'; ctx.fillRect(X + 6, Y + 26, 6, 6); ctx.fillRect(X + 16, Y + 26, 6, 6);
    // 팔 (공격 준비 때 들어 올림)
    const armUp = tele ? -6 : 0;
    ctx.fillStyle = '#3a3450'; ctx.fillRect(X - 2, Y + 10 + armUp, 6, 14); ctx.fillRect(X + 24, Y + 10 + armUp, 6, 14);
    ctx.fillStyle = glow; ctx.fillRect(X - 2, Y + 22 + armUp, 6, 3); ctx.fillRect(X + 24, Y + 22 + armUp, 6, 3);
    // 머리 + 눈
    ctx.fillStyle = '#2e2840'; ctx.fillRect(X + 8, Y, 12, 9);
    ctx.fillStyle = glow; ctx.fillRect(X + 10, Y + 4, 3, 2); ctx.fillRect(X + 15, Y + 4, 3, 2);
    // 등의 크리스탈
    ctx.fillStyle = glow; ctx.fillRect(X + 3, Y + 3, 3, 6); ctx.fillRect(X + 22, Y + 2, 3, 7); ctx.fillRect(X + 13, Y - 5, 2, 5);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(X + 23, Y + 3, 1, 2); ctx.fillRect(X + 4, Y + 4, 1, 2);
    if (tele) { ctx.fillStyle = glow; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t / 60); ctx.fillRect(X + 12, Y + 14, 4, 4); ctx.globalAlpha = 1; }
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
      drawTile(map[r][c], c, r, c * T - ox, r * T - oy);
    }
    // 바닥 표시들
    if (save.stain) {
      const x = Math.round(save.stain.x - ox), y = Math.round(save.stain.y - oy);
      ctx.fillStyle = '#7a0a10'; ctx.fillRect(x - 5, y - 1, 10, 3); ctx.fillRect(x - 2, y - 3, 4, 7);
      ctx.fillStyle = `rgba(80,255,180,${0.4 + 0.3 * Math.sin(t / 200)})`; ctx.fillRect(x - 1, y - 8 - Math.floor((t / 120) % 6), 2, 2);
    }
    for (const f of fx) {
      if (f.kind === 'mark') {
        const k = Math.min(1, f.t / f.dur);
        ctx.strokeStyle = f.done ? '#ffffff' : `rgba(255,112,208,${0.4 + 0.5 * k})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(Math.round(f.x - ox), Math.round(f.y - oy), f.r * (f.done ? 1 : k), 0, Math.PI * 2); ctx.stroke();
        if (f.done) { ctx.fillStyle = '#ff70d0'; ctx.fillRect(Math.round(f.x - ox) - 2, Math.round(f.y - oy) - 10, 4, 10); }
      }
      if (f.kind === 'ring') {
        ctx.strokeStyle = `rgba(200,160,255,${1 - f.t / 500})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(Math.round(f.x - ox), Math.round(f.y - oy), f.r * (0.3 + f.t / 500), 0, Math.PI * 2); ctx.stroke();
      }
    }
    for (const b of BONFIRES) drawBonfire(b, ox, oy, t);
    for (const c of CHESTS) {
      if (save.chests.includes(c.id)) continue;
      const x = Math.round(c.x - ox) - 7, y = Math.round(c.y - oy) - 6;
      ctx.fillStyle = '#5a3a1c'; ctx.fillRect(x, y, 14, 10);
      ctx.fillStyle = '#7a5228'; ctx.fillRect(x + 1, y + 1, 12, 3);
      ctx.fillStyle = '#d8b040'; ctx.fillRect(x + 6, y + 4, 2, 3);
    }
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
      if (s.kind === 'arrow') { ctx.fillStyle = '#d8c8a0'; ctx.fillRect(x - Math.round(s.vx * 30), y - Math.round(s.vy * 30), 2, 2); ctx.fillRect(x, y, 2, 2); ctx.fillStyle = '#c0c0c0'; ctx.fillRect(x + Math.round(s.vx * 12), y + Math.round(s.vy * 12), 2, 2); }
      else { ctx.fillStyle = '#ff90e0'; ctx.fillRect(x - 2, y - 2, 4, 4); ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, y - 1, 2, 2); }
    }
    for (const f of fx) {
      if (f.kind === 'spark') { ctx.fillStyle = f.c; const k = f.t / 6; for (const [a, b2] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7]]) ctx.fillRect(Math.round(f.x - ox + a * k), Math.round(f.y - oy + b2 * k), 2, 2); }
      if (f.kind === 'heal') { ctx.fillStyle = `rgba(255,200,80,${1 - f.t / 500})`; for (let i = 0; i < 6; i++) ctx.fillRect(Math.round(f.x - ox - 8 + i * 3), Math.round(f.y - oy - 4 - (f.t / 20) - (i % 3) * 3), 2, 2); }
      if (f.kind === 'burst') { ctx.fillStyle = `rgba(255,160,240,${1 - f.t / 1500})`; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ctx.fillRect(Math.round(f.x - ox + Math.cos(a) * f.t / 15), Math.round(f.y - oy + Math.sin(a) * f.t / 15), 3, 3); } }
    }
    // 어둠 (플레이어·불 주변만 밝게)
    dctx.globalCompositeOperation = 'source-over';
    dctx.fillStyle = 'rgba(0,0,0,0.62)';
    dctx.fillRect(0, 0, VW, VH);
    dctx.globalCompositeOperation = 'destination-out';
    const light = (x, y, r) => {
      const g = dctx.createRadialGradient(x, y, r * 0.25, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = g;
      dctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    light(P.x - ox, P.y - oy, inArena ? 170 : 115);
    for (const b of BONFIRES) if (save.lit.includes(b.id)) light(b.x - ox, b.y - oy, 80 + Math.sin(t / 150) * 3);
    if (boss && inArena) light(boss.x - ox, boss.y - oy, 60);
    ctx.drawImage(dark, 0, 0);
    drawHud(t);
  }

  function drawPlayer(ox, oy, t) {
    const x = P.x - ox - 8, y = P.y - oy - 13;
    const flip = P.face.x < -0.1;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(Math.round(P.x - ox) - 5, Math.round(P.y - oy) + 2, 10, 2);
    if (P.iframe > 0 && P.act !== 'roll' && Math.floor(t / 60) % 2) return;
    if (P.act === 'roll') { drawFlip(spr.pR, x, y, flip); return; }
    const img = Math.floor(P.walk / 140) % 2 ? spr.pB : spr.pA;
    drawFlip(img, x, y, flip);
    // 칼 휘두르기
    if (P.act === 'light' || P.act === 'heavy') {
      const a = ACTS[P.act];
      const base = Math.atan2(P.face.y, P.face.x);
      const k = Math.min(1, Math.max(0, (P.actT - a.a0 + 60) / (a.a1 - a.a0 + 60)));
      const swing = base - a.arc + k * a.arc * 2;
      const len = a.range - 2;
      const cx = P.x - ox, cy = P.y - oy - 6;
      ctx.fillStyle = P.act === 'heavy' ? '#ffd0a0' : '#e8ecff';
      for (let i = 6; i < len; i += 2) ctx.fillRect(Math.round(cx + Math.cos(swing) * i), Math.round(cy + Math.sin(swing) * i), 2, 2);
      if (P.actT >= a.a0 && P.actT <= a.a1) {
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        for (let s2 = -a.arc; s2 <= a.arc; s2 += 0.15) ctx.fillRect(Math.round(cx + Math.cos(base + s2) * len), Math.round(cy + Math.sin(base + s2) * len), 2, 2);
      }
    } else if (P.act === 'heal') {
      ctx.fillStyle = '#ffb030'; ctx.fillRect(Math.round(P.x - ox) + (flip ? -6 : 4), Math.round(P.y - oy) - 12, 3, 5);
    } else {
      // 들고 있는 칼
      const sx = Math.round(P.x - ox) + (flip ? -8 : 6), sy = Math.round(P.y - oy) - 9;
      ctx.fillStyle = '#c8ccd8'; ctx.fillRect(sx, sy - 6, 2, 9);
      ctx.fillStyle = '#6a5030'; ctx.fillRect(sx - 1, sy + 2, 4, 1);
    }
  }

  function drawEnemy(e, ox, oy, t) {
    const x = e.x - ox - 8, y = e.y - oy - 13;
    const flip = (e.state === 'windup' || e.state === 'active' ? e.dir.x : P.x - e.x) < 0;
    const step = Math.floor(e.walk / 160) % 2;
    let img = e.type === 'knight' ? (step ? spr.kB : spr.kA) : e.type === 'archer' ? (step ? spr.aB : spr.aA) : (step ? spr.hB : spr.hA);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(Math.round(e.x - ox) - 5, Math.round(e.y - oy) + 2, 10, 2);
    drawFlip(img, x, y, flip);
    if (e.flash > 0) { ctx.globalAlpha = 0.6; ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(x) + 4, Math.round(y) + 2, 8, 12); ctx.globalAlpha = 1; }
    // 공격 예고: 무기를 들어 올리고 빛남
    const wx = Math.round(e.x - ox + (flip ? -8 : 6)), wy = Math.round(e.y - oy) - 8;
    if (e.type === 'archer') {
      ctx.fillStyle = '#8a6a3a'; ctx.fillRect(wx, wy - 4, 1, 9);
      if (e.state === 'windup') { ctx.fillStyle = '#ffe080'; ctx.fillRect(wx + (flip ? -2 : 2), wy, 2, 1); }
    } else {
      const raise = e.state === 'windup' ? -4 : e.state === 'active' ? 3 : 0;
      ctx.fillStyle = e.type === 'knight' ? '#70707e' : '#8a8478';
      ctx.fillRect(wx, wy - 6 + raise, 2, e.type === 'knight' ? 12 : 9);
      if (e.state === 'windup' && Math.floor(t / 80) % 2) { ctx.fillStyle = '#ff4040'; ctx.fillRect(wx, wy - 7 + raise, 2, 2); }
      if (e.state === 'active') {
        ctx.fillStyle = 'rgba(255,255,255,.4)';
        const base = Math.atan2(e.dir.y, e.dir.x);
        for (let s2 = -1; s2 <= 1; s2 += 0.2) ctx.fillRect(Math.round(e.x - ox + Math.cos(base + s2) * 14), Math.round(e.y - oy - 6 + Math.sin(base + s2) * 14), 2, 2);
      }
    }
    // 다친 적은 머리 위 체력
    if (e.hp < e.hpMax && !e.dead) {
      ctx.fillStyle = '#200'; ctx.fillRect(Math.round(e.x - ox) - 8, Math.round(e.y - oy) - 17, 16, 2);
      ctx.fillStyle = '#c02020'; ctx.fillRect(Math.round(e.x - ox) - 8, Math.round(e.y - oy) - 17, Math.round((16 * e.hp) / e.hpMax), 2);
    }
  }

  function bar(x, y, w, h, v, max, col, back) {
    ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = back; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col; ctx.fillRect(x, y, Math.max(0, Math.round((w * v) / max)), h);
  }

  function drawHud(t) {
    const s = stats();
    bar(6, 6, Math.round(s.hpMax * 0.9), 4, P.hp, s.hpMax, '#c02828', '#3a1010');
    bar(6, 13, Math.round(s.stMax * 0.9), 3, Math.max(0, P.st), s.stMax, '#3cb85a', '#10301a');
    // 에스트 병
    for (let i = 0; i < save.estusMax; i++) { ctx.fillStyle = i < P.estus ? '#ff9a20' : '#3a2a1a'; ctx.fillRect(6 + i * 6, 20, 4, 6); ctx.fillStyle = '#d8d0c0'; ctx.fillRect(7 + i * 6, 19, 2, 1); }
    // 소울
    text(ctx, String(save.souls), VW - 6 - String(save.souls).length * 6, VH - 12, '#e8e0c8');
    ctx.fillStyle = '#c8e8ff'; ctx.fillRect(VW - 12 - String(save.souls).length * 6, VH - 11, 3, 5);
    // 보스 체력
    if (boss && inArena) {
      text(ctx, 'CORRUPTED WARDEN', 40, VH - 22, '#e0d8f0');
      bar(40, VH - 13, VW - 80, 4, boss.hp, boss.hpMax, boss.phase === 2 ? '#d040a0' : '#9a2020', '#2a0a0a');
    }
    const n = mode === 'play' ? nearby() : null;
    if (n) {
      const label = `F ${n.kind === 'bonfire' ? 'REST' : n.kind === 'chest' ? 'OPEN' : n.kind === 'fog' ? 'ENTER' : 'OPEN DOOR'}`;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(VW / 2 - textWidth(label) / 2 - 4, VH - 40, textWidth(label) + 8, 12);
      center(ctx, label, VH - 38, VW, '#ffffff', null);
    }
    if (banner) {
      banner.t += 16;
      const a = banner.t < 300 ? banner.t / 300 : banner.t > 2200 ? Math.max(0, 1 - (banner.t - 2200) / 600) : 1;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, VH / 2 - 14, VW, 22);
      center(ctx, banner.s, VH / 2 - 7, VW, banner.c, null);
      ctx.globalAlpha = 1;
      if (banner.t > 2800) banner = null;
    }
    if (mode === 'dead') {
      const a = Math.min(1, deadT / 900);
      ctx.fillStyle = `rgba(0,0,0,${a * 0.6})`; ctx.fillRect(0, 0, VW, VH);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, VH / 2 - 14, VW, 22);
      center(ctx, 'YOU DIED', VH / 2 - 7, VW, '#b01818', null);
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
    else {
      ctx.fillStyle = '#07060b';
      ctx.fillRect(0, 0, VW, VH);
      const f = Math.floor(t / 90) % 3;
      ctx.fillStyle = '#ff7a20'; ctx.fillRect(VW / 2 - 6 + f, 150, 12 - f, 10);
      ctx.fillStyle = '#ffc040'; ctx.fillRect(VW / 2 - 3, 146 + f, 6, 12 - f);
      ctx.fillStyle = '#9aa0b0'; ctx.fillRect(VW / 2 - 1, 132, 2, 22);
    }
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
