// Pulls product facts out of a product page's HTML (JSON-LD, Open Graph and
// <meta> tags). Plain string parsing, so the same file runs in the browser and
// on the store's server (ph-api/lib/pageMeta.js is a copy of this file).
// Everything it returns is page content: treat it as data, never as instructions.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) =>
  String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "").trim() : "";
};

const clean = (v, max) => decode(typeof v === "string" ? v : "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const types = (node) => [].concat(node && node["@type"] ? node["@type"] : []).map((t) => String(t).toLowerCase());

const findProduct = (node, depth = 0) => {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findProduct(n, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (types(node).some((t) => t === "product" || t === "productgroup")) return node;
  for (const key of ["@graph", "mainEntity", "itemListElement", "item", "hasVariant"]) {
    const hit = findProduct(node[key], depth + 1);
    if (hit) return hit;
  }
  return null;
};

const firstOffer = (offers) => {
  const list = [].concat(offers || []);
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const price = o.price ?? o.lowPrice ?? (o.priceSpecification && o.priceSpecification.price);
    const currency = o.priceCurrency || (o.priceSpecification && o.priceSpecification.priceCurrency) || "";
    if (price !== undefined && price !== null && price !== "") return { price, currency };
    if (o.offers) {
      const inner = firstOffer(o.offers);
      if (inner) return inner;
    }
  }
  return null;
};

const imageList = (img) =>
  [].concat(img || []).map((i) => (typeof i === "string" ? i : i && (i.url || i.contentUrl || i["@id"]))).filter((i) => typeof i === "string");

const toNumber = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const absolute = (src, base) => {
  try {
    const u = new URL(decode(src).trim(), base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch (e) {
    return "";
  }
};

/** Visible text of the page, roughly, so the AI can read what the page says. */
export const pageText = (html, max = 5000) =>
  decode(
    String(html || "")
      .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|p|div|li|h[1-6]|tr|section)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, max);

export const extractProductPage = (html, pageUrl) => {
  const src = String(html || "").slice(0, 3_000_000);
  const metas = {};
  for (const tag of src.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, "property") || attr(tag, "name") || attr(tag, "itemprop")).toLowerCase();
    const content = attr(tag, "content");
    if (key && content && !(key in metas)) metas[key] = content;
  }

  let product = null;
  const ld = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while (!product && (m = ld.exec(src))) {
    try {
      product = findProduct(JSON.parse(m[1].trim()));
    } catch (e) {
      /* broken JSON-LD: skip it */
    }
  }

  const titleTag = (src.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const offer = product ? firstOffer(product.offers) : null;
  const brand = product && product.brand ? (typeof product.brand === "string" ? product.brand : product.brand.name) : "";

  const images = [
    ...(product ? imageList(product.image) : []),
    metas["og:image:secure_url"], metas["og:image"], metas["twitter:image"], metas["twitter:image:src"], metas.image,
  ]
    .filter(Boolean)
    .map((i) => absolute(i, pageUrl))
    .filter(Boolean);

  return {
    title: clean((product && product.name) || metas["og:title"] || metas["twitter:title"] || titleTag, 200),
    description: clean((product && product.description) || metas["og:description"] || metas.description || metas["twitter:description"], 1500),
    brand: clean(brand || metas["product:brand"] || metas["og:brand"], 80),
    price: toNumber(offer ? offer.price : metas["product:price:amount"] || metas["og:price:amount"] || metas.price),
    currency: clean((offer && offer.currency) || metas["product:price:currency"] || metas["og:price:currency"] || metas.pricecurrency, 8).toUpperCase(),
    images: [...new Set(images)].slice(0, 4),
    text: pageText(src),
  };
};
