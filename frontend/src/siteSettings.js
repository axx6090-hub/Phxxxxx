// Store-wide settings. The admin panel edits them (tab «إعدادات الموقع») and saves
// them in staticData.json under "settings"; anything missing falls back to these defaults.
import staticData from "./staticData.json";

export const DEFAULT_SETTINGS = {
  storeName: "صيدلية أيمن",
  whatsapp: "9647832882348",
  deliveryFee: 5000, // when the customer picks delivery at checkout (delivery is optional)
  announcement: "🚚 توصيل لكافة محافظات العراق بـ 5,000 د.ع فقط  •  ✨ منتجات أصلية 100%  •  💕 اطلبي الحين عبر واتساب",
  footerText: "براند مميز لمنتجات العناية بالبشرة في العراق - منتجات مضمونة وتوصيل سريع 💕",
  showSocialProof: true,
  // «اختاري روتينج» tiles on the home page; hidden unless the admin turns them back on.
  showRoutine: false,
  navLinks: [
    { name: "العروض", to: "/collection/offers" },
    { name: "الأكثر طلباً", to: "/collection/best-selling" },
    { name: "مرطبات", to: "/collection/category-moisturizer" },
    { name: "فازلين", to: "/collection/category-vaseline" },
    { name: "واقي شمس", to: "/collection/category-sunscreen" },
    { name: "سيروم", to: "/collection/category-serum" },
    { name: "غسول", to: "/collection/category-cleansers" },
  ],
  // Empty by default: the home page shows no banner until the admin adds one.
  banners: [],
  features: [],
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
