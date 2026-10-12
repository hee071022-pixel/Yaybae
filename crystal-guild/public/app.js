import {
  $, $$, esc, makeApi, ball, ballClass, winningBalls, entryBalls, rankBadge,
  STATUS_LABEL, fmtTime, fmtDate, toast, syncClock, phaseOf, periodLabel, fmtLeft, startCountdowns, prizeList, RULES, GEM_SVG, setupMenu, setupTheme, setupFolds, avatarHtml, shrinkImage,
} from './common.js';
import { setupGames } from './games.js';

const { api, getToken, setToken } = makeApi('crystal.user');
$('#gem').innerHTML = GEM_SVG;
setupTheme();
setupFolds();

const state = { mode: 'login', me: null, picked: new Set(), queue: [], seenDraw: null };
const games = setupGames({ api, getUser: () => state.me?.user || null });

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
  speed.left = null;
  state.queue = [];
  state.picked.clear();
  showAuth();
};

async function showAuth() {
  if (location.hash === '#me') renderMe();
  if (location.hash === '#coupons') renderCoupons();
  if (location.hash === '#schedule') drawCalendar();
  if (location.hash === '#speed') drawSpeedWallet();
  setCouponBadge(0);
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
  if (location.hash === '#me') renderMe();
  if (location.hash === '#coupons') renderCoupons();
  else loadCouponBadge();
  if (location.hash === '#schedule') drawCalendar();
  if (location.hash === '#speed') drawSpeedWallet();
  if (location.hash === '#games' && !state.gamesShown) { state.gamesShown = true; games.refresh(); }
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
  $('#who-avatar').innerHTML = avatarHtml(user, 'xs');
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

  renderRequest();
  renderRound(round, entries);
  renderPickArea();

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

// ---------- 로또권 신청 ----------
function renderRequest() {
  const { request, requestResult } = state.me;
  const box = $('#req-box');
  if (request) {
    box.innerHTML = `<div class="req-pending"><div><b>로또권 ${request.amount}장 신청 중</b>
      <div class="muted small">${request.memo ? `${esc(request.memo)} · ` : ''}${fmtTime(request.createdAt)} · 운영자 확인을 기다리고 있어요</div></div>
      <button class="ghost sm" id="req-cancel">신청 취소</button></div>`;
    $('#req-cancel').onclick = (e) => submitRequest(e.target, '/me/request/cancel', {}, '신청을 취소했어요.');
    return;
  }
  const recent = requestResult && Date.now() - requestResult.at < 3 * 86400000 ? requestResult : null;
  box.innerHTML = `${recent ? `<p class="small ${recent.status === 'approved' ? 'plus-n' : 'muted'}">${
      recent.status === 'approved' ? `지난 신청이 승인되어 로또권 ${recent.amount}장을 받았어요.` : '지난 신청은 거절되었어요.'
    }</p>` : ''}
    <details class="req-form"><summary>로또권 신청하기</summary>
      <form class="stack" id="req-form" style="margin-top:10px">
        <div class="row" style="flex-wrap:nowrap">
          <select id="req-amount" style="width:auto">${[1, 2, 3, 4, 5, 10].map((n) => `<option value="${n}">${n}장</option>`).join('')}</select>
          <input id="req-memo" maxlength="60" placeholder="사유 (예: 출석 보상, 레이드 참여)">
        </div>
        <button class="block" id="req-send">신청하기</button>
        <p class="muted small">운영자가 확인하고 지급해요. 신청은 한 번에 하나만 할 수 있어요.</p>
      </form></details>`;
  $('#req-form').onsubmit = (e) => {
    e.preventDefault();
    submitRequest($('#req-send'), '/me/request', { amount: +$('#req-amount').value, memo: $('#req-memo').value.trim() }, '로또권을 신청했어요. 운영자가 확인하면 지급돼요.');
  };
}

async function submitRequest(btn, path, body, done) {
  btn.disabled = true;
  try {
    await api(path, body);
    toast(done);
    await load();
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
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

const VIEWS = ['home', 'notices', 'event', 'speed', 'results', 'coupons', 'games', 'rank', 'schedule', 'me'];
let notices = null;

function route() {
  const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  VIEWS.forEach((v) => $(`#view-${v}`).classList.toggle('hidden', v !== view));
  markActive(view);
  document.body.classList.toggle('at-home', view === 'home');
  if (view === 'home' || view === 'notices') loadNotices();
  if (view === 'home') { renderHomeLotto(); loadEvents(); }
  if (view === 'results') renderResults();
  if (view === 'speed') loadSpeed();
  if (view === 'games') games.show();
  else games.stop();
  if (view === 'coupons') renderCoupons();
  if (view === 'rank') renderRanking();
  if (view === 'schedule') loadEvents();
  if (view === 'me') renderMe();
}
const markActive = setupMenu();
window.addEventListener('hashchange', route);

function noticeItem(n, no, open = false) {
  return `<details class="notice${n.pinned ? ' pinned' : ''}"${open ? ' open' : ''}><summary>
      <span class="no">${n.pinned ? '<span class="tag-pin">공지</span>' : no}</span><span class="title">${esc(n.title)}</span>
      <span class="date">${fmtDate(n.createdAt)}</span></summary>
      ${n.body ? `<div class="body">${esc(n.body)}</div>` : ''}</details>`;
}

// 고정 공지는 '공지', 나머지는 오래된 글부터 1번
function numbered(list) {
  const normal = list.filter((n) => !n.pinned).length;
  let k = normal;
  return list.map((n) => ({ n, no: n.pinned ? null : k-- }));
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
  const rows = numbered(notices);
  $('#notice-list').innerHTML = notices.length
    ? `<div class="notice-head"><span class="no">번호</span><span class="title">제목</span><span class="date">작성일</span></div>${rows
        .map(({ n, no }) => noticeItem(n, no, openId ? n.id === openId : false))
        .join('')}`
    : empty;
  $('#home-board').innerHTML = notices.length
    ? rows
        .slice(0, 5)
        .map(
          ({ n, no }) => `<tr${n.pinned ? ' class="pinned"' : ''}><td class="b-no">${n.pinned ? '<span class="tag-pin">공지</span>' : no}</td>
            <td><a href="#notices" data-open="${n.id}" class="b-title">${esc(n.title)}</a></td><td class="b-date">${fmtDate(n.createdAt)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="board-empty">등록된 공지사항이 없습니다.</td></tr>';
  $$('#home-board [data-open]').forEach((a) => (a.onclick = () => (state.openNotice = a.dataset.open)));
  const opened = openId && $(`#notice-list details[open]`);
  if (opened) opened.scrollIntoView({ block: 'center' });
}

async function renderHomeLotto() {
  const me = state.me;
  const [stats, hist] = await Promise.all([api('/stats').catch(() => null), api('/history').catch(() => ({ rounds: [] }))]);
  const rounds = hist.rounds || [];
  const r = me?.round || stats?.round || null;
  if (r?.serverTime) syncClock(r.serverTime);

  $('#st-members').textContent = stats ? `${stats.members}명` : '-';
  $('#st-rounds').textContent = `${rounds.length ? rounds[0].no : 0}회`;
  const total = rounds.reduce((n, x) => n + (x.entryCount || 0), 0) + (r && r.status !== 'drawn' ? r.entryCount : 0);
  $('#st-entries').textContent = `${total.toLocaleString()}줄`;

  // 지금 회차
  const box = $('#tile-event');
  const live = r && r.status !== 'drawn';
  if (live) {
    const phase = phaseOf(r);
    const period = periodLabel(r);
    const count = phase === 'soon' ? `시작까지 <b data-until="${r.startAt}">${fmtLeft(r.startAt - Date.now())}</b>`
      : phase === 'open' && r.endAt ? `마감까지 <b data-until="${r.endAt}">${fmtLeft(r.endAt - Date.now())}</b>` : '';
    const mine = me ? `<div class="now-mine"><span>내 로또권 <b>${me.user.tickets}장</b></span><span>이번 회차 응모 <b>${me.entries.length}줄</b></span></div>` : '';
    box.innerHTML = `<div class="now-band"><span>이번 회차</span><span class="badge ${phase}">${STATUS_LABEL[phase]}</span></div>
      <div class="now-title">제${r.no}회 크리스탈 로또</div>
      ${period ? `<div class="now-period">${period}</div>` : ''}
      ${count ? `<div class="now-count">${count}</div>` : ''}
      ${[1, 2, 3, 4, 5].some((k) => r.prizes?.[k]) ? `<div class="now-prizes">${[1, 2, 3, 4, 5]
        .filter((k) => r.prizes?.[k])
        .map((k) => `<div class="np-row"><span class="np-rank">${k}등</span><b>${esc(r.prizes[k])}</b></div>`)
        .join('')}</div>` : ''}
      ${mine}
      <div class="now-cut" aria-hidden="true"></div>
      <a class="btn block" href="#event">${me ? (phase === 'open' ? '번호 고르러 가기' : '이벤트 보기') : '로그인하고 참여하기'}</a>
      <div class="now-foot">지금까지 ${r.entryCount}줄 응모</div>`;
  } else {
    const last = rounds[0];
    box.innerHTML = `<div class="now-band"><span>이번 회차</span><span class="badge">준비 중</span></div>
      <div class="now-title">다음 회차를 준비하고 있어요</div>
      <p class="now-period">회차가 열리면 디스코드와 공지사항으로 알려드릴게요.</p>
      ${me ? `<div class="now-mine"><span>내 로또권 <b>${me.user.tickets}장</b></span></div>` : ''}
      <div class="now-cut" aria-hidden="true"></div>
      ${last ? `<div class="now-last"><div class="small muted">제${last.no}회 당첨번호</div>${winningBalls(last, { size: 'sm' })}</div>` : ''}
      <a class="btn ghost block" href="#results">지난 결과 보기</a>`;
  }

  // 당첨 결과 + 최근 당첨자
  $('#tile-results').innerHTML = rounds[0]
    ? `<div class="last-round"><div class="last-round-head"><b>제${rounds[0].no}회</b><span class="muted small">${fmtTime(rounds[0].drawnAt)} 추첨</span></div>${winningBalls(rounds[0], { size: 'sm' })}</div>`
    : '<p class="muted small" style="margin:14px 0">아직 추첨한 회차가 없어요.</p>';
  const winners = [];
  for (const x of rounds) {
    const seen = new Set();
    for (const w of [...x.winners].sort((a, b) => a.rank - b.rank)) {
      const key = `${w.user}-${w.rank}`;
      if (seen.has(key)) continue;
      seen.add(key);
      winners.push({ no: x.no, rank: w.rank, user: w.user, prize: x.prizes?.[w.rank] });
    }
    if (winners.length >= 4) break;
  }
  $('#hof-list').innerHTML = winners.length
    ? winners.slice(0, 4).map((w) => `<li><span class="hof-rank r${w.rank}">${w.rank}등</span><span class="hof-user">${esc(w.user)}</span>
        <span class="hof-meta">제${w.no}회${w.prize ? ` · ${esc(w.prize)}` : ''}</span></li>`).join('')
    : '<li class="hof-empty">아직 당첨자가 없어요. 첫 당첨의 주인공이 되어 보세요.</li>';
}

async function renderResults() {
  const box = $('#results-list');
  box.innerHTML = '<div class="card empty">불러오는 중…</div>';
  try {
    const { rounds } = await api('/history');
    box.innerHTML = rounds.length
      ? rounds
          .map(
            (r) => `<div class="card result-card">
          <div class="result-head"><h2>제${r.no}회</h2><span class="muted small">${fmtTime(r.drawnAt)} 추첨 · 총 ${r.entryCount}줄 응모 · 당첨 ${r.winners.length}줄</span></div>
          ${winningBalls(r)}
          ${winnerTable(r)}</div>`,
          )
          .join('')
      : '<div class="card empty">아직 추첨한 회차가 없어요.</div>';
  } catch (err) {
    box.innerHTML = `<div class="card msg err">${esc(err.message)}</div>`;
  }
}

// ---------- 내 정보 ----------
const RANK_NAME = (r) => (r ? `${r}등` : '-');

async function renderMe() {
  const me = state.me;
  $('#me-guest').classList.toggle('hidden', Boolean(me));
  $('#me-main').classList.toggle('hidden', !me);
  if (!me) return;
  const u = me.user;
  $('#me-avatar').innerHTML = avatarHtml(u, 'lg');
  $('#avatar-remove').classList.toggle('hidden', !u.avatarAt);
  $('#me-name').textContent = u.id;
  $('#me-meta').textContent = `${fmtDate(u.createdAt)} 가입 · 최근 로그인 ${fmtTime(u.lastLoginAt)}`;
  $('#me-dc').innerHTML = u.discordId ? '<span class="badge open">디스코드 연결됨</span>' : '<a class="badge" href="#me" id="me-dc-link">디스코드 미연결</a>';
  $('#me-tickets').textContent = `${u.tickets}장`;
  const wait = u.selfRenamedAt ? u.selfRenamedAt + 7 * 86400000 - Date.now() : 0;
  $('#nick-new').placeholder = u.id;
  $('#nick-save').disabled = wait > 0;
  $('#nick-save').textContent = wait > 0 ? `${Math.ceil(wait / 86400000)}일 뒤에 바꿀 수 있어요` : '닉네임 바꾸기';
  $('#me-hist-count').textContent = u.history.length ? `최근 ${u.history.length}건` : '';
  $('#me-history').innerHTML = u.history.length
    ? u.history.map((h) => `<li><span class="${h.delta > 0 ? 'plus-n' : h.delta < 0 ? 'minus-n' : 'muted'}">${h.delta > 0 ? '+' : ''}${h.delta}</span>
        <span>${esc(h.reason)}</span><span class="muted small" style="margin-left:auto">잔여 ${h.balance}장 · ${fmtTime(h.at)}</span></li>`).join('')
    : '<li class="muted">아직 내역이 없어요.</li>';

  const box = $('#rec-list');
  if (!box.dataset.loaded) box.innerHTML = '<div class="empty">불러오는 중…</div>';
  try {
    const { rounds, totals } = await api('/me/records');
    box.dataset.loaded = '1';
    $('#me-rounds').textContent = `${totals.rounds}회`;
    $('#me-lines').textContent = `${totals.lines}줄`;
    $('#me-wins').textContent = `${totals.wins}번`;
    $('#me-best').textContent = RANK_NAME(totals.best);
    const item = (r, i) => {
      const ranks = r.lines.map((l) => l.rank).filter(Boolean);
      const best = ranks.length ? Math.min(...ranks) : 0;
      const result = r.status === 'drawn'
        ? (best ? `<span class="badge win">${best}등${ranks.length > 1 ? ` 외 ${ranks.length - 1}줄` : ''} 당첨</span>` : '<span class="badge">낙첨</span>')
        : '<span class="badge open">추첨 전</span>';
      return `<details class="rec"${i === 0 ? ' open' : ''}><summary class="rec-head"><b>제${r.no}회</b>${result}
          <span class="muted small rec-count">${r.status === 'drawn' ? `${fmtTime(r.drawnAt)} · ` : ''}${r.lines.length}줄</span></summary>
        ${r.status === 'drawn' ? `<div class="rec-win"><span class="muted small">당첨번호</span>${winningBalls(r, { size: 'xs' })}</div>` : ''}
        <div class="rec-lines">${r.lines.map((l) => `<div class="row">${entryBalls(l.numbers, r)}<span class="muted small">${l.auto ? '자동' : '수동'}</span>${
          r.status === 'drawn' ? rankBadge(l.rank) : ''}</div>`).join('')}</div>
      </details>`;
    };
    const PAGE = 8;
    const draw = (n) => {
      box.innerHTML = rounds.slice(0, n).map(item).join('') +
        (rounds.length > n ? `<button class="ghost block" id="rec-more">이전 기록 더 보기 (${rounds.length - n}회차)</button>` : '');
      const more = $('#rec-more');
      if (more) more.onclick = () => draw(n + PAGE);
    };
    if (rounds.length) draw(PAGE);
    else box.innerHTML = '<div class="empty">아직 응모한 회차가 없어요.<br><a href="#event">로또 이벤트에서 응모해 보세요</a></div>';
  } catch (err) {
    box.innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
  }
}

$('#avatar-pick').onclick = () => $('#avatar-file').click();
$('#avatar-file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('#avatar-pick').disabled = true;
  try {
    const image = await shrinkImage(file);
    const r = await api('/me/avatar', { image });
    state.me.user = r.user;
    render();
    renderMe();
    toast('프로필 사진을 바꿨어요.');
  } catch (err) {
    toast(err.message, true);
  } finally {
    $('#avatar-pick').disabled = false;
  }
};
$('#avatar-remove').onclick = async () => {
  if (!confirm('프로필 사진을 지우고 기본 사진으로 할까요?')) return;
  try {
    const r = await api('/me/avatar/remove', {});
    state.me.user = r.user;
    render();
    renderMe();
    toast('기본 사진으로 바꿨어요.');
  } catch (err) {
    toast(err.message, true);
  }
};

$('#nick-form').onsubmit = async (e) => {
  e.preventDefault();
  const newId = $('#nick-new').value.trim();
  if (!newId || newId === state.me.user.id) return toast('지금과 다른 닉네임을 입력하세요.', true);
  if (!confirm(`닉네임을 "${newId}"(으)로 바꿀까요?\n다음 로그인부터 새 닉네임을 써야 해요.`)) return;
  $('#nick-save').disabled = true;
  try {
    const r = await api('/me/rename', { newId, password: $('#nick-pw').value });
    setToken(r.token);
    $('#nick-form').reset();
    toast(`닉네임을 ${r.user.id}(으)로 바꿨어요.`);
    await load();
  } catch (err) {
    toast(err.message, true);
  } finally {
    $('#nick-save').disabled = false;
  }
};

$('#pw-form').onsubmit = async (e) => {
  e.preventDefault();
  const cur = $('#pw-cur').value;
  const next = $('#pw-new').value;
  if (next !== $('#pw-new2').value) return toast('새 비밀번호가 서로 달라요.', true);
  $('#pw-save').disabled = true;
  try {
    const r = await api('/me/password', { current: cur, next });
    setToken(r.token);
    state.me.user = r.user;
    $('#pw-form').reset();
    toast('비밀번호를 바꿨어요.');
  } catch (err) {
    toast(err.message, true);
  } finally {
    $('#pw-save').disabled = false;
  }
};

$('#dc-form').onsubmit = async (e) => {
  e.preventDefault();
  const discordId = $('#dc-id').value.trim();
  $('#dc-save').disabled = true;
  try {
    const { user } = await api('/me/discord', { discordId });
    state.me.user = user;
    render();
    if (location.hash === '#me') renderMe();
    toast(discordId ? '디스코드 ID를 저장했어요.' : '디스코드 연결을 해제했어요.');
  } catch (err) {
    toast(err.message, true);
  } finally {
    $('#dc-save').disabled = false;
  }
};

// ---------- 쿠폰 ----------
async function redeem(code, btn) {
  if (!code) return toast('쿠폰 코드를 입력하세요.', true);
  btn.disabled = true;
  try {
    const r = await api('/me/coupon', { code });
    toast(`쿠폰 사용 완료! 로또권 ${r.amount}장을 받았어요.`);
    await load();
    return true;
  } catch (err) {
    toast(err.message, true);
    if (location.hash === '#coupons') renderCoupons();
    return false;
  } finally {
    btn.disabled = false;
  }
}
$('#coupon-form').onsubmit = async (e) => {
  e.preventDefault();
  if (await redeem($('#coupon-code').value.trim(), $('#coupon-btn'))) $('#coupon-code').value = '';
};
$('#cp-code-form').onsubmit = async (e) => {
  e.preventDefault();
  if (await redeem($('#cp-code-in').value.trim(), $('#cp-code-btn'))) $('#cp-code-in').value = '';
};

function setCouponBadge(n) {
  $('#cp-badge').textContent = n;
  $('#cp-badge').classList.toggle('hidden', !n);
}
async function loadCouponBadge() {
  if (!getToken()) return setCouponBadge(0);
  try {
    setCouponBadge((await api('/me/coupons')).available);
  } catch {
    /* 배지는 없어도 됨 */
  }
}

async function renderCoupons() {
  $('#cp-guest').classList.toggle('hidden', Boolean(getToken()));
  $('#cp-main').classList.toggle('hidden', !getToken());
  if (!getToken()) return;
  const box = $('#coupon-list');
  if (!box.dataset.loaded) box.innerHTML = '<div class="card empty">불러오는 중…</div>';
  let data;
  try {
    data = await api('/me/coupons');
  } catch (err) {
    box.innerHTML = `<div class="card msg err">${esc(err.message)}</div>`;
    return;
  }
  box.dataset.loaded = '1';
  setCouponBadge(data.available);
  const now = Date.now();
  const left = (c) => {
    if (!c.expiresAt) return '기한 없음';
    const ms = c.expiresAt - now;
    if (ms <= 0) return `${fmtTime(c.expiresAt)} 마감`;
    return `${fmtTime(c.expiresAt)}까지 · <b data-until="${c.expiresAt}">${fmtLeft(ms)}</b> 남음`;
  };
  box.innerHTML = data.coupons.length
    ? data.coupons.map((c) => {
        const tag = c.used ? '받음' : c.soldOut ? '선착순 마감' : c.expired ? '기간 종료' : '';
        const remain = c.maxUses ? Math.max(0, c.maxUses - c.uses) : null;
        return `<div class="coupon${c.available ? '' : ' off'}${c.used ? ' used' : ''}">
          <div class="coupon-amt"><b>${c.amount}</b><span>장</span></div>
          <div class="coupon-body">
            <div class="coupon-title">로또권 ${c.amount}장 쿠폰 ${tag ? `<span class="badge${c.used ? ' open' : ''}">${tag}</span>` : ''}</div>
            <div class="coupon-code">${esc(c.code)}</div>
            <div class="muted small">${c.maxUses ? `선착순 ${c.maxUses}명 · ${remain ? `${remain}자리 남음` : '마감'}` : `누구나 · ${c.uses}명 받음`}</div>
            <div class="muted small">${left(c)}</div>
          </div>
          <div class="coupon-act">${c.available ? `<button data-claim="${esc(c.code)}">받기</button>` : c.used ? '<span class="coupon-done">✓</span>' : ''}</div>
        </div>`;
      }).join('')
    : '<div class="card empty">지금 올라온 쿠폰이 없어요.<br>새 쿠폰이 올라오면 메뉴에 숫자로 알려드려요.</div>';
  $$('#coupon-list [data-claim]').forEach((b) => (b.onclick = () => redeem(b.dataset.claim, b)));
}

// ---------- 랭킹 ----------
let rankData = null;
let rankSort = 'points';
const SORTS = {
  points: (a, b) => b.points - a.points || b.wins - a.wins || (a.best || 9) - (b.best || 9) || b.lines - a.lines,
  wins: (a, b) => b.wins - a.wins || b.points - a.points || b.lines - a.lines,
  lines: (a, b) => b.lines - a.lines || b.rounds - a.rounds || b.points - a.points,
};
const sortValue = (t) => (rankSort === 'lines' ? `${t.lines}줄` : rankSort === 'wins' ? `${t.wins}번` : `${t.points}점`);

$$('#rank-sort button').forEach((b) => (b.onclick = () => {
  rankSort = b.dataset.sort;
  $$('#rank-sort button').forEach((x) => x.classList.toggle('on', x === b));
  drawRanking();
}));

async function renderRanking() {
  if (!rankData) $('#rank-list').innerHTML = '<div class="empty">불러오는 중…</div>';
  try {
    rankData = await api('/ranking');
    drawRanking();
  } catch (err) {
    $('#rank-list').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
  }
}

function drawRanking() {
  const { rounds, points, list } = rankData;
  $('#rank-note').textContent = `최근 추첨 ${rounds}회차 기준 · 점수: ${[1, 2, 3, 4, 5].map((k) => `${k}등 ${points[k]}`).join(' · ')}`;
  const key = rankSort === 'lines' ? 'lines' : rankSort === 'wins' ? 'wins' : 'points';
  const rows = list.filter((t) => t[key] > 0).sort(SORTS[rankSort]);
  if (!rows.length) {
    $('#rank-list').innerHTML = '<div class="empty">아직 랭킹이 없어요. 추첨이 끝나면 여기에 표시돼요.</div>';
    return;
  }
  const meId = state.me?.user.id;
  let place = 0;
  let prev = null;
  $('#rank-list').innerHTML = `<ol class="rank-list">${rows
    .map((t, i) => {
      if (prev === null || SORTS[rankSort](prev, t) !== 0) place = i + 1;
      prev = t;
      const ranks = [1, 2, 3, 4, 5].filter((k) => t.byRank[k]).map((k) => `<span class="rk r${k}">${k}등 ${t.byRank[k]}</span>`).join('');
      return `<li class="rank-row${t.user === meId ? ' me' : ''}${place <= 3 ? ` top${place}` : ''}">
        <span class="rank-no">${place}</span>${avatarHtml({ id: t.user, avatarAt: t.avatarAt }, 'sm')}
        <div class="rank-who"><b>${esc(t.user)}${t.user === meId ? ' <span class="muted small">(나)</span>' : ''}</b>
          <div class="rank-sub">${ranks || '<span class="muted">당첨 없음</span>'}<span class="muted">· ${t.rounds}회 참여 · ${t.lines}줄</span></div></div>
        <b class="rank-val">${sortValue(t)}</b></li>`;
    })
    .join('')}</ol>`;
}

// ---------- 길드 일정 ----------
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const pad2 = (n) => String(n).padStart(2, '0');
const cal = { y: +kstToday().slice(0, 4), m: +kstToday().slice(5, 7), pick: null };
let guildEvents = [];

// full: 참석 버튼과 명단까지 (일정 화면), 아니면 인원만 (홈)
function evLine(ev, withDate = true, full = false) {
  const d = new Date(`${ev.date}T00:00:00`);
  const past = ev.date < kstToday();
  const yes = ev.rsvp?.yes || [];
  const no = ev.rsvp?.no || [];
  const meId = state.me?.user.id;
  const mine = meId ? (yes.includes(meId) ? 'yes' : no.includes(meId) ? 'no' : '') : '';
  const isFull = ev.limit && yes.length >= ev.limit;
  const count = `참석 <b>${yes.length}</b>${ev.limit ? ` / ${ev.limit}` : ''}명${no.length ? ` · 불참 ${no.length}명` : ''}`;
  let rsvp = '';
  if (full) {
    const buttons = past ? '<span class="muted small">지난 일정</span>'
      : meId ? `<div class="rsvp-btns">
          <button class="sm ${mine === 'yes' ? '' : 'ghost'}" data-rsvp="${ev.id}" data-st="${mine === 'yes' ? '' : 'yes'}"${mine === 'yes' ? ' title="다시 누르면 취소"' : ''}${isFull && mine !== 'yes' ? ' disabled' : ''}>${mine === 'yes' ? '✓ 참석' : isFull ? '마감' : '참석'}</button>
          <button class="sm ${mine === 'no' ? 'dim' : 'ghost'}" data-rsvp="${ev.id}" data-st="${mine === 'no' ? '' : 'no'}"${mine === 'no' ? ' title="다시 누르면 취소"' : ''}>${mine === 'no' ? '✓ 불참' : '불참'}</button></div>`
      : '<a class="small" href="#event">로그인하고 참석 신청</a>';
    rsvp = `<div class="rsvp"><span class="small">${count}</span>${buttons}</div>
      ${yes.length || no.length ? `<details class="rsvp-names"><summary>명단 보기</summary>
        ${yes.length ? `<div class="small"><b>참석</b> ${yes.map((x) => `<span class="rsvp-name${x === meId ? ' me' : ''}">${esc(x)}</span>`).join('')}</div>` : ''}
        ${no.length ? `<div class="small muted"><b>불참</b> ${no.map(esc).join(', ')}</div>` : ''}</details>` : ''}`;
  } else if (yes.length || ev.limit) {
    rsvp = `<div class="muted small">${count}${mine === 'yes' ? ' · <b class="plus-n">나도 참석</b>' : ''}</div>`;
  }
  return `<div class="ev-item${past ? ' past' : ''}">
    ${withDate ? `<div class="ev-date"><b>${d.getMonth() + 1}.${d.getDate()}</b><span>${DOW[d.getDay()]}</span></div>` : ''}
    <div class="ev-body"><b>${esc(ev.title)}</b>
      <div class="muted small">${[ev.time, ev.place].filter(Boolean).map(esc).join(' · ') || '종일'}</div>
      ${ev.memo ? `<div class="ev-memo small">${esc(ev.memo)}</div>` : ''}${rsvp}</div></div>`;
}

async function sendRsvp(btn) {
  btn.disabled = true;
  try {
    const { event } = await api('/me/events/rsvp', { id: btn.dataset.rsvp, status: btn.dataset.st });
    guildEvents = guildEvents.map((x) => (x.id === event.id ? event : x));
    const st = btn.dataset.st;
    toast(st === 'yes' ? '참석으로 신청했어요.' : st === 'no' ? '불참으로 표시했어요.' : '참석 신청을 취소했어요.');
    drawCalendar();
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
    loadEvents();
  }
}

async function loadEvents() {
  try {
    guildEvents = (await api('/events')).events;
  } catch {
    guildEvents = guildEvents || [];
  }
  const today = kstToday();
  const upcoming = guildEvents.filter((ev) => ev.date >= today);
  $('#home-events').innerHTML = upcoming.length
    ? upcoming.slice(0, 4).map((ev) => evLine(ev)).join('')
    : '<p class="muted small" style="margin:14px 0">예정된 일정이 없어요.</p>';
  drawCalendar();
}

function drawCalendar() {
  const { y, m } = cal;
  $('#cal-title').textContent = `${y}년 ${m}월`;
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const today = kstToday();
  const byDay = {};
  for (const ev of guildEvents) (byDay[ev.date] ||= []).push(ev);
  let html = DOW.map((d, i) => `<div class="cal-dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${d}</div>`).join('');
  html += '<div class="cal-cell blank"></div>'.repeat(first);
  for (let d = 1; d <= days; d++) {
    const date = `${y}-${pad2(m)}-${pad2(d)}`;
    const evs = byDay[date] || [];
    const dow = (first + d - 1) % 7;
    html += `<button type="button" class="cal-cell${date === today ? ' today' : ''}${date === cal.pick ? ' on' : ''}${evs.length ? ' has' : ''}${evs.some((ev) => ev.rsvp?.yes.includes(state.me?.user.id)) ? ' going' : ''}${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}" data-day="${date}">
      <span class="cal-d">${d}</span>${evs.slice(0, 2).map((ev) => `<span class="cal-ev">${esc(ev.title)}</span>`).join('')}${evs.length > 2 ? `<span class="cal-more">+${evs.length - 2}</span>` : ''}</button>`;
  }
  $('#cal').innerHTML = html;
  $$('#cal [data-day]').forEach((b) => (b.onclick = () => { cal.pick = cal.pick === b.dataset.day ? null : b.dataset.day; drawCalendar(); }));
  drawDayList();
}

function drawDayList() {
  if (cal.pick) {
    const d = new Date(`${cal.pick}T00:00:00`);
    $('#day-title').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`;
    const evs = guildEvents.filter((ev) => ev.date === cal.pick);
    $('#day-list').innerHTML = evs.length ? evs.map((ev) => evLine(ev, false, true)).join('') : '<div class="empty">이 날은 일정이 없어요.</div>';
    bindRsvp();
    return;
  }
  $('#day-title').textContent = '다가오는 일정';
  const upcoming = guildEvents.filter((ev) => ev.date >= kstToday());
  $('#day-list').innerHTML = upcoming.length ? upcoming.slice(0, 12).map((ev) => evLine(ev, true, true)).join('') : '<div class="empty">예정된 일정이 없어요.</div>';
  bindRsvp();
}
const bindRsvp = () => $$('#day-list [data-rsvp]').forEach((b) => (b.onclick = () => sendRsvp(b)));

const moveMonth = (n) => {
  const t = new Date(cal.y, cal.m - 1 + n, 1);
  cal.y = t.getFullYear();
  cal.m = t.getMonth() + 1;
  drawCalendar();
};
$('#cal-prev').onclick = () => moveMonth(-1);
$('#cal-next').onclick = () => moveMonth(1);
$('#cal-today').onclick = () => {
  cal.y = +kstToday().slice(0, 4);
  cal.m = +kstToday().slice(5, 7);
  cal.pick = kstToday();
  drawCalendar();
};

// ---------- 스피드 로또 ----------
const speed = { info: null, left: null, busy: false };
const rankText = (r) => (r ? `${r}등` : '꽝');

async function loadSpeed() {
  try {
    speed.info = await api('/speed');
  } catch (err) {
    return toast(err.message, true);
  }
  const { cost, tiers, recent, enabled } = speed.info;
  $('#sp-cost').textContent = cost;
  const lose = Math.max(0, 100 - tiers.reduce((a, t) => a + t.chance, 0));
  $('#sp-tiers').innerHTML = tiers
    .filter((t) => t.chance > 0)
    .map((t) => `<tr><td><span class="hof-rank r${t.rank}">${t.rank}등</span></td><td>${t.chance}%</td>
      <td>${t.tickets ? `로또권 <b>${t.tickets}장</b>` : ''}${t.tickets && t.item ? ' + ' : ''}${t.item ? `<b>${esc(t.item)}</b>` : ''}${!t.tickets && !t.item ? '-' : ''}</td></tr>`)
    .join('') + `<tr class="muted"><td>꽝</td><td>${Math.round(lose * 100) / 100}%</td><td>-</td></tr>`;
  $('#sp-feed').innerHTML = recent.length
    ? recent.map((x) => `<li><span class="hof-rank r${x.rank}">${x.rank}등</span><span class="hof-user">${esc(x.user)}</span>
        <span class="muted small">${x.tickets ? `+${x.tickets}장` : ''}${x.item ? ` ${esc(x.item)}` : ''} · ${fmtTime(x.at)}</span></li>`).join('')
    : '<li class="muted small">아직 당첨자가 없어요. 첫 주인공이 되어 보세요!</li>';
  if (!enabled) $('#sp-result').textContent = '지금은 스피드 로또를 쉬고 있어요.';
  drawTicketRules();
  if (!scratch.ctx || (!scratch.active && !speed.busy && !$('#tk').classList.contains('win') && !$('#tk').classList.contains('lose'))) coverTicket('구매하면 긁을 수 있어요');
  drawSpeedWallet();
}

function drawSpeedWallet() {
  if (speed.busy) return; // 긁는 중에는 그대로 (결과가 미리 보이지 않게)
  const me = state.me;
  const info = speed.info;
  $('#sp-guest').classList.toggle('hidden', Boolean(me));
  $('#sp-tickets').textContent = me ? `${me.user.tickets}장` : '-';
  $('#sp-left').textContent = me && info?.dailyLimit ? `오늘 ${speed.left ?? '?'}번 남음` : '';
  if (me && info?.dailyLimit && speed.left === null) {
    const d = me.user.speedDay;
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    speed.left = Math.max(0, info.dailyLimit - (d?.day === today ? d.count : 0));
    $('#sp-left').textContent = `오늘 ${speed.left}번 남음`;
  }
  const cost = info?.cost ?? 3;
  const btn = $('#sp-play');
  btn.disabled = !me || !info?.enabled || me.user.tickets < cost || speed.left === 0;
  btn.textContent = !me ? '로그인하고 참여하기'
    : !info?.enabled ? '지금은 쉬는 중'
    : speed.left === 0 ? '오늘은 다 했어요'
    : me.user.tickets < cost ? `로또권이 부족해요 (${cost}장 필요)`
    : `로또권 ${cost}장으로 구매하기`;
}

// 긁는 복권: 은색 막을 캔버스로 그리고, 긁은 만큼 지운다. 절반쯤 긁으면 나머지는 저절로 벗겨짐
const scratch = { ctx: null, active: false, done: false, moves: 0, onDone: null };

function coverTicket(label) {
  const cv = $('#tk-canvas');
  const box = $('#tk-scratch').getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(box.width * dpr);
  cv.height = Math.round(box.height * dpr);
  cv.style.opacity = '';
  cv.classList.remove('gone');
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#b8bbc1';
  ctx.fillRect(0, 0, box.width, box.height);
  // 은박 느낌의 잔무늬
  for (let i = 0; i < box.width * box.height / 18; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.08)';
    ctx.fillRect(Math.random() * box.width, Math.random() * box.height, 1.5, 1.5);
  }
  ctx.fillStyle = '#6f727a';
  ctx.font = '700 15px Pretendard, "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, box.width / 2, box.height / 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 34;
  scratch.ctx = ctx;
  scratch.done = false;
  scratch.moves = 0;
}

function scratchedRatio() {
  const cv = $('#tk-canvas');
  const data = scratch.ctx.getImageData(0, 0, cv.width, cv.height).data;
  let clear = 0;
  let total = 0;
  for (let i = 3; i < data.length; i += 4 * 40) { total++; if (data[i] === 0) clear++; }
  return clear / total;
}

function revealTicket() {
  if (scratch.done) return;
  scratch.done = true;
  scratch.active = false;
  $('#tk-canvas').classList.add('gone');
  $('#tk-all').classList.add('hidden');
  scratch.onDone?.();
}

(function bindScratch() {
  const cv = $('#tk-canvas');
  let last = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', (e) => {
    if (!scratch.active || scratch.done) return;
    cv.setPointerCapture(e.pointerId);
    last = pos(e);
    scratch.ctx.globalCompositeOperation = 'destination-out';
    scratch.ctx.beginPath();
    scratch.ctx.arc(last[0], last[1], 17, 0, Math.PI * 2);
    scratch.ctx.fill();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!last || !scratch.active || scratch.done) return;
    const p = pos(e);
    scratch.ctx.beginPath();
    scratch.ctx.moveTo(last[0], last[1]);
    scratch.ctx.lineTo(p[0], p[1]);
    scratch.ctx.stroke();
    last = p;
    if (++scratch.moves % 12 === 0 && scratchedRatio() > 0.5) revealTicket();
  });
  const end = () => { last = null; if (scratch.active && !scratch.done && scratchedRatio() > 0.5) revealTicket(); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
})();
$('#tk-all').onclick = revealTicket;

function drawTicketRules() {
  const info = speed.info;
  if (!info) return;
  $('#tk-price').textContent = info.cost;
  $('#tk-limit').textContent = info.dailyLimit ? `1인 1일 ${info.dailyLimit}매` : '';
  $('#tk-rules').innerHTML = info.tiers.filter((t) => t.chance > 0).map((t) =>
    `<li><b>${t.rank}등</b> ${[t.tickets ? `로또권 ${t.tickets}장` : '', t.item ? esc(t.item) : ''].filter(Boolean).join(' + ') || '-'}</li>`).join('');
}

$('#sp-play').onclick = async () => {
  if (speed.busy || !state.me) return;
  speed.busy = true;
  const btn = $('#sp-play');
  btn.disabled = true;
  btn.textContent = '구매 중…';
  let res;
  try {
    res = await api('/me/speed', {});
  } catch (err) {
    toast(err.message, true);
    speed.busy = false;
    drawSpeedWallet();
    return;
  }
  const { result } = res;
  const reward = [result.tickets ? `로또권 ${result.tickets}장` : '', result.item].filter(Boolean).join(' + ');
  // 새 복권: 결과를 밑에 깔고 은박을 덮는다
  $('#tk').classList.remove('win', 'lose');
  $('#tk-stamp').classList.add('hidden');
  $('#tk-no').textContent = `No. ${String(Date.now()).slice(-6)}`;
  $('#tk-prize').innerHTML = result.rank
    ? `<span class="tk-rank">${result.rank}등</span><span class="tk-reward">${esc(reward || '당첨')}</span>`
    : '<span class="tk-rank lose">꽝</span><span class="tk-reward">다음 기회에</span>';
  coverTicket('여기를 긁어 주세요');
  scratch.active = true;
  $('#tk-all').classList.remove('hidden');
  $('#sp-result').textContent = '은색 부분을 손가락이나 마우스로 긁어 보세요.';
  btn.textContent = '긁는 중…';
  // 다 긁기 전에는 당첨 로또권이 보이지 않게 (비용만 뺀 수)
  $('#sp-tickets').textContent = `${res.user.tickets - result.tickets}장`;
  speed.left = res.left;
  scratch.onDone = () => {
    state.me.user = res.user;
    $('#tk').classList.add(result.rank ? 'win' : 'lose');
    if (result.rank) $('#tk-stamp').classList.remove('hidden');
    $('#sp-result').innerHTML = result.rank
      ? `<b>${result.rank}등 당첨!</b> ${esc(reward)} 받았어요.`
      : '아쉽지만 꽝이에요.';
    render();
    speed.busy = false;
    drawSpeedWallet();
    if (result.rank && result.rank <= 3) loadSpeed();
  };
};

// 시작/마감 시간이 되면 화면을 새로 불러온다 (응모 열림·닫힘·자동 추첨 반영)
startCountdowns(() => setTimeout(load, 1500));

route();
load();
