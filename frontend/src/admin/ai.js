// AI helpers for the admin panel.
//  - background removal uses an on-device model (no key, no server)
//  - product analysis goes through the XingChi API gateway (xingchiapi.com).
//    The key normally lives on the store's server (ph-api /api/ai); a key saved
//    in this browser is only a fallback for testing before the server is live.
import { apiRequest } from "../ordersApi";

export const GATEWAY_URL = "https://xingchiapi.com";

// Cheapest models first. All of them read images; none of them searches the web
// through the gateway, so the price is the model's own estimate.
export const AI_MODELS = [
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite — الأرخص (مقترح)", format: "gemini" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — رخيص وأدق بقراءة العلب", format: "anthropic" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash — أدق، أغلى شوية", format: "gemini" },
];
export const DEFAULT_AI_MODEL = AI_MODELS[0].id;
export const modelInfo = (id) => AI_MODELS.find((m) => m.id === id) || AI_MODELS[0];

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("تعذّر قراءة الصورة."));
    img.src = src;
  });

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("تعذّر قراءة الصورة."));
    reader.readAsDataURL(blob);
  });

export const dataUrlToBase64 = (dataUrl) => dataUrl.slice(dataUrl.indexOf(",") + 1);

/** Shrinks a photo so it is cheap to send to the AI. Returns a JPEG data URL. */
export const resizeForAnalysis = async (file, maxSide = 1280) => {
  const img = await loadImage(await blobToDataUrl(file));
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
};

/** Finds the bounding box of the non-transparent pixels of a cut-out. */
const opaqueBounds = (img) => {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
};

/** Draws an image centered on a square white canvas. Returns a JPEG data URL. */
const onWhiteSquare = (img, bounds, size = 900, padding = 0.08, clean = true) => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  const box = size * (1 - padding * 2);
  const scale = Math.min(box / bounds.w, box / bounds.h);
  const w = bounds.w * scale;
  const h = bounds.h * scale;
  ctx.imageSmoothingQuality = "high";
  if (clean) enhance(ctx);
  ctx.drawImage(img, bounds.x, bounds.y, bounds.w, bounds.h, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL("image/jpeg", 0.9);
};

/**
 * Cuts the product out of its photo and places it on a clean white square.
 * Returns { dataUrl, removed } — `removed` is false when the AI model could not
 * run and the original photo was just fitted onto white instead.
 */
export const makeWhiteBackground = async (file, onProgress) => {
  try {
    const { removeBackground } = await import("@imgly/background-removal");
    const cutout = await removeBackground(file, {
      output: { format: "image/png" },
      progress: (key, current, total) => {
        if (onProgress && total) onProgress(key.startsWith("fetch") ? "تحميل نموذج الذكاء الاصطناعي" : "إزالة الخلفية", current / total);
      },
    });
    const img = await loadImage(await blobToDataUrl(cutout));
    return { dataUrl: onWhiteSquare(img, opaqueBounds(img)), removed: true };
  } catch (error) {
    const img = await loadImage(await blobToDataUrl(file));
    const bounds = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    return { dataUrl: onWhiteSquare(img, bounds, 900, 0, false), removed: false, error };
  }
};

/** Light clean-up so the product looks like a studio shot. */
const enhance = (ctx) => {
  if ("filter" in ctx) ctx.filter = "brightness(1.04) contrast(1.07) saturate(1.06)";
};

const SCHEMA_PROPS = (categories, skinTypes) => ({
  name_en: { type: "string", description: "Brand + product name + size exactly as printed on the pack, in English. Example: Cosrx Advanced Snail 92 All in One Cream 100g" },
  name_ar: { type: "string", description: "Short Arabic product title for an Iraqi store, with the size. Example: كريم الحلزون كوزركس - 100غرام" },
  description_ar: { type: "string", description: "2-3 short Arabic sentences: what the product is, what it is used for and how. No medical claims, no guarantees, nothing that is not supported by the pack or by what is known about this exact product." },
  brand: { type: "string", description: "Brand name in English as printed." },
  category: { type: "string", enum: categories.map((c) => c.id), description: "The best matching store category id." },
  skin_type: { type: "array", items: { type: "string", enum: skinTypes.map((s) => s.id) }, description: "Skin types the product is meant for. Empty if it is not a face skincare product or the pack does not say." },
  suggested_price_iqd: { type: "integer", description: "Suggested selling price in Iraqi dinars, rounded to the nearest 250, based on what Iraqi shops sell this exact product for. 0 if you could not find a reasonable price." },
  price_note_ar: { type: "string", description: "One short Arabic line on where the price came from (for example: متوسط أسعار متاجر عراقية) or why there is no price. Empty if no note is needed." },
  confident: { type: "boolean", description: "false if the text on the pack was unreadable and the answer is a guess." },
});

/** Request for one gateway call (the server builds the same shape in ph-api/lib/gateway.js). */
const gatewayRequest = (key, model, imageBase64, prompt) => {
  if (modelInfo(model).format === "anthropic") {
    return {
      url: `${GATEWAY_URL}/v1/messages`,
      headers: { "content-type": "application/json", "x-api-key": key, authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01" },
      body: {
        model,
        max_tokens: 2000,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
          { type: "text", text: prompt },
        ] }],
      },
      read: (json) => (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join(""),
    };
  }
  return {
    url: `${GATEWAY_URL}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: { "content-type": "application/json", "x-goog-api-key": key, authorization: `Bearer ${key}` },
    body: {
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: "image/jpeg", data: imageBase64 } }, { text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2000, responseMimeType: "application/json" },
    },
    read: (json) => (((json.candidates || [])[0] || {}).content?.parts || []).map((p) => p.text || "").join(""),
  };
};

const gatewayError = (status) => {
  const err = new Error(
    status === 401 || status === 403 ? "مفتاح xingchiapi غير صحيح أو ما يشمل هذا الموديل."
      : status === 402 ? "الرصيد بحساب xingchiapi خلص."
      : status === 429 ? "طلبات كثيرة على xingchiapi، حاول بعد دقيقة."
      : status === 400 || status === 404 ? "xingchiapi ما قبل هذا الموديل. جرّب موديل ثاني من الإعدادات."
      : `خطأ من xingchiapi (${status}).`
  );
  err.status = status;
  return err;
};

const callGatewayDirect = async (key, model, imageBase64, prompt) => {
  const r = gatewayRequest(key, model, imageBase64, prompt);
  let res;
  try {
    res = await fetch(r.url, { method: "POST", headers: r.headers, body: JSON.stringify(r.body) });
  } catch (e) {
    throw new Error("تعذّر الاتصال بـ xingchiapi من المتصفح. ينفع بعد ما ينحفظ المفتاح بالسيرفر.");
  }
  if (!res.ok) throw gatewayError(res.status);
  return r.read(await res.json());
};

const callServer = async (token, model, imageBase64, prompt) => {
  const out = await apiRequest("/api/ai", { method: "POST", token, body: { model, imageBase64, prompt }, timeoutMs: 60000 });
  return out.text || "";
};

/** Does the store's server hold the gateway key? (false while ph-api is not deployed) */
export const serverAiAvailable = async () => {
  try {
    const out = await apiRequest("/api/ai", { timeoutMs: 6000 });
    return !!out.enabled;
  } catch (e) {
    return false;
  }
};

/** Pulls the first JSON object out of a model answer (it may be wrapped in ``` fences or text). */
export const extractJson = (text) => {
  const t = String(text || "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(t.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch (e) {
    return null;
  }
};

/** Keeps only the expected fields, with safe types and lengths. */
export const cleanListing = (raw, categories, skinTypes) => {
  const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
  const price = Math.round(Number(raw.suggested_price_iqd) || 0);
  return {
    name_en: str(raw.name_en, 160),
    name_ar: str(raw.name_ar, 160),
    description_ar: str(raw.description_ar, 1200),
    brand: str(raw.brand, 60),
    category: categories.some((c) => c.id === raw.category) ? raw.category : "",
    skin_type: Array.isArray(raw.skin_type) ? raw.skin_type.filter((s) => skinTypes.some((t) => t.id === s)) : [],
    suggested_price_iqd: price > 0 && price < 10000000 ? Math.round(price / 250) * 250 : 0,
    price_note_ar: str(raw.price_note_ar, 200),
    confident: raw.confident !== false,
  };
};

/**
 * Asks the model to read the product photo and fill in the listing. Nothing is
 * saved here: the admin reviews the form and approves it. The price is the
 * model's own estimate (no web search through the gateway).
 */
export const analyzeProduct = async ({ serverToken, browserKey, model, imageDataUrl, categories, skinTypes }) => {
  const chosen = modelInfo(model).id;
  const props = SCHEMA_PROPS(categories, skinTypes);
  const fields = Object.entries(props).map(([k, v]) => `- ${k} (${v.type}${v.enum ? `: one of ${v.enum.join(", ")}` : ""}): ${v.description}`).join("\n");
  const prompt =
    "This is a photo of a product for an Iraqi online beauty and skincare pharmacy. " +
    "Read the text printed on the packaging and identify the exact product. " +
    "Suggest a price in IQD only if you know what this exact product usually sells for in Iraq; otherwise give 0. " +
    "Describe only what the pack shows or what is reliably known about this exact product. " +
    `Answer with ONE JSON object only, no other text, with exactly these fields:\n${fields}\n\n` +
    `Store categories:\n${categories.map((c) => `${c.id} = ${c.name}`).join("\n")}\n\n` +
    `Skin types:\n${skinTypes.map((s) => `${s.id} = ${s.name}`).join("\n")}`;
  const imageBase64 = dataUrlToBase64(imageDataUrl);
  const text = serverToken
    ? await callServer(serverToken, chosen, imageBase64, prompt)
    : await callGatewayDirect(browserKey, chosen, imageBase64, prompt);
  const parsed = extractJson(text);
  if (!parsed) throw new Error("الذكاء الاصطناعي ما رجّع بيانات المنتج. حاول بصورة أوضح.");
  return { ...cleanListing(parsed, categories, skinTypes), searched: false };
};
