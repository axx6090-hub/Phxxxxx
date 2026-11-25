// AI helpers for the admin panel. Everything runs in the admin's own browser:
//  - background removal uses an on-device model (no key, no server)
//  - product analysis calls the Claude API with the admin's own API key
export const AI_MODELS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5 — الأسرع والأرخص" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5 — أدق" },
  { id: "claude-opus-5-5", label: "Opus 5.5 — الأدق والأغلى" },
];
export const DEFAULT_AI_MODEL = AI_MODELS[0].id;

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
const onWhiteSquare = (img, bounds, size = 900, padding = 0.08) => {
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
    return { dataUrl: onWhiteSquare(img, bounds, 900, 0), removed: false, error };
  }
};

/**
 * Asks Claude to read the product photo and fill in the listing.
 * Returns { name_en, name_ar, description_ar, brand, category, skin_type, confident }.
 */
export const analyzeProduct = async ({ apiKey, model, imageDataUrl, categories, skinTypes }) => {
  const categoryList = categories.map((c) => `${c.id} = ${c.name}`).join("\n");
  const skinList = skinTypes.map((s) => `${s.id} = ${s.name}`).join("\n");
  const body = {
    model: model || DEFAULT_AI_MODEL,
    max_tokens: 1024,
    tools: [
      {
        name: "save_product",
        description: "Saves the product listing extracted from the photo.",
        input_schema: {
          type: "object",
          properties: {
            name_en: { type: "string", description: "Brand + product name + size exactly as printed on the pack, in English. Example: Cosrx Advanced Snail 92 All in One Cream 100g" },
            name_ar: { type: "string", description: "Short Arabic product title for an Iraqi store, with the size. Example: كريم الحلزون كوزركس - 100غرام" },
            description_ar: { type: "string", description: "2-3 short Arabic sentences: what the product is, what it is used for and how. No medical claims, no guarantees, nothing that is not supported by the pack." },
            brand: { type: "string", description: "Brand name in English as printed." },
            category: { type: "string", enum: categories.map((c) => c.id), description: "The best matching store category id." },
            skin_type: { type: "array", items: { type: "string", enum: skinTypes.map((s) => s.id) }, description: "Skin types the product is meant for. Empty if it is not a face skincare product or the pack does not say." },
            confident: { type: "boolean", description: "false if the text on the pack was unreadable and the answer is a guess." },
          },
          required: ["name_en", "name_ar", "description_ar", "brand", "category", "skin_type", "confident"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_product" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: dataUrlToBase64(imageDataUrl) } },
          {
            type: "text",
            text:
              "This is a photo of a product for an Iraqi online beauty and skincare store. " +
              "Read the text printed on the packaging and fill in the listing with the save_product tool. " +
              "Describe only what the pack shows or what is generally known about this exact product.\n\n" +
              `Store categories:\n${categoryList}\n\nSkin types:\n${skinList}`,
          },
        ],
      },
    ],
  };

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error("تعذّر الاتصال بخدمة الذكاء الاصطناعي. تأكد من الإنترنت.");
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error("مفتاح الذكاء الاصطناعي غير صحيح.");
    if (res.status === 429) throw new Error("تم تجاوز حد الاستخدام، حاول بعد قليل.");
    if (res.status === 400 || res.status === 402 || res.status === 403) throw new Error("طلب الذكاء الاصطناعي مرفوض — تأكد من الرصيد وصلاحية المفتاح.");
    throw new Error(`خطأ من خدمة الذكاء الاصطناعي (${res.status}).`);
  }
  const json = await res.json();
  const block = (json.content || []).find((b) => b.type === "tool_use");
  if (!block || !block.input) throw new Error("الذكاء الاصطناعي ما رجّع بيانات المنتج. حاول بصورة أوضح.");
  return block.input;
};
