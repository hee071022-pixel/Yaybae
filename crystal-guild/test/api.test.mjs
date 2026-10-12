// 로컬 Blobs 서버로 API 전체 흐름을 검사한다: node test/api.test.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { respond, rankOf, drawMessage, drawCard, periodText, autoDrawIfDue, dmWinners, syncCommands, winnerNoticeText, DEFAULT_ROLE_ID, publishScheduledNotices } from '../netlify/functions/api.mjs';

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

  // 닉네임 변경 (디코 없음 → 비밀번호 그대로, 응모·로또권 옮겨짐)
  const rn = (await call('POST', '/signup', { id: '옛이름', password: 'oldpw1' })).data.token;
  await call('POST', '/admin/grant', { ids: ['옛이름'], amount: 3 }, admin);
  assert.equal((await call('POST', '/enter', { lines: ['auto'] }, rn)).status, 200);
  assert.equal((await call('POST', '/admin/rename-user', { id: '옛이름', newId: '수정이' }, admin)).status, 409);
  assert.equal((await call('POST', '/admin/rename-user', { id: '옛이름', newId: 'admin' }, admin)).status, 400);
  const renamed = (await call('POST', '/admin/rename-user', { id: '옛이름', newId: '새이름' }, admin)).data;
  assert.equal(renamed.user.id, '새이름');
  assert.equal(renamed.dm, 'none');
  assert.equal(renamed.tempPassword, undefined);
  assert.equal((await call('GET', '/me', null, rn)).status, 401);
  assert.equal((await call('POST', '/login', { id: '옛이름', password: 'oldpw1' })).status, 401);
  const rn2 = (await call('POST', '/login', { id: '새이름', password: 'oldpw1' })).data.token;
  const rme = (await call('GET', '/me', null, rn2)).data;
  assert.equal(rme.user.tickets, 2);
  assert.equal(rme.entries.length, 1);
  const allE = (await call('GET', '/admin/rounds/2/entries', null, admin)).data.entries;
  assert.ok(allE.some((e) => e.user === '새이름') && !allE.some((e) => e.user === '옛이름'));
  await call('POST', '/admin/delete-user', { id: '새이름' }, admin);

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

  // 내 정보: 기록 + 비밀번호 변경
  const mt = (await call('POST', '/login', { id: '수정이', password: 'newpw' })).data.token;
  assert.equal((await call('GET', '/me/records')).status, 401);
  await call('POST', '/admin/round/open', {}, admin); // 이미 열려 있으면 400이어도 됨
  await call('POST', '/admin/grant', { ids: ['수정이'], amount: 2 }, admin);
  assert.equal((await call('POST', '/enter', { lines: ['auto', 'auto'] }, mt)).status, 200);
  const rec = (await call('GET', '/me/records', null, mt)).data;
  assert.ok(rec.rounds.length >= 1 && rec.rounds[0].lines.length >= 2);
  assert.equal(rec.totals.lines, rec.rounds.reduce((n, r) => n + r.lines.length, 0));
  assert.ok(rec.rounds.every((r) => r.status !== 'drawn' || r.lines.every((l) => typeof l.rank === 'number')));
  assert.equal((await call('POST', '/me/password', { current: 'wrong', next: 'abcd1' }, mt)).status, 400);
  assert.equal((await call('POST', '/me/password', { current: 'newpw', next: 'ab' }, mt)).status, 400);
  const pwc = (await call('POST', '/me/password', { current: 'newpw', next: 'changed1' }, mt)).data;
  assert.ok(pwc.token);
  assert.equal((await call('GET', '/me', null, mt)).status, 401); // 예전 토큰은 로그아웃
  assert.equal((await call('GET', '/me', null, pwc.token)).status, 200);
  assert.equal((await call('POST', '/login', { id: '수정이', password: 'changed1' })).status, 200);
  await call('POST', '/admin/reset-password', { id: '수정이', password: 'newpw' }, admin); // 뒤 테스트용으로 되돌림
  // 닉네임 직접 변경: 비밀번호 확인, 기록 옮김, 7일 제한
  const sr = (await call('POST', '/signup', { id: '셀프닉', password: 'self1' })).data.token;
  await call('POST', '/admin/grant', { ids: ['셀프닉'], amount: 4 }, admin);
  assert.equal((await call('POST', '/me/rename', { newId: '셀프닉2', password: 'nope' }, sr)).status, 400);
  assert.equal((await call('POST', '/me/rename', { newId: '수정이', password: 'self1' }, sr)).status, 409);
  const sr2 = (await call('POST', '/me/rename', { newId: '셀프닉2', password: 'self1' }, sr)).data;
  assert.equal(sr2.user.id, '셀프닉2');
  assert.equal(sr2.user.tickets, 4);
  assert.equal((await call('GET', '/me', null, sr)).status, 401);
  assert.equal((await call('GET', '/me', null, sr2.token)).status, 200);
  assert.equal((await call('POST', '/login', { id: '셀프닉2', password: 'self1' })).status, 200);
  const again = await call('POST', '/me/rename', { newId: '셀프닉3', password: 'self1' }, sr2.token);
  assert.equal(again.status, 400);
  assert.match(again.data.error, /7일에 한 번/);
  // 프로필 사진
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.equal((await call('POST', '/me/avatar', { image: 'data:text/html;base64,PGI+' }, sr2.token)).status, 400);
  assert.equal((await call('POST', '/me/avatar', { image: 'data:image/png;base64,' + 'A'.repeat(200000) }, sr2.token)).status, 400);
  const av = (await call('POST', '/me/avatar', { image: png }, sr2.token)).data;
  assert.ok(av.user.avatarAt);
  const pic = await respond(new Request('http://x/api/avatar/' + encodeURIComponent('셀프닉2')), store);
  assert.equal(pic.status, 200);
  assert.equal(pic.headers.get('content-type'), 'image/png');
  assert.equal((await pic.arrayBuffer()).byteLength, Buffer.from(png.split(',')[1], 'base64').length);
  assert.equal((await respond(new Request('http://x/api/avatar/' + encodeURIComponent('없는사람')), store)).status, 404);
  await call('POST', '/admin/rename-user', { id: '셀프닉2', newId: '사진닉' }, admin); // 닉변하면 사진도 따라감
  assert.equal((await respond(new Request('http://x/api/avatar/' + encodeURIComponent('사진닉')), store)).status, 200);
  assert.equal((await respond(new Request('http://x/api/avatar/' + encodeURIComponent('셀프닉2')), store)).status, 404);
  const pt = (await call('POST', '/login', { id: '사진닉', password: 'self1' })).data.token;
  assert.equal((await call('POST', '/me/avatar/remove', {}, pt)).data.user.avatarAt, null);
  assert.equal((await respond(new Request('http://x/api/avatar/' + encodeURIComponent('사진닉')), store)).status, 404);
  await call('POST', '/admin/delete-user', { id: '사진닉' }, admin);

  // 홈 공개 정보
  const st = (await call('GET', '/stats')).data;
  assert.equal(typeof st.members, 'number');
  assert.ok(st.members >= 1);
  assert.ok(!('entries' in st));

  // 1등 자동 공지 글
  const wn = winnerNoticeText({ no: 4, numbers: [3, 12, 19, 27, 33, 41], bonus: 8, prizes: { 1: '크리스탈 1000개', 5: '크리스탈 10개' },
    winners: [{ rank: 1, user: '하늘' }, { rank: 1, user: '하늘' }, { rank: 5, user: '바다' }, { rank: 5, user: '별빛' }] });
  assert.equal(wn.title, '제4회 로또 1등 당첨자 발표');
  assert.match(wn.body, /1등: 하늘\n상품: 크리스탈 1000개\n당첨번호: 03 12 19 27 33 41 \+ 08/);
  assert.match(wn.body, /5등: 바다, 별빛 \(크리스탈 10개\)/);
  assert.equal(winnerNoticeText({ no: 1, numbers: [1, 2, 3, 4, 5, 6], bonus: 7, winners: [{ rank: 2, user: 'a' }] }), null);
  let ovw = (await call('GET', '/admin/overview', null, admin)).data;
  assert.equal(ovw.settings.autoWinnerNotice, true);
  assert.equal((await call('POST', '/admin/settings', { autoWinnerNotice: false }, admin)).data.autoWinnerNotice, false);
  assert.equal((await call('POST', '/admin/settings', { autoWinnerNotice: true }, admin)).data.autoWinnerNotice, true);

  // 로또권 신청 → 운영자 승인/거절
  const rq = (await call('POST', '/login', { id: '수정이', password: 'newpw' })).data.token;
  assert.equal((await call('POST', '/me/request', { amount: 3 })).status, 401);
  assert.equal((await call('POST', '/me/request', { amount: 0 }, rq)).status, 400);
  assert.equal((await call('POST', '/me/request', { amount: 11 }, rq)).status, 400);
  await call('POST', '/me/request', { amount: 2, memo: '처음' }, rq);
  await call('POST', '/me/request', { amount: 3, memo: '레이드 참여' }, rq); // 다시 신청하면 덮어씀
  let meR = (await call('GET', '/me', null, rq)).data;
  assert.deepEqual([meR.request.amount, meR.request.memo], [3, '레이드 참여']);
  ovw = (await call('GET', '/admin/overview', null, admin)).data;
  assert.equal(ovw.requests.length, 1);
  assert.equal(ovw.requests[0].user, '수정이');
  const before = meR.user.tickets;
  assert.equal((await call('POST', '/admin/requests/approve', { user: '수정이' }, rq)).status, 401);
  const ap = (await call('POST', '/admin/requests/approve', { user: '수정이' }, admin)).data;
  assert.equal(ap.requests.length, 0);
  meR = (await call('GET', '/me', null, rq)).data;
  assert.equal(meR.user.tickets, before + 3);
  assert.equal(meR.user.history[0].reason, '로또권 신청 승인');
  assert.equal(meR.request, null);
  assert.equal(meR.requestResult.status, 'approved');
  assert.equal((await call('POST', '/admin/requests/approve', { user: '수정이' }, admin)).status, 404);
  await call('POST', '/me/request', { amount: 1 }, rq);
  await call('POST', '/admin/requests/reject', { user: '수정이' }, admin);
  meR = (await call('GET', '/me', null, rq)).data;
  assert.equal(meR.user.tickets, before + 3);
  assert.equal(meR.requestResult.status, 'rejected');
  await call('POST', '/me/request', { amount: 1 }, rq);
  await call('POST', '/me/request/cancel', {}, rq);
  assert.equal((await call('GET', '/admin/overview', null, admin)).data.requests.length, 0);

  // ---------- 디스코드 ----------
  const realFetch = globalThis.fetch;
  const sent = [];
  const sentTo = [];
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
      sentTo.push(u);
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
    const titles = sent.map((m) => m.embeds?.[0].title || m.components?.find((c) => c.type === 17)?.components[0].content || m.content);
    assert.equal(titles.length, 4, JSON.stringify(titles));
    assert.ok(titles[1] === '디코 공지' && /추첨 결과/.test(titles[2]) && /로또 시작/.test(titles[3]));
    // 회차 시작 카드: 사이트로 가는 링크 버튼, fallback은 웹후크로 안 보냄
    const card = sent.at(-1);
    assert.equal(card.flags, 1 << 15);
    // 회차 시작·공지는 기본으로 알림 역할 멘션
    assert.equal(card.components[0].content, '<@&1194961472514707517>');
    assert.deepEqual(card.allowed_mentions, { parse: [], roles: ['1194961472514707517'] });
    assert.equal(sent.find((m) => m.embeds?.[0].title === '디코 공지').content, '<@&1194961472514707517>');
    assert.equal((await call('POST', '/admin/discord', { roleId: 'abc' }, admin)).status, 400);
    const roleSet = (await call('POST', '/admin/discord', { roleId: '222222222222222222', openMention: 'none' }, admin)).data;
    assert.deepEqual([roleSet.roleId, roleSet.openMention], ['222222222222222222', 'none']);
    await call('POST', '/admin/discord/send', { message: '역할 호출', mention: 'role' }, admin);
    assert.equal(sent.at(-1).content, '<@&222222222222222222>');
    assert.deepEqual(sent.at(-1).allowed_mentions.roles, ['222222222222222222']);
    await call('POST', '/admin/discord', { roleId: '', openMention: 'role' }, admin);
    assert.equal((await call('GET', '/admin/discord', null, admin)).data.roleId, '1194961472514707517');
    assert.equal(card.fallback, undefined);
    const btn = card.components.find((c) => c.type === 17).components.at(-1).components[0];
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
    // 디코 연동된 길드원 닉변 → 비밀번호 그대로, 새 아이디를 DM으로
    await call('POST', '/signup', { id: '디코유저', password: 'dcpass1' });
    await call('POST', '/admin/user-discord', { id: '디코유저', discordId: '777777777777777777' }, admin);
    const rdc = (await call('POST', '/admin/rename-user', { id: '디코유저', newId: '디코유저2' }, admin)).data;
    assert.equal(rdc.dm, 'sent');
    assert.equal(rdc.passwordChanged, false);
    let fields = dms.at(-1).body.embeds[0].fields;
    assert.equal(dms.at(-1).to, '777777777777777777');
    assert.equal(fields[0].value, '`디코유저2`');
    assert.match(fields[1].value, /그대로/);
    assert.equal((await call('POST', '/login', { id: '디코유저2', password: 'dcpass1' })).status, 200);
    // 새 비밀번호를 같이 넣으면 그걸로 바뀌고 DM에 들어감
    const rdc2 = (await call('POST', '/admin/rename-user', { id: '디코유저2', newId: '디코유저3', password: 'brandnew' }, admin)).data;
    assert.equal(rdc2.passwordChanged, true);
    fields = dms.at(-1).body.embeds[0].fields;
    assert.equal(fields[1].value, '||`brandnew`||');
    assert.equal((await call('POST', '/login', { id: '디코유저3', password: 'dcpass1' })).status, 401);
    assert.equal((await call('POST', '/login', { id: '디코유저3', password: 'brandnew' })).status, 200);
    // DM 실패해도 변경은 됨
    await call('POST', '/admin/user-discord', { id: '디코유저3', discordId: '400000000000000000' }, admin);
    const rfail = (await call('POST', '/admin/rename-user', { id: '디코유저3', newId: '디코유저4' }, admin)).data;
    assert.equal(rfail.dm, 'failed');
    assert.equal((await call('POST', '/login', { id: '디코유저4', password: 'brandnew' })).status, 200);
    // 비번 초기화도 DM
    const rp = (await call('POST', '/admin/reset-password', { id: '수정이', password: 'newpw' }, admin)).data;
    assert.equal(rp.dm, 'sent');
    assert.match(dms.at(-1).body.embeds[0].fields[1].value, /newpw/);
    assert.ok(dms.some((d) => d.to === myId && d.body.embeds?.[0].description === '개인 메시지'));
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

    // 쿠폰 채널: 연결 전에는 안 올라가고, 연결하면 쿠폰을 만들 때 카드로 올라감
    const nOld = sent.length;
    const c0 = (await call('POST', '/admin/coupons', { code: 'NOCH-1', amount: 1 }, admin)).data;
    assert.equal(c0.posted, false);
    assert.equal(sent.length, nOld);
    assert.equal((await call('POST', '/admin/coupons/post', { code: 'NOCH-1' }, admin)).status, 400);
    assert.equal((await call('POST', '/admin/discord/coupon-test', {}, admin)).status, 400);
    assert.equal((await call('POST', '/admin/discord', { couponWebhookUrl: 'https://evil.com/x' }, admin)).status, 400);
    const chook = 'https://discord.com/api/webhooks/555555555/coupon_tok';
    let cs = (await call('POST', '/admin/discord', { couponWebhookUrl: chook, couponMention: 'role' }, admin)).data;
    assert.ok(cs.couponWebhookSet && cs.couponAuto && cs.webhookSet && !JSON.stringify(cs).includes('coupon_tok'));
    assert.equal((await call('POST', '/admin/discord/coupon-test', {}, admin)).status, 200);
    assert.ok(sentTo.at(-1).startsWith(chook));
    const c1 = (await call('POST', '/admin/coupons', { code: 'CH-777', amount: 3, maxUses: 5, expiresAt: Date.now() + 86400000 }, admin)).data;
    assert.equal(c1.posted, true);
    assert.ok(c1.coupon.postedAt);
    assert.ok(sentTo.at(-1).startsWith(chook) && sentTo.at(-1).includes('with_components=true'));
    const cpCard = JSON.stringify(sent.at(-1));
    assert.ok(cpCard.includes('CH-777') && cpCard.includes('선착순 5명') && cpCard.includes('3장') && cpCard.includes('<t:'));
    assert.ok(cpCard.includes(`<@&${DEFAULT_ROLE_ID}>`) && sent.at(-1).allowed_mentions.roles[0] === DEFAULT_ROLE_ID);
    // post:false 이면 안 올림, 자동 끄기
    const nBefore = sent.length;
    assert.equal((await call('POST', '/admin/coupons', { code: 'QUIET-1', amount: 1, post: false }, admin)).data.posted, false);
    cs = (await call('POST', '/admin/discord', { couponAuto: false }, admin)).data;
    assert.equal(cs.couponAuto, false);
    assert.equal((await call('POST', '/admin/coupons', { code: 'QUIET-2', amount: 1 }, admin)).data.posted, false);
    assert.equal(sent.length, nBefore);
    // 나중에 올리기
    const cpRe = (await call('POST', '/admin/coupons/post', { code: 'quiet-2' }, admin)).data;
    assert.ok(cpRe.coupon.postedAt && sent.length === nBefore + 1 && JSON.stringify(sent.at(-1)).includes('QUIET-2'));
    // 카드가 거절되면 임베드로
    rejectCards = true;
    await call('POST', '/admin/coupons/post', { code: 'QUIET-1' }, admin);
    rejectCards = false;
    assert.ok(sent.at(-1).embeds[0].description.includes('QUIET-1'));
    // 공지 채널 설정은 그대로
    assert.ok((await call('GET', '/admin/discord', null, admin)).data.webhookSet);
    cs = (await call('POST', '/admin/discord', { couponWebhookUrl: '' }, admin)).data;
    assert.equal(cs.couponWebhookSet, false);
    for (const code of ['NOCH-1', 'CH-777', 'QUIET-1', 'QUIET-2']) await call('POST', '/admin/coupons/delete', { code }, admin);

  } finally {
    globalThis.fetch = realFetch;
  }

  // 운영 활동 기록
  assert.equal((await call('GET', '/admin/logs', null, u1)).status, 401);
  await call('POST', '/admin/grant', { ids: ['수정이'], amount: 3, reason: '기록 테스트' }, admin);
  let lg = (await call('GET', '/admin/logs', null, admin)).data;
  assert.equal(lg.logs[0].action, '로또권 지급');
  assert.match(lg.logs[0].detail, /수정이 · \+3장 · 기록 테스트/);
  await call('POST', '/admin/reset-password', { id: '수정이', password: 'secretpw9' }, admin);
  lg = (await call('GET', '/admin/logs', null, admin)).data;
  assert.equal(lg.logs[0].action, '비밀번호 초기화');
  assert.ok(!JSON.stringify(lg).includes('secretpw9')); // 비밀번호는 기록에 안 남음
  assert.ok(lg.logs.every((x, i) => i === 0 || lg.logs[i - 1].at >= x.at)); // 최신순
  await call('GET', '/admin/overview', null, admin); // 조회는 기록 안 함
  assert.equal((await call('GET', '/admin/logs', null, admin)).data.total, lg.total);

  // 통계
  const stt = (await call('GET', '/admin/stats', null, admin)).data;
  assert.ok(stt.members.total >= 1 && stt.rounds.length >= 1);
  assert.equal(stt.totals.lines, stt.rounds.reduce((t, r) => t + r.lines, 0));
  assert.ok(stt.rounds.every((r) => r.people <= r.lines));

  // 백업 → 데이터 바꾸고 → 복원하면 되돌아옴 (비밀값 제외)
  const bk = (await call('GET', '/admin/backup', null, admin)).data;
  assert.equal(bk.app, 'crystal-guild');
  assert.ok(bk.data.meta && Object.keys(bk.data).some((k) => k.startsWith('users/')));
  assert.ok(!Object.keys(bk.data).some((k) => k.startsWith('config/discord') || k === 'config/secret' || k === 'config/admin'));
  const usersBefore = (await call('GET', '/admin/overview', null, admin)).data.users.length;
  await call('POST', '/signup', { id: '복원후사라짐', password: 'tmp1' });
  assert.equal((await call('GET', '/admin/overview', null, admin)).data.users.length, usersBefore + 1);
  assert.equal((await call('POST', '/admin/restore', { backup: { app: 'other', data: {} } }, admin)).status, 400);
  assert.equal((await call('POST', '/admin/restore', { backup: { ...bk, data: { 'config/discord': {} } } }, admin)).status, 400);
  const rs = (await call('POST', '/admin/restore', { backup: bk }, admin)).data;
  assert.equal(rs.restored, bk.count);
  assert.equal((await call('GET', '/admin/overview', null, admin)).data.users.length, usersBefore);
  assert.equal((await call('POST', '/login', { id: '수정이', password: 'secretpw9' })).status, 200);

  // 쿠폰: 만들기 → 사용(한 번만) → 선착순 · 기한 · 없는 코드
  const sj = (await call('POST', '/login', { id: '수정이', password: 'secretpw9' })).data.token;
  const sb = (await call('POST', '/signup', { id: '쿠폰둘', password: 'pw22' })).data.token;
  assert.equal((await call('POST', '/admin/coupons', { amount: 0 }, admin)).status, 400);
  assert.equal((await call('POST', '/admin/coupons', { code: '한글', amount: 1 }, admin)).status, 400);
  const auto = (await call('POST', '/admin/coupons', { amount: 2 }, admin)).data.coupon;
  assert.match(auto.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const cp = (await call('POST', '/admin/coupons', { code: 'raid-10', amount: 3, maxUses: 1, memo: '레이드' }, admin)).data.coupon;
  assert.equal(cp.code, 'RAID-10');
  assert.equal((await call('POST', '/admin/coupons', { code: 'RAID-10', amount: 1 }, admin)).status, 409);
  const tk0 = (await call('GET', '/me', null, sj)).data.user.tickets;
  const red = await call('POST', '/me/coupon', { code: ' raid-10 ' }, sj);
  assert.equal(red.status, 200);
  assert.equal(red.data.amount, 3);
  assert.equal(red.data.user.tickets, tk0 + 3);
  assert.equal(red.data.user.history[0].reason, '쿠폰 RAID-10');
  assert.equal((await call('POST', '/me/coupon', { code: 'RAID-10' }, sj)).status, 400); // 한 번만
  assert.match((await call('POST', '/me/coupon', { code: 'RAID-10' }, sb)).data.error, /선착순/);
  assert.match((await call('POST', '/me/coupon', { code: 'NOPE-0000' }, sb)).data.error, /없는/);
  assert.equal((await call('POST', '/me/coupon', { code: auto.code })).status, 401);
  assert.equal((await call('POST', '/me/coupon', { code: auto.code }, sb)).status, 200);
  assert.equal((await call('POST', '/admin/coupons', { code: 'OLD-1', amount: 1, expiresAt: Date.now() - 1000 }, admin)).status, 400);
  const soon = (await call('POST', '/admin/coupons', { code: 'SOON-1', amount: 1, expiresAt: Date.now() + 300 }, admin)).data.coupon;
  await new Promise((r) => setTimeout(r, 400));
  assert.match((await call('POST', '/me/coupon', { code: soon.code }, sb)).data.error, /기간/);
  const cps = (await call('GET', '/admin/coupons', null, admin)).data.coupons;
  assert.deepEqual(cps.find((c) => c.code === 'RAID-10').usedBy, ['수정이']);
  assert.equal((await call('GET', '/admin/coupons', null, sj)).status, 401);
  assert.equal((await call('POST', '/admin/coupons/delete', { code: 'SOON-1' }, admin)).data.coupons.some((c) => c.code === 'SOON-1'), false);
  assert.ok((await call('GET', '/admin/logs', null, admin)).data.logs.some((l) => l.action === '쿠폰 사용' && l.actor === '수정이'));

  // 사이트 쿠폰 채널: 공개한 쿠폰만, 코드·상태는 보이고 메모·사용자 목록은 안 보임
  assert.equal((await call('GET', '/me/coupons')).status, 401);
  await call('POST', '/admin/coupons', { code: 'BOARD-1', amount: 4, maxUses: 2, memo: '비밀 메모' }, admin);
  await call('POST', '/admin/coupons', { code: 'HIDDEN-1', amount: 1, board: false }, admin);
  let mc = (await call('GET', '/me/coupons', null, sb)).data;
  const b1 = mc.coupons.find((c) => c.code === 'BOARD-1');
  assert.ok(b1 && b1.available && !b1.used && b1.amount === 4);
  assert.ok(!mc.coupons.some((c) => c.code === 'HIDDEN-1'));
  assert.ok(!JSON.stringify(mc).includes('비밀 메모') && !JSON.stringify(mc).includes('usedBy'));
  assert.equal(mc.coupons[0].code, mc.coupons.find((c) => c.available).code); // 받을 수 있는 쿠폰이 위로
  const avail0 = mc.available;
  await call('POST', '/me/coupon', { code: 'BOARD-1' }, sb);
  mc = (await call('GET', '/me/coupons', null, sb)).data;
  assert.equal(mc.available, avail0 - 1);
  assert.ok(mc.coupons.find((c) => c.code === 'BOARD-1').used);
  await call('POST', '/me/coupon', { code: 'BOARD-1' }, sj); // 선착순 2명 마감
  const third = (await call('POST', '/signup', { id: '셋째', password: 'pw33' })).data.token;
  const b3 = (await call('GET', '/me/coupons', null, third)).data.coupons.find((c) => c.code === 'BOARD-1');
  assert.ok(b3.soldOut && !b3.available && !b3.used);
  // 숨긴 쿠폰도 코드를 알면 사용 가능, 공개 전환
  assert.equal((await call('POST', '/me/coupon', { code: 'HIDDEN-1' }, third)).status, 200);
  const brd = (await call('POST', '/admin/coupons/board', { code: 'HIDDEN-1', board: true }, admin)).data.coupons;
  assert.ok(brd.find((c) => c.code === 'HIDDEN-1').board);
  assert.ok((await call('GET', '/me/coupons', null, third)).data.coupons.find((c) => c.code === 'HIDDEN-1').used);
  assert.equal((await call('POST', '/admin/coupons/board', { code: 'HIDDEN-1', board: false }, sj)).status, 401);
  await call('POST', '/admin/delete-user', { id: '셋째' }, admin);

  // 랭킹: 당첨 점수 합계가 회차 당첨자와 맞음
  const rk = (await call('GET', '/ranking')).data;
  assert.ok(rk.rounds >= 1 && Array.isArray(rk.list));
  const hs = (await call('GET', '/history')).data.rounds.slice(0, 60);
  const alive = new Set((await call('GET', '/admin/overview', null, admin)).data.users.map((u) => u.id));
  const expectPts = hs.flatMap((r) => r.winners).filter((w) => alive.has(w.user)).reduce((t, w) => t + rk.points[w.rank], 0);
  assert.equal(rk.list.reduce((t, x) => t + x.points, 0), expectPts);
  assert.ok(rk.list.every((x) => x.rounds <= x.lines && x.wins === Object.values(x.byRank).reduce((a, b) => a + b, 0)));

  // 길드 일정
  assert.equal((await call('POST', '/admin/events', { title: '', date: '2026-10-20' }, admin)).status, 400);
  assert.equal((await call('POST', '/admin/events', { title: '레이드', date: '2026/10/20' }, admin)).status, 400);
  assert.equal((await call('POST', '/admin/events', { title: '레이드', date: '2026-10-20', time: '25:00' }, admin)).status, 400);
  assert.equal((await call('POST', '/admin/events', { title: '레이드', date: '2026-10-20' }, sj)).status, 401);
  const e2 = (await call('POST', '/admin/events', { title: '정모', date: '2026-11-01', place: '디코' }, admin)).data.event;
  const e1 = (await call('POST', '/admin/events', { title: '레이드', date: '2026-10-20', time: '21:00' }, admin)).data.event;
  let evs = (await call('GET', '/events')).data.events;
  assert.deepEqual(evs.map((x) => x.id), [e1.id, e2.id]);
  const ed = (await call('POST', '/admin/events/edit', { id: e2.id, title: '정기 모임', date: '2026-10-05' }, admin)).data.event;
  assert.equal(ed.title, '정기 모임');
  assert.equal(ed.createdAt, e2.createdAt);
  evs = (await call('GET', '/events')).data.events;
  assert.deepEqual(evs.map((x) => x.id), [e2.id, e1.id]);
  assert.equal((await call('POST', '/admin/events/edit', { id: 'zzzzzzzz', title: 'x', date: '2026-10-05' }, admin)).status, 404);
  await call('POST', '/admin/events/delete', { id: e1.id }, admin);
  assert.equal((await call('GET', '/events')).data.events.length, 1);
  // 일정 참석 신청
  const dfut = new Date(Date.now() + 9 * 3600000 + 3 * 86400000).toISOString().slice(0, 10);
  const dpast = new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
  assert.equal((await call('POST', '/admin/events', { title: 'x', date: dfut, limit: -1 }, admin)).status, 400);
  const rv = (await call('POST', '/admin/events', { title: '보스 레이드', date: dfut, limit: 2 }, admin)).data.event;
  const pv = (await call('POST', '/admin/events', { title: '지난 모임', date: dpast }, admin)).data.event;
  assert.equal((await call('POST', '/me/events/rsvp', { id: rv.id, status: 'yes' })).status, 401);
  assert.equal((await call('POST', '/me/events/rsvp', { id: rv.id, status: 'maybe' }, sj)).status, 400);
  assert.equal((await call('POST', '/me/events/rsvp', { id: 'zzzzzzzz', status: 'yes' }, sj)).status, 404);
  assert.match((await call('POST', '/me/events/rsvp', { id: pv.id, status: 'yes' }, sj)).data.error, /지난/);
  let rr = (await call('POST', '/me/events/rsvp', { id: rv.id, status: 'yes' }, sj)).data.event;
  assert.deepEqual(rr.rsvp, { yes: ['수정이'], no: [] });
  rr = (await call('POST', '/me/events/rsvp', { id: rv.id, status: 'yes' }, sj)).data.event; // 같은 걸 다시 눌러도 그대로
  assert.deepEqual(rr.rsvp.yes, ['수정이']);
  const t4 = (await call('POST', '/signup', { id: '넷째', password: 'pw44' })).data.token;
  await call('POST', '/me/events/rsvp', { id: rv.id, status: 'yes' }, t4);
  assert.match((await call('POST', '/me/events/rsvp', { id: rv.id, status: 'yes' }, sb)).data.error, /다 찼/);
  rr = (await call('POST', '/me/events/rsvp', { id: rv.id, status: 'no' }, sb)).data.event;
  assert.deepEqual(rr.rsvp.no, ['쿠폰둘']);
  rr = (await call('POST', '/me/events/rsvp', { id: rv.id, status: 'no' }, sj)).data.event; // 참석 → 불참
  assert.deepEqual(rr.rsvp, { yes: ['넷째'], no: ['쿠폰둘', '수정이'] });
  rr = (await call('POST', '/me/events/rsvp', { id: rv.id, status: 'yes' }, sb)).data.event; // 자리 생겨서 참석
  assert.deepEqual(rr.rsvp, { yes: ['넷째', '쿠폰둘'], no: ['수정이'] });
  rr = (await call('POST', '/me/events/rsvp', { id: rv.id, status: '' }, sj)).data.event; // 취소
  assert.deepEqual(rr.rsvp.no, []);
  // 일정 수정해도 명단 유지, 목록에도 보임
  await call('POST', '/admin/events/edit', { id: rv.id, title: '보스 레이드 2', date: dfut, limit: 3 }, admin);
  let lv = (await call('GET', '/events')).data.events.find((x) => x.id === rv.id);
  assert.deepEqual(lv.rsvp.yes, ['넷째', '쿠폰둘']);
  assert.equal(lv.limit, 3);
  assert.deepEqual((await call('GET', '/events')).data.events.find((x) => x.id === pv.id).rsvp, { yes: [], no: [] });
  // 닉네임 변경·계정 삭제 반영
  await call('POST', '/me/rename', { newId: '넷째바뀜', password: 'pw44' }, t4);
  lv = (await call('GET', '/events')).data.events.find((x) => x.id === rv.id);
  assert.deepEqual(lv.rsvp.yes, ['넷째바뀜', '쿠폰둘']);
  await call('POST', '/admin/delete-user', { id: '넷째바뀜' }, admin);
  lv = (await call('GET', '/events')).data.events.find((x) => x.id === rv.id);
  assert.deepEqual(lv.rsvp.yes, ['쿠폰둘']);
  await call('POST', '/admin/events/delete', { id: pv.id }, admin);
  await call('POST', '/admin/events/delete', { id: rv.id }, admin);

  // 예약 공지: 여러 날짜, 시간이 되면 한 번씩 올라감, 이전 것 지우기
  const nowT = Date.now();
  assert.equal((await call('POST', '/admin/scheduled', { title: '예약', times: [] }, admin)).status, 400);
  assert.equal((await call('POST', '/admin/scheduled', { title: '예약', times: [nowT - 3600000] }, admin)).status, 400);
  assert.equal((await call('POST', '/admin/scheduled', { title: '', times: [nowT + 1000] }, admin)).status, 400);
  assert.equal((await call('POST', '/admin/scheduled', { title: '예약', times: [nowT + 1000] }, sj)).status, 401);
  const days = [1, 2, 3].map((d) => nowT + d * 86400000);
  const sc = (await call('POST', '/admin/scheduled', { title: '출석 이벤트 안내', body: '매일 확인', times: [days[2], days[0], days[1], days[0]], replace: true, discord: false }, admin)).data.scheduled;
  assert.deepEqual(sc.times, days); // 정렬·중복 제거
  const noticeCount = async () => (await call('GET', '/notices')).data.notices.filter((x) => x.title === '출석 이벤트 안내').length;
  assert.equal(await noticeCount(), 0);
  assert.equal(await publishScheduledNotices(store, days[0] + 1000), 1);
  assert.equal(await publishScheduledNotices(store, days[0] + 2000), 0); // 두 번 안 올림
  assert.equal(await noticeCount(), 1);
  let scl = (await call('GET', '/admin/scheduled', null, admin)).data.scheduled.find((x) => x.id === sc.id);
  assert.deepEqual(scl.times, [days[1], days[2]]);
  assert.ok(scl.sent[0].noticeId);
  const firstNotice = scl.sent[0].noticeId;
  assert.equal(await publishScheduledNotices(store, days[1] + 1000), 1);
  const after = (await call('GET', '/notices')).data.notices.filter((x) => x.title === '출석 이벤트 안내');
  assert.equal(after.length, 1); // replace: 전에 올린 건 지움
  assert.notEqual(after[0].id, firstNotice);
  // 날짜 하나 빼기 → 남은 예약 없음
  scl = (await call('POST', '/admin/scheduled/remove-time', { id: sc.id, at: days[2] }, admin)).data.scheduled.find((x) => x.id === sc.id);
  assert.deepEqual(scl.times, []);
  assert.equal(await publishScheduledNotices(store, days[2] + 1000), 0);
  // 밀린 예약이 여러 개면 한 번만, replace 아니면 쌓임
  const sc2 = (await call('POST', '/admin/scheduled', { title: '쌓이는 공지', times: [nowT + 1000, nowT + 2000], discord: false }, admin)).data.scheduled;
  assert.equal(await publishScheduledNotices(store, nowT + 5000), 1);
  assert.equal((await call('GET', '/notices')).data.notices.filter((x) => x.title === '쌓이는 공지').length, 1);
  assert.ok((await call('GET', '/admin/logs', null, admin)).data.logs.some((l) => l.action === '예약 공지 게시' && l.actor === '자동'));
  // GET /notices 도 시간이 된 예약을 올림
  const sc3 = (await call('POST', '/admin/scheduled', { title: '바로 올라갈 예약', times: [Date.now() + 300], discord: false }, admin)).data.scheduled;
  await new Promise((r) => setTimeout(r, 400));
  assert.ok((await call('GET', '/notices')).data.notices.some((x) => x.title === '바로 올라갈 예약'));
  for (const id of [sc.id, sc2.id, sc3.id]) await call('POST', '/admin/scheduled/delete', { id }, admin);
  assert.equal((await call('GET', '/admin/scheduled', null, admin)).data.scheduled.length, 0);

  const bk2 = (await call('GET', '/admin/backup', null, admin)).data;
  assert.ok(Object.keys(bk2.data).some((k) => k.startsWith('coupons/')) && Object.keys(bk2.data).some((k) => k.startsWith('events/')));

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
