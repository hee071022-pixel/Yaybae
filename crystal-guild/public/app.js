import {
  $, $$, esc, makeApi, ball, ballClass, winningBalls, entryBalls, rankBadge,
  STATUS_LABEL, fmtTime, toast, prizeList, RULES, GEM_SVG, setupMenu,
} from './common.js';

const { api, getToken, setToken } = makeApi('crystal.user');
$('#gem').innerHTML = GEM_SVG;

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

function renderRound(round, entries) {
  const el = $('#round-card');
  if (!round) {
    el.innerHTML = `<h2>이번 회차</h2><div class="empty">운영자가 회차를 열면 응모할 수 있어요.</div><p class="muted small center">${RULES}</p>`;
    return;
  }
  const head = `<h2>제${round.no}회 <span class="badge ${round.status}">${STATUS_LABEL[round.status]}</span>
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
  el.innerHTML = `${head}<div class="stack"><div><b>상품</b></div>${prizeList(round.prizes)}
    <p class="muted small">${RULES}</p>
    <p class="muted small">회차 시작 ${fmtTime(round.openedAt)} · 운영자가 추첨하면 결과가 여기에 표시돼요.</p></div>`;
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

const isOpen = () => state.me?.round?.status === 'open';
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

const VIEWS = ['home', 'notices', 'event'];
let notices = null;

function route() {
  const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  VIEWS.forEach((v) => $(`#view-${v}`).classList.toggle('hidden', v !== view));
  markActive(view);
  if (view !== 'event') loadNotices();
  if (view === 'home') renderHomeLotto();
}
const markActive = setupMenu();
window.addEventListener('hashchange', route);

function noticeItem(n, open = false) {
  return `<details class="notice"${open ? ' open' : ''}><summary>
      ${n.pinned ? '<span class="badge pin">고정</span>' : ''}<span class="title">${esc(n.title)}</span>
      <span class="date">${fmtTime(n.createdAt)}</span></summary>
      ${n.body ? `<div class="body">${esc(n.body)}</div>` : ''}</details>`;
}

async function loadNotices() {
  try {
    notices = (await api('/notices')).notices;
  } catch {
    notices = notices || [];
  }
  const empty = '<div class="empty">아직 공지사항이 없어요.</div>';
  $('#notice-list').innerHTML = notices.length ? notices.map((n, i) => noticeItem(n, i === 0)).join('') : empty;
  $('#home-notices').innerHTML = notices.length ? notices.slice(0, 4).map((n) => noticeItem(n)).join('') : empty;
}

async function renderHomeLotto() {
  const box = $('#home-lotto');
  const me = state.me;
  let html = '';
  if (me) {
    const r = me.round;
    html += `<div class="ticket-box"><div class="num">${me.user.tickets}</div><div><b>장 보유</b><div class="lbl">내 로또권</div></div></div>`;
    html += r
      ? `<p>제${r.no}회 <span class="badge ${r.status}">${STATUS_LABEL[r.status]}</span> · 내 응모 ${me.entries.length}줄</p>`
      : '<p class="muted small">아직 열린 회차가 없어요.</p>';
  } else {
    html += '<p class="muted small">로그인하면 로또권으로 매 회차 응모할 수 있어요.</p>';
  }
  try {
    const { rounds } = await api('/history');
    if (rounds[0]) html += `<div class="stack"><b class="small">제${rounds[0].no}회 당첨번호</b>${winningBalls(rounds[0], { size: 'sm' })}</div>`;
  } catch {}
  html += `<a class="btn block" href="#event">${me ? '응모하러 가기' : '로그인 / 가입'}</a>`;
  box.innerHTML = html;
}

route();
load();
