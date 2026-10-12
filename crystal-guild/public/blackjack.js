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

