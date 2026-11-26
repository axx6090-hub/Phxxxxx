// Brand pages: one slug per brand, so "COSRX" and "Cosrx" land on the same page.
export const brandSlug = (brand) => String(brand || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, "-").replace(/^-+|-+$/g, "");

// [{ slug, name, count, image }] sorted by how many products each brand has
export const listBrands = (products) => {
  const map = new Map();
  for (const p of products) {
    const slug = brandSlug(p.brand);
    if (!slug) continue;
    const b = map.get(slug) || { slug, name: String(p.brand).trim(), count: 0, image: "" };
    b.count += 1;
    if (!b.image && p.image && !/placeholder/.test(p.image) && p.out_of_stock !== true) b.image = p.image;
    map.set(slug, b);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};
