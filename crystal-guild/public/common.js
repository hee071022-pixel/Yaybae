// 유저/운영자 페이지 공용 도우미
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function makeApi(tokenKey) {
  const getToken = () => {
    try { return localStorage.getItem(tokenKey); } catch { return null; }
  };
  const setToken = (t) => {
    try { t ? localStorage.setItem(tokenKey, t) : localStorage.removeItem(tokenKey); } catch {}
  };
  async function api(path, body) {
    const headers = { 'content-type': 'application/json' };
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error(data.error || `요청 실패 (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  return { api, getToken, setToken };
}

export const ballClass = (n) => (n <= 10 ? 'r1' : n <= 20 ? 'r2' : n <= 30 ? 'r3' : n <= 40 ? 'r4' : 'r5');

export function ball(n, { size = '', dim = false, pop = false, delay = 0 } = {}) {
  const cls = ['ball', ballClass(n), size, dim ? 'dim' : '', pop ? 'pop' : ''].filter(Boolean).join(' ');
  const style = pop ? ` style="animation-delay:${delay}ms"` : '';
  return `<span class="${cls}"${style}>${n}</span>`;
}

export function winningBalls(round, { size = '', pop = false } = {}) {
  const main = round.numbers.map((n, i) => ball(n, { size, pop, delay: i * 350 })).join('');
  return `<div class="balls">${main}<span class="plus">+</span>${ball(round.bonus, { size, pop, delay: 6 * 350 + 250 })}</div>`;
}

// 내 번호 줄: 당첨번호와 맞은 것만 밝게
export function entryBalls(numbers, round) {
  const drawn = round && round.status === 'drawn';
  return `<div class="balls">${numbers
    .map((n) => ball(n, { size: 'sm', dim: drawn && !round.numbers.includes(n) && n !== round.bonus }))
    .join('')}</div>`;
}

export function rankBadge(rank) {
  if (rank === undefined) return '<span class="badge">추첨 대기</span>';
  return rank ? `<span class="badge win">${rank}등 당첨</span>` : '<span class="badge">낙첨</span>';
}

export const STATUS_LABEL = { open: '응모 중', drawing: '추첨 중', drawn: '추첨 완료', soon: '응모 예정', closed: '마감' };

// 서버 시계 기준 현재 시각 (기기 시계가 틀려도 마감 판단이 어긋나지 않게)
let clockSkew = 0;
export const syncClock = (serverTime) => { if (serverTime) clockSkew = serverTime - Date.now(); };
export const nowMs = () => Date.now() + clockSkew;

// 회차의 실제 상태: soon(시작 전) / open / closed(마감, 추첨 대기) / drawing / drawn
export function phaseOf(r, now = nowMs()) {
  if (!r) return null;
  if (r.status !== 'open') return r.status;
  if (r.startAt && now < r.startAt) return 'soon';
  if (r.endAt && now >= r.endAt) return 'closed';
  return 'open';
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
// 2026년 10월 4일 (일) 21:00
export function fmtFull(ts) {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 응모 기간 한 줄: 같은 날이면 끝은 시간만
export function periodLabel(r) {
  if (!r.startAt && !r.endAt) return '';
  const same = r.startAt && r.endAt && new Date(r.startAt).toDateString() === new Date(r.endAt).toDateString();
  const end = r.endAt ? (same ? fmtFull(r.endAt).split(') ')[1] : fmtFull(r.endAt)) : '추첨할 때';
  return `${r.startAt ? fmtFull(r.startAt) : '지금'} ~ ${end}`;
}

// 남은 시간: 1일 2시간 / 3시간 5분 / 12:04
export function fmtLeft(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  if (d) return `${d}일 ${h}시간`;
  if (h) return `${h}시간 ${m}분`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// 남은 시간 표시: data-until 이 붙은 요소를 매초 갱신, 시간이 되면 onDue 호출
export function startCountdowns(onDue) {
  setInterval(() => {
    let due = false;
    document.querySelectorAll('[data-until]').forEach((el) => {
      const left = Number(el.dataset.until) - nowMs();
      if (left <= 0 && !el.dataset.fired) { el.dataset.fired = '1'; due = true; }
      el.textContent = fmtLeft(left);
    });
    if (due) onDue();
  }, 1000);
}

export function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

let toastTimer;
export function toast(msg, isErr = false) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `show${isErr ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2800);
}

export function prizeList(prizes) {
  const rows = [1, 2, 3, 4, 5]
    .filter((r) => prizes && prizes[r])
    .map((r) => `<span class="rk">${r}등</span><span>${esc(prizes[r])}</span>`)
    .join('');
  return rows ? `<div class="prizes">${rows}</div>` : '<p class="muted small">등록된 상품이 없습니다.</p>';
}

export const RULES = '6개 일치 1등 · 5개+보너스 2등 · 5개 3등 · 4개 4등 · 3개 5등';

// 상단 로고: 크리스탈 길드 그림
export const GEM_SVG = `<img class="gem" src="/logo-128.png" alt="" width="40" height="40">`;

// ☰ 메뉴: 열기/닫기, 현재 페이지 표시
export function setupMenu() {
  const btn = $('#menu-btn');
  const set = (open) => {
    document.body.classList.toggle('menu-open', open);
    btn.setAttribute('aria-expanded', String(open));
  };
  btn.onclick = () => set(!document.body.classList.contains('menu-open'));
  $('#menu-backdrop').onclick = () => set(false);
  $$('#menu a').forEach((a) => a.addEventListener('click', () => set(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  return function markActive(view) {
    $$('#menu a').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
    const on = $(`#menu a[data-view="${view}"]`);
    $('#page-title').textContent = on ? on.firstChild.textContent.trim() : '';
  };
}

// 밝은 화면 / 어두운 화면 전환 (선택은 이 기기에 저장)
export function setupTheme() {
  const btn = $('#theme-btn');
  const apply = (t) => {
    document.documentElement.dataset.theme = t;
    btn.setAttribute('aria-label', t === 'dark' ? '밝은 화면으로' : '어두운 화면으로');
    btn.title = btn.getAttribute('aria-label');
  };
  apply(document.documentElement.dataset.theme || 'light');
  btn.onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem('crystal.theme', next); } catch {}
  };
}

// 휴대폰에서 data-fold 칸은 제목만 보이고, 제목을 누르면 펼쳐진다
export function setupFolds() {
  document.addEventListener('click', (e) => {
    const h = e.target.closest('[data-fold] > h2:first-child');
    if (!h || e.target.closest('button, a, select, input')) return;
    h.parentElement.classList.toggle('open');
  });
}
