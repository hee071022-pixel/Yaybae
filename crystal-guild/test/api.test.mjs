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
  // 로또권 전체 삭제 / 회차 초기화
  await call('POST', '/admin/grant', { all: true, amount: 3 }, admin);
  assert.equal((await call('POST', '/admin/clear-tickets', {}, u1)).status, 401);
  assert.equal((await call('POST', '/admin/clear-tickets', {}, admin)).status, 200);
  assert.ok((await call('GET', '/admin/overview', null, admin)).data.users.every((u) => u.tickets === 0));
  assert.equal((await call('POST', '/admin/round/reset', {}, admin)).status, 200);
  let ov = (await call('GET', '/admin/overview', null, admin)).data;
  assert.equal(ov.round, null);
  assert.equal((await call('GET', '/history')).data.rounds.length, 0);
  assert.equal((await call('POST', '/admin/round/open', {}, admin)).data.round.no, 1);
  assert.equal((await call('GET', '/admin/rounds/1/entries', null, admin)).data.entries.length, 0);

  // 공지사항
  assert.equal((await call('POST', '/admin/notices', { title: '공지' }, u1)).status, 401);
  assert.equal((await call('POST', '/admin/notices', { title: '' }, admin)).status, 400);
  const n1 = (await call('POST', '/admin/notices', { title: '첫 공지', body: '내용' }, admin)).data.notice;
  const n2 = (await call('POST', '/admin/notices', { title: '고정 공지', pinned: true }, admin)).data.notice;
  let ns = (await call('GET', '/notices')).data.notices;
  assert.deepEqual(ns.map((n) => n.id), [n2.id, n1.id]);
  await call('POST', '/admin/notices/edit', { id: n1.id, title: '수정됨', body: 'x', pinned: false }, admin);
  await call('POST', '/admin/notices/delete', { id: n2.id }, admin);
  ns = (await call('GET', '/notices')).data.notices;
  assert.equal(ns.length, 1);
  assert.equal(ns[0].title, '수정됨');

  // ---------- 디스코드 ----------
  const realFetch = globalThis.fetch;
  const sent = [];
  let memberOf = true;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('http://localhost')) return realFetch(url, opts);
    if (u.includes('/api/webhooks/')) { sent.push(JSON.parse(opts.body)); return new Response('{}', { status: 200 }); }
    if (u.endsWith('/oauth2/token')) return Response.json({ access_token: 'at' });
    if (u.endsWith('/users/@me')) return Response.json({ id: '111122223333444455', username: 'crystal_kim', global_name: '크리스탈 김' });
    if (u.includes('/users/@me/guilds/')) return memberOf ? Response.json({ nick: '수정단장' }) : new Response('', { status: 404 });
    throw new Error('unexpected fetch ' + u);
  };
  try {
    assert.equal((await call('GET', '/config')).data.discordLogin, false);
    assert.equal((await call('GET', '/admin/discord', null, u1)).status, 401);
    let ds = (await call('GET', '/admin/discord', null, admin)).data;
    assert.equal(ds.guildId, '1176515670624698418');
    assert.equal((await call('POST', '/admin/discord', { webhookUrl: 'https://evil.com/x' }, admin)).status, 400);
    const hook = 'https://discord.com/api/webhooks/123456789/abcDEF_ghi-jkl';
    ds = (await call('POST', '/admin/discord', { webhookUrl: hook, clientId: '123456789012345678', clientSecret: 'sekret' }, admin)).data;
    assert.ok(ds.webhookSet && ds.secretSet && ds.loginReady);
    assert.ok(!JSON.stringify(ds).includes('sekret') && !JSON.stringify(ds).includes('abcDEF_ghi-jkl'));
    assert.equal((await call('GET', '/config')).data.discordLogin, true);

    // 알림: 테스트, 공지, 회차 시작, 추첨
    assert.equal((await call('POST', '/admin/discord/test', {}, admin)).status, 200);
    await call('POST', '/admin/notices', { title: '디코 공지', body: '본문' }, admin);
    await call('POST', '/admin/round/draw', {}, admin);
    await call('POST', '/admin/round/open', { prizes: { 1: '크리스탈' } }, admin);
    const titles = sent.map((m) => m.content || m.embeds[0].title);
    assert.equal(titles.length, 4, JSON.stringify(titles));
    assert.ok(titles[1] === '디코 공지' && /추첨 결과/.test(titles[2]) && /응모 시작/.test(titles[3]));
    // 알림 끄기
    await call('POST', '/admin/discord', { notify: { notice: false, open: true, draw: true } }, admin);
    await call('POST', '/admin/notices', { title: '조용한 공지' }, admin);
    assert.equal(sent.length, 4);

    // 디스코드 로그인
    const start = await respond(new Request('http://x/api/discord/login'), store);
    assert.equal(start.status, 302);
    const loc = new URL(start.headers.get('location'));
    assert.equal(loc.host, 'discord.com');
    assert.equal(loc.searchParams.get('redirect_uri'), 'http://x/api/discord/callback');
    const nonce = start.headers.get('set-cookie').match(/dstate=([^;]+)/)[1];
    const cb = (state, cookie) => respond(new Request(`http://x/api/discord/callback?code=c&state=${state}`, { headers: { cookie: `dstate=${cookie}` } }), store);
    const bad = await cb('wrong', nonce);
    assert.match(bad.headers.get('location'), /#login_error=/);
    const ok = await cb(loc.searchParams.get('state'), nonce);
    const token = ok.headers.get('location').match(/#login=(.+)$/)[1];
    let me = await call('GET', '/me', null, token);
    assert.equal(me.data.user.id, '수정단장');
    assert.equal(me.data.user.discord.id, '111122223333444455');
    // 다시 로그인하면 같은 계정
    const ok2 = await cb(loc.searchParams.get('state'), nonce);
    me = await call('GET', '/me', null, ok2.headers.get('location').match(/#login=(.+)$/)[1]);
    assert.equal(me.data.user.id, '수정단장');
    assert.equal((await call('GET', '/admin/overview', null, admin)).data.users.filter((x) => x.discord).length, 1);
    // 비밀번호 로그인은 불가
    assert.equal((await call('POST', '/login', { id: '수정단장', password: 'anything' })).status, 401);
    // 서버 멤버가 아니면 거절
    memberOf = false;
    await store.delete('discord/111122223333444455');
    const denied = await cb(loc.searchParams.get('state'), nonce);
    assert.match(decodeURIComponent(denied.headers.get('location')), /멤버만/);
    // 삭제하면 연결도 지워짐
    memberOf = true;
    await store.setJSON('discord/111122223333444455', { userId: '수정단장' });
    await call('POST', '/admin/delete-user', { id: '수정단장' }, admin);
    assert.equal(await store.get('discord/111122223333444455'), null);
  } finally {
    globalThis.fetch = realFetch;
  }

  // 환경 변수가 없을 때: 처음 입력한 비밀번호가 운영자 비밀번호가 됨
  delete process.env.ADMIN_PASSWORD;
  assert.equal((await call('POST', '/admin/login', { id: 'admin', password: 'short' })).status, 400);
  assert.equal((await call('POST', '/admin/login', { id: 'admin', password: 'first-pass-123' })).status, 200);
  assert.equal((await call('POST', '/admin/login', { id: 'admin', password: 'other-pass-123' })).status, 401);
  assert.equal((await call('POST', '/admin/login', { id: 'admin', password: 'first-pass-123' })).status, 200);
  console.log('all tests passed');
} finally {
  await server.stop();
  await rm(dir, { recursive: true, force: true });
}
