self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; }
  catch { payload = { title: 'JotRelay', message: event.data?.text() || 'You have a new update.' }; }

  const notificationId = payload.notificationId || '';
  const url = payload.url || (notificationId ? `/?jotrelay_notification=${encodeURIComponent(notificationId)}` : '/');
  event.waitUntil(self.registration.showNotification(payload.title || 'JotRelay', {
    body: payload.message || 'You have a new update.',
    icon: '/jotrelay-icon.svg',
    badge: '/jotrelay-icon.svg',
    tag: payload.tag || (notificationId ? `jotrelay-${notificationId}` : 'jotrelay-update'),
    renotify: Boolean(payload.renotify),
    data: { url, notificationId },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = new URL(data.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      existing.postMessage({ type: 'JOTRELAY_NOTIFICATION_CLICK', notificationId: data.notificationId || '' });
      return existing.focus();
    }
    return self.clients.openWindow(targetUrl);
  }));
});
