// Brand pages: one slug per brand, so "COSRX" and "Cosrx" land on the same page.
export const brandSlug = (brand) => String(brand || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "-").replace(/^-+|-+$/g, "");

// A file name that is safe on GitHub and in URLs, even for an Arabic brand name.
export const brandFileName = (slug) => (/^[a-z0-9-]+$/.test(slug)
  ? slug
  : `brand-${Array.from(String(slug)).map((c) => c.codePointAt(0).toString(36)).join("").slice(0, 48)}`);

// data.brands = [{ slug, name, logo }] holds each brand's official logo (no product photos)
export const brandEntry = (brands, slug) => (Array.isArray(brands) ? brands : []).find((b) => b && b.slug === slug) || null;

// [{ slug, name, count, logo }] sorted by how many products each brand has
export const listBrands = (products, brands) => {
  const map = new Map();
  for (const p of products || []) {
    const slug = brandSlug(p.brand);
    if (!slug) continue;
    const b = map.get(slug) || { slug, name: String(p.brand).trim(), count: 0, logo: "" };
    b.count += 1;
    map.set(slug, b);
  }
  for (const b of map.values()) {
    const e = brandEntry(brands, b.slug);
    if (e && e.logo) b.logo = String(e.logo);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};
