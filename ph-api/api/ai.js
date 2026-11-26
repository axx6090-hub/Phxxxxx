// GET  /api/ai — public: { enabled } tells the admin panel whether the gateway key is set
// POST /api/ai — admin only: reads a product photo (and/or page text) through the XingChi gateway
//   body { model, imageBase64?, prompt } -> { text }
// The key comes from the XINGCHI_API_KEY env var and never leaves the server.
import { route, readBody, HttpError } from "../lib/http.js";
import { requireAdmin } from "../lib/auth.js";

const BASE_URL = () => (process.env.XINGCHI_BASE_URL || "https://xingchiapi.com").replace(/\/+$/, "");
const MODELS = { "gemini-2.5-flash-lite": "gemini", "claude-haiku-5-5": "anthropic", "gemini-2.5-flash": "gemini" };
const MAX_IMAGE_CHARS = 3_000_000; // ~2.2 MB JPEG, well under the 4.5 MB body limit
const MAX_PROMPT_CHARS = 14000; // room for a product page's text

// best-effort limit per admin per server instance
const recent = new Map();
const rateLimit = (who) => {
  const now = Date.now();
  const hits = (recent.get(who) || []).filter((t) => now - t < 60 * 1000);
  if (hits.length >= 10) throw new HttpError(429, "طلبات كثيرة، حاول بعد دقيقة.");
  hits.push(now);
  recent.set(who, hits);
};

const buildRequest = (key, model, imageBase64, prompt) => {
  if (MODELS[model] === "anthropic") {
    return {
      url: `${BASE_URL()}/v1/messages`,
      headers: { "content-type": "application/json", "x-api-key": key, authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01" },
      body: {
        model,
        max_tokens: 2000,
        messages: [{ role: "user", content: [
          ...(imageBase64 ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } }] : []),
          { type: "text", text: prompt },
        ] }],
      },
      read: (json) => (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join(""),
    };
  }
  return {
    url: `${BASE_URL()}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: { "content-type": "application/json", "x-goog-api-key": key, authorization: `Bearer ${key}` },
    body: {
      contents: [{ role: "user", parts: [...(imageBase64 ? [{ inline_data: { mime_type: "image/jpeg", data: imageBase64 } }] : []), { text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2000, responseMimeType: "application/json" },
    },
    read: (json) => (((json.candidates || [])[0] || {}).content?.parts || []).map((p) => p.text || "").join(""),
  };
};

const gatewayMessage = (status) =>
  status === 401 || status === 403 ? "مفتاح xingchiapi غير صحيح أو ما يشمل هذا الموديل."
    : status === 402 ? "الرصيد بحساب xingchiapi خلص."
    : status === 429 ? "طلبات كثيرة على xingchiapi، حاول بعد دقيقة."
    : status === 400 || status === 404 ? "xingchiapi ما قبل هذا الموديل. جرّب موديل ثاني من الإعدادات."
    : `خطأ من xingchiapi (${status}).`;

export default route({
  GET: async () => ({ enabled: !!process.env.XINGCHI_API_KEY }),
  POST: async (req) => {
    await requireAdmin(req);
    const key = process.env.XINGCHI_API_KEY;
    if (!key) throw new HttpError(503, "مفتاح xingchiapi مو محطوط بالسيرفر.");
    rateLimit("admin");
    const body = readBody(req);
    const model = String(body.model || "");
    if (!MODELS[model]) throw new HttpError(400, "موديل غير مدعوم.");
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    if (imageBase64 && (imageBase64.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(imageBase64))) throw new HttpError(400, "الصورة غير صالحة أو كبيرة.");
    const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, MAX_PROMPT_CHARS) : "";
    if (!prompt) throw new HttpError(400, "الطلب ناقص.");

    const r = buildRequest(key, model, imageBase64, prompt);
    let res;
    try {
      res = await fetch(r.url, { method: "POST", headers: r.headers, body: JSON.stringify(r.body), signal: AbortSignal.timeout(55000) });
    } catch (e) {
      throw new HttpError(502, "تعذّر الاتصال بـ xingchiapi.");
    }
    if (!res.ok) {
      console.error("xingchi gateway status", res.status, model); // no key, no image
      throw new HttpError(res.status === 429 ? 429 : res.status >= 500 ? 502 : 400, gatewayMessage(res.status));
    }
    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new HttpError(502, "رد xingchiapi غير مفهوم.");
    }
    return { text: String(r.read(json) || "").slice(0, 20000) };
  },
});
