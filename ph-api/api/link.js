// POST /api/link — admin only: reads a product page so the admin can add the
// product from its link. body { url } -> { final_url, title, description, brand,
// price, currency, images, image_data, image_src, image_has_person, text }
// The photo chosen is the first one that shows the product alone: each candidate
// is checked by a Groq vision model, and photos with a person or model are skipped.
// The page is fetched by safeFetch (public addresses only). Its content is data
// for the admin to review; nothing is saved here.
import { route, readBody, HttpError } from "../lib/http.js";
import { requireAdmin } from "../lib/auth.js";
import { safeFetch, FetchBlocked } from "../lib/safeFetch.js";
import { extractProductPage } from "../lib/pageMeta.js";
import { askGroq, groqKey } from "../lib/groq.js";

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

// A Shopify product page lists every gallery photo at <page>.js; the first is
// usually the packshot. Other shops return nothing here.
const shopifyImages = async (pageUrl) => {
  try {
    const u = new URL(pageUrl);
    const m = u.pathname.match(/^(.*\/products\/[^/?#]+?)\/?$/);
    if (!m) return [];
    const r = await safeFetch(`${u.origin}${m[1]}.js`, { accept: "application/json", maxBytes: 1_500_000, timeoutMs: 8000 });
    if (r.status !== 200) return [];
    const p = JSON.parse(r.body.toString("utf8"));
    return (Array.isArray(p.images) ? p.images : [])
      .map((i) => (typeof i === "string" ? i : i && i.src) || "")
      .filter(Boolean)
      .map((i) => (i.startsWith("//") ? `https:${i}` : i))
      .slice(0, 8);
  } catch (e) {
    return [];
  }
};

const PERSON_PROMPT =
  "Look at this product photo. Does it show a person or any part of a person (face, skin, hand, body, model)? " +
  "Answer with one word only: yes or no.";

// true / false, or null when it can't be checked (no key, Groq down, format Groq can't read)
const showsPerson = async (key, dataUrl) => {
  if (!key || /^data:image\/(avif|gif)/.test(dataUrl)) return null;
  try {
    const out = await askGroq(key, dataUrl, PERSON_PROMPT, { maxTokens: 1500, budgetMs: 10000 });
    const a = out.text.trim().toLowerCase();
    if (/^(yes|نعم)\b/.test(a)) return true;
    if (/^(no|لا)\b/.test(a)) return false;
    return null;
  } catch (e) {
    return null;
  }
};

// Fetches candidates in order and keeps the first that shows no person.
// Falls back to the first photo it could fetch, flagged when it had a person.
const pickProductImage = async (candidates) => {
  const key = groqKey();
  const started = Date.now();
  let first = null;
  let checked = 0;
  for (const src of candidates.slice(0, 8)) {
    if (Date.now() - started > 22000) break;
    const image_data = await fetchImage(src);
    if (!image_data) continue;
    if (!first) first = { image_data, image_src: src, image_has_person: false };
    if (checked >= 5) break;
    checked++;
    const person = await showsPerson(key, image_data);
    if (person === false) return { image_data, image_src: src, image_has_person: false };
    if (person === null) return first.image_src === src ? first : { image_data, image_src: src, image_has_person: false };
    if (first.image_src === src) first.image_has_person = true;
  }
  return first || { image_data: "", image_src: "", image_has_person: false };
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
    const candidates = [...new Set([...(await shopifyImages(page.finalUrl)), ...info.images])];
    const picked = await pickProductImage(candidates);
    return { final_url: page.finalUrl, ...info, images: candidates.slice(0, 8), ...picked };
  },
});
