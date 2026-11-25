import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2, Sparkles, X, Search } from "lucide-react";
import { loadStoreData, publishStore, REPO_OWNER, REPO_NAME } from "./github";
import { AI_MODELS, DEFAULT_AI_MODEL, analyzeProduct, makeWhiteBackground, resizeForAnalysis, dataUrlToBase64 } from "./ai";
import { useOrders, OrdersTab } from "./Orders";
import { NotificationsSettings, registerServiceWorker } from "./Notifications";

const TOKEN_KEY = "admin_gh_token";
const AI_KEY = "admin_ai_key";
const AI_MODEL_KEY = "admin_ai_model";
const TOKEN_HELP_URL = "https://github.com/settings/personal-access-tokens/new";
const AI_HELP_URL = "https://platform.claude.com/settings/keys";

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
const Login = ({ onLogin }) => {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const loaded = await loadStoreData(token.trim());
      store.set(TOKEN_KEY, token.trim());
      onLogin(token.trim(), loaded);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-12" data-testid="admin-login">
      <div className="bg-white border border-pink-100 rounded-3xl p-6 sm:p-8 shadow-sm">
        <h1 className="text-2xl font-extrabold text-gray-900 mb-2">لوحة الأدمن 🔐</h1>
        <p className="text-gray-600 text-sm leading-relaxed mb-5">
          اللوحة تحفظ المنتجات مباشرة في مستودع المتجر على GitHub ({REPO_OWNER}/{REPO_NAME})، لذلك الدخول يكون برمز GitHub خاص بك.
          الرمز ينحفظ بمتصفحك فقط وما ينرسل لأي مكان غير GitHub.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">رمز GitHub (Personal access token)</label>
            <input type="password" required value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_..." dir="ltr" autoComplete="off" className={inputCls} data-testid="admin-token" />
          </div>
          {error && <p className="text-red-600 text-sm" data-testid="admin-login-error">{error}</p>}
          <button type="submit" disabled={busy || !token.trim()} className={`${btnPrimary} w-full`} data-testid="admin-login-btn">{busy ? "جاري التحقق..." : "دخول"}</button>
        </form>
        <details className="mt-6 text-sm text-gray-600">
          <summary className="cursor-pointer font-semibold text-pink-600">شلون أسوي الرمز؟ (مرة وحدة)</summary>
          <ol className="list-decimal pr-5 mt-3 space-y-1.5 leading-relaxed">
            <li>افتح <a href={TOKEN_HELP_URL} target="_blank" rel="noopener noreferrer" className="text-pink-600 underline">صفحة إنشاء الرمز في GitHub</a>.</li>
            <li>Repository access ← اختر <b>Only select repositories</b> ← <b>{REPO_NAME}</b>.</li>
            <li>Permissions ← Repository permissions ← <b>Contents: Read and write</b>.</li>
            <li>اضغط Generate token وانسخ الرمز والصقه هنا.</li>
          </ol>
        </details>
      </div>
    </div>
  );
};

// ============== PRODUCT FORM (add / edit) ==============
const emptyForm = (categories) => ({ name: "", name_en: "", description: "", brand: "", category: categories[0] ? categories[0].id : "", skin_type: [], price: "", sale_price: "", free_delivery: false });

const ProductForm = ({ data, initial, aiKey, aiModel, onSave, onCancel }) => {
  const editing = !!initial;
  const [form, setForm] = useState(() => (initial
    ? { ...emptyForm(data.categories), ...initial, price: String(initial.price ?? ""), sale_price: initial.sale_price ? String(initial.sale_price) : "" }
    : emptyForm(data.categories)));
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

  const runAi = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    const newNotes = [];
    try {
      setStatus("تجهيز الصورة...");
      const analysisImage = await resizeForAnalysis(file);

      const analysis = aiKey
        ? analyzeProduct({ apiKey: aiKey, model: aiModel, imageDataUrl: analysisImage, categories: data.categories, skinTypes: data.skinTypes })
            .then((r) => ({ ok: true, r }))
            .catch((err) => ({ ok: false, err }))
        : Promise.resolve(null);

      const white = await makeWhiteBackground(file, (label, ratio) => setStatus(`${label} ${Math.round(ratio * 100)}%`));
      setProcessed(white.dataUrl);
      setRemoved(white.removed);
      if (!white.removed) newNotes.push("ما قدرنا نشيل الخلفية تلقائياً على هذا الجهاز، فحطينا الصورة الأصلية على خلفية بيضاء.");

      setStatus("قراءة اسم المنتج ووصفه...");
      const result = await analysis;
      if (result === null) {
        newNotes.push("ما مضاف مفتاح الذكاء الاصطناعي (من تبويب الإعدادات)، فاكتب الاسم والوصف يدوياً.");
      } else if (!result.ok) {
        newNotes.push(`تحليل الاسم والوصف فشل: ${result.err.message}`);
      } else {
        const r = result.r;
        set({
          name: r.name_ar || form.name,
          name_en: r.name_en || form.name_en,
          description: r.description_ar || form.description,
          brand: r.brand || form.brand,
          category: data.categories.some((c) => c.id === r.category) ? r.category : form.category,
          skin_type: Array.isArray(r.skin_type) ? r.skin_type.filter((s) => data.skinTypes.some((t) => t.id === s)) : form.skin_type,
        });
        if (r.confident === false) newNotes.push("الكتابة على العلبة ما كانت واضحة، فراجع الاسم والوصف قبل الحفظ.");
      }
    } catch (err) {
      setError(err.message || "صار خطأ أثناء المعالجة.");
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
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">الزر يشيل خلفية الصورة ويخليها بيضاء، ويقرأ العلبة حتى يكتب الاسم بالعربي والإنجليزي والوصف. أنت بس تكتب السعر.</p>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">القسم</label>
              <select value={form.category} onChange={(e) => set({ category: e.target.value })} className={inputCls} data-testid="admin-category">
                <option value="best-selling">الأكثر طلباً</option>
                <option value="offers">العروض</option>
                {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">الماركة</label>
              <input value={form.brand} onChange={(e) => set({ brand: e.target.value })} dir="ltr" className={inputCls} data-testid="admin-brand" />
            </div>
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
        </div>
      </div>

      {error && <p className="text-red-600 text-sm" data-testid="admin-form-error">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={btnPrimary} data-testid="admin-save-product">{editing ? "حفظ التعديل" : "إضافة المنتج"}</button>
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
  const [dirty, setDirty] = useState(0);
  const [tab, setTab] = useState("orders");
  const ordersState = useOrders(token);
  const [editingId, setEditingId] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [publishing, setPublishing] = useState("");
  const [message, setMessage] = useState(null);
  const [aiKey, setAiKey] = useState(() => store.get(AI_KEY));
  const [aiModel, setAiModel] = useState(() => store.get(AI_MODEL_KEY) || DEFAULT_AI_MODEL);
  const [newCat, setNewCat] = useState({ name: "", emoji: "", home: true });

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

  const deleteProduct = (p) => {
    if (!window.confirm(`حذف «${p.name}»؟`)) return;
    change((d) => { d.products = d.products.filter((x) => x.id !== p.id); return d; });
    setImages((m) => { const rest = { ...m }; delete rest[p.id]; return rest; });
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
    if (!window.confirm(`حذف قسم «${c.name}»؟`)) return;
    change((d) => { d.categories = d.categories.filter((x) => x.id !== c.id); return d; });
  };

  const publish = async () => {
    setPublishing("جاري النشر...");
    setMessage(null);
    try {
      const result = await publishStore(token, { data, loadedSha: sha, images, onStep: setPublishing });
      setData(result.data);
      setSha(result.sha);
      setImages({});
      setDirty(0);
      setMessage({ ok: true, text: "تم النشر ✅ التغييرات تظهر بالموقع خلال دقيقتين تقريباً." });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setPublishing("");
    }
  };

  const editing = editingId ? data.products.find((p) => p.id === editingId) : null;
  const tabs = [["orders", ordersState.unseen ? `الطلبات 🔴 ${ordersState.unseen}` : "الطلبات"], ["products", `المنتجات (${data.products.length})`], ["add", "إضافة منتج"], ["categories", `الأقسام (${data.categories.length})`], ["notifications", "الإشعارات 🔔"], ["settings", "الإعدادات"]];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8" data-testid="admin-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-2xl font-extrabold text-gray-900">لوحة الأدمن</h1>
        <div className="flex items-center gap-2">
          <Link to="/" className={btnGhost}>عرض المتجر</Link>
          <button onClick={onLogout} className={btnGhost} data-testid="admin-logout">خروج</button>
        </div>
      </div>

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

      {tab === "notifications" && (
        <div className="bg-white border border-pink-100 rounded-3xl p-5 sm:p-7">
          <NotificationsSettings token={token} />
        </div>
      )}

      {tab === "products" && editing && (
        <ProductForm key={editing.id} data={data} initial={editing} aiKey={aiKey} aiModel={aiModel} onSave={(p, img) => saveEdit(editing.id, p, img)} onCancel={() => setEditingId(null)} />
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
          <p className="text-sm text-gray-500 mb-3">{visible.length} منتج</p>
          <div className="space-y-2">
            {visible.map((p) => (
              <div key={p.id} className="flex items-center gap-3 bg-white border border-pink-100 rounded-2xl p-3" data-testid={`admin-row-${p.id}`}>
                <img src={previews[p.id] || p.image} alt="" className="w-14 h-14 rounded-xl object-cover bg-pink-50 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900 truncate">{p.name}</p>
                  <p className="text-xs text-gray-500 truncate">{categoryName(p.category)} · {formatPrice(p.price)}{images[p.id] ? " · صورة جديدة" : ""}</p>
                </div>
                <button onClick={() => setEditingId(p.id)} className="text-sm font-semibold text-pink-600 hover:underline shrink-0" data-testid={`admin-edit-${p.id}`}>تعديل</button>
                <button onClick={() => deleteProduct(p)} className="text-gray-400 hover:text-red-500 shrink-0" aria-label="حذف" data-testid={`admin-delete-${p.id}`}><Trash2 size={18} /></button>
              </div>
            ))}
            {visible.length === 0 && <p className="text-center text-gray-500 py-10">لا توجد منتجات.</p>}
          </div>
        </div>
      )}

      {tab === "add" && <ProductForm data={data} aiKey={aiKey} aiModel={aiModel} onSave={addProduct} />}

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
            {data.categories.map((c) => (
              <div key={c.id} className="flex items-center gap-3 bg-white border border-pink-100 rounded-2xl p-3" data-testid={`admin-cat-${c.id}`}>
                <span className="w-11 h-11 rounded-xl bg-pink-50 flex items-center justify-center text-2xl shrink-0">{c.emoji || "🛍️"}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900">{c.name}</p>
                  <p className="text-xs text-gray-500">{counts[c.id] || 0} منتج</p>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 shrink-0">
                  <input type="checkbox" checked={!!c.home} onChange={(e) => change((d) => { d.categories.find((x) => x.id === c.id).home = e.target.checked; return d; })} /> بالرئيسية
                </label>
                <button onClick={() => deleteCategory(c)} disabled={!!counts[c.id]} title={counts[c.id] ? "احذف أو انقل منتجات القسم أولاً" : "حذف القسم"} className="text-gray-400 hover:text-red-500 disabled:opacity-30 disabled:hover:text-gray-400 shrink-0" data-testid={`admin-cat-delete-${c.id}`}><Trash2 size={18} /></button>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">القسم اللي بيه منتجات ما ينحذف — احذف منتجاته أو انقلها لقسم ثاني أولاً.</p>
        </div>
      )}

      {tab === "settings" && (
        <div className="bg-white border border-pink-100 rounded-3xl p-5 sm:p-7 space-y-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">الذكاء الاصطناعي</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              شيل الخلفية يشتغل على جهازك مباشرة وما يحتاج مفتاح. قراءة الاسم والوصف من الصورة تحتاج مفتاح Claude API خاص بك
              (<a href={AI_HELP_URL} target="_blank" rel="noopener noreferrer" className="text-pink-600 underline">من هنا</a>) وتكلفتها سنتات قليلة لكل منتج.
              المفتاح ينحفظ بمتصفحك فقط.
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">مفتاح Claude API</label>
            <input type="password" value={aiKey} onChange={(e) => { setAiKey(e.target.value.trim()); store.set(AI_KEY, e.target.value.trim()); }} placeholder="sk-ant-..." dir="ltr" autoComplete="off" className={inputCls} data-testid="admin-ai-key" />
            <label className="block text-sm font-medium text-gray-700 mb-1 mt-3">الموديل</label>
            <select value={aiModel} onChange={(e) => { setAiModel(e.target.value); store.set(AI_MODEL_KEY, e.target.value); }} className={inputCls} data-testid="admin-ai-model">
              {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="border-t border-pink-100 pt-5">
            <h2 className="text-lg font-bold text-gray-900 mb-1">الحساب</h2>
            <p className="text-sm text-gray-600 mb-3">الخروج يمسح رمز GitHub من هذا المتصفح.</p>
            <button onClick={onLogout} className={btnGhost}>خروج ومسح الرمز</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ============== ENTRY ==============
export default function Admin() {
  const [session, setSession] = useState(null); // { token, loaded }
  const [checking, setChecking] = useState(() => !!store.get(TOKEN_KEY));

  useEffect(() => {
    const saved = store.get(TOKEN_KEY);
    if (!saved) return;
    loadStoreData(saved)
      .then((loaded) => setSession({ token: saved, loaded }))
      .catch(() => store.set(TOKEN_KEY, ""))
      .finally(() => setChecking(false));
  }, []);

  const logout = () => { store.set(TOKEN_KEY, ""); setSession(null); };

  if (checking) return <div className="py-20 text-center text-gray-500">جاري التحميل...</div>;
  if (!session) return <Login onLogin={(token, loaded) => setSession({ token, loaded })} />;
  return <Panel token={session.token} initial={session.loaded} onLogout={logout} />;
}
