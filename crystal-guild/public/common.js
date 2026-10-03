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

export const STATUS_LABEL = { open: '응모 중', drawing: '추첨 중', drawn: '추첨 완료' };

export function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

export const GEM_SVG = `<svg class="gem" viewBox="0 0 64 64" aria-hidden="true">
  <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9c1ff"/><stop offset="1" stop-color="#4fd8ff"/></linearGradient>
  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b7bff"/><stop offset="1" stop-color="#2fb7e6"/></linearGradient></defs>
  <path d="M16 6h32l12 16-28 36L4 22z" fill="url(#g2)"/>
  <path d="M16 6l8 16h16l8-16zM4 22h20l8 36zM40 22h20L32 58z" fill="url(#g1)" opacity=".75"/>
  <path d="M24 22h16l-8 36z" fill="#fff" opacity=".35"/>
</svg>`;
