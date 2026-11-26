import React, { useEffect, useMemo, useRef, useState } from "react";
import { brandSlug } from "../lib/brands";
import { Plus, Trash2, Sparkles, X, Search, Link2 } from "lucide-react";
import { loadStoreData, publishStore } from "./github";
import { apiRequest } from "../ordersApi";
import { DEFAULT_AI_MODEL, analyzeProduct, analyzeLink, readProductLink, imageToFile, normalizeLink, blobToDataUrl, dataUrlToBase64, makeWhiteBackground, resizeForAnalysis, serverAiAvailable } from "./ai";
import { useOrders, OrdersTab } from "./Orders";
import { NotificationsSettings, registerServiceWorker } from "./Notifications";
import { SiteSettings } from "./SiteSettings";
import { BrandLogos } from "./BrandLogos";
import { useConfirmTap } from "./confirmTap";

const AI_KEY = "admin_xingchi_key"; // browser-only fallback until the server holds the key
const AI_MODEL_KEY = "admin_ai_model";

const store = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

const formatPrice = (n) => Number(n || 0).toLocaleString("en-US") + " د.ع";
const slugify = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
const uniqueId = (base, taken) => {
  let id = base || `p-${Date.now().toString(36)}`;
  let n = 2;
  while (taken.has(id)) id = `${base || "p"}-${n++}`;
  return id;
};
const badgeFor = (price, old) => (old > price && price > 0 ? `-${Math.round((1 - price / old) * 100)}%` : "");

const inputCls = "w-full border-2 border-pink-100 focus:border-pink-400 outline-none rounded-xl px-3 py-2.5 bg-white";
const btnPrimary = "bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white font-bold px-5 py-2.5 rounded-full transition";
const btnGhost = "border border-gray-300 hover:border-gray-400 text-gray-700 font-semibold px-4 py-2 rounded-full transition";

// ============== LOGIN ==============
// The password is checked on the server, which then keeps this device signed in with an
// HttpOnly cookie. The password itself lives only in Vercel (ADMIN_PASSWORD).
const Login = ({ onLogin }) => {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest("/api/admin", { method: "POST", token: "session", body: { password } });
      setPassword("");
      onLogin(await loadStoreData());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16" data-testid="admin-login">
      <div className="bg-white border border-pink-100 rounded-3xl p-6 sm:p-8 shadow-sm">
        <h1 className="text-2xl font-extrabold text-gray-900 mb-2">لوحة الأدمن 🔐</h1>
        <p className="text-gray-600 text-sm leading-relaxed mb-5">اكتب كلمة سر الأدمن حتى تدخل.</p>
        <form onSubmit={submit} className="space-y-4">
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة السر" autoComplete="current-password" className={inputCls} data-testid="admin-password" />
          {error && <p className="text-red-600 text-sm" data-testid="admin-login-error">{error}</p>}
          <button type="submit" disabled={busy || !password} className={`${btnPrimary} w-full`} data-testid="admin-login-btn">{busy ? "جاري التحقق..." : "دخول"}</button>
        </form>
      </div>
    </div>
  );
};

// ============== PRODUCT FORM (add / edit) ==============
const emptyForm = () => ({ name: "", name_en: "", description: "", brand: "", category: "", skin_type: [], price: "", sale_price: "", free_delivery: false, out_of_stock: false });

const ProductForm = ({ data, initial, ai, onSave, onCancel }) => {
  const editing = !!initial;
  const [form, setForm] = useState(() => (initial
    ? { ...emptyForm(), ...initial, price: String(initial.price ?? ""), sale_price: initial.sale_price ? String(initial.sale_price) : "" }
    : emptyForm()));
  const [aiCategory, setAiCategory] = useState("");
  const [file, setFile] = useState(null);
  const [original, setOriginal] = useState("");
  const [processed, setProcessed] = useState("");
  const [removed, setRemoved] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const [link, setLink] = useState("");

  const pickFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setFile(f);
    setProcessed("");
    setNotes([]);
    setError("");
    const reader = new FileReader();
    reader.onload = () => setOriginal(reader.result);
    reader.readAsDataURL(f);
  };

  // Cuts the product out of its photo onto white; adds a note when it can't.
  const whiteImage = async (f, newNotes) => {
    const white = await makeWhiteBackground(f, (label, ratio) => setStatus(`${label} ${Math.round(ratio * 100)}%`));
    setProcessed(white.dataUrl);
    setRemoved(white.removed);
    if (!white.removed) newNotes.push("إزالة الخلفية ما اشتغلت على هذا الجهاز (أو طولت)، فحطينا الصورة الأصلية على خلفية بيضاء.");
  };

  // Puts the AI's answer into the form. `fixedPrice` is a price read from the page in IQD.
  const applyListing = (r, newNotes, { fixedPrice = 0, pageNote = "" } = {}) => {
    const price = fixedPrice || r.suggested_price_iqd;
    setForm((f) => ({
      ...f,
      name: r.name_ar || f.name,
      name_en: r.name_en || f.name_en,
      description: r.description_ar || f.description,
      brand: r.brand ? (data.products.map((p) => String(p.brand || "").trim()).find((b) => b && brandSlug(b) === brandSlug(r.brand)) || r.brand) : f.brand,
      skin_type: Array.isArray(r.skin_type) ? r.skin_type.filter((s) => data.skinTypes.some((t) => t.id === s)) : f.skin_type,
      ...(price > 0 && !f.price ? { price: String(price) } : {}),
    }));
    // the AI only suggests a section; the admin's own pick always wins
    if (data.categories.some((c) => c.id === r.category)) {
      setAiCategory(r.category);
      setForm((f) => (f.category ? f : { ...f, category: r.category }));
    }
    if (fixedPrice > 0) {
      newNotes.push(`السعر ${Number(fixedPrice).toLocaleString("en")} د.ع مأخوذ من صفحة المنتج، راجعه قبل الموافقة.`);
    } else if (r.suggested_price_iqd > 0) {
      newNotes.push(`السعر المقترح ${Number(r.suggested_price_iqd).toLocaleString("en")} د.ع — تقدير من الذكاء الاصطناعي بدون بحث بالإنترنت، راجعه قبل الموافقة.${r.price_note_ar ? ` (${r.price_note_ar})` : ""}${pageNote}`);
    } else {
      newNotes.push(`ما لگينا سعر مضمون لهذا المنتج، فاكتب السعر بنفسك.${r.price_note_ar ? ` (${r.price_note_ar})` : ""}${pageNote}`);
    }
    if (r.confident === false) newNotes.push("المعلومات ما كانت واضحة، فراجع الاسم والوصف قبل الحفظ.");
  };

  const runAi = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    const newNotes = [];
    try {
      setStatus("تجهيز الصورة...");
      const analysisImage = await resizeForAnalysis(file);
      const serverAi = ai.serverAi || (await serverAiAvailable());

      const analysis = serverAi
        ? analyzeProduct({ serverToken: ai.token, browserKey: "", model: ai.model, imageDataUrl: analysisImage, categories: data.categories, skinTypes: data.skinTypes })
            .then((r) => ({ ok: true, r }))
            .catch((err) => ({ ok: false, err }))
        : Promise.resolve(null);

      await whiteImage(file, newNotes);

      setStatus("قراءة اسم المنتج ووصفه...");
      const result = await analysis;
      if (result === null) {
        newNotes.push("الذكاء الاصطناعي يشتغل بعد ما ينضاف مفتاح Groq بـ Vercel. هسه اكتب الاسم والوصف يدوياً.");
      } else if (!result.ok) {
        newNotes.push(`تحليل الاسم والوصف فشل: ${result.err.message}`);
      } else {
        applyListing(result.r, newNotes);
      }
    } catch (err) {
      setError(err.message || "صار خطأ أثناء المعالجة.");
    } finally {
      setNotes(newNotes);
      setStatus("");
      setBusy(false);
    }
  };

  const runLink = async () => {
    const url = normalizeLink(link);
    if (!url) return setError("الرابط غير صحيح. الصق رابط صفحة المنتج كامل، مثل https://...");
    setBusy(true);
    const serverAi = ai.serverAi || (await serverAiAvailable());
    setError("");
    setNotes([]);
    const newNotes = [];
    try {
      setStatus("قراءة صفحة المنتج...");
      const serverToken = ai.token;
      const page = await readProductLink({ serverToken, url });

      let imgFile = null;
      for (const src of page ? [page.image_data, ...(page.images || [])] : []) {
        imgFile = await imageToFile(src);
        if (imgFile) break;
      }
      const analysisImage = imgFile ? await resizeForAnalysis(imgFile).catch(() => "") : "";

      setStatus("الذكاء الاصطناعي يكتب الاسم والوصف...");
      let r;
      try {
        if (!serverAi) throw new Error("مفتاح Groq بعده مو محطوط بـ Vercel");
        r = await analyzeLink({ serverToken, browserKey: "", model: ai.model, url, page, imageDataUrl: analysisImage, categories: data.categories, skinTypes: data.skinTypes });
      } catch (aiErr) {
        if (!page || !(page.title || page.description)) throw aiErr;
        // the AI failed: fill what the page itself says, for the admin to fix up
        const t = (v, n) => String(v || "").trim().slice(0, n);
        r = { name_ar: t(page.title, 160), name_en: t(page.title, 160), description_ar: t(page.description, 1200), brand: t(page.brand, 60), category: "", skin_type: [], suggested_price_iqd: 0, price_note_ar: "", confident: false, image_url: "", pageRead: true };
        newNotes.push(`الذكاء الاصطناعي ما اشتغل (${aiErr.message})، فعبّينا الاسم والوصف من الصفحة نفسها كما هي. ترجمها وراجعها قبل الموافقة.`);
      }
      if (!imgFile && r.image_url) imgFile = await imageToFile(r.image_url);

      const iqd = page && page.price > 0 && page.currency === "IQD" ? Math.round(page.price) : 0;
      const pageNote = page && page.price > 0 && page.currency && page.currency !== "IQD" ? ` السعر بالصفحة ${page.price} ${page.currency}.` : "";
      applyListing(r, newNotes, { fixedPrice: iqd, pageNote });
      if (!r.pageRead) newNotes.push("ما تأكدنا إن الذكاء الاصطناعي فتح الصفحة، يمكن كتب من الرابط بس. راجع الاسم والوصف زين قبل الموافقة.");

      if (imgFile && page && page.image_has_person) newNotes.push("كل صور هذا المنتج بالرابط بيها شخص أو موديل. الأفضل ترفع صورة للمنتج وحده بزر «اختيار صورة».");
      if (imgFile) {
        setFile(imgFile);
        setOriginal(await blobToDataUrl(imgFile));
        await whiteImage(imgFile, newNotes);
      } else {
        newNotes.push("ما گدرنا نجيب صورة المنتج من الرابط. احفظ الصورة من الصفحة وارفعها بزر «اختيار صورة».");
      }
    } catch (err) {
      setError(err.message || "ما گدرنا نقرا الرابط.");
    } finally {
      setNotes(newNotes);
      setStatus("");
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    const price = Math.round(Number(form.price));
    const old = Math.round(Number(form.sale_price || 0));
    if (!form.name.trim()) return setError("اكتب اسم المنتج بالعربي.");
    if (!Number.isFinite(price) || price < 0 || form.price === "") return setError("اكتب السعر.");
    if (!editing && !processed && !original) return setError("اختر صورة للمنتج.");
    if (!form.category) return setError("اختار القسم اللي ينضاف له المنتج.");
    setError("");
    const product = {
      name: form.name.trim(),
      name_en: form.name_en.trim() || form.name.trim(),
      description: form.description.trim(),
      price,
      category: form.category,
      skin_type: form.skin_type,
      brand: form.brand.trim(),
      free_delivery: !!form.free_delivery,
      out_of_stock: !!form.out_of_stock,
    };
    if (old > price) product.sale_price = old;
    const badge = badgeFor(price, old);
    if (badge) product.badge = badge;
    onSave(product, processed || (editing ? "" : original));
  };

  const preview = processed || original || (initial && initial.image);

  return (
    <form onSubmit={submit} className="bg-white border border-pink-100 rounded-3xl p-5 sm:p-7 space-y-5" data-testid="admin-product-form">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">{editing ? "تعديل منتج" : "إضافة منتج"}</h2>
        {onCancel && <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-700"><X size={22} /></button>}
      </div>

      {!editing && (
        <div className="rounded-2xl border-2 border-pink-100 bg-pink-50/40 p-4" data-testid="admin-link-box">
          <label className="block text-sm font-bold text-gray-800 mb-1.5" htmlFor="admin-link">إضافة من رابط</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input id="admin-link" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!busy) runLink(); } }}
              dir="ltr" inputMode="url" autoComplete="off" placeholder="https://..." className={inputCls} data-testid="admin-link" />
            <button type="button" onClick={runLink} disabled={busy || !link.trim()} className={`${btnPrimary} shrink-0 flex items-center justify-center gap-2`} data-testid="admin-link-btn">
              <Link2 size={18} /> {busy ? "جاري القراءة..." : "جيب المنتج"}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">الصق رابط صفحة المنتج من أي متجر، ويتعبى الاسم والوصف والصورة والسعر. أنت تختار القسم وتراجع كلشي قبل الموافقة. أو اختار صورة تحت.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <div className="aspect-square rounded-2xl border-2 border-dashed border-pink-200 bg-pink-50/40 flex items-center justify-center overflow-hidden">
            {preview ? <img src={preview} alt="" className="w-full h-full object-contain" data-testid="admin-image-preview" /> : <span className="text-gray-400 text-sm">صورة المنتج</span>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={pickFile} className="hidden" data-testid="admin-image-input" />
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={() => fileRef.current && fileRef.current.click()} className={btnGhost}>{file ? "تغيير الصورة" : "اختيار صورة"}</button>
            <button type="button" onClick={runAi} disabled={!file || busy} className={`${btnPrimary} flex items-center gap-2`} data-testid="admin-ai-btn">
              <Sparkles size={18} /> {busy ? "جاري المعالجة..." : "تجهيز بالذكاء الاصطناعي"}
            </button>
          </div>
          {status && <p className="text-sm text-pink-600 mt-2" data-testid="admin-ai-status">{status}</p>}
          {processed && removed && <p className="text-sm text-green-600 mt-2" data-testid="admin-bg-removed">✓ الصورة جاهزة بخلفية بيضاء</p>}
          {notes.map((n) => <p key={n} className="text-sm text-amber-600 mt-2" data-testid="admin-ai-note">{n}</p>)}
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">الزر يشيل خلفية الصورة ويخليها بيضاء، ويقرأ العلبة حتى يكتب الاسم بالعربي والإنجليزي والوصف. أنت تراجع السعر وتختار القسم.</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">الاسم بالعربي *</label>
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} className={inputCls} data-testid="admin-name" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">الاسم بالإنجليزي</label>
            <input value={form.name_en} onChange={(e) => set({ name_en: e.target.value })} dir="ltr" className={inputCls} data-testid="admin-name-en" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">الوصف</label>
            <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={4} className={`${inputCls} resize-none`} data-testid="admin-description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">السعر (د.ع) *</label>
              <input value={form.price} onChange={(e) => set({ price: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" dir="ltr" placeholder="15000" className={inputCls} data-testid="admin-price" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">السعر قبل الخصم</label>
              <input value={form.sale_price} onChange={(e) => set({ sale_price: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" dir="ltr" placeholder="اختياري" className={inputCls} data-testid="admin-old-price" />
            </div>
          </div>
          <div className="rounded-2xl border-2 border-pink-200 bg-pink-50/50 p-3">
            <label className="block text-sm font-bold text-gray-800 mb-1">القسم اللي ينضاف له المنتج *</label>
            <select value={form.category} onChange={(e) => set({ category: e.target.value })} className={`${inputCls} bg-white`} data-testid="admin-category">
              <option value="">— اختار القسم —</option>
              <option value="best-selling">الأكثر طلباً</option>
              <option value="offers">العروض</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {aiCategory && (
              <p className="text-xs text-gray-600 mt-1.5" data-testid="admin-ai-category">
                {aiCategory === form.category
                  ? "هذا القسم اقتراح من الذكاء الاصطناعي، تگدر تغيّره."
                  : `اقتراح الذكاء الاصطناعي: ${(data.categories.find((c) => c.id === aiCategory) || {}).name || aiCategory}، بس اختيارك هو اللي ينحفظ.`}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">الماركة</label>
            <input value={form.brand} onChange={(e) => set({ brand: e.target.value })} list="admin-brand-list" dir="ltr" className={inputCls} data-testid="admin-brand" />
            <datalist id="admin-brand-list">
              {[...new Set(data.products.map((p) => String(p.brand || "").trim()).filter(Boolean))].sort().map((b) => <option key={b} value={b} />)}
            </datalist>
            <p className="text-xs text-gray-400 mt-1">تظهر بصفحة الفئات تحت «حسب الشركة». اختار اسم موجود حتى ينضم لنفس الشركة.</p>
          </div>
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1.5">أنواع البشرة</span>
            <div className="flex flex-wrap gap-2">
              {data.skinTypes.map((t) => {
                const on = form.skin_type.includes(t.id);
                return (
                  <button type="button" key={t.id} onClick={() => set({ skin_type: on ? form.skin_type.filter((s) => s !== t.id) : [...form.skin_type, t.id] })}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${on ? "bg-pink-600 border-pink-600 text-white" : "border-gray-300 text-gray-600"}`}>
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={!!form.free_delivery} onChange={(e) => set({ free_delivery: e.target.checked })} /> توصيل مجاني لهذا المنتج
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={!!form.out_of_stock} onChange={(e) => set({ out_of_stock: e.target.checked })} data-testid="admin-out-of-stock" /> غير متوفر حالياً (ينعرض بالمتجر بس ما ينضاف للسلة)
          </label>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm" data-testid="admin-form-error">{error}</p>}
      {!editing && <p className="text-xs text-gray-500">الذكاء الاصطناعي يعبّي البيانات بس، والمنتج ما ينضاف إلا لما توافق، وما يظهر للزباين إلا بعد «نشر التغييرات».</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={btnPrimary} data-testid="admin-save-product">{editing ? "حفظ التعديل" : "موافقة وإضافة المنتج"}</button>
        {onCancel && <button type="button" onClick={onCancel} className={btnGhost}>إلغاء</button>}
      </div>
    </form>
  );
};

// ============== MAIN PANEL ==============
const Panel = ({ token, initial, onLogout }) => {
  const [data, setData] = useState(initial.data);
  const [sha, setSha] = useState(initial.sha);
  const [images, setImages] = useState({}); // productId -> base64 jpeg waiting to be uploaded
  const [previews, setPreviews] = useState({}); // productId -> data URL for unpublished photos
  const [bannerImages, setBannerImages] = useState({}); // pendingId -> base64 jpeg
  const [bannerPreviews, setBannerPreviews] = useState({}); // pendingId -> data URL
  const [brandLogos, setBrandLogos] = useState({}); // brand slug -> { base64 png, name }
  const [brandPreviews, setBrandPreviews] = useState({}); // brand slug -> data URL
  const [dirty, setDirty] = useState(0);
  const [tab, setTab] = useState("orders");
  const ordersState = useOrders(token);
  const [editingId, setEditingId] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [publishing, setPublishing] = useState("");
  const [message, setMessage] = useState(null);
  const [serverAi, setServerAi] = useState(false);
  useEffect(() => {
    // drop keys saved by older versions of this panel
    store.set("admin_ai_key", "");
    store.set("admin_gemini_key", "");
    store.set(AI_KEY, "");
    store.set(AI_MODEL_KEY, "");
    serverAiAvailable().then(setServerAi);
  }, []);
  const ai = { model: DEFAULT_AI_MODEL, browserKey: "", serverAi, token };
  const [newCat, setNewCat] = useState({ name: "", emoji: "", home: true });
  const [armed, askConfirm] = useConfirmTap();

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // keep the service worker registered so push notifications keep working
  useEffect(() => {
    if ("serviceWorker" in navigator) registerServiceWorker().catch(() => {});
  }, []);

  // show the number of new orders in the browser tab title
  useEffect(() => {
    const base = "لوحة الأدمن | صيدلية أيمن";
    document.title = ordersState.unseen ? `(${ordersState.unseen}) طلب جديد — ${base}` : base;
  }, [ordersState.unseen]);

  const change = (updater) => { setData((d) => updater(JSON.parse(JSON.stringify(d)))); setDirty((n) => n + 1); setMessage(null); };
  const categoryName = (id) => ({ "best-selling": "الأكثر طلباً", offers: "العروض" }[id] || (data.categories.find((c) => c.id === id) || {}).name || id);
  const counts = useMemo(() => data.products.reduce((m, p) => ({ ...m, [p.category]: (m[p.category] || 0) + 1 }), {}), [data.products]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.products.filter((p) => (!filter || p.category === filter) && (!q || [p.name, p.name_en, p.brand].some((f) => String(f || "").toLowerCase().includes(q))));
  }, [data.products, query, filter]);

  const attachImage = (id, dataUrl) => {
    if (!dataUrl) return;
    setImages((m) => ({ ...m, [id]: dataUrlToBase64(dataUrl) }));
    setPreviews((m) => ({ ...m, [id]: dataUrl }));
  };

  const addProduct = (product, imageDataUrl) => {
    const id = uniqueId(slugify(product.name_en), new Set(data.products.map((p) => p.id)));
    change((d) => { d.products.unshift({ id, ...product, image: "./images/product-placeholder.svg" }); return d; });
    attachImage(id, imageDataUrl);
    setTab("products");
  };

  const saveEdit = (id, product, imageDataUrl) => {
    change((d) => {
      const i = d.products.findIndex((p) => p.id === id);
      if (i >= 0) {
        const { sale_price, badge, ...rest } = d.products[i];
        const keepBadge = badge && !/^-\d+%$/.test(badge) ? { badge } : {};
        d.products[i] = { ...rest, ...keepBadge, ...product };
      }
      return d;
    });
    attachImage(id, imageDataUrl);
    setEditingId(null);
  };

  const deleteProduct = (p) => askConfirm(`p:${p.id}`, () => {
    change((d) => { d.products = d.products.filter((x) => x.id !== p.id); return d; });
    setImages((m) => { const rest = { ...m }; delete rest[p.id]; return rest; });
  });

  // delete every product at once: first press opens the panel, «تم» deletes; nothing reaches customers until «نشر التغييرات»
  const [confirmAll, setConfirmAll] = useState(false);
  const deleteAllProducts = () => {
    change((d) => { d.products = []; return d; });
    setImages({});
    setPreviews({});
    setEditingId(null);
    setQuery("");
    setFilter("");
    setConfirmAll(false);
  };

  const addCategory = (e) => {
    e.preventDefault();
    const name = newCat.name.trim();
    if (!name) return;
    const id = uniqueId(slugify(name) || `cat-${Date.now().toString(36)}`, new Set([...data.categories.map((c) => c.id), "best-selling", "offers"]));
    change((d) => { d.categories.push({ id, name, slug: id, emoji: newCat.emoji.trim() || "🛍️", home: !!newCat.home }); return d; });
    setNewCat({ name: "", emoji: "", home: true });
  };

  const deleteCategory = (c) => {
    if (counts[c.id]) return;
    askConfirm(`c:${c.id}`, () => change((d) => { d.categories = d.categories.filter((x) => x.id !== c.id); return d; }));
  };

  const publish = async () => {
    setPublishing("جاري النشر...");
    setMessage(null);
    try {
      const result = await publishStore(token, { data, loadedSha: sha, images, bannerImages, brandLogos, onStep: setPublishing });
      setData(result.data);
      setSha(result.sha);
      setImages({});
      setBannerImages({});
      setBrandLogos({});
      setBrandPreviews({});
      setDirty(0);
      setMessage({ ok: true, text: "تم النشر ✅ التغييرات تظهر بالموقع خلال دقيقتين تقريباً." });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setPublishing("");
    }
  };

  const editing = editingId ? data.products.find((p) => p.id === editingId) : null;
  const tabs = [["orders", ordersState.unseen ? `الطلبات 🔴 ${ordersState.unseen}` : "الطلبات"], ["products", `المنتجات (${data.products.length})`], ["add", "إضافة منتج"], ["categories", `الأقسام (${data.categories.length})`], ["site", "إعدادات الموقع"], ["notifications", "الإشعارات 🔔"], ["settings", "الإعدادات"]];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8" data-testid="admin-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-2xl font-extrabold text-gray-900">لوحة الأدمن</h1>
        <div className="flex items-center gap-2">
          <a href="https://balyiq.site/" target="_blank" rel="noopener noreferrer" className={btnGhost}>عرض المتجر</a>
          <button onClick={onLogout} className={btnGhost} data-testid="admin-logout">خروج</button>
        </div>
      </div>

      {initial.tokenProblem && (
        <div className="mb-5 rounded-2xl p-4 bg-red-50 border border-red-200 text-sm text-gray-800" data-testid="admin-token-banner">
          <p className="font-bold text-red-700 mb-1">حفظ المنتجات متوقف حالياً</p>
          <p>{initial.tokenProblem} تگدر تشوف وتجهز المنتجات، بس النشر ما يشتغل حتى ينصلح رمز GitHub بـ Vercel.</p>
        </div>
      )}

      {(dirty > 0 || message || publishing) && (
        <div className={`sticky top-2 z-40 mb-5 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-md ${message && !message.ok ? "bg-red-50 border border-red-200" : message && message.ok && !dirty ? "bg-green-50 border border-green-200" : "bg-amber-50 border border-amber-200"}`} data-testid="admin-publish-bar">
          <p className="text-sm font-semibold text-gray-800">
            {publishing || (message ? message.text : "عندك تغييرات غير منشورة — ما تظهر للزباين حتى تنشرها.")}
          </p>
          {dirty > 0 && <button onClick={publish} disabled={!!publishing} className={btnPrimary} data-testid="admin-publish">{publishing ? "..." : "نشر التغييرات"}</button>}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-2 mb-5">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); setEditingId(null); }} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold transition ${tab === id ? "bg-gray-900 text-white" : "bg-pink-50 text-gray-700 hover:bg-pink-100"}`} data-testid={`admin-tab-${id}`}>{label}</button>
        ))}
      </div>

      {tab === "orders" && <OrdersTab token={token} state={ordersState} />}

      {tab === "site" && (
        <SiteSettings
          settings={data.settings}
          categories={data.categories}
          bannerPreviews={bannerPreviews}
          onBannerImage={(id, dataUrl) => {
            setBannerImages((m) => ({ ...m, [id]: dataUrlToBase64(dataUrl) }));
            setBannerPreviews((m) => ({ ...m, [id]: dataUrl }));
          }}
          onChange={(next) => change((d) => { d.settings = next; return d; })}
        />
      )}

      {tab === "notifications" && (
        <div className="bg-white border border-pink-100 rounded-3xl p-5 sm:p-7">
          <NotificationsSettings token={token} />
        </div>
      )}

      {tab === "products" && editing && (
        <ProductForm key={editing.id} data={data} initial={editing} ai={ai} onSave={(p, img) => saveEdit(editing.id, p, img)} onCancel={() => setEditingId(null)} />
      )}

      {tab === "products" && !editing && (
        <div>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={18} className="absolute top-1/2 -translate-y-1/2 right-3 text-gray-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث بالاسم أو الماركة" className={`${inputCls} pr-10`} data-testid="admin-search" />
            </div>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className={`${inputCls} sm:w-56`} data-testid="admin-filter">
              <option value="">كل الأقسام</option>
              <option value="best-selling">الأكثر طلباً</option>
              <option value="offers">العروض</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-sm text-gray-500">{visible.length} منتج</p>
            {data.products.length > 0 && !confirmAll && (
              <button onClick={() => setConfirmAll(true)} className="text-xs font-bold text-red-600 border border-red-200 bg-white hover:bg-red-50 px-3 py-1.5 rounded-full" data-testid="admin-delete-all">حذف كل المنتجات</button>
            )}
          </div>
          {confirmAll && (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4" data-testid="admin-delete-all-confirm">
              <p className="text-sm font-bold text-red-700">راح تنحذف كل المنتجات ({data.products.length}) من اللوحة.</p>
              <p className="text-xs text-red-600 mt-1">ما تنحذف من المتجر إلا لما تدوس «نشر التغييرات». وإذا غيّرت رأيك قبل النشر، سوّي تحديث للصفحة وترجع مثل ما كانت.</p>
              <div className="flex gap-2 mt-3">
                <button onClick={deleteAllProducts} className="bg-red-600 hover:bg-red-700 text-white text-sm font-bold px-5 py-2 rounded-full" data-testid="admin-delete-all-yes">تم</button>
                <button onClick={() => setConfirmAll(false)} className="bg-white border border-gray-200 text-gray-700 text-sm font-bold px-5 py-2 rounded-full" data-testid="admin-delete-all-no">إلغاء</button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {visible.map((p) => (
              <div key={p.id} className="flex items-center gap-3 bg-white border border-pink-100 rounded-2xl p-3" data-testid={`admin-row-${p.id}`}>
                <img src={previews[p.id] || p.image} alt="" className="w-14 h-14 rounded-xl object-cover bg-pink-50 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900 truncate">{p.name}</p>
                  <p className="text-xs text-gray-500 truncate">{categoryName(p.category)} · {formatPrice(p.price)}{images[p.id] ? " · صورة جديدة" : ""}</p>
                </div>
                <button
                  onClick={() => change((d) => { const x = d.products.find((q) => q.id === p.id); if (x) x.out_of_stock = !x.out_of_stock; return d; })}
                  className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${p.out_of_stock ? "bg-gray-800 text-white" : "bg-green-50 text-green-700"}`}
                  title="اضغط حتى تغيّر حالة التوفر"
                  data-testid={`admin-stock-${p.id}`}
                >
                  {p.out_of_stock ? "غير متوفر" : "متوفر"}
                </button>
                <button onClick={() => setEditingId(p.id)} className="text-sm font-semibold text-pink-600 hover:underline shrink-0" data-testid={`admin-edit-${p.id}`}>تعديل</button>
                <button onClick={() => deleteProduct(p)} className="text-gray-400 hover:text-red-500 shrink-0" aria-label="حذف" data-testid={`admin-delete-${p.id}`}>{armed === `p:${p.id}` ? <span className="text-xs font-bold text-red-600">متأكد؟ دوس مرة ثانية</span> : <Trash2 size={18} />}</button>
              </div>
            ))}
            {visible.length === 0 && <p className="text-center text-gray-500 py-10">لا توجد منتجات.</p>}
          </div>
        </div>
      )}

      {tab === "add" && <ProductForm data={data} ai={ai} onSave={addProduct} />}

      {tab === "categories" && (
        <div className="space-y-5">
          <form onSubmit={addCategory} className="bg-white border border-pink-100 rounded-3xl p-5 flex flex-col sm:flex-row sm:items-end gap-3" data-testid="admin-category-form">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">اسم القسم الجديد</label>
              <input value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} placeholder="مثال: عطور" className={inputCls} data-testid="admin-cat-name" />
            </div>
            <div className="sm:w-28">
              <label className="block text-sm font-medium text-gray-700 mb-1">إيموجي</label>
              <input value={newCat.emoji} onChange={(e) => setNewCat({ ...newCat, emoji: e.target.value })} placeholder="🌸" maxLength={4} className={`${inputCls} text-center`} data-testid="admin-cat-emoji" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 sm:pb-3">
              <input type="checkbox" checked={newCat.home} onChange={(e) => setNewCat({ ...newCat, home: e.target.checked })} /> بالصفحة الرئيسية
            </label>
            <button type="submit" className={`${btnPrimary} flex items-center justify-center gap-1`} data-testid="admin-cat-add"><Plus size={18} /> إضافة</button>
          </form>
          <div className="space-y-2">
            {data.categories.map((c, ci) => (
              <div key={c.id} className="flex items-center gap-3 bg-white border border-pink-100 rounded-2xl p-3" data-testid={`admin-cat-${c.id}`}>
                <div className="flex flex-col shrink-0">
                  <button type="button" disabled={ci === 0} onClick={() => change((d) => { const a = d.categories; [a[ci - 1], a[ci]] = [a[ci], a[ci - 1]]; return d; })} className="text-gray-400 hover:text-pink-600 disabled:opacity-30 text-xs leading-none p-0.5" aria-label="لفوك">▲</button>
                  <button type="button" disabled={ci === data.categories.length - 1} onClick={() => change((d) => { const a = d.categories; [a[ci + 1], a[ci]] = [a[ci], a[ci + 1]]; return d; })} className="text-gray-400 hover:text-pink-600 disabled:opacity-30 text-xs leading-none p-0.5" aria-label="لجوه">▼</button>
                </div>
                <input value={c.emoji || ""} onChange={(e) => change((d) => { d.categories.find((x) => x.id === c.id).emoji = e.target.value; return d; })} maxLength={4} aria-label="إيموجي القسم" className="w-11 h-11 rounded-xl bg-pink-50 text-center text-2xl shrink-0 outline-none focus:ring-2 focus:ring-pink-300" />
                <div className="flex-1 min-w-0">
                  <input value={c.name} onChange={(e) => change((d) => { d.categories.find((x) => x.id === c.id).name = e.target.value; return d; })} aria-label="اسم القسم" className="w-full font-semibold text-sm text-gray-900 bg-transparent border-b border-transparent hover:border-pink-200 focus:border-pink-400 outline-none" data-testid={`admin-cat-rename-${c.id}`} />
                  <p className="text-xs text-gray-500">{counts[c.id] || 0} منتج</p>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 shrink-0">
                  <input type="checkbox" checked={!!c.home} onChange={(e) => change((d) => { d.categories.find((x) => x.id === c.id).home = e.target.checked; return d; })} /> بالرئيسية
                </label>
                <button onClick={() => deleteCategory(c)} disabled={!!counts[c.id]} title={counts[c.id] ? "احذف أو انقل منتجات القسم أولاً" : "حذف القسم"} className="text-gray-400 hover:text-red-500 disabled:opacity-30 disabled:hover:text-gray-400 shrink-0" data-testid={`admin-cat-delete-${c.id}`}>{armed === `c:${c.id}` ? <span className="text-xs font-bold text-red-600">متأكد؟ دوس مرة ثانية</span> : <Trash2 size={18} />}</button>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">تكدر تغيّر اسم القسم والإيموجي وترتيبه (الأسهم) مباشرة من القائمة. القسم اللي بيه منتجات ما ينحذف — احذف منتجاته أو انقلها لقسم ثاني أولاً.</p>
          <BrandLogos
            products={data.products}
            brands={data.brands}
            previews={brandPreviews}
            armed={armed}
            askConfirm={askConfirm}
            onPick={(slug, name, dataUrl) => {
              setBrandLogos((m) => ({ ...m, [slug]: { base64: dataUrlToBase64(dataUrl), name } }));
              setBrandPreviews((m) => ({ ...m, [slug]: dataUrl }));
              setDirty((n) => n + 1);
              setMessage(null);
            }}
            onRemove={(slug) => {
              setBrandLogos((m) => { const rest = { ...m }; delete rest[slug]; return rest; });
              setBrandPreviews((m) => { const rest = { ...m }; delete rest[slug]; return rest; });
              change((d) => { if (Array.isArray(d.brands)) d.brands = d.brands.filter((b) => b && b.slug !== slug); return d; });
            }}
          />
        </div>
      )}

      {tab === "settings" && (
        <div className="bg-white border border-pink-100 rounded-3xl p-5 sm:p-7 space-y-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">الذكاء الاصطناعي</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              شيل الخلفية يشتغل على جهازك مباشرة وما يحتاج مفتاح. كتابة الاسم والوصف بالعربي وقراءة العلبة من الصورة تمر من حسابك بـ Groq.
              {serverAi ? " المفتاح محفوظ بالسيرفر وما يوصل للمتصفح." : " لحد هسه ماكو مفتاح: سوّي مفتاح بحسابك بـ Groq وحطه بـ Vercel (مشروع balyiq-api) باسم GROQ_API_KEY، وبعدين أعد النشر."}
            </p>
            {serverAi && <p className="text-sm text-gray-600 mt-3">السيرفر يستخدم موديل يقرأ الصور للصور، وموديل نصوص للروابط.</p>}
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">السعر المقترح تقدير من الموديل نفسه بدون بحث بالإنترنت، فراجعه دائماً. صور المنتجات تمر من Groq، فلا ترسل صور فيها معلومات شخصية.</p>
          </div>
          <div className="border-t border-pink-100 pt-5">
            <h2 className="text-lg font-bold text-gray-900 mb-1">الحساب</h2>
            <p className="text-sm text-gray-600 mb-3">الخروج يطلع هذا الجهاز من اللوحة. تغيير كلمة السر بـ Vercel يطلّع كل الأجهزة.</p>
            <button onClick={onLogout} className={btnGhost}>خروج</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ============== ENTRY ==============
const SESSION = "session"; // admin API calls carry the session cookie

export default function Admin() {
  const [loaded, setLoaded] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    store.set("admin_gh_token", ""); // older panel kept a GitHub token here
    apiRequest("/api/admin", { token: SESSION })
      .then((s) => (s.loggedIn ? loadStoreData().then(setLoaded) : null))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const logout = async () => {
    try { await apiRequest("/api/admin", { method: "DELETE", token: SESSION }); } catch (e) { /* ignore */ }
    store.set(AI_KEY, "");
    setLoaded(null);
  };

  if (checking) return <div className="py-20 text-center text-gray-500">جاري التحميل...</div>;
  if (!loaded) return <Login onLogin={setLoaded} />;
  return <Panel token={SESSION} initial={loaded} onLogout={logout} />;
}
