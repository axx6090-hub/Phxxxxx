import hosts from "../imageHosts.json";

// Product photos go through Vercel's image optimizer: resized to the size shown and
// sent as WebP, cached on the CDN. Anywhere else (local dev, GitHub Pages) the original is used.
const HOSTS = new Set(hosts);
const SIZES = [256, 640, 1080];
const onVercel = () => {
  try { return /(^|\.)balyiq\.site$|\.vercel\.app$/.test(window.location.hostname); } catch (e) { return false; }
};

export const optimized = (src, w) => {
  if (!src || !onVercel()) return src;
  let url = "";
  if (/^\.?\/images\//.test(src)) url = src.replace(/^\./, "");
  else {
    try {
      const u = new URL(src);
      if (u.protocol === "https:" && HOSTS.has(u.hostname)) url = src;
    } catch (e) { /* not a URL */ }
  }
  if (!url || /\.svg(\?|#|$)/i.test(url)) return src;
  const width = SIZES.find((s) => s >= w) || SIZES[SIZES.length - 1];
  return `/_vercel/image?url=${encodeURIComponent(url)}&w=${width}&q=75`;
};

// If the optimizer can't fetch a photo, show the original instead of a broken image.
export const fallbackTo = (src) => (e) => {
  const img = e.currentTarget;
  if (img.dataset.fallback || !src) return;
  img.dataset.fallback = "1";
  img.src = src;
};
