// 크리스탈 길드 로또 API — Netlify Functions + Netlify Blobs
//
// 환경 변수
//   ADMIN_PASSWORD  (필수) 운영자 비밀번호
//   ADMIN_ID        (선택) 운영자 아이디, 기본값 "admin"
//   SESSION_SECRET  (선택) 로그인 토큰 서명 키. 없으면 Blobs에 자동 생성해 저장
//
// 저장 구조 (store "crystal-guild")
//   users/<id>                         회원 정보, 보유 로또권, 로또권 내역
//   meta                               { round: 현재 회차 번호 }
//   rounds/<no>                        회차 정보, 상품, 당첨번호, 당첨자
//   entries/<no>/<userId>/<entryId>    응모한 번호 한 줄
//   notices/<id>                       공지사항

import { getStore } from '@netlify/blobs';
import { createHmac, createPublicKey, randomBytes, randomInt, scryptSync, timingSafeEqual, verify } from 'node:crypto';

export const STORE_NAME = 'crystal-guild';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const HISTORY_LIMIT = 30;
const MAX_LINES_PER_REQUEST = 20;
export const RANKS = [1, 2, 3, 4, 5];

// ---------- 공통 유틸 ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 32).toString('hex') };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function verifyPassword(password, user) {
  return safeEqual(hashPassword(password, user.salt).hash, user.hash);
}

const ID_RE = /^[0-9A-Za-z가-힣_]{2,16}$/;

function userKey(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(404, '회원을 찾을 수 없습니다.');
  return `users/${keyPart(id)}`;
}

// 한글 닉네임도 안전하게 키로 쓰도록 소문자 → hex 로 변환
const keyPart = (id) => Buffer.from(id.toLowerCase()).toString('hex');

function validateId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new HttpError(400, '닉네임은 한글/영문/숫자/_ 2~16자로 입력하세요.');
  }
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 4 || pw.length > 64) {
    throw new HttpError(400, '비밀번호는 4~64자로 입력하세요.');
  }
}

export function validateNumbers(numbers) {
  if (!Array.isArray(numbers) || numbers.length !== 6) throw new HttpError(400, '번호는 6개를 골라야 합니다.');
  const set = new Set(numbers);
  if (set.size !== 6) throw new HttpError(400, '같은 번호를 두 번 고를 수 없습니다.');
  for (const n of numbers) {
    if (!Number.isInteger(n) || n < 1 || n > 45) throw new HttpError(400, '번호는 1~45 사이여야 합니다.');
  }
  return [...numbers].sort((a, b) => a - b);
}

export function pickNumbers(count = 6) {
  const pool = Array.from({ length: 45 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// 한국 로또 규칙: 6개 1등, 5개+보너스 2등, 5개 3등, 4개 4등, 3개 5등
export function rankOf(numbers, winning, bonus) {
  const hit = numbers.filter((n) => winning.includes(n)).length;
  if (hit === 6) return 1;
  if (hit === 5 && numbers.includes(bonus)) return 2;
  if (hit === 5) return 3;
  if (hit === 4) return 4;
  if (hit === 3) return 5;
  return 0;
}

// 낙관적 잠금으로 문서를 갱신한다. mutate가 새 값을 반환하면 저장, undefined면 변경 없음.
async function update(store, key, mutate, { create } = {}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await store.getWithMetadata(key, { type: 'json' });
    if (!cur && !create) throw new HttpError(404, '대상을 찾을 수 없습니다.');
    const base = cur ? cur.data : create();
    const next = await mutate(structuredClone(base));
    if (next === undefined) return base;
    const res = cur
      ? await store.setJSON(key, next, { onlyIfMatch: cur.etag })
      : await store.setJSON(key, next, { onlyIfNew: true });
    if (res.modified) return next;
  }
  throw new HttpError(409, '요청이 몰리고 있습니다. 잠시 후 다시 시도하세요.');
}

async function listJSON(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const docs = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  return docs.filter(Boolean);
}

// ---------- 토큰 ----------

async function getSecret(store) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const existing = await store.get('config/secret');
  if (existing) return existing;
  await store.set('config/secret', randomBytes(32).toString('hex'), { onlyIfNew: true });
  return store.get('config/secret');
}

async function signToken(store, payload) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL_MS }));
  const sig = createHmac('sha256', await getSecret(store)).update(body).digest('base64url');
  return `${body}.${sig}`;
}

async function readToken(store, req) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', await getSecret(store)).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

async function requireUser(store, req) {
  const t = await readToken(store, req);
  if (!t || t.role !== 'user') throw new HttpError(401, '로그인이 필요합니다.');
  const user = await store.get(userKey(t.id), { type: 'json' });
  if (!user) throw new HttpError(401, '계정을 찾을 수 없습니다. 다시 로그인하세요.');
  if (user.pwv !== t.pwv) throw new HttpError(401, '비밀번호가 변경되었습니다. 다시 로그인하세요.');
  return user;
}

async function requireAdmin(store, req) {
  const t = await readToken(store, req);
  if (!t || t.role !== 'admin') throw new HttpError(401, '운영자 로그인이 필요합니다.');
}

// ---------- 표시용 변환 ----------

const publicUser = (u) => ({
  id: u.id,
  discordId: u.discordId || '',
  tickets: u.tickets,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt || null,
  history: u.history || [],
});

function publicRound(r) {
  if (!r) return null;
  const out = {
    no: r.no, status: r.status, openedAt: r.openedAt, prizes: r.prizes, entryCount: r.entryCount || 0,
    startAt: r.startAt || null, endAt: r.endAt || null, autoDraw: Boolean(r.autoDraw), serverTime: Date.now(),
  };
  if (r.status === 'drawn') Object.assign(out, { drawnAt: r.drawnAt, numbers: r.numbers, bonus: r.bonus, winners: r.winners });
  return out;
}

// 응모 기간: startAt ~ endAt (ms). 비어 있으면 그쪽 제한 없음.
const MAX_SCHEDULE_MS = 1000 * 60 * 60 * 24 * 366;

function cleanSchedule(body, now = Date.now()) {
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const startAt = num(body.startAt);
  const endAt = num(body.endAt);
  for (const v of [startAt, endAt]) {
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > now + MAX_SCHEDULE_MS)) throw new HttpError(400, '응모 기간 시간이 올바르지 않습니다.');
  }
  if (startAt !== null && endAt !== null && endAt <= startAt) throw new HttpError(400, '마감 시간은 시작 시간보다 뒤여야 합니다.');
  if (endAt !== null && endAt <= now) throw new HttpError(400, '마감 시간이 이미 지났습니다.');
  return { startAt, endAt, autoDraw: endAt !== null && body.autoDraw !== false };
}

// 지금 응모할 수 있는지: 열린 회차 + 기간 안
function entryBlock(round, now = Date.now()) {
  if (!round || round.status !== 'open') return '지금은 응모할 수 있는 회차가 없습니다.';
  if (round.startAt && now < round.startAt) return '아직 응모 시작 전입니다.';
  if (round.endAt && now >= round.endAt) return '응모가 마감되었습니다.';
  return '';
}

// 마감 시간이 지난 자동 추첨 회차를 추첨한다. 동시에 여러 요청이 와도 한 번만 추첨된다.
export async function autoDrawIfDue(store) {
  const cur = await currentRound(store);
  if (!cur || cur.status === 'drawn' || !cur.autoDraw || !cur.endAt || Date.now() < cur.endAt) return null;
  try {
    return await draw(store);
  } catch (err) {
    if (err instanceof HttpError) return null; // 다른 요청이 먼저 추첨함
    throw err;
  }
}

async function currentRound(store) {
  const meta = await store.get('meta', { type: 'json' });
  if (!meta || !meta.round) return null;
  return store.get(`rounds/${meta.round}`, { type: 'json' });
}

function pushHistory(user, delta, reason) {
  user.history = [{ at: Date.now(), delta, reason, balance: user.tickets }, ...(user.history || [])].slice(0, HISTORY_LIMIT);
}

// ---------- 회원 ----------

async function signup(store, body) {
  const { id, password } = body;
  validateId(id);
  validatePassword(password);
  if (id.toLowerCase() === (process.env.ADMIN_ID || 'admin').toLowerCase()) {
    throw new HttpError(400, '사용할 수 없는 닉네임입니다.');
  }
  const { salt, hash } = hashPassword(password);
  const now = Date.now();
  const user = { id, salt, hash, pwv: 1, tickets: 0, createdAt: now, lastLoginAt: now, history: [] };
  const res = await store.setJSON(userKey(id), user, { onlyIfNew: true });
  if (!res.modified) throw new HttpError(409, '이미 사용 중인 닉네임입니다.');
  return { token: await signToken(store, { role: 'user', id: user.id, pwv: user.pwv }), user: publicUser(user) };
}

async function login(store, body) {
  const { id, password } = body;
  if (typeof id !== 'string' || typeof password !== 'string') throw new HttpError(400, '닉네임과 비밀번호를 입력하세요.');
  const user = ID_RE.test(id) ? await store.get(userKey(id), { type: 'json' }) : null;
  if (!user || !verifyPassword(password, user)) throw new HttpError(401, '닉네임 또는 비밀번호가 올바르지 않습니다.');
  const updated = await update(store, userKey(id), (u) => ({ ...u, lastLoginAt: Date.now() }));
  return { token: await signToken(store, { role: 'user', id: user.id, pwv: user.pwv }), user: publicUser(updated) };
}

// 운영자 비밀번호: 환경 변수 ADMIN_PASSWORD가 있으면 그것을 쓰고,
// 없으면 처음 운영자 로그인에 입력한 비밀번호를 Blobs에 해시로 저장해 이후 그것으로 확인한다.
async function adminLogin(store, body) {
  const adminId = process.env.ADMIN_ID || 'admin';
  const id = String(body.id || '');
  const password = String(body.password || '');
  const fail = () => new HttpError(401, '운영자 아이디 또는 비밀번호가 올바르지 않습니다.');
  if (!safeEqual(id, adminId)) throw fail();

  const envPw = process.env.ADMIN_PASSWORD;
  if (envPw) {
    if (!safeEqual(password, envPw)) throw fail();
  } else {
    let saved = await store.get('config/admin', { type: 'json' });
    if (!saved) {
      if (password.length < 8) throw new HttpError(400, '처음 로그인입니다. 운영자 비밀번호로 쓸 8자 이상을 입력하세요.');
      await store.setJSON('config/admin', hashPassword(password), { onlyIfNew: true });
      saved = await store.get('config/admin', { type: 'json' });
    }
    if (!verifyPassword(password, saved)) throw fail();
  }
  return { token: await signToken(store, { role: 'admin', id: adminId }) };
}

// ---------- 유저 기능 ----------

async function myInfo(store, user) {
  const round = await currentRound(store);
  const entries = round ? await listJSON(store, `entries/${round.no}/${keyPart(user.id)}/`) : [];
  entries.sort((a, b) => a.createdAt - b.createdAt);
  if (round && round.status === 'drawn') {
    for (const e of entries) e.rank = rankOf(e.numbers, round.numbers, round.bonus);
  }
  return { user: publicUser(user), round: publicRound(round), entries };
}

async function enter(store, user, body) {
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length < 1 || lines.length > MAX_LINES_PER_REQUEST) {
    throw new HttpError(400, `한 번에 1~${MAX_LINES_PER_REQUEST}줄까지 응모할 수 있습니다.`);
  }
  const prepared = lines.map((line) =>
    line === 'auto' || line?.auto
      ? { numbers: pickNumbers().sort((a, b) => a - b), auto: true }
      : { numbers: validateNumbers(line?.numbers ?? line), auto: false },
  );

  const round = await currentRound(store);
  const blocked = entryBlock(round);
  if (blocked) throw new HttpError(400, blocked);

  // 1) 로또권 차감
  const key = userKey(user.id);
  await update(store, key, (u) => {
    if (u.tickets < prepared.length) throw new HttpError(400, `로또권이 부족합니다. (보유 ${u.tickets}장)`);
    u.tickets -= prepared.length;
    pushHistory(u, -prepared.length, `제${round.no}회 응모`);
    return u;
  });

  // 2) 응모 기록
  const now = Date.now();
  const uid = keyPart(user.id);
  const created = prepared.map((p, i) => ({
    id: `${now.toString(36)}${i}${randomBytes(3).toString('hex')}`,
    round: round.no,
    user: user.id,
    numbers: p.numbers,
    auto: p.auto,
    createdAt: now,
  }));
  await Promise.all(created.map((e) => store.setJSON(`entries/${round.no}/${uid}/${e.id}`, e)));

  // 3) 그 사이 추첨이 끝났다면 응모를 취소하고 로또권을 돌려준다
  const after = await store.get(`rounds/${round.no}`, { type: 'json' });
  if (after.status !== 'open') {
    await Promise.all(created.map((e) => store.delete(`entries/${round.no}/${uid}/${e.id}`)));
    await update(store, key, (u) => {
      u.tickets += prepared.length;
      pushHistory(u, prepared.length, `제${round.no}회 마감으로 환불`);
      return u;
    });
    throw new HttpError(400, '방금 추첨이 마감되어 응모가 취소되었습니다. 로또권은 돌려드렸습니다.');
  }

  await update(store, `rounds/${round.no}`, (r) =>
    r.status === 'open' ? { ...r, entryCount: (r.entryCount || 0) + created.length } : undefined,
  );
  return myInfo(store, await store.get(key, { type: 'json' }));
}

async function history(store) {
  const meta = await store.get('meta', { type: 'json' });
  if (!meta?.round) return { rounds: [] };
  const nos = Array.from({ length: Math.min(meta.round, 20) }, (_, i) => meta.round - i);
  const rounds = await Promise.all(nos.map((no) => store.get(`rounds/${no}`, { type: 'json' })));
  return { rounds: rounds.filter((r) => r && r.status === 'drawn').map(publicRound) };
}

async function myRoundEntries(store, user, no) {
  const round = await store.get(`rounds/${no}`, { type: 'json' });
  if (!round) throw new HttpError(404, '회차를 찾을 수 없습니다.');
  const entries = await listJSON(store, `entries/${no}/${keyPart(user.id)}/`);
  entries.sort((a, b) => a.createdAt - b.createdAt);
  if (round.status === 'drawn') for (const e of entries) e.rank = rankOf(e.numbers, round.numbers, round.bonus);
  return { round: publicRound(round), entries };
}

// ---------- 운영자 기능 ----------

async function adminOverview(store) {
  const users = (await listJSON(store, 'users/')).map(publicUser).sort((a, b) => a.id.localeCompare(b.id, 'ko'));
  const round = await currentRound(store);
  return { users, round: publicRound(round) };
}

async function grant(store, body) {
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1000) {
    throw new HttpError(400, '수량은 -1000 ~ 1000 사이 정수(0 제외)로 입력하세요.');
  }
  const reason = String(body.reason || (amount > 0 ? '운영자 지급' : '운영자 회수')).slice(0, 40);
  let targets;
  if (body.all) {
    const { blobs } = await store.list({ prefix: 'users/' });
    targets = blobs.map((b) => b.key);
  } else {
    const ids = Array.isArray(body.ids) ? body.ids : [body.id];
    if (!ids.length || ids.some((x) => typeof x !== 'string' || !x)) throw new HttpError(400, '대상 회원을 선택하세요.');
    targets = ids.map(userKey);
  }
  const results = [];
  const dms = [];
  for (const key of targets) {
    const u = await update(store, key, (u) => {
      const delta = amount < 0 ? -Math.min(u.tickets, -amount) : amount;
      if (delta === 0) return undefined;
      u.tickets += delta;
      pushHistory(u, delta, reason);
      return u;
    });
    results.push({ id: u.id, tickets: u.tickets });
    if (amount > 0 && u.discordId) dms.push({ id: u.discordId, name: u.id, tickets: u.tickets });
  }
  const dm = await autoDM(store, 'dmTickets', dms, (t) => ({
    embeds: [{
      title: `로또권 ${amount}장을 받았습니다`,
      description: `사유: ${reason}\n보유 로또권: **${t.tickets}장**`,
      color: SITE_COLOR,
      footer: { text: '크리스탈 길드 로또' },
    }],
  }));
  return { updated: results, dm: dm ? { sent: dm.sent.length, failed: dm.failed.length } : null };
}

async function resetPassword(store, body) {
  validatePassword(body.password);
  const { salt, hash } = hashPassword(body.password);
  const u = await update(store, userKey(String(body.id || '')), (u) => ({ ...u, salt, hash, pwv: (u.pwv || 1) + 1 }));
  return { id: u.id };
}

async function deleteUser(store, body) {
  const key = userKey(String(body.id || ''));
  if (!(await store.get(key))) throw new HttpError(404, '회원을 찾을 수 없습니다.');
  await store.delete(key);
  return { ok: true };
}

function cleanPrizes(prizes = {}) {
  const out = {};
  for (const r of RANKS) out[r] = String(prizes[r] ?? '').slice(0, 60);
  return out;
}

async function openRound(store, body) {
  const cur = await currentRound(store);
  if (cur && cur.status !== 'drawn') throw new HttpError(400, `제${cur.no}회가 아직 진행 중입니다. 먼저 추첨하세요.`);
  const prizes = cleanPrizes(body.prizes || cur?.prizes);
  const schedule = cleanSchedule(body);
  const meta = await update(store, 'meta', (m) => ({ round: (m.round || 0) + 1 }), { create: () => ({ round: 0 }) });
  const round = { no: meta.round, status: 'open', openedAt: Date.now(), prizes, entryCount: 0, ...schedule };
  await store.setJSON(`rounds/${round.no}`, round);
  await notifyDiscord(store, 'open', () => roundOpenMessage(round));
  return { round: publicRound(round) };
}

async function setSchedule(store, body) {
  const cur = await currentRound(store);
  if (!cur || cur.status !== 'open') throw new HttpError(400, '진행 중인 회차가 없습니다.');
  const schedule = cleanSchedule(body);
  const r = await update(store, `rounds/${cur.no}`, (r) => {
    if (r.status !== 'open') throw new HttpError(400, '이미 마감된 회차입니다.');
    return { ...r, ...schedule };
  });
  return { round: publicRound(r) };
}

async function setPrizes(store, body) {
  const cur = await currentRound(store);
  if (!cur) throw new HttpError(400, '진행 중인 회차가 없습니다.');
  const r = await update(store, `rounds/${cur.no}`, (r) => ({ ...r, prizes: cleanPrizes(body.prizes) }));
  return { round: publicRound(r) };
}

async function draw(store) {
  const cur = await currentRound(store);
  if (!cur || cur.status === 'drawn') throw new HttpError(400, '추첨할 회차가 없습니다.');
  const picked = pickNumbers(7);
  const numbers = picked.slice(0, 6).sort((a, b) => a - b);
  const bonus = picked[6];

  // 먼저 마감 처리해서 새 응모를 막는다
  await update(store, `rounds/${cur.no}`, (r) => {
    if (r.status === 'drawn') throw new HttpError(400, '이미 추첨된 회차입니다.');
    return { ...r, status: 'drawing' };
  });

  const entries = await listJSON(store, `entries/${cur.no}/`);
  const winners = [];
  for (const e of entries) {
    const rank = rankOf(e.numbers, numbers, bonus);
    if (rank) winners.push({ rank, user: e.user, numbers: e.numbers, auto: e.auto });
  }
  winners.sort((a, b) => a.rank - b.rank || a.user.localeCompare(b.user, 'ko'));

  const round = await update(store, `rounds/${cur.no}`, (r) => {
    if (r.status === 'drawn') throw new HttpError(409, '다른 곳에서 이미 추첨했습니다.');
    return { ...r, status: 'drawn', drawnAt: Date.now(), numbers, bonus, winners, entryCount: entries.length };
  });
  await notifyDiscord(store, 'draw', async (cfg) => {
    if (!cfg.notify.mentionWinners || !round.winners.length) return drawMessage(round);
    const names = [...new Set(round.winners.map((w) => w.user))];
    const users = await Promise.all(
      names.map(async (n) => {
        try {
          return await store.get(userKey(n), { type: 'json' });
        } catch {
          return null;
        }
      }),
    );
    return drawMessage(round, users.filter(Boolean).map((u) => u.discordId).filter(Boolean));
  });
  await dmWinners(store, round);
  return { round: publicRound(round) };
}

// 당첨자에게 개인 DM (한 사람이 여러 줄 당첨이면 한 번에)
export async function dmWinners(store, round) {
  if (!round.winners.length) return;
  const byUser = new Map();
  for (const w of round.winners) {
    if (!byUser.has(w.user)) byUser.set(w.user, []);
    byUser.get(w.user).push(w);
  }
  const targets = [];
  for (const [name, wins] of byUser) {
    const u = await store.get(userKey(name), { type: 'json' }).catch(() => null);
    if (u?.discordId) targets.push({ id: u.discordId, name, wins });
  }
  await autoDM(store, 'dmWinners', targets, (t) => ({
    embeds: [{
      title: `제${round.no}회 로또 당첨을 축하합니다!`,
      description: t.wins
        .map((w) => `**${w.rank}등** · ${w.numbers.join(' ')}${round.prizes?.[w.rank] ? `\n상품: ${round.prizes[w.rank]}` : ''}`)
        .join('\n\n'),
      color: 0xc8962b,
      fields: [{ name: '당첨번호', value: `${round.numbers.join('  ')}  +  ${round.bonus}` }],
      footer: { text: '크리스탈 길드 로또' },
    }],
  }));
}

async function roundEntries(store, no) {
  const round = await store.get(`rounds/${no}`, { type: 'json' });
  if (!round) throw new HttpError(404, '회차를 찾을 수 없습니다.');
  const entries = await listJSON(store, `entries/${no}/`);
  entries.sort((a, b) => a.createdAt - b.createdAt);
  if (round.status === 'drawn') for (const e of entries) e.rank = rankOf(e.numbers, round.numbers, round.bonus);
  return { round: publicRound(round), entries };
}

// 모든 회차/응모 기록을 지우고 다음 회차를 1회부터 다시 시작
async function resetRounds(store) {
  const keys = [];
  for (const prefix of ['rounds/', 'entries/']) {
    const { blobs } = await store.list({ prefix });
    keys.push(...blobs.map((b) => b.key));
  }
  await Promise.all(keys.map((k) => store.delete(k)));
  await store.delete('meta');
  return { ok: true, deleted: keys.length };
}

// 모든 길드원의 로또권을 0장으로
async function clearTickets(store) {
  const { blobs } = await store.list({ prefix: 'users/' });
  let count = 0;
  for (const { key } of blobs) {
    await update(store, key, (u) => {
      if (!u.tickets) return undefined;
      const delta = -u.tickets;
      u.tickets = 0;
      pushHistory(u, delta, '운영자 전체 삭제');
      count++;
      return u;
    });
  }
  return { ok: true, users: count };
}

// ---------- 공지사항 ----------

async function listNotices(store) {
  const notices = await listJSON(store, 'notices/');
  notices.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt - a.createdAt);
  return { notices };
}

function cleanNotice(body) {
  const title = String(body.title || '').trim().slice(0, 80);
  const text = String(body.body || '').trim().slice(0, 4000);
  if (!title) throw new HttpError(400, '제목을 입력하세요.');
  return { title, body: text, pinned: Boolean(body.pinned) };
}

async function createNotice(store, body) {
  const now = Date.now();
  const notice = { id: `${now.toString(36)}${randomBytes(3).toString('hex')}`, ...cleanNotice(body), createdAt: now, updatedAt: now };
  await store.setJSON(`notices/${notice.id}`, notice);
  if (body.discord !== false) await notifyDiscord(store, 'notice', (cfg) => noticeMessage(notice, cfg.noticeMention));
  return { notice };
}

const noticeKey = (id) => {
  if (typeof id !== 'string' || !/^[0-9a-z]{6,40}$/.test(id)) throw new HttpError(404, '공지를 찾을 수 없습니다.');
  return `notices/${id}`;
};

async function editNotice(store, body) {
  const fields = cleanNotice(body);
  const notice = await update(store, noticeKey(body.id), (n) => ({ ...n, ...fields, updatedAt: Date.now() }));
  return { notice };
}

async function deleteNotice(store, body) {
  const key = noticeKey(body.id);
  if (!(await store.get(key))) throw new HttpError(404, '공지를 찾을 수 없습니다.');
  await store.delete(key);
  return { ok: true };
}

// ---------- 디스코드 연동 ----------
//
// 채널 알림용 웹후크 주소는 운영실 화면에서 저장(config/discord)하거나
// 환경 변수 DISCORD_WEBHOOK_URL 로 줄 수 있다. 환경 변수가 우선.

const WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/;
const SITE_COLOR = 0x2f45c5;
const MENTIONS = ['none', 'everyone', 'here'];

const DISCORD_ID_RE = /^\d{17,20}$/;

// 멘션 선택 → 메시지 앞에 붙일 글자와 허용할 멘션 (지정한 것 외에는 아무도 울리지 않음)
function mentionPart(mention, userIds = []) {
  const users = [...new Set(userIds.filter((id) => DISCORD_ID_RE.test(id)))].slice(0, 100);
  const parts = [];
  if (mention === 'everyone') parts.push('@everyone');
  if (mention === 'here') parts.push('@here');
  parts.push(...users.map((id) => `<@${id}>`));
  if (!parts.length) return {};
  return {
    content: parts.join(' '),
    allowed_mentions: { parse: mention === 'everyone' || mention === 'here' ? ['everyone'] : [], ...(users.length ? { users } : {}) },
  };
}

function cleanDiscordId(value) {
  const id = String(value ?? '').trim();
  if (id && !DISCORD_ID_RE.test(id)) throw new HttpError(400, '디스코드 사용자 ID는 17~20자리 숫자입니다.');
  return id;
}

async function setMyDiscord(store, user, body) {
  const discordId = cleanDiscordId(body.discordId);
  const u = await update(store, userKey(user.id), (u) => ({ ...u, discordId }));
  return { user: publicUser(u) };
}

async function setUserDiscord(store, body) {
  const discordId = cleanDiscordId(body.discordId);
  const u = await update(store, userKey(String(body.id || '')), (u) => ({ ...u, discordId }));
  return { user: publicUser(u) };
}

async function discordSettings(store) {
  const saved = (await store.get('config/discord', { type: 'json' })) || {};
  const env = process.env;
  return {
    webhookUrl: env.DISCORD_WEBHOOK_URL || saved.webhookUrl || '',
    notify: { notice: true, open: true, draw: true, mentionWinners: true, dmWinners: true, dmTickets: false, ...(saved.notify || {}) },
    botToken: env.DISCORD_BOT_TOKEN || saved.botToken || '',
    publicKey: env.DISCORD_PUBLIC_KEY || saved.publicKey || '',
    guildId: env.DISCORD_GUILD_ID || saved.guildId || DEFAULT_GUILD_ID,
    commandsAt: saved.commandsAt || null,
    commandsError: saved.commandsError || null,
    commandsRetryAt: saved.commandsRetryAt || null,
    noticeMention: MENTIONS.includes(saved.noticeMention) ? saved.noticeMention : 'none',
    fromEnv: { webhookUrl: Boolean(env.DISCORD_WEBHOOK_URL), botToken: Boolean(env.DISCORD_BOT_TOKEN) },
  };
}

const maskWebhook = (url) => (url ? url.replace(/\/([\w-]{6})[\w-]*$/, '/$1••••••') : '');

async function getDiscordAdmin(store) {
  const s = await discordSettings(store);
  return {
    webhookSet: Boolean(s.webhookUrl),
    webhookPreview: maskWebhook(s.webhookUrl),
    notify: s.notify,
    noticeMention: s.noticeMention,
    botSet: Boolean(s.botToken),
    publicKey: s.publicKey,
    guildId: s.guildId,
    commandsAt: s.commandsAt,
    commandsError: s.commandsError,
    commandsRetryAt: s.commandsRetryAt > Date.now() ? s.commandsRetryAt : null,
    fromEnv: s.fromEnv,
  };
}

async function saveDiscordAdmin(store, body) {
  const patch = {};
  if (body.webhookUrl !== undefined) {
    const url = String(body.webhookUrl).trim();
    if (url && !WEBHOOK_RE.test(url)) throw new HttpError(400, '디스코드 웹후크 주소 형식이 아닙니다. (https://discord.com/api/webhooks/...)');
    patch.webhookUrl = url;
  }
  if (body.notify && typeof body.notify === 'object') {
    patch.notify = {
      notice: Boolean(body.notify.notice),
      open: Boolean(body.notify.open),
      draw: Boolean(body.notify.draw),
      mentionWinners: body.notify.mentionWinners !== false,
      dmWinners: body.notify.dmWinners !== false,
      dmTickets: Boolean(body.notify.dmTickets),
    };
  }
  if (body.botToken) {
    const t = String(body.botToken).trim();
    if (!/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(t)) throw new HttpError(400, '봇 토큰 형식이 아닙니다. (Bot 메뉴의 Reset Token으로 받은 값)');
    patch.botToken = t;
  }
  if (body.clearBot) patch.botToken = '';
  // 새 토큰이면 기다리던 재시도 기록을 지우고 바로 등록해 본다
  if (patch.botToken) Object.assign(patch, { commandsRetryAt: null, commandsError: null, commandsSig: null });
  if (body.publicKey !== undefined) {
    const k = String(body.publicKey).trim().toLowerCase();
    if (k && !/^[0-9a-f]{64}$/.test(k)) throw new HttpError(400, 'Public Key는 64자리 영문/숫자입니다. (General Information 화면)');
    patch.publicKey = k;
  }
  if (body.guildId !== undefined) {
    const g = String(body.guildId).trim();
    if (g && !/^\d{17,20}$/.test(g)) throw new HttpError(400, '서버 ID는 숫자입니다.');
    patch.guildId = g || DEFAULT_GUILD_ID;
  }
  if (body.noticeMention !== undefined) {
    if (!MENTIONS.includes(body.noticeMention)) throw new HttpError(400, '멘션 설정이 올바르지 않습니다.');
    patch.noticeMention = body.noticeMention;
  }
  await update(store, 'config/discord', (c) => ({ ...c, ...patch }), { create: () => ({}) });
  if (patch.botToken || patch.guildId) await autoSyncCommands(store);
  return getDiscordAdmin(store);
}

async function postWebhook(url, payload) {
  const res = await fetch(`${url}?wait=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: '크리스탈 길드', allowed_mentions: { parse: [] }, ...payload }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

// 알림 실패가 운영 동작(공지 등록, 추첨 등)을 막지 않도록 오류는 기록만 한다.
async function notifyDiscord(store, kind, build) {
  try {
    const s = await discordSettings(store);
    if (!s.webhookUrl || !s.notify[kind]) return;
    await postWebhook(s.webhookUrl, await build(s));
  } catch (err) {
    console.error('discord notify failed', kind, err.message);
  }
}

const cut = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

function noticeMessage(n, mention) {
  return {
    ...mentionPart(mention),
    embeds: [{
      title: cut(`${n.pinned ? '[공지] ' : ''}${n.title}`, 250),
      description: n.body ? cut(n.body, 3500) : undefined,
      color: SITE_COLOR,
      footer: { text: '크리스탈 길드 공지사항' },
      timestamp: new Date(n.createdAt).toISOString(),
    }],
  };
}

function prizeLines(prizes = {}) {
  return RANKS.filter((r) => prizes[r]).map((r) => `${r}등 · ${prizes[r]}`).join('\n');
}

// 디스코드 타임스탬프(<t:초:F>)는 보는 사람의 시간대로 표시된다
export function periodText(r) {
  if (!r.startAt && !r.endAt) return '';
  const from = r.startAt ? `<t:${Math.floor(r.startAt / 1000)}:F>` : '지금';
  const to = r.endAt ? `<t:${Math.floor(r.endAt / 1000)}:F>` : '추첨할 때';
  return `${from} ~ ${to}${r.autoDraw ? '\n마감되면 자동으로 추첨합니다.' : ''}`;
}

function roundOpenMessage(r) {
  const prizes = prizeLines(r.prizes);
  const period = periodText(r);
  return {
    embeds: [{
      title: `제${r.no}회 로또 응모 시작`,
      description: '사이트에서 로또권으로 번호를 골라 응모하세요.',
      color: 0x1f9d63,
      fields: [
        ...(period ? [{ name: '응모 기간', value: period }] : []),
        ...(prizes ? [{ name: '상품', value: prizes }] : []),
      ],
      timestamp: new Date(r.openedAt).toISOString(),
    }],
  };
}

export function drawMessage(r, winnerIds = []) {
  const nums = `${r.numbers.join('  ')}  +  ${r.bonus}`;
  const winners = r.winners.length
    ? r.winners.slice(0, 30).map((w) => `${w.rank}등 · ${w.user}${r.prizes?.[w.rank] ? ` (${r.prizes[w.rank]})` : ''}`).join('\n') +
      (r.winners.length > 30 ? `\n외 ${r.winners.length - 30}줄` : '')
    : '이번 회차 당첨자가 없습니다.';
  return {
    ...mentionPart('none', winnerIds),
    embeds: [{
      title: `제${r.no}회 로또 추첨 결과`,
      color: 0xc8962b,
      fields: [
        { name: '당첨번호', value: `**${nums}**` },
        { name: `당첨 (${r.winners.length}줄 / 총 ${r.entryCount}줄)`, value: cut(winners, 1000) },
      ],
      timestamp: new Date(r.drawnAt).toISOString(),
    }],
  };
}

async function testDiscord(store) {
  const s = await discordSettings(store);
  if (!s.webhookUrl) throw new HttpError(400, '먼저 웹후크 주소를 저장하세요.');
  try {
    await postWebhook(s.webhookUrl, { content: '크리스탈 길드 사이트와 연결되었습니다. 앞으로 공지와 로또 소식이 이 채널에 올라옵니다.' });
  } catch (err) {
    throw new HttpError(502, `디스코드로 보내지 못했습니다. 웹후크 주소를 확인하세요. (${err.message})`);
  }
  return { ok: true };
}

// ---------- 개인 DM (디스코드 봇) ----------
// 웹후크는 채널에만 보낼 수 있어서, 개인 DM은 봇 토큰으로 보낸다.
// 받는 사람이 봇과 같은 서버에 있고, 서버 멤버의 DM을 허용해야 한다.
const DISCORD_API = 'https://discord.com/api/v10';

function botFetch(token, path, opts = {}) {
  return fetch(DISCORD_API + path, {
    ...opts,
    headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
}

async function dmFailReason(res) {
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) return '봇 토큰이 올바르지 않음';
  if (body.code === 50007 || res.status === 403) return 'DM을 받을 수 없음 (봇과 같은 서버가 아니거나 DM 차단)';
  if (res.status === 429) return '요청이 너무 많음';
  if (res.status === 404 || body.code === 10013) return '없는 사용자 ID';
  return `오류 ${res.status}`;
}

async function sendDM(token, userId, payload) {
  const ch = await botFetch(token, '/users/@me/channels', { method: 'POST', body: JSON.stringify({ recipient_id: userId }) });
  if (!ch.ok) throw new Error(await dmFailReason(ch));
  const { id } = await ch.json();
  const msg = await botFetch(token, `/channels/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
  });
  if (!msg.ok) throw new Error(await dmFailReason(msg));
}

// 여러 명에게 DM: 동시에 4명씩, 함수 제한 시간 안에서만
async function dmMany(token, targets, build, budgetMs = 7000) {
  const started = Date.now();
  const sent = [];
  const failed = [];
  const queue = [...targets];
  async function worker() {
    while (queue.length) {
      const t = queue.shift();
      if (Date.now() - started > budgetMs) {
        failed.push({ id: t.id, name: t.name, reason: '시간 초과 (한 번에 너무 많음)' });
        continue;
      }
      try {
        await sendDM(token, t.id, build(t));
        sent.push(t.name || t.id);
      } catch (err) {
        failed.push({ id: t.id, name: t.name, reason: err.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return { sent, failed };
}

// 자동 DM: 실패해도 운영 동작은 계속
async function autoDM(store, kind, targets, build) {
  try {
    const s = await discordSettings(store);
    if (!s.botToken || !s.notify[kind] || !targets.length) return null;
    const r = await dmMany(s.botToken, targets, build);
    if (r.failed.length) console.error('discord dm failed', kind, JSON.stringify(r.failed));
    return r;
  } catch (err) {
    console.error('discord dm error', kind, err.message);
    return null;
  }
}

async function testBot(store) {
  const s = await discordSettings(store);
  if (!s.botToken) throw new HttpError(400, '먼저 봇 토큰을 저장하세요.');
  const res = await botFetch(s.botToken, '/users/@me').catch(() => null);
  if (!res || !res.ok) throw new HttpError(502, `봇에 연결하지 못했습니다. (${res ? await dmFailReason(res) : '연결 실패'})`);
  const me = await res.json();
  return {
    name: me.global_name || me.username,
    invite: `https://discord.com/oauth2/authorize?client_id=${me.id}&scope=bot+applications.commands&permissions=0`,
  };
}

// ---------- 슬래시 명령어 (/사이트 등) ----------
// 디스코드가 명령어를 사이트의 /api/discord/interactions 로 보내고, 사이트가 바로 답한다.
// 봇이 디스코드에 계속 접속해 있을 필요가 없어서 Netlify만으로 동작한다.
export const DEFAULT_GUILD_ID = '1176515670624698418';

export const COMMANDS = [
  { name: '사이트', description: '크리스탈 길드 사이트 링크' },
  { name: '로또권', description: '내 로또권 장수 확인 (나에게만 보임)' },
  { name: '회차', description: '지금 로또 회차 상태와 응모 기간' },
  { name: '당첨번호', description: '최근 로또 당첨번호와 당첨자' },
];

const siteUrl = (req) => (process.env.URL || new URL(req.url).origin).replace(/\/$/, '');

function verifyDiscord(publicKey, signature, timestamp, rawBody) {
  try {
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey, 'hex').toString('base64url') },
      format: 'jwk',
    });
    return verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

const reply = (data, ephemeral = false) => ({ type: 4, data: { allowed_mentions: { parse: [] }, ...data, ...(ephemeral ? { flags: 64 } : {}) } });

async function discordInteraction(store, req) {
  const s = await discordSettings(store);
  const raw = await req.text();
  const sig = req.headers.get('x-signature-ed25519') || '';
  const ts = req.headers.get('x-signature-timestamp') || '';
  if (!s.publicKey || !verifyDiscord(s.publicKey, sig, ts, raw)) {
    return new Response('invalid request signature', { status: 401 });
  }
  const body = JSON.parse(raw);
  if (body.type === 1) return json({ type: 1 }); // PING (디스코드가 주소 확인할 때)
  if (body.type !== 2) return json(reply({ content: '지원하지 않는 요청입니다.' }, true));
  await autoDrawIfDue(store);
  const url = siteUrl(req);
  const discordUserId = body.member?.user?.id || body.user?.id || '';
  return json(await runCommand(store, body.data?.name, url, discordUserId));
}

// 파이썬 봇(discord-bot/app.py)이 명령어 답을 받아가는 곳.
// 봇 토큰의 sha256을 열쇠로 써서, 같은 봇 토큰을 가진 쪽만 부를 수 있다 (토큰 자체는 오가지 않음).
async function botCommand(store, req, body) {
  const s = await discordSettings(store);
  const key = String(req.headers.get('x-bot-key') || '');
  const want = s.botToken ? createHmac('sha256', 'crystal-bot').update(s.botToken).digest('hex') : '';
  if (!want || key.length !== want.length || !timingSafeEqual(Buffer.from(key), Buffer.from(want))) {
    throw new HttpError(401, '봇 열쇠가 맞지 않습니다. 운영실에 저장한 봇 토큰과 봇 프로그램의 토큰이 같은지 확인하세요.');
  }
  await autoDrawIfDue(store);
  const name = String(body.name || '');
  if (name === '목록') return { commands: COMMANDS };
  return runCommand(store, name, siteUrl(req), String(body.discordUserId || ''));
}

export async function runCommand(store, name, url, discordUserId) {
  if (name === '사이트') {
    return reply({
      embeds: [{
        title: '크리스탈 길드',
        url,
        description: `${url}\n공지사항 · 로또 이벤트 · 당첨 결과를 확인하세요.`,
        color: SITE_COLOR,
      }],
    });
  }
  if (name === '로또권') {
    const user = discordUserId ? (await listJSON(store, 'users/')).find((u) => u.discordId === discordUserId) : null;
    if (!user) {
      return reply({ content: `사이트 계정에 디스코드 ID가 등록되어 있지 않아요.\n${url} 에 로그인 → 로또 이벤트 화면 아래 **디스코드 연결**에 ID를 등록해 주세요.` }, true);
    }
    return reply({ content: `**${user.id}**님의 로또권: **${user.tickets}장**\n${url}/#event` }, true);
  }
  if (name === '회차') {
    const r = await currentRound(store);
    if (!r) return reply({ content: `아직 열린 회차가 없어요.\n${url}` });
    const now = Date.now();
    const state = r.status === 'drawn' ? '추첨 완료'
      : r.startAt && now < r.startAt ? '응모 예정'
      : r.endAt && now >= r.endAt ? '마감 (추첨 대기)'
      : '응모 중';
    const fields = [{ name: '상태', value: `${state} · 총 ${r.entryCount || 0}줄 응모`, inline: false }];
    const period = periodText(r);
    if (period) fields.push({ name: '응모 기간', value: period });
    const prizes = prizeLines(r.prizes);
    if (prizes) fields.push({ name: '상품', value: prizes });
    return reply({ embeds: [{ title: `제${r.no}회 로또`, url: `${url}/#event`, color: 0x1f9d63, fields }] });
  }
  if (name === '당첨번호') {
    const { rounds } = await history(store);
    if (!rounds.length) return reply({ content: `아직 추첨한 회차가 없어요.\n${url}/#results` });
    const msg = drawMessage(rounds[0]);
    msg.embeds[0].url = `${url}/#results`;
    return reply({ embeds: msg.embeds });
  }
  return reply({ content: '알 수 없는 명령어예요.' }, true);
}

// 봇 토큰 첫 부분은 봇(=앱) ID를 base64로 담고 있어서, 요청을 하나 줄일 수 있다.
function appIdFromToken(token) {
  try {
    const id = Buffer.from(token.split('.')[0], 'base64').toString('utf8');
    return /^\d{15,25}$/.test(id) ? id : null;
  } catch { return null; }
}

// 429(요청 너무 많음) 내용 읽기: 디스코드 JSON이면 retry_after, 아니면 Cloudflare가 호스팅 IP를 잠시 막은 것
async function rateLimitInfo(res) {
  const text = await res.text().catch(() => '');
  let body = null;
  try { body = JSON.parse(text); } catch {}
  const header = Number(res.headers.get('retry-after'));
  const wait = Number(body?.retry_after ?? (Number.isFinite(header) ? header : NaN));
  return {
    cloudflare: !body,
    daily: body?.code === 30034,
    wait: Number.isFinite(wait) && wait > 0 ? wait : null,
  };
}

function rateLimitMessage(info) {
  if (info.daily) return '오늘 명령어 등록 한도(200번)를 다 썼습니다. 내일 다시 눌러주세요.';
  if (info.cloudflare) return '디스코드가 호스팅 서버 IP를 잠깐 막았습니다. 10~30분 뒤에 한 번만 다시 눌러주세요.';
  const sec = Math.ceil(info.wait ?? 60);
  const when = sec >= 120 ? `${Math.ceil(sec / 60)}분` : `${sec}초`;
  return `디스코드 요청 한도에 걸렸습니다. ${when} 뒤에 한 번만 다시 눌러주세요.`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 봇 토큰만 있으면 명령어를 알아서 등록한다 (토큰 저장할 때 + 예약 함수가 1분마다 확인).
// 디스코드가 막으면(429) 알려준 시간만큼 기다렸다가 다시 시도해서 더 오래 막히지 않게 한다.
const commandsSig = (appId, guildId) =>
  createHmac('sha256', 'commands').update(`${appId}|${guildId}|${JSON.stringify(COMMANDS)}`).digest('hex').slice(0, 16);

function retryDelay(info) {
  if (info.daily) return 6 * 3600_000;
  if (info.cloudflare) return 20 * 60_000;
  return Math.max(60_000, Math.ceil((info.wait ?? 60) * 1000) + 1000);
}

const saveCommandsState = (store, patch) =>
  update(store, 'config/discord', (c) => ({ ...c, ...patch }), { create: () => ({}) });

export async function syncCommands(store, { force = false } = {}) {
  const s = await discordSettings(store);
  if (!s.botToken) return { skipped: 'no-token' };
  const saved = (await store.get('config/discord', { type: 'json' })) || {};
  const now = Date.now();
  if (saved.commandsRetryAt > now) {
    if (!force) return { skipped: 'waiting' };
    const sec = Math.ceil((saved.commandsRetryAt - now) / 1000);
    throw new HttpError(429, `${saved.commandsError || '디스코드가 잠깐 막았습니다.'} 사이트가 ${sec >= 120 ? `${Math.ceil(sec / 60)}분` : `${sec}초`} 뒤에 알아서 다시 등록합니다.`);
  }
  let appId = appIdFromToken(s.botToken);
  if (appId && !force && saved.commandsSig === commandsSig(appId, s.guildId) && saved.commandsAt) {
    // 다시 누른 등록만 막혔던 거라면 명령어는 이미 그대로 있음
    if (saved.commandsError) await saveCommandsState(store, { commandsError: null, commandsRetryAt: null });
    return { skipped: 'done' };
  }

  const fail = async (res, info) => {
    const delay = retryDelay(info);
    const msg = rateLimitMessage(info);
    await saveCommandsState(store, { commandsRetryAt: Date.now() + delay, commandsError: msg });
    return msg;
  };
  if (!appId) {
    const meRes = await botFetch(s.botToken, '/users/@me').catch(() => null);
    if (meRes?.status === 429) throw new HttpError(429, await fail(meRes, await rateLimitInfo(meRes)));
    if (!meRes?.ok) {
      const why = meRes ? await dmFailReason(meRes) : '연결 실패';
      await saveCommandsState(store, { commandsError: `봇에 연결하지 못했습니다. (${why})`, commandsRetryAt: Date.now() + 5 * 60_000 });
      throw new HttpError(502, `봇에 연결하지 못했습니다. (${why})`);
    }
    appId = (await meRes.json()).id;
  }
  const put = () => botFetch(s.botToken, `/applications/${appId}/guilds/${s.guildId}/commands`, {
    method: 'PUT',
    body: JSON.stringify(COMMANDS.map((c) => ({ ...c, type: 1 }))),
  }).catch(() => null);
  let res = await put();
  if (res?.status === 429) {
    const info = await rateLimitInfo(res);
    // 몇 초만 기다리면 되는 경우는 바로 한 번 더 시도
    if (info.cloudflare || info.daily || info.wait == null || info.wait > 4) throw new HttpError(429, await fail(res, info));
    await sleep(info.wait * 1000 + 250);
    res = await put();
    if (res?.status === 429) throw new HttpError(429, await fail(res, await rateLimitInfo(res)));
  }
  if (!res?.ok) {
    const why = res?.status === 401 ? '봇 토큰이 올바르지 않음'
      : res?.status === 403 ? '봇이 그 서버에 초대되어 있지 않음 (봇 확인의 초대 링크로 다시 초대)'
      : res ? `오류 ${res.status}` : '연결 실패';
    const msg = `명령어를 등록하지 못했습니다. (${why})`;
    await saveCommandsState(store, { commandsError: msg, commandsRetryAt: Date.now() + 5 * 60_000 });
    throw new HttpError(502, msg);
  }
  await saveCommandsState(store, {
    commandsAt: Date.now(), commandsSig: commandsSig(appId, s.guildId), commandsError: null, commandsRetryAt: null,
  });
  return { ok: true, commands: COMMANDS.map((c) => `/${c.name}`) };
}

// Netlify 서버 IP가 디스코드에 막혔을 때: 운영자 브라우저(내 인터넷)에서 직접 등록하도록 필요한 값을 준다.
// 운영자만 부를 수 있고, 토큰은 운영자 브라우저에서 디스코드로만 보내진다.
async function localCommandsPayload(store) {
  const s = await discordSettings(store);
  if (!s.botToken) throw new HttpError(400, '먼저 봇 토큰을 저장하세요.');
  const appId = appIdFromToken(s.botToken);
  if (!appId) throw new HttpError(400, '봇 토큰에서 앱 ID를 읽지 못했습니다. 토큰을 다시 저장하세요.');
  return { token: s.botToken, appId, guildId: s.guildId, commands: COMMANDS.map((c) => ({ ...c, type: 1 })) };
}

async function markCommandsDone(store) {
  const s = await discordSettings(store);
  const appId = appIdFromToken(s.botToken);
  if (!appId) throw new HttpError(400, '봇 토큰이 없습니다.');
  await saveCommandsState(store, {
    commandsAt: Date.now(), commandsSig: commandsSig(appId, s.guildId), commandsError: null, commandsRetryAt: null,
  });
  return getDiscordAdmin(store);
}

// 예약 함수·토큰 저장 때 쓰는 조용한 버전 (실패해도 다음에 다시 시도)
export const autoSyncCommands = (store) => syncCommands(store).catch((e) => ({ error: e.message }));

// 운영실에서 디스코드 채널로 직접 글 보내기
// 디스코드 ID -> 사이트 닉네임
async function discordNames(store) {
  const out = {};
  for (const u of await listJSON(store, 'users/')) if (u.discordId) out[u.discordId] = u.id;
  return out;
}

async function sendDiscord(store, body) {
  const s = await discordSettings(store);
  const title = String(body.title || '').trim().slice(0, 250);
  const message = String(body.message || '').trim();
  if (!message) throw new HttpError(400, '보낼 내용을 입력하세요.');
  if (message.length > 3500) throw new HttpError(400, '내용은 3500자까지 보낼 수 있습니다.');
  const mention = MENTIONS.includes(body.mention) ? body.mention : 'none';
  const userIds = Array.isArray(body.users) ? body.users.map((x) => String(x).trim()) : [];
  const bad = userIds.find((id) => !DISCORD_ID_RE.test(id));
  if (bad) throw new HttpError(400, `디스코드 사용자 ID가 올바르지 않습니다: ${bad.slice(0, 30)}`);
  const embed = {
    title: title || undefined,
    description: message,
    color: SITE_COLOR,
    footer: { text: '크리스탈 길드 운영진' },
    timestamp: new Date().toISOString(),
  };
  if (body.target === 'dm') {
    if (!s.botToken) throw new HttpError(400, '개인 DM은 디스코드 봇 토큰이 필요합니다. 아래 "개인 DM 봇"에서 저장하세요.');
    if (!userIds.length) throw new HttpError(400, 'DM 받을 길드원을 고르세요.');
    const names = await discordNames(store);
    const result = await dmMany(s.botToken, [...new Set(userIds)].map((id) => ({ id, name: names[id] || id })), () => ({ embeds: [embed] }));
    return { ok: true, ...result };
  }
  if (!s.webhookUrl) throw new HttpError(400, '먼저 디스코드 알림에서 웹후크 주소를 저장하세요.');
  try {
    await postWebhook(s.webhookUrl, { ...mentionPart(mention, userIds), embeds: [embed] });
  } catch (err) {
    throw new HttpError(502, `디스코드로 보내지 못했습니다. 웹후크 주소를 확인하세요. (${err.message})`);
  }
  return { ok: true };
}

// ---------- 라우터 ----------

export async function handle(req, store) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/(\.netlify\/functions\/api|api)/, '') || '/';
  const method = req.method;
  if (method === 'POST' && path === '/discord/interactions') return discordInteraction(store, req);
  let body = {};
  if (method === 'POST') {
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, '잘못된 요청입니다.');
    }
    if (!body || typeof body !== 'object') body = {};
  }
  const route = `${method} ${path}`;
  if (method === 'GET' || route === 'POST /enter') await autoDrawIfDue(store);
  const roundMatch = path.match(/^\/(admin\/)?rounds\/(\d+)\/entries$/);

  switch (route) {
    case 'POST /signup': return signup(store, body);
    case 'POST /login': return login(store, body);
    case 'POST /admin/login': return adminLogin(store, body);
    case 'GET /me': return myInfo(store, await requireUser(store, req));
    case 'POST /enter': return enter(store, await requireUser(store, req), body);
    case 'POST /me/discord': return setMyDiscord(store, await requireUser(store, req), body);
    case 'GET /history': return history(store);
    case 'GET /notices': return listNotices(store);
    case 'POST /bot/command': return botCommand(store, req, body);
  }
  if (method === 'GET' && roundMatch && !roundMatch[1]) {
    return myRoundEntries(store, await requireUser(store, req), Number(roundMatch[2]));
  }

  if (path.startsWith('/admin/')) {
    await requireAdmin(store, req);
    switch (route) {
      case 'GET /admin/overview': return adminOverview(store);
      case 'POST /admin/grant': return grant(store, body);
      case 'POST /admin/reset-password': return resetPassword(store, body);
      case 'POST /admin/delete-user': return deleteUser(store, body);
      case 'POST /admin/round/open': return openRound(store, body);
      case 'POST /admin/round/prizes': return setPrizes(store, body);
      case 'POST /admin/round/draw': return draw(store);
      case 'POST /admin/round/schedule': return setSchedule(store, body);
      case 'POST /admin/round/reset': return resetRounds(store);
      case 'POST /admin/clear-tickets': return clearTickets(store);
      case 'POST /admin/notices': return createNotice(store, body);
      case 'POST /admin/notices/edit': return editNotice(store, body);
      case 'POST /admin/notices/delete': return deleteNotice(store, body);
      case 'GET /admin/discord': return getDiscordAdmin(store);
      case 'POST /admin/discord': return saveDiscordAdmin(store, body);
      case 'POST /admin/discord/test': return testDiscord(store);
      case 'POST /admin/discord/send': return sendDiscord(store, body);
      case 'POST /admin/discord/bot-test': return testBot(store);
      case 'POST /admin/discord/commands': return syncCommands(store, { force: true });
      case 'POST /admin/discord/commands-local': return localCommandsPayload(store);
      case 'POST /admin/discord/commands-done': return markCommandsDone(store);
      case 'POST /admin/user-discord': return setUserDiscord(store, body);
    }
    if (method === 'GET' && roundMatch) return roundEntries(store, Number(roundMatch[2]));
  }
  throw new HttpError(404, '존재하지 않는 API입니다.');
}

export async function respond(req, store) {
  try {
    const result = await handle(req, store);
    return result instanceof Response ? result : json(result);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: '서버 오류가 발생했습니다.' }, 500);
  }
}

export default async (req) => respond(req, getStore({ name: STORE_NAME, consistency: 'strong' }));

export const config = { path: '/api/*' };
