/* Service worker for the store: lets it install as a home-screen app, keeps the store's
   files on the phone so the next visit opens fast, and shows admin notifications (Web Push).

   What is kept on the phone, and how it stays fresh:
   - Pages: always asked from the internet first, so a new version shows at once. Only when
     the internet is slow (over 3 s) or off does the saved copy open, and it updates itself.
   - Store code and styles (/static/…, names change with every version): kept, read from the phone.
   - Product photos, logos and fonts: shown from the phone at once and refreshed in the background.
   - Never kept: orders, admin, the API, version checks, anything that is not a plain GET.
   Each deploy changes sw-version.js, so the phone installs this worker again, saves the new
   store files and deletes the old ones. */
try { importScripts("./sw-version.js"); } catch (e) { self.BUILD = "dev"; }
const BUILD = self.BUILD || "dev";
const SHELL = `shell-${BUILD}`;
const MEDIA = "media-v1";
const FONTS = "fonts-v1";
const MEDIA_MAX = 300;
const NAV_TIMEOUT_MS = 3000;
// The admin site keeps no copies at all: it must always show live orders and settings.
const NO_CACHE = /^admin\./.test(self.location.hostname);

// Save the page and its code now, so the next visit doesn't wait for the internet.
const precache = async () => {
  if (NO_CACHE) return;
  const cache = await caches.open(SHELL);
  const res = await fetch("./", { cache: "reload" });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put("./", res);
  const assets = [...new Set((html.match(/\/static\/(?:js|css)\/[^"'\s>]+/g) || []))];
  await Promise.all(assets.map((a) => cache.add(a).catch(() => {})));
};

self.addEventListener("install", (event) => {
  event.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const OFFLINE_PAGE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#e91e63">
<title>صيدلية أيمن</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#fff5f8;color:#1f2937;text-align:center;padding:24px;box-sizing:border-box}
h1{color:#e91e63;font-size:24px;margin:0 0 8px}p{color:#6b7280;margin:0 0 20px}button{background:#e91e63;color:#fff;
border:0;border-radius:999px;padding:12px 28px;font-size:16px;font-weight:700}</style></head><body><div>
<h1>صيدلية أيمن</h1><p>ماكو اتصال بالإنترنت حالياً. تأكدي من الاتصال وارجعي حاولي.</p>
<button onclick="location.reload()">حاولي مرة ثانية</button></div></body></html>`;
const offline = () => new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });

const trim = async (name, max) => {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
};

// Pages: internet first; the saved page only when the internet is off or too slow.
const page = async (event) => {
  const cache = await caches.open(SHELL);
  const fromNet = fetch(event.request).then((res) => {
    if (res.ok && !NO_CACHE) cache.put("./", res.clone()).catch(() => {});
    return res;
  });
  const saved = NO_CACHE ? null : await cache.match("./");
  if (!saved) return fromNet.catch(offline);
  const slow = new Promise((resolve) => setTimeout(() => resolve(saved), NAV_TIMEOUT_MS));
  event.waitUntil(fromNet.catch(() => {}));
  return Promise.race([fromNet.catch(() => saved), slow]);
};

// Versioned code: never changes under the same name, so the saved copy is always right.
const staticFile = async (request) => {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone()).catch(() => {});
  return res;
};

// Photos and fonts: show the saved copy at once, refresh it in the background.
const fresh = async (event, name, max) => {
  const cache = await caches.open(name);
  const hit = await cache.match(event.request);
  const net = fetch(event.request)
    .then((res) => {
      if (res.ok || res.type === "opaque") {
        cache.put(event.request, res.clone()).then(() => trim(name, max)).catch(() => {});
      }
      return res;
    })
    .catch(() => hit);
  if (hit) {
    event.waitUntil(net);
    return hit;
  }
  return net;
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate") {
    event.respondWith(page(event));
    return;
  }
  if (NO_CACHE) return;
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/static/")) event.respondWith(staticFile(req));
    else if (url.pathname.startsWith("/_vercel/image") || url.pathname.startsWith("/images/")) event.respondWith(fresh(event, MEDIA, MEDIA_MAX));
    else if (/\.(png|jpg|jpeg|webp)$/.test(url.pathname)) event.respondWith(fresh(event, MEDIA, MEDIA_MAX));
    return; // version.json, sw files, manifest, API calls: straight to the internet
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(fresh(event, FONTS, 30));
  }
});

// The store sends the photos of the first products it shows, so they are on the phone for next time.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "warm" || NO_CACHE || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((u) => typeof u === "string" && u.startsWith("/_vercel/image")).slice(0, 60);
  event.waitUntil(
    caches.open(MEDIA).then(async (cache) => {
      for (const u of urls) {
        if (!(await cache.match(u))) await cache.add(u).catch(() => {});
      }
      await trim(MEDIA, MEDIA_MAX);
    }),
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
