// 미니게임 (보상 없음): 게임마다 개인 최고 기록과 길드 순위만 남긴다.
import { $, $$, esc, toast } from './common.js';
import { bubbleShooter, bubbleJump, infiniteStairs, jumpKing } from './arcade.js';
import { rhythmGame } from './rhythm.js';

export const GAME_LIST = [
  { id: 'reaction', name: '반응속도', desc: '초록색으로 바뀌면 바로 누르세요. 3번 평균이 기록이에요.' },
  { id: 'touch', name: '1 to 25', desc: '1부터 25까지 순서대로 빠르게 누르세요.' },
  { id: 'memory', name: '카드 짝맞추기', desc: '같은 그림 두 장을 찾아 모두 맞추세요. 적게 뒤집을수록 좋아요.' },
  { id: 'g2048', name: '2048', desc: '방향키나 화면을 밀어서 같은 숫자를 합치세요.' },
  { id: 'rhythm', name: '리듬 게임', desc: '내 노래 파일을 고르면 박자에 맞춰 노트가 만들어져요. 떨어지는 노트가 선에 닿을 때 누르세요!' },
  { id: 'jumpking', name: '점프킹', desc: '꾹 눌러 힘을 모으고 떼서 점프! 공중에선 방향을 못 바꾸고 벽에 튕겨요. 6층 크리스탈 탑 꼭대기 왕관을 잡으세요.' },
  { id: 'stairs', name: '무한의 계단', desc: '크리스탈 토끼를 끝없이 올려 보내세요. 계단 방향이 바뀌면 방향 바꾸기! 시간이 다 되거나 헛디디면 끝.' },
  { id: 'bubble', name: '버블 슈터', desc: '조준해서 방울을 쏘고 같은 색 3개 이상을 붙여 터뜨리세요. 7발마다 천장이 내려와요.' },
  { id: 'jump', name: '버블 점프', desc: '방울을 쏴서 적을 가두고, 떠오른 방울에 닿아 터뜨리세요. 적을 모두 잡으면 다음 스테이지!' },
];

export function fmtScore(game, v) {
  if (v == null) return '-';
  if (game === 'reaction') return `${v}ms`;
  if (game === 'touch') return `${(v / 1000).toFixed(2)}초`;
  if (game === 'memory') return `${v}번`;
  if (game === 'stairs') return `${v.toLocaleString()}칸`;
  return `${v.toLocaleString()}점`;
}

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ---------- 반응속도 ----------
function reaction(area, finish) {
  let state = 'idle';
  let timer = null;
  let startAt = 0;
  const times = [];
  area.innerHTML = '<button type="button" class="rx-box idle" id="rx"><b>시작</b><span>눌러서 시작하세요</span></button><div class="rx-times" id="rx-times"></div>';
  const box = $('#rx', area);
  const set = (cls, title, sub) => {
    box.className = `rx-box ${cls}`;
    box.innerHTML = `<b>${title}</b><span>${sub}</span>`;
  };
  const showTimes = () => {
    $('#rx-times', area).innerHTML = [0, 1, 2].map((i) => `<span>${i + 1}회 <b>${times[i] != null ? `${times[i]}ms` : '-'}</b></span>`).join('');
  };
  const wait = () => {
    state = 'wait';
    set('wait', '기다리세요…', '초록색이 되면 누르세요');
    timer = setTimeout(() => {
      state = 'go';
      startAt = performance.now();
      set('go', '지금!', '누르세요');
    }, 1200 + Math.random() * 2600);
  };
  showTimes();
  box.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state === 'idle' || state === 'early' || state === 'next') return wait();
    if (state === 'wait') {
      clearTimeout(timer);
      state = 'early';
      return set('early', '너무 빨라요', '눌러서 다시 하기');
    }
    if (state === 'go') {
      times.push(Math.round(performance.now() - startAt));
      showTimes();
      if (times.length < 3) {
        state = 'next';
        return set('idle', `${times.at(-1)}ms`, '눌러서 다음 시도');
      }
      const avg = Math.round(times.reduce((a, b) => a + b, 0) / 3);
      state = 'done';
      set('done', `평균 ${avg}ms`, '아래 다시 하기를 누르면 새로 시작해요');
      finish(avg);
    }
  });
  return () => clearTimeout(timer);
}

// ---------- 1 to 25 ----------
function touch(area, finish) {
  let next = 1;
  let startAt = 0;
  let tick = null;
  area.innerHTML = `<div class="tt-bar"><span>다음 숫자 <b id="tt-next">1</b></span><span id="tt-time">0.00초</span></div>
    <div class="tt-grid" id="tt-grid"></div>`;
  const grid = $('#tt-grid', area);
  grid.innerHTML = shuffle(Array.from({ length: 25 }, (_, i) => i + 1)).map((n) => `<button type="button" data-n="${n}">${n}</button>`).join('');
  const time = () => ((performance.now() - startAt) / 1000).toFixed(2);
  grid.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-n]');
    if (!b || b.disabled) return;
    e.preventDefault();
    if (+b.dataset.n !== next) {
      b.classList.remove('miss');
      void b.offsetWidth;
      b.classList.add('miss');
      return;
    }
    if (next === 1) {
      startAt = performance.now();
      tick = setInterval(() => ($('#tt-time', area).textContent = `${time()}초`), 50);
    }
    b.disabled = true;
    b.classList.add('ok');
    next++;
    $('#tt-next', area).textContent = next <= 25 ? next : '끝';
    if (next > 25) {
      clearInterval(tick);
      const ms = Math.round(performance.now() - startAt);
      $('#tt-time', area).textContent = `${(ms / 1000).toFixed(2)}초`;
      finish(ms);
    }
  });
  return () => clearInterval(tick);
}

// ---------- 카드 짝맞추기 ----------
const FACES = [['♠', '#2b2550'], ['♥', '#d6334f'], ['♦', '#e07b00'], ['♣', '#1f7a4d'], ['★', '#c79a00'], ['●', '#2f6fd6'], ['▲', '#7b3fc4'], ['■', '#5a5a5a']];
function memory(area, finish) {
  const deck = shuffle([...FACES.keys(), ...FACES.keys()]);
  let open = [];
  let moves = 0;
  let found = 0;
  let lock = false;
  area.innerHTML = `<div class="tt-bar"><span>뒤집은 횟수 <b id="mm-moves">0</b></span><span>찾은 짝 <b id="mm-found">0</b> / 8</span></div>
    <div class="mm-grid" id="mm-grid">${deck.map((f, i) => `<button type="button" class="mm-card" data-i="${i}"><span style="color:${FACES[f][1]}">${FACES[f][0]}</span></button>`).join('')}</div>`;
  const grid = $('#mm-grid', area);
  let timer = null;
  grid.addEventListener('click', (e) => {
    const c = e.target.closest('.mm-card');
    if (!c || lock || c.classList.contains('up')) return;
    c.classList.add('up');
    open.push(c);
    if (open.length < 2) return;
    moves++;
    $('#mm-moves', area).textContent = moves;
    const [a, b] = open;
    if (deck[a.dataset.i] === deck[b.dataset.i]) {
      a.classList.add('done');
      b.classList.add('done');
      open = [];
      found++;
      $('#mm-found', area).textContent = found;
      if (found === 8) finish(moves);
      return;
    }
    lock = true;
    timer = setTimeout(() => {
      a.classList.remove('up');
      b.classList.remove('up');
      open = [];
      lock = false;
    }, 700);
  });
  return () => clearTimeout(timer);
}

// ---------- 2048 ----------
function g2048(area, finish) {
  let board = Array(16).fill(0);
  let score = 0;
  let over = false;
  area.innerHTML = `<div class="tt-bar"><span>점수 <b id="tw-score">0</b></span><button type="button" class="link" id="tw-stop">그만하고 기록 저장</button></div>
    <div class="tw-grid" id="tw-grid" tabindex="0" aria-label="2048 게임판, 방향키로 움직이기"></div>`;
  const grid = $('#tw-grid', area);
  const add = () => {
    const empty = board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    if (empty.length) board[empty[Math.floor(Math.random() * empty.length)]] = Math.random() < 0.9 ? 2 : 4;
  };
  const draw = () => {
    grid.innerHTML = board.map((v) => `<div class="tw-cell${v ? ` v${Math.min(v, 4096)}` : ''}">${v || ''}</div>`).join('');
    $('#tw-score', area).textContent = score.toLocaleString();
  };
  // 한 줄을 앞으로 밀고 합치기
  const slide = (line) => {
    const nums = line.filter(Boolean);
    const out = [];
    for (let i = 0; i < nums.length; i++) {
      if (nums[i] === nums[i + 1]) {
        out.push(nums[i] * 2);
        score += nums[i] * 2;
        i++;
      } else out.push(nums[i]);
    }
    while (out.length < 4) out.push(0);
    return out;
  };
  const lines = (dir) => {
    const idx = [];
    for (let r = 0; r < 4; r++) {
      const row = [];
      for (let c = 0; c < 4; c++) {
        if (dir === 'left') row.push(r * 4 + c);
        if (dir === 'right') row.push(r * 4 + (3 - c));
        if (dir === 'up') row.push(c * 4 + r);
        if (dir === 'down') row.push((3 - c) * 4 + r);
      }
      idx.push(row);
    }
    return idx;
  };
  const canMove = () => board.some((v, i) => !v || (i % 4 < 3 && v === board[i + 1]) || (i < 12 && v === board[i + 4]));
  const end = () => {
    if (over) return;
    over = true;
    $('#tw-stop', area).hidden = true;
    grid.insertAdjacentHTML('beforeend', `<div class="tw-over"><b>게임 끝</b><span>${score.toLocaleString()}점</span></div>`);
    finish(score);
  };
  const move = (dir) => {
    if (over) return;
    const before = board.join();
    for (const row of lines(dir)) {
      const moved = slide(row.map((i) => board[i]));
      row.forEach((i, k) => (board[i] = moved[k]));
    }
    if (board.join() === before) return;
    add();
    draw();
    if (!canMove()) end();
  };
  const keys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  const onKey = (e) => {
    if (!keys[e.key] || !area.isConnected || area.closest('.hidden')) return;
    e.preventDefault();
    move(keys[e.key]);
  };
  document.addEventListener('keydown', onKey);
  let sx = 0;
  let sy = 0;
  grid.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
  grid.addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  });
  $('#tw-stop', area).onclick = () => { if (score && confirm('여기서 끝내고 기록을 저장할까요?')) end(); };
  add();
  add();
  draw();
  grid.focus({ preventScroll: true });
  return () => document.removeEventListener('keydown', onKey);
}

const GAMES = { reaction, touch, memory, g2048, bubble: bubbleShooter, jump: bubbleJump, stairs: infiniteStairs, jumpking: jumpKing, rhythm: rhythmGame };

// 화면: 게임 고르기 · 플레이 · 순위
export function setupGames({ api, getUser }) {
  let current = 'reaction';
  let cleanup = null;
  $('#game-tabs').innerHTML = GAME_LIST.map((g) => `<button type="button" data-game="${g.id}">${g.name}</button>`).join('');
  $$('#game-tabs [data-game]').forEach((b) => (b.onclick = () => select(b.dataset.game)));
  $('#game-restart').onclick = () => start();

  async function board() {
    try {
      const d = await api(`/games/${current}`);
      $('#lb-count').textContent = d.players ? `${d.players}명` : '';
      const me = getUser()?.id;
      $('#lb-list').innerHTML = d.top.length
        ? d.top.map((r) => `<li class="${r.user === me ? 'me' : ''}"><span class="lb-rank">${r.rank}</span><span class="lb-user">${esc(r.user)}</span><b>${fmtScore(current, r.best)}</b></li>`).join('')
        : '<li class="muted small">아직 기록이 없어요. 첫 기록을 남겨 보세요!</li>';
      $('#game-best').innerHTML = d.mine ? `내 최고 <b>${fmtScore(current, d.mine.best)}</b> · ${d.mine.rank}위` : getUser() ? '아직 내 기록이 없어요' : '로그인하면 기록이 저장돼요';
    } catch (err) {
      $('#lb-list').innerHTML = `<li class="msg err">${esc(err.message)}</li>`;
    }
  }

  async function finish(score) {
    $('#game-restart').textContent = '다시 하기';
    if (!getUser()) {
      $('#game-msg').innerHTML = `기록 <b>${fmtScore(current, score)}</b> · <a href="#event">로그인</a>하면 순위에 올라가요.`;
      return;
    }
    try {
      const r = await api('/me/games/score', { game: current, score });
      $('#game-msg').innerHTML = r.isBest ? `<b class="plus-n">새 최고 기록!</b> ${fmtScore(current, score)}` : `기록 <b>${fmtScore(current, score)}</b> (최고 ${fmtScore(current, r.record.best)})`;
      board();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function start() {
    cleanup?.();
    const g = GAME_LIST.find((x) => x.id === current);
    $('#game-title').textContent = g.name;
    $('#game-desc').textContent = g.desc;
    $('#game-msg').textContent = '';
    $('#game-restart').textContent = '처음부터';
    cleanup = GAMES[current]($('#game-area'), finish);
  }

  function select(id) {
    current = id;
    $$('#game-tabs [data-game]').forEach((b) => b.classList.toggle('on', b.dataset.game === id));
    start();
    board();
  }

  return { show: () => select(current), stop: () => { cleanup?.(); cleanup = null; }, refresh: board };
}
