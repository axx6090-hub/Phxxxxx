// POST /api/link — admin only: reads a product page so the admin can add the
// product from its link. body { url } -> { final_url, title, description, brand,
// price, currency, images, image_data, text }
// The page is fetched by safeFetch (public addresses only). Its content is data
// for the admin to review; nothing is saved here.
import { route, readBody, HttpError } from "../lib/http.js";
import { requireAdmin } from "../lib/auth.js";
import { safeFetch, FetchBlocked } from "../lib/safeFetch.js";
import { extractProductPage } from "../lib/pageMeta.js";

const MAX_IMAGE_BYTES = 2_500_000; // stays under the 4.5 MB response limit as base64
const IMAGE_TYPES = /^image\/(jpeg|jpg|png|webp|gif|avif)\b/;

const recent = new Map();
const rateLimit = (who) => {
  const now = Date.now();
  const hits = (recent.get(who) || []).filter((t) => now - t < 60 * 1000);
  if (hits.length >= 20) throw new HttpError(429, "طلبات كثيرة، حاول بعد دقيقة.");
  hits.push(now);
  recent.set(who, hits);
};

const fetchImage = async (url) => {
  try {
    const r = await safeFetch(url, { accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5", maxBytes: MAX_IMAGE_BYTES, timeoutMs: 10000 });
    if (r.status !== 200 || !IMAGE_TYPES.test(r.contentType) || !r.body.length) return "";
    return `data:${r.contentType.split(";")[0]};base64,${r.body.toString("base64")}`;
  } catch (e) {
    return "";
  }
};

export default route({
  POST: async (req) => {
    await requireAdmin(req);
    rateLimit("admin");
    const url = String(readBody(req).url || "").trim();
    if (!url || url.length > 2000) throw new HttpError(400, "الرابط غير صحيح.");

    let page;
    try {
      page = await safeFetch(url, { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", maxBytes: 3_000_000, timeoutMs: 15000 });
    } catch (e) {
      if (e instanceof FetchBlocked) throw new HttpError(400, e.message === "too big" ? "صفحة المنتج كبيرة كلش." : "هذا الرابط ما ينقرا (لازم رابط صفحة عامة يبدي بـ https).");
      throw new HttpError(502, "ما گدرنا نفتح صفحة المنتج. تأكد من الرابط وجرب مرة ثانية.");
    }
    if (page.status === 403 || page.status === 429 || page.status === 503) throw new HttpError(502, "الموقع منع قراءة الصفحة. احفظ صورة المنتج وأضفه بالصورة.");
    if (page.status !== 200) throw new HttpError(502, `صفحة المنتج رجعت خطأ (${page.status}).`);
    if (!/html|xml/.test(page.contentType)) throw new HttpError(400, "الرابط مو صفحة منتج.");

    const info = extractProductPage(page.body.toString("utf8"), page.finalUrl);
    let image_data = "";
    for (const src of info.images.slice(0, 3)) {
      image_data = await fetchImage(src);
      if (image_data) break;
    }
    return { final_url: page.finalUrl, ...info, image_data };
  },
});
