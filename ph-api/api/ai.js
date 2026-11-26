// GET  /api/ai          — public: { enabled } tells the admin panel whether the Groq key is set
// GET  /api/ai?probe=1  — admin only: tests the text and vision models with a tiny request
// POST /api/ai          — admin only: reads a product photo (and/or page text) through Groq
//   body { imageBase64?, prompt } -> { text, model }
// The key comes from the GROQ_API_KEY env var and never leaves the server.
// Groq's API is OpenAI-compatible (chat completions). A request with a photo
// goes to a vision model; text-only requests go to a text model, trying the
// next model in the list when one is not available.
import { route, readBody, HttpError } from "../lib/http.js";
import { requireAdmin } from "../lib/auth.js";

// GROQ_APIKEY is accepted too: that is how the key was saved in Vercel
const groqKey = () => process.env.GROQ_API_KEY || process.env.GROQ_APIKEY || "";
const BASE_URL = () => (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
const MAX_IMAGE_CHARS = 3_000_000; // ~2.2 MB JPEG, well under the 4.5 MB body limit
const MAX_PROMPT_CHARS = 14000; // room for a product page's text
const BUDGET_MS = 52000; // the function may run 60 s

// Current Groq models (console.groq.com/docs, Nov 2026). GROQ_VISION_MODEL / GROQ_TEXT_MODEL override.
const VISION_MODELS = () => [process.env.GROQ_VISION_MODEL, "qwen/qwen3.8-27b"].filter(Boolean);
const TEXT_MODELS = () => [process.env.GROQ_TEXT_MODEL, "openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"].filter(Boolean);

const SYSTEM =
  "You help an Iraqi online pharmacy fill in product listings. Follow the user's format exactly. " +
  "When asked for JSON, answer with one JSON object only.";

// best-effort limit per admin per server instance
const recent = new Map();
const rateLimit = (who) => {
  const now = Date.now();
  const hits = (recent.get(who) || []).filter((t) => now - t < 60 * 1000);
  if (hits.length >= 10) throw new HttpError(429, "طلبات كثيرة، حاول بعد دقيقة.");
  hits.push(now);
  recent.set(who, hits);
};

const snippet = (t) => String(t || "").replace(/\s+/g, " ").replace(/gsk_[A-Za-z0-9_-]+/g, "gsk_…").slice(0, 240);

// Qwen models may think out loud in <think> blocks; keep only the answer.
const clean = (t) => String(t || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "").trim();

const groqMessage = (status) =>
  status === 401 ? "مفتاح Groq غير صحيح."
    : status === 403 ? "حساب Groq ما يسمح بهذا الطلب."
    : status === 413 ? "الصورة كبيرة على Groq."
    : status === 429 ? "وصلت حد الطلبات بحساب Groq، حاول بعد دقيقة."
    : status === 0 ? "تعذّر الاتصال بـ Groq."
    : `خطأ من Groq (${status}).`;

/** One Groq call. Returns { ok, status, text, error }. */
const callOnce = async (key, model, imageBase64, prompt, timeoutMs, maxTokens, json) => {
  const content = imageBase64
    ? [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }]
    : prompt;
  const body = {
    model,
    temperature: 0.2,
    max_completion_tokens: maxTokens,
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content }],
    ...(json ? { response_format: { type: "json_object" } } : {}),
  };
  let res;
  try {
    res = await fetch(`${BASE_URL()}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, status: 0, error: e && e.name === "TimeoutError" ? "timeout" : "network" };
  }
  const raw = await res.text().catch(() => "");
  if (!res.ok) return { ok: false, status: res.status, error: snippet(raw) };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, status: 502, error: "not json" };
  }
  const text = clean((((parsed.choices || [])[0] || {}).message || {}).content);
  if (!text) return { ok: false, status: 502, error: `empty answer: ${snippet(raw)}` };
  return { ok: true, status: res.status, text };
};

// model missing, bad request for this model, or Groq busy: try the next model.
const tryNext = (status, error) =>
  [0, 400, 404, 422, 500, 502, 503].includes(status) ||
  /model_not_found|model_decommissioned|does not exist|json_validate_failed/i.test(error || "");

const askGroq = async (key, imageBase64, prompt, { maxTokens = 2000 } = {}) => {
  const started = Date.now();
  const wantsJson = /json/i.test(prompt);
  const list = [...new Set(imageBase64 ? VISION_MODELS() : TEXT_MODELS())];
  const tried = [];
  for (const model of list) {
    for (const json of wantsJson ? [true, false] : [false]) {
      const left = BUDGET_MS - (Date.now() - started);
      if (left < 6000) break;
      const out = await callOnce(key, model, imageBase64, prompt, Math.min(left, 45000), maxTokens, json);
      tried.push({ model, json, status: out.status, error: out.error || "" });
      if (out.ok) return { text: out.text.slice(0, 20000), model, tried };
      console.error("groq", model, json, out.status, out.error); // no key, no image
      if (!tryNext(out.status, out.error)) {
        const err = new HttpError(out.status === 429 ? 429 : out.status === 401 ? 400 : 502, groqMessage(out.status));
        err.tried = tried;
        throw err;
      }
      // only a JSON-mode failure is worth retrying on the same model without JSON mode
      if (!(json && out.status === 400)) break;
    }
  }
  const last = tried[tried.length - 1];
  const err = new HttpError(502, last ? groqMessage(last.status) : "ما ضل وقت نجرب موديل.");
  err.tried = tried;
  throw err;
};

// 64×64 red JPEG, for the probe's vision test (Groq wants 32 px or more)
const TINY_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDn6KKK8Y/SQooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//Z";

export default route({
  GET: async (req) => {
    const url = new URL(req.url, "https://x");
    if (url.searchParams.get("probe") !== "1") return { enabled: !!groqKey() };
    await requireAdmin(req);
    const key = groqKey();
    if (!key) throw new HttpError(503, "مفتاح Groq مو محطوط بالسيرفر.");
    const result = {};
    for (const [name, img, prompt] of [["text", "", "اكتب كلمة واحدة بالعربي: مرحبا"], ["vision", TINY_JPEG, "What colour is this image? One word."]]) {
      try {
        const out = await askGroq(key, img, prompt, { maxTokens: 600 });
        result[name] = { working: out.model, answer: out.text.slice(0, 40), tried: out.tried };
      } catch (e) {
        result[name] = { working: "", error: e.message, tried: e.tried || [] };
      }
    }
    return result;
  },
  POST: async (req) => {
    await requireAdmin(req);
    const key = groqKey();
    if (!key) throw new HttpError(503, "مفتاح Groq مو محطوط بالسيرفر.");
    rateLimit("admin");
    const body = readBody(req);
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    if (imageBase64 && (imageBase64.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(imageBase64))) throw new HttpError(400, "الصورة غير صالحة أو كبيرة.");
    const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, MAX_PROMPT_CHARS) : "";
    if (!prompt) throw new HttpError(400, "الطلب ناقص.");
    const out = await askGroq(key, imageBase64, prompt);
    return { text: out.text, model: out.model };
  },
});
