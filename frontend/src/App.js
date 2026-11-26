import React, { useEffect, useState, createContext, useContext, useMemo, Suspense, lazy } from "react";
import { HashRouter, Routes, Route, Link, useParams, useNavigate, useLocation } from "react-router-dom";
import axios from "./localAxios";
import staticData from "./staticData.json";
import { ShoppingBag, Heart, Search, X, ChevronLeft, Plus, Minus, Trash2, MessageCircle, Truck, ShieldCheck, Sparkles, Phone, MapPin, Instagram, Facebook, Home as HomeIcon, LayoutGrid, BadgePercent } from "lucide-react";
import "@/App.css";
import { apiRequest } from "./ordersApi";
import { SETTINGS } from "./siteSettings";

// After a new deploy the browser may still hold the old page, whose admin file no longer
// exists. In that case reload once from the server instead of showing a blank page.
const RELOAD_KEY = "admin_chunk_reload";
const freshReload = () => {
  const url = new URL(window.location.href);
  url.searchParams.set("r", Date.now().toString(36));
  window.location.replace(url.toString());
};
const Admin = lazy(() => import("./admin/Admin")
  .then((m) => { try { sessionStorage.removeItem(RELOAD_KEY); } catch (e) { /* ignore */ } return m; })
  .catch((err) => {
    let reloaded = false;
    try { reloaded = sessionStorage.getItem(RELOAD_KEY) === "1"; sessionStorage.setItem(RELOAD_KEY, "1"); } catch (e) { /* ignore */ }
    if (!reloaded) { freshReload(); return new Promise(() => {}); }
    throw err;
  }));

// shows what went wrong in the admin panel instead of a blank page
class AdminBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("Admin panel error:", error, info && info.componentStack); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center" data-testid="admin-error">
        <p className="text-lg font-bold text-gray-900 mb-2">صار خطأ بلوحة الأدمن</p>
        <p className="text-sm text-red-600 break-words mb-4" dir="ltr">{String((error && error.message) || error)}</p>
        <button type="button" onClick={() => window.location.reload()} className="px-5 py-2.5 rounded-full bg-pink-600 text-white font-semibold">حدّث الصفحة</button>
      </div>
    );
  }
}

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const WHATSAPP_NUMBER = SETTINGS.whatsapp; // edited from the admin panel
const buildWhatsAppUrl = (text) =>
  `https://wa.me/${WHATSAPP_NUMBER}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
// Opens an empty tab synchronously (inside the customer's tap) so it is not blocked,
// then points it at WhatsApp once the order has been saved.
const openPendingTab = () => {
  let win = null;
  try { win = window.open("", "_blank"); } catch (e) { win = null; }
  if (!win) return null;
  try {
    win.document.write('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>جاري فتح واتساب</title><body style="font-family:Tahoma,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#555;direction:rtl">جاري تجهيز طلبج وفتح واتساب…</body>');
    win.document.close();
  } catch (e) { /* ignore */ }
  return win;
};
const DELIVERY_FEE = SETTINGS.deliveryFee; // د.ع - delivery to the other governorates (admin panel)
const deliverySummary = () => `توصيل اختياري بـ ${formatPrice(DELIVERY_FEE)}`;

const formatPrice = (n) => Number(n).toLocaleString("en-US") + " د.ع";

// Iraqi mobile numbers: 07XXXXXXXXX (also accepts +964 / 00964 and Arabic digits)
const normalizeIraqiPhone = (value) => {
  let v = String(value || "")
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[^\d+]/g, "");
  if (v.startsWith("+964")) v = "0" + v.slice(4);
  else if (v.startsWith("00964")) v = "0" + v.slice(5);
  else if (v.startsWith("964")) v = "0" + v.slice(3);
  if (/^7\d{9}$/.test(v)) v = "0" + v;
  return v;
};
const isIraqiPhone = (value) => /^07[3-9]\d{8}$/.test(normalizeIraqiPhone(value));

// Session-level seed: changes on every page load/refresh
const SESSION_SEED = Math.floor(Math.random() * 100000) + Date.now();

// Deterministic per session, but different across page loads
const getSocialProof = (productId) => {
  let hash = SESSION_SEED;
  for (let i = 0; i < productId.length; i++) hash = (hash * 31 + productId.charCodeAt(i)) >>> 0;
  const qty = 3 + (hash % 22); // 3..24 pieces
  const hours = 6 + ((hash >>> 5) % 19); // 6..24 hours
  return { qty, hours };
};

// ============== COOKIES / SAVED PREFERENCES ==============
// After the visitor accepts cookies we remember the cart, the delivery details and the
// recently viewed products on this device, so the next visit is faster.
const COOKIE_KEY = "cookie_consent";
const hasConsent = () => {
  try { return localStorage.getItem(COOKIE_KEY) === "accepted"; } catch (e) { return false; }
};
const readJson = (storage, key, fallback) => {
  try { const v = JSON.parse(storage.getItem(key)); return v ?? fallback; } catch (e) { return fallback; }
};
const writeJson = (storage, key, value) => {
  try { storage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
};
const loadCart = () => {
  const session = readJson(sessionStorage, "bp_cart", null);
  if (Array.isArray(session) && session.length) return session;
  const saved = hasConsent() ? readJson(localStorage, "bp_cart", []) : [];
  return Array.isArray(saved) ? saved : [];
};
const saveCart = (items) => {
  writeJson(sessionStorage, "bp_cart", items);
  if (hasConsent()) writeJson(localStorage, "bp_cart", items);
};
const loadCustomer = () => (hasConsent() ? readJson(localStorage, "bp_customer", {}) : {});
const saveCustomer = (info) => { if (hasConsent()) writeJson(localStorage, "bp_customer", info); };
const loadRecent = () => {
  const ids = hasConsent() ? readJson(localStorage, "bp_recent", []) : [];
  return Array.isArray(ids) ? ids : [];
};
const pushRecent = (id) => {
  if (!hasConsent()) return;
  writeJson(localStorage, "bp_recent", [id, ...loadRecent().filter((x) => x !== id)].slice(0, 10));
};

// ============== CART CONTEXT ==============
const CartContext = createContext(null);
const useCart = () => useContext(CartContext);

const CartProvider = ({ children }) => {
  const [items, setItems] = useState(loadCart);
  const [wishlist, setWishlist] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("bp_wishlist") || "[]");
    } catch {
      return [];
    }
  });
  const [isCartOpen, setIsCartOpen] = useState(false);

  useEffect(() => {
    saveCart(items);
    // once cookies are accepted, keep the current cart for the next visit too
    const onConsent = () => saveCart(items);
    window.addEventListener("cookie-consent", onConsent);
    return () => window.removeEventListener("cookie-consent", onConsent);
  }, [items]);
  useEffect(() => {
    try { localStorage.setItem("bp_wishlist", JSON.stringify(wishlist)); } catch (e) { /* storage unavailable */ }
  }, [wishlist]);

  const addToCart = (product, qty = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      if (existing) {
        return prev.map((i) => (i.id === product.id ? { ...i, qty: i.qty + qty } : i));
      }
      return [...prev, { id: product.id, name: product.name, price: product.price, image: product.image, qty, free_delivery: !!product.free_delivery }];
    });
    setIsCartOpen(true);
  };
  const removeFromCart = (id) => setItems((prev) => prev.filter((i) => i.id !== id));
  const updateQty = (id, qty) => {
    if (qty <= 0) return removeFromCart(id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, qty } : i)));
  };
  const clearCart = () => setItems([]);
  const toggleWishlist = (productId) => {
    setWishlist((prev) => (prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]));
  };

  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const totalPrice = items.reduce((s, i) => s + i.price * i.qty, 0);
  // Free delivery if cart is non-empty AND every item has free_delivery flag
  const deliveryFee = items.length > 0 && items.every((i) => i.free_delivery) ? 0 : DELIVERY_FEE;

  return (
    <CartContext.Provider value={{ items, addToCart, removeFromCart, updateQty, clearCart, totalQty, totalPrice, deliveryFee, isCartOpen, setIsCartOpen, wishlist, toggleWishlist }}>
      {children}
    </CartContext.Provider>
  );
};

// ============== HEADER ==============
const Header = () => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const navigate = useNavigate();

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQ.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQ.trim())}`);
      setSearchOpen(false);
      setSearchQ("");
    }
  };

  return (
    <>
      {/* Top announcement bar */}
      <div className="bg-[#e91e63] text-white text-center text-xs sm:text-sm py-2 px-4 overflow-hidden">
        <div className="marquee whitespace-nowrap">
          {SETTINGS.announcement}
        </div>
      </div>

      <header className="sticky top-0 z-40 bg-white border-b border-pink-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-20 gap-4">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2" data-testid="logo-link">
              <div className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                <span className="text-[#e91e63]">{SETTINGS.storeName}</span>
              </div>
            </Link>

            {/* Actions */}
            <div className="flex items-center gap-3 sm:gap-5">
              <button onClick={() => setSearchOpen(true)} className="text-gray-700 hover:text-pink-600" data-testid="search-toggle">
                <Search size={22} />
              </button>
              <a
                href={`https://wa.me/${WHATSAPP_NUMBER}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="واتساب"
                className="text-[#25d366] hover:text-green-600 transition"
                data-testid="header-whatsapp"
              >
                <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
                  <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35zM12.05 21.5h-.01a9.5 9.5 0 0 1-4.84-1.33l-.35-.21-3.6.94.96-3.5-.23-.36A9.46 9.46 0 0 1 2.53 12c0-5.24 4.27-9.5 9.52-9.5 2.54 0 4.93.99 6.72 2.79a9.43 9.43 0 0 1 2.78 6.72c0 5.24-4.27 9.5-9.5 9.5zm8.1-17.6A11.4 11.4 0 0 0 12.05.5C5.73.5.6 5.63.6 11.95c0 2.02.53 3.99 1.53 5.73L.5 23.5l5.95-1.56a11.4 11.4 0 0 0 5.6 1.43h.01c6.32 0 11.45-5.13 11.45-11.45 0-3.06-1.19-5.94-3.36-8.1z"/>
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* Search overlay */}
        {searchOpen && (
          <div className="absolute top-full inset-x-0 bg-white border-b border-pink-100 shadow-lg p-4">
            <form onSubmit={handleSearch} className="max-w-3xl mx-auto flex items-center gap-2">
              <Search size={20} className="text-gray-400" />
              <input
                autoFocus
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="ابحثي عن منتج..."
                className="flex-1 outline-none text-base bg-transparent py-2"
                data-testid="search-input"
              />
              <button type="button" onClick={() => setSearchOpen(false)} className="text-gray-500" data-testid="search-close">
                <X size={20} />
              </button>
            </form>
          </div>
        )}
      </header>

    </>
  );
};

// ============== CART DRAWER ==============
const CartDrawer = () => {
  const { items, isCartOpen, setIsCartOpen, removeFromCart, updateQty, totalPrice, deliveryFee } = useCart();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    setIsCartOpen(false);
  }, [pathname, setIsCartOpen]);

  if (!isCartOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setIsCartOpen(false)}>
      <div className="absolute top-0 left-0 h-full w-[420px] max-w-[92%] bg-white flex flex-col" onClick={(e) => e.stopPropagation()} data-testid="cart-drawer">
        <div className="flex items-center justify-between p-5 border-b border-pink-100">
          <h3 className="text-lg font-bold flex items-center gap-2"><ShoppingBag size={20} className="text-pink-600" /> سلة التسوق ({items.length})</h3>
          <button onClick={() => setIsCartOpen(false)} data-testid="cart-close"><X size={22} /></button>
        </div>

        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 px-6 text-center">
            <ShoppingBag size={56} className="text-pink-200 mb-4" />
            <p className="text-lg font-medium mb-1">سلتج فارغة</p>
            <p className="text-sm text-gray-400 mb-6">اكتشفي منتجاتنا المميزة وأضيفيها لسلتج</p>
            <button onClick={() => { setIsCartOpen(false); navigate("/"); }} className="bg-pink-600 hover:bg-pink-700 text-white px-6 py-3 rounded-full font-medium" data-testid="cart-shop-btn">
              تسوقي الآن
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {items.map((item) => (
                <div key={item.id} className="flex gap-3 pb-4 border-b border-pink-50" data-testid={`cart-item-${item.id}`}>
                  <img src={item.image} alt={item.name} className="w-20 h-20 object-cover rounded-lg bg-pink-50" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-2 text-gray-800 mb-1">{item.name}</p>
                    <p className="text-pink-600 font-bold text-sm mb-2">{formatPrice(item.price)}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center border border-pink-200 rounded-full">
                        <button onClick={() => updateQty(item.id, item.qty - 1)} className="px-2 py-1 hover:bg-pink-50 rounded-full" data-testid={`qty-minus-${item.id}`}><Minus size={14} /></button>
                        <span className="px-3 text-sm font-medium">{item.qty}</span>
                        <button onClick={() => updateQty(item.id, item.qty + 1)} className="px-2 py-1 hover:bg-pink-50 rounded-full" data-testid={`qty-plus-${item.id}`}><Plus size={14} /></button>
                      </div>
                      <button onClick={() => removeFromCart(item.id)} className="text-gray-400 hover:text-red-500" data-testid={`remove-${item.id}`}>
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-pink-100 p-5 bg-pink-50/40">
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-600">المجموع</span>
                <span className="text-2xl font-extrabold text-pink-600" data-testid="cart-total">{formatPrice(totalPrice)}</span>
              </div>
              <button
                onClick={() => { setIsCartOpen(false); navigate("/checkout"); }}
                className="w-full bg-[#e91e63] hover:bg-pink-700 text-white py-4 rounded-full font-bold text-base flex items-center justify-center gap-2 transition"
                data-testid="checkout-btn"
              >
                <MessageCircle size={20} /> إتمام الطلب عبر واتساب
              </button>
              <p className="text-xs text-gray-500 text-center mt-3">
                {deliveryFee === 0 ? "🎉 توصيل مجاني لهذا الطلب" : `+ رسوم التوصيل: ${deliverySummary()}`}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ============== PRODUCT CARD ==============
const ProductCard = ({ product }) => {
  const { addToCart, wishlist, toggleWishlist } = useCart();
  const isWish = wishlist.includes(product.id);
  const hasDiscount = product.sale_price && product.sale_price > product.price;
  const isFreeNoWhatsApp = product.no_whatsapp === true;

  return (
    <div className="group relative bg-white rounded-2xl overflow-hidden border border-pink-50 hover:border-pink-200 hover:shadow-xl transition-all duration-300" data-testid={`product-card-${product.id}`}>
      {product.badge && (
        <div className="absolute top-3 right-3 z-10 bg-[#e91e63] text-white text-xs font-bold px-2.5 py-1 rounded-full">
          {product.badge}
        </div>
      )}
      <button
        onClick={(e) => { e.preventDefault(); toggleWishlist(product.id); }}
        className={`absolute top-3 left-3 z-10 w-9 h-9 rounded-full flex items-center justify-center transition ${isWish ? "bg-pink-600 text-white" : "bg-white/90 text-gray-600 hover:text-pink-600"}`}
        data-testid={`wishlist-btn-${product.id}`}
      >
        <Heart size={16} fill={isWish ? "currentColor" : "none"} />
      </button>

      <Link to={`/product/${product.id}`} className="block">
        <div className="aspect-square bg-gradient-to-br from-pink-50 to-rose-50 overflow-hidden">
          <img src={product.image} alt={product.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        </div>
      </Link>
      <div className="p-4">
        <Link to={`/product/${product.id}`}>
          <h3 className="text-sm font-medium text-gray-800 line-clamp-2 min-h-[2.5rem] mb-2 hover:text-pink-600 transition" data-testid={`product-name-${product.id}`}>
            {product.name}
          </h3>
        </Link>
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-pink-600 font-extrabold text-base">{isFreeNoWhatsApp ? "مجاني" : formatPrice(product.price)}</span>
          {hasDiscount && <span className="text-gray-400 line-through text-xs">{formatPrice(product.sale_price)}</span>}
        </div>
        {/* Social proof */}
        {!isFreeNoWhatsApp && SETTINGS.showSocialProof && (() => {
          const sp = getSocialProof(product.id);
          return (
            <div className="flex items-center gap-1 text-[11px] text-red-500 font-semibold mb-3 animate-pulse">
              <span>🔥</span>
              <span>تم شراء {sp.qty} قطعة في آخر {sp.hours} ساعة</span>
            </div>
          );
        })()}
        {isFreeNoWhatsApp ? (
          <Link
            to={`/product/${product.id}`}
            className="w-full bg-gray-900 hover:bg-pink-600 text-white py-2.5 rounded-full text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
            data-testid={`free-product-${product.id}`}
          >
            <Sparkles size={15} /> عرض الوصف المجاني
          </Link>
        ) : (
          <button
            onClick={() => addToCart(product)}
            className="w-full bg-gray-900 hover:bg-pink-600 text-white py-2.5 rounded-full text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
            data-testid={`add-to-cart-${product.id}`}
          >
            <ShoppingBag size={15} /> أضف إلى السلة
          </button>
        )}
      </div>
    </div>
  );
};

// ============== HERO SECTION ==============
const Hero = () => {
  const slides = SETTINGS.banners.filter((s) => s && s.img);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (slides.length < 2) return undefined;
    const t = setInterval(() => setI((p) => (p + 1) % slides.length), 5000);
    return () => clearInterval(t);
  }, [slides.length]);
  if (slides.length === 0) return null;

  return (
    <section className="relative bg-gradient-to-br from-pink-100 via-rose-50 to-pink-50 overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <div className="relative aspect-[16/9] sm:aspect-[21/8] overflow-hidden">
          {slides.map((s, idx) => (
            <Link key={idx} to={s.link} className={`absolute inset-0 transition-opacity duration-1000 ${idx === i ? "opacity-100" : "opacity-0"}`}>
              <img src={s.img} alt={s.title} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-l from-pink-900/40 via-transparent to-transparent" />
            </Link>
          ))}
          {/* Dots */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-2 z-10">
            {slides.map((_, idx) => (
              <button key={idx} onClick={() => setI(idx)} className={`h-2 rounded-full transition-all ${idx === i ? "w-8 bg-pink-600" : "w-2 bg-white/70"}`} aria-label={`slide ${idx}`} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

// ============== FEATURE STRIP ==============
const FeatureStrip = () => {
  const icons = [Truck, ShieldCheck, Sparkles, MessageCircle];
  const features = SETTINGS.features.filter((f) => f && (f.title || f.desc)).map((f, idx) => ({ ...f, icon: icons[idx % icons.length] }));
  if (features.length === 0) return null;
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {features.map((f, idx) => (
          <div key={idx} className="bg-white rounded-2xl border border-pink-100 p-5 flex items-center gap-3 hover:shadow-md transition">
            <div className="w-12 h-12 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center flex-shrink-0">
              <f.icon size={22} />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm text-gray-800">{f.title}</p>
              <p className="text-xs text-gray-500 line-clamp-1">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

// ============== PRODUCT SECTION ==============
const ProductSection = ({ title, emoji, category, viewAllLink }) => {
  const [products, setProducts] = useState(() => staticData.products.filter((product) => product.category === category).slice(0, 10));
  useEffect(() => {
    axios.get(`${API}/products?category=${category}&limit=10`).then((r) => setProducts(r.data)).catch(() => {});
  }, [category]);

  if (products.length === 0) return null;

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900">
          {title} <span className="text-pink-500">{emoji}</span>
        </h2>
        {viewAllLink && (
          <Link to={viewAllLink} className="text-pink-600 hover:text-pink-700 text-sm font-semibold flex items-center gap-1" data-testid={`view-all-${category}`}>
            عرض الكل <ChevronLeft size={16} />
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
        {products.slice(0, 10).map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
};

// ============== RECENTLY VIEWED (needs cookie consent) ==============
const RecentlyViewed = () => {
  const [products] = useState(() => loadRecent().map((id) => staticData.products.find((p) => p.id === id)).filter(Boolean).slice(0, 5));
  if (products.length === 0) return null;
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="recently-viewed">
      <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-6">شفتيها مؤخراً <span className="text-pink-500">👀</span></h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
};

// ============== CATEGORIES SECTION ==============
// A real product photo for each category tile: the category's own image if
// the admin set one, otherwise a product from that category (clean PNGs first).
const categoryImage = (c) => {
  if (c.image) return c.image;
  const inCat = staticData.products.filter((p) => p.category === c.slug && p.image && !/placeholder/.test(p.image));
  const png = inCat.find((p) => /\.png(\?|$)/i.test(p.image));
  return (png || inCat[0] || {}).image || "";
};

const CategoriesSection = () => {
  const [cats, setCats] = useState(staticData.categories);
  useEffect(() => {
    axios.get(`${API}/categories`).then((r) => setCats(r.data)).catch(() => {});
  }, []);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-6">اختاري روتينج</h2>
      <div className="grid grid-cols-3 md:grid-cols-9 gap-3">
        {cats.map((c) => (
          <Link key={c.id} to={`/collection/category-${c.slug}`} className="group text-center" data-testid={`category-${c.slug}`}>
            <div className="aspect-square bg-gradient-to-br from-pink-50 to-rose-100 rounded-2xl overflow-hidden mb-2 p-2 group-hover:shadow-lg transition">
              {categoryImage(c) ? (
                <div className="w-full h-full bg-white rounded-xl overflow-hidden flex items-center justify-center">
                  <img src={categoryImage(c)} alt={c.name} loading="lazy" className="w-full h-full object-contain p-1.5 group-hover:scale-110 transition-transform" />
                </div>
              ) : (
                <span className="w-full h-full flex items-center justify-center text-4xl sm:text-5xl group-hover:scale-110 transition-transform" aria-hidden="true">{c.emoji}</span>
              )}
            </div>
            <p className="text-xs sm:text-sm font-semibold text-gray-700 group-hover:text-pink-600">{c.name}</p>
          </Link>
        ))}
      </div>
    </section>
  );
};

// ============== SKIN TYPES SECTION ==============
const SkinTypesSection = () => {
  const [types, setTypes] = useState(staticData.skinTypes);
  useEffect(() => {
    axios.get(`${API}/skin-types`).then((r) => setTypes(r.data)).catch(() => {});
  }, []);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-6">تسوقي حسب نوع بشرتج</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {types.map((t) => (
          <Link key={t.id} to={`/collection/skin-${t.id}`} className="group text-center" data-testid={`skin-type-${t.id}`}>
            <div className="aspect-square rounded-2xl overflow-hidden mb-2 relative group-hover:shadow-lg transition">
              <img src={t.image} alt={t.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              <div className="absolute inset-0 bg-gradient-to-t from-pink-900/60 to-transparent" />
              <p className="absolute bottom-3 inset-x-0 text-white font-bold text-sm">{t.name}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
};

// ============== HOME ==============
const Home = () => {
  const [count, setCount] = useState(staticData.products.length);
  useEffect(() => {
    axios.get(`${API}/products?limit=1`).then((r) => setCount(r.data.length)).catch(() => setCount(0));
  }, []);

  if (count === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <div className="text-6xl mb-5">🌸</div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3">قريباً منتجات جديدة!</h2>
        <p className="text-gray-500 mb-6">نعمل على إضافة منتجاتنا المميزة - تابعونا قريباً 💕</p>
        <a
          href={`https://wa.me/${WHATSAPP_NUMBER}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-[#25d366] hover:bg-green-600 text-white px-6 py-3 rounded-full font-bold transition"
        >
          <MessageCircle size={20} /> تواصلي معنا عبر واتساب
        </a>
      </div>
    );
  }

  return (
    <>
      <Hero />
      <FeatureStrip />
      <ProductSection title="الأكثر طلباً" emoji="⭐" category="best-selling" viewAllLink="/collection/best-selling" />
      {SETTINGS.showRoutine && <CategoriesSection />}
      <ProductSection title="عرض حصري" emoji="💎" category="offers" viewAllLink="/collection/offers" />
      {staticData.categories.filter((c) => c.home).map((c) => (
        <ProductSection key={c.id} title={c.name} emoji={c.emoji} category={c.id} viewAllLink={`/collection/category-${c.slug}`} />
      ))}
      <RecentlyViewed />
    </>
  );
};

// ============== COLLECTION PAGE ==============
const Collection = () => {
  const { slug } = useParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  const titles = {
    offers: "العروض الحصرية 💎",
    "last-chance": "فرصتج الأخيرة ⏰",
    "best-selling": "الأكثر طلباً ⭐",
    perfumes: "العطور 🌸",
    makeup: "المكياج 💄",
  };

  useEffect(() => {
    setLoading(true);
    let url;
    if (slug.startsWith("skin-")) {
      url = `${API}/products?skin_type=${slug.replace("skin-", "")}&limit=100`;
    } else if (slug.startsWith("category-")) {
      url = `${API}/products?category=${slug.replace("category-", "")}&limit=100`;
    } else {
      url = `${API}/products?category=${slug}&limit=100`;
    }
    axios.get(url).then((r) => { setProducts(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, [slug]);

  const categoryName = slug.startsWith("category-")
    ? (staticData.categories.find((c) => c.slug === slug.replace("category-", "")) || {}).name
    : slug.startsWith("skin-")
      ? (staticData.skinTypes.find((t) => t.id === slug.replace("skin-", "")) || {}).name
      : null;
  const title = titles[slug] || categoryName || "المنتجات";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-2" data-testid="collection-title">{title}</h1>
      <p className="text-gray-500 mb-8">{products.length} منتج</p>

      {loading ? (
        <div className="text-center py-20 text-gray-500">جاري التحميل...</div>
      ) : products.length === 0 ? (
        <div className="text-center py-20 text-gray-500">لا توجد منتجات في هذه الفئة حالياً</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
          {products.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
};

// ============== SEARCH PAGE ==============
const SearchPage = () => {
  const { search } = useLocation();
  const q = new URLSearchParams(search).get("q") || "";
  const [products, setProducts] = useState([]);

  useEffect(() => {
    axios.get(`${API}/products?search=${encodeURIComponent(q)}`).then((r) => setProducts(r.data)).catch(() => {});
  }, [q]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-2">نتائج البحث: &quot;{q}&quot;</h1>
      <p className="text-gray-500 mb-8">{products.length} منتج</p>
      {products.length === 0 ? (
        <div className="text-center py-20 text-gray-500">لم نجد منتجات تطابق بحثج. جربي كلمة أخرى.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
          {products.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
};

// ============== PRODUCT DETAIL ==============
const ProductDetail = () => {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [related, setRelated] = useState([]);
  const [qty, setQty] = useState(1);
  const [copied, setCopied] = useState(false);
  const { addToCart, wishlist, toggleWishlist } = useCart();
  const navigate = useNavigate();

  useEffect(() => {
    axios.get(`${API}/products/${id}`)
      .then((r) => {
        setProduct(r.data);
        pushRecent(r.data.id);
        axios.get(`${API}/products?category=${r.data.category}&limit=10`).then((res) => setRelated(res.data.filter((p) => p.id !== id)));
      })
      .catch(() => navigate("/"));
    setQty(1);
    window.scrollTo(0, 0);
  }, [id, navigate]);

  if (!product) return <div className="py-20 text-center text-gray-500">جاري التحميل...</div>;

  const hasDiscount = product.sale_price && product.sale_price > product.price;
  const isWish = wishlist.includes(product.id);
  const isFreeNoWhatsApp = product.no_whatsapp === true;
  const copyDescription = async () => {
    try {
      await navigator.clipboard.writeText(product.description || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(true);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="grid md:grid-cols-2 gap-10">
        <div className="bg-gradient-to-br from-pink-50 to-rose-50 rounded-3xl overflow-hidden">
          <img src={product.image} alt={product.name} className="w-full h-full object-contain aspect-square" data-testid="product-detail-image" />
        </div>
        <div className="flex flex-col">
          {product.badge && <span className="self-start bg-[#e91e63] text-white text-xs font-bold px-3 py-1 rounded-full mb-4">{product.badge}</span>}
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3" data-testid="product-detail-name">{product.name}</h1>
          {product.brand && <p className="text-pink-600 font-semibold mb-4">العلامة التجارية: {product.brand}</p>}

          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-3xl font-extrabold text-pink-600">{isFreeNoWhatsApp ? "مجاني" : formatPrice(product.price)}</span>
            {hasDiscount && <span className="text-gray-400 line-through text-lg">{formatPrice(product.sale_price)}</span>}
          </div>
          {/* Social proof banner */}
          {!isFreeNoWhatsApp && SETTINGS.showSocialProof && (() => {
            const sp = getSocialProof(product.id);
            return (
              <div className="inline-flex items-center gap-2 bg-red-50 text-red-600 text-sm font-bold px-3 py-2 rounded-full mb-6 animate-pulse w-fit">
                <span className="text-base">🔥</span>
                <span>تم شراء {sp.qty} قطعة في آخر {sp.hours} ساعة</span>
              </div>
            );
          })()}

          {product.description && <p className="text-gray-600 leading-relaxed mb-6 whitespace-pre-line">{product.description}</p>}

          {isFreeNoWhatsApp ? (
            <div className="mb-6">
              <button onClick={copyDescription} className="w-full bg-[#e91e63] hover:bg-pink-700 text-white py-4 rounded-full font-bold flex items-center justify-center gap-2 transition" data-testid="copy-free-description">
                <Sparkles size={20} /> {copied ? "تم نسخ الوصف" : "نسخ وصف التصميم مجاناً"}
              </button>
              <p className="text-center text-xs text-gray-500 mt-3">هذا المنتج مجاني ولا يحوّلك إلى واتساب.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-6">
                <span className="font-semibold">الكمية:</span>
                <div className="flex items-center border-2 border-pink-200 rounded-full">
                  <button onClick={() => setQty(Math.max(1, qty - 1))} className="px-3 py-2 hover:bg-pink-50 rounded-r-full" data-testid="detail-qty-minus"><Minus size={16} /></button>
                  <span className="px-5 font-bold">{qty}</span>
                  <button onClick={() => setQty(qty + 1)} className="px-3 py-2 hover:bg-pink-50 rounded-l-full" data-testid="detail-qty-plus"><Plus size={16} /></button>
                </div>
              </div>

              <div className="flex gap-3 mb-6">
                <button onClick={() => addToCart(product, qty)} className="flex-1 bg-[#e91e63] hover:bg-pink-700 text-white py-4 rounded-full font-bold flex items-center justify-center gap-2 transition" data-testid="detail-add-cart">
                  <ShoppingBag size={20} /> أضيفي إلى السلة
                </button>
                <button onClick={() => toggleWishlist(product.id)} className={`w-14 h-14 rounded-full flex items-center justify-center transition ${isWish ? "bg-pink-600 text-white" : "border-2 border-pink-200 text-pink-600 hover:bg-pink-50"}`} data-testid="detail-wishlist">
                  <Heart size={20} fill={isWish ? "currentColor" : "none"} />
                </button>
              </div>
            </>
          )}

          <div className="border-t border-pink-100 pt-5 space-y-3 text-sm">
            <div className="flex items-center gap-2 text-gray-700"><Truck size={18} className="text-pink-600" /> {deliverySummary()}</div>
            <div className="flex items-center gap-2 text-gray-700"><ShieldCheck size={18} className="text-pink-600" /> منتج أصلي 100% مضمون</div>
            {isFreeNoWhatsApp ? (
              <div className="flex items-center gap-2 text-gray-700"><Sparkles size={18} className="text-pink-600" /> انسخي الوصف واستخدميه مجاناً</div>
            ) : (
              <div className="flex items-center gap-2 text-gray-700"><MessageCircle size={18} className="text-pink-600" /> استشارة عبر واتساب</div>
            )}
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <div className="mt-16">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-6">منتجات مشابهة</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
            {related.slice(0, 5).map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </div>
      )}
    </div>
  );
};

// ============== WISHLIST PAGE ==============
const WishlistPage = () => {
  const { wishlist } = useCart();
  const [products, setProducts] = useState([]);
  useEffect(() => {
    if (wishlist.length === 0) return setProducts([]);
    Promise.all(wishlist.map((id) => axios.get(`${API}/products/${id}`).then((r) => r.data).catch(() => null)))
      .then((res) => setProducts(res.filter(Boolean)));
  }, [wishlist]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="text-3xl font-extrabold text-gray-900 mb-2">قائمة الرغبات</h1>
      <p className="text-gray-500 mb-8">{products.length} منتج</p>
      {products.length === 0 ? (
        <div className="text-center py-20">
          <Heart size={60} className="text-pink-200 mx-auto mb-4" />
          <p className="text-lg text-gray-500 mb-6">قائمة رغباتج فارغة</p>
          <Link to="/" className="bg-pink-600 text-white px-6 py-3 rounded-full font-semibold inline-block">تسوقي الآن</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
          {products.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
};

// ============== CHECKOUT (WhatsApp redirect) ==============
const fieldCls = "w-full border-2 border-pink-100 focus:border-pink-400 outline-none rounded-2xl px-4 py-3.5 bg-white text-base transition";

const Checkout = () => {
  const { items, totalPrice, clearCart } = useCart();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => {
    const saved = loadCustomer();
    return { phone: saved.phone || "", delivery: saved.delivery !== false, address: saved.address || "", notes: "" };
  });
  const [sent, setSent] = useState(false);
  const [orderUrl, setOrderUrl] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [receipt, setReceipt] = useState(null); // { id, items, subtotal, deliveryFee, delivery, total, saved, whatsappOpened }
  const isKidsVideoOnly = items.length > 0 && items.every((item) => item.id === "kids-video-design");
  const allFree = items.length > 0 && items.every((i) => i.free_delivery);
  // delivery is optional: the fee applies only when the customer asks for it
  const deliveryFee = !form.delivery || allFree ? 0 : DELIVERY_FEE;
  const addressRequired = form.delivery && !isKidsVideoOnly;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (items.length === 0 || submitting) return;

    if ((!isKidsVideoOnly || form.phone.trim()) && !isIraqiPhone(form.phone)) {
      setPhoneError("اكتبي رقم هاتف عراقي صحيح من 11 رقم، مثل 07701234567");
      return;
    }
    if (addressRequired && !form.address.trim()) {
      setSubmitError("اكتبي العنوان حتى نوصل الطلب");
      return;
    }
    setPhoneError("");
    setSubmitError("");
    const phone = form.phone.trim() ? normalizeIraqiPhone(form.phone) : "";
    const deliveryLabel = form.delivery ? "توصيل" : "بدون توصيل (استلام)";
    const customer = { name: "", phone, city: "", delivery: form.delivery, address: form.address.trim(), notes: form.notes.trim() };

    // 1) open the WhatsApp tab now, while we still have the tap
    const pendingTab = openPendingTab();
    setSubmitting(true);

    // 2) save the order on the site (and notify the admin)
    let saved = null;
    try {
      saved = await apiRequest("/api/orders", {
        method: "POST",
        body: { items: items.map((i) => ({ id: i.id, qty: i.qty, price: i.price, name: i.name, free_delivery: i.free_delivery })), customer },
        timeoutMs: 12000,
      });
    } catch (err) {
      if (err.status >= 400 && err.status < 500) {
        // the server refused the order (bad data / too many orders): let the customer fix it
        if (pendingTab) { try { pendingTab.close(); } catch (x) { /* ignore */ } }
        setSubmitError(err.message);
        setSubmitting(false);
        return;
      }
      saved = null; // network/server problem: still send the order by WhatsApp so it is not lost
    }

    const orderItems = saved ? saved.items : items.map((i) => ({ ...i, lineTotal: i.price * i.qty }));
    const orderSubtotal = saved ? saved.subtotal : totalPrice;
    const orderDelivery = saved ? saved.deliveryFee : deliveryFee;
    const grandTotal = orderSubtotal + orderDelivery;
    const deliveryLine = !form.delivery
      ? "🚚 بدون توصيل (استلام)"
      : orderDelivery === 0 ? "🚚 التوصيل: مجاني" : `🚚 التوصيل: ${formatPrice(orderDelivery)}`;
    const lines = [
      `🌸 طلب جديد - ${SETTINGS.storeName} 🌸`,
      saved ? `🧾 رقم الطلب: ${saved.id}` : null,
      "━━━━━━━━━━━━━━━",
      "",
      "📞 بيانات التوصيل",
      `• الهاتف: ${phone || "غير مذكور"}`,
      `• التوصيل: ${deliveryLabel}`,
      `• العنوان: ${form.address.trim() || "غير مذكور"}`,
      form.notes.trim() ? `• ملاحظات: ${form.notes.trim()}` : null,
      "",
      "━━━━━━━━━━━━━━━",
      "🛍️ تفاصيل الطلب",
      "",
      ...orderItems.map((i, idx) => `${idx + 1}) ${i.name}\n     ${i.qty} × ${formatPrice(i.price)}  =  ${formatPrice(i.price * i.qty)}`),
      "",
      "━━━━━━━━━━━━━━━",
      `🧾 مجموع المنتجات: ${formatPrice(orderSubtotal)}`,
      deliveryLine,
      `💰 المبلغ الإجمالي: ${formatPrice(grandTotal)}`,
      "━━━━━━━━━━━━━━━",
      "",
      "شكراً لطلبكم 💕"
    ].filter((l) => l !== null).join("\n");

    saveCustomer({ phone, delivery: form.delivery, address: form.address.trim() });
    const url = buildWhatsAppUrl(lines);

    // 3) send the WhatsApp tab to the chat. If the browser blocked the tab (Instagram/TikTok
    //    in-app browsers), the confirmation page shows a WhatsApp button instead.
    let whatsappOpened = false;
    if (pendingTab && !pendingTab.closed) {
      try { pendingTab.location.href = url; whatsappOpened = true; } catch (x) { whatsappOpened = false; }
    }
    if (!saved && !whatsappOpened) {
      // order was not saved and WhatsApp did not open: go to WhatsApp in this tab so it is not lost
      clearCart();
      window.location.href = url;
      return;
    }

    setReceipt({ id: saved ? saved.id : null, items: orderItems, subtotal: orderSubtotal, deliveryFee: orderDelivery, delivery: form.delivery, total: grandTotal, saved: !!saved, whatsappOpened });
    setOrderUrl(url);
    setSent(true);
    setSubmitting(false);
    clearCart();
    window.scrollTo(0, 0);
  };

  if (sent && receipt) {
    return (
      <div className="max-w-xl mx-auto px-4 py-10" data-testid="order-sent">
        <div className="text-center mb-7">
          <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-green-100 flex items-center justify-center text-4xl">✅</div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">{receipt.saved ? "تم استلام طلبج" : "طلبج جاهز"}</h1>
          {receipt.saved ? (
            <>
              <p className="text-gray-600 mb-3">شكراً إلج 💕 راح نتواصل وياج قريباً لتأكيد الطلب والتوصيل.</p>
              <div className="inline-flex items-center gap-2 bg-pink-50 border border-pink-200 rounded-full px-5 py-2">
                <span className="text-sm text-gray-600">رقم الطلب</span>
                <span className="font-extrabold text-pink-600 tracking-wider" dir="ltr" data-testid="order-number">{receipt.id}</span>
              </div>
            </>
          ) : (
            <p className="text-gray-600 leading-relaxed">
              {receipt.whatsappOpened ? "فتحنالج واتساب ورسالة الطلب مكتوبة، بس اضغطي «إرسال» 💕" : "اضغطي الزر الأخضر حتى يوصلنا طلبج على واتساب 💕"}
            </p>
          )}
        </div>

        <div className="bg-pink-50/50 border border-pink-100 rounded-3xl p-5 mb-6" data-testid="order-receipt">
          <div className="space-y-2 mb-4">
            {receipt.items.map((i) => (
              <div key={i.id} className="flex justify-between gap-3 text-sm">
                <span className="text-gray-700 min-w-0">{i.name} <span className="text-gray-400">× {i.qty}</span></span>
                <span className="font-semibold text-gray-800 shrink-0">{formatPrice(i.price * i.qty)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-pink-200 pt-3 space-y-1 text-sm">
            <div className="flex justify-between text-gray-600"><span>التوصيل</span><span>{!receipt.delivery ? "بدون توصيل" : receipt.deliveryFee === 0 ? "مجاني" : formatPrice(receipt.deliveryFee)}</span></div>
            <div className="flex justify-between text-lg font-extrabold"><span>المبلغ الإجمالي</span><span className="text-pink-600">{formatPrice(receipt.total)}</span></div>
            <p className="text-xs text-gray-500 pt-1">💵 الدفع عند الاستلام</p>
          </div>
        </div>

        <a href={orderUrl} target="_blank" rel="noopener noreferrer" className="w-full bg-[#25d366] hover:bg-green-600 text-white py-4 rounded-full font-bold text-lg flex items-center justify-center gap-2 transition mb-3" data-testid="order-open-whatsapp">
          <MessageCircle size={22} /> {receipt.saved ? "تأكيد الطلب عبر واتساب" : "إرسال الطلب عبر واتساب"}
        </a>
        <button onClick={() => navigate("/")} className="w-full border-2 border-pink-200 text-pink-600 hover:bg-pink-50 py-3.5 rounded-full font-bold transition" data-testid="order-back-home">
          الرجوع للمتجر
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <ShoppingBag size={60} className="text-pink-200 mx-auto mb-4" />
        <p className="text-lg text-gray-600 mb-6">سلتج فارغة، أضيفي منتجات أولاً</p>
        <Link to="/" className="bg-pink-600 text-white px-6 py-3 rounded-full font-semibold inline-block">تسوقي الآن</Link>
      </div>
    );
  }

  const optional = isKidsVideoOnly ? <span className="text-gray-400 font-normal">(اختياري)</span> : null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 overflow-x-hidden">
      <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-1">إتمام الطلب</h1>
      <p className="text-sm text-gray-500 mb-6">بس رقمج وعنوانج، والدفع عند الاستلام 💵</p>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <form onSubmit={handleSubmit} noValidate className="lg:col-span-3 min-w-0 bg-white rounded-3xl border border-pink-100 shadow-sm p-5 sm:p-7 space-y-5" data-testid="checkout-form">
          {isKidsVideoOnly && (
            <p className="text-sm text-pink-600 bg-pink-50 rounded-xl p-3">طلب فيديو الأطفال ما يحتاج بيانات توصيل، كل الحقول اختيارية.</p>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">رقم الهاتف {optional}</label>
            <div className={`flex items-stretch border-2 rounded-2xl overflow-hidden bg-white transition ${phoneError ? "border-red-400" : "border-pink-100 focus-within:border-pink-400"}`} dir="ltr">
              <span className="flex items-center gap-1.5 px-3 bg-pink-50 text-gray-700 text-sm font-semibold border-r border-pink-100 select-none shrink-0">🇮🇶 +964</span>
              <input value={form.phone} onChange={(e) => { setForm({ ...form, phone: e.target.value }); if (phoneError) setPhoneError(""); }} onBlur={() => { if (form.phone.trim() && !isIraqiPhone(form.phone)) setPhoneError("اكتبي رقم هاتف عراقي صحيح من 11 رقم، مثل 07701234567"); }} placeholder="07701234567" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} className="flex-1 min-w-0 w-full outline-none px-4 py-3.5 text-base" data-testid="checkout-phone" />
            </div>
            {phoneError && <p className="text-red-500 text-xs mt-1.5" data-testid="checkout-phone-error">{phoneError}</p>}
          </div>

          <div>
            <p className="block text-sm font-semibold text-gray-800 mb-2">التوصيل</p>
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="التوصيل">
              {[
                { on: true, label: "أريد توصيل", sub: allFree ? "مجاني" : `+ ${formatPrice(DELIVERY_FEE)}` },
                { on: false, label: "بدون توصيل", sub: "أستلمه بنفسي" },
              ].map((o) => {
                const active = form.delivery === o.on;
                return (
                  <button
                    key={String(o.on)}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setForm({ ...form, delivery: o.on })}
                    className={`rounded-2xl border-2 px-3 py-3.5 text-center transition ${active ? "border-pink-500 bg-pink-50 shadow-sm" : "border-pink-100 bg-white hover:border-pink-300"}`}
                    data-testid={`checkout-delivery-${o.on ? "yes" : "no"}`}
                  >
                    <span className={`block font-bold ${active ? "text-pink-700" : "text-gray-800"}`}>{o.label}</span>
                    <span className="block text-xs text-gray-500 mt-1">{o.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">العنوان التفصيلي {addressRequired ? null : <span className="text-gray-400 font-normal">(اختياري)</span>}</label>
            <input required={addressRequired} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="المنطقة، الشارع، أقرب نقطة دالة" autoComplete="street-address" className={fieldCls} data-testid="checkout-address" />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">ملاحظات <span className="text-gray-400 font-normal">(اختياري)</span></label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="أي شي تحبين نعرفه عن طلبج..." className={`${fieldCls} resize-none`} data-testid="checkout-notes" />
          </div>

          <div className="rounded-2xl bg-pink-50/60 border border-pink-100 p-4 space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-600"><span>مجموع المنتجات</span><span>{formatPrice(totalPrice)}</span></div>
            <div className="flex justify-between text-gray-600">
              <span>التوصيل</span>
              <span>{!form.delivery ? "بدون توصيل" : deliveryFee === 0 ? <span className="text-green-600 font-bold">مجاني</span> : formatPrice(deliveryFee)}</span>
            </div>
            <div className="flex justify-between text-lg font-extrabold pt-1.5 border-t border-pink-200"><span>المبلغ الإجمالي</span><span className="text-pink-600" data-testid="checkout-total">{formatPrice(totalPrice + deliveryFee)}</span></div>
          </div>

          {submitError && <p className="text-red-600 text-sm text-center bg-red-50 rounded-xl p-3" data-testid="checkout-submit-error">{submitError}</p>}
          <button type="submit" disabled={submitting} className="w-full bg-[#e91e63] hover:bg-pink-700 disabled:opacity-60 text-white py-4 rounded-full font-bold text-lg flex items-center justify-center gap-2 transition shadow-md" data-testid="submit-order">
            <ShieldCheck size={22} /> {submitting ? "جاري إرسال الطلب..." : "تأكيد الطلب"}
          </button>
          <p className="text-center text-xs text-gray-500">💵 الدفع عند الاستلام · بعد التأكيد ينفتح واتساب ويَّا رسالة الطلب</p>
        </form>

        <aside className="lg:col-span-2 min-w-0 bg-pink-50/50 rounded-3xl border border-pink-100 p-5 sm:p-6 h-fit lg:sticky lg:top-28">
          <h2 className="text-lg font-bold text-gray-800 mb-4">طلبج ({items.reduce((n, i) => n + i.qty, 0)})</h2>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {items.map((i) => (
              <div key={i.id} className="flex gap-3 items-start">
                <img src={i.image} alt={i.name} className="w-14 h-14 rounded-xl object-cover bg-white shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium line-clamp-2">{i.name}</p>
                  <p className="text-xs text-gray-500 mt-1">{i.qty} × {formatPrice(i.price)}</p>
                </div>
                <p className="text-sm font-bold text-pink-600 shrink-0">{formatPrice(i.price * i.qty)}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
};

// ============== FOOTER ==============
const Footer = () => (
  <footer className="bg-gradient-to-br from-pink-900 via-rose-900 to-pink-950 text-pink-100 mt-16">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
      <h3 className="text-3xl font-extrabold mb-3"><span className="text-pink-300">{SETTINGS.storeName}</span></h3>
      <p className="text-pink-200/80 text-sm max-w-xl mx-auto mb-6">{SETTINGS.footerText}</p>
      <a
        href={`https://wa.me/${WHATSAPP_NUMBER}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 bg-[#25d366] hover:bg-green-600 text-white px-6 py-3 rounded-full font-semibold transition"
      >
        <MessageCircle size={18} /> تواصلي عبر واتساب
      </a>
      <div className="mt-6">
        <Link to="/privacy-policy" className="text-sm text-pink-200 hover:text-white underline underline-offset-4" data-testid="footer-privacy">سياسة الخصوصية</Link>
      </div>
      <div className="border-t border-pink-800/50 mt-8 pt-6 text-sm text-pink-300/70">
        © {new Date().getFullYear()} {SETTINGS.storeName} - جميع الحقوق محفوظة
      </div>
    </div>
  </footer>
);

// ============== MOBILE BOTTOM NAV ==============
const BottomNav = () => {
  const { totalQty, isCartOpen, setIsCartOpen, wishlist } = useCart();
  const { pathname } = useLocation();
  if (pathname.startsWith("/admin")) return null;

  const items = [
    { key: "home", label: "الرئيسية", icon: HomeIcon, to: "/", active: pathname === "/" },
    { key: "categories", label: "الفئات", icon: LayoutGrid, to: "/categories", active: pathname === "/categories" || pathname.startsWith("/collection/category-") },
    { key: "offers", label: "عروضنا", icon: BadgePercent, to: "/collection/offers", active: pathname === "/collection/offers" },
    { key: "cart", label: "السلة", icon: ShoppingBag, onClick: () => setIsCartOpen(true), active: isCartOpen, badge: totalQty },
    { key: "wishlist", label: "المفضلة", icon: Heart, to: "/wishlist", active: pathname === "/wishlist", badge: wishlist.length },
  ];

  return (
    <nav
      className="fixed inset-x-3 sm:inset-x-0 sm:mx-auto sm:max-w-md z-40 bg-white/95 backdrop-blur rounded-3xl border border-pink-100 shadow-[0_8px_30px_rgba(233,30,99,0.15)]"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
      aria-label="التنقل السريع"
      data-testid="bottom-nav"
    >
      <ul className="grid grid-cols-5 px-1 py-2">
        {items.map(({ key, label, icon: Icon, to, onClick, active, badge }) => {
          const inner = (
            <>
              <span className={`relative w-11 h-11 rounded-full flex items-center justify-center transition ${active ? "bg-pink-100 text-[#e91e63]" : "bg-pink-50/70 text-gray-600"}`}>
                <Icon size={21} strokeWidth={active ? 2.4 : 1.9} />
                {badge > 0 && (
                  <span className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#e91e63] text-white text-[10px] font-bold flex items-center justify-center">{badge > 99 ? "99+" : badge}</span>
                )}
              </span>
              <span className={`mt-1 text-[11px] leading-none ${active ? "text-[#e91e63] font-bold" : "text-gray-600 font-medium"}`}>{label}</span>
            </>
          );
          const cls = "w-full flex flex-col items-center justify-center py-1 focus:outline-none";
          return (
            <li key={key}>
              {to ? (
                <Link to={to} className={cls} aria-current={active ? "page" : undefined} data-testid={`bottom-nav-${key}`}>{inner}</Link>
              ) : (
                <button type="button" onClick={onClick} className={cls} data-testid={`bottom-nav-${key}`}>{inner}</button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

// ============== PRIVACY POLICY ==============
const PrivacySection = ({ title, children }) => (
  <section className="mb-7">
    <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-2">{title}</h2>
    <div className="text-gray-700 leading-loose space-y-2">{children}</div>
  </section>
);

const PrivacyPage = () => (
  <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12" data-testid="privacy-page">
    <h1 className="text-2xl sm:text-3xl font-extrabold text-[#e91e63] mb-3">سياسة الخصوصية</h1>
    <p className="text-gray-700 leading-loose mb-8">
      أهلاً بيج في {SETTINGS.storeName}. خصوصيتج تهمنا، وهاي الصفحة توضح بكل بساطة شنو المعلومات اللي نحتاجها منج، وليش نحتاجها، وشلون نحافظ عليها.
    </p>

    <PrivacySection title="١. المعلومات اللي نطلبها منج">
      <p>ما نطلب منج تسوين حساب بالموقع. عند إرسال الطلب نطلب بس اللي نحتاجه حتى نوصلج طلبج:</p>
      <ul className="list-disc pr-6 space-y-1">
        <li>رقم الهاتف</li>
        <li>عنوان التوصيل</li>
        <li>أي ملاحظات تكتبيها على الطلب</li>
        <li>المنتجات اللي اخترتيها وكمياتها</li>
      </ul>
      <p>الدفع يكون نقداً عند الاستلام، لذلك ما نطلب ولا نحفظ أي بيانات بطاقة أو حساب مصرفي.</p>
    </PrivacySection>

    <PrivacySection title="٢. شلون نستخدم معلوماتج">
      <ul className="list-disc pr-6 space-y-1">
        <li>تجهيز طلبج وتوصيله لعنوانج</li>
        <li>التواصل وياج بخصوص الطلب، مثل التأكيد أو موعد التوصيل</li>
        <li>الرد على أسئلتج واستفساراتج</li>
        <li>تحسين الموقع وتجربة التسوق</li>
      </ul>
    </PrivacySection>

    <PrivacySection title="٣. الطلب عبر واتساب">
      <p>
        بعد ما تأكدين الطلب، ينحفظ عدنا بالموقع وينفتح واتساب ويا رسالة فيها تفاصيل الطلب حتى ترسلينها إلنا. الرسائل اللي تتبادلينها ويانا على واتساب تخضع أيضاً لسياسة خصوصية واتساب نفسه.
      </p>
    </PrivacySection>

    <PrivacySection title="٤. مشاركة المعلومات">
      <p>ما نبيع معلوماتج ولا نأجرها لأي جهة. نشاركها بس بالحالات هاي:</p>
      <ul className="list-disc pr-6 space-y-1">
        <li>ويا مندوب أو شركة التوصيل، بالقدر اللازم حتى يوصلج الطلب</li>
        <li>إذا طلبها القانون أو جهة رسمية مختصة</li>
        <li>إذا وافقتي إنتِ على مشاركتها</li>
      </ul>
    </PrivacySection>

    <PrivacySection title="٥. ملفات تعريف الارتباط (الكوكيز) والحفظ بجهازج">
      <p>
        إذا وافقتي على الكوكيز، يحفظ الموقع بجهازج سلتج وبيانات التوصيل والمنتجات اللي شفتيها، حتى تلقينها جاهزة بزيارتج الجاية. وبعد موافقتج نشغّل أدوات إحصاء تساعدنا نفهم شلون ينستخدم الموقع حتى نحسّنه.
      </p>
      <p>
        قائمة المفضلة تنحفظ بجهازج فقط. تگدرين تمسحين هاي البيانات بأي وقت من إعدادات المتصفح.
      </p>
    </PrivacySection>

    <PrivacySection title="٦. حماية المعلومات">
      <p>
        نحتفظ بمعلومات الطلبات بس للمدة اللي نحتاجها لخدمتج، ونستخدم إجراءات معقولة حتى نحميها من الوصول غير المسموح. ومع ذلك، ما في نقل بيانات عبر الإنترنت آمن بنسبة ١٠٠٪.
      </p>
    </PrivacySection>

    <PrivacySection title="٧. حقوقج">
      <p>تگدرين تطلبين منا بأي وقت نعرض لج معلوماتج اللي عدنا، أو نصححها، أو نحذفها.</p>
    </PrivacySection>

    <PrivacySection title="٨. التعديلات على هاي السياسة">
      <p>ممكن نحدّث هاي السياسة من وقت لوقت، وأي تغيير يظهر هنا بهاي الصفحة.</p>
    </PrivacySection>

    <PrivacySection title="٩. تواصلي ويانا">
      <p>إذا عندج أي سؤال عن خصوصيتج، راسلينا على واتساب:</p>
      <a
        href={`https://wa.me/${WHATSAPP_NUMBER}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 bg-[#25d366] hover:bg-green-600 text-white px-6 py-3 rounded-full font-semibold transition mt-2"
      >
        <MessageCircle size={18} /> تواصلي عبر واتساب
      </a>
    </PrivacySection>
  </div>
);

// ============== CATEGORIES PAGE ==============
const CategoriesPage = () => (
  <div className="pb-4">
    <CategoriesSection />
  </div>
);

// ============== COOKIE CONSENT ==============
const CookieConsent = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(COOKIE_KEY) !== "accepted") setVisible(true);
    } catch (e) {
      setVisible(true);
    }
  }, []);

  const accept = () => {
    try { localStorage.setItem(COOKIE_KEY, "accepted"); } catch (e) { /* storage unavailable */ }
    if (typeof window.__loadAnalytics === "function") window.__loadAnalytics();
    window.dispatchEvent(new Event("cookie-consent"));
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-3 sm:inset-x-0 sm:mx-auto sm:max-w-md z-[45]"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)" }}
      role="dialog"
      aria-live="polite"
      aria-label="ملفات تعريف الارتباط"
      data-testid="cookie-consent"
    >
      <div className="bg-white border border-pink-100 shadow-lg rounded-2xl px-3 py-2.5 flex items-center gap-3">
        <p className="flex-1 text-xs text-gray-700 leading-relaxed">
          🍪 نستخدم الكوكيز حتى نحفظ سلتج ونحسّن تجربتج. اضغطي «موافق» للموافقة على الكوكيز و{" "}
          <Link to="/privacy-policy" className="text-pink-600 font-semibold underline underline-offset-2" data-testid="cookie-privacy-link">سياسة الخصوصية</Link>
        </p>
        <button onClick={accept} className="shrink-0 bg-pink-600 hover:bg-pink-700 text-white text-sm font-bold px-5 py-2 rounded-full transition" data-testid="cookie-accept">موافق</button>
      </div>
    </div>
  );
};

// ============== APP ==============
// The admin panel opens only on its own address (admin.balyiq.site, or a build with
// REACT_APP_ADMIN=1); the public store has no admin page. The server checks the password.
const IS_ADMIN_BUILD = process.env.REACT_APP_ADMIN === "1" ||
  (typeof window !== "undefined" && /^admin\./i.test(window.location.hostname));

const AdminApp = () => {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    document.title = "لوحة الأدمن | صيدلية أيمن";
  }, []);
  return (
    <div dir="rtl" className="min-h-screen bg-white" style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}>
      <AdminBoundary><Suspense fallback={<div className="py-20 text-center text-gray-500">جاري التحميل...</div>}><Admin /></Suspense></AdminBoundary>
    </div>
  );
};

function App() {
  if (IS_ADMIN_BUILD) return <HashRouter><AdminApp /></HashRouter>;
  return (
    <CartProvider>
      <HashRouter>
        <div dir="rtl" className="min-h-screen flex flex-col bg-white" style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}>
          <Header />
          <main className="flex-1 pb-28">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/collection/:slug" element={<Collection />} />
              <Route path="/product/:id" element={<ProductDetail />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/categories" element={<CategoriesPage />} />
              <Route path="/privacy-policy" element={<PrivacyPage />} />
              <Route path="/wishlist" element={<WishlistPage />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="*" element={<Home />} />
            </Routes>
          </main>
          <Footer />
          <CartDrawer />
          <BottomNav />
          <CookieConsent />
        </div>
      </HashRouter>
    </CartProvider>
  );
}

export default App;
