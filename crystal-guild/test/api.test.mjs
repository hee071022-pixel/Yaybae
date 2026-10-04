// 로컬 Blobs 서버로 API 전체 흐름을 검사한다: node test/api.test.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { respond, rankOf, drawMessage, periodText, autoDrawIfDue } from '../netlify/functions/api.mjs';

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
  // 추첨 알림: 당첨자 멘션
  const dm = drawMessage({ no: 3, numbers: [1, 2, 3, 4, 5, 6], bonus: 7, entryCount: 9, drawnAt: 0, prizes: {},
    winners: [{ rank: 1, user: 'a', numbers: [] }] }, ['123456789012345678', '123456789012345678']);
  assert.equal(dm.content, '<@123456789012345678>');
  assert.deepEqual(dm.allowed_mentions, { parse: [], users: ['123456789012345678'] });
  assert.equal(drawMessage({ no: 3, numbers: [1, 2, 3, 4, 5, 6], bonus: 7, entryCount: 0, drawnAt: 0, winners: [] }).content, undefined);

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

  // ---------- 응모 기간 ----------
  {
    // 진행 중인 회차 정리 후 새로 시작
    const cur = (await call('GET', '/admin/overview', null, admin)).data.round;
    if (cur && cur.status !== 'drawn') await call('POST', '/admin/round/draw', {}, admin);
    const now = Date.now();
    assert.equal((await call('POST', '/admin/round/open', { startAt: now + 60000, endAt: now + 30000 }, admin)).status, 400);
    assert.equal((await call('POST', '/admin/round/open', { endAt: now - 1000 }, admin)).status, 400);
    const opened = await call('POST', '/admin/round/open', { startAt: now + 3600000, endAt: now + 7200000 }, admin);
    assert.equal(opened.status, 200, JSON.stringify(opened.data));
    assert.equal(opened.data.round.autoDraw, true);
    const tk = (await call('POST', '/signup', { id: '시간테스트', password: 'pass1234' })).data.token;
    await call('POST', '/admin/grant', { ids: ['시간테스트'], amount: 5 }, admin);
    let r = await call('POST', '/enter', { lines: ['auto'] }, tk);
    assert.equal(r.status, 400);
    assert.match(r.data.error, /시작 전/);
    // 기간을 지금부터 1.5초 뒤까지로 바꿈
    const s2 = await call('POST', '/admin/round/schedule', { startAt: now - 1000, endAt: Date.now() + 1500 }, admin);
    assert.equal(s2.status, 200, JSON.stringify(s2.data));
    r = await call('POST', '/enter', { lines: ['auto', 'auto'] }, tk);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    await new Promise((res) => setTimeout(res, 1700));
    // 마감 후 응모 불가 + 조회하면 자동 추첨
    const me = (await call('GET', '/me', null, tk)).data;
    assert.equal(me.round.status, 'drawn');
    assert.equal(me.round.entryCount, 2);
    assert.equal(await autoDrawIfDue(store), null); // 두 번 추첨되지 않음
    // 자동 추첨 끄면 마감 후에도 추첨 안 함 (운영자가 직접)
    const o3 = await call('POST', '/admin/round/open', { endAt: Date.now() + 800, autoDraw: false }, admin);
    assert.equal(o3.data.round.autoDraw, false);
    await new Promise((res) => setTimeout(res, 1000));
    assert.equal((await call('GET', '/me', null, tk)).data.round.status, 'open');
    r = await call('POST', '/enter', { lines: ['auto'] }, tk);
    assert.match(r.data.error, /마감/);
    await call('POST', '/admin/round/draw', {}, admin);
    // 기간 없는 회차도 그대로 동작
    const o4 = await call('POST', '/admin/round/open', {}, admin);
    assert.equal(o4.data.round.startAt, null);
    assert.equal(periodText({}), '');
    assert.match(periodText({ startAt: 1759579200000, endAt: 1759582800000, autoDraw: true }), /<t:1759579200:F> ~ <t:1759582800:F>\n마감되면 자동/);
  }

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
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('http://localhost')) return realFetch(url, opts);
    if (u.includes('/api/webhooks/')) { sent.push(JSON.parse(opts.body)); return new Response('{}', { status: 200 }); }
    throw new Error('unexpected fetch ' + u);
  };
  try {
    assert.equal((await call('GET', '/admin/discord', null, u1)).status, 401);
    let ds = (await call('GET', '/admin/discord', null, admin)).data;
    assert.equal((await call('POST', '/admin/discord', { webhookUrl: 'https://evil.com/x' }, admin)).status, 400);
    const hook = 'https://discord.com/api/webhooks/123456789/abcDEF_ghi-jkl';
    ds = (await call('POST', '/admin/discord', { webhookUrl: hook }, admin)).data;
    assert.ok(ds.webhookSet);
    assert.ok(!JSON.stringify(ds).includes('abcDEF_ghi-jkl'));

    // 알림: 테스트, 공지, 회차 시작, 추첨
    assert.equal((await call('POST', '/admin/discord/test', {}, admin)).status, 200);
    await call('POST', '/admin/notices', { title: '디코 공지', body: '본문' }, admin);
    await call('POST', '/admin/round/draw', {}, admin);
    await call('POST', '/admin/round/open', { prizes: { 1: '크리스탈' } }, admin);
    assert.equal(sent.at(-2).content, undefined); // 당첨자 없거나 디코 ID 없음 → 멘션 없음
    const titles = sent.map((m) => m.content || m.embeds[0].title);
    assert.equal(titles.length, 4, JSON.stringify(titles));
    assert.ok(titles[1] === '디코 공지' && /추첨 결과/.test(titles[2]) && /응모 시작/.test(titles[3]));
    // 공지마다 디스코드 전송 끄기 / 공지 멘션
    await call('POST', '/admin/notices', { title: '사이트만 공지', discord: false }, admin);
    assert.equal(sent.length, 4);
    assert.equal((await call('POST', '/admin/discord', { noticeMention: 'nope' }, admin)).status, 400);
    await call('POST', '/admin/discord', { noticeMention: 'everyone' }, admin);
    await call('POST', '/admin/notices', { title: '전체 공지' }, admin);
    assert.equal(sent.at(-1).content, '@everyone');
    assert.deepEqual(sent.at(-1).allowed_mentions, { parse: ['everyone'] });
    // 운영실에서 직접 보내기
    assert.equal((await call('POST', '/admin/discord/send', { message: '' }, admin)).status, 400);
    assert.equal((await call('POST', '/admin/discord/send', { message: 'x' }, u1)).status, 401);
    assert.equal((await call('POST', '/admin/discord/send', { title: '오늘 레이드', message: '21시 집합', mention: 'here' }, admin)).status, 200);
    assert.equal(sent.at(-1).content, '@here');
    assert.equal(sent.at(-1).embeds[0].title, '오늘 레이드');
    await call('POST', '/admin/discord/send', { message: '멘션 없음' }, admin);
    assert.equal(sent.at(-1).content, undefined);
    assert.deepEqual(sent.at(-1).allowed_mentions, { parse: [] });
    // 특정 유저 멘션
    const u1b = (await call('POST', '/login', { id: '수정이', password: 'newpw' })).data.token;
    assert.equal((await call('POST', '/me/discord', { discordId: 'abc' }, u1b)).status, 400);
    const myId = '123456789012345678';
    assert.equal((await call('POST', '/me/discord', { discordId: myId }, u1b)).data.user.discordId, myId);
    assert.equal((await call('POST', '/admin/discord/send', { message: 'x', users: ['12'] }, admin)).status, 400);
    await call('POST', '/admin/discord/send', { message: '호출', users: [myId, '223456789012345678'], mention: 'here' }, admin);
    assert.equal(sent.at(-1).content, `@here <@${myId}> <@223456789012345678>`);
    assert.deepEqual(sent.at(-1).allowed_mentions, { parse: ['everyone'], users: [myId, '223456789012345678'] });
    await call('POST', '/admin/discord/send', { message: '한명만', users: [myId] }, admin);
    assert.deepEqual(sent.at(-1).allowed_mentions, { parse: [], users: [myId] });
    // 운영자가 길드원 디코 ID 수정
    await call('POST', '/admin/user-discord', { id: '수정이', discordId: '' }, admin);
    assert.equal((await call('GET', '/me', null, u1b)).data.user.discordId, '');
    await call('POST', '/admin/user-discord', { id: '수정이', discordId: myId }, admin);
    sent.length = 4;

    // 알림 끄기
    await call('POST', '/admin/discord', { notify: { notice: false, open: true, draw: true } }, admin);
    await call('POST', '/admin/notices', { title: '조용한 공지' }, admin);
    assert.equal(sent.length, 4);

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
