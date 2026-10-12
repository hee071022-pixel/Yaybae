// 크리스탈 길드 휴대폰 알림 (서비스 워커)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: '크리스탈 길드', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || '크리스탈 길드', {
    body: data.body || '',
    icon: data.icon || '/logo-128.png',
    badge: '/logo-128.png',
    data: { url: data.url || '/' },
    tag: data.tag,
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) { await w.focus(); return w.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
