// 크리스탈 소울 화면 그리기 도우미: 타일 세트, 소품, 횃불, 단계식 어둠, 테두리 HUD, 타이틀 화면.
// 모든 색은 souls-art.js 팔레트에서만 고른다.
import { PAL as C, PROPS, ESTUS, ESTUS_EMPTY, SOUL_ICON, CHEST, BONFIRE_BASE, TORCH } from './souls-art.js';
import { sprite, text } from './arcade.js';

const T = 16;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function hash(x, y, s = 0) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}
const px = (g, col, x, y, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(x, y, w, h); };

// ---------- 타일 ----------
function stone(g, x, y, w, h, s) {
  const base = [C[3], '#423f51', '#3a3747'][s % 3];
  px(g, base, x, y, w - 1, h - 1);
  px(g, C[4], x, y, w - 1, 1);
  px(g, C[4], x, y, 1, h - 1);
  px(g, C[2], x, y + h - 2, w - 1, 1);
  px(g, C[2], x + w - 2, y, 1, h - 1);
  for (let i = 0; i < 3; i++) {
    const r = hash(x + i, y, s);
    px(g, i ? C[2] : C[4], x + 1 + (r % Math.max(1, w - 3)), y + 1 + ((r >> 8) % Math.max(1, h - 3)));
  }
}
function floorTile(seed) {
  const [c, g] = canvas(T, T);
  px(g, C[1], 0, 0, T, T);
  const layouts = [
    [[0, 0, 8, 8], [8, 0, 8, 8], [0, 8, 8, 8], [8, 8, 8, 8]],
    [[0, 0, 10, 8], [10, 0, 6, 8], [0, 8, 6, 8], [6, 8, 10, 8]],
    [[0, 0, 16, 7], [0, 7, 9, 9], [9, 7, 7, 9]],
  ];
  layouts[seed % 3].forEach(([x, y, w, h], i) => stone(g, x, y, w, h, seed + i));
  if (seed % 4 === 1) { // 금
    let x = 3 + (seed % 7), y = 2;
    for (let i = 0; i < 7; i++) { px(g, C[1], x, y); y++; x += (hash(seed, i) & 1) ? 1 : -1 + (i % 2); }
  }
  if (seed % 5 === 2) { // 이끼
    for (let i = 0; i < 7; i++) { const r = hash(seed, i, 9); px(g, (r & 1) ? C.f : C.g, 6 + (r % 5), 6 + ((r >> 4) % 4)); }
  }
  return c;
}
function yardTile(seed) {
  const [c, g] = canvas(T, T);
  px(g, C.m, 0, 0, T, T);
  for (let i = 0; i < 22; i++) {
    const r = hash(seed, i, 3);
    px(g, [C[8], C.l, C[8], '#544638'][r % 4], r % 16, (r >> 5) % 16, (r >> 10) % 3 === 0 ? 2 : 1, 1);
  }
  if (seed % 4 === 0) stone(g, 2 + (seed % 5), 3 + (seed % 6), 7, 6, seed); // 깨진 포석
  return c;
}
function wallFace(seed) {
  const [c, g] = canvas(T, T);
  px(g, C[1], 0, 0, T, T);
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    const off = (row % 2) * 4 + (seed % 2) * 2;
    for (let x = -off; x < T; x += 8) {
      const x0 = Math.max(0, x), x1 = Math.min(T, x + 7);
      const r = hash(seed, row * 8 + x, 5);
      const dark = r % 6 === 0;
      px(g, dark ? C[2] : C[3], x0, y, x1 - x0, 3);
      px(g, dark ? C[3] : C[4], x0, y, x1 - x0, 1);
      if (r % 9 === 1) px(g, C[2], x0 + 2, y + 1, 2, 1);
    }
  }
  px(g, C[5], 0, 0, T, 1); // 위쪽 모서리 빛
  px(g, C[0], 0, T - 2, T, 2); // 바닥과 만나는 그늘
  if (seed % 6 === 3) for (let i = 0; i < 5; i++) px(g, C.g, 3 + (seed % 9) + (i % 2), i * 2, 1, 2); // 이끼 흘러내림
  return c;
}
function wallTop(seed) {
  const [c, g] = canvas(T, T);
  px(g, C[1], 0, 0, T, T);
  for (let i = 0; i < 6; i++) { const r = hash(seed, i, 7); px(g, (r & 1) ? C[0] : C[2], r % 16, (r >> 6) % 16); }
  return c;
}
function doorTile() {
  const [c, g] = canvas(T, T);
  px(g, C[0], 0, 0, T, T);
  for (let x = 1; x < T - 1; x += 4) { px(g, C.a, x, 1, 3, T - 2); px(g, C[9], x + 2, 1, 1, T - 2); }
  for (const y of [3, 11]) { px(g, C[4], 1, y, T - 2, 2); px(g, C[6], 2, y, 1, 1); px(g, C[6], T - 3, y, 1, 1); }
  px(g, C.e, 11, 7, 2, 2);
  return c;
}

export function buildTiles(map, MW, MH, avoid) {
  const tiles = {
    floor: Array.from({ length: 12 }, (_, i) => floorTile(i)),
    yard: Array.from({ length: 8 }, (_, i) => yardTile(i)),
    face: Array.from({ length: 8 }, (_, i) => wallFace(i)),
    top: Array.from({ length: 4 }, (_, i) => wallTop(i)),
    door: doorTile(),
  };
  const [shadow, sg] = canvas(T, T);
  for (let y = 0; y < 5; y++) for (let x = 0; x < T; x++) if (y < 2 || BAYER[(y % 4) * 4 + (x % 4)] < (5 - y) * 4) px(sg, C[0], x, y);
  tiles.shadow = shadow;
  const props = [];
  const torches = [];
  const at = (c, r) => (r < 0 || r >= MH || c < 0 || c >= MW ? '#' : map[r][c]);
  const near = (c, r) => avoid.some(([x, y]) => Math.abs(x - c) <= 2 && Math.abs(y - r) <= 2);
  for (let r = 0; r < MH; r++) for (let c = 0; c < MW; c++) {
    const ch = map[r][c], h = hash(c, r, 11);
    if (ch === '#' && at(c, r + 1) !== '#' && h % 4 === 0 && !torches.some((t) => Math.abs(t.c - c) + Math.abs(t.r - r) < 6)) torches.push({ c, r, x: c * T + 8, y: r * T + 10 });
    if (near(c, r) || (ch !== '.' && ch !== ',')) continue;
    const ox = 2 + (h >> 4) % 6, oy = 2 + (h >> 8) % 6;
    let kind = null;
    if (r < 11) kind = h % 23 === 0 ? 'shard' : h % 47 === 0 ? 'bones' : null;
    else if (ch === ',') kind = h % 5 === 0 ? 'grass' : h % 19 === 0 ? 'pebbles' : h % 41 === 0 ? 'bones' : null;
    else kind = h % 29 === 0 ? 'skull' : h % 31 === 0 ? 'bones' : h % 37 === 0 ? 'candles' : h % 43 === 0 ? 'pot' : h % 17 === 0 ? 'pebbles' : null;
    if (kind) props.push({ kind, x: c * T + ox, y: r * T + oy });
  }
  const propImg = Object.fromEntries(Object.entries(PROPS).map(([k, v]) => [k, sprite(v, C)]));
  return { tiles, props, torches, propImg };
}

export function drawTile(ctx, set, map, MW, MH, ch, c, r, sx, sy, state, t) {
  const at = (cc, rr) => (rr < 0 || rr >= MH || cc < 0 || cc >= MW ? '#' : map[rr][cc]);
  const h = hash(c, r);
  const { tiles } = set;
  if (ch === '#') {
    if (at(c, r + 1) !== '#') { ctx.drawImage(tiles.face[h % 8], sx, sy); return; }
    ctx.drawImage(tiles.top[h % 4], sx, sy);
    // 아래로 보이는 바닥과 맞닿은 테두리
    if (at(c, r - 1) !== '#') { px(ctx, C[3], sx, sy, T, 1); px(ctx, C[0], sx, sy + 1, T, 1); }
    if (at(c - 1, r) !== '#') { px(ctx, C[3], sx, sy, 1, T); px(ctx, C[0], sx + 1, sy, 1, T); }
    if (at(c + 1, r) !== '#') { px(ctx, C[3], sx + T - 1, sy, 1, T); px(ctx, C[0], sx + T - 2, sy, 1, T); }
    if (at(c, r + 2) !== '#' && at(c, r + 1) === '#') px(ctx, C[2], sx, sy + T - 1, T, 1);
    return;
  }
  if (ch === 'D' && !state.shortcut) { ctx.drawImage(tiles.door, sx, sy); return; }
  ctx.drawImage(ch === ',' ? tiles.yard[h % 8] : tiles.floor[h % 12], sx, sy);
  if (at(c, r - 1) === '#') ctx.drawImage(tiles.shadow, sx, sy);
  if (ch === 'F' && !state.boss) {
    // 안개 문: 흐르는 점 무늬
    const k = t / 140;
    for (let y = -4; y < T; y += 2) for (let x = 0; x < T; x += 2) {
      const v = Math.sin((x + c * T) / 5 + k) + Math.sin((y + k * 3) / 4);
      const b = BAYER[((y + 8) % 4) * 4 + (x % 4)] / 16;
      if (v * 0.5 + 0.55 > b) px(ctx, v > 0.6 ? C[7] : C[6], sx + x, sy + y, 2, 2);
    }
  }
}

// ---------- 불꽃 (기둥마다 높이가 흔들리는 도트 불) ----------
export function flame(ctx, x, y, size, t, seed = 0) {
  const half = Math.round(size / 2);
  for (let i = -half; i <= half; i++) {
    const edge = 1 - Math.abs(i) / (half + 1);
    const h = Math.max(1, Math.round(size * 1.3 * edge * (0.75 + 0.25 * Math.sin(t / 70 + i * 1.9 + seed))));
    for (let j = 0; j < h; j++) {
      const k = j / h;
      const col = k > 0.75 ? C.e : k > 0.35 || Math.abs(i) > half - 1 ? C.d : C.c;
      px(ctx, Math.abs(i) <= 1 && j < h * 0.45 ? C.e : col, x + i, y - j);
    }
  }
}

const chestImg = sprite(CHEST, C);
const baseImg = sprite(BONFIRE_BASE, C);
const torchImg = sprite(TORCH, C);
export function drawChest(ctx, x, y) { ctx.drawImage(chestImg, x - 7, y - 6); }
export function drawTorch(ctx, x, y, t, seed) {
  ctx.drawImage(torchImg, x - 3, y - 2);
  flame(ctx, x, y - 3, 4, t, seed);
}
export function drawBonfire(ctx, x, y, lit, t) {
  ctx.drawImage(baseImg, x - 8, y - 1);
  if (lit) flame(ctx, x, y + 1, 8, t);
  // 꽂힌 칼 (불 앞에 그려야 꽂힌 느낌)
  px(ctx, C[0], x - 1, y - 15, 4, 17);
  px(ctx, C[6], x, y - 14, 1, 15);
  px(ctx, C[7], x + 1, y - 14, 1, 15);
  px(ctx, C[0], x - 3, y - 15, 8, 3);
  px(ctx, C.a, x - 2, y - 14, 6, 1);
  px(ctx, C[0], x - 1, y - 20, 4, 6);
  px(ctx, C[9], x, y - 19, 2, 4);
  if (lit) {
    for (let i = 0; i < 5; i++) { // 불티
      const p = ((t / 900 + i * 0.37) % 1);
      px(ctx, p < 0.5 ? C.e : C.d, Math.round(x + Math.sin(i * 2.1 + t / 400) * 4 + (i - 2)), Math.round(y - 4 - p * 22));
    }
  } else { px(ctx, C.c, x - 3, y + 1); px(ctx, C.c, x + 3, y + 2); }
}

// ---------- 어둠: 2픽셀 칸마다 밝기를 계산해 5단계 + 디더 ----------
export function makeDark(VW, VH) {
  const W = VW / 2, H = VH / 2;
  const [cv, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  const ALPHA = [222, 168, 112, 56, 0];
  return {
    draw(ctx, lights) {
      const d = img.data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const wx = x * 2 + 1, wy = y * 2 + 1;
        let L = 0;
        for (const l of lights) {
          const dx = wx - l.x, dy = wy - l.y;
          const v = 1 - Math.sqrt(dx * dx + dy * dy) / l.r;
          if (v > L) L = v;
        }
        const q = Math.max(0, Math.min(4, Math.floor(L * 5 + BAYER[(y % 4) * 4 + (x % 4)] / 16 - 0.25)));
        const i = (y * W + x) * 4;
        d[i] = 11; d[i + 1] = 10; d[i + 2] = 16; d[i + 3] = ALPHA[q];
      }
      g.putImageData(img, 0, 0);
      ctx.drawImage(cv, 0, 0, VW, VH);
    },
  };
}

// ---------- HUD ----------
export function frame(ctx, x, y, w, h, fill = C[1]) {
  px(ctx, C[0], x - 2, y - 1, w + 4, h + 2);
  px(ctx, C[0], x - 1, y - 2, w + 2, h + 4);
  px(ctx, C[5], x - 1, y - 1, w + 2, 1);
  px(ctx, C[5], x - 1, y - 1, 1, h + 2);
  px(ctx, C[3], x - 1, y + h, w + 2, 1);
  px(ctx, C[3], x + w, y - 1, 1, h + 2);
  px(ctx, fill, x, y, w, h);
}
export function bar(ctx, x, y, w, h, v, max, col, hi, lag = null) {
  frame(ctx, x, y, w, h, C[0]);
  const fw = (val) => Math.max(0, Math.min(w, Math.round((w * val) / max)));
  if (lag != null && lag > v) px(ctx, C.e, x, y, fw(lag), h);
  px(ctx, col, x, y, fw(v), h);
  px(ctx, hi, x, y, fw(v), 1);
}
const estusImg = sprite(ESTUS, C), estusEmpty = sprite(ESTUS_EMPTY, C), soulImg = sprite(SOUL_ICON, C);
export function itemSlot(ctx, x, y, count) {
  frame(ctx, x, y, 18, 20);
  ctx.drawImage(count > 0 ? estusImg : estusEmpty, x + 4, y + 2, 10, 16);
  text(ctx, String(count), x + 14, y + 14, count > 0 ? C[7] : C[5]);
}
export function soulBox(ctx, x, y, n) {
  const s = String(n);
  const w = s.length * 6 + 14;
  frame(ctx, x - w, y, w, 11);
  ctx.drawImage(soulImg, x - w + 3, y + 3);
  text(ctx, s, x - s.length * 6 - 1, y + 2, C[7]);
}
const bigCache = new Map();
export function bigText(ctx, str, cx, y, color, scale = 2, shadow = C[0]) {
  const key = `${str}|${color}|${shadow}`;
  if (!bigCache.has(key)) {
    const [c, g] = canvas(str.length * 6 + 1, 9);
    text(g, str, 0, 0, color, shadow);
    bigCache.set(key, c);
  }
  const c = bigCache.get(key);
  ctx.drawImage(c, Math.round(cx - (c.width * scale) / 2), y, c.width * scale, c.height * scale);
}

// ---------- 타이틀 화면 ----------
export function makeTitle(VW, VH) {
  const [bg, g] = canvas(VW, VH);
  const bands = [C[0], '#110f18', C[1], '#232030', C[2]];
  const bh = 120 / bands.length;
  for (let y = 0; y < VH; y++) {
    const f = y / bh, i = Math.min(bands.length - 1, Math.floor(f));
    const next = Math.min(bands.length - 1, i + 1);
    px(g, bands[i], 0, y, VW, 1);
    for (let x = 0; x < VW; x++) if ((f - i) * 16 > BAYER[(y % 4) * 4 + (x % 4)] + 8) px(g, bands[next], x, y);
  }
  for (let i = 0; i < 40; i++) { const r = hash(i, 5, 1); px(g, r % 5 ? C[4] : C[6], r % VW, (r >> 9) % 90); }
  // 수정 달
  for (let y = -9; y <= 9; y++) for (let x = -9; x <= 9; x++) if (x * x + y * y <= 81) px(g, x * x + y * y > 64 ? C[5] : (x + y > 4 ? C[6] : C[7]), 250 + x, 34 + y);
  px(g, C[6], 247, 31, 2, 2); px(g, C[6], 253, 38, 3, 2);
  // 무너진 성 실루엣
  const towers = [[18, 70, 18], [40, 96, 12], [62, 58, 22], [92, 86, 14], [214, 80, 16], [236, 52, 24], [266, 90, 12], [286, 74, 20]];
  px(g, C[0], 0, 118, VW, VH - 118);
  for (const [x, top, w] of towers) {
    px(g, C[0], x, top, w, 130 - top);
    for (let k = 0; k < w; k += 4) px(g, C[0], x + k, top - 3, 2, 3);
    for (let k = 0; k < 3; k++) { const r = hash(x, k, 2); if (r % 3 === 0) px(g, C.d, x + 3 + (r % (w - 6)), top + 8 + k * 12, 2, 3); }
  }
  for (let x = 0; x < VW; x++) { const hh = 118 + Math.round(Math.sin(x / 23) * 3 + Math.sin(x / 7) * 1.5); px(g, C[0], x, hh, 1, VH - hh); }
  return {
    draw(ctx, t) {
      ctx.drawImage(bg, 0, 0);
      bigText(ctx, 'CRYSTAL', VW / 2, 18, C[6], 3, C[0]);
      bigText(ctx, 'SOULS', VW / 2, 48, C.h, 3, C[0]);
      const by = 112;
      // 불빛이 비치는 땅 (단계식 원)
      for (const [r, col] of [[40, '#1c1612'], [26, '#2a1e16'], [14, '#3a2a1e']]) {
        for (let y = -r / 3; y <= r / 3; y++) { const w = Math.round(Math.sqrt(Math.max(0, 1 - (y * 3 / r) ** 2)) * r); px(ctx, col, VW / 2 - w, by + 3 + Math.round(y), w * 2, 1); }
      }
      drawBonfire(ctx, VW / 2, by, true, t);
      for (let i = 0; i < 9; i++) {
        const p = (t / 2600 + i * 0.113) % 1;
        px(ctx, p < 0.4 ? C.e : p < 0.75 ? C.d : C.c, Math.round(VW / 2 + Math.sin(i * 1.7 + t / 700 + p * 4) * (6 + p * 14)), Math.round(by - 8 - p * 70));
      }
    },
  };
}
