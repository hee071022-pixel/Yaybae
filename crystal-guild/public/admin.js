import { $, $$, esc, makeApi, winningBalls, entryBalls, rankBadge, STATUS_LABEL, fmtTime, toast, prizeList, GEM_SVG, setupMenu, setupTheme, syncClock, phaseOf, periodLabel, fmtLeft, startCountdowns } from './common.js';

const { api, getToken, setToken } = makeApi('crystal.admin');
$('#gem').innerHTML = GEM_SVG;
setupTheme();

const state = { users: [], round: null, selected: new Set(), search: '' };

// ---------- 로그인 ----------

$('#auth-form').onsubmit = async (e) => {
  e.preventDefault();
  $('#auth-btn').disabled = true;
  try {
    const { token } = await api('/admin/login', { id: $('#a-id').value.trim(), password: $('#a-pw').value });
    setToken(token);
    $('#a-pw').value = '';
    await load();
  } catch (err) {
    $('#auth-msg').textContent = err.message;
  } finally {
    $('#auth-btn').disabled = false;
  }
};

$('#logout').onclick = () => {
  setToken(null);
  showAuth();
};

function showAuth() {
  $('#menu-btn').classList.add('hidden');
  $('#menu').classList.add('hidden');
  $('#main').classList.add('hidden');
  $('#who').classList.add('hidden');
  $('#auth').classList.remove('hidden');
}

async function load() {
  if (!getToken()) return showAuth();
  try {
    const data = await api('/admin/overview');
    state.users = data.users;
    state.round = data.round;
  } catch (err) {
    if (err.status === 401) {
      setToken(null);
      return showAuth();
    }
    return toast(err.message, true);
  }
  const known = new Set(state.users.map((u) => u.id));
  state.selected = new Set([...state.selected].filter((id) => known.has(id)));
  $('#auth').classList.add('hidden');
  $('#menu-btn').classList.remove('hidden');
  $('#menu').classList.remove('hidden');
  $('#main').classList.remove('hidden');
  $('#who').classList.remove('hidden');
  renderRound();
  renderUsers();
  renderRoundSelect();
  if (location.hash === '#notices') loadNotices();
  if (location.hash === '#discord') loadDiscord();
}

async function run(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
    if (err.status === 401) showAuth();
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- 회차 ----------

function prizeInputs(prizes = {}) {
  return [1, 2, 3, 4, 5]
    .map(
      (r) => `<div class="row" style="flex-wrap:nowrap"><span class="badge" style="min-width:42px;text-align:center">${r}등</span>
      <input data-prize="${r}" maxlength="60" value="${esc(prizes[r] || '')}" placeholder="${r === 1 ? '예) 크리스탈 1000개' : '상품 (비워두면 없음)'}"></div>`,
    )
    .join('');
}

const readPrizes = () => Object.fromEntries($$('[data-prize]').map((i) => [i.dataset.prize, i.value.trim()]));

const RESET_HTML = `<div class="danger-zone stack"><b class="small">초기화</b>
  <p class="muted small">모든 회차·응모·당첨 기록을 지우고 다음 회차를 제1회부터 다시 시작해요. 되돌릴 수 없어요.</p>
  <button class="danger sm" id="reset-rounds">회차 초기화 (제1회부터)</button></div>`;

function bindReset() {
  const btn = $('#reset-rounds');
  if (!btn) return;
  btn.onclick = () => {
    if (!confirm('모든 회차와 응모 기록을 지우고 제1회부터 다시 시작할까요?')) return;
    if (!confirm('정말 초기화할까요? 되돌릴 수 없습니다.')) return;
    run(btn, async () => {
      await api('/admin/round/reset', {});
      toast('회차를 초기화했어요. 다음 회차는 제1회입니다.');
      $('#e-round').value = '';
      await load();
    });
  };
}

// ---------- 응모 기간 입력 ----------

// ms → datetime-local 값 (기기 시간대 기준)
function toLocalInput(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function scheduleInputs(r = {}) {
  return `<div class="stack"><b>응모 기간 <span class="muted small">(비워두면 제한 없음)</span></b>
    <div class="sched">
      <div><label for="sc-start">시작</label><input type="datetime-local" id="sc-start" value="${toLocalInput(r.startAt)}"></div>
      <div><label for="sc-end">마감</label><input type="datetime-local" id="sc-end" value="${toLocalInput(r.endAt)}"></div>
    </div>
    <div class="row">
      <button type="button" class="ghost sm" data-quick-sched="0">지금부터 1시간</button>
      <button type="button" class="ghost sm" data-quick-sched="21">오늘 21~22시</button>
      <button type="button" class="ghost sm" data-quick-sched="clear">기간 지우기</button>
    </div>
    <label class="check"><input type="checkbox" id="sc-auto" ${r.autoDraw === false ? '' : 'checked'}> 마감 시간에 자동 추첨</label>
  </div>`;
}

function bindScheduleQuick() {
  $$('[data-quick-sched]').forEach(
    (b) => (b.onclick = () => {
      const v = b.dataset.quickSched;
      if (v === 'clear') {
        $('#sc-start').value = '';
        $('#sc-end').value = '';
        return;
      }
      const start = new Date();
      if (v === '0') start.setSeconds(0, 0);
      else start.setHours(Number(v), 0, 0, 0);
      $('#sc-start').value = toLocalInput(start.getTime());
      $('#sc-end').value = toLocalInput(start.getTime() + 3600000);
    }),
  );
}

function readSchedule() {
  const ms = (id) => ($(id).value ? new Date($(id).value).getTime() : null);
  const startAt = ms('#sc-start');
  const endAt = ms('#sc-end');
  if (startAt && endAt && endAt <= startAt) throw new Error('마감 시간은 시작 시간보다 뒤여야 해요.');
  if (endAt && endAt <= Date.now()) throw new Error('마감 시간이 이미 지났어요.');
  return { startAt, endAt, autoDraw: $('#sc-auto').checked };
}

function renderRound() {
  const r = state.round;
  const el = $('#round-card');
  if (!r || r.status === 'drawn') {
    el.innerHTML = `
      <h2>회차 관리</h2>
      ${r ? `<div class="stack"><div class="row"><b>제${r.no}회 결과</b><span class="badge drawn">추첨 완료</span><span class="muted small">${fmtTime(r.drawnAt)}</span></div>
        ${winningBalls(r)}<p class="muted small">당첨 ${r.winners.length}줄 / 총 ${r.entryCount}줄</p></div>` : '<p class="muted small">아직 진행한 회차가 없어요.</p>'}
      <div class="stack"><b>제${r ? r.no + 1 : 1}회 상품 설정</b>${prizeInputs(r?.prizes)}</div>
      ${scheduleInputs()}
      <button class="block lg cyan" id="open-round">제${r ? r.no + 1 : 1}회 응모 시작</button>
      ${r ? RESET_HTML : ''}`;
    bindReset();
    bindScheduleQuick();
    $('#open-round').onclick = (e) =>
      run(e.target, async () => {
        const { round } = await api('/admin/round/open', { prizes: readPrizes(), ...readSchedule() });
        toast(round.startAt && round.startAt > Date.now() ? `제${round.no}회를 예약했어요. ${periodLabel(round)}` : `제${round.no}회 응모를 시작했어요.`);
        await load();
      });
    return;
  }
  syncClock(r.serverTime);
  const phase = phaseOf(r);
  const left =
    phase === 'soon' ? `시작까지 <b data-until="${r.startAt}">${fmtLeft(r.startAt - Date.now())}</b>`
    : phase === 'open' && r.endAt ? `마감까지 <b data-until="${r.endAt}">${fmtLeft(r.endAt - Date.now())}</b>${r.autoDraw ? ' · 마감되면 자동 추첨' : ''}`
    : phase === 'closed' ? (r.autoDraw ? '마감됨 · 곧 자동 추첨' : '마감됨 · 추첨해 주세요')
    : '';
  el.innerHTML = `
    <h2>제${r.no}회 <span class="badge ${phase}">${STATUS_LABEL[phase]}</span><span class="sub">${r.entryCount}줄 응모</span></h2>
    ${periodLabel(r) ? `<div class="period ${phase}"><div class="period-time">${periodLabel(r)}</div>${left ? `<div class="period-count">${left}</div>` : ''}</div>` : `<p class="muted small">시작 ${fmtTime(r.openedAt)} · 기간 제한 없음</p>`}
    <details class="sched-edit"><summary>응모 기간 바꾸기</summary>
      <div class="stack" style="margin-top:10px">${scheduleInputs(r)}<button class="ghost sm" id="save-sched">기간 저장</button></div>
    </details>
    <div class="stack"><b>상품</b>${prizeInputs(r.prizes)}<button class="ghost sm" id="save-prizes">상품 저장</button></div>
    <button class="gold block lg" id="draw">지금 추첨하기</button>
    <p class="muted small">추첨하면 응모가 마감되고 당첨번호 6개 + 보너스 1개가 무작위로 뽑혀요. 되돌릴 수 없어요.</p>
    ${RESET_HTML}`;
  bindReset();
  bindScheduleQuick();
  $('#save-sched').onclick = (e) =>
    run(e.target, async () => {
      const { round } = await api('/admin/round/schedule', readSchedule());
      toast(periodLabel(round) ? `응모 기간: ${periodLabel(round)}` : '기간 제한을 없앴어요.');
      await load();
    });
  $('#save-prizes').onclick = (e) =>
    run(e.target, async () => {
      await api('/admin/round/prizes', { prizes: readPrizes() });
      toast('상품을 저장했어요.');
      await load();
    });
  $('#draw').onclick = (e) => {
    if (!confirm(`제${r.no}회 추첨을 진행할까요? 응모가 마감됩니다.`)) return;
    run(e.target, async () => {
      const { round } = await api('/admin/round/draw', {});
      toast(`제${round.no}회 추첨 완료! 당첨 ${round.winners.length}줄`);
      await load();
      $('#e-round').value = String(round.no);
      loadEntries();
    });
  };
}

// ---------- 길드원 ----------

function renderUsers() {
  const q = state.search.toLowerCase();
  const list = state.users.filter((u) => u.id.toLowerCase().includes(q));
  $('#u-count').textContent = `${state.users.length}명 · 로또권 총 ${state.users.reduce((s, u) => s + u.tickets, 0)}장`;
  $('#u-body').innerHTML = list.length
    ? list
        .map(
          (u) => `<tr>
        <td><input type="checkbox" data-sel="${esc(u.id)}" ${state.selected.has(u.id) ? 'checked' : ''} aria-label="${esc(u.id)} 선택"></td>
        <td><b>${esc(u.id)}</b></td>
        <td class="num">${u.tickets}</td>
        <td><div class="row" style="flex-wrap:nowrap"><button class="sm" data-quick="1" data-id="${esc(u.id)}">+1</button><button class="sm" data-quick="5" data-id="${esc(u.id)}">+5</button><button class="ghost sm" data-quick="-1" data-id="${esc(u.id)}">−1</button></div></td>
        <td><button class="ghost sm" data-dc="${esc(u.id)}" title="디스코드 사용자 ID 설정">${u.discordId ? esc(u.discordId) : '등록'}</button></td>
        <td class="muted small">${fmtTime(u.createdAt)}</td>
        <td class="muted small">${fmtTime(u.lastLoginAt)}</td>
        <td><div class="row" style="flex-wrap:nowrap"><button class="ghost sm" data-reset="${esc(u.id)}">비번 초기화</button><button class="danger sm" data-del="${esc(u.id)}">삭제</button></div></td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="8" class="empty">${state.users.length ? '검색 결과가 없어요.' : '아직 가입한 길드원이 없어요. 길드원들에게 사이트 주소를 알려주세요!'}</td></tr>`;

  $$('[data-sel]').forEach(
    (c) => (c.onchange = () => { c.checked ? state.selected.add(c.dataset.sel) : state.selected.delete(c.dataset.sel); updateSelected(); }),
  );
  $$('[data-quick]').forEach(
    (b) => (b.onclick = () => run(b, async () => {
      const amount = +b.dataset.quick;
      await api('/admin/grant', { ids: [b.dataset.id], amount, reason: amount > 0 ? '운영자 지급' : '운영자 회수' });
      toast(`${b.dataset.id}님 로또권 ${amount > 0 ? '+' : ''}${amount}`);
      await load();
    })),
  );
  $$('[data-dc]').forEach(
    (b) => (b.onclick = () => {
      const cur = state.users.find((u) => u.id === b.dataset.dc)?.discordId || '';
      const v = prompt(`${b.dataset.dc}님의 디스코드 사용자 ID (17~20자리 숫자, 비우면 해제)`, cur);
      if (v === null) return;
      run(b, async () => {
        await api('/admin/user-discord', { id: b.dataset.dc, discordId: v.trim() });
        toast(v.trim() ? '디스코드 ID를 저장했어요.' : '디스코드 ID를 지웠어요.');
        await load();
      });
    }),
  );
  $$('[data-reset]').forEach(
    (b) => (b.onclick = () => {
      const pw = prompt(`${b.dataset.reset}님의 새 비밀번호 (4자 이상)`);
      if (!pw) return;
      run(b, async () => {
        await api('/admin/reset-password', { id: b.dataset.reset, password: pw });
        toast('비밀번호를 바꿨어요. 새 비밀번호를 길드원에게 알려주세요.');
      });
    }),
  );
  $$('[data-del]').forEach(
    (b) => (b.onclick = () => {
      if (!confirm(`${b.dataset.del}님 계정을 삭제할까요? 보유 로또권도 사라집니다.`)) return;
      run(b, async () => {
        await api('/admin/delete-user', { id: b.dataset.del });
        state.selected.delete(b.dataset.del);
        toast('삭제했어요.');
        await load();
      });
    }),
  );
  updateSelected();
}

function updateSelected() {
  const n = state.selected.size;
  $('#g-selected').textContent = `선택한 길드원에게 (${n}명)`;
  $('#g-selected').disabled = !n;
  const visible = $$('[data-sel]');
  $('#u-all').checked = visible.length > 0 && visible.every((c) => c.checked);
}

$('#u-all').onchange = (e) => {
  $$('[data-sel]').forEach((c) => (e.target.checked ? state.selected.add(c.dataset.sel) : state.selected.delete(c.dataset.sel)));
  renderUsers();
};
$('#u-search').oninput = (e) => {
  state.search = e.target.value.trim();
  renderUsers();
};

function grantPayload() {
  const amount = Number($('#g-amount').value);
  if (!Number.isInteger(amount) || amount === 0) {
    toast('수량을 정수로 입력하세요 (0 제외).', true);
    return null;
  }
  return { amount, reason: $('#g-reason').value.trim() || undefined };
}

$('#g-selected').onclick = (e) => {
  const p = grantPayload();
  if (!p) return;
  run(e.target, async () => {
    const { updated } = await api('/admin/grant', { ...p, ids: [...state.selected] });
    toast(`${updated.length}명에게 로또권 ${p.amount > 0 ? '+' : ''}${p.amount}장`);
    await load();
  });
};
$('#g-clear').onclick = (e) => {
  const total = state.users.reduce((n, u) => n + u.tickets, 0);
  if (!total) return toast('삭제할 로또권이 없어요.');
  if (!confirm(`전체 길드원의 로또권 ${total}장을 모두 삭제할까요? (모두 0장이 됩니다)`)) return;
  run(e.target, async () => {
    const { users } = await api('/admin/clear-tickets', {});
    toast(`${users}명의 로또권을 모두 삭제했어요.`);
    await load();
  });
};

$('#g-all').onclick = (e) => {
  const p = grantPayload();
  if (!p) return;
  if (!confirm(`전체 길드원 ${state.users.length}명에게 로또권 ${p.amount}장을 ${p.amount > 0 ? '지급' : '회수'}할까요?`)) return;
  run(e.target, async () => {
    const { updated } = await api('/admin/grant', { ...p, all: true });
    toast(`전체 ${updated.length}명에게 로또권 ${p.amount > 0 ? '+' : ''}${p.amount}장`);
    await load();
  });
};

// ---------- 응모 현황 ----------

function renderRoundSelect() {
  const sel = $('#e-round');
  const max = state.round?.no || 0;
  const prev = sel.value;
  sel.innerHTML = max
    ? Array.from({ length: max }, (_, i) => max - i).map((n) => `<option value="${n}">제${n}회</option>`).join('')
    : '<option value="">-</option>';
  if (prev && +prev <= max) sel.value = prev;
  loadEntries();
}
$('#e-round').onchange = loadEntries;

async function loadEntries() {
  const no = $('#e-round').value;
  const box = $('#entries');
  if (!no) {
    box.innerHTML = '<div class="empty">회차를 열면 응모 내역이 여기에 표시돼요.</div>';
    return;
  }
  try {
    const { round, entries } = await api(`/admin/rounds/${no}/entries`);
    const byUser = new Map();
    for (const e of entries) byUser.set(e.user, (byUser.get(e.user) || 0) + 1);
    box.innerHTML = `
      ${round.status === 'drawn' ? `<div class="stack" style="margin-bottom:14px"><div class="row"><b>당첨번호</b>${winningBalls(round, { size: 'sm' })}</div>${prizeList(round.prizes)}</div>` : ''}
      <p class="muted small">${entries.length}줄 · 참여 ${byUser.size}명</p>
      ${
        entries.length
          ? `<div class="table-wrap"><table><thead><tr><th>길드원</th><th>번호</th><th>방식</th><th>응모 시각</th><th>결과</th></tr></thead><tbody>${entries
              .slice()
              .sort((a, b) => (a.rank || 9) - (b.rank || 9) || a.createdAt - b.createdAt)
              .map(
                (e) => `<tr><td><b>${esc(e.user)}</b></td><td>${entryBalls(e.numbers, round)}</td><td class="muted small">${e.auto ? '자동' : '수동'}</td>
                  <td class="muted small">${fmtTime(e.createdAt)}</td><td>${rankBadge(e.rank)}</td></tr>`,
              )
              .join('')}</tbody></table></div>`
          : '<div class="empty">아직 응모가 없어요.</div>'
      }`;
  } catch (err) {
    box.innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
  }
}

load();

// 시작/마감 시간이 되면 새로 불러오기
startCountdowns(() => setTimeout(() => getToken() && load(), 1500));

// ---------- 메인 메뉴 ----------

const VIEWS = ['event', 'notices', 'members', 'discord'];
function route() {
  const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'event';
  VIEWS.forEach((v) => $(`#view-${v}`).classList.toggle('hidden', v !== view));
  markActive(view);
  if (view === 'notices' && getToken()) loadNotices();
  if (view === 'discord' && getToken()) loadDiscord();
}
const markActive = setupMenu();
window.addEventListener('hashchange', route);
route();

// ---------- 공지사항 ----------

let notices = [];

async function loadNotices() {
  try {
    notices = (await api('/notices')).notices;
  } catch (err) {
    return toast(err.message, true);
  }
  $('#n-count').textContent = `${notices.length}개`;
  $('#n-list').innerHTML = notices.length
    ? notices
        .map(
          (n) => `<div class="notice">
        <div class="row">${n.pinned ? '<span class="badge pin">공지</span>' : ''}<b>${esc(n.title)}</b>
          <span class="muted small" style="margin-left:auto">${fmtTime(n.createdAt)}</span></div>
        ${n.body ? `<div class="body">${esc(n.body)}</div>` : ''}
        <div class="row" style="margin-top:10px">
          <button class="ghost sm" data-pin="${n.id}">${n.pinned ? '고정 해제' : '고정'}</button>
          <button class="ghost sm" data-edit="${n.id}">수정</button>
          <button class="danger sm" data-ndel="${n.id}">삭제</button>
        </div></div>`,
        )
        .join('')
    : '<div class="empty">아직 공지가 없어요. 왼쪽에서 첫 공지를 써보세요.</div>';

  const find = (id) => notices.find((n) => n.id === id);
  $$('[data-pin]').forEach(
    (b) => (b.onclick = () => run(b, async () => {
      const n = find(b.dataset.pin);
      await api('/admin/notices/edit', { ...n, pinned: !n.pinned });
      await loadNotices();
    })),
  );
  $$('[data-edit]').forEach((b) => (b.onclick = () => fillNoticeForm(find(b.dataset.edit))));
  $$('[data-ndel]').forEach(
    (b) => (b.onclick = () => {
      if (!confirm(`"${find(b.dataset.ndel).title}" 공지를 삭제할까요?`)) return;
      run(b, async () => {
        await api('/admin/notices/delete', { id: b.dataset.ndel });
        if ($('#n-id').value === b.dataset.ndel) fillNoticeForm(null);
        toast('공지를 삭제했어요.');
        await loadNotices();
      });
    }),
  );
}

function fillNoticeForm(n) {
  $('#n-id').value = n?.id || '';
  $('#n-title').value = n?.title || '';
  $('#n-body').value = n?.body || '';
  $('#n-pinned').checked = Boolean(n?.pinned);
  $('#n-discord').checked = true;
  $('#n-discord-wrap').classList.toggle('hidden', Boolean(n)); // 수정할 때는 다시 보내지 않음
  $('#n-form-title').textContent = n ? '공지 수정' : '공지 쓰기';
  $('#n-save').textContent = n ? '수정 저장' : '공지 올리기';
  $('#n-cancel').classList.toggle('hidden', !n);
  if (n) $('#n-title').focus();
}

$('#n-cancel').onclick = () => fillNoticeForm(null);
$('#n-form').onsubmit = (e) => {
  e.preventDefault();
  const id = $('#n-id').value;
  const payload = { title: $('#n-title').value, body: $('#n-body').value, pinned: $('#n-pinned').checked };
  run($('#n-save'), async () => {
    await api(id ? '/admin/notices/edit' : '/admin/notices', id ? { id, ...payload } : { ...payload, discord: $('#n-discord').checked });
    toast(id ? '공지를 수정했어요.' : '공지를 올렸어요. 길드원 화면에 바로 보여요.');
    fillNoticeForm(null);
    await loadNotices();
  });
};

// ---------- 디스코드 연동 ----------

function renderDiscord(d) {
  $('#d-hook').value = '';
  $('#d-hook').placeholder = d.webhookSet ? `저장됨: ${d.webhookPreview}` : 'https://discord.com/api/webhooks/...';
  $('#d-hook-state').innerHTML = d.webhookSet ? '<span class="badge open">연결됨</span>' : '<span class="badge">미연결</span>';
  $('#d-n-notice').checked = d.notify.notice;
  $('#d-n-open').checked = d.notify.open;
  $('#d-n-draw').checked = d.notify.draw;
  $('#d-n-mention').value = d.noticeMention;
  $('#d-n-winners').checked = d.notify.mentionWinners;
  renderPicks();
  $('#s-send').disabled = !d.webhookSet;
  $('#s-send').title = d.webhookSet ? '' : '먼저 웹후크 주소를 저장하세요';
  $('#d-hook-test').disabled = !d.webhookSet;
  $('#d-hook-clear').classList.toggle('hidden', !d.webhookSet || d.fromEnv.webhookUrl);
  $('#d-hook').disabled = d.fromEnv.webhookUrl;
}

async function loadDiscord() {
  try {
    renderDiscord(await api('/admin/discord'));
  } catch (err) {
    toast(err.message, true);
  }
}

const notifyValues = () => ({
  notice: $('#d-n-notice').checked,
  open: $('#d-n-open').checked,
  draw: $('#d-n-draw').checked,
  mentionWinners: $('#d-n-winners').checked,
});

// 멘션할 길드원 고르기 (디스코드 ID를 등록한 길드원만)
const picked = new Set();
function renderPicks() {
  const q = $('#s-search').value.trim().toLowerCase();
  const linked = state.users.filter((u) => u.discordId);
  const list = linked.filter((u) => u.id.toLowerCase().includes(q));
  $('#s-picks').innerHTML = linked.length
    ? list
        .map(
          (u) => `<label class="check pick"><input type="checkbox" data-pick="${esc(u.discordId)}" ${picked.has(u.discordId) ? 'checked' : ''}>
            ${esc(u.id)} <span class="muted small">${esc(u.discordId)}</span></label>`,
        )
        .join('') || '<p class="muted small">검색 결과가 없어요.</p>'
    : '<p class="muted small">디스코드 ID를 등록한 길드원이 없어요. 길드원 · 로또권 메뉴에서 등록하거나, 길드원이 사이트에서 직접 등록할 수 있어요.</p>';
  $('#s-pick-count').textContent = picked.size ? `(${picked.size}명 선택)` : '';
  $$('[data-pick]').forEach(
    (c) => (c.onchange = () => {
      c.checked ? picked.add(c.dataset.pick) : picked.delete(c.dataset.pick);
      $('#s-pick-count').textContent = picked.size ? `(${picked.size}명 선택)` : '';
    }),
  );
}
$('#s-search').oninput = renderPicks;

$('#d-hook-save').onclick = (e) =>
  run(e.target, async () => {
    const body = { notify: notifyValues(), noticeMention: $('#d-n-mention').value };
    const url = $('#d-hook').value.trim();
    if (url) body.webhookUrl = url;
    renderDiscord(await api('/admin/discord', body));
    toast(url ? '웹후크를 저장했어요. 테스트 메시지로 확인해 보세요.' : '알림 설정을 저장했어요.');
  });
$('#d-hook-test').onclick = (e) =>
  run(e.target, async () => {
    await api('/admin/discord/test', {});
    toast('디스코드 채널에 테스트 메시지를 보냈어요.');
  });
$('#d-hook-clear').onclick = (e) => {
  if (!confirm('디스코드 채널 알림 연결을 해제할까요?')) return;
  run(e.target, async () => {
    renderDiscord(await api('/admin/discord', { webhookUrl: '' }));
    toast('알림 연결을 해제했어요.');
  });
};

$('#s-form').onsubmit = (e) => {
  e.preventDefault();
  const mention = $('#s-mention').value;
  const typed = $('#s-ids').value.split(/[\s,]+/).filter(Boolean);
  const users = [...new Set([...picked, ...typed])];
  if (mention !== 'none' && !confirm(`@${mention} 멘션과 함께 보낼까요? 알림이 많은 사람에게 갑니다.`)) return;
  run($('#s-send'), async () => {
    await api('/admin/discord/send', { title: $('#s-title').value, message: $('#s-msg').value, mention, users });
    $('#s-title').value = '';
    $('#s-msg').value = '';
    $('#s-ids').value = '';
    $('#s-mention').value = 'none';
    picked.clear();
    renderPicks();
    toast('디스코드 채널에 보냈어요.');
  });
};
