self.addEventListener('push', event => {
  let data;
  try {data = event.data?.json();} catch {data = null;}
  event.waitUntil(self.registration.showNotification('המרפסת', {body:data?.body || 'יש עדכון לגבי התור שלכם.',icon:new URL('icon-192.png',self.registration.scope).href,tag:'terrace-handoff'}));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const tabs = await clients.matchAll({type:'window',includeUncontrolled:true});
    const tab=tabs.find(client=>client.url.startsWith(self.registration.scope));
    if (tab) await tab.focus();
    else await clients.openWindow(self.registration.scope);
  })());
});
