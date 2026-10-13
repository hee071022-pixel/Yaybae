// 버블 계열 레트로 아케이드 미니게임 2개. 저해상도 픽셀 화면을 그대로 키워서 보여준다.
// 보상 없음, 점수만 순위에 올라간다.

// ---------- 픽셀 도구 ----------
function makeScreen(area, w, h, maxWidth) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.className = 'arc-canvas';
  cv.style.aspectRatio = `${w} / ${h}`;
  cv.style.maxWidth = `${maxWidth}px`;
  area.appendChild(cv);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const toLocal = (e) => {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h];
  };
  return { cv, ctx, toLocal };
}

// 문자열 그림 → 캔버스 (. 은 투명)
function sprite(rows, pal) {
  const c = document.createElement('canvas');
  c.width = rows[0].length;
  c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.' || !pal[ch]) return;
    g.fillStyle = pal[ch];
    g.fillRect(x, y, 1, 1);
  }));
  return c;
}

// 이 기기에서의 최고 점수 (화면 HI 표시용)
function readHi(key) {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}

function loop(step) {
  let raf = 0;
  let last = performance.now();
  let running = true;
  const tick = (now) => {
    if (!running) return;
    step(Math.min(now - last, 40));
    last = now;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { running = false; cancelAnimationFrame(raf); };
}

// 5x7 비트맵 글꼴
const FONT = {
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'], 1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'], 3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'], 5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'], 7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'], 9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'], D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'], F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'], H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'], J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'], L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'], N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'], R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'], T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'], X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'], Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'], ':': ['.....', '..#..', '.....', '.....', '.....', '..#..', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'], ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};
const glyphCache = new Map();
function text(ctx, str, x, y, color = '#fff', shadow = '#000') {
  const draw = (col, dx, dy) => {
    let cx = x + dx;
    for (const ch of String(str).toUpperCase()) {
      const key = `${ch}${col}`;
      if (!glyphCache.has(key)) glyphCache.set(key, sprite((FONT[ch] || FONT[' ']).map((r) => r.replace(/#/g, 'a')), { a: col }));
      ctx.drawImage(glyphCache.get(key), cx, y + dy);
      cx += 6;
    }
  };
  if (shadow) draw(shadow, 1, 1);
  draw(color, 0, 0);
}
const textW = (str) => String(str).length * 6 - 1;
const center = (ctx, str, y, w, color, shadow) => text(ctx, str, Math.round((w - textW(str)) / 2), y, color, shadow);
const pad = (n, len = 6) => String(Math.min(n, 999999)).padStart(len, '0');

// 동그란 방울 그림 (색 + 그늘 + 반짝임)
function ballSprite(base, dark, light) {
  const rows = [];
  for (let y = 0; y < 16; y++) {
    let row = '';
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5, d = Math.hypot(dx, dy);
      if (d > 7.6) row += '.';
      else if (d > 6.6) row += 'o';
      else if ((x === 4 || x === 5) && (y === 4 || y === 5)) row += 'w';
      else if (x === 6 && y === 4) row += 'w';
      else if (dx + dy > 5) row += 'd';
      else if (dx + dy < -6) row += 'l';
      else row += 'b';
    }
    rows.push(row);
  }
  return sprite(rows, { o: '#101018', b: base, d: dark, l: light, w: '#ffffff' });
}

// ---------- 그림들 ----------
const DRAGON_A = [
  '.....DDDDD......', '....DGGGGGD.....', '...DGGGGWWWD....', '..YDGGGGWKKWD...', '..YDGGGGWKKWD...', '.YYDGGGGGWWGD...',
  '.YDGGGGGGGGGGD..', 'YYDGGGGGGGGDD...', '.YDGGWWWWGGD....', '..DGWWWWWWGD....', '..DGWWWWWWGGD...', '..DGGWWWWGGGD...',
  '...DGGGGGGGD....', '....DOOD.DOOD...', '...DOOOD.DOOOD..', '....DDD...DDD...',
];
const DRAGON_B = [...DRAGON_A.slice(0, 13), '...DOOD..DOOD...', '..DOOOD...DOOOD.', '...DDD.....DDD..'];
const DRAGON_SHOOT = [
  '.....DDDDD......', '....DGGGGGD.....', '...DGGGGWWWD....', '..YDGGGGWKKWD...', '..YDGGGGWKKWD...', '.YYDGGGGGWWGDD..',
  '.YDGGGGGGGGGRRD.', 'YYDGGGGGGGGDRRD.', '.YDGGWWWWGGDDD..', '..DGWWWWWWGD....', '..DGWWWWWWGGD...', '..DGGWWWWGGGD...',
  '...DGGGGGGGD....', '....DOOD.DOOD...', '...DOOOD.DOOOD..', '....DDD...DDD...',
];
const DRAGON_PAL = { D: '#0b3d0b', G: '#3ec43e', W: '#f4f4e8', K: '#101010', Y: '#f8c820', O: '#f87800', R: '#e83030' };
const ROBOT_A = [
  '.......DD.......', '......DGGD......', '.......DD.......', '....DDDDDDDD....', '...DWWWWWWWWD...', '..DWWWWWWWWWWD..',
  '..DWKKWWWWKKWD..', '..DWKKWWWWKKWD..', '..DWWWWWWWWWWD..', '..DBBBBBBBBBBD..', '..DWWWWWWWWWWD..', '...DWWWWWWWWD...',
  '....DDDDDDDD....', '....DOD..DOD....', '...DOOD..DOOD...', '....DD....DD....',
];
const ROBOT_B = [...ROBOT_A.slice(0, 13), '...DOD....DOD...', '..DOOD....DOOD..', '...DD......DD...'];
const ROBOT_PAL = { D: '#1a1a40', W: '#e8e8f8', K: '#2040c0', B: '#4878f8', O: '#f8a020', G: '#a0a0a0' };
const ANGRY_PAL = { D: '#401010', W: '#f87070', K: '#ffffff', B: '#c02020', O: '#f8d020', G: '#a0a0a0' };
const CHERRY = [
  '........DD......', '.......DGD......', '......DG.D......', '.....DG...D.....', '....DG.....D....', '...DG.......D...',
  '..RRRR....RRRR..', '.RRWRRR..RRWRRR.', '.RWRRRR..RWRRRR.', '.RRRRRR..RRRRRR.', '.RRRRRR..RRRRRR.', '..RRRR....RRRR..',
];
const BANANA = [
  '............DD..', '...........DYD..', '..........DYYD..', '.........DYYYD..', '........DYYYD...', '......DDYYYYD...',
  '..DDDDYYYYYD....', '.DYYYYYYYYD.....', '..DDYYYYDD......', '....DDDD........',
];
const FRUIT_PAL = { D: '#3a2000', G: '#30a030', R: '#e02040', W: '#ffd0d8', Y: '#f8e040' };
const HEART = ['.DD.DD.', 'DRRDRRD', 'DRRRRRD', '.DRRRD.', '..DRD..', '...D...'];

// ======================= 버블 슈터 =======================
const SHOOT_COLORS = [
  ['#e83838', '#901818', '#ff9090'], ['#3878f8', '#183890', '#90b8ff'], ['#f8d020', '#a07800', '#fff090'],
  ['#38c838', '#187818', '#a0f0a0'], ['#b048e8', '#602090', '#e0a8ff'], ['#f88828', '#a04808', '#ffc890'],
];

export function bubbleShooter(area, finish) {
  const W = 160, H = 240, R = 8, COLS = 8, X0 = 16, RH = 14, LOSE_Y = 196, SX = 80, SY = 214;
  area.innerHTML = '<p class="muted small center" style="margin:0 0 8px">조준하고 눌러서 쏘기 · PC는 ← → 조준, 스페이스 발사</p>';
  const { cv, ctx, toLocal } = makeScreen(area, W, H, 360);
  const balls = SHOOT_COLORS.map((c) => ballSprite(...c));
  const dragon = sprite(DRAGON_A, DRAGON_PAL);
  const dragonB = sprite(DRAGON_B, DRAGON_PAL);
  let grid = [];
  let parity = 0;
  let drop = 0; // 천장이 내려온 줄 수
  let score = 0;
  let hi = readHi('arc.bubble.hi');
  let shots = 0;
  let over = false;
  let ready = 1200;
  let aim = -Math.PI / 2;
  let flying = null;
  let pops = [];
  let t = 0;
  const off = (i) => (((i + parity) % 2) ? R : 0);
  const cols = (i) => (off(i) ? COLS - 1 : COLS);
  const pos = (i, j) => [X0 + j * 2 * R + R + off(i), 24 + drop * RH + i * RH + R];
  const rnd = (n) => Math.floor(Math.random() * n);
  const startColors = 4;
  const newRow = (n = startColors + Math.min(2, Math.floor(shots / 40))) => Array.from({ length: COLS }, () => rnd(n));
  for (let i = 0; i < 5; i++) grid.push(newRow());
  const present = () => {
    const set = new Set();
    grid.forEach((row, i) => row.forEach((c, j) => { if (c != null && j < cols(i)) set.add(c); }));
    return set.size ? [...set] : [0, 1, 2, 3];
  };
  const pick = () => { const p = present(); return p[rnd(p.length)]; };
  let cur = pick();
  let next = pick();
  const get = (i, j) => (i >= 0 && i < grid.length && j >= 0 && j < cols(i) ? grid[i][j] : null);
  const near = (i, j) => {
    const o = off(i) ? 0 : -1;
    return [[i, j - 1], [i, j + 1], [i - 1, j + o], [i - 1, j + o + 1], [i + 1, j + o], [i + 1, j + o + 1]];
  };

  function place(x, y) {
    let best = null;
    const iGuess = Math.max(0, Math.round((y - R - 24 - drop * RH) / RH));
    for (let i = Math.max(0, iGuess - 1); i <= iGuess + 1; i++) {
      while (grid.length <= i) grid.push(Array(COLS).fill(null));
      for (let j = 0; j < cols(i); j++) {
        if (grid[i][j] != null) continue;
        const [px, py] = pos(i, j);
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    if (!best) return;
    grid[best.i][best.j] = cur;
    const seen = new Set([`${best.i},${best.j}`]);
    const group = [[best.i, best.j]];
    for (let k = 0; k < group.length; k++) {
      for (const [a, b] of near(...group[k])) {
        if (get(a, b) === cur && !seen.has(`${a},${b}`)) { seen.add(`${a},${b}`); group.push([a, b]); }
      }
    }
    if (group.length >= 3) {
      group.forEach(([a, b]) => { pops.push({ x: pos(a, b)[0], y: pos(a, b)[1], c: grid[a][b], t: 0 }); grid[a][b] = null; });
      score += group.length * 10;
      const hold = new Set();
      const q = [];
      (grid[0] || []).forEach((c, j) => { if (c != null && j < cols(0)) { hold.add(`0,${j}`); q.push([0, j]); } });
      for (let k = 0; k < q.length; k++) {
        for (const [a, b] of near(...q[k])) {
          if (get(a, b) != null && !hold.has(`${a},${b}`)) { hold.add(`${a},${b}`); q.push([a, b]); }
        }
      }
      let fell = 0;
      grid.forEach((row, i) => row.forEach((c, j) => {
        if (c != null && !hold.has(`${i},${j}`)) { pops.push({ x: pos(i, j)[0], y: pos(i, j)[1], c, t: 0, fall: true, vy: -0.05 }); grid[i][j] = null; fell++; }
      }));
      // 떨어뜨린 개수만큼 2배씩 (2개 20, 3개 40, 4개 80…)
      if (fell) score += 10 * 2 ** Math.min(fell, 12);
    }
    while (grid.length && grid[grid.length - 1].every((c) => c == null)) grid.pop();
    shots++;
    if (shots % 8 === 0) drop++;
    if (grid.every((row) => row.every((c) => c == null))) {
      score += 1000;
      drop = 0;
      for (let i = 0; i < 5; i++) grid.push(newRow());
      ready = 1200;
    }
    if (grid.some((row, i) => row.some((c, j) => c != null && j < cols(i) && pos(i, j)[1] + R > LOSE_Y))) end();
    cur = next;
    next = pick();
  }

  function end() {
    if (over) return;
    over = true;
    if (score > hi) { hi = score; try { localStorage.setItem('arc.bubble.hi', String(hi)); } catch { /* 없어도 됨 */ } }
    finish(score);
  }

  const clampAim = (a) => Math.max(-Math.PI + 0.2, Math.min(-0.2, a));
  const shoot = () => {
    if (over || flying || ready > 0) return;
    flying = { x: SX, y: SY, vx: Math.cos(aim) * 0.22, vy: Math.sin(aim) * 0.22, c: cur };
  };
  const setAim = (e) => {
    const [x, y] = toLocal(e);
    aim = clampAim(Math.atan2(Math.min(y, SY - 8) - SY, x - SX));
  };
  cv.addEventListener('pointermove', setAim);
  cv.addEventListener('pointerdown', setAim);
  cv.addEventListener('pointerup', (e) => { setAim(e); shoot(); });
  const held = { l: false, r: false };
  const onKey = (down) => (e) => {
    if (!area.isConnected || area.closest('.hidden')) return;
    if (e.key === 'ArrowLeft') held.l = down;
    else if (e.key === 'ArrowRight') held.r = down;
    else if ((e.key === ' ' || e.key === 'ArrowUp') && down) shoot();
    else return;
    e.preventDefault();
  };
  const kd = onKey(true);
  const ku = onKey(false);
  document.addEventListener('keydown', kd);
  document.addEventListener('keyup', ku);

  const drawBall = (c, x, y) => ctx.drawImage(balls[c], Math.round(x - R), Math.round(y - R));

  const stop = loop((dt) => {
    t += dt;
    if (ready > 0) ready -= dt;
    if (held.l) aim = clampAim(aim - 0.0025 * dt);
    if (held.r) aim = clampAim(aim + 0.0025 * dt);
    if (flying) {
      for (let k = 0; k < 4 && flying; k++) {
        flying.x += (flying.vx * dt) / 4;
        flying.y += (flying.vy * dt) / 4;
        if (flying.x < X0 + R) { flying.x = X0 + R; flying.vx *= -1; }
        if (flying.x > W - X0 - R) { flying.x = W - X0 - R; flying.vx *= -1; }
        let hit = flying.y <= 24 + drop * RH + R;
        if (!hit) {
          grid.forEach((row, i) => row.forEach((c, j) => {
            if (!hit && c != null && j < cols(i)) {
              const [px, py] = pos(i, j);
              if ((px - flying.x) ** 2 + (py - flying.y) ** 2 < (2 * R - 3) ** 2) hit = true;
            }
          }));
        }
        if (hit) { place(flying.x, flying.y); flying = null; }
      }
    }

    // 배경 + 벽돌 벽
    ctx.fillStyle = '#081028';
    ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 8) {
      for (let x = 0; x < W; x += 16) {
        if (x >= X0 && x < W - X0 && y >= 16) continue;
        const ox = (y / 8) % 2 ? 8 : 0;
        ctx.fillStyle = '#7038a8';
        ctx.fillRect(x - ox, y, 15, 7);
        ctx.fillStyle = '#9858d0';
        ctx.fillRect(x - ox, y, 15, 1);
      }
    }
    // 천장판 + 사슬
    const ceil = 16 + drop * RH;
    ctx.fillStyle = '#585868';
    for (let y = 16; y < ceil; y += 4) { ctx.fillRect(X0 + 20, y, 2, 3); ctx.fillRect(W - X0 - 22, y, 2, 3); }
    ctx.fillStyle = '#a8a8b8';
    ctx.fillRect(X0, ceil, W - 2 * X0, 8);
    ctx.fillStyle = '#d8d8e8';
    ctx.fillRect(X0, ceil, W - 2 * X0, 1);
    ctx.fillStyle = '#686878';
    ctx.fillRect(X0, ceil + 7, W - 2 * X0, 1);
    // 위험선
    ctx.fillStyle = '#e83838';
    for (let x = X0; x < W - X0; x += 6) ctx.fillRect(x, LOSE_Y, 3, 1);

    grid.forEach((row, i) => row.forEach((c, j) => { if (c != null && j < cols(i)) drawBall(c, ...pos(i, j)); }));
    pops = pops.filter((p) => {
      p.t += dt;
      if (p.fall) { p.vy += 0.0008 * dt; p.y += p.vy * dt; drawBall(p.c, p.x, p.y); return p.y < H + 10; }
      // 터지는 별 모양
      const r = Math.round(p.t / 30);
      ctx.fillStyle = SHOOT_COLORS[p.c][2];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
        ctx.fillRect(Math.round(p.x + dx * (4 + r)), Math.round(p.y + dy * (4 + r)), 2, 2);
      }
      return p.t < 240;
    });

    // 발사대: 톱니 받침 + 화살표
    ctx.fillStyle = '#404050';
    ctx.fillRect(SX - 14, SY + 4, 28, 10);
    ctx.fillStyle = '#787890';
    ctx.fillRect(SX - 12, SY + 4, 24, 2);
    if (!over) {
      ctx.fillStyle = '#f8f8f8';
      for (let k = 6; k < 30; k += 2) ctx.fillRect(Math.round(SX + Math.cos(aim) * k) - 1, Math.round(SY + Math.sin(aim) * k) - 1, 2, 2);
      ctx.fillStyle = '#f8d020';
      ctx.fillRect(Math.round(SX + Math.cos(aim) * 31) - 2, Math.round(SY + Math.sin(aim) * 31) - 2, 4, 4);
    }
    if (flying) drawBall(flying.c, flying.x, flying.y);
    else if (!over) drawBall(cur, SX, SY);
    // 다음 방울 + 공룡
    drawBall(next, 34, 226);
    text(ctx, 'NEXT', 21, 208, '#f8f8f8');
    ctx.drawImage(Math.floor(t / 300) % 2 ? dragon : dragonB, 112, 216);

    // 위쪽 점수
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, 16);
    text(ctx, `SC ${pad(score)}`, 4, 5, '#f8f8f8');
    text(ctx, `HI ${pad(Math.max(hi, score))}`, 84, 5, '#f8d020');
    if (ready > 0 && !over) { center(ctx, 'READY', 110, W, '#f8f8f8'); center(ctx, 'GO!', 122, W, Math.floor(t / 150) % 2 ? '#f8d020' : '#f87800'); }
    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(0, 0, W, H);
      center(ctx, 'GAME OVER', 104, W, '#e83838');
      center(ctx, pad(score), 118, W, '#f8f8f8');
    }
  });
  return () => { stop(); document.removeEventListener('keydown', kd); document.removeEventListener('keyup', ku); };
}

// ======================= 버블 점프 =======================
const TS = 8, GW = 32, GH = 26, TOP = 16;
const ROUNDS = [
  { plat: [[20, 4, 11], [20, 20, 27], [15, 8, 23], [10, 4, 11], [10, 20, 27], [5, 10, 21]], brick: ['#e86890', '#ffa8c0', '#902848'] },
  { plat: [[21, 2, 9], [21, 22, 29], [17, 10, 21], [13, 2, 9], [13, 22, 29], [9, 10, 21], [5, 4, 27]], brick: ['#4890e8', '#a0d0ff', '#183878'] },
  { plat: [[20, 6, 25], [16, 2, 8], [16, 23, 29], [12, 9, 22], [8, 2, 8], [8, 23, 29], [4, 11, 20]], brick: ['#e89030', '#ffd090', '#804008'] },
  { plat: [[21, 2, 6], [21, 25, 29], [18, 9, 22], [15, 2, 6], [15, 25, 29], [12, 9, 22], [9, 2, 6], [9, 25, 29], [6, 9, 22]], brick: ['#40b860', '#a0f0b0', '#106028'] },
];

export function bubbleJump(area, finish) {
  const W = GW * TS, H = TOP + GH * TS;
  area.innerHTML = '';
  const { cv, ctx } = makeScreen(area, W, H, 560);
  area.insertAdjacentHTML('beforeend', `<div class="arc-pad">
    <button type="button" data-k="left" aria-label="왼쪽">◀</button><button type="button" data-k="right" aria-label="오른쪽">▶</button>
    <span></span><button type="button" data-k="jump">점프</button><button type="button" data-k="shoot">버블</button></div>
    <p class="muted small center" style="margin:6px 0 0">PC: ← → 이동 · ↑ 또는 스페이스 점프 · X 또는 Z 버블</p>`);
  const spr = {
    dA: sprite(DRAGON_A, DRAGON_PAL), dB: sprite(DRAGON_B, DRAGON_PAL), dS: sprite(DRAGON_SHOOT, DRAGON_PAL),
    rA: sprite(ROBOT_A, ROBOT_PAL), rB: sprite(ROBOT_B, ROBOT_PAL), aA: sprite(ROBOT_A, ANGRY_PAL), aB: sprite(ROBOT_B, ANGRY_PAL),
    cherry: sprite(CHERRY, FRUIT_PAL), banana: sprite(BANANA, FRUIT_PAL), heart: sprite(HEART, { D: '#300', R: '#f83050' }),
  };
  // 방울: 투명한 고리 + 반짝임
  const bubbleImg = (() => {
    const rows = [];
    for (let y = 0; y < 16; y++) {
      let row = '';
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        if (d > 7.6) row += '.';
        else if (d > 6.4) row += 'o';
        else if ((x === 4 && (y === 4 || y === 5)) || (x === 5 && y === 4)) row += 'w';
        else row += 'f';
      }
      rows.push(row);
    }
    return { normal: sprite(rows, { o: '#58e8f8', w: '#ffffff', f: 'rgba(88,232,248,.18)' }), warn: sprite(rows, { o: '#f85858', w: '#ffffff', f: 'rgba(248,88,88,.2)' }) };
  })();

  const keys = { left: false, right: false, jump: false, shoot: false };
  let solid;
  let round = 0;
  let score = 0;
  let hi = readHi('arc.jump.hi');
  let lives = 3;
  let started = false;
  let over = false;
  let intro = 0;
  let clearT = 0;
  let t = 0;
  const p = { x: 24, y: 0, w: 12, h: 15, vx: 0, vy: 0, dir: 1, ground: false, inv: 0, cool: 0, shootT: 0 };
  let enemies = [];
  let bubbles = [];
  let fruits = [];
  let floats = [];

  function loadRound() {
    const r = ROUNDS[round % ROUNDS.length];
    solid = Array.from({ length: GH }, (_, y) => Array.from({ length: GW }, (_, x) => y === 0 || y === GH - 1 || x < 2 || x >= GW - 2));
    for (const [y, a, b] of r.plat) for (let x = a; x <= b; x++) solid[y][x] = true;
    Object.assign(p, { x: 24, y: TOP + (GH - 1) * TS - 15, vx: 0, vy: 0, dir: 1, inv: 1500 });
    bubbles = [];
    fruits = [];
    const n = Math.min(3 + round, 8);
    enemies = Array.from({ length: n }, (_, i) => ({
      x: 70 + ((i * 53) % 130), y: TOP + 12 + (i % 2) * 10, w: 13, h: 14, vx: (i % 2 ? 1 : -1), vy: 0, ground: false, angry: false, jumpT: 1500 + Math.random() * 2000,
    }));
    intro = 1800;
  }

  const solidAt = (px, py) => {
    const c = Math.floor(px / TS);
    const r = Math.floor((py - TOP) / TS);
    return r >= 0 && r < GH && c >= 0 && c < GW && solid[r][c];
  };
  // 아래로 떨어질 때만 발판에 서고, 밑에서는 뚫고 올라감
  function physics(o, dt, speed) {
    o.vy = Math.min(o.vy + 0.00085 * dt, 0.2);
    const prevBottom = o.y + o.h;
    o.y += o.vy * dt;
    o.ground = false;
    if (o.vy >= 0) {
      const bottom = o.y + o.h;
      const top = Math.floor((bottom - TOP) / TS) * TS + TOP;
      if (prevBottom <= top + 1 && bottom >= top && (solidAt(o.x + 1, top + 1) || solidAt(o.x + o.w - 1, top + 1))) {
        o.y = top - o.h;
        o.vy = 0;
        o.ground = true;
      }
    }
    if (o.y < TOP + TS) { o.y = TOP + TS; o.vy = Math.max(o.vy, 0); }
    o.x += (speed ?? o.vx) * dt;
    const minX = 2 * TS, maxX = W - 2 * TS - o.w;
    if (o.x < minX) { o.x = minX; if (o !== p) o.vx = 1; }
    if (o.x > maxX) { o.x = maxX; if (o !== p) o.vx = -1; }
  }
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const addScore = (n, x, y) => { score += n; floats.push({ x, y, s: String(n), t: 0 }); };

  function lose() {
    lives--;
    if (lives <= 0) {
      over = true;
      if (score > hi) { hi = score; try { localStorage.setItem('arc.jump.hi', String(hi)); } catch { /* 없어도 됨 */ } }
      finish(score);
      return;
    }
    Object.assign(p, { x: 24, y: TOP + (GH - 1) * TS - 15, vx: 0, vy: 0, inv: 2200 });
  }

  function update(dt) {
    if (intro > 0) { intro -= dt; return; }
    if (clearT > 0) {
      clearT -= dt;
      if (clearT <= 0) { round++; loadRound(); }
    }
    const speed = (keys.right ? 0.07 : 0) - (keys.left ? 0.07 : 0);
    if (speed) p.dir = Math.sign(speed);
    if (keys.jump) { if (p.ground) p.vy = -0.3; keys.jump = false; }
    physics(p, dt, speed);
    p.vx = speed;
    p.inv = Math.max(0, p.inv - dt);
    p.cool = Math.max(0, p.cool - dt);
    p.shootT = Math.max(0, p.shootT - dt);
    if (keys.shoot) {
      if (!p.cool) {
        bubbles.push({ x: p.x + (p.dir > 0 ? 8 : -12), y: p.y - 1, w: 14, h: 14, dir: p.dir, dist: 0, t: 0, enemy: null });
        p.cool = 300;
        p.shootT = 160;
      }
      keys.shoot = false;
    }
    for (const e of enemies) {
      const sp = (e.angry ? 0.05 : 0.028) * Math.sign(e.vx || 1);
      e.jumpT -= dt;
      if (e.ground && e.jumpT <= 0) { if (p.y < e.y - 8 && Math.random() < 0.7) e.vy = -0.28; e.jumpT = 1400 + Math.random() * 2400; }
      // 발판 끝에 오면 한 번만 정함: 떨어지거나 돌아서기 (플레이어가 아래에 있으면 더 자주 내려감)
      const edge = e.ground && !solidAt(e.x + (sp > 0 ? e.w + 2 : -2), e.y + e.h + 2);
      if (edge && !e.atEdge) {
        e.atEdge = true;
        if (Math.random() > (p.y > e.y + 8 ? 0.75 : 0.35)) e.vx = -Math.sign(e.vx || 1);
      }
      if (!edge) e.atEdge = false;
      physics(e, dt, (e.angry ? 0.05 : 0.028) * Math.sign(e.vx || 1));
      if (!p.inv && !clearT && hit(p, e)) lose();
    }
    for (const b of bubbles) {
      b.t += dt;
      if (b.dist < 56 && !b.enemy) {
        const d = 0.17 * dt;
        b.x += b.dir * d;
        b.dist += d;
        if (b.x < 2 * TS || b.x + b.w > W - 2 * TS) b.dist = 999;
        const e = enemies.find((x) => hit(b, x));
        if (e) { b.enemy = e; b.t = 0; b.dist = 999; enemies = enemies.filter((x) => x !== e); }
      } else {
        b.y = Math.max(TOP + TS + 1, b.y - 0.018 * dt);
        b.x += Math.sin((b.t + b.x * 20) / 400) * 0.01 * dt;
        b.x = Math.max(2 * TS, Math.min(W - 2 * TS - b.w, b.x));
      }
      if (b.dist >= 56 && hit(p, b)) {
        b.dead = true;
        if (b.enemy) {
          addScore(1000, b.x, b.y);
          fruits.push({ x: b.x, y: b.y, w: 12, h: 12, vy: -0.15, ground: false, kind: Math.random() < 0.5 ? 'cherry' : 'banana', t: 0 });
        } else addScore(10, b.x, b.y);
      }
      if (b.t > (b.enemy ? 7500 : 5000)) {
        b.dead = true;
        if (b.enemy) enemies.push({ ...b.enemy, x: b.x, y: b.y, vy: 0, angry: true });
      }
    }
    bubbles = bubbles.filter((b) => !b.dead);
    for (const f of fruits) {
      f.t += dt;
      physics(f, dt, 0);
      if (hit(p, f)) { f.dead = true; addScore(500, f.x, f.y); }
      if (f.t > 9000) f.dead = true;
    }
    fruits = fruits.filter((f) => !f.dead);
    floats = floats.filter((f) => (f.t += dt) < 900);
    if (!clearT && !enemies.length && !bubbles.some((b) => b.enemy)) clearT = 3500; // 과일 주울 시간
  }

  function drawWorld() {
    const r = ROUNDS[round % ROUNDS.length];
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (!solid[y][x]) continue;
      const px = x * TS, py = TOP + y * TS;
      ctx.fillStyle = r.brick[0];
      ctx.fillRect(px, py, TS, TS);
      ctx.fillStyle = r.brick[1];
      ctx.fillRect(px, py, TS - 1, 1);
      ctx.fillRect(px, py, 1, TS - 1);
      ctx.fillStyle = r.brick[2];
      ctx.fillRect(px + TS - 1, py, 1, TS);
      ctx.fillRect(px, py + TS - 1, TS, 1);
    }
    const step = Math.floor(t / 180) % 2;
    for (const f of fruits) if (!(f.t > 7000 && Math.floor(f.t / 120) % 2)) ctx.drawImage(spr[f.kind], Math.round(f.x - 2), Math.round(f.y - 2));
    for (const e of enemies) {
      const img = e.angry ? (step ? spr.aA : spr.aB) : (step ? spr.rA : spr.rB);
      drawFlip(img, e.x - 2, e.y - 2, e.vx < 0);
    }
    for (const b of bubbles) {
      const bx = Math.round(b.x - 1), by = Math.round(b.y - 1);
      if (b.enemy) drawFlip(b.enemy.angry ? spr.aA : spr.rA, bx, by, false, 0.85);
      const warn = b.enemy && b.t > 5500 && Math.floor(b.t / 120) % 2;
      ctx.drawImage(warn ? bubbleImg.warn : bubbleImg.normal, bx, by);
    }
    if (!(p.inv && Math.floor(p.inv / 90) % 2)) {
      const moving = p.vx !== 0 && p.ground;
      const img = p.shootT ? spr.dS : moving && step ? spr.dB : spr.dA;
      drawFlip(img, p.x - 2, p.y - 1, p.dir < 0);
    }
    for (const f of floats) text(ctx, f.s, Math.round(f.x), Math.round(f.y - f.t * 0.02), '#f8f8f8');
  }
  function drawFlip(img, x, y, flip, scale = 1) {
    ctx.save();
    ctx.translate(Math.round(x) + (flip ? 16 : 0), Math.round(y));
    if (flip) ctx.scale(-1, 1);
    if (scale !== 1) { ctx.translate(8, 8); ctx.scale(scale, scale); ctx.translate(-8, -8); }
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  function drawHud() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, TOP);
    text(ctx, '1UP', 8, 4, '#38e838');
    text(ctx, pad(score), 32, 4, '#f8f8f8');
    text(ctx, 'HI', 120, 4, '#e83838');
    text(ctx, pad(Math.max(hi, score)), 136, 4, '#f8f8f8');
    for (let i = 0; i < lives; i++) ctx.drawImage(spr.heart, 214 + i * 9, 5);
    if (intro > 0 && started) {
      center(ctx, `ROUND ${round + 1}`, H / 2 - 12, W, '#f8f8f8');
      if (intro < 1100) center(ctx, 'READY!', H / 2, W, Math.floor(t / 150) % 2 ? '#f8d020' : '#f87800');
    }
    if (clearT > 0 && clearT < 3000) center(ctx, 'ROUND CLEAR!', H / 2 - 6, W, '#f8d020');
    if (!started || over) {
      ctx.fillStyle = 'rgba(0,0,0,.65)';
      ctx.fillRect(0, TOP, W, H - TOP);
      if (over) {
        center(ctx, 'GAME OVER', H / 2 - 12, W, '#e83838');
        center(ctx, pad(score), H / 2 + 2, W, '#f8f8f8');
      } else {
        ctx.drawImage(spr.dA, W / 2 - 40, H / 2 - 40);
        ctx.drawImage(spr.rA, W / 2 + 24, H / 2 - 40);
        center(ctx, 'BUBBLE JUMP', H / 2 - 12, W, '#58e8f8');
        if (Math.floor(t / 500) % 2) center(ctx, 'PUSH START', H / 2 + 6, W, '#f8f8f8');
      }
    }
  }

  const KEYMAP = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'jump', ' ': 'jump', w: 'jump', W: 'jump', x: 'shoot', X: 'shoot', z: 'shoot', Z: 'shoot', j: 'shoot', J: 'shoot' };
  const onKey = (down) => (e) => {
    const k = KEYMAP[e.key];
    if (!k || !area.isConnected || area.closest('.hidden')) return;
    e.preventDefault();
    if (!started) { if (down) started = true; return; }
    if (k === 'jump' || k === 'shoot') { if (down && !e.repeat) keys[k] = true; } else keys[k] = down;
  };
  const kd = onKey(true);
  const ku = onKey(false);
  document.addEventListener('keydown', kd);
  document.addEventListener('keyup', ku);
  cv.addEventListener('pointerdown', () => { started = true; });
  area.querySelectorAll('.arc-pad [data-k]').forEach((b) => {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!started) { started = true; return; }
      keys[k] = true;
      b.setPointerCapture(e.pointerId);
    });
    const up = () => { if (k === 'left' || k === 'right') keys[k] = false; };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  });

  loadRound();
  const stop = loop((dt) => {
    t += dt;
    if (started && !over) update(dt);
    drawWorld();
    drawHud();
  });
  return () => { stop(); document.removeEventListener('keydown', kd); document.removeEventListener('keyup', ku); };
}
