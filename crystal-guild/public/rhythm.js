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

// ---------- 기본 곡: 120BPM 짧은 곡을 직접 합성 ----------
async function demoSong() {
  const sr = 44100, bpm = 124, beats = 64, len = (60 / bpm) * beats + 1.5;
  const ac = new OfflineAudioContext(2, Math.ceil(sr * len), sr);
  const b = 60 / bpm;
  const master = ac.createGain();
  master.gain.value = 0.55;
  master.connect(ac.destination);
  const noiseBuf = ac.createBuffer(1, sr * 0.3, sr);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const kick = (t) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.22);
  };
  const snare = (t, vol = 0.5) => {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf;
    f.type = 'highpass'; f.frequency.value = 1500;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    s.connect(f).connect(g).connect(master);
    s.start(t); s.stop(t + 0.16);
  };
  const tone = (t, freq, dur, type = 'square', vol = 0.12) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  };
  const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
  const melody = [0, 2, 4, 2, 3, 4, 5, 4, 2, 1, 0, 1, 2, 4, 3, 2];
  const bass = [130.81, 130.81, 174.61, 196];
  for (let i = 0; i < beats; i++) {
    const t = 0.5 + i * b;
    if (i % 4 === 0 || i % 4 === 2 || (i >= 32 && i % 2 === 1 && i % 8 === 7)) kick(t);
    if (i % 4 === 1 || i % 4 === 3) snare(t);
    tone(t, bass[Math.floor(i / 4) % 4], b * 0.9, 'triangle', 0.25);
    if (i >= 8) tone(t, scale[melody[i % 16]], b * 0.45, 'square', 0.08);
    if (i >= 24 && i % 2 === 1) tone(t + b / 2, scale[melody[(i + 5) % 16]], b * 0.3, 'square', 0.06);
  }
  return ac.startRendering();
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
        <button type="button" class="ghost" id="rh-demo">기본 곡으로 하기</button>
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
  $('#rh-demo').onclick = async () => {
    $('#rh-song').textContent = '기본 곡을 만드는 중…';
    buffer = await demoSong();
    ready('크리스탈 비트 (기본 곡)');
  };
  $('#rh-start').onclick = () => {
    if (!buffer) return;
    const notes = detectNotes(buffer, diff);
    if (notes.length < 10) { $('#rh-song').textContent = '이 곡에서는 박자를 잘 못 찾았어요. 다른 곡을 골라 주세요.'; return; }
    $('#rh-setup').classList.add('hidden');
    $('#rh-stage').classList.remove('hidden');
    cleanup = play(notes);
  };

  function play(notes) {
    const W = 240, H = 360, HIT = 316, LW = 48, X0 = 24;
    const stage = $('#rh-stage');
    stage.innerHTML = '';
    const { cv, ctx } = makeScreen(stage, W, H, 420);
    stage.insertAdjacentHTML('beforeend', `<div class="row" style="justify-content:space-between;margin-top:8px">
      <span class="muted small">PC: D F J K (또는 ← ↓ ↑ →) · 폰: 줄을 터치</span><button type="button" class="link" id="rh-quit">그만하기</button></div>`);
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
      if (!quit || score > 0) finish(score);
    }
    let results = null;
    src.onended = () => end();
    stage.querySelector('#rh-quit').onclick = () => end(true);

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
        text(ctx, 'DFJK'[l], x + LW / 2 - 2, HIT + 14, pressed[l] ? '#0c0b1d' : '#8a86b8', null);
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
      ended = true;
      try { src.stop(); } catch { /* 이미 멈춤 */ }
      document.removeEventListener('keydown', kd);
      document.removeEventListener('keyup', ku);
    };
  }

  return () => { cleanup?.(); ac.close?.(); };
}
