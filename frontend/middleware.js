// Vercel Routing Middleware (runs before the cache, on every request to this project).
// The admin site (admin.*) opens only on its private address: https://admin.balyiq.site/<ADMIN_PATH_KEY>
// ADMIN_PATH_KEY is a long random Vercel env var (never written in this public repo).
// Any other page on the admin host gets a plain 404. The public store is not touched.
export const config = { runtime: "nodejs" };

// files the panel loads; the public store serves the very same files, so they hide nothing
const PUBLIC_FILE = /^\/(?:static\/|images\/|_vercel\/|(?:sw\.js|version\.json|staticData\.json|asset-manifest\.json|favicon\.ico|(?:admin-)?favicon-\d+\.png|(?:admin-)?icon-(?:maskable-)?\d+\.png|(?:admin-)?apple-touch-icon\.png|robots\.txt)$)/;

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

const notFound = () =>
  new Response("<!doctype html><meta charset=utf-8><title>404</title><p>404</p>", {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", ...PRIVATE_HEADERS },
  });

// same as rewrite() from @vercel/functions, without adding a dependency
const rewriteTo = (url, headers = {}) =>
  new Response(null, { headers: { ...headers, "x-middleware-rewrite": url.toString() } });

// The admin's own home-screen app («الأدمن», green icon), separate from the store app.
// It is served only under the private address (/<key>/manifest.webmanifest), so the key
// never shows on a public URL; /manifest.json on the admin host is a 404.
const adminManifest = (key) =>
  new Response(
    JSON.stringify({
      id: `/${key}`,
      name: "الأدمن",
      short_name: "الأدمن",
      description: "لوحة إدارة صيدلية أيمن",
      lang: "ar",
      dir: "rtl",
      start_url: `/${key}`,
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#16a34a",
      icons: [
        { src: "/admin-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/admin-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/admin-icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/admin-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    }),
    { headers: { "Content-Type": "application/manifest+json; charset=utf-8", ...PRIVATE_HEADERS } },
  );

export default function middleware(request) {
  const url = new URL(request.url);
  if (!/^admin\./i.test(url.hostname)) return; // the store: carry on as usual

  const key = String(process.env.ADMIN_PATH_KEY || "").trim();
  if (key.length < 24) return notFound(); // never open the panel without a proper private key

  const path = url.pathname;
  if (path === `/${key}` || path === `/${key}/`) return rewriteTo(new URL("/index.html", url), PRIVATE_HEADERS);
  if (path === `/${key}/manifest.webmanifest`) return adminManifest(key);
  if (PUBLIC_FILE.test(path)) return;
  return notFound();
}
