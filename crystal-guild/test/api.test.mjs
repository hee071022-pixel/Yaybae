// 로컬 Blobs 서버로 API 전체 흐름을 검사한다: node test/api.test.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { respond, rankOf, drawMessage, drawCard, periodText, autoDrawIfDue, dmWinners, syncCommands } from '../netlify/functions/api.mjs';

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

  // 추첨 결과 카드
  const r3 = { no: 3, numbers: [1, 2, 3, 14, 25, 36], bonus: 7, entryCount: 9, drawnAt: 0, prizes: { 1: '크리스탈 1000개' },
    winners: [{ rank: 1, user: '하늘' }, { rank: 5, user: '바다' }, { rank: 5, user: '바다' }] };
  const card = drawCard(r3, ['123456789012345678']);
  assert.equal(card.flags, 1 << 15);
  assert.equal(card.components[0].content, '<@123456789012345678> 당첨을 축하합니다!');
  assert.deepEqual(card.allowed_mentions, { parse: [], users: ['123456789012345678'] });
  const box = card.components[1].components;
  assert.match(box[1].content, /`01` `02` `03` `14` `25` `36`  ＋  `07`/);
  assert.match(box[3].content, /\*\*1등\*\* · 크리스탈 1000개\n하늘/);
  assert.match(box[3].content, /\*\*5등\*\*\n바다 \(2줄\)/);
  assert.match(box.at(-1).components[0].url, /#results$/);
  assert.ok(card.fallback.embeds);
  const none = drawCard({ ...r3, winners: [] });
  assert.equal(none.components.length, 1);
  assert.match(none.components[0].components[3].content, /당첨자가 없습니다/);

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
  const dms = [];
  const registered = [];
  const limits = []; // 명령어 등록 PUT에 돌려줄 429 응답들
  let rejectCards = false; // 카드형 메시지를 거절하는 웹후크 흉내
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('http://localhost')) return realFetch(url, opts);
    if (u.includes('/api/webhooks/')) {
      const b = JSON.parse(opts.body);
      if (b.components && !u.includes('with_components=true')) return new Response('{}', { status: 400 });
      if (b.components && rejectCards) return new Response('{}', { status: 400 });
      sent.push(b);
      return new Response('{}', { status: 200 });
    }
    if (u.endsWith('/users/@me') && opts.headers?.authorization?.startsWith('Bot ')) return Response.json({ id: '999988887777666655', username: 'crystal_bot', global_name: '크리스탈 봇' });
    if (u.endsWith('/users/@me/channels')) {
      const rid = JSON.parse(opts.body).recipient_id;
      return rid === '400000000000000000' ? Response.json({ code: 50007 }, { status: 403 }) : Response.json({ id: 'dm-' + rid });
    }
    if (u.includes('/guilds/') && u.endsWith('/commands') && opts.method === 'PUT' && limits.length) return limits.shift()();
    if (u.includes('/guilds/') && u.endsWith('/commands') && opts.method === 'PUT') { registered.push({ url: u, cmds: JSON.parse(opts.body) }); return Response.json([]); }
    if (u.includes('/channels/dm-') && u.endsWith('/messages')) { dms.push({ to: u.split('/channels/dm-')[1].split('/')[0], body: JSON.parse(opts.body) }); return Response.json({ id: 'm1' }); }
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
    const titles = sent.map((m) => m.content || m.embeds?.[0].title || m.components[0].components[0].content);
    assert.equal(titles.length, 4, JSON.stringify(titles));
    assert.ok(titles[1] === '디코 공지' && /추첨 결과/.test(titles[2]) && /로또 시작/.test(titles[3]));
    // 회차 시작 카드: 사이트로 가는 링크 버튼, fallback은 웹후크로 안 보냄
    const card = sent.at(-1);
    assert.equal(card.flags, 1 << 15);
    assert.equal(card.fallback, undefined);
    const btn = card.components[0].components.at(-1).components[0];
    assert.equal(btn.style, 5);
    assert.match(btn.url, /^https:\/\/.+\/#event$/);
    // 카드형이 거절되는 웹후크면 일반 임베드로 다시 보냄
    rejectCards = true;
    await call('POST', '/admin/round/draw', {}, admin);
    await call('POST', '/admin/round/open', {}, admin);
    assert.match(sent.at(-1).embeds[0].title, /로또 시작/);
    assert.match(sent.at(-1).embeds[0].description, /응모하러 가기/);
    rejectCards = false;
    sent.length = 4;
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
    // ---------- 개인 DM (봇) ----------
    assert.match((await call('POST', '/admin/discord/send', { message: 'x', target: 'dm', users: [myId] }, admin)).data.error, /봇 토큰/);
    assert.equal((await call('POST', '/admin/discord', { botToken: 'nope' }, admin)).status, 400);
    const botToken = 'MTUzNDQ0MjQxNzIyNTQ2NTkzNg.GaBcDe.' + 'x'.repeat(38);
    const saved = (await call('POST', '/admin/discord', { botToken }, admin)).data;
    assert.ok(saved.botSet && !JSON.stringify(saved).includes(botToken));
    const bt = (await call('POST', '/admin/discord/bot-test', {}, admin)).data;
    assert.equal(bt.name, '크리스탈 봇');
    assert.match(bt.invite, /client_id=999988887777666655&scope=bot/);
    const sentBefore = sent.length;
    const dmRes = (await call('POST', '/admin/discord/send', { title: '공지', message: '개인 메시지', target: 'dm', users: [myId, '400000000000000000'] }, admin)).data;
    assert.deepEqual(dmRes.sent, ['수정이']);
    assert.equal(dmRes.failed.length, 1);
    assert.match(dmRes.failed[0].reason, /DM을 받을 수 없음/);
    assert.equal(sent.length, sentBefore); // 채널에는 안 감
    assert.equal(dms.at(-1).to, myId);
    assert.equal(dms.at(-1).body.embeds[0].description, '개인 메시지');
    // 로또권 지급 DM: 기본은 꺼짐 → 켜면 보냄
    let n = dms.length;
    await call('POST', '/admin/grant', { ids: ['수정이'], amount: 2, reason: '출석' }, admin);
    assert.equal(dms.length, n);
    await call('POST', '/admin/discord', { notify: { notice: true, open: true, draw: true, dmTickets: true } }, admin);
    const g = (await call('POST', '/admin/grant', { ids: ['수정이'], amount: 2, reason: '출석' }, admin)).data;
    assert.deepEqual(g.dm, { sent: 1, failed: 0 });
    assert.match(dms.at(-1).body.embeds[0].title, /로또권 2장/);
    // 당첨자 DM: 한 사람이 두 줄 당첨이면 DM 한 통
    n = dms.length;
    await dmWinners(store, { no: 7, numbers: [1, 2, 3, 4, 5, 6], bonus: 7, prizes: { 1: '크리스탈 1000개' },
      winners: [{ rank: 1, user: '수정이', numbers: [1, 2, 3, 4, 5, 6] }, { rank: 5, user: '수정이', numbers: [1, 2, 3, 9, 10, 11] }, { rank: 3, user: '없는사람', numbers: [] }] });
    assert.equal(dms.length, n + 1);
    assert.match(dms.at(-1).body.embeds[0].title, /제7회/);
    assert.match(dms.at(-1).body.embeds[0].description, /1등[\s\S]*크리스탈 1000개[\s\S]*5등/);
    // ---------- 슬래시 명령어 ----------
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pubHex = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');
    assert.equal((await call('POST', '/admin/discord', { publicKey: 'xyz' }, admin)).status, 400);
    const ds2 = (await call('POST', '/admin/discord', { publicKey: pubHex }, admin)).data;
    assert.equal(ds2.publicKey, pubHex);
    assert.equal(ds2.guildId, '1176515670624698418');
    const interact = async (payload, forge = false) => {
      const raw = JSON.stringify(payload);
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = sign(null, Buffer.from(ts + raw), privateKey).toString('hex');
      const res = await respond(new Request('https://crystal.example/api/discord/interactions', {
        method: 'POST', body: raw,
        headers: { 'x-signature-ed25519': forge ? sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a') : sig, 'x-signature-timestamp': ts },
      }), store);
      return { status: res.status, data: res.status === 200 ? await res.json() : null };
    };
    assert.equal((await interact({ type: 1 }, true)).status, 401);
    assert.deepEqual((await interact({ type: 1 })).data, { type: 1 });
    const site = (await interact({ type: 2, data: { name: '사이트' }, member: { user: { id: myId } } })).data;
    assert.equal(site.type, 4);
    assert.equal(site.data.embeds[0].url, 'https://crystal.example');
    const mine = (await interact({ type: 2, data: { name: '로또권' }, member: { user: { id: myId } } })).data;
    assert.equal(mine.data.flags, 64);
    assert.match(mine.data.content, /수정이.*\d+장/);
    const stranger = (await interact({ type: 2, data: { name: '로또권' }, member: { user: { id: '555555555555555555' } } })).data;
    assert.match(stranger.data.content, /디스코드 ID가 등록되어 있지 않아요/);
    const rnd = (await interact({ type: 2, data: { name: '회차' } })).data;
    assert.match(rnd.data.embeds?.[0]?.title || rnd.data.content, /회/);
    const win = (await interact({ type: 2, data: { name: '당첨번호' } })).data;
    assert.match(win.data.embeds[0].title, /추첨 결과/);
    // 명령어 등록: 봇 토큰 저장할 때 이미 자동으로 등록됨
    assert.match(registered.at(-1).url, /applications\/1534442417225465936\/guilds\/1176515670624698418\/commands$/);
    assert.equal(registered.at(-1).cmds.length, 1);
    let dsc = (await call('GET', '/admin/discord', null, admin)).data;
    assert.ok(dsc.commandsAt && !dsc.commandsError);
    // 이미 등록돼 있으면 예약 함수는 디스코드를 다시 부르지 않음
    let regCount = registered.length;
    assert.equal((await syncCommands(store)).skipped, 'done');
    assert.equal(registered.length, regCount);
    // 지금 등록 버튼
    const reg = (await call('POST', '/admin/discord/commands', {}, admin)).data;
    assert.deepEqual(reg.commands, ['/사이트']);
    // 429가 짧으면 바로 한 번 더 시도
    regCount = registered.length;
    limits.push(() => Response.json({ message: 'You are being rate limited.', retry_after: 0.2, global: false }, { status: 429 }));
    assert.equal((await call('POST', '/admin/discord/commands', {}, admin)).status, 200);
    assert.equal(registered.length, regCount + 1);
    // 길면 기다렸다가 예약 함수가 알아서 재시도 (그 사이엔 디스코드를 안 부름)
    limits.push(() => Response.json({ message: 'You are being rate limited.', retry_after: 95.5 }, { status: 429 }));
    let rl = await call('POST', '/admin/discord/commands', {}, admin);
    assert.equal(rl.status, 429);
    assert.match(rl.data.error, /96초 뒤에 한 번만/);
    dsc = (await call('GET', '/admin/discord', null, admin)).data;
    assert.ok(dsc.commandsRetryAt > Date.now() + 90_000 && dsc.commandsError);
    regCount = registered.length;
    assert.equal((await syncCommands(store)).skipped, 'waiting');
    rl = await call('POST', '/admin/discord/commands', {}, admin);
    assert.equal(rl.status, 429);
    assert.match(rl.data.error, /알아서 다시 등록합니다/);
    assert.equal(registered.length, regCount);
    await store.setJSON('config/discord', { ...(await store.get('config/discord', { type: 'json' })), commandsRetryAt: Date.now() - 1 });
    assert.equal((await syncCommands(store)).skipped, 'done'); // 이미 등록된 그대로라 오류만 지움
    dsc = (await call('GET', '/admin/discord', null, admin)).data;
    assert.ok(!dsc.commandsError && !dsc.commandsRetryAt);
    // Cloudflare IP 차단 / 하루 한도
    limits.push(() => new Response('<html>error code: 1015</html>', { status: 429, headers: { 'content-type': 'text/html' } }));
    rl = await call('POST', '/admin/discord/commands', {}, admin);
    assert.match(rl.data.error, /IP를 잠깐 막았습니다/);
    await call('POST', '/admin/discord', { botToken }, admin); // 토큰 다시 저장하면 대기 초기화 후 바로 시도
    limits.push(() => Response.json({ code: 30034, message: 'Max number of daily application command creates has been reached (200)' }, { status: 429 }));
    assert.match((await call('POST', '/admin/discord/commands', {}, admin)).data.error, /내일/);
    await call('POST', '/admin/discord', { botToken }, admin);
    assert.ok(!(await call('GET', '/admin/discord', null, admin)).data.commandsError);
    // 파이썬 봇: 봇 토큰으로 만든 열쇠가 맞아야 답을 줌
    const botKey = createHmac('sha256', 'crystal-bot').update(botToken).digest('hex');
    const botCall = (name, key, uid = '') => respond(new Request('http://localhost/api/bot/command', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-key': key }, body: JSON.stringify({ name, discordUserId: uid }),
    }), store).then(async (r) => ({ status: r.status, data: await r.json() }));
    assert.equal((await botCall('사이트', 'nope')).status, 401);
    assert.equal((await botCall('목록', botKey)).data.commands.length, 1);
    assert.match((await botCall('사이트', botKey)).data.data.embeds[0].title, /크리스탈/);
    assert.equal((await botCall('로또권', botKey, '555555555555555555')).data.data.flags, 64);
    // 운영자 브라우저에서 직접 등록 (서버 IP가 막혔을 때)
    assert.equal((await call('POST', '/admin/discord/commands-local', {}, u1)).status, 401);
    const local = (await call('POST', '/admin/discord/commands-local', {}, admin)).data;
    assert.equal(local.appId, '1534442417225465936');
    assert.equal(local.guildId, '1176515670624698418');
    assert.equal(local.commands.length, 1);
    await store.setJSON('config/discord', { ...(await store.get('config/discord', { type: 'json' })), commandsSig: null, commandsError: 'x', commandsRetryAt: Date.now() + 60_000 });
    const done = (await call('POST', '/admin/discord/commands-done', {}, admin)).data;
    assert.ok(done.commandsAt && !done.commandsError && !done.commandsRetryAt);
    regCount = registered.length;
    assert.equal((await syncCommands(store)).skipped, 'done');
    assert.equal(registered.length, regCount);
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
