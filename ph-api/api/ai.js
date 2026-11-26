// GET  /api/ai          — public: { enabled } tells the admin panel whether the gateway key is set
// GET  /api/ai?probe=1  — admin only: lists the gateway's models for this key and tests which one answers
// POST /api/ai          — admin only: reads a product photo (and/or page text) through the XingChi gateway
//   body { imageBase64?, prompt } -> { text, model }
// The key comes from the XINGCHI_API_KEY env var and never leaves the server.
// The server picks the model itself: it asks the gateway which models the key
// may use, tries the cheapest vision models first and remembers the first one
// that answers, so a model the key's group does not serve can't break the panel.
import { route, readBody, HttpError } from "../lib/http.js";
import { requireAdmin } from "../lib/auth.js";
import { readJson, writeJson } from "../lib/store.js";

const BASE_URL = () => (process.env.XINGCHI_BASE_URL || "https://xingchiapi.com").replace(/\/+$/, "");
const MAX_IMAGE_CHARS = 3_000_000; // ~2.2 MB JPEG, well under the 4.5 MB body limit
const MAX_PROMPT_CHARS = 14000; // room for a product page's text
const STATE_PATH = "admin/ai-model.json";
const BUDGET_MS = 52000; // the function may run 60 s

// Known model names, cheapest first. Used when the gateway does not list its models.
const FALLBACK = [
  "claude-haiku-4-5-20251001", "claude-haiku-4-5", "gemini-2.5-flash", "gpt-4.1-mini", "gpt-4o-mini",
  "claude-sonnet-4-5-20250929", "claude-sonnet-4-5", "gemini-2.5-flash-lite", "gemini-3-flash-preview",
  "gpt-5-mini", "claude-sonnet-4-20250514", "gemini-2.0-flash", "claude-haiku-5-5", "claude-sonnet-5-5",
];
const PREFER = [/haiku/i, /gemini-[\d.]+-flash(?!-lite)/i, /4\.1-mini|4o-mini/i, /flash-lite/i, /gpt-5(\.\d)?-mini/i, /sonnet/i, /gemini-[\d.]+-pro/i, /gpt-5|gpt-4/i, /opus/i];
const SKIP = /image|imagen|embed|tts|audio|whisper|dall|veo|sora|realtime|transcribe|moderation|codex|search|computer|live|thinking/i;

const formatFor = (model) => (/claude/i.test(model) ? "anthropic" : /gemini/i.test(model) ? "gemini" : "openai");

const rank = (id) => {
  const i = PREFER.findIndex((re) => re.test(id));
  return i < 0 ? PREFER.length : i;
};

// best-effort limit per admin per server instance
const recent = new Map();
const rateLimit = (who) => {
  const now = Date.now();
  const hits = (recent.get(who) || []).filter((t) => now - t < 60 * 1000);
  if (hits.length >= 10) throw new HttpError(429, "طلبات كثيرة، حاول بعد دقيقة.");
  hits.push(now);
  recent.set(who, hits);
};

const authHeaders = (key) => ({ authorization: `Bearer ${key}`, "x-api-key": key, "x-goog-api-key": key });

const buildRequest = (key, model, imageBase64, prompt, maxTokens = 2000) => {
  const format = formatFor(model);
  if (format === "anthropic") {
    return {
      url: `${BASE_URL()}/v1/messages`,
      headers: { "content-type": "application/json", ...authHeaders(key), "anthropic-version": "2023-06-01" },
      body: {
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: [
          ...(imageBase64 ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } }] : []),
          { type: "text", text: prompt },
        ] }],
      },
      read: (json) => (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join(""),
    };
  }
  if (format === "gemini") {
    return {
      url: `${BASE_URL()}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { "content-type": "application/json", ...authHeaders(key) },
      body: {
        contents: [{ role: "user", parts: [...(imageBase64 ? [{ inline_data: { mime_type: "image/jpeg", data: imageBase64 } }] : []), { text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens },
      },
      read: (json) => (((json.candidates || [])[0] || {}).content?.parts || []).map((p) => p.text || "").join(""),
    };
  }
  // OpenAI models: this gateway only serves the Responses API
  return {
    url: `${BASE_URL()}/v1/responses`,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...authHeaders(key) },
    body: {
      model,
      instructions: "You help an online pharmacy fill in product listings. Follow the user's format exactly.",
      store: false,
      stream: true,
      input: [{ role: "user", content: [
        { type: "input_text", text: prompt },
        ...(imageBase64 ? [{ type: "input_image", image_url: `data:image/jpeg;base64,${imageBase64}` }] : []),
      ] }],
    },
    read: readResponses,
  };
};

/** Text of a Responses API answer, from a JSON body or from its event stream. */
const responseText = (resp) => {
  if (!resp || typeof resp !== "object") return "";
  if (typeof resp.output_text === "string" && resp.output_text) return resp.output_text;
  return (resp.output || [])
    .flatMap((o) => (Array.isArray(o.content) ? o.content : []))
    .filter((c) => c && (c.type === "output_text" || c.type === "text"))
    .map((c) => c.text || "")
    .join("");
};
const readResponses = (raw) => {
  const t = String(raw || "");
  if (!/^\s*(event:|data:)/m.test(t)) {
    try {
      return responseText(JSON.parse(t));
    } catch (e) {
      return "";
    }
  }
  let deltas = "";
  let final = "";
  for (const line of t.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let ev;
    try {
      ev = JSON.parse(data);
    } catch (e) {
      continue;
    }
    if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") deltas += ev.delta;
    else if ((ev.type === "response.completed" || ev.type === "response.done") && ev.response) final = responseText(ev.response) || final;
  }
  return final || deltas;
};

const gatewayMessage = (status) =>
  status === 401 ? "مفتاح xingchiapi غير صحيح."
    : status === 402 ? "الرصيد بحساب xingchiapi خلص."
    : status === 429 ? "طلبات كثيرة على xingchiapi، حاول بعد دقيقة."
    : status === 400 || status === 403 || status === 404 ? "xingchiapi ما قبل أي موديل بهذا المفتاح."
    : `خطأ من xingchiapi (${status}).`;

const snippet = (t) => String(t || "").replace(/\s+/g, " ").replace(/sk-[A-Za-z0-9_-]+/g, "sk-…").slice(0, 240);

/** Model ids the key may use, from GET /v1/models (OpenAI or Gemini shape). [] when not listed. */
let listedCache = null;
const listModels = async (key) => {
  if (listedCache && Date.now() - listedCache.at < 10 * 60 * 1000) return listedCache.ids;
  const ids = new Set();
  for (const path of ["/v1/models", "/v1beta/models"]) {
    try {
      const res = await fetch(`${BASE_URL()}${path}`, { headers: { ...authHeaders(key), "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json = await res.json();
      for (const m of json.data || []) if (m && m.id) ids.add(String(m.id));
      for (const m of json.models || []) if (m && m.name) ids.add(String(m.name).replace(/^models\//, ""));
    } catch (e) {
      /* not listed here */
    }
  }
  const list = [...ids].filter((id) => !SKIP.test(id));
  listedCache = { at: Date.now(), ids: list };
  return list;
};

/** Models to try, best first: the remembered one, then listed ones by preference, then known names. */
let remembered = null;
const candidates = async (key) => {
  if (remembered === null) {
    const saved = await readJson(STATE_PATH, null).catch(() => null);
    remembered = saved && typeof saved.model === "string" ? saved.model : "";
  }
  const listed = await listModels(key);
  const ordered = listed.length ? [...listed].sort((a, b) => rank(a) - rank(b)) : FALLBACK;
  const all = [process.env.XINGCHI_MODEL, remembered, ...ordered].filter(Boolean);
  return { list: [...new Set(all)], listed };
};

const remember = async (model) => {
  if (remembered === model) return;
  remembered = model;
  await writeJson(STATE_PATH, { model, at: new Date().toISOString() }).catch(() => {});
};

/** One gateway call. Returns { ok, status, text, error }. */
const callOnce = async (key, model, imageBase64, prompt, timeoutMs, maxTokens) => {
  const r = buildRequest(key, model, imageBase64, prompt, maxTokens);
  let res;
  try {
    res = await fetch(r.url, { method: "POST", headers: r.headers, body: JSON.stringify(r.body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { ok: false, status: 0, error: e && e.name === "TimeoutError" ? "timeout" : "network" };
  }
  const raw = await res.text().catch(() => "");
  if (!res.ok) return { ok: false, status: res.status, error: snippet(raw) };
  let text;
  if (r.read === readResponses) {
    text = String(readResponses(raw) || "");
  } else {
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      return { ok: false, status: 502, error: "not json" };
    }
    text = String(r.read(json) || "");
  }
  if (!text.trim()) return { ok: false, status: 502, error: `empty answer: ${snippet(raw)}` };
  return { ok: true, status: res.status, text };
};

// a model the key can't use: try the next one. Key, credit and rate errors stop the loop.
const tryNext = (status) => status === 400 || status === 403 || status === 404 || status === 422 || status === 502 || status === 503 || status === 500 || status === 0;

const askGateway = async (key, imageBase64, prompt, { maxTokens = 2000, maxTries = 5 } = {}) => {
  const started = Date.now();
  const { list } = await candidates(key);
  const tried = [];
  for (const model of list.slice(0, maxTries)) {
    const left = BUDGET_MS - (Date.now() - started);
    if (left < 8000) break;
    const out = await callOnce(key, model, imageBase64, prompt, Math.min(left, 45000), maxTokens);
    tried.push({ model, status: out.status, error: out.error || "" });
    if (out.ok) {
      await remember(model);
      return { text: out.text.slice(0, 20000), model, tried };
    }
    console.error("xingchi gateway", model, out.status, out.error); // no key, no image
    if (remembered === model) remembered = "";
    if (!tryNext(out.status)) break;
  }
  const last = tried[tried.length - 1];
  const status = last ? last.status : 0;
  const message = !last ? "ما ضل وقت نجرب موديل." : status === 0 ? "تعذّر الاتصال بـ xingchiapi." : gatewayMessage(status);
  const err = new HttpError(status === 429 ? 429 : status === 401 || status === 402 ? 400 : 502, message);
  err.tried = tried;
  throw err;
};

export default route({
  GET: async (req) => {
    const url = new URL(req.url, "https://x");
    if (url.searchParams.get("probe") !== "1") return { enabled: !!process.env.XINGCHI_API_KEY };
    await requireAdmin(req);
    const key = process.env.XINGCHI_API_KEY;
    if (!key) throw new HttpError(503, "مفتاح xingchiapi مو محطوط بالسيرفر.");
    listedCache = null;
    const { list, listed } = await candidates(key);
    try {
      const out = await askGateway(key, "", "Reply with the single word OK.", { maxTokens: 20, maxTries: 8 });
      return { listed, order: list.slice(0, 12), working: out.model, tried: out.tried };
    } catch (e) {
      return { listed, order: list.slice(0, 12), working: "", tried: e.tried || [], error: e.message };
    }
  },
  POST: async (req) => {
    await requireAdmin(req);
    const key = process.env.XINGCHI_API_KEY;
    if (!key) throw new HttpError(503, "مفتاح xingchiapi مو محطوط بالسيرفر.");
    rateLimit("admin");
    const body = readBody(req);
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    if (imageBase64 && (imageBase64.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(imageBase64))) throw new HttpError(400, "الصورة غير صالحة أو كبيرة.");
    const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, MAX_PROMPT_CHARS) : "";
    if (!prompt) throw new HttpError(400, "الطلب ناقص.");
    const out = await askGateway(key, imageBase64, prompt);
    return { text: out.text, model: out.model };
  },
});
