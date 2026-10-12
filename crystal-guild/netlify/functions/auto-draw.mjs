// 응모 마감 시간이 지난 회차를 자동 추첨하고, 예약 공지를 올리고, 슬래시 명령어를 자동 등록한다 (Netlify 예약 함수, 1분마다).
// 사이트를 아무도 안 보고 있어도 제때 추첨되고 디스코드 알림이 나간다.
import { getStore } from '@netlify/blobs';
import { STORE_NAME, autoDrawIfDue, autoSyncCommands, publishScheduledNotices } from './api.mjs';

export default async () => {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  const result = await autoDrawIfDue(store);
  if (result) console.log(`auto draw: round ${result.round.no}`);
  // 시간이 된 예약 공지 올리기
  const posted = await publishScheduledNotices(store).catch((err) => console.error('scheduled notices', err.message));
  if (posted) console.log(`scheduled notices: ${posted}`);
  // 봇 토큰이 있으면 슬래시 명령어도 알아서 등록 (이미 등록됐으면 아무것도 안 함)
  const cmds = await autoSyncCommands(store);
  if (cmds.ok || cmds.error) console.log('commands:', cmds.ok ? 'registered' : cmds.error);
};

export const config = { schedule: '* * * * *' };
