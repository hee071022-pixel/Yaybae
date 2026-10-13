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
// 영웅 발 위치 (오른쪽에 비스듬히 한 줄, 패미컴 RPG 전투 배치)
const SPOTS = [[200, 80], [208, 102], [216, 124], [224, 146]];
const ATTACKS = [
  { one: 'BOUNCE', all: 'SPLASH', drop: ['b', 'a'] },
  { one: 'SLASH', all: 'BONE RAIN', drop: ['1', '2'] },
  { one: 'PUNCH', all: 'QUAKE', drop: ['3', '2'] },
  { one: 'CLAW', all: 'FIRE BREATH', drop: ['6', '5'] },
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

// ---------- 배경 띠 (보스마다 다른 곳에서 싸움) ----------
const fit = (w, rows) => rows.map((r) => r.padEnd(w, '.').slice(0, w));
const BG_ART = {
  tree: fit(12, ['....0000', '..00aaaa00', '.0aabaaaaa0', '0aabbaaaala0', '0abaaaaalla0', '0aaaaaallaa0', '.0aaalllaa0', '0aaaaaaaala0', '0aaalaaalla0', '.00aaalla00', '...00ff00', '....0ff0', '....0ff0', '....0ff0', '...0fff00']),
  pine: fit(10, ['....0', '...0a0', '..0aal0', '...0al0', '..0aaal0', '.0aabaal0', '..0aaal0', '.0aaaaal0', '0aabaaall0', '.00000000', '....0f0', '....0f0']),
  bush: fit(10, ['...0000', '.00bbaa00', '0babaaala0', '0aaaaalll0', '.00000000']),
  tomb: fit(8, ['..0000', '.022220', '02222220', '02200220', '02000020', '02200220', '02200220', '02222220', '02222330', '00000000']),
  cross: fit(7, ['..000', '..020', '0000000', '0222230', '0000000', '..020', '..020', '..030', '..030', '..030', '.00300']),
  deadtree: fit(14, ['.0........0', '0f0.....00f0', '.0f0...0ff0', '..0f0.0f0..00', '...0f0f0..0ff0', '....0ff00ff0', '....0fff0f0', '.....0ff00', '.....0ff0', '.....0ff0', '....0fff0', '....0fff0', '...0ffff0']),
  crystal: fit(6, ['..00', '.0o90', '.0o90', '0oo990', '0o9990', '0o9n90', '0o99n0', '.0000']),
  crystalS: fit(4, ['.00', '0o90', '0o90', '0990', '.00']),
  rock: fit(10, ['...0000', '.00333300', '0332223330', '0322222230', '0000000000']),
};
function makeBackdrop(kind) {
  const c = document.createElement('canvas');
  c.width = W; c.height = 44;
  const g = c.getContext('2d');
  const px = (col, x, y, w = 1, h = 1) => { g.fillStyle = C[col]; g.fillRect(x, y, w, h); };
  const put = (name, x, y) => g.drawImage(sprite(BG_ART[name], C), x, y);
  // 하늘을 몇 줄의 띠로 (그라데이션 대신 색 단계)
  const bands = (cols, from, to) => { const h = (to - from) / cols.length; cols.forEach((col, i) => px(col, 0, Math.round(from + i * h), W, Math.ceil(h))); };
  if (kind === 0) { // 밤 숲
    bands(['0', 'i', 'i'], 0, 30);
    for (const [x, y] of [[20, 4], [60, 9], [97, 3], [150, 6], [181, 11], [230, 4]]) px('2', x, y);
    // 먼 언덕
    for (let x = 0; x < W; x++) { const hh = 24 + Math.round(Math.sin(x / 19) * 3 + Math.sin(x / 7.3) * 1.5); px('l', x, hh, 1, 44 - hh); }
    for (const [n, x, y] of [['pine', 6, 14], ['tree', 26, 12], ['pine', 52, 16], ['tree', 118, 13], ['pine', 140, 15], ['tree', 172, 11], ['pine', 196, 17], ['tree', 226, 12], ['pine', 244, 15]]) put(n, x, y);
    px('0', 0, 38, W, 1);
    for (let x = 0; x < W; x++) px((x * 7) % 11 < 3 ? 'b' : 'a', x, 39, 1, 5);
    for (const x of [14, 80, 98, 160, 210]) put('bush', x, 34);
  } else if (kind === 1) { // 묘지
    bands(['0', 'm', 'm', 'i'], 0, 32);
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) if (x * x + y * y <= 36) px(x * x + y * y > 25 ? '2' : '1', 206 + x, 11 + y);
    px('2', 203, 9, 2, 2); px('2', 208, 13, 1, 1);
    for (const [x, y] of [[30, 6], [74, 3], [120, 9], [160, 5], [240, 14]]) px('2', x, y);
    for (let x = 0; x < W; x++) { const hh = 30 + Math.round(Math.sin(x / 31) * 2); px('0', x, hh, 1, 44 - hh); }
    for (const [n, x, y] of [['deadtree', 8, 18], ['tomb', 40, 26], ['cross', 64, 23], ['tomb', 90, 28], ['tomb', 132, 25], ['cross', 156, 22], ['deadtree', 178, 16], ['tomb', 220, 27], ['cross', 242, 24]]) put(n, x, y);
    for (let x = 0; x < W; x++) px((x * 5) % 13 < 2 ? 'l' : '0', x, 40, 1, 4);
  } else if (kind === 2) { // 수정 동굴
    px('0', 0, 0, W, 44);
    for (let x = 0; x < W; x++) { const top = 6 + Math.round(Math.sin(x / 11) * 2 + Math.sin(x / 4.1)); px('i', x, top, 1, 34 - top); }
    // 종유석: 길이를 하나씩 정함
    for (const [x, len] of [[6, 10], [21, 6], [33, 14], [47, 8], [70, 12], [88, 5], [101, 15], [126, 7], [139, 11], [158, 6], [171, 13], [190, 9], [207, 6], [221, 14], [240, 8]]) {
      for (let k = 0; k < len; k++) { const w = Math.max(1, 4 - Math.floor((k * 4) / len)); px('0', x - Math.floor(w / 2) - 1, k, w + 2, 1); px('3', x - Math.floor(w / 2), k, w, 1); }
    }
    for (const [x, y] of [[14, 26], [60, 24], [112, 27], [150, 25], [200, 23], [236, 26]]) put('crystal', x, y);
    for (const [x, y] of [[30, 30], [84, 31], [130, 30], [176, 31], [222, 30]]) put('crystalS', x, y);
    for (let x = 0; x < W; x++) px((x * 3) % 7 < 2 ? '3' : '2', x, 34, 1, 1);
    px('3', 0, 35, W, 9);
    for (let x = 0; x < W; x += 6) px('2', x + ((x / 6) % 2) * 3, 37 + ((x / 6) % 3) * 2, 2, 1);
  } else { // 화산
    bands(['q', '4', '4', 'h'], 0, 28);
    for (const [x, y] of [[40, 5], [96, 3], [170, 8], [222, 4]]) { px('6', x, y); px('6', x + 3, y + 6); }
    // 산 둘: 꼭대기를 하나씩 찍음
    const ridge = (cx, peak, half, col) => { for (let x = cx - half; x <= cx + half; x++) { const y = peak + Math.round((Math.abs(x - cx) / half) * (34 - peak)); px(col, x, y, 1, 44 - y); } };
    ridge(64, 8, 64, 'f'); ridge(196, 12, 70, 'f'); ridge(130, 18, 40, '0');
    px('5', 61, 8, 7, 1); px('6', 63, 7, 3, 1); px('5', 63, 9, 3, 6); px('5', 62, 15, 2, 8); px('6', 64, 11, 1, 6);
    for (let x = 0; x < W; x++) px('0', x, 34, 1, 10);
    for (const [x, w] of [[10, 30], [70, 18], [120, 44], [190, 26], [232, 20]]) { px('5', x, 37, w, 3); px('6', x + 3, 38, w - 8, 1); px('7', x + Math.floor(w / 2), 38, 3, 1); }
  }
  return c;
}

export function eightBitRaid(area, { onEnd }) {
  area.innerHTML = '<div class="rd-screen" id="rd-screen"></div>';
  const { cv, ctx, toLocal } = makeScreen(area.querySelector('#rd-screen'), W, H, 768);
  const WHITE = Object.fromEntries(Object.keys(C).map((x) => [x, '#fcfcfc']));
  const spr = Object.fromEntries(KINDS.map((k) => [k.kind, { img: sprite(HEROES[k.kind], C), white: sprite(HEROES[k.kind], WHITE) }]));
  const gear = Object.fromEntries(Object.entries(GEAR).map(([k, v]) => [k, sprite(v, C)]));
  const flipRows = (rows) => rows.map((r) => [...r].reverse().join(''));
  const bossSpr = BOSSES.map((b, i) => {
    const rows = i === 3 ? flipRows(b.rows) : b.rows; // 드래곤은 영웅 쪽(오른쪽)을 보게
    return {
      img: sprite(rows, C),
      white: sprite(rows, WHITE),
      red: sprite(rows, { ...C, 2: '#f87858', 3: '#a81000', 1: '#fca044', b: '#f87858', a: '#a81000', 5: '#fca044', 4: '#f83800' }),
    };
  });
  const backdrops = [0, 1, 2, 3].map(makeBackdrop);

  let st = null; // 진행 중인 판
  let mode = 'idle'; // idle | count | fight | end
  let info = { boss: 0, level: 1, hp: 1, hpMax: 1, practice: true };
  let result = null;

  function reset(opts) {
    info = opts;
    st = {
      t: 0, count: 3000, dmg: 0, shield: 0, enrage: false,
      heroes: KINDS.map((k, i) => ({ ...k, x: SPOTS[i][0], y: SPOTS[i][1], hp: k.max, cdLeft: 1500, atkT: 300 + i * 220, act: 0, actLen: 1, hurt: 0, mark: 0, dodge: 0, dead: false })),
      boss: { next: 2600, tele: null, hitT: 1600, flash: 0, shake: 0, bob: 0, lunge: 0 },
      fx: [], nums: [], arrows: [], drops: [],
    };
  }

  const alive = () => st.heroes.filter((h) => !h.dead);
  const BX = 26, BY = 72; // 보스 그림 왼쪽 위 (64x64)
  const bossLeft = () => info.hp - st.dmg;
  const stepOut = (h, ms) => { h.act = ms; h.actLen = ms; };

  function dealBoss(n, big = false) {
    const crit = Math.random() < 0.12;
    const v = Math.round(n * (crit ? 2 : 1) * (0.9 + Math.random() * 0.2));
    st.dmg += v;
    if (big || crit) {
      st.boss.flash = 120;
      st.nums.push({ v: String(v), x: BX + 20 + Math.random() * 20, y: BY + 20 + Math.random() * 14, t: 0, col: crit ? '7' : '1' });
      if (crit) beep(880, 60, 'square', 0.04);
    }
    st.fx.push({ kind: 'spark', x: BX + 18 + Math.random() * 30, y: BY + 14 + Math.random() * 36, t: 0 });
  }
  function hurtHero(h, n) {
    if (h.dead) return;
    if (h.dodge > 0) { st.nums.push({ v: 'MISS', x: h.x - 10, y: h.y - 26, t: 0, col: '9' }); return; }
    const v = Math.round(n * (st.shield > 0 ? 0.2 : 1) * (st.enrage ? 1.5 : 1));
    h.hp -= v;
    h.hurt = 240;
    st.nums.push({ v: String(v), x: h.x - 8, y: h.y - 26, t: 0, col: '1' });
    if (h.hp <= 0) { h.hp = 0; h.dead = true; beep(140, 300, 'triangle', 0.08, -80); }
  }

  function useSkill(i) {
    if (mode !== 'fight') return;
    const h = st.heroes[i];
    if (!h || h.dead) return;
    if (h.mark > 0) { // 노림 받는 영웅 → 피하기
      h.dodge = 600; h.mark = 0; h.safe = true;
      beep(660, 70, 'square', 0.05, 300);
      return;
    }
    if (h.cdLeft > 0) { beep(110, 50, 'square', 0.03); return; }
    h.cdLeft = h.cd;
    stepOut(h, 420);
    if (h.kind === 'knight') { st.shield = 3000; beep(330, 160, 'square', 0.05, 200); }
    if (h.kind === 'warrior') {
      setTimeout(() => { if (mode !== 'fight') return; dealBoss(3000, true); st.fx.push({ kind: 'cross', x: BX + 32, y: BY + 32, t: 0 }); st.boss.shake = 300; }, 200);
      beep(110, 200, 'sawtooth', 0.08, -60);
    }
    if (h.kind === 'archer') for (let k = 0; k < 8; k++) st.arrows.push({ x: h.x - 12, y: h.y - 14 + (k % 3) * 3 - 3, delay: k * 140, dmg: 400, big: true });
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
    b.lunge = Math.max(0, b.lunge - dt);
    b.bob += dt;
    // 기본 공격: 맨 앞 영웅(대개 기사)
    b.hitT -= dt;
    if (b.hitT <= 0) {
      b.hitT = st.enrage ? 1100 : 1600;
      const front = alive()[0];
      if (front) { hurtHero(front, 35); b.lunge = 200; st.fx.push({ kind: 'claw', x: front.x - 4, y: front.y - 14, t: 0 }); beep(200, 40, 'square', 0.03); }
    }
    if (b.tele) {
      b.tele.t -= dt;
      if (b.tele.t <= 0) {
        const tele = b.tele;
        b.tele = null;
        b.lunge = 300;
        if (tele.kind === 'one') {
          const h = tele.target;
          st.fx.push({ kind: 'impact', x: h.x, y: h.y - 8, t: 0 });
          if (h.safe) st.nums.push({ v: 'MISS', x: h.x - 10, y: h.y - 26, t: 0, col: '9' });
          else hurtHero(h, 240);
          h.mark = 0; h.safe = false;
          beep(90, 180, 'sawtooth', 0.08, -40);
        } else {
          const cols = ATTACKS[info.boss].drop;
          for (let k = 0; k < 24; k++) {
            if (info.boss === 3) st.drops.push({ x: BX + 60, y: BY + 20 + Math.random() * 10, vx: 0.18 + Math.random() * 0.06, vy: (Math.random() - 0.3) * 0.08, delay: k * 18, col: cols[k % 2] });
            else st.drops.push({ x: 170 + Math.random() * 70, y: 52 - Math.random() * 40, vx: 0, vy: 0.14 + Math.random() * 0.06, delay: k * 12, col: cols[k % 2] });
          }
          for (const h of alive()) hurtHero(h, 120);
          b.shake = info.boss === 2 ? 500 : 0;
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
      h.act = Math.max(0, h.act - dt);
      h.hurt = Math.max(0, h.hurt - dt);
      h.dodge = Math.max(0, h.dodge - dt);
      h.mark = Math.max(0, h.mark - dt);
      if (h.dead) continue;
      h.atkT -= dt;
      if (h.atkT <= 0) {
        h.atkT = h.every;
        if (h.act <= 0) stepOut(h, 200);
        if (h.kind === 'archer') st.arrows.push({ x: h.x - 12, y: h.y - 13, delay: 0, dmg: h.dmg });
        else if (h.kind === 'priest') {
          st.fx.push({ kind: 'bolt', x: h.x - 12, y: h.y - 18, t: 0 });
          dealBoss(h.dmg);
          const low = alive().sort((a, b) => a.hp / a.max - b.hp / b.max)[0];
          if (low) low.hp = Math.min(low.max, low.hp + 30);
        } else dealBoss(h.dmg);
      }
    }
    for (const a of st.arrows) {
      if (a.delay > 0) { a.delay -= dt; continue; }
      a.x -= dt * 0.35;
      if (a.x <= BX + 52) { a.done = true; dealBoss(a.dmg, a.big); }
    }
    st.arrows = st.arrows.filter((a) => !a.done);
    for (const d of st.drops) { if (d.delay > 0) { d.delay -= dt; continue; } d.x += d.vx * dt; d.y += d.vy * dt; }
    st.drops = st.drops.filter((d) => d.y < 148 && d.x < W);
    for (const f of st.fx) f.t += dt;
    st.fx = st.fx.filter((f) => f.t < 450);
    for (const n of st.nums) n.t += dt;
    st.nums = st.nums.filter((n) => n.t < 800);
    bossAct(dt);
    const over = st.t >= RUN_MS ? 'TIME UP' : !alive().length ? 'WIPED OUT' : bossLeft() <= 0 ? 'VICTORY' : null;
    if (over) {
      mode = 'end';
      result = { title: over };
      beep(over === 'WIPED OUT' ? 196 : 523, 500, 'triangle', 0.08, over === 'WIPED OUT' ? -100 : 260);
      onEnd?.({ damage: st.dmg, practice: info.practice, reason: over });
    }
  }

  // ---------- 그리기 ----------
  const px = (col, x, y, w = 1, h = 1) => { ctx.fillStyle = C[col] || col; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
  // 파란 바탕 + 흰 테두리 창 (모서리는 한 칸 깎음)
  function win(x, y, w, h, line = '1') {
    px('0', x, y, w, h);
    px('m', x + 2, y + 2, w - 4, h - 4);
    px(line, x + 2, y + 1, w - 4, 1); px(line, x + 2, y + h - 2, w - 4, 1);
    px(line, x + 1, y + 2, 1, h - 4); px(line, x + w - 2, y + 2, 1, h - 4);
  }
  function gauge(x, y, w, v, max, col) {
    px('0', x, y, w, 3);
    px(col, x, y, Math.max(0, Math.round((w * v) / max)), 2);
  }
  function rot(img, x, y, quarter) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate((Math.PI / 2) * quarter);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  function drawHero(h, t) {
    const k = h.act > 0 ? Math.sin((1 - h.act / h.actLen) * Math.PI) : 0;
    const dodge = h.dodge > 0 ? Math.sin((1 - h.dodge / 600) * Math.PI) : 0;
    const sx = Math.round(h.x - 8 - k * (h.actLen > 300 ? 14 : 6) + dodge * 12), sy = Math.round(h.y - 22 - dodge * 8);
    if (h.dead) { // 쓰러짐: 옆으로 누운 그림
      rot(spr[h.kind].img, h.x + 12, h.y - 15, 1);
      return;
    }
    px('0', h.x - 7, h.y - 1, 14, 2);
    const flash = h.hurt > 0 && Math.floor(t / 60) % 2;
    ctx.drawImage(flash ? spr[h.kind].white : spr[h.kind].img, sx, sy);
    const swing = h.act > 0;
    if (h.kind === 'warrior') {
      if (swing) rot(gear.sword, sx + 5, sy + 13, 3); // 앞으로 휘두름
      else ctx.drawImage(gear.sword, sx + 1, sy - 3);
    }
    if (h.kind === 'archer') ctx.drawImage(gear.bow, sx - 1 - (swing ? 1 : 0), sy + 7);
    if (h.kind === 'priest') {
      ctx.drawImage(gear.staff, sx + 1, sy - (swing ? 4 : 1));
      if (swing && Math.floor(t / 60) % 2) { px('1', sx + 3, sy - 3 - (swing ? 4 : 1) + 4, 1, 1); px('g', sx, sy - 2, 1, 1); px('g', sx + 6, sy - 2, 1, 1); }
    }
    if (h.mark > 0) { // 노리는 표시: 손가락
      const bl = Math.floor(t / 120) % 2;
      ctx.drawImage(gear.hand, sx - 12 - bl, sy + 6);
    }
  }

  function drawField(t) {
    px('0', 0, 0, W, H);
    ctx.drawImage(backdrops[info.boss], 0, 6);
    px('0', 0, 50, W, 1);
    if (!st) {
      const bs = bossSpr[info.boss];
      px('0', BX + 10, BY + 62, 44, 3);
      ctx.drawImage(bs.img, BX, BY, 64, 64);
      KINDS.forEach((k, i) => drawHero({ ...k, x: SPOTS[i][0], y: SPOTS[i][1], act: 0, actLen: 1, dodge: 0, hurt: 0, mark: 0, dead: false }, t));
      return;
    }
    const b = st.boss;
    const shake = b.shake > 0 ? (Math.floor(t / 40) % 2 ? 2 : -2) : 0;
    const lunge = b.lunge > 0 ? Math.round(Math.sin((b.lunge / 300) * Math.PI) * 6) : 0;
    const bs = bossSpr[info.boss];
    const tele = b.tele && Math.floor(t / 110) % 2;
    px('0', BX + 10, BY + 62, 44, 3);
    ctx.drawImage(b.flash > 0 && Math.floor(t / 40) % 2 ? bs.white : tele || (st.enrage && Math.floor(t / 400) % 2) ? bs.red : bs.img, BX + shake + lunge, BY, 64, 64);
    for (const h of st.heroes) drawHero(h, t);
    for (const a of st.arrows) if (a.delay <= 0) ctx.drawImage(gear.arrow, Math.round(a.x), Math.round(a.y));
    for (const d of st.drops) if (d.delay <= 0 && d.y > 52) { px('0', d.x - 1, d.y - 1, 4, 4); px(d.col, d.x, d.y, 2, 2); }
    for (const f of st.fx) {
      const k = f.t / 450;
      if (f.kind === 'spark' && f.t < 150) { px('1', f.x - 2, f.y, 5, 1); px('1', f.x, f.y - 2, 1, 5); }
      if (f.kind === 'claw' && f.t < 250) for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) px('1', f.x - 4 + i * 4 + j, f.y - 4 + j * 2, 1, 1);
      if (f.kind === 'cross' && f.t < 300) for (let j = -14; j <= 14; j++) { px('1', f.x + j, f.y + j, 2, 2); px('1', f.x + j, f.y - j, 2, 2); }
      if (f.kind === 'impact') for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; px('7', f.x + Math.cos(a) * k * 16, f.y + Math.sin(a) * k * 10, 2, 2); }
      if (f.kind === 'heal') for (let i = 0; i < 4; i++) { const y = f.y - 30 + k * 26 + (i % 2) * 6; px(i % 2 ? 'b' : '1', f.x - 8 + i * 5, y, 1, 3); px(i % 2 ? 'b' : '1', f.x - 9 + i * 5, y + 1, 3, 1); }
      if (f.kind === 'bolt' && f.t < 300) { const x = f.x + (BX + 40 - f.x) * (f.t / 300); px('0', x - 1, f.y - 1, 5, 5); px('g', x, f.y, 3, 3); px('1', x + 1, f.y + 1, 1, 1); }
    }
    if (st.shield > 0 && Math.floor(t / 90) % 3) for (const h of alive()) for (let y = 0; y < 20; y += 2) px('9', h.x - 13, h.y - 22 + y, 1, 1);
    for (const n of st.nums) { // 튀어 오르는 숫자
      const up = n.t < 300 ? Math.sin((n.t / 300) * Math.PI) * 8 : 0;
      text(ctx, n.v, Math.round(n.x), Math.round(n.y - up), C[n.col], C[0]);
    }
    if (b.tele) { // 기술 이름 창
      const w = b.tele.name.length * 6 + 14;
      win(Math.round(W / 2 - w / 2), 54, w, 15);
      text(ctx, b.tele.name, Math.round(W / 2 - w / 2) + 7, 58, C[1], null);
    }
  }

  function drawWindows(t) {
    // 왼쪽: 보스
    win(0, 151, 98, 73);
    const nm = BOSSES[info.boss].name;
    text(ctx, nm.length > 14 ? nm.slice(0, 14) : nm, 8, 158, C[1], null);
    const hp = st ? Math.max(0, bossLeft()) : info.hp;
    gauge(8, 169, 82, hp, info.hpMax, st?.enrage ? '5' : 'd');
    text(ctx, info.practice ? 'PRACTICE' : `LV ${info.level}`, 8, 177, C[info.practice ? '9' : '2'], null);
    const left = st ? Math.max(0, Math.ceil((RUN_MS - st.t) / 1000)) : 60;
    text(ctx, 'TIME', 8, 192, C[2], null);
    text(ctx, String(left).padStart(2, '0'), 78, 192, C[left <= 10 && mode === 'fight' ? '5' : '1'], null);
    text(ctx, 'DMG', 8, 204, C[2], null);
    const d = String(st ? st.dmg : 0);
    text(ctx, d, 90 - d.length * 6, 204, C[7], null);
    if (st?.enrage) text(ctx, 'RAGE', 62, 177, C[Math.floor(t / 250) % 2 ? '5' : '6'], null);
    // 오른쪽: 영웅들
    win(98, 151, 158, 73);
    KINDS.forEach((k, i) => {
      const h = st?.heroes[i] || { ...k, hp: k.max, cdLeft: 0, mark: 0, dead: false };
      const y = 157 + i * 16;
      const marked = h.mark > 0 && !h.dead;
      const bl = Math.floor(t / 110) % 2;
      if (marked) ctx.drawImage(gear.hand, 100, y - 1 + bl);
      text(ctx, String(i + 1), 110, y, C[marked ? '7' : '3'], null);
      text(ctx, k.name, 120, y, C[h.dead ? '5' : '1'], null);
      const hs = String(h.hp);
      text(ctx, hs, 190 - hs.length * 6, y, C[h.dead ? '5' : h.hp / k.max < 0.3 ? '6' : '1'], null);
      gauge(120, y + 9, 70, h.hp, k.max, h.hp / k.max < 0.3 ? '6' : 'b');
      let label = k.skill, col = '1';
      if (h.dead) { label = 'KO'; col = '5'; } else if (marked) { label = 'DODGE'; col = bl ? '5' : '7'; } else if (h.cdLeft > 0) col = '3';
      text(ctx, label, 200, y, C[col], null);
      if (!h.dead && !marked) gauge(200, y + 9, 46, k.cd - h.cdLeft, k.cd, h.cdLeft > 0 ? '3' : '9');
    });
  }

  function drawOverlay(t) {
    if (mode === 'idle' && Math.floor(t / 500) % 2) {
      win(92, 92, 72, 17);
      text(ctx, 'START', 113, 97, C[1], null);
    }
    if (mode === 'count') {
      const n = Math.ceil(st.count / 1000);
      win(108, 88, 40, 19);
      center(ctx, n > 0 ? String(n) : 'GO', 94, W, C[1], null);
    }
    if (mode === 'end' && result) {
      win(56, 70, 144, 62);
      center(ctx, result.title, 78, W, C[result.title === 'WIPED OUT' ? '5' : '7'], null);
      center(ctx, 'DAMAGE', 94, W, C[2], null);
      center(ctx, String(st.dmg), 104, W, C[1], null);
      center(ctx, info.practice ? 'NOT SAVED' : result.saved || 'SAVING', 118, W, C[info.practice ? '9' : 'b'], null);
    }
  }

  function draw(t) {
    drawField(t);
    drawWindows(t);
    drawOverlay(t);
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
    if (y >= 151 && x >= 98) { useSkill(Math.max(0, Math.min(3, Math.floor((y - 155) / 16)))); return; }
    // 영웅을 직접 눌러도 됨
    const h = st?.heroes.find((o) => Math.abs(o.x - x) < 12 && y > o.y - 26 && y < o.y + 4);
    if (h) useSkill(st.heroes.indexOf(h));
  });

  const stop = loop((dt) => { step(dt); draw(performance.now()); });
  // 테스트용 (주소에 ?debug 가 있을 때만)
  const ctl = {
    // opts: { boss, level, hp, hpMax, practice }
    start(opts) { reset(opts); result = null; mode = 'count'; try { audio?.resume(); } catch { /* */ } },
    setInfo(opts) { if (mode === 'idle' || mode === 'end') { info = { ...info, ...opts }; if (mode === 'idle') st = null; } },
    saved(textLine) { if (result) result.saved = textLine; },
    get busy() { return mode === 'count' || mode === 'fight'; },
    stop() { stop(); document.removeEventListener('keydown', onKey); },
  };
  if (location.search.includes('debug')) window.__raid = { get st() { return st; }, get mode() { return mode; }, ctl };
  return ctl;
}
