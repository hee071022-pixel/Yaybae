// 로컬 Blobs 서버로 API 전체 흐름을 검사한다: node test/api.test.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { respond, rankOf } from '../netlify/functions/api.mjs';

process.env.ADMIN_PASSWORD = 'crystal-admin';
const dir = await mkdtemp(join(tmpdir(), 'blobs-'));
const server = new BlobsServer({ directory: dir, token: 'tok' });
const { port } = await server.start();
const store = getStore({ name: 'crystal-guild', siteID: 'site', token: 'tok', edgeURL: `http://localhost:${port}`, uncachedEdgeURL: `http://localhost:${port}`, consistency: 'strong' });

async function call(method, path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await respond(new Request(`http://x/api${path}`, { method, headers, body: body && JSON.stringify(body) }), store);
  return { status: res.status, data: await res.json() };
}

try {
  // 규칙
  assert.equal(rankOf([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], 7), 1);
  assert.equal(rankOf([1, 2, 3, 4, 5, 7], [1, 2, 3, 4, 5, 6], 7), 2);
  assert.equal(rankOf([1, 2, 3, 4, 5, 8], [1, 2, 3, 4, 5, 6], 7), 3);
  assert.equal(rankOf([1, 2, 3, 4, 9, 8], [1, 2, 3, 4, 5, 6], 7), 4);
  assert.equal(rankOf([1, 2, 3, 10, 9, 8], [1, 2, 3, 4, 5, 6], 7), 5);
  assert.equal(rankOf([1, 2, 11, 10, 9, 8], [1, 2, 3, 4, 5, 6], 7), 0);

  // 가입/로그인
  const s1 = await call('POST', '/signup', { id: '수정이', password: 'pass1' });
  assert.equal(s1.status, 200, JSON.stringify(s1.data));
  assert.equal((await call('POST', '/signup', { id: '수정이', password: 'x1234' })).status, 409);
  assert.equal((await call('POST', '/signup', { id: 'admin', password: 'x1234' })).status, 400);
  assert.equal((await call('POST', '/login', { id: '수정이', password: 'nope' })).status, 401);
  const u1 = (await call('POST', '/login', { id: '수정이', password: 'pass1' })).data.token;
  const u2 = (await call('POST', '/signup', { id: 'Amethyst', password: 'pass2' })).data.token;

  // 운영자 권한
  assert.equal((await call('POST', '/admin/login', { id: 'admin', password: 'wrong' })).status, 401);
  assert.equal((await call('GET', '/admin/overview', null, u1)).status, 401);
  const admin = (await call('POST', '/admin/login', { id: 'admin', password: 'crystal-admin' })).data.token;
  assert.ok(admin);

  // 회차 없을 때 응모 불가
  assert.equal((await call('POST', '/admin/grant', { id: '수정이', amount: 3 }, admin)).status, 200);
  assert.equal((await call('POST', '/enter', { lines: ['auto'] }, u1)).status, 400);

  // 회차 열기, 지급, 응모
  const open = await call('POST', '/admin/round/open', { prizes: { 1: '크리스탈 1000개' } }, admin);
  assert.equal(open.data.round.no, 1);
  assert.equal((await call('POST', '/admin/round/open', {}, admin)).status, 400);
  await call('POST', '/admin/grant', { all: true, amount: 2, reason: '출석 보상' }, admin);
  let me = (await call('GET', '/me', null, u1)).data;
  assert.equal(me.user.tickets, 5);
  assert.equal(me.user.history[0].reason, '출석 보상');

  assert.equal((await call('POST', '/enter', { lines: [[1, 2, 3, 4, 5, 5]] }, u1)).status, 400);
  assert.equal((await call('POST', '/enter', { lines: [[1, 2, 3, 4, 5, 46]] }, u1)).status, 400);
  const e = await call('POST', '/enter', { lines: [[6, 5, 4, 3, 2, 1], 'auto', { auto: true }] }, u1);
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal(e.data.user.tickets, 2);
  assert.equal(e.data.entries.length, 3);
  assert.deepEqual(e.data.entries[0].numbers, [1, 2, 3, 4, 5, 6]);
  assert.equal((await call('POST', '/enter', { lines: ['auto', 'auto', 'auto'] }, u2)).status, 400); // 2장뿐
  await call('POST', '/enter', { lines: ['auto', 'auto'] }, u2);

  // 회수는 0 밑으로 내려가지 않음
  await call('POST', '/admin/grant', { id: 'amethyst', amount: -5 }, admin);
  assert.equal((await call('GET', '/me', null, u2)).data.user.tickets, 0);

  // 추첨
  const drawn = await call('POST', '/admin/round/draw', {}, admin);
  assert.equal(drawn.status, 200, JSON.stringify(drawn.data));
  assert.equal(drawn.data.round.numbers.length, 6);
  assert.equal(drawn.data.round.entryCount, 5);
  assert.equal((await call('POST', '/admin/round/draw', {}, admin)).status, 400);
  assert.equal((await call('POST', '/enter', { lines: ['auto'] }, u1)).status, 400);
  me = (await call('GET', '/me', null, u1)).data;
  assert.ok(me.entries.every((x) => typeof x.rank === 'number'));
  const hist = (await call('GET', '/history')).data;
  assert.equal(hist.rounds.length, 1);
  const all = (await call('GET', '/admin/rounds/1/entries', null, admin)).data;
  assert.equal(all.entries.length, 5);

  // 다음 회차는 이전 상품을 이어받음
  const open2 = await call('POST', '/admin/round/open', {}, admin);
  assert.equal(open2.data.round.no, 2);
  assert.equal(open2.data.round.prizes[1], '크리스탈 1000개');

  // 비밀번호 초기화 → 기존 토큰 무효
  await call('POST', '/admin/reset-password', { id: '수정이', password: 'newpw' }, admin);
  assert.equal((await call('GET', '/me', null, u1)).status, 401);
  assert.equal((await call('POST', '/login', { id: '수정이', password: 'newpw' })).status, 200);

  // 삭제
  await call('POST', '/admin/delete-user', { id: 'Amethyst' }, admin);
  assert.equal((await call('GET', '/me', null, u2)).status, 401);
  assert.equal((await call('GET', '/admin/overview', null, admin)).data.users.length, 1);

  // 위조 토큰
  assert.equal((await call('GET', '/admin/overview', null, admin.slice(0, -2) + 'xx')).status, 401);
  console.log('all tests passed');
} finally {
  await server.stop();
  await rm(dir, { recursive: true, force: true });
}
