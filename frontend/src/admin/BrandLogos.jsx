// «شعارات الشركات»: each brand tile on the store shows the brand's official logo.
// The admin can upload or replace a logo here; it goes to frontend/public/images/brands/
// when «نشر التغييرات» is pressed. A brand with no logo shows its name as text.
import React, { useRef, useState } from "react";
import { Upload, Trash2 } from "lucide-react";
import { listBrands } from "../lib/brands";
import { productsCount } from "../lib/arCount";

const readFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("تعذّر قراءة الصورة."));
    reader.readAsDataURL(file);
  });

/** Turns any picture (PNG, JPG, WEBP or SVG) into a transparent PNG of at most 600×240. */
export const logoPng = async (file) => {
  const src = await readFile(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("تعذّر قراءة الصورة. جرّب PNG أو JPG أو SVG."));
    i.src = src;
  });
  let w = img.naturalWidth || 600;
  let h = img.naturalHeight || 240;
  const isSvg = /^data:image\/svg/.test(src);
  const scale = isSvg ? Math.min(600 / w, 240 / h) : Math.min(1, 600 / w, 240 / h);
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/png");
};

export const BrandLogos = ({ products, brands, previews, onPick, onRemove, armed, askConfirm }) => {
  const list = listBrands(products, brands);
  const inputRef = useRef(null);
  const [target, setTarget] = useState(null);
  const [error, setError] = useState("");

  const choose = (slug) => { setTarget(slug); setError(""); if (inputRef.current) { inputRef.current.value = ""; inputRef.current.click(); } };
  const picked = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || !target) return;
    try {
      const b = list.find((x) => x.slug === target);
      onPick(target, b ? b.name : target, await logoPng(file));
    } catch (err) {
      setError(err.message || "تعذّر قراءة الصورة.");
    }
  };

  const missing = list.filter((b) => !b.logo && !previews[b.slug]);

  return (
    <div className="bg-white border border-pink-100 rounded-3xl p-5 space-y-4" data-testid="admin-brand-logos">
      <div>
        <h3 className="font-bold text-gray-900">شعارات الشركات</h3>
        <p className="text-xs text-gray-500 mt-1">هذي الشعارات تطلع بقسم «حسب الشركة». ارفع الشعار الرسمي للشركة (PNG بخلفية شفافة أو SVG أحسن). الشركة اللي ما إلها شعار يطلع اسمها مكتوب. التغيير يوصل للمتجر بعد «نشر التغييرات».</p>
        {missing.length > 0 && <p className="text-xs text-amber-700 mt-2" data-testid="admin-brands-missing">بدون شعار: {missing.map((b) => b.name).join("، ")}</p>}
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={picked} data-testid="admin-brand-logo-input" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {list.map((b) => {
          const shown = previews[b.slug] || b.logo;
          return (
            <div key={b.slug} className="border border-pink-100 rounded-2xl p-3 flex flex-col gap-2" data-testid={`admin-brand-${b.slug}`}>
              <div className="h-20 bg-gray-50 rounded-xl flex items-center justify-center overflow-hidden">
                {shown
                  ? <img src={shown} alt={`شعار ${b.name}`} className="max-h-full max-w-full object-contain p-2" />
                  : <span className="font-extrabold text-gray-700 text-sm px-2 text-center" dir="ltr">{b.name}</span>}
              </div>
              <div className="flex items-center justify-between gap-1">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate" dir="ltr">{b.name}</p>
                  <p className="text-[11px] text-gray-500">{productsCount(b.count)}{previews[b.slug] ? " · ينتظر النشر" : ""}</p>
                </div>
                {shown && (
                  <button type="button" onClick={() => askConfirm(`logo:${b.slug}`, () => onRemove(b.slug))} title="شيل الشعار" className="text-gray-400 hover:text-red-500 shrink-0" data-testid={`admin-brand-remove-${b.slug}`}>
                    {armed === `logo:${b.slug}` ? <span className="text-[11px] font-bold text-red-600">متأكد؟</span> : <Trash2 size={16} />}
                  </button>
                )}
              </div>
              <button type="button" onClick={() => choose(b.slug)} className="flex items-center justify-center gap-1 text-xs font-bold text-pink-700 border border-pink-200 hover:bg-pink-50 rounded-full py-1.5" data-testid={`admin-brand-upload-${b.slug}`}>
                <Upload size={14} /> {shown ? "تغيير الشعار" : "رفع شعار"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
