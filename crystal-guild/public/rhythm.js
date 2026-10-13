// 리듬 게임: 내 기기의 노래 파일(또는 기본 곡)을 브라우저 안에서 분석해서 박자에 맞춰 노트를 만든다.
// 노래 파일은 서버로 올라가지 않는다. 점수만 순위에 올라간다.
import { makeScreen, text, center, loop } from './arcade.js';

const LANES = 4;
const KEYS = [['d', 'D', 'ArrowLeft'], ['f', 'F', 'ArrowDown'], ['j', 'J', 'ArrowUp'], ['k', 'K', 'ArrowRight']];
const LANE_COLORS = ['#ff6b8b', '#ffd23f', '#3ec9ff', '#8c7bff'];
const JUDGE = [['PERFECT', 0.05, 1000, '#7cf8ff'], ['GREAT', 0.1, 700, '#8cff8c'], ['GOOD', 0.15, 300, '#ffd23f']];
const DIFF = {
  easy: { name: '쉬움', gap: 0.42, speed: 220, chords: 0 },
  normal: { name: '보통', gap: 0.25, speed: 280, chords: 0.04 },
  hard: { name: '어려움', gap: 0.15, speed: 340, chords: 0.12 },
};

// ---------- 기본 곡 3개: 약 2분짜리 곡을 브라우저에서 직접 합성 ----------
export const BUILTIN = [
  { id: 'crystal', name: '크리스탈 비트', bpm: 124, key: 0, lead: 'square', bars: 64, seed: 7 },
  { id: 'bunny', name: '토끼 점프', bpm: 140, key: 2, lead: 'square', bars: 72, seed: 21 },
  { id: 'star', name: '별빛 산책', bpm: 100, key: -3, lead: 'triangle', bars: 48, seed: 42 },
];

function rng(seed) {
  let x = seed * 9301 + 49297;
  return () => ((x = (x * 9301 + 49297) % 233280) / 233280);
}

// 오디오 노드 대신 샘플을 직접 계산해서 빠르게 만든다 (2분 곡도 1초 안쪽)
async function makeSong(spec) {
  const sr = 22050, b = 60 / spec.bpm, beats = spec.bars * 4, len = beats * b + 2.5;
  const n = Math.ceil(sr * len);
  const out = new Float32Array(n);
  const wave = {
    sine: (ph) => Math.sin(ph),
    square: (ph) => (Math.sin(ph) >= 0 ? 1 : -1),
    triangle: (ph) => (2 / Math.PI) * Math.asin(Math.sin(ph)),
  };
  // 소리가 dur 동안 0.001 배까지 줄어드는 감쇠
  const add = (t, dur, vol, sample) => {
    const i0 = Math.floor(t * sr), len2 = Math.floor(dur * sr);
    const k = Math.pow(0.001, 1 / len2);
    let env = vol;
    for (let i = 0; i < len2 && i0 + i < n; i++) {
      out[i0 + i] += sample(i / sr) * env;
      env *= k;
    }
  };
  const tone = (t, freq, dur, type, vol) => { const w = wave[type]; const f = 2 * Math.PI * freq; add(t, dur, vol, (x) => w(f * x)); };
  const kick = (t, vol = 1) => {
    let ph = 0;
    add(t, 0.2, vol, (x) => { ph += (2 * Math.PI * (40 + 110 * Math.exp(-x * 25))) / sr; return Math.sin(ph); });
  };
  const noise = (t, bright, dur, vol) => {
    let prev = 0;
    add(t, dur, vol, () => { const r = Math.random() * 2 - 1; const v = bright ? r - prev : r * 0.6 + prev * 0.4; prev = r; return v; });
  };
  const root = 261.63 * 2 ** (spec.key / 12);
  const note = (deg) => root * 2 ** (deg / 12);
  const penta = [0, 2, 4, 7, 9, 12, 14, 16, 19];
  const chords = [0, 7, 9, 5]; // I V vi IV
  const r = rng(spec.seed);
  // 2마디짜리 프레이즈를 만들어 A A B C 처럼 반복
  const phrase = () => Array.from({ length: 8 }, () => (r() < 0.18 ? null : penta[Math.floor(r() * penta.length)]));
  const A = phrase(), B = phrase(), C = phrase();
  const bars = spec.bars;
  const part = (bar) => {
    const f = bar / bars;
    if (bar < 4) return 'intro';
    if (f < 0.4) return 'verse';
    if (f < 0.7) return 'chorus';
    if (f < 0.76) return 'break';
    if (f < 0.95) return 'chorus2';
    return 'outro';
  };
  for (let beat = 0; beat < beats; beat++) {
    const t = 1 + beat * b;
    const bar = Math.floor(beat / 4), inBar = beat % 4;
    const sec = part(bar);
    const chord = chords[Math.floor(bar / 2) % 4];
    const loud = sec === 'chorus' || sec === 'chorus2';
    if (sec !== 'break') {
      if (inBar === 0 || inBar === 2 || (loud && inBar === 3 && bar % 2)) kick(t, sec === 'outro' ? 0.5 : 0.9);
      if (sec !== 'intro' && (inBar === 1 || inBar === 3)) noise(t, false, 0.16, loud ? 0.45 : 0.35);
      noise(t, true, 0.04, 0.1);
      if (loud || sec === 'verse') noise(t + b / 2, true, 0.04, 0.08);
    } else if (bar === Math.floor(bars * 0.76) - 1) {
      for (let k = 0; k < 4; k++) noise(t + (k * b) / 4, false, 0.08, 0.15 + k * 0.07); // 필인
    }
    if (sec !== 'intro') tone(t, note(chord - 24), b * 0.9, 'triangle', sec === 'break' ? 0.2 : 0.3);
    if (sec === 'verse' || loud || sec === 'outro') {
      const which = loud ? [A, A, B, C][Math.floor(bar / 2) % 4] : [A, B][Math.floor(bar / 2) % 2];
      for (let h = 0; h < 2; h++) {
        const step = ((bar % 2) * 4 + inBar) * 2 + h; // 2마디 안의 8분음표 위치 (0~15)
        const deg = which[step % 8];
        if (deg == null) continue;
        const tt = t + (h * b) / 2;
        tone(tt, note(deg + (loud ? 12 : 0)), b * 0.42, spec.lead, loud ? 0.06 : 0.05);
        if (loud && h === 0) tone(tt, note(deg + 7), b * 0.35, 'triangle', 0.04);
      }
    }
    if (inBar === 0 && sec !== 'intro') for (const iv of [0, 4, 7]) tone(t, note(chord + iv), b * 3.6, 'sine', 0.035);
  }
  // 끝부분 서서히 작게 + 부드럽게 자르기
  const fade = Math.floor(sr * 2);
  for (let i = 0; i < n; i++) {
    let v = Math.tanh(out[i] * 0.9);
    if (i > n - fade) v *= (n - i) / fade;
    out[i] = v;
  }
  const buf = new AudioBuffer({ numberOfChannels: 1, length: n, sampleRate: sr });
  buf.copyToChannel(out, 0);
  return buf;
}

// ---------- 박자(소리가 갑자기 커지는 순간) 찾기 ----------
export function detectNotes(buffer, diffKey) {
  const d = DIFF[diffKey];
  const sr = buffer.sampleRate;
  const step = Math.max(1, Math.round(sr / 11025));
  const ch = [...Array(buffer.numberOfChannels).keys()].map((i) => buffer.getChannelData(i));
  const n = Math.floor(ch[0].length / step);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const c of ch) v += c[i * step];
    mono[i] = v / ch.length;
  }
  const rate = sr / step, hop = 256, win = 512;
  const frames = Math.floor((n - win) / hop);
  const energy = new Float32Array(frames), bright = new Float32Array(frames), flux = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0, h = 0;
    for (let i = f * hop, end = i + win; i < end; i++) {
      e += mono[i] * mono[i];
      const dv = mono[i] - (mono[i - 1] || 0);
      h += dv * dv;
    }
    energy[f] = Math.log(1 + e * 100);
    bright[f] = h / (e + 1e-9);
    flux[f] = f ? Math.max(0, energy[f] - energy[f - 1]) : 0;
  }
  // 주변 평균보다 확 튀는 곳만 (약 0.5초 창)
  const half = Math.round((0.5 * rate) / hop);
  const prefix = new Float64Array(frames + 1);
  for (let f = 0; f < frames; f++) prefix[f + 1] = prefix[f] + flux[f];
  const peaks = [];
  let last = -1e9;
  for (let f = 2; f < frames - 2; f++) {
    const a = Math.max(0, f - half), b = Math.min(frames, f + half);
    const mean = (prefix[b] - prefix[a]) / (b - a);
    const t = (f * hop) / rate;
    if (flux[f] > mean * 1.6 + 0.02 && flux[f] >= flux[f - 1] && flux[f] >= flux[f + 1] && flux[f] >= flux[f - 2] && flux[f] >= flux[f + 2] && t - last >= d.gap) {
      peaks.push({ t, s: flux[f], br: bright[f] });
      last = t;
    }
  }
  if (!peaks.length) return [];
  // 밝은(높은) 소리일수록 오른쪽 줄로
  const sorted = peaks.map((p) => p.br).sort((x, y) => x - y);
  const q = [0.25, 0.5, 0.75].map((r) => sorted[Math.floor(sorted.length * r)]);
  const strong = [...peaks].map((p) => p.s).sort((x, y) => y - x)[Math.floor(peaks.length * d.chords)] ?? Infinity;
  const notes = [];
  let prevLane = -1, prevT = -1;
  for (const p of peaks) {
    let lane = p.br < q[0] ? 0 : p.br < q[1] ? 1 : p.br < q[2] ? 2 : 3;
    // 같은 줄 연타가 너무 빠르면 옆 줄로
    if (lane === prevLane && p.t - prevT < d.gap * 2) lane = (lane + 1 + Math.floor(p.t * 7) % 2 * 2) % LANES;
    notes.push({ t: p.t, lane });
    if (d.chords && p.s >= strong) notes.push({ t: p.t, lane: (lane + 2) % LANES });
    prevLane = lane;
    prevT = p.t;
  }
  return notes;
}

export function rhythmGame(area, finish) {
  area.innerHTML = `<div class="rh-setup" id="rh-setup">
      <div class="rh-row">
        <label class="rh-file"><input type="file" id="rh-file" accept="audio/*"><span>내 노래 고르기</span></label>
      </div>
      <div class="rh-row rh-builtin">
        <span class="muted small">기본 곡</span>
        ${BUILTIN.map((b) => `<button type="button" class="ghost sm" data-song="${b.id}">${b.name}</button>`).join('')}
      </div>
      <p class="muted small" id="rh-song" style="margin:8px 0">mp3·m4a·wav 같은 음악 파일을 고르세요. 파일은 이 기기 안에서만 쓰여요.</p>
      <div class="rh-row">
        <span class="muted small">난이도</span>
        <div class="seg" id="rh-diff"><button type="button" data-d="easy">쉬움</button><button type="button" class="on" data-d="normal">보통</button><button type="button" data-d="hard">어려움</button></div>
      </div>
      <button class="block" id="rh-start" disabled>노래를 골라 주세요</button>
    </div>
    <div id="rh-stage" class="hidden"></div>`;
  const $ = (q) => area.querySelector(q);
  let diff = 'normal';
  let buffer = null;
  let songName = '';
  let cleanup = null;

  area.querySelectorAll('#rh-diff [data-d]').forEach((b) => (b.onclick = () => {
    diff = b.dataset.d;
    area.querySelectorAll('#rh-diff [data-d]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  const ready = (name) => {
    songName = name;
    $('#rh-song').innerHTML = `선택한 곡: <b>${name.replace(/[<>&]/g, '')}</b> · ${Math.floor(buffer.duration / 60)}분 ${Math.floor(buffer.duration % 60)}초`;
    $('#rh-start').disabled = false;
    $('#rh-start').textContent = '시작하기';
  };
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  $('#rh-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $('#rh-song').textContent = '노래를 읽는 중…';
    $('#rh-start').disabled = true;
    try {
      buffer = await ac.decodeAudioData(await file.arrayBuffer());
      ready(file.name.replace(/\.[^.]+$/, ''));
    } catch {
      $('#rh-song').textContent = '이 파일은 재생할 수 없어요. 다른 음악 파일을 골라 주세요.';
    }
  };
  area.querySelectorAll('[data-song]').forEach((b) => (b.onclick = async () => {
    const spec = BUILTIN.find((x) => x.id === b.dataset.song);
    area.querySelectorAll('[data-song]').forEach((x) => x.classList.toggle('on', x === b));
    $('#rh-song').textContent = `${spec.name} 만드는 중…`;
    $('#rh-start').disabled = true;
    buffer = await makeSong(spec);
    ready(`${spec.name} (기본 곡)`);
  }));
  $('#rh-start').onclick = () => {
    if (!buffer) return;
    const notes = detectNotes(buffer, diff);
    if (notes.length < 10) { $('#rh-song').textContent = '이 곡에서는 박자를 잘 못 찾았어요. 다른 곡을 골라 주세요.'; return; }
    $('#rh-setup').classList.add('hidden');
    $('#rh-stage').classList.remove('hidden');
    cleanup = play(notes);
  };

  function play(notes) {
    const W = 240, LW = 48, X0 = 24;
    const stage = $('#rh-stage');
    // 폰에서는 화면 전체를 쓰는 플레이 모드 (스크롤·확대 막기, 가능하면 전체 화면)
    const mobile = matchMedia('(pointer: coarse)').matches || window.innerWidth < 760;
    // 세로로 긴 폰은 판도 길게 (노트가 미리 더 많이 보임)
    const vw0 = window.visualViewport?.width || window.innerWidth, vh0 = window.visualViewport?.height || window.innerHeight;
    const H = mobile ? Math.max(360, Math.min(620, Math.round((W * (vh0 - 64)) / (vw0 - 16)))) : 360;
    const HIT = H - 44;
    stage.innerHTML = `<div class="rh-bar"><span class="rh-title">${songName.replace(/[<>&]/g, '')}</span><button type="button" class="rh-quit" id="rh-quit">그만하기</button></div>`;
    const { cv, ctx } = makeScreen(stage, W, H, 420);
    if (!mobile) stage.insertAdjacentHTML('beforeend', '<p class="muted small center" style="margin:8px 0 0">D F J K (또는 ← ↓ ↑ →) · 화면의 줄을 눌러도 돼요</p>');
    // 화면 크기에 맞춰 비율 그대로 최대한 크게
    const fit = () => {
      if (!stage.classList.contains('rh-full')) { cv.style.width = ''; cv.style.height = ''; return; }
      const vw = window.visualViewport?.width || window.innerWidth;
      const vh = window.visualViewport?.height || window.innerHeight;
      const k = Math.min((vw - 16) / W, (vh - 64) / H);
      cv.style.width = `${Math.floor(W * k)}px`;
      cv.style.height = `${Math.floor(H * k)}px`;
    };
    if (mobile) {
      stage.classList.add('rh-full');
      document.body.classList.add('rh-lock');
      stage.requestFullscreen?.().then(fit).catch(() => {});
      fit();
      window.addEventListener('resize', fit);
    }
    const closeFull = () => {
      window.removeEventListener('resize', fit);
      stage.classList.remove('rh-full');
      fit();
      document.body.classList.remove('rh-lock');
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
    const d = DIFF[diff];
    const lead = 2.2; // 노트가 떨어지기 시작할 여유 시간
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.connect(ac.destination);
    ac.resume();
    const startAt = ac.currentTime + lead;
    src.start(startAt);
    const live = notes.map((n) => ({ ...n, done: false }));
    const pressed = [false, false, false, false];
    const flash = [0, 0, 0, 0];
    let score = 0, combo = 0, maxCombo = 0, judge = null, ended = false;
    const counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
    const now = () => ac.currentTime - startAt;
    let next = 0; // 아직 판정 안 된 첫 노트

    function hitLane(lane) {
      if (ended) return;
      pressed[lane] = true;
      flash[lane] = 1;
      const t = now();
      let best = null;
      for (let i = next; i < live.length && live[i].t < t + 0.2; i++) {
        const nt = live[i];
        if (nt.done || nt.lane !== lane) continue;
        const dt = Math.abs(nt.t - t);
        if (dt <= JUDGE[2][1] && (!best || dt < Math.abs(best.t - t))) best = nt;
      }
      if (!best) return;
      best.done = true;
      const dt = Math.abs(best.t - t);
      const j = JUDGE.find((x) => dt <= x[1]);
      counts[j[0]]++;
      combo++;
      maxCombo = Math.max(maxCombo, combo);
      score += Math.round(j[2] * (1 + Math.min(combo, 100) / 100));
      if (mobile) navigator.vibrate?.(12);
      judge = { s: j[0], c: j[3], t: performance.now(), lane };
    }
    const release = (lane) => { pressed[lane] = false; };

    const onKey = (down) => (e) => {
      if (!area.isConnected || area.closest('.hidden')) return;
      const lane = KEYS.findIndex((k) => k.includes(e.key));
      if (lane < 0) return;
      e.preventDefault();
      if (down && !e.repeat) hitLane(lane);
      if (!down) release(lane);
    };
    const kd = onKey(true), ku = onKey(false);
    document.addEventListener('keydown', kd);
    document.addEventListener('keyup', ku);
    const laneOf = (e) => {
      const r = cv.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      return Math.max(0, Math.min(LANES - 1, Math.floor((x - X0) / LW)));
    };
    const touches = new Map();
    cv.addEventListener('pointerdown', (e) => { e.preventDefault(); const l = laneOf(e); touches.set(e.pointerId, l); hitLane(l); });
    const up = (e) => { if (touches.has(e.pointerId)) { release(touches.get(e.pointerId)); touches.delete(e.pointerId); } };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);

    function end(quit = false) {
      if (ended) return;
      ended = true;
      try { src.stop(); } catch { /* 이미 멈춤 */ }
      const total = live.length;
      const acc = total ? (counts.PERFECT + counts.GREAT * 0.7 + counts.GOOD * 0.3) / total : 0;
      const rank = acc >= 0.95 ? 'S' : acc >= 0.85 ? 'A' : acc >= 0.7 ? 'B' : acc >= 0.5 ? 'C' : 'D';
      results = { acc, rank, quit };
      stage.querySelector('#rh-quit').textContent = '닫기';
      if (!quit || score > 0) finish(score);
    }
    let results = null;
    src.onended = () => end();
    stage.querySelector('#rh-quit').onclick = () => {
      if (!ended) end(true);
      else { closeFull(); stage.querySelector('#rh-quit').remove(); }
    };

    const stop = loop((dt) => {
      const t = now();
      // 판정선을 지나간 노트는 MISS
      while (next < live.length && (live[next].done || live[next].t < t - JUDGE[2][1])) {
        if (!live[next].done) { live[next].done = true; counts.MISS++; combo = 0; judge = { s: 'MISS', c: '#ff5a6a', t: performance.now(), lane: live[next].lane }; }
        next++;
      }
      // 배경과 줄
      ctx.fillStyle = '#0c0b1d';
      ctx.fillRect(0, 0, W, H);
      for (let l = 0; l < LANES; l++) {
        const x = X0 + l * LW;
        ctx.fillStyle = l % 2 ? '#141230' : '#181538';
        ctx.fillRect(x, 0, LW, H);
        if (pressed[l] || flash[l] > 0) {
          const g = ctx.createLinearGradient(0, HIT, 0, HIT - 120);
          g.addColorStop(0, `${LANE_COLORS[l]}66`);
          g.addColorStop(1, `${LANE_COLORS[l]}00`);
          ctx.fillStyle = g;
          ctx.fillRect(x, HIT - 120, LW, 120);
        }
        flash[l] = Math.max(0, flash[l] - dt / 120);
      }
      ctx.fillStyle = '#2a2650';
      ctx.fillRect(X0 - 2, 0, 2, H);
      ctx.fillRect(X0 + LANES * LW, 0, 2, H);
      // 판정선 + 버튼
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(X0, HIT, LANES * LW, 2);
      for (let l = 0; l < LANES; l++) {
        const x = X0 + l * LW;
        ctx.fillStyle = pressed[l] ? LANE_COLORS[l] : '#2a2650';
        ctx.fillRect(x + 4, HIT + 8, LW - 8, 20);
        if (!mobile) text(ctx, 'DFJK'[l], x + LW / 2 - 2, HIT + 14, pressed[l] ? '#0c0b1d' : '#8a86b8', null);
        else { ctx.fillStyle = LANE_COLORS[l]; ctx.fillRect(x + LW / 2 - 6, HIT + 17, 12, 2); }
      }
      // 노트
      for (let i = next; i < live.length; i++) {
        const nt = live[i];
        const y = HIT - (nt.t - t) * d.speed;
        if (y < -12) break;
        if (nt.done) continue;
        const x = X0 + nt.lane * LW;
        ctx.fillStyle = LANE_COLORS[nt.lane];
        ctx.fillRect(x + 3, Math.round(y) - 6, LW - 6, 10);
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.fillRect(x + 3, Math.round(y) - 6, LW - 6, 2);
      }
      // 점수 · 콤보 · 판정
      text(ctx, String(score).padStart(7, '0'), 4, 4, '#ffffff', null);
      const prog = Math.min(1, Math.max(0, t / buffer.duration));
      ctx.fillStyle = '#2a2650';
      ctx.fillRect(W - 64, 6, 60, 4);
      ctx.fillStyle = '#8c7bff';
      ctx.fillRect(W - 64, 6, Math.round(60 * prog), 4);
      if (combo >= 3) { center(ctx, String(combo), 130, W, '#ffffff'); center(ctx, 'COMBO', 140, W, '#8a86b8', null); }
      if (judge && performance.now() - judge.t < 450) center(ctx, judge.s, 170, W, judge.c);
      if (t < 0) center(ctx, t < -1.4 ? '3' : t < -0.7 ? '2' : '1', 160, W, '#ffd23f');
      if (results) {
        ctx.fillStyle = 'rgba(0,0,0,.75)';
        ctx.fillRect(0, 0, W, H);
        center(ctx, results.quit ? 'STOP' : 'CLEAR!', 70, W, '#ffd23f');
        center(ctx, `RANK ${results.rank}`, 92, W, '#7cf8ff');
        center(ctx, `SCORE ${score}`, 116, W, '#ffffff');
        center(ctx, `MAX COMBO ${maxCombo}`, 130, W, '#ffffff');
        center(ctx, `PERFECT ${counts.PERFECT}`, 154, W, '#7cf8ff');
        center(ctx, `GREAT ${counts.GREAT}`, 166, W, '#8cff8c');
        center(ctx, `GOOD ${counts.GOOD}`, 178, W, '#ffd23f');
        center(ctx, `MISS ${counts.MISS}`, 190, W, '#ff5a6a');
        center(ctx, `${Math.round(results.acc * 1000) / 10}%`, 214, W, '#ffffff');
      }
    });
    return () => {
      stop();
      closeFull();
      ended = true;
      try { src.stop(); } catch { /* 이미 멈춤 */ }
      document.removeEventListener('keydown', kd);
      document.removeEventListener('keyup', ku);
    };
  }

  return () => { cleanup?.(); ac.close?.(); };
}
