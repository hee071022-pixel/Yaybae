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

// ---------- 유튜브 ----------
export function youtubeId(url) {
  const s = String(url || '').trim();
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(s) ? s : null;
}
function loadYouTubeApi() {
  return new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const sc = document.createElement('script');
      sc.src = 'https://www.youtube.com/iframe_api';
      sc.onerror = () => reject(new Error('youtube'));
      document.head.appendChild(sc);
    }
    setTimeout(() => (window.YT?.Player ? resolve(window.YT) : reject(new Error('timeout'))), 12000);
  });
}

// 유튜브는 소리를 분석할 수 없어서 BPM 박자 격자 위에 노트를 놓는다 (4박 단위로 반복되는 패턴)
export function gridNotes(duration, bpm, offset, diffKey, seed = 1) {
  const beat = 60 / bpm;
  let x = seed % 233280 || 7;
  const r = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const density = { easy: [1, 0, 0], normal: [1, 0.35, 0.02], hard: [1, 0.7, 0.12] }[diffKey];
  // 2마디짜리 패턴을 몇 개 만들어 돌려 쓰기
  const patterns = Array.from({ length: 4 }, () => Array.from({ length: 16 }, (_, i) => {
    const onBeat = i % 2 === 0;
    const keep = onBeat ? r() < (diffKey === 'easy' ? (i % 4 === 0 ? 1 : 0.7) : 0.95) : r() < density[1];
    return keep ? { lane: Math.floor(r() * LANES), chord: r() < density[2] } : null;
  }));
  const notes = [];
  let prev = -1;
  const start = Math.max(0, offset) + beat * 4; // 첫 마디는 준비
  for (let t = start, i = 0; t < duration - 1; t += beat / 2, i++) {
    const p = patterns[Math.floor(i / 16) % 4][i % 16];
    if (!p) continue;
    let lane = p.lane;
    if (lane === prev && r() < 0.6) lane = (lane + 1 + Math.floor(r() * 3)) % LANES;
    notes.push({ t: Math.round(t * 1000) / 1000, lane });
    if (p.chord) notes.push({ t: Math.round(t * 1000) / 1000, lane: (lane + 2) % LANES });
    prev = lane;
  }
  return notes;
}

export function rhythmGame(area, finish) {
  area.innerHTML = `<div class="rh-setup" id="rh-setup">
      <div class="rh-row">
        <label class="rh-file"><input type="file" id="rh-file" accept="audio/*"><span>내 노래 고르기</span></label>
      </div>
      <div class="rh-row rh-yt-row">
        <input id="rh-yt-url" placeholder="유튜브 링크 붙여넣기" autocomplete="off" inputmode="url">
        <button type="button" class="ghost" id="rh-yt-load">불러오기</button>
      </div>
      <div class="rh-yt-opts hidden" id="rh-yt-opts">
        <div class="rh-row">
          <label class="rh-num">BPM <input id="rh-bpm" type="number" min="50" max="240" step="0.5" value="120"></label>
          <label class="rh-num">첫 박(초) <input id="rh-offset" type="number" min="0" max="60" step="0.05" value="0"></label>
          <button type="button" class="ghost sm" id="rh-tap">박자 탭 (0)</button>
        </div>
        <p class="muted small" style="margin:0;text-align:center">위 영상을 재생한 채로 박자에 맞춰 <b>박자 탭</b>을 8번 이상 누르면 BPM과 첫 박이 자동으로 맞춰져요. 노래 BPM을 알면 직접 적어도 돼요.</p>
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
  // 유튜브 영상 자리 (화면이 바뀌어도 영상이 다시 로드되지 않게 따로 둠)
  area.insertAdjacentHTML('afterbegin', '<div class="rh-video hidden" id="rh-video"><div id="rh-yt-player"></div></div>');
  const $ = (q) => area.querySelector(q);
  let diff = 'normal';
  let buffer = null;
  let songName = '';
  let cleanup = null;
  let yt = null; // 유튜브 플레이어
  let source = 'file';
  let taps = [];

  area.querySelectorAll('#rh-diff [data-d]').forEach((b) => (b.onclick = () => {
    diff = b.dataset.d;
    area.querySelectorAll('#rh-diff [data-d]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  const ready = (name) => {
    source = 'file';
    $('#rh-yt-opts').classList.add('hidden');
    $('#rh-video').classList.add('hidden');
    yt?.pauseVideo?.();
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
  $('#rh-yt-load').onclick = async () => {
    const id = youtubeId($('#rh-yt-url').value);
    if (!id) { $('#rh-song').textContent = '유튜브 링크를 확인해 주세요. (youtube.com/watch?v=… 또는 youtu.be/…)'; return; }
    $('#rh-song').textContent = '유튜브 영상을 불러오는 중…';
    $('#rh-start').disabled = true;
    try {
      const YT = await loadYouTubeApi();
      $('#rh-video').classList.remove('hidden');
      const onReady = () => {
        source = 'yt';
        buffer = null;
        area.querySelectorAll('[data-song]').forEach((x) => x.classList.remove('on'));
        songName = yt.getVideoData?.().title || '유튜브 영상';
        const d = yt.getDuration();
        $('#rh-yt-opts').classList.remove('hidden');
        $('#rh-song').innerHTML = `유튜브: <b>${songName.replace(/[<>&]/g, '')}</b>${d ? ` · ${Math.floor(d / 60)}분 ${Math.floor(d % 60)}초` : ''}`;
        $('#rh-start').disabled = false;
        $('#rh-start').textContent = '시작하기';
      };
      const onError = () => { $('#rh-song').textContent = '이 영상은 재생할 수 없어요. (다른 사이트에서 재생을 막아 둔 영상일 수 있어요)'; $('#rh-start').disabled = true; };
      if (yt) { yt.cueVideoById(id); setTimeout(onReady, 1000); return; } // 이미 만든 플레이어는 영상만 바꿈
      yt = new YT.Player('rh-yt-player', {
        videoId: id, width: '100%', height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: { onReady, onError },
      });
    } catch {
      $('#rh-song').textContent = '유튜브를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.';
    }
  };
  // 박자 탭: 영상 시간 기준으로 간격의 중간값 → BPM, 첫 탭 위치 → 첫 박
  $('#rh-tap').onclick = () => {
    if (!yt) return;
    const now = yt.getCurrentTime();
    if (taps.length && now - taps[taps.length - 1] > 2) taps = [];
    taps.push(now);
    $('#rh-tap').textContent = `박자 탭 (${taps.length})`;
    if (taps.length >= 4) {
      const gaps = taps.slice(1).map((v, i) => v - taps[i]).sort((a, b) => a - b);
      const mid = gaps[Math.floor(gaps.length / 2)];
      if (mid > 0.2 && mid < 1.5) {
        const bpm = Math.round((60 / mid) * 2) / 2;
        const beat = 60 / bpm;
        $('#rh-bpm').value = bpm;
        $('#rh-offset').value = (taps[0] - Math.floor(taps[0] / beat) * beat).toFixed(2);
      }
    }
  };
  $('#rh-start').onclick = () => {
    if (source === 'yt') {
      const bpm = Number($('#rh-bpm').value) || 120;
      const offset = Number($('#rh-offset').value) || 0;
      const notes = gridNotes(yt.getDuration(), Math.min(240, Math.max(50, bpm)), offset, diff, [...songName].reduce((a, c) => a + c.charCodeAt(0), 0));
      $('#rh-setup').classList.add('hidden');
      $('#rh-stage').classList.remove('hidden');
      cleanup = play(notes, ytSource());
      return;
    }
    if (!buffer) return;
    const notes = detectNotes(buffer, diff);
    if (notes.length < 10) { $('#rh-song').textContent = '이 곡에서는 박자를 잘 못 찾았어요. 다른 곡을 골라 주세요.'; return; }
    $('#rh-setup').classList.add('hidden');
    $('#rh-stage').classList.remove('hidden');
    cleanup = play(notes, bufferSource());
  };

  // 재생 소스: 음악 파일(오디오 시계) / 유튜브(영상 시간)
  function bufferSource() {
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.connect(ac.destination);
    let startAt = 0;
    return {
      duration: buffer.duration,
      begin(lead) { ac.resume(); startAt = ac.currentTime + lead; src.start(startAt); },
      now: () => ac.currentTime - startAt,
      stop() { try { src.stop(); } catch { /* 이미 멈춤 */ } },
      onEnd(fn) { src.onended = fn; },
      ended: () => false,
    };
  }
  function ytSource() {
    let t0 = 0, started = false, timer = null, last = 0, lastAt = 0;
    return {
      duration: yt.getDuration(),
      begin(lead) {
        yt.pauseVideo();
        yt.seekTo(0, true);
        t0 = performance.now() + lead * 1000;
        timer = setTimeout(() => { yt.playVideo(); started = true; }, lead * 1000);
      },
      now() {
        if (!started) return (performance.now() - t0) / 1000;
        const ct = yt.getCurrentTime();
        // 영상 시간이 띄엄띄엄 바뀌면 그 사이를 이어 줌
        if (ct !== last) { last = ct; lastAt = performance.now(); return ct; }
        return yt.getPlayerState?.() === 1 ? ct + Math.min(0.25, (performance.now() - lastAt) / 1000) : ct;
      },
      stop() { clearTimeout(timer); yt.pauseVideo(); },
      onEnd() {},
      ended: () => started && yt.getPlayerState?.() === 0,
    };
  }

  function play(notes, media) {
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
      area.requestFullscreen?.().then(fit).catch(() => {}); // 영상도 같이 보이도록 게임 영역 전체를 전체 화면으로
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
    media.begin(lead);
    if (source === 'yt') area.classList.add('rh-yt-playing');
    const live = notes.map((n) => ({ ...n, done: false }));
    const pressed = [false, false, false, false];
    const flash = [0, 0, 0, 0];
    let score = 0, combo = 0, maxCombo = 0, judge = null, ended = false;
    const counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
    const now = () => media.now();
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
      media.stop();
      area.classList.remove('rh-yt-playing');
      const total = live.length;
      const acc = total ? (counts.PERFECT + counts.GREAT * 0.7 + counts.GOOD * 0.3) / total : 0;
      const rank = acc >= 0.95 ? 'S' : acc >= 0.85 ? 'A' : acc >= 0.7 ? 'B' : acc >= 0.5 ? 'C' : 'D';
      results = { acc, rank, quit };
      stage.querySelector('#rh-quit').textContent = '닫기';
      if (!quit || score > 0) finish(score);
    }
    let results = null;
    media.onEnd(() => end());
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
      if (media.ended() || t > media.duration + 0.5) end();
      const prog = Math.min(1, Math.max(0, t / media.duration));
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
      media.stop();
      area.classList.remove('rh-yt-playing');
      document.removeEventListener('keydown', kd);
      document.removeEventListener('keyup', ku);
    };
  }

  return () => { cleanup?.(); ac.close?.(); try { yt?.destroy?.(); } catch { /* 없음 */ } };
}
