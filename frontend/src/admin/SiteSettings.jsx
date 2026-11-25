// «إعدادات الموقع» tab: everything on the storefront that is not a product or a section.
// Saved in staticData.json under "settings" and published with the «نشر التغييرات» button.
import React, { useRef } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { mergeSettings } from "../siteSettings";

const inputCls = "w-full border-2 border-pink-100 focus:border-pink-400 outline-none rounded-xl px-3 py-2.5 bg-white";
const labelCls = "block text-sm font-medium text-gray-700 mb-1";
const sectionCls = "bg-white border border-pink-100 rounded-3xl p-5 sm:p-7 space-y-4";

const move = (list, i, dir) => {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

const readFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("تعذّر قراءة الصورة."));
    reader.readAsDataURL(file);
  });

/** Fits a banner photo into a 1600px-wide JPEG so it uploads fast. */
const bannerJpeg = async (file) => {
  const src = await readFile(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("تعذّر قراءة الصورة."));
    i.src = src;
  });
  const scale = Math.min(1, 1600 / img.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
};

const ListEditor = ({ items, fields, onChange, addLabel, empty, renderExtra }) => (
  <div className="space-y-3">
    {items.map((item, i) => (
      <div key={i} className="border border-pink-100 rounded-2xl p-3 space-y-2 bg-pink-50/30">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-gray-500">#{i + 1}</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onChange(move(items, i, -1))} disabled={i === 0} className="p-1 text-gray-500 disabled:opacity-30" aria-label="لفوك"><ChevronUp size={18} /></button>
            <button type="button" onClick={() => onChange(move(items, i, 1))} disabled={i === items.length - 1} className="p-1 text-gray-500 disabled:opacity-30" aria-label="لجوه"><ChevronDown size={18} /></button>
            <button type="button" onClick={() => onChange(items.filter((_, k) => k !== i))} className="p-1 text-gray-400 hover:text-red-500" aria-label="حذف"><Trash2 size={18} /></button>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {fields.map(([key, label, opts = {}]) => (
            <div key={key} className={opts.wide ? "sm:col-span-2" : ""}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <input
                value={item[key] || ""}
                onChange={(e) => onChange(items.map((x, k) => (k === i ? { ...x, [key]: e.target.value } : x)))}
                dir={opts.ltr ? "ltr" : undefined}
                placeholder={opts.placeholder || ""}
                className={inputCls}
              />
            </div>
          ))}
        </div>
        {renderExtra && renderExtra(item, i)}
      </div>
    ))}
    {items.length === 0 && <p className="text-sm text-gray-500">{empty}</p>}
    <button type="button" onClick={() => onChange([...items, Object.fromEntries(fields.map(([k]) => [k, ""]))])} className="inline-flex items-center gap-1 text-sm font-bold text-pink-600 hover:underline">
      <Plus size={16} /> {addLabel}
    </button>
  </div>
);

/**
 * props: settings (raw, may be undefined), onChange(nextSettings),
 *        bannerPreviews { [pendingId]: dataUrl }, onBannerImage(pendingId, dataUrl), categories
 */
export const SiteSettings = ({ settings, onChange, bannerPreviews, onBannerImage, categories }) => {
  const s = mergeSettings(settings);
  const fileRefs = useRef({});
  const set = (patch) => onChange({ ...s, ...patch });

  const pickBanner = async (i, file) => {
    if (!file) return;
    const dataUrl = await bannerJpeg(file);
    const pendingId = `banner-${Date.now().toString(36)}`;
    onBannerImage(pendingId, dataUrl);
    set({ banners: s.banners.map((b, k) => (k === i ? { ...b, img: `pending:${pendingId}` } : b)) });
  };

  const linkOptions = [
    ["/collection/offers", "العروض"],
    ["/collection/best-selling", "الأكثر طلباً"],
    ...categories.map((c) => [`/collection/category-${c.slug || c.id}`, c.name]),
  ];

  return (
    <div className="space-y-5" data-testid="admin-site-settings">
      <p className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-2xl p-3">
        أي تعديل هنا ما يظهر للزباين حتى تضغط «نشر التغييرات» فوك.
      </p>

      <div className={sectionCls}>
        <h2 className="text-lg font-bold text-gray-900">المتجر</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>اسم المتجر</label>
            <input value={s.storeName} onChange={(e) => set({ storeName: e.target.value })} className={inputCls} data-testid="admin-store-name" />
          </div>
          <div>
            <label className={labelCls}>رقم الواتساب (بالمفتاح الدولي بدون +)</label>
            <input value={s.whatsapp} onChange={(e) => set({ whatsapp: e.target.value.replace(/[^\d]/g, "") })} dir="ltr" inputMode="numeric" placeholder="9647XXXXXXXXX" className={inputCls} data-testid="admin-whatsapp" />
          </div>
          <div>
            <label className={labelCls}>سعر التوصيل (د.ع) — الزبون يختار التوصيل أو بدونه</label>
            <input value={String(s.deliveryFee)} onChange={(e) => set({ deliveryFee: Number(e.target.value.replace(/[^\d]/g, "") || 0) })} dir="ltr" inputMode="numeric" className={inputCls} data-testid="admin-delivery-fee" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 sm:pt-7">
            <input type="checkbox" checked={!!s.showSocialProof} onChange={(e) => set({ showSocialProof: e.target.checked })} />
            إظهار عبارة «تم شراء X قطعة» (أرقامها تقديرية وعشوائية)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={!!s.showRoutine} onChange={(e) => set({ showRoutine: e.target.checked })} data-testid="admin-show-routine" />
            إظهار قسم «اختاري روتينج» بالصفحة الرئيسية
          </label>
        </div>
        <div>
          <label className={labelCls}>الشريط اللي فوك الموقع</label>
          <input value={s.announcement} onChange={(e) => set({ announcement: e.target.value })} className={inputCls} data-testid="admin-announcement" />
        </div>
        <div>
          <label className={labelCls}>نص أسفل الموقع</label>
          <textarea value={s.footerText} onChange={(e) => set({ footerText: e.target.value })} rows={2} className={inputCls} data-testid="admin-footer-text" />
        </div>
      </div>

      <div className={sectionCls}>
        <h2 className="text-lg font-bold text-gray-900">صور البانر (أعلى الصفحة الرئيسية)</h2>
        <ListEditor
          items={s.banners}
          onChange={(banners) => set({ banners })}
          addLabel="إضافة بانر"
          empty="ماكو بانرات — قسم البانر ما يظهر."
          fields={[
            ["title", "العنوان"],
            ["subtitle", "النص الصغير"],
            ["link", "الرابط داخل الموقع", { ltr: true, placeholder: "/collection/offers" }],
            ["img", "رابط الصورة (أو ارفع صورة)", { ltr: true, placeholder: "https://..." }],
          ]}
          renderExtra={(b, i) => {
            const preview = b.img && b.img.startsWith("pending:") ? bannerPreviews[b.img.slice(8)] : b.img;
            return (
              <div className="flex flex-wrap items-center gap-3">
                {preview && <img src={preview} alt="" className="h-20 rounded-xl object-cover border border-pink-100" />}
                <input ref={(el) => { fileRefs.current[i] = el; }} type="file" accept="image/*" className="hidden" onChange={(e) => pickBanner(i, e.target.files && e.target.files[0])} />
                <button type="button" onClick={() => fileRefs.current[i] && fileRefs.current[i].click()} className="text-sm font-bold text-pink-600 hover:underline">رفع صورة</button>
                <select value="" onChange={(e) => e.target.value && set({ banners: s.banners.map((x, k) => (k === i ? { ...x, link: e.target.value } : x)) })} className="text-sm border border-pink-100 rounded-lg px-2 py-1">
                  <option value="">اختيار رابط...</option>
                  {linkOptions.map(([to, name]) => <option key={to} value={to}>{name}</option>)}
                </select>
              </div>
            );
          }}
        />
      </div>

      <div className={sectionCls}>
        <h2 className="text-lg font-bold text-gray-900">روابط القائمة</h2>
        <ListEditor
          items={s.navLinks}
          onChange={(navLinks) => set({ navLinks })}
          addLabel="إضافة رابط"
          empty="ماكو روابط بالقائمة."
          fields={[["name", "الاسم"], ["to", "الرابط داخل الموقع", { ltr: true, placeholder: "/collection/offers" }]]}
          renderExtra={(l, i) => (
            <select value="" onChange={(e) => {
              const opt = linkOptions.find(([to]) => to === e.target.value);
              if (opt) set({ navLinks: s.navLinks.map((x, k) => (k === i ? { name: x.name || opt[1], to: opt[0] } : x)) });
            }} className="text-sm border border-pink-100 rounded-lg px-2 py-1">
              <option value="">اختيار قسم...</option>
              {linkOptions.map(([to, name]) => <option key={to} value={to}>{name}</option>)}
            </select>
          )}
        />
      </div>

      <div className={sectionCls}>
        <h2 className="text-lg font-bold text-gray-900">مميزات المتجر (الشريط تحت البانر)</h2>
        <ListEditor
          items={s.features}
          onChange={(features) => set({ features })}
          addLabel="إضافة ميزة"
          empty="ماكو مميزات — الشريط ما يظهر."
          fields={[["title", "العنوان"], ["desc", "الوصف"]]}
        />
      </div>
    </div>
  );
};
