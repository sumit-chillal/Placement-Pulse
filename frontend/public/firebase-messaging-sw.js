/* Firebase Cloud Messaging service worker — receives BACKGROUND web push
   messages (delivered even when the PWA/tab is closed) and shows a system
   notification. Service workers cannot read env vars, so the web app config
   is inlined here. */
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDlFs19e5ZppHY0cuhVlodXT9r9wCwVOWE",
  authDomain: "canara-web-app.firebaseapp.com",
  projectId: "canara-web-app",
  storageBucket: "canara-web-app.firebasestorage.app",
  messagingSenderId: "751909719592",
  appId: "1:751909719592:web:d5ec6b44aa01ee27ea2f1d",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = (payload.notification && payload.notification.title) || "New Placement Drive";
  const body = (payload.notification && payload.notification.body) || "";
  self.registration.showNotification(title, {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: data.uniqueHash || "placement-alert",
    renotify: true,
    requireInteraction: true,
    data: { jobId: data.jobId || "" },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const jobId = event.notification.data && event.notification.data.jobId;
  const url = jobId ? `/?job=${jobId}` : "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && "focus" in c) {
          c.postMessage({ type: "OPEN_JOB", jobId });
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});