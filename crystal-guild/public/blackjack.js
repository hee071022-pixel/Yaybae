// 블랙잭: 로또권을 걸고 딜러와 한 판. 카드는 서버가 들고 있고 화면은 보여주기만 한다.
import { $, toast } from './common.js';

const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RESULT = {
  blackjack: ['블랙잭!', 'win'],
  win: ['승리!', 'win'],
  push: ['무승부', 'push'],
  lose: ['패배', 'lose'],
  bust: ['버스트 (21 초과)', 'lose'],
};

function cardHtml(c, isNew, delay) {
  const style = isNew ? ` style="animation-delay:${delay}ms"` : '';
  if (c === '??') return `<div class="pc back${isNew ? ' deal' : ''}"${style}></div>`;
  const rank = c.slice(0, -1);
  const suit = c.slice(-1);
  const red = suit === 'H' || suit === 'D';
  return `<div class="pc${red ? ' red' : ''}${isNew ? ' deal' : ''}"${style}><span class="pc-r">${rank}<br>${SUIT[suit]}</span><span class="pc-s">${SUIT[suit]}</span></div>`;
}

export function setupBlackjack({ api, getUser, onUser }) {
  const s = { info: null, bet: 1, shown: { dealer: [], player: [] }, busy: false };

  // 새로 나온 카드만 살짝 내려오게
  function drawHand(el, cards, key) {
    const prev = s.shown[key];
    let k = 0;
    el.innerHTML = cards.map((c, i) => cardHtml(c, prev[i] !== c, (k++) * 120)).join('');
    s.shown[key] = [...cards];
  }

  function draw() {
    const info = s.info;
    const user = getUser();
    const g = info?.game;
    const cfg = info?.config;
    const playing = g?.status === 'playing';
    $('#bj-guest').classList.toggle('hidden', Boolean(user));
    $('#bj-tickets').textContent = user ? `${user.tickets}장` : '-';
    $('#bj-left').textContent = cfg?.dailyLimit ? `${info.left ?? 0} / ${cfg.dailyLimit}번` : '제한 없음';
    $('#bj-range').textContent = cfg ? `${cfg.minBet}~${cfg.maxBet}장` : '-';
    if (g) {
      drawHand($('#bj-dealer'), g.dealer, 'dealer');
      drawHand($('#bj-player'), g.player, 'player');
      $('#bj-dv').textContent = playing ? `${g.dealerValue} + ?` : g.dealerValue;
      $('#bj-pv').textContent = g.playerValue;
    } else {
      $('#bj-dealer').innerHTML = '<div class="pc back"></div><div class="pc back"></div>';
      $('#bj-player').innerHTML = '';
      $('#bj-dv').textContent = '';
      $('#bj-pv').textContent = '';
    }
    const msg = $('#bj-msg');
    if (playing) {
      msg.className = 'bj-msg';
      msg.innerHTML = `로또권 <b>${g.bet}장</b> 걸었어요 · 히트 또는 스탠드`;
    } else if (g?.result) {
      const [text, cls] = RESULT[g.result];
      msg.className = `bj-msg ${cls}`;
      msg.innerHTML = `<b>${text}</b> ${g.payout ? `로또권 ${g.payout}장 받음` : `로또권 ${g.bet}장 잃음`}${g.doubled ? ' (더블)' : ''}`;
    } else {
      msg.className = 'bj-msg';
      msg.textContent = cfg && !cfg.enabled ? '지금은 블랙잭을 쉬고 있어요.' : '걸 로또권을 정하고 딜을 누르세요.';
    }
    $('#bj-play-ctl').classList.toggle('hidden', !playing);
    $('#bj-bet-ctl').classList.toggle('hidden', playing);
    $('#bj-hit').disabled = s.busy;
    $('#bj-stand').disabled = s.busy;
    $('#bj-double').disabled = s.busy || !g?.canDouble || (user?.tickets ?? 0) < (g?.bet ?? 0);
    if (cfg) s.bet = Math.min(Math.max(s.bet, cfg.minBet), cfg.maxBet);
    $('#bj-bet').textContent = s.bet;
    const deal = $('#bj-deal');
    const noLeft = cfg?.dailyLimit && !info.left;
    deal.disabled = s.busy || !user || !cfg?.enabled || noLeft || (user?.tickets ?? 0) < s.bet;
    deal.textContent = !user ? '로그인하고 참여하기' : noLeft ? '오늘은 다 했어요' : (user.tickets < s.bet ? '로또권이 부족해요' : `로또권 ${s.bet}장 걸고 딜`);
  }

  async function load() {
    if (!getUser()) { s.info = null; draw(); return; }
    try {
      s.info = await api('/me/blackjack');
      draw();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function act(path, body = {}) {
    if (s.busy) return;
    s.busy = true;
    $$btns().forEach((b) => (b.disabled = true));
    try {
      const r = await api(path, body);
      onUser(r.user);
      s.info = { ...s.info, game: r.game, left: r.left };
    } catch (err) {
      toast(err.message, true);
      await load();
    } finally {
      s.busy = false;
      draw();
    }
  }
  const $$btns = () => ['#bj-hit', '#bj-stand', '#bj-double', '#bj-deal'].map((q) => $(q));

  $('#bj-minus').onclick = () => { s.bet--; draw(); };
  $('#bj-plus').onclick = () => { s.bet++; draw(); };
  $('#bj-deal').onclick = () => {
    s.shown = { dealer: [], player: [] };
    act('/me/blackjack/start', { bet: s.bet });
  };
  $('#bj-hit').onclick = () => act('/me/blackjack/hit');
  $('#bj-stand').onclick = () => act('/me/blackjack/stand');
  $('#bj-double').onclick = () => {
    if (confirm(`로또권 ${s.info.game.bet}장을 더 걸고 한 장만 받을까요?`)) act('/me/blackjack/double');
  };

  return { show: load, refresh: draw };
}


// ---------- 1대1 대결 ----------
const fmtLeftMin = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`;
};

export function setupDuel({ api, getUser, onUser, esc }) {
  const s = { lobby: null, bet: 1, timer: null, busy: false, shown: { me: [], op: [] }, lastId: null, active: false };

  function hand(cards, key) {
    const prev = s.shown[key];
    let k = 0;
    const html = cards.map((c, i) => cardHtml(c, prev[i] !== c, (k++) * 120)).join('');
    s.shown[key] = [...cards];
    return html;
  }

  function lobbyHtml(cfg) {
    s.bet = Math.min(Math.max(s.bet, cfg.minBet), cfg.maxBet);
    return `<div class="duel-lobby">
      <h2 style="margin:0">1대1 방 만들기</h2>
      <p class="muted small" style="margin:4px 0 12px">로또권을 걸고 방을 만들면 다른 길드원이 들어와서 바로 대결해요.</p>
      <div class="bj-bet" style="justify-content:center"><button type="button" class="ghost" data-d="minus">−</button><span>베팅 <b>${s.bet}</b>장</span><button type="button" class="ghost" data-d="plus">+</button></div>
      <div style="margin:12px auto 0;max-width:320px"><label for="duel-target">상대 지정 (선택)</label><input id="duel-target" maxlength="16" placeholder="비워두면 누구나 들어올 수 있어요" autocomplete="off"></div>
      <button class="block" style="max-width:320px;margin:12px auto 0" data-d="create"${cfg.enabled ? '' : ' disabled'}>${cfg.enabled ? `로또권 ${s.bet}장 걸고 방 만들기` : '지금은 쉬는 중'}</button>
    </div>`;
  }

  function tableHtml(d) {
    const playing = d.status === 'playing';
    let msg;
    if (d.status === 'done') {
      const win = d.winner && d.winner === getUser()?.id;
      const [title, cls, detail] = d.result === 'push' ? ['무승부', 'push', '로또권을 돌려받았어요']
        : win ? ['승리!', 'win', `로또권 ${d.bet * 2}장 받음`] : ['패배', 'lose', `로또권 ${d.bet}장 잃음`];
      msg = `<div class="bj-msg ${cls}"><b>${title}</b>${detail}${d.reason === 'timeout' ? ' (시간 초과)' : ''}</div>`;
    } else if (d.myDone) {
      msg = `<div class="bj-msg">멈췄어요 · <b style="font-size:15px">${esc(d.opName)}</b>님을 기다리는 중…</div>`;
    } else {
      msg = `<div class="bj-msg">판돈 <b>${d.bet * 2}장</b> · 히트 또는 스탠드${d.opDone ? ' · 상대는 멈췄어요' : ''}</div>`;
    }
    return `<div class="bj-table">
      <div class="bj-side"><span class="bj-who">${esc(d.opName)} <b>${d.opValue ?? '?'}</b>${playing && d.opDone ? ' · 멈춤' : ''}</span><div class="bj-hand">${hand(d.opHand, 'op')}</div></div>
      ${msg}
      <div class="bj-side"><span class="bj-who">나 <b>${d.myValue}</b></span><div class="bj-hand">${hand(d.myHand, 'me')}</div></div>
    </div>
    <div class="bj-controls">${playing && !d.myDone
      ? '<button data-d="hit">히트 (한 장 더)</button><button class="ghost" data-d="stand">스탠드 (멈춤)</button>'
      : d.status === 'done' ? '<button class="ghost" data-d="lobby">새 대결하기</button>' : ''}</div>
    ${playing ? `<p class="muted small center" style="margin:0">남은 시간 <span data-left="${d.expiresAt}">${fmtLeftMin(d.expiresAt - Date.now())}</span></p>` : ''}`;
  }

  function waitingHtml(d) {
    return `<div class="duel-wait">
      <div class="duel-spin"></div>
      <h2 style="margin:0">상대를 기다리는 중…</h2>
      <p class="muted">베팅 <b>${d.bet}장</b>${d.target ? ` · <b>${esc(d.target)}</b>님 지정` : ' · 누구나 참가 가능'}</p>
      <p class="muted small">남은 시간 <span data-left="${d.expiresAt}">${fmtLeftMin(d.expiresAt - Date.now())}</span> · 아무도 안 오면 로또권을 돌려받아요</p>
      <button class="ghost" data-d="cancel">방 취소하기</button>
    </div>`;
  }

  function draw() {
    const user = getUser();
    const main = document.getElementById('duel-main');
    if (!user) {
      main.innerHTML = '<div class="empty">로그인하면 1대1 대결을 할 수 있어요.<br><a href="#event">로그인하러 가기</a></div>';
      document.getElementById('duel-rooms').innerHTML = '';
      return;
    }
    const L = s.lobby;
    if (!L) return;
    const d = L.current;
    if (d?.id !== s.lastId) { s.shown = { me: [], op: [] }; s.lastId = d?.id || null; }
    const closed = d && (d.result === 'cancel' || d.result === 'expired');
    if (closed) {
      main.innerHTML = (s.dismissed === d.id ? '' : `<p class="duel-note">${d.result === 'expired' ? '아무도 안 들어와서 방이 닫혔어요.' : '방을 취소했어요.'} 로또권 ${d.bet}장을 돌려받았어요.</p>`) + lobbyHtml(L.config);
    } else if (d && s.dismissed === d.id && d.status === 'done') main.innerHTML = lobbyHtml(L.config);
    else if (d?.status === 'open') main.innerHTML = waitingHtml(d);
    else if (d) main.innerHTML = tableHtml(d);
    else main.innerHTML = lobbyHtml(L.config);
    const inRoom = d && d.status !== 'done';
    document.getElementById('duel-count').textContent = L.open.length ? `${L.open.length}개` : '';
    document.getElementById('duel-rooms').innerHTML = L.open.length
      ? L.open.map((r) => `<li class="${r.target ? 'pick' : ''}"><div><b>${esc(r.host)}</b>${r.target ? ' <span class="badge open">나를 지목</span>' : ''}
          <div class="muted small">베팅 ${r.bet}장 · <span data-left="${r.expiresAt}">${fmtLeftMin(r.expiresAt - Date.now())}</span> 남음</div></div>
          <button class="sm" data-join="${r.id}"${inRoom || user.tickets < r.bet ? ' disabled' : ''}>${user.tickets < r.bet ? '로또권 부족' : '참가'}</button></li>`).join('')
      : '<li class="muted small">열린 방이 없어요. 직접 방을 만들어 보세요!</li>';
    const badge = document.getElementById('duel-badge');
    const mineWaiting = L.open.filter((r) => r.target).length;
    badge.textContent = mineWaiting;
    badge.classList.toggle('hidden', !mineWaiting);
  }

  async function refresh() {
    if (!getUser()) { draw(); return; }
    try {
      s.lobby = await api('/me/duels');
      draw();
    } catch (err) {
      if (err.status !== 401) toast(err.message, true);
    }
  }

  async function act(path, body) {
    if (s.busy) return;
    s.busy = true;
    try {
      const r = await api(path, body);
      s.lobby = { ...s.lobby, current: r.current };
      s.dismissed = null;
      const me = await api('/me');
      onUser(me.user);
      await refresh();
    } catch (err) {
      toast(err.message, true);
      await refresh();
    } finally {
      s.busy = false;
    }
  }

  document.getElementById('duel-wrap').addEventListener('click', (e) => {
    const b = e.target.closest('[data-d],[data-join]');
    if (!b || b.disabled) return;
    const d = s.lobby?.current;
    if (b.dataset.join) {
      const room = s.lobby.open.find((r) => r.id === b.dataset.join);
      if (confirm(`${room.host}님과 로또권 ${room.bet}장을 걸고 대결할까요?`)) act('/me/duels/join', { id: room.id });
      return;
    }
    const k = b.dataset.d;
    if (k === 'minus') { s.bet--; draw(); }
    if (k === 'plus') { s.bet++; draw(); }
    if (k === 'create') act('/me/duels', { bet: s.bet, target: document.getElementById('duel-target').value.trim() });
    if (k === 'cancel' && confirm('방을 취소하고 로또권을 돌려받을까요?')) act('/me/duels/cancel', { id: d.id });
    if (k === 'hit') act('/me/duels/hit', { id: d.id });
    if (k === 'stand') act('/me/duels/stand', { id: d.id });
    if (k === 'lobby') { s.dismissed = d.id; draw(); }
  });

  // 남은 시간 표시는 1초마다, 상대 진행은 3초마다 새로고침
  setInterval(() => {
    document.querySelectorAll('#duel-wrap [data-left]').forEach((el) => (el.textContent = fmtLeftMin(+el.dataset.left - Date.now())));
  }, 1000);
  setInterval(() => {
    if (s.active && document.visibilityState === 'visible' && !s.busy) refresh();
  }, 3000);

  return {
    show() { s.active = true; refresh(); },
    hide() { s.active = false; },
    refresh,
  };
}
