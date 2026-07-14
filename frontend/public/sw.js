/* Lightweight app service worker — enables PWA installability ("Add to Home
   Screen") and handles notification clicks. */
const CACHE = "placement-pulse-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Minimal network passthrough (a fetch handler is required for installability).
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
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