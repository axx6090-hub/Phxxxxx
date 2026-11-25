// Reads the live product catalog so prices are checked on the server and a
// customer cannot change what they pay by editing the page.
const URL_ = process.env.CATALOG_URL || "https://balyiq.site/staticData.json";
let cached = null;
let cachedSettings = {};
let cachedAt = 0;

export const loadCatalog = async () => {
  if (cached && Date.now() - cachedAt < 60 * 1000) return cached;
  try {
    const res = await fetch(URL_, { headers: { "User-Agent": "ph-orders-api" } });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    cached = new Map((data.products || []).map((p) => [p.id, p]));
    cachedSettings = data.settings && typeof data.settings === "object" ? data.settings : {};
    cachedAt = Date.now();
  } catch (e) {
    console.error("catalog fetch failed", e.message);
  }
  return cached; // may be null when GitHub is unreachable
};

// Delivery fee set from the admin panel (settings.deliveryFee), else the env/default.
export const deliveryFee = (fallback) => {
  const fee = Number(cachedSettings.deliveryFee);
  return Number.isFinite(fee) && fee >= 0 ? Math.round(fee) : fallback;
};
