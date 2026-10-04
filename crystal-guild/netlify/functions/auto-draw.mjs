// 응모 마감 시간이 지난 회차를 자동 추첨한다 (Netlify 예약 함수, 1분마다).
// 사이트를 아무도 안 보고 있어도 제때 추첨되고 디스코드 알림이 나간다.
import { getStore } from '@netlify/blobs';
import { STORE_NAME, autoDrawIfDue } from './api.mjs';

export default async () => {
  const result = await autoDrawIfDue(getStore({ name: STORE_NAME, consistency: 'strong' }));
  if (result) console.log(`auto draw: round ${result.round.no}`);
};

export const config = { schedule: '* * * * *' };
