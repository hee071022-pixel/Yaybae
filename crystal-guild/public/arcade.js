// 버블 계열 아케이드 미니게임 2개 (캔버스). 보상 없음, 점수만 순위에 올라간다.

// 캔버스를 화면 폭에 맞추고, 내부 좌표는 고정 크기로 쓴다
function makeCanvas(area, w, h) {
  const cv = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = w * dpr;
  cv.height = h * dpr;
  cv.className = 'arc-canvas';
  cv.style.aspectRatio = `${w} / ${h}`;
  area.appendChild(cv);
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const toLocal = (e) => {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h];
  };
  return { cv, ctx, toLocal };
}

function loop(step) {
  let raf = 0;
  let last = performance.now();
  let running = true;
  const tick = (now) => {
    if (!running) return;
    const dt = Math.min(now - last, 40);
    last = now;
    step(dt);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { running = false; cancelAnimationFrame(raf); };
}

const COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#9b59b6'];

// ======================= 버블 슈터 =======================
export function bubbleShooter(area, finish) {
  const W = 320, H = 460, R = 16, COLS = 10, RH = R * Math.sqrt(3), LOSE_Y = H - 78;
  area.innerHTML = '<div class="tt-bar"><span>점수 <b id="bs-score">0</b></span><span class="muted small">조준하고 눌러서 쏘기 · 같은 색 3개 이상</span></div>';
  const { cv, ctx, toLocal } = makeCanvas(area, W, H);
  cv.style.maxWidth = '340px';
  let grid = [];
  let parity = 0; // 줄마다 반 칸씩 밀리는 기준
  let score = 0;
  let shots = 0;
  let over = false;
  let aim = -Math.PI / 2;
  let flying = null;
  let cur;
  let next;
  let pops = []; // 터지는 효과
  const offset = (i) => (((i + parity) % 2) ? R : 0);
  const cols = (i) => (offset(i) ? COLS - 1 : COLS);
  const pos = (i, j) => [j * 2 * R + R + offset(i), i * RH + R];
  const rnd = (list) => list[Math.floor(Math.random() * list.length)];
  const newRow = () => Array.from({ length: COLS }, () => rnd(COLORS));
  for (let i = 0; i < 6; i++) grid.push(newRow());
  const present = () => {
    const set = new Set();
    grid.forEach((row, i) => row.forEach((c, j) => { if (c && j < cols(i)) set.add(c); }));
    return set.size ? [...set] : COLORS;
  };
  cur = rnd(present());
  next = rnd(present());
  const get = (i, j) => (i >= 0 && i < grid.length && j >= 0 && j < cols(i) ? grid[i][j] : null);
  const neighbors = (i, j) => {
    const o = offset(i) ? 0 : -1; // 위·아래 줄에서 붙는 칸
    return [[i, j - 1], [i, j + 1], [i - 1, j + o], [i - 1, j + o + 1], [i + 1, j + o], [i + 1, j + o + 1]];
  };
  const setScore = () => (document.getElementById('bs-score').textContent = score.toLocaleString());

  function place(x, y) {
    // 가장 가까운 빈 칸에 붙이기
    let best = null;
    const iGuess = Math.max(0, Math.round((y - R) / RH));
    for (let i = Math.max(0, iGuess - 1); i <= iGuess + 1; i++) {
      while (grid.length <= i) grid.push(Array(COLS).fill(null));
      for (let j = 0; j < cols(i); j++) {
        if (grid[i][j]) continue;
        const [px, py] = pos(i, j);
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    if (!best) return;
    grid[best.i][best.j] = cur;
    // 같은 색 묶음
    const seen = new Set([`${best.i},${best.j}`]);
    const group = [[best.i, best.j]];
    for (let k = 0; k < group.length; k++) {
      for (const [a, b] of neighbors(...group[k])) {
        if (get(a, b) === cur && !seen.has(`${a},${b}`)) { seen.add(`${a},${b}`); group.push([a, b]); }
      }
    }
    if (group.length >= 3) {
      group.forEach(([a, b]) => { pops.push({ x: pos(a, b)[0], y: pos(a, b)[1], c: grid[a][b], t: 0 }); grid[a][b] = null; });
      score += group.length * 10;
      // 천장에 안 붙어 있는 방울은 떨어짐
      const hold = new Set();
      const q = [];
      grid[0]?.forEach((c, j) => { if (c && j < cols(0)) { hold.add(`0,${j}`); q.push([0, j]); } });
      for (let k = 0; k < q.length; k++) {
        for (const [a, b] of neighbors(...q[k])) {
          if (get(a, b) && !hold.has(`${a},${b}`)) { hold.add(`${a},${b}`); q.push([a, b]); }
        }
      }
      let dropped = 0;
      grid.forEach((row, i) => row.forEach((c, j) => {
        if (c && !hold.has(`${i},${j}`)) { pops.push({ x: pos(i, j)[0], y: pos(i, j)[1], c, t: 0, fall: true }); grid[i][j] = null; dropped++; }
      }));
      score += dropped * 20 * (dropped > 3 ? 2 : 1);
    }
    while (grid.length && grid[grid.length - 1].every((c) => !c)) grid.pop();
    shots++;
    if (shots % 7 === 0) { grid.unshift(newRow()); parity ^= 1; }
    setScore();
    if (grid.some((row, i) => row.some((c, j) => c && j < cols(i) && pos(i, j)[1] + R > LOSE_Y))) end();
    if (grid.every((row) => row.every((c) => !c))) { score += 500; setScore(); for (let i = 0; i < 5; i++) grid.push(newRow()); }
    cur = next;
    next = rnd(present());
  }

  function end() {
    if (over) return;
    over = true;
    finish(score);
  }

  const shoot = () => {
    if (over || flying) return;
    flying = { x: W / 2, y: H - 34, vx: Math.cos(aim) * 0.55, vy: Math.sin(aim) * 0.55, c: cur };
  };
  const setAim = (e) => {
    const [x, y] = toLocal(e);
    aim = Math.atan2(Math.min(y, H - 50) - (H - 34), x - W / 2);
    aim = Math.max(-Math.PI + 0.17, Math.min(-0.17, aim));
  };
  cv.addEventListener('pointermove', setAim);
  cv.addEventListener('pointerdown', setAim);
  cv.addEventListener('pointerup', (e) => { setAim(e); shoot(); });
  const onKey = (e) => {
    if (!area.isConnected || area.closest('.hidden')) return;
    if (e.key === 'ArrowLeft') aim = Math.max(-Math.PI + 0.17, aim - 0.06);
    else if (e.key === 'ArrowRight') aim = Math.min(-0.17, aim + 0.06);
    else if (e.key === ' ' || e.key === 'ArrowUp') shoot();
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  const ball = (x, y, c, r = R - 1) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  };

  const stop = loop((dt) => {
    if (flying) {
      // 여러 번 나눠서 움직여야 벽·방울을 뚫지 않음
      for (let k = 0; k < 4 && flying; k++) {
        flying.x += (flying.vx * dt) / 4;
        flying.y += (flying.vy * dt) / 4;
        if (flying.x < R) { flying.x = R; flying.vx *= -1; }
        if (flying.x > W - R) { flying.x = W - R; flying.vx *= -1; }
        let hit = flying.y <= R;
        if (!hit) {
          grid.forEach((row, i) => row.forEach((c, j) => {
            if (!hit && c && j < cols(i)) {
              const [px, py] = pos(i, j);
              if ((px - flying.x) ** 2 + (py - flying.y) ** 2 < (2 * R - 4) ** 2) hit = true;
            }
          }));
        }
        if (hit) { place(flying.x, flying.y); flying = null; }
      }
    }
    // 그리기
    ctx.fillStyle = '#1d2238';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(231,76,60,.6)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(0, LOSE_Y); ctx.lineTo(W, LOSE_Y); ctx.stroke();
    ctx.setLineDash([]);
    grid.forEach((row, i) => row.forEach((c, j) => { if (c && j < cols(i)) ball(...pos(i, j), c); }));
    pops = pops.filter((p) => (p.t += dt) < 350);
    pops.forEach((p) => {
      ctx.globalAlpha = 1 - p.t / 350;
      ball(p.x, p.y + (p.fall ? p.t * 0.4 : 0), p.c, (R - 1) * (p.fall ? 1 : 1 + p.t / 500));
      ctx.globalAlpha = 1;
    });
    // 조준선
    if (!over) {
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(W / 2, H - 34);
      ctx.lineTo(W / 2 + Math.cos(aim) * 150, H - 34 + Math.sin(aim) * 150);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#2c3352';
    ctx.fillRect(0, H - 14, W, 14);
    if (flying) ball(flying.x, flying.y, flying.c);
    else if (!over) ball(W / 2, H - 34, cur);
    ctx.fillStyle = '#aab';
    ctx.font = '12px sans-serif';
    ctx.fillText('다음', W - 64, H - 30);
    ball(W - 26, H - 34, next, 10);
    ctx.fillText(`${7 - (shots % 7)}발 뒤 한 줄 내려옴`, 8, H - 30);
    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('게임 끝', W / 2, H / 2 - 10);
      ctx.font = '16px sans-serif';
      ctx.fillText(`${score.toLocaleString()}점`, W / 2, H / 2 + 20);
      ctx.textAlign = 'left';
    }
  });
  return () => { stop(); document.removeEventListener('keydown', onKey); };
}

// ======================= 버블 점프 =======================
const T = 20, GW = 24, GH = 20;
const LEVELS = [
  [[15, 3, 9], [15, 14, 20], [11, 6, 17], [7, 3, 9], [7, 14, 20], [4, 9, 14]],
  [[16, 2, 7], [16, 16, 21], [13, 8, 15], [10, 2, 7], [10, 16, 21], [7, 8, 15], [4, 3, 20]],
  [[15, 4, 19], [12, 1, 6], [12, 17, 22], [9, 7, 16], [6, 1, 6], [6, 17, 22], [3, 8, 15]],
];

export function bubbleJump(area, finish) {
  const W = GW * T, H = GH * T;
  area.innerHTML = `<div class="tt-bar"><span>점수 <b id="bj2-score">0</b></span><span>스테이지 <b id="bj2-lv">1</b> · 목숨 <b id="bj2-life">3</b></span></div>`;
  const { cv, ctx } = makeCanvas(area, W, H);
  area.insertAdjacentHTML('beforeend', `<div class="arc-pad">
    <button type="button" data-k="left" aria-label="왼쪽">◀</button><button type="button" data-k="right" aria-label="오른쪽">▶</button>
    <span></span><button type="button" data-k="jump">점프</button><button type="button" data-k="shoot">버블</button></div>
    <p class="muted small center" style="margin:6px 0 0">PC: ← → 이동 · ↑ 또는 스페이스 점프 · X 또는 Z 버블</p>`);
  const keys = { left: false, right: false, jump: false, shoot: false };
  let solid; // 발판 칸
  let level = 0;
  let score = 0;
  let lives = 3;
  let started = false;
  let over = false;
  let clearT = 0;
  const p = { x: 40, y: H - T - 18, w: 16, h: 18, vx: 0, vy: 0, dir: 1, ground: false, inv: 0, cool: 0 };
  let enemies = [];
  let bubbles = [];
  let texts = [];
  const hud = () => {
    document.getElementById('bj2-score').textContent = score.toLocaleString();
    document.getElementById('bj2-lv').textContent = level + 1;
    document.getElementById('bj2-life').textContent = lives;
  };

  function loadLevel() {
    solid = Array.from({ length: GH }, (_, r) => Array.from({ length: GW }, (_, c) => r === GH - 1 || c === 0 || c === GW - 1));
    for (const [r, a, b] of LEVELS[level % LEVELS.length]) for (let c = a; c <= b; c++) solid[r][c] = true;
    Object.assign(p, { x: 40, y: H - T - 18, vx: 0, vy: 0, inv: 1500 });
    bubbles = [];
    const n = Math.min(3 + level, 9);
    enemies = Array.from({ length: n }, (_, i) => ({
      x: 120 + ((i * 97) % 300), y: 30 + (i % 3) * 20, w: 16, h: 16, vx: (i % 2 ? 1 : -1) * 0.05, vy: 0, ground: false, angry: false, jumpT: 1000 + Math.random() * 2000,
    }));
    hud();
  }

  const tileAt = (x, y) => {
    const c = Math.floor(x / T);
    const r = Math.floor(y / T);
    return r >= 0 && r < GH && c >= 0 && c < GW && solid[r][c];
  };
  // 아래로 떨어질 때만 발판에 걸림 (밑에서는 통과)
  function physics(o, dt) {
    o.vy = Math.min(o.vy + 0.0016 * dt, 0.42);
    const prevBottom = o.y + o.h;
    o.y += o.vy * dt;
    o.ground = false;
    if (o.vy >= 0) {
      const bottom = o.y + o.h;
      const row = Math.floor(bottom / T);
      const top = row * T;
      if (prevBottom <= top + 1 && bottom >= top && (tileAt(o.x + 2, top + 1) || tileAt(o.x + o.w - 2, top + 1))) {
        o.y = top - o.h;
        o.vy = 0;
        o.ground = true;
      }
    }
    o.x += o.vx * dt;
    if (o.x < T) { o.x = T; o.vx = Math.abs(o.vx) * (o === p ? 0 : 1); }
    if (o.x + o.w > W - T) { o.x = W - T - o.w; o.vx = -Math.abs(o.vx) * (o === p ? 0 : 1); }
    if (o.y > H) o.y = -o.h; // 바닥 아래로 빠지면 위에서 다시
  }
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function lose() {
    lives--;
    hud();
    if (lives <= 0) { over = true; finish(score); return; }
    Object.assign(p, { x: 40, y: H - T - 18, vx: 0, vy: 0, inv: 2000 });
  }

  function update(dt) {
    if (clearT > 0) {
      clearT -= dt;
      if (clearT <= 0) { level++; loadLevel(); }
      return;
    }
    // 플레이어
    p.vx = (keys.right ? 0.13 : 0) - (keys.left ? 0.13 : 0);
    if (p.vx) p.dir = Math.sign(p.vx);
    if (keys.jump && p.ground) { p.vy = -0.56; keys.jump = false; }
    physics(p, dt);
    p.inv = Math.max(0, p.inv - dt);
    p.cool = Math.max(0, p.cool - dt);
    if (keys.shoot && !p.cool) {
      bubbles.push({ x: p.x + (p.dir > 0 ? p.w : -18), y: p.y, w: 18, h: 18, dir: p.dir, dist: 0, t: 0, enemy: null });
      p.cool = 350;
      keys.shoot = false;
    }
    // 적
    for (const e of enemies) {
      const speed = e.angry ? 0.09 : 0.05;
      e.vx = Math.sign(e.vx || 1) * speed;
      e.jumpT -= dt;
      if (e.ground && e.jumpT <= 0) { if (p.y < e.y - 10 && Math.random() < 0.6) e.vy = -0.5; e.jumpT = 1500 + Math.random() * 2500; }
      // 발판 끝에서 가끔 돌아서기
      if (e.ground && !tileAt(e.x + (e.vx > 0 ? e.w + 2 : -2), e.y + e.h + 2) && Math.random() < 0.5) e.vx *= -1;
      physics(e, dt);
      if (!p.inv && hit(p, e)) lose();
    }
    // 방울
    for (const b of bubbles) {
      b.t += dt;
      if (b.dist < 110 && !b.enemy) {
        const d = 0.32 * dt;
        b.x += b.dir * d;
        b.dist += d;
        if (b.x < T || b.x + b.w > W - T) b.dist = 999;
        const e = enemies.find((x) => hit(b, x));
        if (e) { b.enemy = e; b.t = 0; b.dist = 999; enemies = enemies.filter((x) => x !== e); }
      } else {
        b.y = Math.max(T + 4, b.y - 0.035 * dt);
        b.x += Math.sin(b.t / 300) * 0.02 * dt;
      }
      // 닿으면 터뜨리기
      if (b.dist >= 110 && hit(p, b)) {
        b.dead = true;
        const gain = b.enemy ? 100 * (level + 1) : 10;
        score += gain;
        texts.push({ x: b.x, y: b.y, s: `+${gain}`, t: 0 });
        hud();
      }
      const life = b.enemy ? 7000 : 4500;
      if (b.t > life) {
        b.dead = true;
        if (b.enemy) enemies.push({ ...b.enemy, x: b.x, y: b.y, vy: 0, angry: true }); // 못 터뜨리면 화나서 풀려남
      }
    }
    bubbles = bubbles.filter((b) => !b.dead);
    texts = texts.filter((t) => (t.t += dt) < 800);
    if (!enemies.length && !bubbles.some((b) => b.enemy)) {
      score += 300;
      hud();
      clearT = 1500;
      texts.push({ x: W / 2 - 40, y: H / 2, s: '스테이지 클리어!', t: 0 });
    }
  }

  function draw() {
    ctx.fillStyle = '#10142a';
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
      if (!solid[r][c]) continue;
      ctx.fillStyle = r === GH - 1 || c === 0 || c === GW - 1 ? '#3b2f6e' : '#5b4bc4';
      ctx.fillRect(c * T, r * T, T - 1, T - 1);
    }
    // 방울
    for (const b of bubbles) {
      const cx = b.x + 9, cy = b.y + 9;
      if (b.enemy) {
        ctx.fillStyle = b.enemy.angry ? '#e74c3c' : '#c08cff';
        ctx.fillRect(cx - 6, cy - 6, 12, 12);
      }
      ctx.strokeStyle = b.enemy ? '#7fdcff' : 'rgba(127,220,255,.8)';
      ctx.fillStyle = 'rgba(127,220,255,.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (b.enemy && b.t > 5000 && Math.floor(b.t / 150) % 2) { ctx.strokeStyle = '#e74c3c'; ctx.stroke(); }
    }
    // 적
    for (const e of enemies) {
      ctx.fillStyle = e.angry ? '#e74c3c' : '#a463f2';
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = '#fff';
      ctx.fillRect(e.x + (e.vx > 0 ? 9 : 3), e.y + 4, 4, 4);
    }
    // 플레이어 (무적일 때 깜빡임)
    if (!(p.inv && Math.floor(p.inv / 100) % 2)) {
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = '#fff';
      ctx.fillRect(p.x + (p.dir > 0 ? 9 : 2), p.y + 4, 5, 5);
      ctx.fillStyle = '#111';
      ctx.fillRect(p.x + (p.dir > 0 ? 11 : 3), p.y + 5, 2, 3);
    }
    ctx.fillStyle = '#ffe066';
    ctx.font = 'bold 14px sans-serif';
    for (const t of texts) ctx.fillText(t.s, t.x, t.y - t.t * 0.03);
    if (!started || over) {
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(over ? '게임 끝' : '버블 점프', W / 2, H / 2 - 14);
      ctx.font = '15px sans-serif';
      ctx.fillText(over ? `${score.toLocaleString()}점` : '눌러서 시작 · 적을 방울에 가두고 터뜨리세요', W / 2, H / 2 + 16);
      ctx.textAlign = 'left';
    }
  }

  const KEYMAP = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'jump', ' ': 'jump', w: 'jump', W: 'jump', x: 'shoot', X: 'shoot', z: 'shoot', Z: 'shoot', j: 'shoot', J: 'shoot' };
  const onKey = (down) => (e) => {
    const k = KEYMAP[e.key];
    if (!k || !area.isConnected || area.closest('.hidden')) return;
    e.preventDefault();
    if (!started && down) { started = true; return; }
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
      started = true;
      keys[k] = true;
      b.setPointerCapture(e.pointerId);
    });
    const up = () => { if (k === 'left' || k === 'right') keys[k] = false; };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  });

  loadLevel();
  const stop = loop((dt) => {
    if (started && !over) update(dt);
    draw();
  });
  return () => { stop(); document.removeEventListener('keydown', kd); document.removeEventListener('keyup', ku); };
}
