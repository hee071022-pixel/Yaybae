// 오목: 길드원끼리 1대1 (서버가 판을 들고 있음), 관전, 컴퓨터와 연습.
// 15x15, 흑이 먼저, 5개 이상 이으면 승리 (자유룰). 한 수에 60초.
import { $, toast } from './common.js';

const N = 15;
const TURN_MS = 60000;
const REASON = { five: '오목 완성', resign: '기권', timeout: '시간 초과', full: '판이 가득 참', cancel: '방 취소', expired: '시간이 지나 방이 닫힘' };

// ---------- 컴퓨터 (공격·수비 점수로 자리 고르기) ----------
// 한 줄(가운데에 내 돌을 놓았다고 치고 양쪽 4칸)을 글자로 바꿔 모양을 찾음. X=내 돌, _=빈칸, O=막힘
const PATTERNS = [
  ['five', 1e7, ['XXXXX']],
  ['open4', 2e5, ['_XXXX_']],
  ['four', 1.2e4, ['XXXX_', '_XXXX', 'XXX_X', 'X_XXX', 'XX_XX']],
  ['open3', 6e3, ['_XXX__', '__XXX_', '_XX_X_', '_X_XX_']],
  ['three', 500, ['XXX__', '__XXX', 'XX_X_', '_X_XX', 'X_XX_', '_XX_X', 'X__XX', 'XX__X', 'X_X_X', 'OXXX_', '_XXXO']],
  ['open2', 300, ['__XX__', '_X_X_', '_XX__', '__XX_']],
  ['two', 40, ['XX___', '___XX', 'X_X__', '__X_X']],
];
function lineScore(b, x, y, c) {
  let total = 0, fours = 0, threes = 0;
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let str = '';
    for (let k = -5; k <= 5; k++) {
      const i = x + dx * k, j = y + dy * k;
      if (k === 0) str += 'X';
      else if (i < 0 || j < 0 || i >= N || j >= N) str += 'O';
      else { const v = b[j * N + i]; str += v === c ? 'X' : v === '.' ? '_' : 'O'; }
    }
    // 가운데(5번째 글자)를 지나는 모양 중 가장 센 것 하나만
    for (const [name, score, pats] of PATTERNS) {
      const hit = pats.some((pt) => { for (let st = Math.max(0, 5 - pt.length + 1); st <= 5; st++) if (str.substr(st, pt.length) === pt) return true; return false; });
      if (!hit) continue;
      total += score;
      if (name === 'four' || name === 'open4') fours++;
      if (name === 'open3') threes++;
      break;
    }
  }
  if (fours >= 2 || (fours && threes)) total += 1e5; // 4-4, 4-3 은 사실상 이김
  if (threes >= 2) total += 2e4; // 3-3
  return total;
}
export function aiMove(board, me, level) {
  const opp = me === 'B' ? 'W' : 'B';
  if (!board.includes('B') && !board.includes('W')) return [7, 7];
  const cand = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (board[y * N + x] !== '.') continue;
    let near = false;
    for (let j = -2; j <= 2 && !near; j++) for (let i = -2; i <= 2; i++) {
      const a = x + i, c = y + j;
      if (a >= 0 && c >= 0 && a < N && c < N && board[c * N + a] !== '.') { near = true; break; }
    }
    if (!near) continue;
    const atk = lineScore(board, x, y, me);
    const def = lineScore(board, x, y, opp);
    const center = 7 - Math.max(Math.abs(x - 7), Math.abs(y - 7));
    let v = atk * 1.1 + def * (level === 'easy' ? 0.55 : 1) + center;
    if (level !== 'hard') v *= 1 + Math.random() * (level === 'easy' ? 0.9 : 0.25);
    cand.push({ x, y, v });
  }
  cand.sort((a, b) => b.v - a.v);
  // 쉬움: 가끔 두 번째·세 번째 자리로 (단, 바로 이기거나 막아야 할 땐 안 놓침)
  if (level === 'easy' && cand.length > 2 && cand[0].v < 1e5 && Math.random() < 0.35) { const c = cand[1 + Math.floor(Math.random() * 2)]; return [c.x, c.y]; }
  return [cand[0].x, cand[0].y];
}
function lineAt(b, x, y) {
  const c = b[y * N + x];
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const cells = [[x, y]];
    for (const s of [1, -1]) {
      let i = x + dx * s, j = y + dy * s;
      while (i >= 0 && j >= 0 && i < N && j < N && b[j * N + i] === c) { cells.push([i, j]); i += dx * s; j += dy * s; }
    }
    if (cells.length >= 5) return cells;
  }
  return null;
}

// ---------- 바둑판 그리기 ----------
function makeBoard(canvas, onPick) {
  const PAD = 24, CELL = 32, SIZE = PAD * 2 + CELL * (N - 1);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = SIZE * dpr; canvas.height = SIZE * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  let hover = null;
  let last = { board: '.'.repeat(N * N), moves: [], line: null, canPlay: false, color: 'B' };
  // 나뭇결: 한 번만 그려 둠
  const wood = document.createElement('canvas');
  wood.width = SIZE * dpr; wood.height = SIZE * dpr;
  const w = wood.getContext('2d');
  w.scale(dpr, dpr);
  w.fillStyle = '#d9ae62'; w.fillRect(0, 0, SIZE, SIZE);
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 70; i++) {
    const y0 = rnd() * SIZE, amp = 2 + rnd() * 6, freq = 0.004 + rnd() * 0.01;
    w.strokeStyle = `rgba(${120 + rnd() * 40},${70 + rnd() * 30},${20 + rnd() * 20},${0.06 + rnd() * 0.1})`;
    w.lineWidth = 0.6 + rnd() * 1.6;
    w.beginPath();
    for (let x = 0; x <= SIZE; x += 6) { const y = y0 + Math.sin(x * freq + i) * amp; x ? w.lineTo(x, y) : w.moveTo(x, y); }
    w.stroke();
  }
  w.strokeStyle = '#3b2a12'; w.lineWidth = 1;
  for (let i = 0; i < N; i++) {
    const p = PAD + i * CELL + 0.5;
    w.beginPath(); w.moveTo(PAD + 0.5, p); w.lineTo(PAD + CELL * (N - 1) + 0.5, p); w.stroke();
    w.beginPath(); w.moveTo(p, PAD + 0.5); w.lineTo(p, PAD + CELL * (N - 1) + 0.5); w.stroke();
  }
  w.lineWidth = 2; w.strokeRect(PAD, PAD, CELL * (N - 1), CELL * (N - 1));
  w.fillStyle = '#3b2a12';
  for (const [x, y] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) { w.beginPath(); w.arc(PAD + x * CELL + 0.5, PAD + y * CELL + 0.5, 3.5, 0, Math.PI * 2); w.fill(); }

  function stone(x, y, c, alpha = 1) {
    const cx = PAD + x * CELL + 0.5, cy = PAD + y * CELL + 0.5, r = CELL * 0.46;
    g.save();
    g.globalAlpha = alpha;
    if (alpha === 1) { g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.arc(cx + 1.5, cy + 2, r, 0, Math.PI * 2); g.fill(); }
    const grd = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    if (c === 'B') { grd.addColorStop(0, '#5a5a5a'); grd.addColorStop(1, '#0d0d0d'); } else { grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#cfcac0'); }
    g.fillStyle = grd;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    if (c === 'W') { g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.stroke(); }
    g.restore();
  }
  function draw() {
    g.drawImage(wood, 0, 0, SIZE, SIZE);
    const { board, moves, line } = last;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = board[y * N + x]; if (c !== '.') stone(x, y, c); }
    // 수 번호 대신 마지막 수에 빨간 점
    const lm = moves[moves.length - 1];
    if (lm) { g.fillStyle = '#e03131'; g.beginPath(); g.arc(PAD + lm[0] * CELL + 0.5, PAD + lm[1] * CELL + 0.5, 4, 0, Math.PI * 2); g.fill(); }
    if (line) {
      const [a, b] = [line.reduce((p, q) => (q[0] + q[1] * 0.01 < p[0] + p[1] * 0.01 ? q : p)), line.reduce((p, q) => (q[0] + q[1] * 0.01 > p[0] + p[1] * 0.01 ? q : p))];
      g.strokeStyle = 'rgba(224,49,49,.85)'; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(PAD + a[0] * CELL, PAD + a[1] * CELL); g.lineTo(PAD + b[0] * CELL, PAD + b[1] * CELL); g.stroke();
    }
    if (hover && last.canPlay && board[hover[1] * N + hover[0]] === '.') stone(hover[0], hover[1], last.color, 0.45);
  }
  const cellOf = (ev) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.round((((ev.clientX - r.left) / r.width) * SIZE - PAD) / CELL);
    const y = Math.round((((ev.clientY - r.top) / r.height) * SIZE - PAD) / CELL);
    return x >= 0 && y >= 0 && x < N && y < N ? [x, y] : null;
  };
  canvas.addEventListener('pointermove', (ev) => { if (ev.pointerType !== 'mouse') return; const h = cellOf(ev); if (String(h) !== String(hover)) { hover = h; draw(); } });
  canvas.addEventListener('pointerleave', () => { hover = null; draw(); });
  // 폰: 한 번 누르면 미리보기, 같은 자리를 한 번 더 누르면 둠 (잘못 누르기 방지)
  let pending = null;
  canvas.addEventListener('click', (ev) => {
    const c = cellOf(ev);
    if (!c || !last.canPlay || last.board[c[1] * N + c[0]] !== '.') return;
    const touch = ev.pointerType ? ev.pointerType !== 'mouse' : matchMedia('(hover: none)').matches;
    if (touch && String(pending) !== String(c)) { pending = c; hover = c; draw(); return; }
    pending = null; hover = null;
    onPick(c[0], c[1]);
  });
  return { set(state) { if (state.board !== last.board || !state.canPlay) pending = null; last = { ...last, ...state }; draw(); } };
}

export function setupOmok({ api, esc, getUser }) {
  const root = $('#omok-area');
  root.innerHTML = `
    <div class="om-players" id="om-players"></div>
    <div class="om-timer"><i id="om-timer"></i></div>
    <canvas class="om-board" id="om-board" aria-label="오목판"></canvas>
    <p class="om-msg" id="om-msg">오른쪽에서 방을 만들거나 컴퓨터와 둬 보세요.</p>
    <div class="om-ctl" id="om-ctl"></div>`;
  const board = makeBoard($('#om-board'), (x, y) => play(x, y));
  const s = { mode: 'idle', game: null, ai: null, lobby: null, timer: null, busy: false, shownEnd: null };
  const me = () => getUser()?.id || null;

  function render() {
    const g = s.mode === 'ai' ? s.ai : s.game;
    const players = $('#om-players');
    if (!g) {
      players.innerHTML = '<span class="muted small">대국 없음</span>';
      board.set({ board: '.'.repeat(N * N), moves: [], line: null, canPlay: false });
      $('#om-ctl').innerHTML = '';
      $('#om-timer').style.width = '0';
      return;
    }
    const blackName = s.mode === 'ai' ? (g.human === 'B' ? '나' : `컴퓨터 (${g.levelName})`) : g.black || g.host;
    const whiteName = s.mode === 'ai' ? (g.human === 'W' ? '나' : `컴퓨터 (${g.levelName})`) : g.white || (g.guest || '기다리는 중…');
    const turn = g.status === 'playing' ? g.turn : null;
    players.innerHTML = `<span class="om-p${turn === 'B' ? ' on' : ''}"><i class="om-st b"></i>${esc(blackName)}</span><span class="om-vs">vs</span><span class="om-p${turn === 'W' ? ' on' : ''}"><i class="om-st w"></i>${esc(whiteName)}</span>`;
    const myColor = s.mode === 'ai' ? g.human : g.black === me() ? 'B' : g.white === me() ? 'W' : null;
    const canPlay = g.status === 'playing' && myColor && g.turn === myColor && !s.busy;
    board.set({ board: g.board, moves: g.moves, line: g.line || null, canPlay, color: myColor || 'B' });
    let msg = '';
    if (g.status === 'open') msg = g.target ? `${esc(g.target)}님이 들어오기를 기다리고 있어요.` : '상대를 기다리고 있어요. 들어오면 흑·백이 무작위로 정해져요.';
    else if (g.status === 'playing') msg = !myColor ? `관전 중 · ${g.turn === 'B' ? '흑' : '백'} 차례 (${g.moves.length}수)` : g.turn === myColor ? '<b>내 차례예요.</b> 둘 자리를 누르세요.' : '상대가 생각하고 있어요…';
    else {
      const winName = s.mode === 'ai' ? (g.winner === 'me' ? '나' : g.winner === 'ai' ? '컴퓨터' : null) : g.winner;
      msg = `<b>${winName ? `${esc(winName)} 승리!` : g.reason === 'full' ? '무승부' : '대국 끝'}</b> · ${REASON[g.reason] || ''}`;
    }
    $('#om-msg').innerHTML = msg;
    if (canPlay && matchMedia('(hover: none)').matches) $('#om-msg').innerHTML += '<br><span class="muted small">폰: 같은 자리를 두 번 누르면 놓여요.</span>';
    const btns = [];
    if (s.mode === 'online' && g.status === 'open' && g.host === me()) btns.push('<button class="ghost" data-o="cancel">방 취소</button>');
    if ((s.mode === 'online' || s.mode === 'ai') && g.status === 'playing' && myColor) btns.push('<button class="ghost danger" data-o="resign">기권</button>');
    if (s.mode === 'ai' && g.status === 'done') btns.push('<button data-o="again">한 판 더</button>');
    if (s.mode !== 'idle' && (g.status === 'done' || s.mode === 'watch')) btns.push('<button class="ghost" data-o="leave">나가기</button>');
    $('#om-ctl').innerHTML = btns.join('');
    tick();
  }
  function tick() {
    const g = s.mode === 'online' || s.mode === 'watch' ? s.game : null;
    const el = $('#om-timer');
    if (!g || g.status !== 'playing') { el.style.width = '0'; return; }
    const left = Math.max(0, (g.turnLeft ?? TURN_MS) - (Date.now() - g._got));
    el.style.width = `${(left / TURN_MS) * 100}%`;
    el.classList.toggle('low', left < 10000);
  }

  async function play(x, y) {
    if (s.mode === 'ai') return aiPlay(x, y);
    if (s.busy) return;
    s.busy = true;
    try {
      const r = await api('/me/omok/move', { id: s.game.id, x, y });
      setGame(r.current);
    } catch (err) { toast(err.message, true); }
    s.busy = false;
    render();
  }
  function setGame(g) {
    if (!g) { s.game = null; return; }
    g._got = Date.now();
    const ended = g.status === 'done' && s.game?.status !== 'done' && s.shownEnd !== g.id;
    s.game = g;
    if (ended && g.guest) {
      s.shownEnd = g.id;
      if (g.winner === me()) toast('이겼어요! 🎉');
      else if (g.winner && (g.black === me() || g.white === me())) toast(`졌어요 · ${REASON[g.reason]}`);
      loadLobby();
    }
  }

  // ---------- 컴퓨터와 두기 ----------
  function startAi(level) {
    stopPoll();
    const human = Math.random() < 0.5 ? 'B' : 'W';
    s.mode = 'ai';
    s.ai = { board: '.'.repeat(N * N), moves: [], turn: 'B', status: 'playing', human, level, levelName: { easy: '쉬움', normal: '보통', hard: '어려움' }[level], line: null, winner: null };
    render();
    if (human === 'W') setTimeout(aiTurn, 400);
  }
  function aiPut(x, y, c) {
    const g = s.ai;
    const i = y * N + x;
    g.board = g.board.slice(0, i) + c + g.board.slice(i + 1);
    g.moves = [...g.moves, [x, y]];
    g.turn = c === 'B' ? 'W' : 'B';
    const line = lineAt(g.board, x, y);
    if (line) { g.status = 'done'; g.line = line; g.reason = 'five'; g.winner = c === g.human ? 'me' : 'ai'; toast(g.winner === 'me' ? '컴퓨터를 이겼어요! 🎉' : '컴퓨터가 이겼어요.'); }
    else if (!g.board.includes('.')) { g.status = 'done'; g.reason = 'full'; }
  }
  function aiPlay(x, y) {
    const g = s.ai;
    if (g.status !== 'playing' || g.turn !== g.human || s.busy) return;
    aiPut(x, y, g.human);
    render();
    if (g.status === 'playing') { s.busy = true; setTimeout(aiTurn, 350 + Math.random() * 300); }
  }
  function aiTurn() {
    const g = s.ai;
    s.busy = false;
    if (s.mode !== 'ai' || g.status !== 'playing') return render();
    const ai = g.human === 'B' ? 'W' : 'B';
    const [x, y] = aiMove(g.board, ai, g.level);
    aiPut(x, y, ai);
    render();
  }

  // ---------- 온라인 ----------
  async function poll() {
    if (s.mode !== 'online' && s.mode !== 'watch') return;
    try {
      const r = await api(`/omok/${s.game.id}`);
      if (!s.busy) { setGame(r.game); render(); }
    } catch { /* 다음에 */ }
  }
  function startPoll() { stopPoll(); s.timer = setInterval(() => { if (document.visibilityState === 'visible') poll(); }, 1300); s.tickT = setInterval(tick, 250); }
  function stopPoll() { clearInterval(s.timer); clearInterval(s.tickT); s.timer = null; }

  async function loadLobby() {
    const side = $('#omok-side');
    if (!getUser()) {
      side.innerHTML = '<div class="card"><h2>오목</h2><p class="muted small">로그인하면 길드원과 둘 수 있어요. 컴퓨터와는 지금 바로 둘 수 있어요.</p><div class="om-ai">' + aiButtons() + '</div></div>';
      return;
    }
    try { s.lobby = await api('/me/omok'); } catch (err) { side.innerHTML = `<div class="card empty">${esc(err.message)}</div>`; return; }
    const L = s.lobby;
    if (L.current && s.mode !== 'ai' && s.mode !== 'watch' && (s.mode === 'idle' || s.game?.id === L.current.id || L.current.status !== 'done')) {
      if (s.mode === 'idle' || s.game?.id !== L.current.id) { s.mode = 'online'; startPoll(); }
      setGame(L.current);
      render();
    }
    const st = L.stats;
    const busy = L.current && L.current.status !== 'done';
    side.innerHTML = `
      <div class="card stack">
        <h2>대국 시작 <span class="sub">전적 ${st.win}승 ${st.loss}패${st.draw ? ` ${st.draw}무` : ''}</span></h2>
        <form class="om-new" id="om-new"><input id="om-target" maxlength="16" placeholder="상대 닉네임 (비우면 누구나)" ${busy ? 'disabled' : ''}><button ${busy ? 'disabled' : ''}>방 만들기</button></form>
        <div><span class="muted small">컴퓨터와 연습 (기록 안 남음)</span><div class="om-ai">${aiButtons()}</div></div>
      </div>
      <div class="card">
        <h2>기다리는 방</h2>
        <ul class="om-list">${L.open.length ? L.open.map((g) => `<li><b>${esc(g.host)}</b>${g.target ? ' <span class="badge">나를 지정</span>' : ''}<button class="sm" data-join="${g.id}" ${busy ? 'disabled' : ''}>참가</button></li>`).join('') : '<li class="muted small">기다리는 방이 없어요. 방을 만들어 보세요.</li>'}</ul>
        ${L.playing.length ? `<h3 class="sec-title">대국 중</h3><ul class="om-list">${L.playing.map((g) => `<li>${esc(g.black)} <span class="muted">vs</span> ${esc(g.white)} <span class="muted small">${g.moves.length}수</span><button class="ghost sm" data-watch="${g.id}">관전</button></li>`).join('')}</ul>` : ''}
      </div>
      <div class="card">
        <h2>오목 순위</h2>
        <ol class="lb">${L.ranking.length ? L.ranking.map((r) => `<li class="${r.user === me() ? 'me' : ''}"><span class="lb-rank">${r.rank}</span><span class="lb-user">${esc(r.user)}</span><b>${r.win}승 ${r.loss}패</b></li>`).join('') : '<li class="muted small">아직 대국이 없어요.</li>'}</ol>
      </div>
      ${L.recent.length ? `<div class="card"><h2>최근 대국</h2><ul class="om-list">${L.recent.map((g) => `<li><span>${g.winner ? `<b>${esc(g.winner)}</b> 승` : '무승부'} <span class="muted small">${esc(g.black)} vs ${esc(g.white)} · ${REASON[g.reason] || ''} · ${g.moves.length}수</span></span><button class="ghost sm" data-watch="${g.id}">기보</button></li>`).join('')}</ul></div>` : ''}`;
  }
  const aiButtons = () => '<button class="ghost sm" data-ai="easy">쉬움</button><button class="ghost sm" data-ai="normal">보통</button><button class="ghost sm" data-ai="hard">어려움</button>';

  $('#omok-side').addEventListener('submit', async (e) => {
    if (e.target.id !== 'om-new') return;
    e.preventDefault();
    try {
      const r = await api('/me/omok', { target: $('#om-target').value.trim() });
      s.mode = 'online'; setGame(r.current); startPoll(); render(); loadLobby();
    } catch (err) { toast(err.message, true); }
  });
  $('#omok-side').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.ai) { startAi(b.dataset.ai); return; }
    if (b.dataset.join) {
      try { const r = await api('/me/omok/join', { id: b.dataset.join }); s.mode = 'online'; setGame(r.current); startPoll(); render(); loadLobby(); } catch (err) { toast(err.message, true); loadLobby(); }
    }
    if (b.dataset.watch) {
      try { const r = await api(`/omok/${b.dataset.watch}`); s.mode = 'watch'; setGame(r.game); if (r.game.status === 'playing') startPoll(); render(); $('#omok-area').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (err) { toast(err.message, true); }
    }
  });
  $('#om-ctl').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-o]');
    if (!b) return;
    const o = b.dataset.o;
    if (o === 'again') return startAi(s.ai.level);
    if (o === 'leave') { stopPoll(); s.mode = 'idle'; s.game = null; s.ai = null; render(); loadLobby(); return; }
    if (o === 'resign' && !confirm('기권할까요? 지는 걸로 기록돼요.')) return;
    if (s.mode === 'ai' && o === 'resign') { s.ai.status = 'done'; s.ai.reason = 'resign'; s.ai.winner = 'ai'; render(); return; }
    try {
      const r = await api(`/me/omok/${o}`, { id: s.game.id });
      setGame(r.current);
      render();
      loadLobby();
    } catch (err) { toast(err.message, true); }
  });

  render();
  // 테스트용 (주소에 ?debug 가 있을 때만)
  if (location.search.includes('debug')) window.__omok = s;
  return {
    show() {
      loadLobby();
      if ((s.mode === 'online' || s.mode === 'watch') && s.game?.status !== 'done') startPoll();
      clearInterval(s.lobbyT);
      s.lobbyT = setInterval(() => { if (document.visibilityState === 'visible') loadLobby(); }, 8000);
    },
    hide() { stopPoll(); clearInterval(s.lobbyT); },
    refresh: loadLobby,
  };
}
