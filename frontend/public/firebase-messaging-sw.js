self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const fallbackUrl = new URL("/bildirimler", self.location.origin).toString();
  const targetUrl = event.notification?.data?.url || fallbackUrl;

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windowClients) {
      if ("focus" in client) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.pathname === new URL(targetUrl).pathname) {
            await client.focus();
            return;
          }
        } catch {
          // Ignore malformed client URLs and continue with the fallback flow.
        }
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});

importScripts("/firebase-sw-config.js");

if (self.__FIREBASE_MESSAGING_CONFIG__?.firebaseConfig) {
  importScripts("https://www.gstatic.com/firebasejs/12.12.0/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/12.12.0/firebase-messaging-compat.js");

  firebase.initializeApp(self.__FIREBASE_MESSAGING_CONFIG__.firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = payload?.data?.title || payload?.notification?.title || "HalkYemek";
    const body = payload?.data?.body || payload?.notification?.body || "Yeni bir bildirimin var.";
    const url = payload?.data?.url || payload?.fcmOptions?.link || self.__FIREBASE_MESSAGING_CONFIG__.defaultClickUrl || new URL("/bildirimler", self.location.origin).toString();

    self.registration.showNotification(title, {
      body,
      icon: "/logo-halkyemek.png",
      badge: "/hy-favicon.svg",
      data: { url },
      tag: payload?.data?.tag || "halkyemek-notification",
      renotify: true,
    });
  });
}
