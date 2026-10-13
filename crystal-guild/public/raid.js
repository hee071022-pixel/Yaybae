// 8비트 레이드: 영웅 넷이 자동으로 싸우고, 나는 스킬을 쓰고 보스의 큰 공격을 피하게 해 준다.
// 한 판 60초. 넣은 피해만큼 길드 공용 보스 체력이 깎인다. 화면은 패미컴 해상도(256x224).
import { makeScreen, text, center, loop, sprite } from './arcade.js';
import { NES, HEROES, GEAR, BOSSES } from './raid-art.js';

const W = 256, H = 224;
const RUN_MS = 60000;
const C = NES;

const KINDS = [
  { kind: 'knight', name: 'KNIGHT', max: 700, dmg: 55, every: 800, skill: 'GUARD', cd: 9000 },
  { kind: 'warrior', name: 'WARRIOR', max: 450, dmg: 150, every: 600, skill: 'SMASH', cd: 7000 },
  { kind: 'archer', name: 'ARCHER', max: 330, dmg: 110, every: 500, skill: 'VOLLEY', cd: 9000 },
  { kind: 'priest', name: 'PRIEST', max: 330, dmg: 40, every: 1000, skill: 'HEAL', cd: 14000 },
];
const SPOTS = [[86, 128], [62, 112], [44, 134], [22, 116]]; // 발 위치
const ATTACKS = [
  { one: 'BOUNCE', all: 'SPLASH', drop: 'b' },
  { one: 'SLASH', all: 'BONE RAIN', drop: '1' },
  { one: 'PUNCH', all: 'QUAKE', drop: '3' },
  { one: 'CLAW', all: 'FIRE BREATH', drop: '6' },
];

// ---------- 소리 (사각파 삑삑) ----------
let audio = null;
function beep(freq, ms = 80, type = 'square', vol = 0.05, slide = 0) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, audio.currentTime);
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, audio.currentTime + ms / 1000);
    g.gain.setValueAtTime(vol, audio.currentTime);
    g.gain.linearRampToValueAtTime(0, audio.currentTime + ms / 1000);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + ms / 1000);
  } catch { /* 소리 없어도 됨 */ }
}

// ---------- 배경 (성 안 벽돌 바닥 + 기둥) ----------
function makeBackground() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const px = (col, x, y, w = 1, h = 1) => { g.fillStyle = C[col] || col; g.fillRect(x, y, w, h); };
  px('0', 0, 0, W, H);
  // 먼 벽: 어두운 파란 벽돌
  for (let y = 32; y < 100; y += 8) for (let x = -((y / 8) % 2) * 8; x < W; x += 16) {
    px('i', x, y, 15, 7);
    px('m', x, y, 15, 1);
  }
  // 창문 (달빛)
  for (const wx of [40, 124, 208]) {
    px('0', wx - 1, 38, 14, 26);
    px('m', wx, 39, 12, 24);
    px('9', wx + 2, 41, 3, 3);
    px('0', wx + 5, 39, 2, 24);
    px('0', wx, 50, 12, 2);
  }
  // 기둥
  for (const cx of [0, 110, 240]) {
    px('0', cx - 1, 32, 18, 72);
    for (let y = 32; y < 104; y += 8) { px('3', cx, y, 16, 7); px('2', cx, y, 16, 1); px('0', cx + 7, y + 1, 1, 6); }
  }
  // 바닥: 회색 벽돌
  px('0', 0, 100, W, 2);
  for (let y = 102; y < 150; y += 8) for (let x = -((y / 8) % 2) * 8; x < W; x += 16) {
    px('3', x, y, 15, 7);
    px('2', x, y, 15, 1);
    px('2', x, y, 1, 7);
  }
  // 아래 상태창 바탕
  px('0', 0, 150, W, H - 150);
  return c;
}

export function eightBitRaid(area, { onEnd }) {
  area.innerHTML = '<div class="rd-screen" id="rd-screen"></div>';
  const { cv, ctx, toLocal } = makeScreen(area.querySelector('#rd-screen'), W, H, 768);
  const bg = makeBackground();
  const spr = Object.fromEntries(KINDS.map((k) => [k.kind, {
    idle: sprite(HEROES[k.kind].idle, C), hit: sprite(HEROES[k.kind].hit, C),
    white: sprite(HEROES[k.kind].idle, Object.fromEntries(Object.keys(C).map((x) => [x, '#fcfcfc']))),
  }]));
  const gear = Object.fromEntries(Object.entries(GEAR).map(([k, v]) => [k, sprite(v, C)]));
  const bossSpr = BOSSES.map((b) => ({
    img: sprite(b.rows, C),
    white: sprite(b.rows, Object.fromEntries(Object.keys(C).map((x) => [x, '#fcfcfc']))),
    red: sprite(b.rows, { ...C, 2: '#f87858', 3: '#a81000', 1: '#fca044', b: '#f87858', a: '#a81000', 5: '#fca044', 4: '#f83800' }),
  }));
  const heads = Object.fromEntries(KINDS.map((k) => [k.kind, sprite(HEROES[k.kind].idle.slice(0, 8), C)]));

  let st = null; // 진행 중인 판
  let mode = 'idle'; // idle | count | fight | end
  let info = { name: 'SLIME KING', boss: 0, hp: 1, hpMax: 1, practice: true };
  let result = null;

  function reset(opts) {
    info = opts;
    st = {
      t: 0, count: 3000, dmg: 0, shield: 0, enrage: false,
      heroes: KINDS.map((k, i) => ({ ...k, x: SPOTS[i][0], y: SPOTS[i][1], hp: k.max, cdLeft: 1500, atkT: Math.random() * k.every, anim: 0, hurt: 0, mark: 0, dodge: 0, dead: false })),
      boss: { next: 2600, tele: null, hitT: 1600, flash: 0, shake: 0, bob: 0 },
      fx: [], nums: [], arrows: [], drops: [],
    };
  }

  const alive = () => st.heroes.filter((h) => !h.dead);
  const bossX = 160, bossY = 60;
  const bossLeft = () => info.hp - st.dmg;

  function dealBoss(n, x, y, col = '1') {
    const crit = Math.random() < 0.12;
    const v = Math.round(n * (crit ? 2 : 1) * (0.9 + Math.random() * 0.2));
    st.dmg += v;
    st.boss.flash = crit ? 90 : 50;
    st.nums.push({ v: crit ? `${v}!` : String(v), x: x ?? bossX + 20 + Math.random() * 24, y: y ?? bossY + 10 + Math.random() * 20, t: 0, col: crit ? '7' : col });
    if (crit) beep(880, 60, 'square', 0.04);
  }
  function hurtHero(h, n) {
    if (h.dead) return;
    if (h.dodge > 0) { st.nums.push({ v: 'MISS', x: h.x - 6, y: h.y - 26, t: 0, col: '9' }); return; }
    const v = Math.round(n * (st.shield > 0 ? 0.2 : 1) * (st.enrage ? 1.5 : 1));
    h.hp -= v;
    h.hurt = 200;
    st.nums.push({ v: String(v), x: h.x - 6, y: h.y - 26, t: 0, col: '5' });
    if (h.hp <= 0) { h.hp = 0; h.dead = true; beep(140, 300, 'triangle', 0.08, -80); }
  }

  function useSkill(i) {
    if (mode !== 'fight') return;
    const h = st.heroes[i];
    if (!h || h.dead) return;
    if (h.mark > 0) { // 표시된 영웅 → 피하기
      h.dodge = 600; h.mark = 0; h.safe = true;
      beep(660, 70, 'square', 0.05, 300);
      return;
    }
    if (h.cdLeft > 0) { beep(110, 50, 'square', 0.03); return; }
    h.cdLeft = h.cd;
    h.anim = 250;
    if (h.kind === 'knight') { st.shield = 3000; beep(330, 160, 'square', 0.05, 200); }
    if (h.kind === 'warrior') { setTimeout(() => mode === 'fight' && dealBoss(3000, null, null, '7'), 150); st.boss.shake = 300; beep(110, 200, 'sawtooth', 0.08, -60); }
    if (h.kind === 'archer') for (let k = 0; k < 8; k++) st.arrows.push({ x: h.x + 6, y: h.y - 10 - (k % 3) * 4, delay: k * 140, dmg: 400 });
    if (h.kind === 'priest') {
      for (const x of st.heroes) {
        if (x.dead) { x.dead = false; x.hp = Math.round(x.max * 0.3); } else x.hp = Math.min(x.max, x.hp + Math.round(x.max * 0.45));
        st.fx.push({ kind: 'heal', x: x.x, y: x.y, t: 0 });
      }
      beep(523, 90); setTimeout(() => beep(659, 90), 90); setTimeout(() => beep(784, 140), 180);
    }
  }

  function bossAct(dt) {
    const b = st.boss;
    b.flash = Math.max(0, b.flash - dt);
    b.shake = Math.max(0, b.shake - dt);
    b.bob += dt;
    // 기본 공격: 맨 앞 영웅(대개 기사)
    b.hitT -= dt;
    if (b.hitT <= 0) {
      b.hitT = st.enrage ? 1100 : 1600;
      const front = alive()[0];
      if (front) { hurtHero(front, 35); st.fx.push({ kind: 'slash', x: front.x, y: front.y - 10, t: 0 }); beep(200, 40, 'square', 0.03); }
    }
    if (b.tele) {
      b.tele.t -= dt;
      if (b.tele.t <= 0) {
        const tele = b.tele;
        b.tele = null;
        if (tele.kind === 'one') {
          const h = tele.target;
          st.fx.push({ kind: 'impact', x: h.x, y: h.y, t: 0 });
          if (h.safe) st.nums.push({ v: 'MISS', x: h.x - 6, y: h.y - 26, t: 0, col: '9' });
          else hurtHero(h, 240);
          h.mark = 0; h.safe = false;
          b.shake = 200;
          beep(90, 180, 'sawtooth', 0.08, -40);
        } else {
          for (let k = 0; k < 26; k++) st.drops.push({ x: 4 + Math.random() * 110, y: 30 - Math.random() * 50, vy: 0.12 + Math.random() * 0.08 });
          for (const h of alive()) hurtHero(h, 120);
          b.shake = 400;
          beep(70, 400, 'sawtooth', 0.08, -30);
        }
        b.next = (st.enrage ? 1400 : 2300) + Math.random() * 1100;
      }
      return;
    }
    b.next -= dt;
    if (b.next <= 0) {
      const team = alive();
      if (!team.length) return;
      if (Math.random() < 0.55) {
        const target = team[Math.floor(Math.random() * team.length)];
        target.mark = 1300;
        b.tele = { kind: 'one', t: 1300, target, name: ATTACKS[info.boss].one };
      } else {
        b.tele = { kind: 'all', t: 1600, name: ATTACKS[info.boss].all };
      }
      beep(988, 60, 'square', 0.05); setTimeout(() => beep(988, 60, 'square', 0.05), 120);
    }
  }

  function step(dt) {
    if (mode === 'count') {
      st.count -= dt;
      if (Math.ceil(st.count / 1000) !== Math.ceil((st.count + dt) / 1000)) beep(st.count <= 0 ? 880 : 440, 120);
      if (st.count <= 0) mode = 'fight';
      return;
    }
    if (mode !== 'fight') return;
    st.t += dt;
    st.enrage = st.t > 40000;
    st.shield = Math.max(0, st.shield - dt);
    for (const h of st.heroes) {
      h.cdLeft = Math.max(0, h.cdLeft - dt);
      h.anim = Math.max(0, h.anim - dt);
      h.hurt = Math.max(0, h.hurt - dt);
      h.dodge = Math.max(0, h.dodge - dt);
      h.mark = Math.max(0, h.mark - dt);
      if (h.dead) continue;
      h.atkT -= dt;
      if (h.atkT <= 0) {
        h.atkT = h.every;
        h.anim = 160;
        if (h.kind === 'archer') st.arrows.push({ x: h.x + 6, y: h.y - 10, delay: 0, dmg: h.dmg });
        else if (h.kind === 'priest') {
          st.fx.push({ kind: 'bolt', x: h.x + 8, y: h.y - 12, t: 0 });
          dealBoss(h.dmg, null, null, 'g');
          const low = alive().sort((a, b) => a.hp / a.max - b.hp / b.max)[0];
          if (low) low.hp = Math.min(low.max, low.hp + 30);
        } else { dealBoss(h.dmg); st.fx.push({ kind: 'slash', x: bossX + 8, y: h.y - 14, t: 0 }); }
      }
    }
    for (const a of st.arrows) {
      if (a.delay > 0) { a.delay -= dt; continue; }
      a.x += dt * 0.35;
      if (a.x >= bossX + 6) { a.done = true; dealBoss(a.dmg, a.x + 4, a.y - 4, '7'); }
    }
    st.arrows = st.arrows.filter((a) => !a.done);
    for (const d of st.drops) d.y += d.vy * dt;
    st.drops = st.drops.filter((d) => d.y < 140);
    for (const f of st.fx) f.t += dt;
    st.fx = st.fx.filter((f) => f.t < 400);
    for (const n of st.nums) n.t += dt;
    st.nums = st.nums.filter((n) => n.t < 700);
    bossAct(dt);
    const over = st.t >= RUN_MS ? 'TIME UP' : !alive().length ? 'WIPED OUT' : bossLeft() <= 0 ? 'VICTORY' : null;
    if (over) {
      mode = 'end';
      result = { title: over, dmg: Math.min(st.dmg, info.practice ? st.dmg : Math.max(0, info.hp)) };
      beep(over === 'WIPED OUT' ? 196 : 523, 500, 'triangle', 0.08, over === 'WIPED OUT' ? -100 : 260);
      onEnd?.({ damage: st.dmg, practice: info.practice, reason: over });
    }
  }

  // ---------- 그리기 ----------
  const px = (col, x, y, w = 1, h = 1) => { ctx.fillStyle = C[col] || col; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
  function box(x, y, w, h, line = '1') {
    px('0', x, y, w, h);
    px(line, x + 1, y, w - 2, 1); px(line, x + 1, y + h - 1, w - 2, 1);
    px(line, x, y + 1, 1, h - 2); px(line, x + w - 1, y + 1, 1, h - 2);
  }
  function hpBar(x, y, w, h, v, max, col) {
    px('0', x - 1, y - 1, w + 2, h + 2);
    px('i', x, y, w, h);
    const fw = Math.max(0, Math.round((w * v) / max));
    px(col, x, y, fw, h);
    if (fw > 1) px('1', x, y, fw - 1, 1);
  }

  function draw(t) {
    ctx.drawImage(bg, 0, 0);
    // 횃불
    for (const cx of [8, 118, 248]) {
      const f = Math.floor(t / 120) % 2;
      px('e', cx - 1, 66, 2, 6);
      px('5', cx - 2, 60 + f, 4, 6 - f);
      px('7', cx - 1, 62 + f, 2, 3);
    }
    if (!st) {
      const bs = bossSpr[info.boss];
      px('0', bossX + 8, bossY + 62, 48, 4);
      ctx.drawImage(bs.img, bossX, bossY + Math.round(Math.sin(t / 300) * 1.5), 64, 64);
      KINDS.forEach((k, i) => { px('0', SPOTS[i][0] - 6, SPOTS[i][1] - 1, 12, 2); ctx.drawImage(spr[k.kind].idle, SPOTS[i][0] - 8, SPOTS[i][1] - 16); });
      drawTop(); drawPanels(t); drawOverlay(t);
      return;
    }
    const b = st.boss;
    // 보스
    const shake = b.shake > 0 ? (Math.floor(t / 30) % 2 ? 2 : -2) : 0;
    const bob = Math.round(Math.sin(b.bob / 300) * 1.5);
    const bs = bossSpr[info.boss];
    const tele = b.tele && Math.floor(t / 100) % 2;
    ctx.fillStyle = C[0];
    ctx.fillRect(bossX + 8, bossY + 62, 48, 4);
    ctx.drawImage(b.flash > 0 ? bs.white : tele || (st.enrage && Math.floor(t / 400) % 2) ? bs.red : bs.img, bossX + shake, bossY + bob, 64, 64);
    // 영웅
    const order = [...st.heroes].sort((a, c) => a.y - c.y);
    for (const h of order) drawHero(h, t);
    for (const a of st.arrows) if (a.delay <= 0) ctx.drawImage(gear.arrow, Math.round(a.x), Math.round(a.y));
    for (const d of st.drops) if (d.y > 30) { px('0', d.x - 1, d.y - 1, 4, 5); px(ATTACKS[info.boss].drop, d.x, d.y, 2, 3); }
    for (const f of st.fx) {
      const k = f.t / 400;
      if (f.kind === 'slash') { for (let i = 0; i < 5; i++) px('1', f.x + i * 2 - 4 + k * 4, f.y + i * 2 - 4, 2, 1); }
      if (f.kind === 'impact') { for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; px('7', f.x + Math.cos(a) * k * 18, f.y - 8 + Math.sin(a) * k * 12, 2, 2); } }
      if (f.kind === 'heal') { for (let i = 0; i < 3; i++) px('b', f.x - 6 + i * 6, f.y - 8 - k * 20 - i * 3, 2, 2); px('p', f.x - 1, f.y - 14 - k * 16, 2, 2); }
      if (f.kind === 'bolt') { const x = f.x + (bossX + 20 - f.x) * Math.min(1, k * 2); px('g', x, f.y, 3, 3); px('1', x + 1, f.y + 1, 1, 1); }
    }
    if (st.shield > 0) for (const h of alive()) { if (Math.floor(t / 80) % 3) { px('9', h.x - 9, h.y - 22, 1, 20); px('9', h.x - 9, h.y - 22, 3, 1); px('9', h.x - 9, h.y - 3, 3, 1); } }
    for (const n of st.nums) text(ctx, n.v, Math.round(n.x), Math.round(n.y - n.t / 25), C[n.col], C[0]);
    // 큰 공격 예고
    if (b.tele) {
      const w = b.tele.name.length * 6 + 10;
      box(W / 2 - w / 2, 28, w, 13, tele ? '5' : '7');
      center(ctx, b.tele.name, 31, W, C[tele ? '5' : '7'], null);
      if (b.tele.kind === 'all' && st.shield <= 0) center(ctx, 'GUARD!', 44, W, C[Math.floor(t / 150) % 2 ? '9' : '1'], C[0]);
    }
    if (st.enrage) text(ctx, 'RAGE', bossX + 20, bossY - 8, C[Math.floor(t / 200) % 2 ? '5' : '6'], C[0]);
    drawTop();
    drawPanels(t);
    drawOverlay(t);
  }

  function drawHero(h, t) {
    const dx = h.dodge > 0 ? -10 * Math.sin((h.dodge / 600) * Math.PI) : 0;
    const dy = h.dodge > 0 ? -8 * Math.sin((h.dodge / 600) * Math.PI) : 0;
    const x = Math.round(h.x - 8 + dx), y = Math.round(h.y - 16 + dy);
    px('0', h.x - 6, h.y - 1, 12, 2);
    if (h.dead) { // 쓰러짐: 묘비
      px('0', h.x - 5, h.y - 11, 10, 11); px('3', h.x - 4, h.y - 10, 8, 10); px('2', h.x - 4, h.y - 10, 8, 1);
      px('0', h.x - 1, h.y - 8, 2, 6); px('0', h.x - 3, h.y - 6, 6, 2);
      return;
    }
    const img = h.hurt > 0 && Math.floor(t / 50) % 2 ? spr[h.kind].white : h.anim > 0 ? spr[h.kind].hit : spr[h.kind].idle;
    ctx.drawImage(img, x, y);
    const g = h.kind === 'knight' ? gear.shield : h.kind === 'warrior' ? gear.sword : h.kind === 'archer' ? gear.bow : gear.staff;
    const gx = h.kind === 'knight' ? 10 : h.kind === 'warrior' ? (h.anim > 0 ? 13 : 10) : h.kind === 'archer' ? 12 : 11;
    const gy = h.kind === 'knight' ? 6 : h.kind === 'warrior' ? (h.anim > 0 ? 0 : 1) : h.kind === 'archer' ? 4 : 1;
    ctx.drawImage(g, x + gx, y + gy);
    if (h.mark > 0) { // 노리는 표시
      const bl = Math.floor(t / 90) % 2;
      box(h.x - 5, y - 13, 11, 11, bl ? '5' : '7');
      text(ctx, '!', h.x - 2, y - 11, C[bl ? '5' : '7'], null);
    }
  }

  function drawTop() {
    const name = BOSSES[info.boss].name + (info.level > 1 ? ` LV${info.level}` : '');
    text(ctx, name, 6, 4, C[1], C[0]);
    const left = st ? Math.max(0, Math.ceil((RUN_MS - st.t) / 1000)) : 60;
    const tl = `TIME ${String(left).padStart(2, '0')}`;
    text(ctx, tl, W - 6 - tl.length * 6, 4, C[left <= 10 && st && mode === 'fight' ? '5' : '1'], C[0]);
    hpBar(6, 14, W - 12, 5, Math.max(0, st ? bossLeft() : info.hp), info.hpMax, st?.enrage ? '5' : 'd');
    const dmg = `DMG ${String(st ? st.dmg : 0).padStart(6, '0')}`;
    text(ctx, dmg, 6, 22, C[7], C[0]);
    if (info.practice) text(ctx, 'PRACTICE', W - 54, 22, C[9], C[0]);
  }

  function drawPanels(t) {
    KINDS.forEach((k, i) => {
      const h = st?.heroes[i] || { ...k, hp: k.max, cdLeft: 0, mark: 0, dead: false };
      const x = 2 + i * 63, y = 153;
      const marked = h.mark > 0 && Math.floor(t / 90) % 2;
      box(x, y, 61, 69, marked ? '5' : h.mark > 0 ? '7' : '2');
      ctx.drawImage(heads[k.kind], x + 4, y + 4);
      text(ctx, String(i + 1), x + 51, y + 4, C[3], null);
      text(ctx, k.name.slice(0, 7), x + 4, y + 15, C[h.dead ? 3 : 1], null);
      hpBar(x + 5, y + 25, 51, 3, h.hp, k.max, h.hp / k.max < 0.3 ? '5' : 'b');
      // 스킬 칸
      const ready = !h.dead && h.cdLeft <= 0;
      const sx = x + 4, sy = y + 34;
      px(ready ? '8' : 'i', sx, sy, 53, 28);
      if (!ready && !h.dead) px('m', sx, sy, Math.round(53 * (1 - h.cdLeft / k.cd)), 28);
      px(ready ? '9' : '3', sx, sy, 53, 1);
      if (h.mark > 0 && !h.dead) {
        text(ctx, 'DODGE', sx + 12, sy + 6, C[marked ? '5' : '7'], C[0]);
        text(ctx, 'TAP!', sx + 15, sy + 16, C[1], C[0]);
      } else {
        text(ctx, k.skill, sx + Math.round((53 - k.skill.length * 6) / 2), sy + 6, C[ready ? '1' : '3'], C[0]);
        const s = h.dead ? 'DOWN' : ready ? 'READY' : `${Math.ceil(h.cdLeft / 1000)}`;
        text(ctx, s, sx + Math.round((53 - s.length * 6) / 2), sy + 16, C[h.dead ? '5' : ready ? '7' : '2'], C[0]);
      }
    });
  }

  function drawOverlay(t) {
    if (mode === 'idle') {
      box(64, 34, 128, 22, '7');
      center(ctx, '8 BIT RAID', 38, W, C[7], C[0]);
      if (Math.floor(t / 500) % 2) center(ctx, 'PRESS START', 47, W, C[9], null);
    }
    if (mode === 'count') {
      const n = Math.ceil(st.count / 1000);
      box(108, 64, 40, 28, '7');
      center(ctx, n > 0 ? String(n) : 'GO', 74, W, C[7], null);
    }
    if (mode === 'end' && result) {
      box(40, 52, 176, 66, result.title === 'WIPED OUT' ? '5' : '7');
      center(ctx, result.title, 60, W, C[result.title === 'WIPED OUT' ? '5' : '7'], C[0]);
      center(ctx, 'TOTAL DAMAGE', 78, W, C[2], null);
      center(ctx, String(st.dmg), 90, W, C[1], C[0]);
      center(ctx, info.practice ? 'PRACTICE - NOT SAVED' : result.saved || 'SAVING...', 104, W, C[info.practice ? '9' : 'b'], null);
    }
  }

  // ---------- 입력 ----------
  const KEYS = { 1: 0, 2: 1, 3: 2, 4: 3, q: 0, w: 1, e: 2, r: 3, Q: 0, W: 1, E: 2, R: 3 };
  const onKey = (ev) => {
    if (!area.isConnected || area.closest('.hidden') || ev.target.closest?.('input,textarea')) return;
    if (ev.key in KEYS) { ev.preventDefault(); useSkill(KEYS[ev.key]); }
  };
  document.addEventListener('keydown', onKey);
  cv.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    const [x, y] = toLocal(ev);
    if (y >= 150) { useSkill(Math.min(3, Math.floor((x - 2) / 63))); return; }
    // 영웅을 직접 눌러도 됨
    const h = st?.heroes.find((o) => Math.abs(o.x - x) < 11 && y > o.y - 24 && y < o.y + 4);
    if (h) useSkill(st.heroes.indexOf(h));
  });

  const stop = loop((dt) => { step(dt); draw(performance.now()); });
  // 테스트용 (주소에 ?debug 가 있을 때만)
  if (location.search.includes('debug')) window.__raid = { get st() { return st; }, get mode() { return mode; } };
  return {
    // opts: { name, boss, level, hp, hpMax, practice }
    start(opts) { reset(opts); result = null; mode = 'count'; try { audio?.resume(); } catch { /* */ } },
    setInfo(opts) { if (mode === 'idle' || mode === 'end') { info = { ...info, ...opts }; if (mode === 'idle') st = null; } },
    saved(textLine) { if (result) result.saved = textLine; },
    get busy() { return mode === 'count' || mode === 'fight'; },
    stop() { stop(); document.removeEventListener('keydown', onKey); },
  };
}
