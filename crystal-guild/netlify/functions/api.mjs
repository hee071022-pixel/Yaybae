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
  selfRenamedAt: u.selfRenamedAt || null,
  avatarAt: u.avatarAt || null,
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
    const out = await draw(store);
    await addLog(store, '자동', '자동 추첨', `제${out.round.no}회 · 당첨 ${out.round.winners.length}줄`);
    return out;
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
  const request = await store.get(requestKey(user.id), { type: 'json' });
  return { user: publicUser(user), round: publicRound(round), entries, request: request || null, requestResult: user.requestResult || null };
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

// 홈 화면용 공개 정보: 길드원 수와 지금 회차 (번호·응모 내역은 없음)
async function publicStats(store) {
  const [{ blobs }, round] = await Promise.all([store.list({ prefix: 'users/' }), currentRound(store)]);
  return { members: blobs.length, round: publicRound(round) };
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

// ---------- 내 정보 ----------

// 비밀번호 변경: 지금 비밀번호 확인 후 바꾸고, 다른 기기는 로그아웃 (새 토큰 돌려줌)
async function changeMyPassword(store, user, body) {
  if (typeof body.current !== 'string' || !verifyPassword(body.current, user)) {
    throw new HttpError(400, '지금 비밀번호가 맞지 않아요.');
  }
  validatePassword(body.next);
  if (body.current === body.next) throw new HttpError(400, '지금과 다른 비밀번호를 입력하세요.');
  const { salt, hash } = hashPassword(body.next);
  const u = await update(store, userKey(user.id), (x) => ({ ...x, salt, hash, pwv: (x.pwv || 1) + 1 }));
  return { token: await signToken(store, { role: 'user', id: u.id, pwv: u.pwv }), user: publicUser(u) };
}

// 닉네임 직접 변경: 비밀번호 확인, 7일에 한 번. 기록 옮기기는 운영자 닉변과 같음
const SELF_RENAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
async function renameMe(store, user, body) {
  if (typeof body.password !== 'string' || !verifyPassword(body.password, user)) {
    throw new HttpError(400, '비밀번호가 맞지 않아요.');
  }
  const last = user.selfRenamedAt || 0;
  if (Date.now() - last < SELF_RENAME_COOLDOWN_MS) {
    const days = Math.ceil((last + SELF_RENAME_COOLDOWN_MS - Date.now()) / 86400000);
    throw new HttpError(400, `닉네임은 7일에 한 번 바꿀 수 있어요. (${days}일 뒤에 가능)`);
  }
  const newId = String(body.newId || '').trim();
  const r = await renameUser(store, { id: user.id, newId, self: true });
  await addLog(store, newId, '닉네임 직접 변경', `${user.id} → ${newId}`);
  const u = await update(store, userKey(newId), (x) => ({ ...x, selfRenamedAt: Date.now() }));
  return { token: await signToken(store, { role: 'user', id: u.id, pwv: u.pwv }), user: publicUser(u), dm: r.dm };
}

// 프로필 사진: 브라우저에서 작은 정사각형(256px)으로 줄여서 보낸 이미지만 받는다
const avatarKey = (id) => `avatars/${keyPart(id)}`;
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const AVATAR_MAX = 120 * 1024;

async function setMyAvatar(store, user, body) {
  const m = AVATAR_RE.exec(String(body.image || ''));
  if (!m) throw new HttpError(400, 'JPG, PNG, WEBP 이미지만 올릴 수 있어요.');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > AVATAR_MAX) throw new HttpError(400, '사진 용량이 너무 커요.');
  await store.setJSON(avatarKey(user.id), { type: `image/${m[1]}`, data: m[2] });
  const u = await update(store, userKey(user.id), (x) => ({ ...x, avatarAt: Date.now() }));
  return { user: publicUser(u) };
}

async function removeMyAvatar(store, user) {
  await store.delete(avatarKey(user.id));
  const u = await update(store, userKey(user.id), (x) => ({ ...x, avatarAt: null }));
  return { user: publicUser(u) };
}

async function getAvatar(store, id) {
  if (!ID_RE.test(id)) return new Response('not found', { status: 404 });
  const a = await store.get(avatarKey(id), { type: 'json' });
  if (!a) return new Response('not found', { status: 404 });
  return new Response(Buffer.from(a.data, 'base64'), {
    headers: { 'content-type': a.type, 'cache-control': 'public, max-age=86400' },
  });
}

// 내 응모·당첨 기록 (최근 30회차)
async function myRecords(store, user) {
  const meta = await store.get('meta', { type: 'json' });
  if (!meta?.round) return { rounds: [], totals: { rounds: 0, lines: 0, wins: 0, best: null } };
  const nos = Array.from({ length: Math.min(meta.round, 30) }, (_, i) => meta.round - i);
  const part = keyPart(user.id);
  const rows = await Promise.all(nos.map(async (no) => {
    const [round, entries] = await Promise.all([
      store.get(`rounds/${no}`, { type: 'json' }),
      listJSON(store, `entries/${no}/${part}/`),
    ]);
    if (!round || !entries.length) return null;
    entries.sort((a, b) => a.createdAt - b.createdAt);
    const drawn = round.status === 'drawn';
    const lines = entries.map((e) => ({ numbers: e.numbers, auto: Boolean(e.auto), ...(drawn ? { rank: rankOf(e.numbers, round.numbers, round.bonus) } : {}) }));
    return { round: publicRound(round), lines };
  }));
  const rounds = rows.filter(Boolean);
  const all = rounds.flatMap((r) => r.lines);
  const ranks = all.map((l) => l.rank).filter(Boolean);
  return {
    rounds: rounds.map(({ round, lines }) => ({
      no: round.no, status: round.status, drawnAt: round.drawnAt || null, numbers: round.numbers || null, bonus: round.bonus ?? null,
      prizes: round.prizes, lines,
    })),
    totals: { rounds: rounds.length, lines: all.length, wins: ranks.length, best: ranks.length ? Math.min(...ranks) : null },
  };
}


// ---------- 로또권 쿠폰 ----------
// coupons/<코드> : 운영자가 만들고, 길드원이 코드를 넣으면 한 사람당 한 번 로또권을 받는다.
const COUPON_RE = /^[A-Z0-9-]{4,20}$/;
const cleanCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
function randomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += abc[randomInt(abc.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

async function createCoupon(store, body) {
  const code = body.code ? cleanCode(body.code) : randomCode();
  if (!COUPON_RE.test(code)) throw new HttpError(400, '쿠폰 코드는 영문 대문자·숫자·- 4~20자예요.');
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 50) throw new HttpError(400, '쿠폰 로또권은 1~50장이에요.');
  const maxUses = Number(body.maxUses || 0);
  if (!Number.isInteger(maxUses) || maxUses < 0 || maxUses > 1000) throw new HttpError(400, '사용 인원은 0(무제한)~1000명이에요.');
  const expiresAt = body.expiresAt ? Number(body.expiresAt) : null;
  if (expiresAt && (!Number.isFinite(expiresAt) || expiresAt < Date.now())) throw new HttpError(400, '만료 시간이 이미 지났어요.');
  const board = body.board !== false; // 사이트 쿠폰 채널에 보이기
  const coupon = { code, amount, maxUses, uses: 0, usedBy: [], expiresAt, memo: String(body.memo || '').trim().slice(0, 40), board, createdAt: Date.now() };
  const res = await store.setJSON(`coupons/${code}`, coupon, { onlyIfNew: true });
  if (!res.modified) throw new HttpError(409, '이미 있는 쿠폰 코드예요.');
  // 쿠폰 채널이 연결돼 있으면 바로 올린다 (실패해도 쿠폰은 만들어짐)
  const s = await discordSettings(store);
  const want = body.post !== undefined ? Boolean(body.post) : s.couponAuto;
  if (!want || !s.couponWebhookUrl) return { coupon, posted: false };
  try {
    return { coupon: await postCoupon(store, coupon), posted: true };
  } catch (err) {
    return { coupon, posted: false, postError: err.message };
  }
}

async function listCoupons(store) {
  const list = await listJSON(store, 'coupons/');
  return { coupons: list.sort((a, b) => b.createdAt - a.createdAt) };
}

async function deleteCoupon(store, body) {
  const code = cleanCode(body.code);
  if (!COUPON_RE.test(code)) throw new HttpError(404, '쿠폰을 찾을 수 없어요.');
  await store.delete(`coupons/${code}`);
  return listCoupons(store);
}

async function setCouponBoard(store, body) {
  const code = cleanCode(body.code);
  if (!COUPON_RE.test(code)) throw new HttpError(404, '쿠폰을 찾을 수 없어요.');
  await update(store, `coupons/${code}`, (c) => ({ ...c, board: Boolean(body.board) }));
  return listCoupons(store);
}

// 사이트 쿠폰 채널: 운영자가 채널에 올린 쿠폰 (끝난 쿠폰은 7일 동안 '마감'으로 보임)
async function myCoupons(store, user) {
  const now = Date.now();
  const list = (await listJSON(store, 'coupons/')).filter((c) => c.board);
  const coupons = list
    .map((c) => {
      const expired = Boolean(c.expiresAt && now > c.expiresAt);
      const soldOut = Boolean(c.maxUses && c.uses >= c.maxUses);
      const used = (c.usedBy || []).includes(user.id);
      const endedAt = expired ? c.expiresAt : soldOut ? c.soldOutAt || c.createdAt : null;
      return {
        code: c.code, amount: c.amount, maxUses: c.maxUses, uses: c.uses || 0, expiresAt: c.expiresAt, createdAt: c.createdAt,
        used, expired, soldOut, available: !used && !expired && !soldOut, endedAt,
      };
    })
    .filter((c) => c.available || c.used || !c.endedAt || now - c.endedAt < 7 * 86400000)
    .sort((a, b) => b.available - a.available || b.createdAt - a.createdAt);
  return { coupons, available: coupons.filter((c) => c.available).length };
}

async function redeemCoupon(store, user, body) {
  const code = cleanCode(body.code);
  if (!COUPON_RE.test(code)) throw new HttpError(400, '쿠폰 코드를 확인해 주세요.');
  let amount = 0;
  await update(store, `coupons/${code}`, (c) => {
    if (c.expiresAt && Date.now() > c.expiresAt) throw new HttpError(400, '기간이 끝난 쿠폰이에요.');
    if ((c.usedBy || []).includes(user.id)) throw new HttpError(400, '이미 사용한 쿠폰이에요.');
    if (c.maxUses && c.uses >= c.maxUses) throw new HttpError(400, '선착순이 끝난 쿠폰이에요.');
    amount = c.amount;
    const uses = (c.uses || 0) + 1;
    return { ...c, uses, usedBy: [...(c.usedBy || []), user.id], ...(c.maxUses && uses >= c.maxUses ? { soldOutAt: Date.now() } : {}) };
  }).catch((err) => {
    if (err instanceof HttpError && err.status === 404) throw new HttpError(400, '없는 쿠폰 코드예요.');
    throw err;
  });
  const u = await update(store, userKey(user.id), (x) => {
    x.tickets += amount;
    pushHistory(x, amount, `쿠폰 ${code}`);
    return x;
  });
  await addLog(store, user.id, '쿠폰 사용', `${code} · +${amount}장`);
  return { user: publicUser(u), amount };
}

// ---------- 랭킹 ----------
// 추첨된 회차(최근 60회) 기준. 점수: 1등 10 · 2등 6 · 3등 4 · 4등 2 · 5등 1
const RANK_POINTS = { 1: 10, 2: 6, 3: 4, 4: 2, 5: 1 };
async function ranking(store) {
  const meta = await store.get('meta', { type: 'json' });
  const n = meta?.round || 0;
  const nos = Array.from({ length: Math.min(n, 60) }, (_, i) => n - i);
  const table = new Map();
  const row = (id) => {
    if (!table.has(id)) table.set(id, { user: id, points: 0, wins: 0, best: 0, lines: 0, rounds: 0, byRank: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
    return table.get(id);
  };
  const rounds = await Promise.all(nos.map(async (no) => {
    const r = await store.get(`rounds/${no}`, { type: 'json' });
    if (!r || r.status !== 'drawn') return null;
    return { r, entries: await listJSON(store, `entries/${no}/`) };
  }));
  let counted = 0;
  for (const x of rounds) {
    if (!x) continue;
    counted++;
    const seen = new Set();
    for (const e of x.entries) {
      const t = row(e.user);
      t.lines++;
      if (!seen.has(e.user)) { seen.add(e.user); t.rounds++; }
    }
    for (const w of x.r.winners || []) {
      const t = row(w.user);
      t.wins++;
      t.points += RANK_POINTS[w.rank] || 0;
      t.byRank[w.rank] = (t.byRank[w.rank] || 0) + 1;
      t.best = t.best ? Math.min(t.best, w.rank) : w.rank;
    }
  }
  // 지금 있는 길드원만 (닉변·삭제된 이름 정리)
  const { blobs } = await store.list({ prefix: 'users/' });
  const alive = new Set(blobs.map((b) => b.key.slice(6)));
  const users = await listJSON(store, 'users/');
  const avatars = Object.fromEntries(users.map((u) => [u.id, u.avatarAt || null]));
  const list = [...table.values()].filter((t) => alive.has(keyPart(t.user))).map((t) => ({ ...t, avatarAt: avatars[t.user] || null }));
  return { rounds: counted, points: RANK_POINTS, list };
}

// ---------- 길드 일정 ----------
// events/<id> : { title, date: 'YYYY-MM-DD', time: 'HH:MM' | '', place, memo }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function cleanEvent(b) {
  const title = String(b.title || '').trim().slice(0, 60);
  if (!title) throw new HttpError(400, '일정 제목을 입력하세요.');
  const date = String(b.date || '');
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new HttpError(400, '날짜를 골라 주세요.');
  const time = String(b.time || '');
  if (time && !TIME_RE.test(time)) throw new HttpError(400, '시간 형식이 올바르지 않아요.');
  const limit = Number(b.limit || 0);
  if (!Number.isInteger(limit) || limit < 0 || limit > 500) throw new HttpError(400, '참석 인원 제한은 0(무제한)~500명이에요.');
  return { title, date, time, place: String(b.place || '').trim().slice(0, 40), memo: String(b.memo || '').trim().slice(0, 300), limit };
}

// 참석 신청: rsvp = { yes: [닉네임], no: [닉네임] } (먼저 신청한 순서)
const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const emptyRsvp = () => ({ yes: [], no: [] });

async function rsvpEvent(store, user, body) {
  const status = body.status;
  if (!['yes', 'no', ''].includes(status)) throw new HttpError(400, '참석 여부를 골라 주세요.');
  const ev = await update(store, eventKey(body.id), (e) => {
    if (e.date < kstToday()) throw new HttpError(400, '지난 일정이에요.');
    const r = e.rsvp || emptyRsvp();
    const was = r.yes.includes(user.id) ? 'yes' : r.no.includes(user.id) ? 'no' : '';
    if (was === status) return undefined;
    const yes = r.yes.filter((x) => x !== user.id);
    const no = r.no.filter((x) => x !== user.id);
    if (status === 'yes') {
      if (e.limit && yes.length >= e.limit) throw new HttpError(400, `참석 인원(${e.limit}명)이 다 찼어요.`);
      yes.push(user.id);
    }
    if (status === 'no') no.push(user.id);
    return { ...e, rsvp: { yes, no } };
  });
  return { event: { ...ev, rsvp: ev.rsvp || emptyRsvp(), limit: ev.limit || 0 } };
}

// 닉네임 변경·계정 삭제 시 참석 명단 정리
async function renameInEvents(store, oldId, newId) {
  const { blobs } = await store.list({ prefix: 'events/' });
  await Promise.all(blobs.map((b) => update(store, b.key, (e) => {
    const r = e.rsvp;
    if (!r || (!r.yes.includes(oldId) && !r.no.includes(oldId))) return undefined;
    const fix = (list) => (newId ? list.map((x) => (x === oldId ? newId : x)) : list.filter((x) => x !== oldId));
    return { ...e, rsvp: { yes: fix(r.yes), no: fix(r.no) } };
  }).catch(() => null)));
}
const eventKey = (id) => {
  if (typeof id !== 'string' || !/^[0-9a-z]{6,40}$/.test(id)) throw new HttpError(404, '일정을 찾을 수 없어요.');
  return `events/${id}`;
};
async function listEvents(store) {
  const list = (await listJSON(store, 'events/')).map((e) => ({ ...e, rsvp: e.rsvp || emptyRsvp(), limit: e.limit || 0 }));
  list.sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')));
  return { events: list };
}
async function createEvent(store, body) {
  const now = Date.now();
  const ev = { id: `${now.toString(36)}${randomBytes(3).toString('hex')}`, ...cleanEvent(body), createdAt: now };
  await store.setJSON(`events/${ev.id}`, ev);
  return { event: ev };
}
async function editEvent(store, body) {
  const ev = await update(store, eventKey(body.id), (e) => ({ ...e, ...cleanEvent(body) }));
  return { event: ev };
}
async function deleteEvent(store, body) {
  await store.delete(eventKey(body.id));
  return { ok: true };
}

// ---------- 블랙잭 ----------
// 로또권을 걸고 딜러와 한 판. 카드는 서버가 섞고 들고 있어서 화면에서 조작할 수 없다.
// config/blackjack = { enabled, minBet, maxBet, dailyLimit, closedMessage }  enabled = 카지노(블랙잭·1대1) 열림
// blackjack/<닉네임hex> = 진행 중이거나 마지막 판 { deck, player, dealer, bet, status, result, payout, doubled, day, at }
// bjlog/<최신순 키> = { user, bet, result, payout, player, dealer, at } (최근 300판)
export const BJ_DEFAULT = { enabled: true, minBet: 1, maxBet: 10, dailyLimit: 1, closedMessage: '' };
const BJ_KEEP = 300;
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS_BJ = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const bjKey = (id) => `blackjack/${keyPart(id)}`;

async function bjConfig(store) {
  return { ...BJ_DEFAULT, ...((await store.get('config/blackjack', { type: 'json' })) || {}) };
}

function newDeck() {
  const deck = SUITS.flatMap((s) => RANKS_BJ.map((r) => r + s));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// 손패 점수 (A는 11, 넘치면 1)
export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = c.slice(0, -1);
    if (r === 'A') { total += 11; aces++; } else total += ['J', 'Q', 'K'].includes(r) ? 10 : Number(r);
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

// 결과 정하기: 딜러는 17 이상(소프트 17 포함)에서 멈춤
export function bjSettle(g) {
  const p = handValue(g.player).total;
  if (p <= 21 && !isBlackjack(g.player)) {
    while (handValue(g.dealer).total < 17) g.dealer.push(g.deck.pop());
  }
  const d = handValue(g.dealer).total;
  const pBJ = isBlackjack(g.player);
  const dBJ = isBlackjack(g.dealer);
  let result;
  if (p > 21) result = 'bust';
  else if (pBJ && dBJ) result = 'push';
  else if (pBJ) result = 'blackjack';
  else if (dBJ) result = 'lose';
  else if (d > 21) result = 'win';
  else if (p > d) result = 'win';
  else if (p < d) result = 'lose';
  else result = 'push';
  // 돌려받는 로또권 (건 것 포함): 이기면 2배, 블랙잭은 2.5배(내림), 비기면 그대로
  const payout = result === 'win' ? g.bet * 2 : result === 'blackjack' ? g.bet + Math.floor(g.bet * 1.5) : result === 'push' ? g.bet : 0;
  return { ...g, status: 'done', result, payout };
}

// 화면에 보낼 판 정보 (진행 중이면 딜러 두 번째 카드와 덱은 숨김)
function bjView(g) {
  if (!g) return null;
  const playing = g.status === 'playing';
  const dealer = playing ? [g.dealer[0], '??'] : g.dealer;
  return {
    status: g.status, bet: g.bet, doubled: Boolean(g.doubled), result: g.result || null, payout: g.payout || 0,
    player: g.player, dealer,
    playerValue: handValue(g.player).total,
    dealerValue: playing ? handValue([g.dealer[0]]).total : handValue(g.dealer).total,
    canDouble: playing && g.player.length === 2,
    at: g.at,
  };
}

async function bjInfo(store, user) {
  const cfg = await bjConfig(store);
  const [g, u] = await Promise.all([store.get(bjKey(user.id), { type: 'json' }), store.get(userKey(user.id), { type: 'json' })]);
  const played = u?.bjDay?.day === kstToday() ? u.bjDay.count : 0;
  return { config: cfg, game: bjView(g), left: cfg.dailyLimit ? Math.max(0, cfg.dailyLimit - played) : null, tickets: u?.tickets ?? 0 };
}

const BJ_RESULT_TEXT = { win: '승리', blackjack: '블랙잭', push: '무승부', lose: '패배', bust: '버스트' };

// 끝난 판 정산: 로또권 지급 + 기록
async function bjFinish(store, user, g) {
  let u = null;
  if (g.payout) {
    u = await update(store, userKey(user.id), (x) => {
      x.tickets += g.payout;
      pushHistory(x, g.payout, `블랙잭 ${BJ_RESULT_TEXT[g.result]}`);
      return x;
    });
  }
  const now = Date.now();
  await store.setJSON(`bjlog/${String(9e15 - now).padStart(16, '0')}-${randomBytes(3).toString('hex')}`, {
    user: user.id, bet: g.bet, doubled: Boolean(g.doubled), result: g.result, payout: g.payout, player: g.player, dealer: g.dealer, at: now,
  });
  if (Math.random() < 0.05) {
    store.list({ prefix: 'bjlog/' }).then(({ blobs }) => Promise.all(blobs.slice(BJ_KEEP).map((b) => store.delete(b.key)))).catch(() => {});
  }
  return u;
}

async function bjReply(store, user, g, u) {
  const fresh = u || (await store.get(userKey(user.id), { type: 'json' }));
  const cfg = await bjConfig(store);
  const played = fresh.bjDay?.day === kstToday() ? fresh.bjDay.count : 0;
  return { game: bjView(g), user: publicUser(fresh), left: cfg.dailyLimit ? Math.max(0, cfg.dailyLimit - played) : null };
}

async function bjStart(store, user, body) {
  const cfg = await bjConfig(store);
  if (!cfg.enabled) throw new HttpError(400, '지금은 카지노가 닫혀 있어요.');
  const bet = Number(body.bet);
  if (!Number.isInteger(bet) || bet < cfg.minBet || bet > cfg.maxBet) throw new HttpError(400, `로또권은 ${cfg.minBet}~${cfg.maxBet}장 걸 수 있어요.`);
  const cur = await store.get(bjKey(user.id), { type: 'json' });
  if (cur?.status === 'playing') throw new HttpError(400, '진행 중인 판이 있어요. 먼저 끝내 주세요.');
  const day = kstToday();
  const u = await update(store, userKey(user.id), (x) => {
    const played = x.bjDay?.day === day ? x.bjDay.count : 0;
    if (cfg.dailyLimit && played >= cfg.dailyLimit) throw new HttpError(400, `블랙잭은 하루 ${cfg.dailyLimit}번이에요. 내일 다시 오세요!`);
    if (x.tickets < bet) throw new HttpError(400, `로또권이 부족해요. (보유 ${x.tickets}장)`);
    x.tickets -= bet;
    pushHistory(x, -bet, '블랙잭 베팅');
    x.bjDay = { day, count: played + 1 };
    return x;
  });
  const deck = newDeck();
  let g = { deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], bet, status: 'playing', day, at: Date.now() };
  // 둘 중 하나라도 블랙잭이면 바로 끝
  if (isBlackjack(g.player) || isBlackjack(g.dealer)) g = bjSettle(g);
  await store.setJSON(bjKey(user.id), g);
  const paid = g.status === 'done' ? await bjFinish(store, user, g) : null;
  return bjReply(store, user, g, paid || u);
}

async function bjAction(store, user, action) {
  let done = null;
  const g = await update(store, bjKey(user.id), (x) => {
    if (x.status !== 'playing') throw new HttpError(400, '진행 중인 판이 없어요.');
    if (action === 'hit') {
      x.player.push(x.deck.pop());
      if (handValue(x.player).total >= 21) x = bjSettle(x);
    } else if (action === 'stand') {
      x = bjSettle(x);
    } else if (action === 'double') {
      if (x.player.length !== 2) throw new HttpError(400, '더블은 처음 두 장일 때만 할 수 있어요.');
      x.player.push(x.deck.pop());
      x.bet *= 2;
      x.doubled = true;
      x = bjSettle(x);
    }
    done = x.status === 'done' ? x : null;
    return x;
  }).catch((err) => {
    if (err instanceof HttpError && err.status === 404) throw new HttpError(400, '진행 중인 판이 없어요.');
    throw err;
  });
  return { g, done };
}

async function bjMove(store, user, action) {
  if (action === 'double') {
    // 더블은 건 만큼 한 번 더 냄 (먼저 로또권을 빼고, 실패하면 돌려줌)
    const cur = await store.get(bjKey(user.id), { type: 'json' });
    if (!cur || cur.status !== 'playing') throw new HttpError(400, '진행 중인 판이 없어요.');
    if (cur.player.length !== 2) throw new HttpError(400, '더블은 처음 두 장일 때만 할 수 있어요.');
    await update(store, userKey(user.id), (x) => {
      if (x.tickets < cur.bet) throw new HttpError(400, `더블하려면 로또권 ${cur.bet}장이 더 필요해요.`);
      x.tickets -= cur.bet;
      pushHistory(x, -cur.bet, '블랙잭 더블');
      return x;
    });
    try {
      const { g, done } = await bjAction(store, user, 'double');
      return bjReply(store, user, g, done ? await bjFinish(store, user, done) : null);
    } catch (err) {
      await update(store, userKey(user.id), (x) => { x.tickets += cur.bet; pushHistory(x, cur.bet, '블랙잭 더블 취소'); return x; });
      throw err;
    }
  }
  const { g, done } = await bjAction(store, user, action);
  return bjReply(store, user, g, done ? await bjFinish(store, user, done) : null);
}

async function saveBjConfig(store, body) {
  const cfg = await bjConfig(store);
  const next = { ...cfg };
  if (body.enabled !== undefined) next.enabled = Boolean(body.enabled);
  if (body.closedMessage !== undefined) {
    next.closedMessage = String(body.closedMessage || '').trim();
    if (next.closedMessage.length > 100) throw new HttpError(400, '닫힘 안내는 100자까지 쓸 수 있어요.');
  }
  for (const [k, lo, hi, label] of [['minBet', 1, 1000, '최소 베팅'], ['maxBet', 1, 1000, '최대 베팅'], ['dailyLimit', 0, 100, '하루 횟수']]) {
    if (body[k] === undefined) continue;
    const v = Number(body[k]);
    if (!Number.isInteger(v) || v < lo || v > hi) throw new HttpError(400, `${label}은(는) ${lo}~${hi} 사이로 정해 주세요.`);
    next[k] = v;
  }
  if (next.minBet > next.maxBet) throw new HttpError(400, '최소 베팅이 최대 베팅보다 클 수 없어요.');
  await store.setJSON('config/blackjack', next);
  // 카지노를 닫으면 아직 상대를 기다리는 1대1 방은 취소하고 건 로또권을 돌려줌 (진행 중인 판은 끝까지 할 수 있음)
  if (cfg.enabled && !next.enabled) {
    const waiting = (await allDuels(store)).filter((d) => d.status === 'open');
    await Promise.all(waiting.map((d) => duelUpdate(store, d.id, (x) => (x.status === 'open' ? { ...x, status: 'done', result: 'cancel', reason: 'closed', endedAt: Date.now() } : undefined)).catch(() => null)));
  }
  return adminBj(store);
}

async function adminBj(store) {
  const cfg = await bjConfig(store);
  const { blobs } = await store.list({ prefix: 'bjlog/' });
  const recent = (await Promise.all(blobs.slice(0, 200).map((b) => store.get(b.key, { type: 'json' })))).filter(Boolean);
  const today = kstToday();
  const todays = recent.filter((x) => new Date(x.at + 9 * 3600000).toISOString().slice(0, 10) === today);
  const count = (r) => todays.filter((x) => x.result === r).length;
  return {
    config: cfg,
    recent: recent.slice(0, 30),
    today: {
      games: todays.length,
      players: new Set(todays.map((x) => x.user)).size,
      bet: todays.reduce((a, x) => a + x.bet, 0),
      paid: todays.reduce((a, x) => a + x.payout, 0),
      wins: count('win') + count('blackjack'),
      losses: count('lose') + count('bust'),
      pushes: count('push'),
    },
  };
}

// ---------- 블랙잭 1대1 ----------
// 한 사람이 방을 만들고(로또권 걸기) 다른 사람이 들어오면 둘 다 같은 덱에서 2장씩 받고 동시에 진행.
// 둘 다 끝나면 21에 가까운 쪽이 판돈(2배)을 가져감. 비기거나 둘 다 버스트면 돌려받음.
// bjduel/<id> = { id, host, guest, target, bet, status: open|playing|done, deck, hands:{host,guest}, done:{host,guest}, result, winner, createdAt, startedAt, endedAt }
const DUEL_OPEN_MS = 30 * 60000;
const DUEL_PLAY_MS = 10 * 60000;
const duelKey = (id) => {
  if (typeof id !== 'string' || !/^[0-9a-z]{6,40}$/.test(id)) throw new HttpError(404, '방을 찾을 수 없어요.');
  return `bjduel/${id}`;
};
const seatOf = (d, uid) => (d.host === uid ? 'host' : d.guest === uid ? 'guest' : null);

// 두 손패 비교 → 'host' | 'guest' | 'push'
export function duelWinner(h, g) {
  const hv = handValue(h).total, gv = handValue(g).total;
  const hb = hv > 21, gb = gv > 21;
  if (hb && gb) return 'push';
  if (hb) return 'guest';
  if (gb) return 'host';
  const hBJ = isBlackjack(h), gBJ = isBlackjack(g);
  if (hBJ !== gBJ) return hBJ ? 'host' : 'guest';
  if (hv === gv) return 'push';
  return hv > gv ? 'host' : 'guest';
}

function duelSettle(d, reason = '') {
  const w = duelWinner(d.hands.host, d.hands.guest);
  return { ...d, status: 'done', winner: w === 'push' ? null : d[w], result: w, reason, endedAt: Date.now() };
}

// 시간 초과 처리 (열린 방 30분, 진행 10분)
function duelExpire(d, now = Date.now()) {
  if (d.status === 'open' && now - d.createdAt > DUEL_OPEN_MS) return { ...d, status: 'done', result: 'expired', endedAt: now };
  if (d.status === 'playing' && now - d.startedAt > DUEL_PLAY_MS) return duelSettle({ ...d, done: { host: true, guest: true } }, 'timeout');
  return null;
}

// 끝난 방 정산 (한 번만): 이긴 사람 2배, 무승부·취소는 돌려받기
async function duelPay(store, d) {
  const pay = async (uid, amount, reason) => {
    if (!uid || !amount) return;
    await update(store, userKey(uid), (x) => { x.tickets += amount; pushHistory(x, amount, reason); return x; }).catch(() => null);
  };
  if (d.result === 'expired' || d.result === 'cancel') return pay(d.host, d.bet, '블랙잭 1대1 취소(돌려받음)');
  if (d.result === 'push') {
    await pay(d.host, d.bet, '블랙잭 1대1 무승부');
    await pay(d.guest, d.bet, '블랙잭 1대1 무승부');
  } else {
    await pay(d.winner, d.bet * 2, `블랙잭 1대1 승리 (vs ${d.winner === d.host ? d.guest : d.host})`);
  }
  const now = Date.now();
  for (const seat of ['host', 'guest']) {
    const uid = d[seat];
    if (!uid) continue;
    const r = d.result === 'push' ? 'push' : d.winner === uid ? 'win' : 'lose';
    await store.setJSON(`bjlog/${String(9e15 - now).padStart(16, '0')}-${randomBytes(3).toString('hex')}`, {
      user: uid, duel: true, vs: seat === 'host' ? d.guest : d.host, bet: d.bet, result: r, payout: r === 'win' ? d.bet * 2 : r === 'push' ? d.bet : 0,
      player: d.hands[seat], dealer: d.hands[seat === 'host' ? 'guest' : 'host'], at: now,
    });
  }
}

// 상태를 바꾸고, 이번에 끝났으면 정산
async function duelUpdate(store, id, fn) {
  let finished = null;
  const d = await update(store, duelKey(id), (x) => {
    finished = null;
    const exp = duelExpire(x);
    const next = exp || fn(x);
    if (next === undefined) return undefined;
    if (x.status !== 'done' && next.status === 'done') finished = next;
    return next;
  }).catch((err) => {
    if (err instanceof HttpError && err.status === 404) throw new HttpError(404, '방을 찾을 수 없어요.');
    throw err;
  });
  if (finished) await duelPay(store, finished);
  return d;
}

// 화면용: 진행 중에는 상대 카드는 첫 장만
function duelView(d, uid) {
  const me = seatOf(d, uid);
  const other = me === 'host' ? 'guest' : 'host';
  const showAll = d.status === 'done';
  const hand = (seat) => {
    const h = d.hands?.[seat] || [];
    if (showAll || seat === me) return h;
    return h.map((c, i) => (i === 0 ? c : '??'));
  };
  return {
    id: d.id, host: d.host, guest: d.guest, target: d.target || null, bet: d.bet, status: d.status,
    me, result: d.result || null, winner: d.winner || null, reason: d.reason || null,
    myHand: me ? hand(me) : [], myValue: me && d.hands ? handValue(d.hands[me]).total : 0, myDone: me ? Boolean(d.done?.[me]) : false,
    opHand: me && d.hands ? hand(other) : [], opValue: showAll && me && d.hands ? handValue(d.hands[other]).total : null, opDone: me ? Boolean(d.done?.[other]) : false,
    opName: me ? d[other] : null,
    createdAt: d.createdAt, startedAt: d.startedAt || null, endedAt: d.endedAt || null,
    expiresAt: d.status === 'open' ? d.createdAt + DUEL_OPEN_MS : d.status === 'playing' ? d.startedAt + DUEL_PLAY_MS : null,
  };
}

async function allDuels(store) {
  const { blobs } = await store.list({ prefix: 'bjduel/' });
  const list = (await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })))).filter(Boolean);
  // 오래된 끝난 방 정리
  const old = list.filter((d) => d.status === 'done' && Date.now() - d.endedAt > 86400000);
  await Promise.all(old.map((d) => store.delete(`bjduel/${d.id}`)));
  return list.filter((d) => !old.includes(d));
}

async function duelLobby(store, user) {
  const cfg = await bjConfig(store);
  let list = await allDuels(store);
  // 시간 지난 방은 이 자리에서 정리
  for (const d of list.filter((x) => duelExpire(x))) {
    await duelUpdate(store, d.id, (x) => x).catch(() => null);
  }
  if (list.some((x) => duelExpire(x))) list = await allDuels(store);
  const last = (d) => d.endedAt || d.startedAt || d.createdAt;
  const mine = list.filter((d) => seatOf(d, user.id)).sort((a, b) => last(b) - last(a));
  const active = mine.find((d) => d.status !== 'done') || mine.find((d) => Date.now() - d.endedAt < 10 * 60000) || null;
  const open = list
    .filter((d) => d.status === 'open' && d.host !== user.id && (!d.target || d.target === user.id))
    .sort((a, b) => (b.target === user.id) - (a.target === user.id) || a.createdAt - b.createdAt)
    .map((d) => ({ id: d.id, host: d.host, bet: d.bet, target: d.target || null, createdAt: d.createdAt, expiresAt: d.createdAt + DUEL_OPEN_MS }));
  return { config: { enabled: cfg.enabled, minBet: cfg.minBet, maxBet: cfg.maxBet }, open, current: active ? duelView(active, user.id) : null };
}

async function duelCreate(store, user, body) {
  const cfg = await bjConfig(store);
  if (!cfg.enabled) throw new HttpError(400, '지금은 카지노가 닫혀 있어요.');
  const bet = Number(body.bet);
  if (!Number.isInteger(bet) || bet < cfg.minBet || bet > cfg.maxBet) throw new HttpError(400, `로또권은 ${cfg.minBet}~${cfg.maxBet}장 걸 수 있어요.`);
  let target = String(body.target || '').trim();
  if (target) {
    const t = await store.get(userKey(target), { type: 'json' });
    if (!t) throw new HttpError(404, '그 닉네임의 길드원이 없어요.');
    if (t.id === user.id) throw new HttpError(400, '자기 자신과는 할 수 없어요.');
    target = t.id;
  }
  const list = await allDuels(store);
  if (list.some((d) => seatOf(d, user.id) && d.status !== 'done' && !duelExpire(d))) throw new HttpError(400, '이미 참여 중인 1대1 방이 있어요.');
  await update(store, userKey(user.id), (x) => {
    if (x.tickets < bet) throw new HttpError(400, `로또권이 부족해요. (보유 ${x.tickets}장)`);
    x.tickets -= bet;
    pushHistory(x, -bet, '블랙잭 1대1 방 만들기');
    return x;
  });
  const now = Date.now();
  const d = { id: `${now.toString(36)}${randomBytes(3).toString('hex')}`, host: user.id, guest: null, target: target || null, bet, status: 'open', createdAt: now };
  await store.setJSON(`bjduel/${d.id}`, d);
  return { current: duelView(d, user.id) };
}

async function duelJoin(store, user, body) {
  if (!(await bjConfig(store)).enabled) throw new HttpError(400, '지금은 카지노가 닫혀 있어요.');
  const key = duelKey(body.id);
  const cur = await store.get(key, { type: 'json' });
  if (!cur || cur.status !== 'open' || duelExpire(cur)) throw new HttpError(400, '이미 시작했거나 없어진 방이에요.');
  if (cur.host === user.id) throw new HttpError(400, '내가 만든 방이에요.');
  if (cur.target && cur.target !== user.id) throw new HttpError(403, '다른 길드원을 지정한 방이에요.');
  const list = await allDuels(store);
  if (list.some((d) => seatOf(d, user.id) && d.status !== 'done' && !duelExpire(d))) throw new HttpError(400, '이미 참여 중인 1대1 방이 있어요.');
  await update(store, userKey(user.id), (x) => {
    if (x.tickets < cur.bet) throw new HttpError(400, `로또권이 부족해요. (보유 ${x.tickets}장)`);
    x.tickets -= cur.bet;
    pushHistory(x, -cur.bet, `블랙잭 1대1 참가 (vs ${cur.host})`);
    return x;
  });
  try {
    const d = await duelUpdate(store, body.id, (x) => {
      if (x.status !== 'open' || x.guest) throw new HttpError(400, '누가 먼저 들어갔어요.');
      const deck = newDeck();
      let n = { ...x, guest: user.id, status: 'playing', startedAt: Date.now(), deck, hands: { host: [deck.pop(), deck.pop()], guest: [deck.pop(), deck.pop()] }, done: { host: false, guest: false } };
      // 처음 두 장이 21이면 자동으로 멈춤
      for (const seat of ['host', 'guest']) if (isBlackjack(n.hands[seat])) n.done[seat] = true;
      if (n.done.host && n.done.guest) n = duelSettle(n);
      return n;
    });
    return { current: duelView(d, user.id) };
  } catch (err) {
    // 못 들어갔으면 건 로또권 돌려주기
    await update(store, userKey(user.id), (x) => { x.tickets += cur.bet; pushHistory(x, cur.bet, '블랙잭 1대1 참가 취소'); return x; });
    throw err;
  }
}

async function duelCancel(store, user, body) {
  const d = await duelUpdate(store, body.id, (x) => {
    if (x.host !== user.id) throw new HttpError(403, '방장만 취소할 수 있어요.');
    if (x.status !== 'open') throw new HttpError(400, '이미 시작한 방은 취소할 수 없어요.');
    return { ...x, status: 'done', result: 'cancel', endedAt: Date.now() };
  });
  return { current: duelView(d, user.id) };
}

async function duelMove(store, user, body, action) {
  const d = await duelUpdate(store, body.id, (x) => {
    const seat = seatOf(x, user.id);
    if (!seat) throw new HttpError(403, '내 방이 아니에요.');
    if (x.status !== 'playing') throw new HttpError(400, '진행 중인 판이 아니에요.');
    if (x.done[seat]) throw new HttpError(400, '이미 멈췄어요. 상대를 기다려 주세요.');
    const n = { ...x, hands: { ...x.hands, [seat]: [...x.hands[seat]] }, done: { ...x.done } };
    if (action === 'hit') {
      n.hands[seat].push(n.deck.pop());
      if (handValue(n.hands[seat]).total >= 21) n.done[seat] = true;
    } else n.done[seat] = true;
    return n.done.host && n.done.guest ? duelSettle(n) : n;
  });
  return { current: duelView(d, user.id) };
}

// ---------- 미니게임 ----------
// 보상 없는 미니게임. 게임마다 개인 최고 기록만 저장하고 순위를 보여준다.
// games/<게임>/<닉네임hex> = { user, best, plays, bestAt, lastAt }
export const GAMES = {
  reaction: { name: '반응속도', unit: 'ms', lower: true, min: 80, max: 3000 },
  touch: { name: '1 to 25', unit: 'ms', lower: true, min: 2500, max: 600000 },
  memory: { name: '카드 짝맞추기', unit: '번', lower: true, min: 8, max: 999 },
  g2048: { name: '2048', unit: '점', lower: false, min: 0, max: 4000000 },
  bubble: { name: '버블 슈터', unit: '점', lower: false, min: 0, max: 10000000 },
  jump: { name: '버블 점프', unit: '점', lower: false, min: 0, max: 10000000 },
  stairs: { name: '무한의 계단', unit: '칸', lower: false, min: 0, max: 100000 },
  jumpking: { name: '점프킹', unit: '점', lower: false, min: 0, max: 20000 },
  rhythm: { name: '리듬 게임', unit: '점', lower: false, min: 0, max: 50000000 },
  souls: { name: '크리스탈 소울', unit: '점', lower: false, min: 1000, max: 300000 },
};
const gameKey = (game, id) => `games/${game}/${keyPart(id)}`;
const better = (g, a, b) => (b == null ? true : g.lower ? a < b : a > b);

function cleanGame(game) {
  if (!Object.hasOwn(GAMES, String(game))) throw new HttpError(404, '없는 게임이에요.');
  return GAMES[game];
}

async function submitGameScore(store, user, body) {
  const g = cleanGame(body.game);
  const score = Number(body.score);
  if (!Number.isInteger(score) || score < g.min || score > g.max) throw new HttpError(400, '기록이 올바르지 않아요.');
  const now = Date.now();
  let isBest = false;
  const rec = await update(store, gameKey(body.game, user.id), (r) => {
    isBest = better(g, score, r.best);
    return { ...r, user: user.id, plays: (r.plays || 0) + 1, lastAt: now, ...(isBest ? { best: score, bestAt: now } : {}) };
  }, { create: () => ({ user: user.id, best: null, plays: 0 }) });
  return { record: rec, isBest };
}

async function gameBoard(store, game, user) {
  const g = cleanGame(game);
  const list = (await listJSON(store, `games/${game}/`)).filter((r) => r.best != null);
  list.sort((a, b) => (g.lower ? a.best - b.best : b.best - a.best) || a.bestAt - b.bestAt);
  const top = list.slice(0, 20).map((r, i) => ({ rank: i + 1, user: r.user, best: r.best, bestAt: r.bestAt }));
  const mineIdx = user ? list.findIndex((r) => r.user === user.id) : -1;
  return {
    game, ...g,
    top,
    players: list.length,
    mine: mineIdx >= 0 ? { rank: mineIdx + 1, best: list[mineIdx].best, plays: list[mineIdx].plays } : null,
  };
}

async function resetGame(store, body) {
  cleanGame(body.game);
  const { blobs } = await store.list({ prefix: `games/${body.game}/` });
  await Promise.all(blobs.map((b) => store.delete(b.key)));
  return { ok: true, removed: blobs.length };
}

// 닉네임 변경·계정 삭제 시 게임 기록 옮기기/지우기
async function moveGameRecords(store, oldId, newId) {
  await Promise.all(Object.keys(GAMES).map(async (game) => {
    const rec = await store.get(gameKey(game, oldId), { type: 'json' });
    if (!rec) return;
    await store.delete(gameKey(game, oldId));
    if (newId) await store.setJSON(gameKey(game, newId), { ...rec, user: newId });
  }));
}

// ---------- 8비트 레이드 ----------
// 길드원 모두가 같은 보스 하나를 함께 때린다. 한 판(60초)에 넣은 피해만큼 공용 체력이 깎이고,
// 쓰러뜨리면 다음 단계 보스가 더 큰 체력으로 나온다.
// config/raid = { enabled, dailyLimit, baseHp, growth, reward }
// raid/state = { season, level, hpMax, hp, startedAt, players: { 닉네임hex: { user, dmg, runs, best } }, log: [] }
// raid/history = [{ season, level, name, hpMax, startedAt, killedAt, killer, top: [...] }]
// 사용자 문서: raidDay = { day, count }, raidRun = { id, at, season }
const RAID_DEFAULT = { enabled: true, dailyLimit: 3, baseHp: 300000, growth: 1.35, reward: 0 };
export const RAID_BOSSES = ['슬라임 킹', '해골 기사', '크리스탈 골렘', '붉은 드래곤'];
export const RAID_RUN_MS = 60000;
export const RAID_DPS_CAP = 4000; // 1초에 넣을 수 있는 최대 피해 (조작 방지)
const raidName = (level) => `${RAID_BOSSES[(level - 1) % RAID_BOSSES.length]}${level > RAID_BOSSES.length ? ` ${Math.ceil(level / RAID_BOSSES.length)}단계` : ''}`;
export function raidHp(cfg, level) { return Math.round((cfg.baseHp * cfg.growth ** (level - 1)) / 1000) * 1000; }

async function raidConfig(store) {
  return { ...RAID_DEFAULT, ...((await store.get('config/raid', { type: 'json' })) || {}) };
}
async function raidState(store) {
  const st = await store.get('raid/state', { type: 'json' });
  if (st) return st;
  const cfg = await raidConfig(store);
  const fresh = { season: 1, level: 1, hpMax: raidHp(cfg, 1), hp: raidHp(cfg, 1), startedAt: Date.now(), players: {}, log: [] };
  await store.setJSON('raid/state', fresh, { onlyIfNew: true });
  return (await store.get('raid/state', { type: 'json' })) || fresh;
}
function raidTop(st, n = 20) {
  return Object.values(st.players || {}).sort((a, b) => b.dmg - a.dmg).slice(0, n).map((p, i) => ({ rank: i + 1, ...p }));
}
function raidPublic(st) {
  return { season: st.season, level: st.level, name: raidName(st.level), boss: (st.level - 1) % RAID_BOSSES.length, hpMax: st.hpMax, hp: st.hp, startedAt: st.startedAt, top: raidTop(st), log: (st.log || []).slice(0, 12), players: Object.keys(st.players || {}).length };
}

async function raidInfo(store, user) {
  const [cfg, st, hist] = await Promise.all([raidConfig(store), raidState(store), store.get('raid/history', { type: 'json' })]);
  const out = { enabled: cfg.enabled, dailyLimit: cfg.dailyLimit, reward: cfg.reward, raid: raidPublic(st), history: (hist || []).slice(0, 5) };
  if (user) {
    const u = await store.get(userKey(user.id), { type: 'json' });
    const used = u?.raidDay?.day === kstToday() ? u.raidDay.count : 0;
    const mine = st.players?.[keyPart(user.id)];
    out.me = { used, left: Math.max(0, cfg.dailyLimit - used), dmg: mine?.dmg || 0, runs: mine?.runs || 0, best: mine?.best || 0 };
  }
  return out;
}

async function raidStart(store, user) {
  const cfg = await raidConfig(store);
  if (!cfg.enabled) throw new HttpError(400, '지금은 레이드가 닫혀 있어요.');
  const st = await raidState(store);
  const day = kstToday();
  const id = randomBytes(8).toString('hex');
  await update(store, userKey(user.id), (u) => {
    const used = u.raidDay?.day === day ? u.raidDay.count : 0;
    if (used >= cfg.dailyLimit) throw new HttpError(400, `오늘 도전 횟수(${cfg.dailyLimit}번)를 다 썼어요. 내일 다시 와 주세요.`);
    return { ...u, raidDay: { day, count: used + 1 }, raidRun: { id, at: Date.now(), season: st.season } };
  });
  return { run: id, seconds: RAID_RUN_MS / 1000, raid: raidPublic(st) };
}

async function raidFinish(store, user, body) {
  const dmg = Number(body.damage);
  if (!Number.isInteger(dmg) || dmg < 0) throw new HttpError(400, '피해량이 올바르지 않아요.');
  let run = null;
  await update(store, userKey(user.id), (u) => {
    if (!u.raidRun || u.raidRun.id !== String(body.run || '')) throw new HttpError(400, '이미 끝났거나 없는 도전이에요.');
    run = u.raidRun;
    const { raidRun, ...rest } = u;
    return rest;
  });
  const elapsed = Math.min(Date.now() - run.at, RAID_RUN_MS + 15000);
  if (elapsed < 3000) throw new HttpError(400, '너무 빨리 끝났어요.');
  const cap = Math.floor((Math.min(elapsed, RAID_RUN_MS) / 1000) * RAID_DPS_CAP);
  if (dmg > cap) throw new HttpError(400, '피해량이 너무 커요.');
  const cfg = await raidConfig(store);
  const now = Date.now();
  let killed = null, applied = 0;
  const st = await update(store, 'raid/state', (s) => {
    killed = null;
    applied = run.season === s.season ? Math.min(dmg, s.hp) : 0; // 그사이 보스가 바뀌었으면 기록만
    const k = keyPart(user.id);
    const p = s.players[k] || { dmg: 0, runs: 0, best: 0 };
    s.players[k] = { user: user.id, dmg: p.dmg + applied, runs: p.runs + 1, best: Math.max(p.best, dmg) };
    s.hp -= applied;
    s.log = [{ user: user.id, dmg, at: now }, ...(s.log || [])].slice(0, 20);
    if (s.hp <= 0) {
      killed = { season: s.season, level: s.level, name: raidName(s.level), hpMax: s.hpMax, startedAt: s.startedAt, killedAt: now, killer: user.id, top: raidTop(s, 10), members: Object.values(s.players).map((x) => x.user) };
      const level = s.level + 1;
      return { season: s.season + 1, level, hpMax: raidHp(cfg, level), hp: raidHp(cfg, level), startedAt: now, players: {}, log: [] };
    }
    return s;
  });
  if (killed) {
    const { members, ...rec } = killed;
    await update(store, 'raid/history', (h) => [rec, ...h].slice(0, 30), { create: () => [] });
    if (cfg.reward > 0) {
      await Promise.all(members.map((id) => update(store, userKey(id), (x) => {
        x.tickets += cfg.reward;
        pushHistory(x, cfg.reward, `레이드 ${killed.name} 처치`);
        return x;
      }).catch(() => null)));
    }
  }
  const info = await raidInfo(store, user);
  return { ...info, applied, killed: killed ? { name: killed.name, killer: killed.killer, reward: cfg.reward } : null };
}

async function saveRaidConfig(store, body) {
  const cfg = await raidConfig(store);
  const next = { ...cfg };
  if (body.enabled !== undefined) next.enabled = Boolean(body.enabled);
  for (const [k, lo, hi, label, int] of [['dailyLimit', 0, 20, '하루 횟수', true], ['baseHp', 10000, 100000000, '첫 보스 체력', true], ['growth', 1, 5, '단계별 체력 배수', false], ['reward', 0, 100, '처치 보상', true]]) {
    if (body[k] === undefined) continue;
    const v = Number(body[k]);
    if (!Number.isFinite(v) || (int && !Number.isInteger(v)) || v < lo || v > hi) throw new HttpError(400, `${label}은(는) ${lo}~${hi} 사이로 정해 주세요.`);
    next[k] = v;
  }
  await store.setJSON('config/raid', next);
  return adminRaid(store);
}
async function adminRaid(store) {
  const [cfg, st, hist] = await Promise.all([raidConfig(store), raidState(store), store.get('raid/history', { type: 'json' })]);
  return { config: cfg, raid: raidPublic(st), history: hist || [] };
}
// 처음 보스(1단계)부터 다시. 기록도 지움
async function resetRaid(store, body) {
  const cfg = await raidConfig(store);
  const st = await raidState(store);
  const level = body.keepLevel ? st.level : 1;
  await store.setJSON('raid/state', { season: st.season + 1, level, hpMax: raidHp(cfg, level), hp: raidHp(cfg, level), startedAt: Date.now(), players: {}, log: [] });
  if (!body.keepLevel) await store.delete('raid/history');
  return adminRaid(store);
}
async function renameInRaid(store, oldId, newId) {
  if (!(await store.get('raid/state', { type: 'json' }))) return;
  await update(store, 'raid/state', (s) => {
    const p = s.players?.[keyPart(oldId)];
    if (!p) return undefined;
    delete s.players[keyPart(oldId)];
    if (newId) s.players[keyPart(newId)] = { ...p, user: newId };
    s.log = (s.log || []).map((x) => (x.user === oldId ? { ...x, user: newId || '(탈퇴)' } : x));
    return s;
  });
}

// ---------- 로또권 신청 ----------
// 길드원이 신청하면 requests/<닉네임hex> 에 한 건씩(새로 신청하면 덮어씀), 운영자가 승인하면 지급

const requestKey = (id) => `requests/${keyPart(id)}`;

async function myRequest(store, user, body) {
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 10) throw new HttpError(400, '신청 수량은 1~10장이에요.');
  const memo = String(body.memo || '').trim().slice(0, 60);
  const request = { user: user.id, amount, memo, createdAt: Date.now() };
  await store.setJSON(requestKey(user.id), request);
  await addLog(store, user.id, '로또권 신청', `${amount}장${memo ? ` · ${memo}` : ''}`);
  return { request };
}

async function cancelMyRequest(store, user) {
  await store.delete(requestKey(user.id));
  return { request: null };
}

async function listRequests(store) {
  const list = await listJSON(store, 'requests/');
  return list.sort((a, b) => a.createdAt - b.createdAt);
}

async function approveRequest(store, body) {
  const key = requestKey(String(body.user || ''));
  const req = await store.get(key, { type: 'json' });
  if (!req) throw new HttpError(404, '신청을 찾을 수 없습니다. (이미 처리됨)');
  const amount = body.amount ? Number(body.amount) : req.amount;
  const out = await grant(store, { ids: [req.user], amount, reason: '로또권 신청 승인' });
  await store.delete(key);
  await update(store, userKey(req.user), (u) => ({ ...u, requestResult: { status: 'approved', amount, at: Date.now() } })).catch(() => null);
  return { ...out, requests: await listRequests(store) };
}

async function rejectRequest(store, body) {
  const key = requestKey(String(body.user || ''));
  const req = await store.get(key, { type: 'json' });
  if (!req) throw new HttpError(404, '신청을 찾을 수 없습니다. (이미 처리됨)');
  await store.delete(key);
  await update(store, userKey(req.user), (u) => ({ ...u, requestResult: { status: 'rejected', amount: req.amount, at: Date.now() } })).catch(() => null);
  return { requests: await listRequests(store) };
}

// ---------- 사이트 설정 ----------
async function siteSettings(store) {
  const saved = (await store.get('config/site', { type: 'json' })) || {};
  return { autoWinnerNotice: saved.autoWinnerNotice !== false };
}

async function saveSiteSettings(store, body) {
  const patch = {};
  if (body.autoWinnerNotice !== undefined) patch.autoWinnerNotice = Boolean(body.autoWinnerNotice);
  await update(store, 'config/site', (c) => ({ ...c, ...patch }), { create: () => ({}) });
  return siteSettings(store);
}

async function adminOverview(store) {
  const users = (await listJSON(store, 'users/')).map(publicUser).sort((a, b) => a.id.localeCompare(b.id, 'ko'));
  const round = await currentRound(store);
  return { users, round: publicRound(round), requests: await listRequests(store), settings: await siteSettings(store) };
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

// 디코 연동된 길드원에게 바뀐 아이디/비밀번호를 개인 DM으로
async function accountDM(store, user, { title, password, keepPassword = false, self = false }) {
  if (!user.discordId) return { dm: 'none' };
  const s = await discordSettings(store);
  if (!s.botToken) return { dm: 'nobot' };
  const site = publicSiteUrl();
  try {
    await sendDM(s.botToken, user.discordId, {
      embeds: [{
        title,
        color: SITE_COLOR,
        description: self ? '사이트에서 닉네임을 바꿨어요. 다음 로그인부터 아래 아이디를 쓰세요.' : '운영자가 계정 정보를 변경했어요. 아래 정보로 다시 로그인해 주세요.',
        fields: [
          { name: '아이디 (닉네임)', value: `\`${user.id}\``, inline: true },
          ...(password ? [{ name: '비밀번호', value: `||\`${password}\`||`, inline: true }] : []),
          ...(keepPassword ? [{ name: '비밀번호', value: '변경 없음 (쓰던 비밀번호 그대로)', inline: true }] : []),
          { name: '사이트', value: site },
        ],
        footer: { text: '비밀번호는 남에게 보여주지 마세요 · 크리스탈 길드' },
      }],
    });
    return { dm: 'sent' };
  } catch (err) {
    return { dm: 'failed', dmError: err.message };
  }
}

async function resetPassword(store, body) {
  validatePassword(body.password);
  const { salt, hash } = hashPassword(body.password);
  const u = await update(store, userKey(String(body.id || '')), (u) => ({ ...u, salt, hash, pwv: (u.pwv || 1) + 1 }));
  return { id: u.id, ...(await accountDM(store, u, { title: '크리스탈 길드 비밀번호 변경', password: body.password })) };
}

// 운영자 닉네임 변경: 계정·응모 기록·당첨자 이름을 새 닉네임으로 옮긴다.
// 비밀번호는 새로 입력했을 때만 바뀌고, 비우면 그대로. 디코 연동된 길드원에게는 DM으로 알려준다.
async function renameUser(store, body) {
  const oldId = String(body.id || '');
  const newId = String(body.newId || '').trim();
  validateId(newId);
  if (newId.toLowerCase() === (process.env.ADMIN_ID || 'admin').toLowerCase()) throw new HttpError(400, '사용할 수 없는 닉네임입니다.');
  const oldKey = userKey(oldId);
  const newKey = userKey(newId);
  const user = await store.get(oldKey, { type: 'json' });
  if (!user) throw new HttpError(404, '회원을 찾을 수 없습니다.');
  if (user.id === newId) throw new HttpError(400, '지금과 같은 닉네임입니다.');
  const password = body.password ? String(body.password) : null;
  if (password) validatePassword(password);
  const next = { ...user, id: newId, pwv: (user.pwv || 1) + 1, renamedFrom: user.id, renamedAt: Date.now() };
  if (password) Object.assign(next, hashPassword(password));

  if (newKey === oldKey) {
    await update(store, oldKey, (u) => ({ ...u, ...next, tickets: u.tickets, history: u.history })); // 대소문자만 바뀜
  } else {
    const res = await store.setJSON(newKey, next, { onlyIfNew: true });
    if (!res.modified) throw new HttpError(409, '이미 사용 중인 닉네임입니다.');
    await store.delete(oldKey);
    // 응모 기록 옮기기
    const oldPart = keyPart(oldId);
    const { blobs } = await store.list({ prefix: 'entries/' });
    const mine = blobs.filter((b) => b.key.split('/')[2] === oldPart);
    await Promise.all(mine.map(async (b) => {
      const e = await store.get(b.key, { type: 'json' });
      if (!e) return;
      const parts = b.key.split('/');
      await store.setJSON(`entries/${parts[1]}/${keyPart(newId)}/${parts[3]}`, { ...e, user: newId });
      await store.delete(b.key);
    }));
  }
  // 프로필 사진 옮기기
  if (newKey !== oldKey) {
    const pic = await store.get(avatarKey(oldId), { type: 'json' });
    if (pic) {
      await store.setJSON(avatarKey(newId), pic);
      await store.delete(avatarKey(oldId));
    }
  }
  // 대기 중인 로또권 신청도 옮기기
  const pending = await store.get(requestKey(oldId), { type: 'json' });
  if (pending && newKey !== oldKey) {
    await store.setJSON(requestKey(newId), { ...pending, user: newId });
    await store.delete(requestKey(oldId));
  }
  // 쿠폰 사용 기록의 이름도 바꾸기 (같은 쿠폰 다시 쓰는 것 방지)
  if (newKey !== oldKey) {
    const { blobs: cps } = await store.list({ prefix: 'coupons/' });
    await Promise.all(cps.map((b) => update(store, b.key, (c) => {
      if (!(c.usedBy || []).includes(user.id)) return undefined;
      return { ...c, usedBy: c.usedBy.map((x) => (x === user.id ? newId : x)) };
    }).catch(() => null)));
  }
  if (newId !== user.id) await renameInEvents(store, user.id, newId);
  if (newId !== user.id) await moveGameRecords(store, user.id, newId);
  if (newId !== user.id) await renameInRaid(store, user.id, newId);
  if (newKey !== oldKey) {
    const bj = await store.get(bjKey(oldId), { type: 'json' });
    if (bj) { await store.setJSON(bjKey(newId), bj); await store.delete(bjKey(oldId)); }
  }
  // 지난 회차 당첨자 이름도 바꾸기
  const { blobs: rounds } = await store.list({ prefix: 'rounds/' });
  await Promise.all(rounds.map((b) => update(store, b.key, (r) => {
    if (!r.winners?.some((w) => w.user === user.id)) return undefined;
    return { ...r, winners: r.winners.map((w) => (w.user === user.id ? { ...w, user: newId } : w)) };
  }).catch(() => null)));

  const dm = await accountDM(store, next, { title: '크리스탈 길드 닉네임 변경', password, keepPassword: !password, self: Boolean(body.self) });
  return { user: publicUser(next), passwordChanged: Boolean(password), ...dm };
}

async function deleteUser(store, body) {
  const key = userKey(String(body.id || ''));
  const u = await store.get(key, { type: 'json' });
  if (!u) throw new HttpError(404, '회원을 찾을 수 없습니다.');
  await store.delete(key);
  await store.delete(requestKey(String(body.id)));
  await store.delete(avatarKey(String(body.id)));
  await renameInEvents(store, u.id, '');
  await moveGameRecords(store, u.id, '');
  await renameInRaid(store, u.id, '');
  await store.delete(bjKey(u.id));
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
  await notifyDiscord(store, 'open', (cfg) => roundOpenMessage(round, cfg.openMention, cfg.roleId));
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
    if (!cfg.notify.mentionWinners || !round.winners.length) return drawCard(round);
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
    return drawCard(round, users.filter(Boolean).map((u) => u.discordId).filter(Boolean));
  });
  await dmWinners(store, round);
  await autoWinnerNotice(store, round);
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

// 1등이 나오면 사이트 공지를 자동으로 작성 (운영실 설정에서 끌 수 있음)
export function winnerNoticeText(r) {
  const firsts = [...new Set(r.winners.filter((w) => w.rank === 1).map((w) => w.user))];
  if (!firsts.length) return null;
  const nums = `${r.numbers.map((n) => String(n).padStart(2, '0')).join(' ')} + ${String(r.bonus).padStart(2, '0')}`;
  const others = RANKS.filter((k) => k > 1)
    .map((k) => [k, [...new Set(r.winners.filter((w) => w.rank === k).map((w) => w.user))]])
    .filter(([, users]) => users.length)
    .map(([k, users]) => `${k}등: ${users.join(', ')}${r.prizes?.[k] ? ` (${r.prizes[k]})` : ''}`);
  return {
    title: `제${r.no}회 로또 1등 당첨자 발표`,
    body: [
      `제${r.no}회 크리스탈 로또 1등 당첨을 축하합니다!`,
      '',
      `1등: ${firsts.join(', ')}`,
      ...(r.prizes?.[1] ? [`상품: ${r.prizes[1]}`] : []),
      `당첨번호: ${nums}`,
      ...(others.length ? ['', ...others] : []),
      '',
      '상품은 운영자가 지급할 예정입니다. 축하해 주세요!',
    ].join('\n'),
  };
}

async function autoWinnerNotice(store, round) {
  try {
    if (!(await siteSettings(store)).autoWinnerNotice) return;
    const text = winnerNoticeText(round);
    if (text) await createNotice(store, { ...text, pinned: false, discord: false }); // 디코에는 추첨 결과 카드가 이미 나감
  } catch (err) {
    console.error('winner notice failed', err.message);
  }
}

async function createNotice(store, body) {
  const now = Date.now();
  const notice = { id: `${now.toString(36)}${randomBytes(3).toString('hex')}`, ...cleanNotice(body), createdAt: now, updatedAt: now };
  await store.setJSON(`notices/${notice.id}`, notice);
  if (body.discord !== false && (await notifyDiscord(store, 'notice', (cfg) => noticeCard(notice, cfg.noticeMention, cfg.roleId)))) {
    notice.discordAt = Date.now();
    await store.setJSON(`notices/${notice.id}`, notice);
  }
  return { notice };
}

// ---------- 예약 공지 ----------
// scheduled/<id> = { id, title, body, pinned, discord, replace, times: [아직 안 올린 시각], sent: [{ at, noticeId }], createdAt }
// 고른 날짜마다 같은 공지를 올린다. replace 면 새로 올릴 때 이 예약으로 전에 올린 공지를 지운다.
const MAX_SCHEDULE_TIMES = 60;
const scheduledKey = (id) => {
  if (typeof id !== 'string' || !/^[0-9a-z]{6,40}$/.test(id)) throw new HttpError(404, '예약 공지를 찾을 수 없어요.');
  return `scheduled/${id}`;
};

function cleanTimes(list) {
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, '올릴 날짜를 하나 이상 고르세요.');
  const now = Date.now();
  const times = [...new Set(list.map(Number))].sort((a, b) => a - b);
  if (times.length > MAX_SCHEDULE_TIMES) throw new HttpError(400, `예약은 한 번에 ${MAX_SCHEDULE_TIMES}개까지 할 수 있어요.`);
  if (times.some((t) => !Number.isFinite(t))) throw new HttpError(400, '날짜 형식이 올바르지 않아요.');
  if (times.some((t) => t < now - 60000)) throw new HttpError(400, '이미 지난 시간이 있어요. 지금 이후로 골라 주세요.');
  if (times.some((t) => t > now + 366 * 86400000)) throw new HttpError(400, '1년 안의 날짜만 예약할 수 있어요.');
  return times;
}

// 매주 반복: { days: [0~6 (일~토)], time: 'HH:MM' } — 한국 시간 기준, 취소할 때까지 계속
function cleanRepeat(r) {
  const days = [...new Set((Array.isArray(r?.days) ? r.days : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (!days.length) throw new HttpError(400, '반복할 요일을 하나 이상 고르세요.');
  const time = String(r.time || '');
  if (!TIME_RE.test(time)) throw new HttpError(400, '올릴 시간을 정해 주세요.');
  return { days, time };
}

// after 다음(초과)의 가장 가까운 반복 시각
export function nextRepeat(repeat, after) {
  const [hh, mm] = repeat.time.split(':').map(Number);
  const k = new Date(after + 9 * 3600000); // 한국 날짜
  for (let i = 0; i <= 7; i++) {
    const day = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + i));
    const at = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm) - 9 * 3600000;
    if (repeat.days.includes(day.getUTCDay()) && at > after) return at;
  }
  return null;
}

async function createScheduled(store, body) {
  const now = Date.now();
  const repeat = body.repeat ? cleanRepeat(body.repeat) : null;
  const item = {
    id: `${now.toString(36)}${randomBytes(3).toString('hex')}`,
    ...cleanNotice(body),
    discord: body.discord !== false,
    replace: Boolean(body.replace),
    repeat,
    times: repeat ? [nextRepeat(repeat, now)] : cleanTimes(body.times),
    sent: [],
    createdAt: now,
  };
  await store.setJSON(`scheduled/${item.id}`, item);
  return { scheduled: item };
}

async function listScheduled(store) {
  const list = await listJSON(store, 'scheduled/');
  // 남은 예약이 있는 것 먼저(가까운 순), 다 올린 것은 최근 순
  list.sort((a, b) => (a.times.length ? a.times[0] : Infinity) - (b.times.length ? b.times[0] : Infinity) || b.createdAt - a.createdAt);
  return { scheduled: list };
}

async function deleteScheduled(store, body) {
  await store.delete(scheduledKey(body.id));
  return listScheduled(store);
}

// 예약 날짜 하나만 빼기 (매주 반복이면 이번 회만 건너뛰기)
async function removeScheduledTime(store, body) {
  const at = Number(body.at);
  await update(store, scheduledKey(body.id), (x) => ({
    ...x,
    times: x.repeat ? (x.times.includes(at) ? [nextRepeat(x.repeat, at)] : x.times) : x.times.filter((t) => t !== at),
  }));
  return listScheduled(store);
}

// 시간이 된 예약 공지를 올린다 (1분마다 + 공지 목록을 볼 때). 같은 예약이 두 번 올라가지 않게 먼저 차지하고 올린다.
export async function publishScheduledNotices(store, now = Date.now()) {
  const { blobs } = await store.list({ prefix: 'scheduled/' });
  let posted = 0;
  for (const b of blobs) {
    let due = [];
    let item;
    try {
      item = await update(store, b.key, (x) => {
        due = x.times.filter((t) => t <= now);
        if (!due.length) return undefined;
        const rest = x.repeat ? [nextRepeat(x.repeat, now)] : x.times.filter((t) => t > now);
        return { ...x, times: rest, sent: [...x.sent, { at: due[due.length - 1], noticeId: null }].slice(-30) };
      });
    } catch {
      continue;
    }
    if (!due.length) continue;
    // 밀린 예약이 여러 개여도 한 번만 올림
    const { notice } = await createNotice(store, { title: item.title, body: item.body, pinned: item.pinned, discord: item.discord });
    const prev = item.replace ? item.sent.map((x) => x.noticeId).filter(Boolean) : [];
    await Promise.all(prev.map((id) => store.delete(`notices/${id}`)));
    await update(store, b.key, (x) => ({ ...x, sent: x.sent.map((y) => (y.at === due[due.length - 1] && !y.noticeId ? { ...y, noticeId: notice.id } : y)) })).catch(() => null);
    await addLog(store, '자동', '예약 공지 게시', `${item.title.slice(0, 40)}${due.length > 1 ? ` (밀린 ${due.length}건 중 1건)` : ''}`);
    posted++;
  }
  return posted;
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
const MENTIONS = ['none', 'everyone', 'here', 'role'];
export const DEFAULT_ROLE_ID = '1194961472514707517';

const DISCORD_ID_RE = /^\d{17,20}$/;

// 멘션 선택 → 메시지 앞에 붙일 글자와 허용할 멘션 (지정한 것 외에는 아무도 울리지 않음)
function mentionPart(mention, userIds = [], roleId = '') {
  const users = [...new Set(userIds.filter((id) => DISCORD_ID_RE.test(id)))].slice(0, 100);
  const role = mention === 'role' && DISCORD_ID_RE.test(roleId) ? roleId : '';
  const parts = [];
  if (mention === 'everyone') parts.push('@everyone');
  if (mention === 'here') parts.push('@here');
  if (role) parts.push(`<@&${role}>`);
  parts.push(...users.map((id) => `<@${id}>`));
  if (!parts.length) return {};
  return {
    content: parts.join(' '),
    allowed_mentions: {
      parse: mention === 'everyone' || mention === 'here' ? ['everyone'] : [],
      ...(role ? { roles: [role] } : {}),
      ...(users.length ? { users } : {}),
    },
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
    noticeMention: MENTIONS.includes(saved.noticeMention) ? saved.noticeMention : 'role',
    openMention: MENTIONS.includes(saved.openMention) ? saved.openMention : 'role',
    roleId: env.DISCORD_ROLE_ID || saved.roleId || DEFAULT_ROLE_ID,
    couponWebhookUrl: env.DISCORD_COUPON_WEBHOOK_URL || saved.couponWebhookUrl || '',
    couponMention: MENTIONS.includes(saved.couponMention) ? saved.couponMention : 'role',
    couponAuto: saved.couponAuto !== false,
    fromEnv: { couponWebhookUrl: Boolean(env.DISCORD_COUPON_WEBHOOK_URL), webhookUrl: Boolean(env.DISCORD_WEBHOOK_URL), botToken: Boolean(env.DISCORD_BOT_TOKEN), roleId: Boolean(env.DISCORD_ROLE_ID) },
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
    openMention: s.openMention,
    roleId: s.roleId,
    couponWebhookSet: Boolean(s.couponWebhookUrl),
    couponWebhookPreview: maskWebhook(s.couponWebhookUrl),
    couponMention: s.couponMention,
    couponAuto: s.couponAuto,
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
  if (body.couponWebhookUrl !== undefined) {
    const url = String(body.couponWebhookUrl).trim();
    if (url && !WEBHOOK_RE.test(url)) throw new HttpError(400, '디스코드 웹후크 주소 형식이 아닙니다. (https://discord.com/api/webhooks/...)');
    patch.couponWebhookUrl = url;
  }
  if (body.couponAuto !== undefined) patch.couponAuto = Boolean(body.couponAuto);
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
  for (const k of ['noticeMention', 'openMention', 'couponMention']) {
    if (body[k] === undefined) continue;
    if (!MENTIONS.includes(body[k])) throw new HttpError(400, '멘션 설정이 올바르지 않습니다.');
    patch[k] = body[k];
  }
  if (body.roleId !== undefined) {
    const r = String(body.roleId).trim();
    if (r && !DISCORD_ID_RE.test(r)) throw new HttpError(400, '역할 ID는 17~20자리 숫자입니다. (서버 설정 → 역할 → 우클릭 → 역할 ID 복사)');
    patch.roleId = r;
  }
  await update(store, 'config/discord', (c) => ({ ...c, ...patch }), { create: () => ({}) });
  if (patch.botToken || patch.guildId) await autoSyncCommands(store);
  return getDiscordAdmin(store);
}

async function postWebhook(url, payload) {
  const { fallback, ...body } = payload;
  // 버튼이 들어간 카드형 메시지(Components V2)는 with_components=true 가 있어야 웹후크로 보낼 수 있다
  const res = await fetch(`${url}?wait=true${body.components ? '&with_components=true' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: '크리스탈 길드', avatar_url: `${publicSiteUrl()}/logo.png`, allowed_mentions: { parse: [] }, ...body }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok && fallback && res.status === 400) return postWebhook(url, fallback); // 카드형이 거절되면 일반 임베드로
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

// 알림 실패가 운영 동작(공지 등록, 추첨 등)을 막지 않도록 오류는 기록만 한다.
async function notifyDiscord(store, kind, build) {
  try {
    const s = await discordSettings(store);
    if (!s.webhookUrl || !s.notify[kind]) return false;
    await postWebhook(s.webhookUrl, await build(s));
    return true;
  } catch (err) {
    console.error('discord notify failed', kind, err.message);
    return false;
  }
}

const cut = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

function noticeMessage(n, mention, roleId) {
  return {
    ...mentionPart(mention, [], roleId),
    embeds: [{
      title: cut(`${n.pinned ? '[공지] ' : ''}${n.title}`, 250),
      description: n.body ? cut(n.body, 3500) : undefined,
      color: SITE_COLOR,
      footer: { text: '크리스탈 길드 공지사항' },
      timestamp: new Date(n.createdAt).toISOString(),
    }],
  };
}

// 공지 카드: 제목 · 본문 · 사이트 공지사항으로 가는 버튼 (카드가 거절되면 noticeMessage 임베드)
export function noticeCard(n, mention = 'none', roleId = '') {
  const ping = mentionPart(mention, [], roleId);
  const text = (content) => ({ type: 10, content });
  return {
    flags: 1 << 15,
    ...(ping.allowed_mentions ? { allowed_mentions: ping.allowed_mentions } : {}),
    components: [
      ...(ping.content ? [text(ping.content)] : []),
      {
        type: 17,
        accent_color: 0x7b68ee,
        components: [
          text(`## ${cut(`${n.pinned ? '📌 ' : ''}${n.title}`, 200)}`),
          ...(n.body ? [text(cut(n.body, 3500))] : []),
          { type: 14, divider: true, spacing: 1 },
          text(`-# 크리스탈 길드 공지사항 · <t:${Math.floor(n.createdAt / 1000)}:f>`),
          { type: 1, components: [{ type: 2, style: 5, label: '사이트에서 공지 보기', url: `${publicSiteUrl()}/#notices` }] },
        ],
      },
    ],
    fallback: noticeMessage(n, mention, roleId),
  };
}

// 운영실에서 이미 올린 공지를 디스코드 채널로 (다시) 보내기
async function sendNoticeToDiscord(store, body) {
  const n = await store.get(noticeKey(body.id), { type: 'json' });
  if (!n) throw new HttpError(404, '공지를 찾을 수 없습니다.');
  const s = await discordSettings(store);
  if (!s.webhookUrl) throw new HttpError(400, '먼저 디스코드 알림에서 웹후크 주소를 저장하세요.');
  const mention = MENTIONS.includes(body.mention) ? body.mention : s.noticeMention;
  try {
    await postWebhook(s.webhookUrl, noticeCard(n, mention, s.roleId));
  } catch (err) {
    throw new HttpError(502, `디스코드로 보내지 못했습니다. 웹후크 주소를 확인하세요. (${err.message})`);
  }
  const saved = await update(store, noticeKey(n.id), (x) => ({ ...x, discordAt: Date.now() }));
  return { notice: saved };
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

const SITE_URL_FALLBACK = 'https://crystal1234.netlify.app';
const publicSiteUrl = () => (process.env.URL || SITE_URL_FALLBACK).replace(/\/$/, '');

// 회차 시작 알림: 제목 · 안내 · 기간/상품 · 구분선 · 사이트로 가는 버튼이 있는 카드
export function roundOpenMessage(r, mention = 'none', roleId = '') {
  const ping = mentionPart(mention, [], roleId);
  const prizes = prizeLines(r.prizes);
  const period = periodText(r);
  const site = publicSiteUrl();
  const details = [
    period && `**응모 기간**\n${period}`,
    prizes && `**상품**\n${prizes}`,
  ].filter(Boolean).join('\n\n');
  const text = (content) => ({ type: 10, content });
  return {
    flags: 1 << 15, // IS_COMPONENTS_V2
    ...(ping.allowed_mentions ? { allowed_mentions: ping.allowed_mentions } : {}),
    components: [
      ...(ping.content ? [{ type: 10, content: ping.content }] : []),
      {
      type: 17, // 카드(Container)
      accent_color: 0x1f9d63,
      components: [
        text(`## 제${r.no}회 크리스탈 로또 시작!`),
        text('크리스탈 길드 로또가 열렸습니다.\n로또권으로 번호 6개를 골라 응모하세요.'),
        ...(details ? [text(details)] : []),
        { type: 14, divider: true, spacing: 1 }, // 구분선
        text('로또권은 출석·이벤트 보상으로 지급됩니다. 당첨되면 추첨 후 바로 알려드려요.'),
        { type: 1, components: [{ type: 2, style: 5, label: '로또 응모하러 가기', url: `${site}/#event` }] },
      ],
    }],
    fallback: {
      ...ping,
      embeds: [{
        title: `제${r.no}회 크리스탈 로또 시작!`,
        url: `${site}/#event`,
        description: `로또권으로 번호 6개를 골라 응모하세요.\n[로또 응모하러 가기](${site}/#event)`,
        color: 0x1f9d63,
        fields: [
          ...(period ? [{ name: '응모 기간', value: period }] : []),
          ...(prizes ? [{ name: '상품', value: prizes }] : []),
        ],
        timestamp: new Date(r.openedAt).toISOString(),
      }],
    },
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

// 추첨 결과 카드: 당첨번호(공 모양) · 등수별 당첨자 · 사이트 버튼. 당첨자 멘션은 카드 위 한 줄.
export function drawCard(r, winnerIds = []) {
  const site = publicSiteUrl();
  const ball = (n) => `\`${String(n).padStart(2, '0')}\``;
  const byRank = {};
  for (const w of r.winners) (byRank[w.rank] ||= []).push(w.user);
  const rankLines = Object.keys(byRank).sort().map((rank) => {
    const users = [...new Set(byRank[rank])];
    const prize = r.prizes?.[rank] ? ` · ${r.prizes[rank]}` : '';
    return `**${rank}등**${prize}\n${cut(users.join(', '), 300)}${byRank[rank].length > 1 ? ` (${byRank[rank].length}줄)` : ''}`;
  });
  const mention = mentionPart('none', winnerIds);
  const text = (content) => ({ type: 10, content });
  return {
    flags: 1 << 15,
    ...(mention.allowed_mentions ? { allowed_mentions: mention.allowed_mentions } : {}),
    components: [
      ...(mention.content ? [text(`${mention.content} 당첨을 축하합니다!`)] : []),
      {
        type: 17,
        accent_color: 0xc8962b,
        components: [
          text(`## 제${r.no}회 크리스탈 로또 추첨 결과`),
          text(`### ${r.numbers.map(ball).join(' ')}  ＋  ${ball(r.bonus)}\n-# 당첨번호 6개 + 보너스 번호`),
          { type: 14, divider: true, spacing: 1 },
          text(rankLines.length
            ? cut(rankLines.join('\n\n'), 3000)
            : '이번 회차는 당첨자가 없습니다.\n다음 회차에 다시 도전해 보세요!'),
          text(`-# 총 ${r.entryCount}줄 응모 · 당첨 ${r.winners.length}줄`),
          { type: 1, components: [{ type: 2, style: 5, label: '내 번호 확인하기', url: `${site}/#results` }] },
        ],
      },
    ],
    fallback: drawMessage(r, winnerIds),
  };
}

// 쿠폰 채널 카드: 코드(눌러서 복사하기 쉬운 코드 블록) · 로또권 · 선착순 · 기한 · 사이트 버튼
export function couponCard(c, mention = 'none', roleId = '') {
  const site = publicSiteUrl();
  const ping = mentionPart(mention, [], roleId);
  const until = c.expiresAt ? `<t:${Math.floor(c.expiresAt / 1000)}:F> (<t:${Math.floor(c.expiresAt / 1000)}:R>)` : '기한 없음';
  const who = c.maxUses ? `선착순 ${c.maxUses}명` : '길드원 누구나';
  const info = `**로또권** ${c.amount}장\n**받을 수 있는 사람** ${who} · 한 사람당 한 번\n**사용 기한** ${until}`;
  const how = c.board ? '사이트 **쿠폰 채널**에서 받기 버튼을 누르거나 코드를 입력하세요' : '사이트 **쿠폰 채널**에 코드를 입력하세요';
  const text = (content) => ({ type: 10, content });
  return {
    flags: 1 << 15,
    ...(ping.allowed_mentions ? { allowed_mentions: ping.allowed_mentions } : {}),
    components: [
      ...(ping.content ? [text(ping.content)] : []),
      {
        type: 17,
        accent_color: 0x7b68ee,
        components: [
          text('## 로또권 쿠폰이 나왔어요!'),
          text(`\`\`\`\n${c.code}\n\`\`\``),
          text(info),
          { type: 14, divider: true, spacing: 1 },
          text(`-# ${how}`),
          { type: 1, components: [{ type: 2, style: 5, label: '쿠폰 받으러 가기', url: `${site}/#coupons` }] },
        ],
      },
    ],
    fallback: {
      ...ping,
      embeds: [{
        title: '로또권 쿠폰이 나왔어요!',
        url: `${site}/#coupons`,
        description: `\`\`\`\n${c.code}\n\`\`\`\n${info}\n\n${how}\n[쿠폰 받으러 가기](${site}/#coupons)`,
        color: 0x7b68ee,
        timestamp: new Date(c.createdAt).toISOString(),
      }],
    },
  };
}

async function postCoupon(store, coupon) {
  const s = await discordSettings(store);
  if (!s.couponWebhookUrl) throw new HttpError(400, '먼저 쿠폰 채널 웹후크를 저장하세요.');
  if (coupon.expiresAt && Date.now() > coupon.expiresAt) throw new HttpError(400, '기간이 끝난 쿠폰이에요.');
  try {
    await postWebhook(s.couponWebhookUrl, couponCard(coupon, s.couponMention, s.roleId));
  } catch (err) {
    throw new HttpError(502, `쿠폰 채널로 보내지 못했어요. 웹후크 주소를 확인하세요. (${err.message})`);
  }
  return update(store, `coupons/${coupon.code}`, (c) => ({ ...c, postedAt: Date.now() }));
}

async function announceCoupon(store, body) {
  const code = cleanCode(body.code);
  if (!COUPON_RE.test(code)) throw new HttpError(404, '쿠폰을 찾을 수 없어요.');
  const c = await store.get(`coupons/${code}`, { type: 'json' });
  if (!c) throw new HttpError(404, '쿠폰을 찾을 수 없어요.');
  return { coupon: await postCoupon(store, c) };
}

async function testCouponChannel(store) {
  const s = await discordSettings(store);
  if (!s.couponWebhookUrl) throw new HttpError(400, '먼저 쿠폰 채널 웹후크를 저장하세요.');
  try {
    await postWebhook(s.couponWebhookUrl, { content: '크리스탈 길드 쿠폰 채널로 연결되었습니다. 운영자가 만든 로또권 쿠폰이 이 채널에 올라옵니다.' });
  } catch (err) {
    throw new HttpError(502, `디스코드로 보내지 못했습니다. 웹후크 주소를 확인하세요. (${err.message})`);
  }
  return { ok: true };
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
    }, true); // 친 사람에게만 보임
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
    await postWebhook(s.webhookUrl, { ...mentionPart(mention, userIds, s.roleId), embeds: [embed] });
  } catch (err) {
    throw new HttpError(502, `디스코드로 보내지 못했습니다. 웹후크 주소를 확인하세요. (${err.message})`);
  }
  return { ok: true };
}

// ---------- 라우터 ----------


// ---------- 운영 활동 기록 ----------
// logs/<거꾸로 된 시각>-<랜덤> : 키 순서가 곧 최신순. 최근 1000건만 남긴다.
const LOG_KEEP = 1000;
const logKey = () => `logs/${String(9e15 - Date.now()).padStart(16, '0')}-${randomBytes(3).toString('hex')}`;

export async function addLog(store, actor, action, detail = '') {
  try {
    await store.setJSON(logKey(), { at: Date.now(), actor, action, detail: String(detail).slice(0, 300) });
    if (Math.random() < 0.05) {
      const { blobs } = await store.list({ prefix: 'logs/' });
      const old = blobs.map((b) => b.key).sort().slice(LOG_KEEP);
      await Promise.all(old.map((k) => store.delete(k)));
    }
  } catch (err) {
    console.error('log failed', err.message);
  }
}

// 운영자 요청 → 사람이 읽는 한 줄 (비밀번호 같은 값은 남기지 않음)
function describeAdminAction(route, b, r) {
  const who = (x) => String(x || '').slice(0, 20);
  switch (route) {
    case 'POST /admin/grant': {
      const target = b.all ? '전체 길드원' : (Array.isArray(b.ids) ? b.ids : [b.id]).map(who).join(', ');
      const n = Number(b.amount);
      return [n > 0 ? '로또권 지급' : '로또권 회수', `${target} · ${n > 0 ? '+' : ''}${n}장${b.reason ? ` · ${b.reason}` : ''}`];
    }
    case 'POST /admin/clear-tickets': return ['로또권 전체 삭제', '모든 길드원 로또권 0장'];
    case 'POST /admin/reset-password': return ['비밀번호 초기화', who(b.id)];
    case 'POST /admin/rename-user': return ['닉네임 변경', `${who(b.id)} → ${who(b.newId)}${b.password ? ' (비밀번호도 변경)' : ''}`];
    case 'POST /admin/delete-user': return ['계정 삭제', who(b.id)];
    case 'POST /admin/user-discord': return ['디스코드 ID 설정', `${who(b.id)} · ${b.discordId ? '등록' : '해제'}`];
    case 'POST /admin/round/open': return ['회차 시작', `제${r?.round?.no ?? '?'}회`];
    case 'POST /admin/round/prizes': return ['상품 변경', ''];
    case 'POST /admin/round/schedule': return ['응모 기간 변경', b.startAt || b.endAt ? '기간 설정' : '기간 해제'];
    case 'POST /admin/round/draw': return ['추첨', `제${r?.round?.no ?? '?'}회 · 당첨 ${r?.round?.winners?.length ?? 0}줄`];
    case 'POST /admin/round/reset': return ['회차 초기화', '모든 회차·응모 기록 삭제'];
    case 'POST /admin/notices': return ['공지 작성', String(b.title || '').slice(0, 60)];
    case 'POST /admin/notices/edit': return ['공지 수정', String(b.title || '').slice(0, 60)];
    case 'POST /admin/notices/delete': return ['공지 삭제', ''];
    case 'POST /admin/notices/discord': return ['공지 디코로 보내기', String(r?.notice?.title || '').slice(0, 60)];
    case 'POST /admin/scheduled': return ['예약 공지 등록', `${String(b.title || '').slice(0, 40)} · ${r?.scheduled?.repeat ? `매주 ${r.scheduled.repeat.days.map((d) => '일월화수목금토'[d]).join('·')} ${r.scheduled.repeat.time}` : `${r?.scheduled?.times?.length ?? 0}번`}`];
    case 'POST /admin/scheduled/delete': return ['예약 공지 취소', ''];
    case 'POST /admin/scheduled/remove-time': return ['예약 날짜 빼기', ''];
    case 'POST /admin/requests/approve': return ['로또권 신청 승인', who(b.user)];
    case 'POST /admin/requests/reject': return ['로또권 신청 거절', who(b.user)];
    case 'POST /admin/games/reset': return ['미니게임 순위 초기화', GAMES[b.game]?.name || ''];
    case 'POST /admin/blackjack': return [b.enabled === undefined ? '블랙잭 설정' : b.enabled ? '카지노 열기' : '카지노 닫기', b.closedMessage || ''];
    case 'POST /admin/raid': return ['레이드 설정', b.enabled === undefined ? '' : b.enabled ? '켬' : '끔'];
    case 'POST /admin/raid/reset': return ['레이드 초기화', b.keepLevel ? '현재 단계 다시' : '1단계부터'];
    case 'POST /admin/settings': return ['사이트 설정 변경', b.autoWinnerNotice === undefined ? '' : `1등 자동 공지 ${b.autoWinnerNotice ? '켬' : '끔'}`];
    case 'POST /admin/discord': return ['디스코드 설정 변경', b.botToken ? '봇 토큰 저장' : b.webhookUrl ? '웹후크 저장' : b.couponWebhookUrl ? '쿠폰 채널 웹후크 저장' : b.couponWebhookUrl === '' ? '쿠폰 채널 연결 해제' : ''];
    case 'POST /admin/discord/send': return ['디스코드로 글 보내기', `${b.target === 'dm' ? '개인 DM' : '채널'} · ${String(b.title || b.message || '').slice(0, 40)}`];
    case 'POST /admin/restore': return ['백업 복원', `${r?.restored ?? 0}개 항목`];
    case 'POST /admin/coupons': return ['쿠폰 만들기', `${r?.coupon?.code ?? ''} · ${b.amount}장${Number(b.maxUses) ? ` · 선착순 ${b.maxUses}명` : ''}${r?.posted ? ' · 쿠폰 채널에 올림' : ''}`];
    case 'POST /admin/coupons/delete': return ['쿠폰 삭제', cleanCode(b.code)];
    case 'POST /admin/coupons/post': return ['쿠폰 채널에 올리기', cleanCode(b.code)];
    case 'POST /admin/coupons/board': return [b.board ? '사이트 쿠폰 채널에 올리기' : '사이트 쿠폰 채널에서 내리기', cleanCode(b.code)];
    case 'POST /admin/events': return ['일정 등록', `${b.date} ${String(b.title || '').slice(0, 40)}`];
    case 'POST /admin/events/edit': return ['일정 수정', `${b.date} ${String(b.title || '').slice(0, 40)}`];
    case 'POST /admin/events/delete': return ['일정 삭제', ''];
    default: return null; // 테스트·조회성 요청은 남기지 않음
  }
}

async function logAdminAction(store, route, body, result) {
  const d = describeAdminAction(route, body || {}, result);
  if (d) await addLog(store, '운영자', d[0], d[1]);
}

async function listLogs(store) {
  const { blobs } = await store.list({ prefix: 'logs/' });
  const keys = blobs.map((b) => b.key).sort().slice(0, 300);
  const logs = (await Promise.all(keys.map((k) => store.get(k, { type: 'json' })))).filter(Boolean);
  return { logs, total: blobs.length };
}

// ---------- 통계 ----------
async function adminStats(store) {
  const meta = await store.get('meta', { type: 'json' });
  const users = await listJSON(store, 'users/');
  const now = Date.now();
  const week = 7 * 86400000;
  const n = meta?.round || 0;
  const nos = Array.from({ length: Math.min(n, 60) }, (_, i) => n - i);
  const rounds = (await Promise.all(nos.map(async (no) => {
    const r = await store.get(`rounds/${no}`, { type: 'json' });
    if (!r) return null;
    const entries = await listJSON(store, `entries/${no}/`);
    const byRank = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const w of r.winners || []) byRank[w.rank] = (byRank[w.rank] || 0) + 1;
    return {
      no, status: r.status, openedAt: r.openedAt, drawnAt: r.drawnAt || null,
      lines: entries.length, people: new Set(entries.map((e) => e.user)).size,
      auto: entries.filter((e) => e.auto).length, winners: (r.winners || []).length, byRank,
    };
  }))).filter(Boolean);
  const granted = users.reduce((t, u) => t + (u.history || []).filter((h) => h.delta > 0 && !/환불$/.test(h.reason)).reduce((a, h) => a + h.delta, 0), 0);
  return {
    members: {
      total: users.length,
      discord: users.filter((u) => u.discordId).length,
      joinedWeek: users.filter((u) => now - (u.createdAt || 0) < week).length,
      activeWeek: users.filter((u) => now - (u.lastLoginAt || 0) < week).length,
    },
    tickets: { held: users.reduce((t, u) => t + (u.tickets || 0), 0), grantedRecent: granted },
    totals: {
      rounds: rounds.length,
      lines: rounds.reduce((t, r) => t + r.lines, 0),
      winners: rounds.reduce((t, r) => t + r.winners, 0),
      firsts: rounds.reduce((t, r) => t + r.byRank[1], 0),
    },
    rounds,
  };
}

// ---------- 백업 · 복원 ----------
// 비밀값(봇 토큰·웹후크·서명 키)은 빼고 길드 데이터만 담는다.
const BACKUP_PREFIXES = ['users/', 'rounds/', 'entries/', 'notices/', 'requests/', 'avatars/', 'logs/', 'coupons/', 'events/', 'scheduled/', 'games/', 'blackjack/', 'bjlog/', 'bjduel/', 'raid/'];
const BACKUP_SINGLE = ['meta', 'config/site', 'config/blackjack', 'config/raid'];

async function makeBackup(store) {
  const data = {};
  for (const prefix of BACKUP_PREFIXES) {
    const { blobs } = await store.list({ prefix });
    const docs = await Promise.all(blobs.map(async (b) => [b.key, await store.get(b.key, { type: 'json' })]));
    for (const [k, v] of docs) if (v !== null) data[k] = v;
  }
  for (const k of BACKUP_SINGLE) {
    const v = await store.get(k, { type: 'json' });
    if (v !== null) data[k] = v;
  }
  return { app: 'crystal-guild', version: 1, createdAt: Date.now(), count: Object.keys(data).length, data };
}

async function restoreBackup(store, body) {
  const b = body.backup;
  if (!b || b.app !== 'crystal-guild' || typeof b.data !== 'object') throw new HttpError(400, '크리스탈 길드 백업 파일이 아니에요.');
  const keys = Object.keys(b.data);
  const ok = (k) => BACKUP_SINGLE.includes(k) || BACKUP_PREFIXES.some((p) => k.startsWith(p));
  if (!keys.length || keys.some((k) => !ok(k) || k.includes('..'))) throw new HttpError(400, '백업 파일에 알 수 없는 항목이 있어요.');
  // 지금 데이터를 지우고 백업 내용으로 바꾼다 (설정·비밀값은 그대로)
  for (const prefix of BACKUP_PREFIXES) {
    const { blobs } = await store.list({ prefix });
    await Promise.all(blobs.map((x) => store.delete(x.key)));
  }
  for (const k of BACKUP_SINGLE) await store.delete(k);
  for (let i = 0; i < keys.length; i += 20) {
    await Promise.all(keys.slice(i, i + 20).map((k) => store.setJSON(k, b.data[k])));
  }
  return { ok: true, restored: keys.length };
}

async function adminRoute(store, route, body) {
  switch (route) {
    case 'GET /admin/overview': return adminOverview(store);
    case 'GET /admin/coupons': return listCoupons(store);
    case 'POST /admin/coupons': return createCoupon(store, body);
    case 'POST /admin/coupons/delete': return deleteCoupon(store, body);
    case 'POST /admin/coupons/post': return announceCoupon(store, body);
    case 'POST /admin/coupons/board': return setCouponBoard(store, body);
    case 'POST /admin/discord/coupon-test': return testCouponChannel(store);
    case 'POST /admin/events': return createEvent(store, body);
    case 'POST /admin/events/edit': return editEvent(store, body);
    case 'POST /admin/events/delete': return deleteEvent(store, body);
    case 'GET /admin/logs': return listLogs(store);
    case 'GET /admin/stats': return adminStats(store);
    case 'GET /admin/backup': return makeBackup(store);
    case 'POST /admin/restore': return restoreBackup(store, body);
    case 'POST /admin/requests/approve': return approveRequest(store, body);
    case 'POST /admin/requests/reject': return rejectRequest(store, body);
    case 'POST /admin/settings': return saveSiteSettings(store, body);
    case 'POST /admin/games/reset': return resetGame(store, body);
    case 'GET /admin/blackjack': return adminBj(store);
    case 'POST /admin/blackjack': return saveBjConfig(store, body);
    case 'GET /admin/raid': return adminRaid(store);
    case 'POST /admin/raid': return saveRaidConfig(store, body);
    case 'POST /admin/raid/reset': return resetRaid(store, body);
    case 'POST /admin/grant': return grant(store, body);
    case 'POST /admin/reset-password': return resetPassword(store, body);
    case 'POST /admin/rename-user': return renameUser(store, body);
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
    case 'POST /admin/notices/discord': return sendNoticeToDiscord(store, body);
    case 'GET /admin/scheduled': return listScheduled(store);
    case 'POST /admin/scheduled': return createScheduled(store, body);
    case 'POST /admin/scheduled/delete': return deleteScheduled(store, body);
    case 'POST /admin/scheduled/remove-time': return removeScheduledTime(store, body);
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
  return undefined;
}

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
  const avatarMatch = path.match(/^\/avatar\/([^/]+)$/);
  if (method === 'GET' && avatarMatch) return getAvatar(store, decodeURIComponent(avatarMatch[1]));
  const roundMatch = path.match(/^\/(admin\/)?rounds\/(\d+)\/entries$/);
  const gameMatch = path.match(/^\/games\/([a-z0-9]+)$/);
  if (route === 'GET /raid') return raidInfo(store, await requireUser(store, req).catch(() => null));
  if (method === 'GET' && gameMatch) {
    const user = await requireUser(store, req).catch(() => null); // 로그인 안 해도 순위는 보임
    return gameBoard(store, gameMatch[1], user);
  }

  switch (route) {
    case 'POST /signup': return signup(store, body);
    case 'POST /login': return login(store, body);
    case 'POST /admin/login': return adminLogin(store, body);
    case 'GET /me': return myInfo(store, await requireUser(store, req));
    case 'POST /enter': return enter(store, await requireUser(store, req), body);
    case 'POST /me/discord': return setMyDiscord(store, await requireUser(store, req), body);
    case 'POST /me/request': return myRequest(store, await requireUser(store, req), body);
    case 'POST /me/password': return changeMyPassword(store, await requireUser(store, req), body);
    case 'POST /me/rename': return renameMe(store, await requireUser(store, req), body);
    case 'POST /me/coupon': return redeemCoupon(store, await requireUser(store, req), body);
    case 'GET /me/coupons': return myCoupons(store, await requireUser(store, req));
    case 'POST /me/events/rsvp': return rsvpEvent(store, await requireUser(store, req), body);
    case 'POST /me/games/score': return submitGameScore(store, await requireUser(store, req), body);
    case 'GET /me/blackjack': return bjInfo(store, await requireUser(store, req));
    case 'POST /me/blackjack/start': return bjStart(store, await requireUser(store, req), body);
    case 'POST /me/blackjack/hit': return bjMove(store, await requireUser(store, req), 'hit');
    case 'POST /me/blackjack/stand': return bjMove(store, await requireUser(store, req), 'stand');
    case 'POST /me/blackjack/double': return bjMove(store, await requireUser(store, req), 'double');
    case 'POST /me/raid/start': return raidStart(store, await requireUser(store, req));
    case 'POST /me/raid/finish': return raidFinish(store, await requireUser(store, req), body);
    case 'GET /me/duels': return duelLobby(store, await requireUser(store, req));
    case 'POST /me/duels': return duelCreate(store, await requireUser(store, req), body);
    case 'POST /me/duels/join': return duelJoin(store, await requireUser(store, req), body);
    case 'POST /me/duels/cancel': return duelCancel(store, await requireUser(store, req), body);
    case 'POST /me/duels/hit': return duelMove(store, await requireUser(store, req), body, 'hit');
    case 'POST /me/duels/stand': return duelMove(store, await requireUser(store, req), body, 'stand');
    case 'GET /casino': { const c = await bjConfig(store); return { open: c.enabled, message: c.enabled ? '' : c.closedMessage }; }
    case 'GET /ranking': return ranking(store);
    case 'GET /events': return listEvents(store);
    case 'POST /me/avatar': return setMyAvatar(store, await requireUser(store, req), body);
    case 'POST /me/avatar/remove': return removeMyAvatar(store, await requireUser(store, req));
    case 'GET /me/records': return myRecords(store, await requireUser(store, req));
    case 'POST /me/request/cancel': return cancelMyRequest(store, await requireUser(store, req));
    case 'GET /history': return history(store);
    case 'GET /stats': return publicStats(store);
    case 'GET /notices': {
      await publishScheduledNotices(store).catch((err) => console.error('scheduled notices', err.message));
      return listNotices(store);
    }
    case 'POST /bot/command': return botCommand(store, req, body);
  }
  if (method === 'GET' && roundMatch && !roundMatch[1]) {
    return myRoundEntries(store, await requireUser(store, req), Number(roundMatch[2]));
  }

  if (path.startsWith('/admin/')) {
    await requireAdmin(store, req);
    if (method === 'GET' && roundMatch) return roundEntries(store, Number(roundMatch[2]));
    const result = await adminRoute(store, route, body);
    if (result === undefined) throw new HttpError(404, '존재하지 않는 API입니다.');
    if (method === 'POST') await logAdminAction(store, route, body, result);
    return result;
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
