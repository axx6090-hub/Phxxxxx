/* Service worker: lets the store install as a home-screen app, and shows admin
   notifications for new orders (Web Push). It caches nothing, so every visit
   loads the newest store; with no internet a page shows a short notice instead. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const OFFLINE_PAGE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#e91e63">
<title>صيدلية أيمن</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#fff5f8;color:#1f2937;text-align:center;padding:24px;box-sizing:border-box}
h1{color:#e91e63;font-size:24px;margin:0 0 8px}p{color:#6b7280;margin:0 0 20px}button{background:#e91e63;color:#fff;
border:0;border-radius:999px;padding:12px 28px;font-size:16px;font-weight:700}</style></head><body><div>
<h1>صيدلية أيمن</h1><p>ماكو اتصال بالإنترنت حالياً. تأكدي من الاتصال وارجعي حاولي.</p>
<button onclick="location.reload()">حاولي مرة ثانية</button></div></body></html>`;

// Only page loads are handled, and always from the network (no cache): if the network
// is down, show the notice above. Every other request goes straight to the browser.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "🛍️ طلب جديد", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "🛍️ طلب جديد";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || "order",
      renotify: true,
      requireInteraction: true,
      dir: "rtl",
      lang: "ar",
      icon: "icon-192.png",
      badge: "icon-192.png",
      vibrate: [200, 100, 200],
      data: { url: data.url || self.registration.scope + "#/admin" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope + "#/admin";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.registration.scope)) {
          w.navigate(url).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
