import {
  $, $$, esc, makeApi, ball, ballClass, winningBalls, entryBalls, rankBadge,
  STATUS_LABEL, fmtTime, fmtDate, toast, syncClock, phaseOf, periodLabel, fmtLeft, startCountdowns, prizeList, RULES, GEM_SVG, setupMenu, setupTheme,
} from './common.js';

const { api, getToken, setToken } = makeApi('crystal.user');
$('#gem').innerHTML = GEM_SVG;
setupTheme();

const state = { mode: 'login', me: null, picked: new Set(), queue: [], seenDraw: null };

// ---------- 로그인 / 가입 ----------

function setMode(mode) {
  state.mode = mode;
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === mode));
  $('#a-pw2-wrap').classList.toggle('hidden', mode !== 'signup');
  $('#a-pw').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('#auth-btn').textContent = mode === 'signup' ? '가입하고 시작하기' : '로그인';
  $('#auth-msg').textContent = '';
}
$$('.tabs button').forEach((b) => (b.onclick = () => setMode(b.dataset.tab)));

$('#auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#a-id').value.trim();
  const password = $('#a-pw').value;
  if (state.mode === 'signup' && password !== $('#a-pw2').value) {
    $('#auth-msg').textContent = '비밀번호 확인이 일치하지 않습니다.';
    return;
  }
  $('#auth-btn').disabled = true;
  try {
    const res = await api(state.mode === 'signup' ? '/signup' : '/login', { id, password });
    setToken(res.token);
    $('#a-pw').value = $('#a-pw2').value = '';
    await load();
    toast(state.mode === 'signup' ? `${res.user.id}님, 크리스탈 길드에 오신 걸 환영해요!` : `${res.user.id}님 환영합니다`);
  } catch (err) {
    $('#auth-msg').textContent = err.message;
  } finally {
    $('#auth-btn').disabled = false;
  }
};

$('#logout').onclick = () => {
  $('#login-link').classList.remove('hidden');
  setToken(null);
  state.me = null;
  state.pastKey = null;
  state.queue = [];
  state.picked.clear();
  showAuth();
};

async function showAuth() {
  $('#main').classList.add('hidden');
  $('#who').classList.add('hidden');
  $('#login-link').classList.remove('hidden');
  $('#auth').classList.remove('hidden');
  try {
    const { rounds } = await api('/history');
    const r = rounds[0];
    $('#public-latest').classList.toggle('hidden', !r);
    if (r) {
      $('#public-latest').innerHTML = `<h2>제${r.no}회 당첨번호 <span class="sub">${fmtTime(r.drawnAt)}</span></h2>
         <div class="result-hero">${winningBalls(r)}</div>
         <p class="muted small center">당첨 ${r.winners.length}줄 · 총 ${r.entryCount}줄 응모</p>`;
    }
  } catch {
    $('#public-latest').classList.add('hidden');
  }
}

// ---------- 메인 ----------

async function load() {
  if (!getToken()) return showAuth();
  try {
    state.me = await api('/me');
  } catch (err) {
    if (err.status === 401) {
      setToken(null);
      if (err.message) toast(err.message, true);
      return showAuth();
    }
    toast(err.message, true);
    return;
  }
  $('#auth').classList.add('hidden');
  $('#main').classList.remove('hidden');
  $('#who').classList.remove('hidden');
  $('#login-link').classList.add('hidden');
  render();
  if (location.hash === '' || location.hash === '#home') renderHomeLotto();
  const r = state.me.round;
  const key = r ? `${r.no}-${r.status}` : '-';
  if (key !== state.pastKey) {
    state.pastKey = key;
    loadPast();
  }
}

function render() {
  const { user, round, entries } = state.me;
  $('#who-name').textContent = user.id;
  $('#tickets').textContent = user.tickets;
  if (document.activeElement !== $('#dc-id')) $('#dc-id').value = user.discordId || '';
  $('#dc-state').innerHTML = user.discordId ? '<span class="badge open">연결됨</span>' : '<span class="badge">미연결</span>';

  $('#t-history').innerHTML = user.history.length
    ? user.history
        .slice(0, 8)
        .map(
          (h) => `<li><span class="${h.delta > 0 ? 'plus-n' : 'minus-n'}">${h.delta > 0 ? '+' : ''}${h.delta}</span>
            <span>${esc(h.reason)}</span><span class="muted small" style="margin-left:auto">${fmtTime(h.at)}</span></li>`,
        )
        .join('')
    : '<li class="muted">아직 내역이 없어요.</li>';

  renderRound(round, entries);
  renderPickArea();
  loadAllEntries(round);

  $('#my-count').textContent = entries.length ? `${entries.length}줄` : '';
  $('#my-entries').innerHTML = entries.length
    ? entries
        .map(
          (e, i) => `<div class="line"><span class="tag">${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}</span>
            ${entryBalls(e.numbers, round)}<span class="muted small">${e.auto ? '자동' : '수동'}</span>
            <span class="end">${rankBadge(e.rank)}</span></div>`,
        )
        .join('')
    : `<div class="empty">${round ? '이번 회차에 응모한 번호가 없어요.' : '아직 열린 회차가 없어요.'}</div>`;
}

// 누가 몇 번 찍었는지: 길드원별로 접었다 펼치기
function allEntriesHtml(data, me) {
  const { round, users } = data;
  if (!users.length) return '<div class="empty">아직 응모한 길드원이 없어요.</div>';
  return `<div class="entrant-list">${users
    .map((u) => {
      const ranks = u.lines.map((l) => l.rank).filter(Boolean);
      const best = ranks.length ? Math.min(...ranks) : 0;
      return `<details class="entrant${u.user === me ? ' me' : ''}"><summary>
        <b>${esc(u.user)}</b>${u.user === me ? '<span class="badge">나</span>' : ''}
        <span class="muted small">${u.lines.length}줄</span>
        <span class="end">${best ? `<span class="badge win">${best}등</span>` : ''}</span></summary>
        <div class="stack entrant-lines">${u.lines
          .map((l) => `<div class="row">${entryBalls(l.numbers, round)}<span class="muted small">${l.auto ? '자동' : '수동'}</span>${
            round.status === 'drawn' ? rankBadge(l.rank) : ''
          }</div>`)
          .join('')}</div></details>`;
    })
    .join('')}</div>`;
}

async function loadAllEntries(round) {
  const card = $('#all-card');
  card.classList.toggle('hidden', !round);
  if (!round) return;
  const key = `${round.no}:${round.entryCount}:${round.status}`;
  if (state.allKey === key) return;
  try {
    const data = await api(`/rounds/${round.no}/all`);
    state.allKey = key;
    $('#all-sum').textContent = `제${round.no}회 · ${data.users.length}명 · 총 ${data.total}줄`;
    $('#all-entries').innerHTML = allEntriesHtml(data, state.me?.user.id);
  } catch (err) {
    $('#all-entries').innerHTML = `<span class="msg err">${esc(err.message)}</span>`;
  }
}

function renderRound(round, entries) {
  const el = $('#round-card');
  if (!round) {
    el.innerHTML = `<h2>이번 회차</h2><div class="empty">운영자가 회차를 열면 응모할 수 있어요.</div><p class="muted small center">${RULES}</p>`;
    return;
  }
  syncClock(round.serverTime);
  const phase = phaseOf(round);
  const head = `<h2>제${round.no}회 <span class="badge ${phase}">${STATUS_LABEL[phase]}</span>
    <span class="sub">총 ${round.entryCount}줄 응모</span></h2>`;
  if (round.status === 'drawn') {
    const wins = entries.filter((e) => e.rank);
    const best = wins.length ? Math.min(...wins.map((e) => e.rank)) : 0;
    const animate = state.seenDraw !== round.no;
    state.seenDraw = round.no;
    el.innerHTML = `${head}
      <div class="result-hero stack">${winningBalls(round, { size: 'lg', pop: animate })}
        <p class="${best ? '' : 'muted'}" style="font-size:17px;font-weight:700">${
          best ? `축하해요! ${best}등 당첨 (${wins.length}줄)` : entries.length ? '아쉽게도 이번엔 낙첨이에요.' : '이번 회차에 응모하지 않았어요.'
        }</p></div>
      ${winnerTable(round)}
      <p class="muted small">다음 회차가 열리면 다시 응모할 수 있어요.</p>`;
    return;
  }
  el.innerHTML = `${head}<div class="stack">${periodBox(round, phase)}<div><b>상품</b></div>${prizeList(round.prizes)}
    <p class="muted small">${RULES}</p>
    <p class="muted small">${
      round.endAt && round.autoDraw ? '마감 시간이 되면 자동으로 추첨해요.' : '운영자가 추첨하면 결과가 여기에 표시돼요.'
    }</p></div>`;
}

function periodBox(round, phase) {
  const period = periodLabel(round);
  if (!period) return '';
  const count =
    phase === 'soon' ? `응모 시작까지 <b data-until="${round.startAt}">${fmtLeft(round.startAt - Date.now())}</b>`
    : phase === 'open' && round.endAt ? `마감까지 <b data-until="${round.endAt}">${fmtLeft(round.endAt - Date.now())}</b>`
    : phase === 'closed' ? (round.autoDraw ? '마감되었어요. 곧 추첨해요.' : '마감되었어요. 운영자 추첨을 기다리는 중이에요.')
    : '';
  return `<div class="period ${phase}"><div class="small muted">응모 기간</div><div class="period-time">${period}</div>${
    count ? `<div class="period-count">${count}</div>` : ''
  }</div>`;
}

function winnerTable(round) {
  if (!round.winners.length) return '<p class="muted small center">이번 회차 당첨자가 없어요.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>등수</th><th>길드원</th><th>상품</th></tr></thead><tbody>${round.winners
    .map((w) => `<tr><td class="num">${w.rank}등</td><td>${esc(w.user)}</td><td class="muted">${esc(round.prizes?.[w.rank] || '-')}</td></tr>`)
    .join('')}</tbody></table></div>`;
}

// ---------- 번호 선택 ----------

const picker = $('#picker');
for (let n = 1; n <= 45; n++) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = n;
  b.className = ballClass(n);
  b.onclick = () => {
    if (state.picked.has(n)) state.picked.delete(n);
    else if (state.picked.size < 6) state.picked.add(n);
    else return toast('6개까지 고를 수 있어요.', true);
    renderPicker();
  };
  picker.appendChild(b);
}

function renderPicker() {
  $$('#picker button').forEach((b, i) => b.classList.toggle('on', state.picked.has(i + 1)));
  $('#pick-count').textContent = `${state.picked.size} / 6`;
  $('#pick-add').disabled = state.picked.size !== 6 || !canAddLine();
}

const isOpen = () => phaseOf(state.me?.round) === 'open';
const canAddLine = () => isOpen() && state.queue.length < Math.min(state.me.user.tickets, 20);

function renderPickArea() {
  const open = isOpen();
  $('#pick-card').classList.toggle('hidden', !open);
  if (!open) return;
  const t = state.me.user.tickets;
  if (state.queue.length > t) state.queue.length = t;
  $('#queue-info').textContent = `${state.queue.length} / ${t}장`;
  $('#queue').innerHTML = state.queue.length
    ? state.queue
        .map(
          (q, i) => `<div class="line">${
            q === 'auto'
              ? `<div class="balls">${'<span class="ball sm r4">?</span>'.repeat(6)}</div><span class="muted small">자동</span>`
              : `<div class="balls">${q.map((n) => ball(n, { size: 'sm' })).join('')}</div>`
          }<button class="ghost sm end" data-rm="${i}" aria-label="삭제">✕</button></div>`,
        )
        .join('')
    : `<div class="empty">${t ? '번호를 골라 담거나 자동 줄을 추가하세요.' : '로또권이 없어요. 운영자에게 받으면 응모할 수 있어요.'}</div>`;
  $$('#queue [data-rm]').forEach((b) => (b.onclick = () => { state.queue.splice(+b.dataset.rm, 1); renderPickArea(); }));
  $('#add-auto').disabled = !canAddLine();
  $('#submit').disabled = !state.queue.length;
  $('#submit').textContent = state.queue.length ? `로또권 ${state.queue.length}장으로 응모하기` : '응모하기';
  renderPicker();
}

$('#pick-clear').onclick = () => { state.picked.clear(); renderPicker(); };
$('#pick-fill').onclick = () => {
  const pool = Array.from({ length: 45 }, (_, i) => i + 1).filter((n) => !state.picked.has(n));
  while (state.picked.size < 6) state.picked.add(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  renderPicker();
};
$('#pick-add').onclick = () => {
  if (!canAddLine()) return toast('보유한 로또권만큼만 담을 수 있어요.', true);
  state.queue.push([...state.picked].sort((a, b) => a - b));
  state.picked.clear();
  renderPickArea();
};
$('#add-auto').onclick = () => {
  if (!canAddLine()) return toast('보유한 로또권만큼만 담을 수 있어요.', true);
  state.queue.push('auto');
  renderPickArea();
};

$('#submit').onclick = async () => {
  const lines = state.queue.map((q) => (q === 'auto' ? 'auto' : { numbers: q }));
  $('#submit').disabled = true;
  try {
    const res = await api('/enter', { lines });
    state.me = res;
    state.queue = [];
    render();
    toast(`${lines.length}줄 응모 완료! 행운을 빌어요`);
  } catch (err) {
    toast(err.message, true);
    await load();
  } finally {
    $('#submit').disabled = !state.queue.length;
  }
};

// ---------- 지난 회차 ----------

async function loadPast() {
  try {
    const { rounds } = await api('/history');
    const cur = state.me?.round;
    const past = rounds.filter((r) => !(cur && cur.status === 'drawn' && r.no === cur.no)).slice(0, 6);
    $('#past').innerHTML = past.length
      ? past
          .map(
            (r) => `<details class="line" style="display:block"><summary style="cursor:pointer;list-style:none">
              <div class="row"><b>제${r.no}회</b><span class="muted small">${fmtTime(r.drawnAt)}</span></div>
              <div style="margin-top:6px">${winningBalls(r, { size: 'sm' })}</div></summary>
              <div style="margin-top:10px" data-past="${r.no}"><span class="muted small">불러오는 중…</span></div></details>`,
          )
          .join('')
      : '<div class="empty">아직 지난 회차가 없어요.</div>';
    $$('#past details').forEach((d) =>
      d.addEventListener('toggle', async () => {
        const box = $('[data-past]', d);
        if (!d.open || box.dataset.loaded) return;
        box.dataset.loaded = '1';
        const r = past.find((x) => x.no === +box.dataset.past);
        try {
          const { entries } = await api(`/rounds/${r.no}/entries`);
          box.innerHTML = `${winnerTable(r)}<div class="stack" style="margin-top:10px"><b class="small">내 번호</b>${
            entries.length
              ? entries.map((e) => `<div class="row">${entryBalls(e.numbers, r)}${rankBadge(e.rank)}</div>`).join('')
              : '<span class="muted small">응모하지 않았어요.</span>'
          }</div>`;
        } catch (err) {
          box.innerHTML = `<span class="msg err">${esc(err.message)}</span>`;
        }
      }),
    );
  } catch {
    $('#past').innerHTML = '<div class="empty">불러오지 못했어요.</div>';
  }
}

// 탭으로 돌아오면 최신 상태 반영 (지급/추첨 확인)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.me) load();
});
setInterval(() => { if (state.me && document.visibilityState === 'visible') load(); }, 30000);

// ---------- 메인 메뉴 / 공지사항 ----------

const VIEWS = ['home', 'notices', 'event', 'results'];
let notices = null;

function route() {
  const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  VIEWS.forEach((v) => $(`#view-${v}`).classList.toggle('hidden', v !== view));
  markActive(view);
  document.body.classList.toggle('at-home', view === 'home');
  if (view === 'home' || view === 'notices') loadNotices();
  if (view === 'home') renderHomeLotto();
  if (view === 'results') renderResults();
}
const markActive = setupMenu();
window.addEventListener('hashchange', route);

function noticeItem(n, open = false) {
  return `<details class="notice"${open ? ' open' : ''}><summary>
      ${n.pinned ? '<span class="badge pin">공지</span>' : ''}<span class="title">${esc(n.title)}</span>
      <span class="date">${fmtDate(n.createdAt)}</span></summary>
      ${n.body ? `<div class="body">${esc(n.body)}</div>` : ''}</details>`;
}

async function loadNotices() {
  try {
    notices = (await api('/notices')).notices;
  } catch {
    notices = notices || [];
  }
  const empty = '<div class="empty">아직 공지사항이 없어요.</div>';
  const openId = state.openNotice;
  state.openNotice = null;
  $('#notice-list').innerHTML = notices.length
    ? notices.map((n, i) => noticeItem(n, openId ? n.id === openId : i === 0)).join('')
    : empty;
  $('#tile-notices').textContent = `${notices.length}개`;
  $('#home-board').innerHTML = notices.length
    ? notices
        .slice(0, 6)
        .map(
          (n) => `<li><a href="#notices" data-open="${n.id}">${n.pinned ? '<span class="tag-pin">공지</span>' : ''}
            <span class="b-title">${esc(n.title)}</span><span class="b-date">${fmtDate(n.createdAt)}</span></a></li>`,
        )
        .join('')
    : '<li class="board-empty">등록된 공지사항이 없습니다.</li>';
  $$('#home-board [data-open]').forEach((a) => (a.onclick = () => (state.openNotice = a.dataset.open)));
}

async function renderHomeLotto() {
  const me = state.me;
  $('#tile-tickets').innerHTML = me ? `<b>${me.user.tickets}장</b>` : '<a href="#event">로그인 후 확인</a>';
  let rounds = [];
  try {
    rounds = (await api('/history')).rounds;
  } catch {}
  const r = me?.round;
  if (me) {
    $('#tile-event').innerHTML = r
      ? `제${r.no}회 <b>${STATUS_LABEL[phaseOf(r)]}</b>${r.status === 'open' ? ` · 내 응모 ${me.entries.length}줄` : ''}${
          r.status === 'open' && periodLabel(r) ? `<div class="small muted">${periodLabel(r)}</div>` : ''
        }`
      : '다음 회차 준비 중';
  } else {
    $('#tile-event').textContent = rounds[0] ? `제${rounds[0].no}회 추첨 완료` : '준비 중';
  }
  $('#tile-results').innerHTML = rounds[0]
    ? `<div class="row"><b class="small">제${rounds[0].no}회</b>${winningBalls(rounds[0], { size: 'sm' })}</div>`
    : '<span class="muted small">아직 추첨 결과가 없습니다.</span>';
}

async function renderResults() {
  const box = $('#results-list');
  box.innerHTML = '<div class="card empty">불러오는 중…</div>';
  try {
    const { rounds } = await api('/history');
    box.innerHTML = rounds.length
      ? rounds
          .map(
            (r) => `<div class="card stack">
          <h2>제${r.no}회 <span class="sub">${fmtTime(r.drawnAt)} · 총 ${r.entryCount}줄 응모</span></h2>
          ${winningBalls(r)}
          ${winnerTable(r)}
          <details class="all-toggle" data-all="${r.no}"><summary>누가 몇 번 찍었는지 보기</summary><div class="all-box" style="margin-top:10px"></div></details></div>`,
          )
          .join('')
      : '<div class="card empty">아직 추첨한 회차가 없어요.</div>';
    $$('[data-all]', box).forEach((d) =>
      d.addEventListener('toggle', async () => {
        const inner = $('.all-box', d);
        if (!d.open || inner.dataset.loaded) return;
        if (!state.me) { inner.innerHTML = '<span class="muted small">로그인하면 볼 수 있어요.</span>'; return; }
        inner.dataset.loaded = '1';
        inner.innerHTML = '<span class="muted small">불러오는 중…</span>';
        try {
          const data = await api(`/rounds/${d.dataset.all}/all`);
          inner.innerHTML = `<p class="muted small">${data.users.length}명 · 총 ${data.total}줄</p>${allEntriesHtml(data, state.me.user.id)}`;
        } catch (err) {
          delete inner.dataset.loaded;
          inner.innerHTML = `<span class="msg err">${esc(err.message)}</span>`;
        }
      }),
    );
  } catch (err) {
    box.innerHTML = `<div class="card msg err">${esc(err.message)}</div>`;
  }
}

$('#dc-form').onsubmit = async (e) => {
  e.preventDefault();
  const discordId = $('#dc-id').value.trim();
  $('#dc-save').disabled = true;
  try {
    const { user } = await api('/me/discord', { discordId });
    state.me.user = user;
    render();
    toast(discordId ? '디스코드 ID를 저장했어요.' : '디스코드 연결을 해제했어요.');
  } catch (err) {
    toast(err.message, true);
  } finally {
    $('#dc-save').disabled = false;
  }
};

// 시작/마감 시간이 되면 화면을 새로 불러온다 (응모 열림·닫힘·자동 추첨 반영)
startCountdowns(() => setTimeout(load, 1500));

route();
load();
