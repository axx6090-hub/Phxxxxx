// Store-wide settings. The admin panel edits them (tab «إعدادات الموقع») and saves
// them in staticData.json under "settings"; anything missing falls back to these defaults.
import staticData from "./staticData.json";

export const DEFAULT_SETTINGS = {
  storeName: "صيدلية أيمن",
  whatsapp: "9647832882348",
  deliveryFee: 5000,
  announcement: "🚚 توصيل لكافة محافظات العراق بـ 5,000 د.ع فقط  •  ✨ منتجات أصلية 100%  •  💕 اطلبي الحين عبر واتساب",
  footerText: "براند مميز لمنتجات العناية بالبشرة في العراق - منتجات مضمونة وتوصيل سريع 💕",
  showSocialProof: true,
  navLinks: [
    { name: "العروض", to: "/collection/offers" },
    { name: "الأكثر طلباً", to: "/collection/best-selling" },
    { name: "مرطبات", to: "/collection/category-moisturizer" },
    { name: "فازلين", to: "/collection/category-vaseline" },
    { name: "واقي شمس", to: "/collection/category-sunscreen" },
    { name: "سيروم", to: "/collection/category-serum" },
    { name: "غسول", to: "/collection/category-cleansers" },
  ],
  banners: [
    { img: "https://barbiephar.com/cdn/shop/files/2_6d2a305d-94d7-4512-867c-feb17cb5fff1.jpg?v=1778683647", link: "/collection/offers", title: "بلاك فرايدي", subtitle: "خصومات تصل لـ 52%" },
    { img: "https://barbiephar.com/cdn/shop/files/bshrtg-tdoy.jpg?v=1775080334&width=1100", link: "/product/offer-89", title: "بشرتج تضوي", subtitle: "مجموعة الحلزون" },
  ],
  features: [
    { title: "توصيل لكل العراق", desc: "5,000 د.ع لكافة المحافظات" },
    { title: "منتجات أصلية", desc: "مضمونة 100% من المصدر" },
    { title: "أكثر من 500,000", desc: "عميلة سعيدة" },
    { title: "استشارة", desc: "تواصلي عبر واتساب" },
  ],
};

export const mergeSettings = (saved) => {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  ["navLinks", "banners", "features"].forEach((k) => { if (!Array.isArray(s[k])) s[k] = DEFAULT_SETTINGS[k]; });
  s.whatsapp = String(s.whatsapp || DEFAULT_SETTINGS.whatsapp).replace(/[^\d]/g, "");
  const fee = Number(s.deliveryFee);
  s.deliveryFee = Number.isFinite(fee) && fee >= 0 ? Math.round(fee) : DEFAULT_SETTINGS.deliveryFee;
  return s;
};

export const SETTINGS = mergeSettings(staticData.settings);
