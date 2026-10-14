import {
  $, $$, esc, makeApi, ball, ballClass, winningBalls, entryBalls, rankBadge,
  STATUS_LABEL, fmtTime, fmtDate, toast, syncClock, phaseOf, periodLabel, fmtLeft, startCountdowns, prizeList, RULES, GEM_SVG, setupMenu, setupTheme, setupFolds, avatarHtml, shrinkImage,
} from './common.js';
import { setupGames } from './games.js';
import { setupBlackjack, setupDuel } from './blackjack.js';
import { crystalSouls } from './souls.js';
import { eightBitRaid } from './raid.js';
import { sprite } from './arcade.js';
import { PAL, ICONS, CHEST } from './souls-art.js';

const { api, getToken, setToken } = makeApi('crystal.user');
$('#gem').innerHTML = GEM_SVG;
setupTheme();
setupFolds();

const state = { mode: 'login', me: null, picked: new Set(), queue: [], seenDraw: null };
const games = setupGames({ api, getUser: () => state.me?.user || null });
const duel = setupDuel({
  api,
  esc,
  getUser: () => state.me?.user || null,
  onUser: (u) => { if (state.me) { state.me.user = u; render(); } },
});
let bjMode = 'dealer';
function setBjMode(mode) {
  bjMode = mode;
  $$('#bj-mode [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('#bj-dealer-wrap').classList.toggle('hidden', mode !== 'dealer');
  $('#duel-wrap').classList.toggle('hidden', mode !== 'duel');
  if (mode === 'duel' && location.hash === '#blackjack') duel.show();
  else duel.hide();
}
$$('#bj-mode [data-mode]').forEach((b) => (b.onclick = () => setBjMode(b.dataset.mode)));
const blackjack = setupBlackjack({
  api,
  getUser: () => state.me?.user || null,
  onUser: (u) => { if (state.me) { state.me.user = u; render(); } },
});

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
  if (location.hash === '#me') renderMe();
  if (location.hash === '#coupons') renderCoupons();
  if (location.hash === '#schedule') drawCalendar();
  if (location.hash === '#blackjack') blackjack.show();
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
  if (location.hash === '#raid') loadRaid();
  if (location.hash === '#shop') renderShop();
  if (location.hash === '#games' && !state.gamesShown) { state.gamesShown = true; games.refresh(); }
  if (location.hash === '#blackjack' && !state.bjShown) { state.bjShown = true; blackjack.show(); }
  if (location.hash === '#blackjack' && bjMode === 'duel' && !state.duelShown) { state.duelShown = true; duel.refresh(); }
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

const VIEWS = ['home', 'notices', 'event', 'shop', 'blackjack', 'raid', 'rpg', 'results', 'coupons', 'games', 'rank', 'schedule', 'me'];
const GAME_VIEWS = ['blackjack', 'raid', 'rpg', 'games'];
let notices = null;

function route() {
  const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  VIEWS.forEach((v) => $(`#view-${v}`).classList.toggle('hidden', v !== view));
  markActive(view);
  document.body.classList.toggle('at-home', view === 'home');
  if (view === 'home' || view === 'notices') loadNotices();
  if (view === 'home') { renderHomeLotto(); loadEvents(); }
  if (view === 'results') renderResults();
  $('#game-nav').classList.toggle('hidden', !GAME_VIEWS.includes(view));
  $$('#game-nav [data-g]').forEach((a) => a.classList.toggle('on', a.dataset.g === view));
  if (view === 'blackjack') { blackjack.show(); setBjMode(bjMode); } else duel.hide();
  if (view === 'rpg') showRpg();
  else stopRpg();
  if (view === 'raid') showRaid();
  else stopRaid();
  if (view === 'games') games.show();
  else games.stop();
  if (view === 'coupons') renderCoupons();
  if (view === 'shop') renderShop();
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

// ---------- 크리스탈 소울 ----------
let rpgStop = null;
function showRpg() {
  if (!rpgStop) rpgStop = crystalSouls($('#rpg-area'), { onClear: submitSouls, claimInbox: claimSoulsInbox });
  loadSoulsBoard();
}
function stopRpg() {
  rpgStop?.();
  rpgStop = null;
}
// 점수: 빠를수록, 덜 죽을수록 높게
async function submitSouls({ ms, deaths }) {
  const score = Math.max(1000, Math.min(300000, 200000 - Math.floor(ms / 1000) * 20 - deaths * 2000));
  if (!state.me) { toast(`보스 처치! 점수 ${score.toLocaleString()} · 로그인하면 순위에 올라가요.`); return; }
  try {
    await api('/me/games/score', { game: 'souls', score });
    toast(`보스 처치 기록 ${score.toLocaleString()}점이 순위에 올라갔어요!`);
    loadSoulsBoard();
  } catch (err) {
    toast(err.message, true);
  }
}
async function loadSoulsBoard() {
  try {
    const d = await api('/games/souls');
    const me = state.me?.user.id;
    $('#rpg-lb-count').textContent = d.players ? `${d.players}명` : '';
    $('#rpg-lb').innerHTML = d.top.length
      ? d.top.map((r) => `<li class="${r.user === me ? 'me' : ''}"><span class="lb-rank">${r.rank}</span><span class="lb-user">${esc(r.user)}</span><b>${r.best.toLocaleString()}점</b></li>`).join('')
      : '<li class="muted small">아직 보스를 쓰러뜨린 사람이 없어요.</li>';
  } catch { /* 순위는 없어도 됨 */ }
}

// ---------- 8비트 레이드 ----------
let raid = null;
let raidData = null;
let raidRun = null;
const PRACTICE_HP = 80000;
function showRaid() {
  if (!raid) raid = eightBitRaid($('#raid-area'), { onEnd: raidEnded });
  loadRaid();
}
function stopRaid() {
  raid?.stop();
  raid = null;
}
const raidOpts = (r, practice) => (practice
  ? { boss: r.boss, level: r.level, hp: PRACTICE_HP, hpMax: PRACTICE_HP, practice: true }
  : { boss: r.boss, level: r.level, hp: r.hp, hpMax: r.hpMax, practice: false });
async function loadRaid() {
  try {
    raidData = await api('/raid');
    renderRaid();
    if (raid && !raid.busy) raid.setInfo(raidOpts(raidData.raid, false));
  } catch { /* 다음에 */ }
}
function renderRaid() {
  const d = raidData;
  if (!d) { $('#raid-practice').disabled = Boolean(raid?.busy); return; }
  const r = d.raid;
  const me = state.me?.user.id;
  $('#raid-level').textContent = `${r.level}단계`;
  $('#raid-name').textContent = r.name;
  $('#raid-hp-bar').style.width = `${Math.max(0, (100 * r.hp) / r.hpMax)}%`;
  $('#raid-hp').textContent = `${r.hp.toLocaleString()} / ${r.hpMax.toLocaleString()}`;
  $('#raid-players').textContent = r.players ? `${r.players}명 참여` : '';
  $('#raid-reward').textContent = d.reward ? `쓰러뜨리면 참여한 모두에게 로또권 ${d.reward}장!` : '';
  $('#raid-lb').innerHTML = r.top.length
    ? r.top.map((p) => `<li class="${p.user === me ? 'me' : ''}"><span class="lb-rank">${p.rank}</span><span class="lb-user">${esc(p.user)}</span><b>${p.dmg.toLocaleString()}</b></li>`).join('')
    : '<li class="muted small">아직 아무도 도전하지 않았어요.</li>';
  $('#raid-log').innerHTML = r.log.length
    ? r.log.map((x) => `<li><b>${esc(x.user)}</b> ${x.dmg.toLocaleString()} 피해 <span class="muted">${fmtTime(x.at)}</span></li>`).join('')
    : '<li class="muted small">기록이 없어요.</li>';
  $('#raid-hist-card').classList.toggle('hidden', !d.history.length);
  $('#raid-hist').innerHTML = d.history.map((h) => `<li><b>${esc(h.name)}</b> 처치 · 막타 ${esc(h.killer)} <span class="muted">${fmtTime(h.killedAt)}</span></li>`).join('');
  const go = $('#raid-go');
  const busy = raid?.busy;
  if (!d.enabled) { go.disabled = true; go.textContent = '레이드 닫힘'; $('#raid-left').textContent = ''; }
  else if (!state.me) { go.disabled = Boolean(busy); go.textContent = '로그인하고 도전'; $('#raid-left').textContent = '연습은 로그인 없이 할 수 있어요.'; }
  else { go.disabled = Boolean(busy) || !d.me?.left; go.textContent = d.me?.left ? '도전하기' : '오늘 도전 끝'; $('#raid-left').innerHTML = `오늘 ${d.me.used}/${d.dailyLimit + (d.me.bonus || 0)}번${d.me.bonus ? ` (상점 +${d.me.bonus})` : ''} · 내 누적 피해 ${(d.me.dmg || 0).toLocaleString()}${d.me.left ? '' : ' · <a href="#shop">상점에서 도전권 사기</a>'}`; }
  $('#raid-practice').disabled = Boolean(busy);
}
$('#raid-go').addEventListener('click', async () => {
  if (!state.me) { location.hash = '#me'; toast('로그인하면 길드 보스에 도전할 수 있어요.'); return; }
  if (!raid || raid.busy) return;
  try {
    const r = await api('/me/raid/start', {});
    raidRun = r.run;
    raid.start(raidOpts(r.raid, false));
    $('#raid-go').disabled = true; $('#raid-practice').disabled = true;
    $('#raid-area').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    api('/raid').then((d) => { raidData = d; }).catch(() => {});
  } catch (err) {
    toast(err.message, true);
    loadRaid();
  }
});
$('#raid-practice').addEventListener('click', () => {
  if (!raid || raid.busy) return;
  raid.start(raidOpts(raidData?.raid || { boss: 0, level: 1 }, true));
  $('#raid-go').disabled = true; $('#raid-practice').disabled = true;
});
async function raidEnded({ damage, practice }) {
  if (practice) { setTimeout(renderRaid, 50); return; }
  try {
    const r = await api('/me/raid/finish', { run: raidRun, damage });
    raidRun = null;
    raidData = r;
    raid?.saved(`BOSS HP -${r.applied}`);
    if (r.killed) toast(`${r.killed.name}을(를) 쓰러뜨렸어요! 막타: ${r.killed.killer}${r.killed.reward ? ` · 참여자 모두 로또권 ${r.killed.reward}장` : ''}`);
    else toast(`보스에게 ${damage.toLocaleString()} 피해를 넣었어요!`);
    if (r.killed && r.killed.reward) load();
  } catch (err) {
    raid?.saved('NOT SAVED');
    toast(err.message, true);
  }
  setTimeout(renderRaid, 50);
}

// 시작/마감 시간이 되면 화면을 새로 불러온다 (응모 열림·닫힘·자동 추첨 반영)
startCountdowns(() => setTimeout(load, 1500));

// ---------- 로또권 상점 ----------
const SOULS_ITEM_NAMES = { herb: '초록 약초', firebomb: '화염 단지', soul_s: '작은 소울 조각', soul_l: '큰 소울 조각', homeward: '귀환의 뼈', dagger: '단검', greatsword: '대검', spear: '창' };
const KIND_LABEL = { souls: '크리스탈 소울', raid: '8비트 레이드', manual: '운영진 지급' };
const shopIcons = {};
function shopIcon(p) {
  const key = p.kind === 'souls' ? (p.give.item || 'soul_l') : p.kind === 'raid' ? 'sword' : 'chest';
  if (!shopIcons[key]) shopIcons[key] = sprite(key === 'chest' ? CHEST : ICONS[key], PAL).toDataURL();
  return shopIcons[key];
}
function giveText(p) {
  if (p.kind === 'souls') return p.give.souls ? `소울 ${p.give.souls.toLocaleString()}` : `${SOULS_ITEM_NAMES[p.give.item]} ${p.give.n}개`;
  if (p.kind === 'raid') return `오늘 레이드 도전 +${p.give.tries}번`;
  return '운영진이 확인 후 지급';
}
const ORDER_STATUS = { done: ['받음', 'open'], pending: ['지급 대기', 'warn'], delivered: ['지급 완료', 'open'], refunded: ['취소·환불', ''] };
let shopData = null;
const shopQty = {};
async function renderShop() {
  try {
    shopData = await api('/shop');
  } catch (err) {
    $('#shop-grid').innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
    return;
  }
  const me = shopData.me;
  $('#shop-tickets').textContent = me ? `${me.tickets}장` : '로그인 필요';
  $('#shop-grid').innerHTML = shopData.products.length ? shopData.products.map((p) => {
    const q = shopQty[p.id] || 1;
    const bought = me?.counts?.[p.id] || 0;
    const soldOut = p.stock === 0;
    const left = p.dailyLimit ? p.dailyLimit - bought : Infinity;
    const can = me && !soldOut && left >= q && me.tickets >= p.price * q;
    return `<div class="card shop-item${soldOut ? ' sold' : ''}">
      <div class="shop-head"><img src="${shopIcon(p)}" alt="" class="shop-icon"><div><span class="badge">${KIND_LABEL[p.kind]}</span><h3>${esc(p.name)}</h3></div></div>
      <p class="muted small">${esc(p.desc || '')}</p>
      <div class="shop-give">${esc(giveText(p))}</div>
      <div class="shop-meta">${p.dailyLimit ? `<span>하루 ${p.dailyLimit}개${me ? ` · 오늘 ${bought}개 삼` : ''}</span>` : '<span>제한 없음</span>'}${p.stock != null ? `<span>${soldOut ? '품절' : `남은 ${p.stock}개`}</span>` : ''}</div>
      <div class="shop-buy">
        <div class="shop-qty"><button type="button" class="ghost sm" data-q="-" data-id="${p.id}" aria-label="하나 빼기">−</button><b>${q}</b><button type="button" class="ghost sm" data-q="+" data-id="${p.id}" aria-label="하나 더">＋</button></div>
        <button type="button" data-buy="${p.id}"${can ? '' : ' disabled'}>로또권 ${p.price * q}장으로 사기</button>
      </div>
    </div>`;
  }).join('') : '<div class="card empty">아직 파는 상품이 없어요.</div>';
  $('#shop-orders').innerHTML = !me ? '<li class="muted small">로그인하면 보여요.</li>' : me.orders.length
    ? me.orders.map((o) => `<li><span class="badge ${ORDER_STATUS[o.status][1]}">${ORDER_STATUS[o.status][0]}</span><b>${esc(o.product.name)}</b>${o.qty > 1 ? ` x${o.qty}` : ''} <span class="muted small">로또권 ${o.total}장 · ${fmtTime(o.at)}</span></li>`).join('')
    : '<li class="muted small">아직 산 게 없어요.</li>';
}
$('#shop-grid').addEventListener('click', async (ev) => {
  const qb = ev.target.closest('[data-q]');
  if (qb) {
    const id = qb.dataset.id;
    shopQty[id] = Math.max(1, Math.min(20, (shopQty[id] || 1) + (qb.dataset.q === '+' ? 1 : -1)));
    renderShop();
    return;
  }
  const bb = ev.target.closest('[data-buy]');
  if (!bb) return;
  if (!state.me) { location.hash = '#event'; toast('로그인하면 살 수 있어요.'); return; }
  const p = shopData.products.find((x) => x.id === bb.dataset.buy);
  const q = shopQty[p.id] || 1;
  if (!confirm(`로또권 ${p.price * q}장으로 「${p.name}」${q > 1 ? ` ${q}개` : ''}를 살까요?`)) return;
  bb.disabled = true;
  try {
    const r = await api('/me/shop/buy', { id: p.id, qty: q });
    toast(p.kind === 'souls' ? `샀어요! 크리스탈 소울을 켜면 가방에 들어와요.` : p.kind === 'raid' ? '샀어요! 오늘 레이드를 더 할 수 있어요.' : '샀어요! 운영진이 확인하고 지급해 줄 거예요.');
    shopQty[p.id] = 1;
    if (state.me) state.me.user = r.user;
    load();
    renderShop();
  } catch (err) {
    toast(err.message, true);
    renderShop();
  }
});
// 크리스탈 소울이 켜질 때·화톳불에서 쉴 때 가져감
async function claimSoulsInbox() {
  if (!state.me) return [];
  try { return (await api('/me/souls/claim', {})).items; } catch { return []; }
}

// ---------- 사이트 설정 (이름·문구·켜고 끈 기능) ----------
// 꺼진 기능은 메뉴에서 숨기고, 그 화면에 들어오면 홈으로. 카지노만 진행 중인 판이 있을 수 있어 안내만 보여 줌
const VIEW_FEATURE = { shop: 'shop', raid: 'raid', rpg: 'rpg', games: 'games', coupons: 'coupons', rank: 'rank', schedule: 'schedule' };
const GAME_ORDER = [['blackjack', 'casino'], ['raid', 'raid'], ['rpg', 'rpg'], ['games', 'games']];
let site = { features: {} };
let casinoOpen = true;
const featureOn = (k) => site.features?.[k] !== false;
function applySite() {
  $$('[data-site-name]').forEach((el) => (el.textContent = site.name || '크리스탈 길드'));
  if (site.name) document.title = site.name;
  $('#intro-desc').textContent = site.intro || '';
  $('#intro-desc').classList.toggle('hidden', !site.intro);
  let closedBanner = '';
  try { closedBanner = localStorage.getItem('crystal.bannerClosed') || ''; } catch { /* */ }
  $('#site-banner-text').textContent = site.banner || '';
  $('#site-banner').classList.toggle('hidden', !site.banner || closedBanner === site.banner);
  $$('[data-feature]').forEach((el) => el.classList.toggle('hidden', !featureOn(el.dataset.feature)));
  // '게임' 메뉴는 켜진 첫 게임으로, 전부 꺼지면 숨김
  const firstGame = GAME_ORDER.find(([, f]) => featureOn(f));
  $$('a[data-view="blackjack"]').forEach((a) => {
    a.classList.toggle('hidden', !firstGame);
    if (firstGame) a.setAttribute('href', `#${firstGame[0]}`);
  });
  casinoOpen = featureOn('casino');
  $('#casino-closed').classList.toggle('hidden', casinoOpen);
  $('#casino-closed-msg').textContent = site.casinoMessage || '운영진이 다시 열면 블랙잭과 1대1을 할 수 있어요.';
  const view = location.hash.slice(1);
  if (VIEW_FEATURE[view] && !featureOn(VIEW_FEATURE[view])) { toast('지금은 꺼져 있는 메뉴예요.'); location.hash = '#home'; }
  if (view === 'blackjack' && !casinoOpen && !state.me) location.hash = firstGame ? `#${firstGame[0]}` : '#home';
}
async function loadSite() {
  try {
    const [s2, c] = await Promise.all([api('/site'), api('/casino')]);
    site = { ...s2, casinoMessage: c.message };
    applySite();
  } catch { /* 모르면 그대로 */ }
}
$('#site-banner-x').addEventListener('click', () => {
  try { localStorage.setItem('crystal.bannerClosed', site.banner || ''); } catch { /* */ }
  $('#site-banner').classList.add('hidden');
});
window.addEventListener('hashchange', () => { if (site.name) applySite(); });
setInterval(() => { if (document.visibilityState === 'visible') loadSite(); }, 60000);

route();
load();
loadSite();
