import React, { useCallback, useEffect, useRef, useState } from "react";
import { Phone, MessageCircle, Trash2, RefreshCw, ChevronDown } from "lucide-react";
import { apiRequest } from "../ordersApi";

export const ORDER_STATUSES = [
  { id: "new", label: "جديد", cls: "bg-pink-600 text-white" },
  { id: "confirmed", label: "مؤكد", cls: "bg-blue-100 text-blue-700" },
  { id: "shipped", label: "تم الشحن", cls: "bg-amber-100 text-amber-700" },
  { id: "delivered", label: "تم التسليم", cls: "bg-green-100 text-green-700" },
  { id: "cancelled", label: "ملغي", cls: "bg-gray-200 text-gray-600" },
];
const statusOf = (id) => ORDER_STATUSES.find((s) => s.id === id) || ORDER_STATUSES[0];
const formatPrice = (n) => Number(n || 0).toLocaleString("en-US") + " د.ع";
const formatDate = (iso) => {
  try {
    return new Date(iso).toLocaleString("ar-IQ", { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" });
  } catch (e) {
    return iso;
  }
};
const toWhatsApp = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.startsWith("0") ? `964${digits.slice(1)}` : digits;
};

const SEEN_KEY = "admin_orders_seen";
const readSeen = () => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch (e) { return new Set(); }
};
const writeSeen = (set) => {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-500))); } catch (e) { /* ignore */ }
};

// short "ding" made with Web Audio so no sound file is needed
const playDing = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch (e) { /* ignore */ }
};

const showLocalNotification = async (order) => {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const title = `🛍️ طلب جديد #${order.id}`;
  const body = `${order.customer.name || "زبون"} · ${formatPrice(order.total)} · ${order.customer.city || ""}`;
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) return reg.showNotification(title, { body, tag: `order-${order.id}`, icon: "./icon-192.png", data: { url: window.location.href } });
    // eslint-disable-next-line no-new
    new Notification(title, { body, tag: `order-${order.id}` });
  } catch (e) { /* ignore */ }
};

/**
 * Loads orders every 30 seconds while the admin panel is open and alerts on new ones.
 * Lives in the panel (not the tab) so alerts work whichever tab is open.
 */
export const useOrders = (token) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [seen, setSeen] = useState(readSeen);
  const known = useRef(null); // ids already loaded in this session

  const refresh = useCallback(async () => {
    try {
      const data = await apiRequest("/api/orders?limit=200", { token });
      const list = data.orders || [];
      if (known.current) {
        const fresh = list.filter((o) => !known.current.has(o.id));
        if (fresh.length) {
          playDing();
          if (document.hidden) fresh.slice(0, 3).forEach(showLocalNotification);
        }
      } else if (seen.size === 0 && list.length) {
        // first time on this device: don't flag old orders as new
        const all = new Set(list.map((o) => o.id));
        setSeen(all);
        writeSeen(all);
      }
      known.current = new Set(list.map((o) => o.id));
      setOrders(list);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, seen.size]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  const markSeen = useCallback((ids) => {
    setSeen((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      writeSeen(next);
      return next;
    });
  }, []);

  const unseen = orders.filter((o) => !seen.has(o.id) && o.status === "new").length;
  return { orders, setOrders, loading, error, refresh, seen, markSeen, unseen };
};

const OrderCard = ({ order, isNew, token, onChange, onDelete }) => {
  const [open, setOpen] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const st = statusOf(order.status);

  const setStatus = async (status) => {
    setBusy(true);
    setErr("");
    try {
      const res = await apiRequest("/api/orders", { method: "PATCH", token, body: { key: order.key, status } });
      onChange(res.order);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`حذف الطلب #${order.id} نهائياً؟`)) return;
    setBusy(true);
    try {
      await apiRequest(`/api/orders?key=${encodeURIComponent(order.key)}`, { method: "DELETE", token });
      onDelete(order);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <div className={`bg-white border rounded-2xl overflow-hidden ${isNew ? "border-pink-400 shadow-md" : "border-pink-100"}`} data-testid={`admin-order-${order.id}`}>
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 p-3 text-right">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-gray-900" dir="ltr">#{order.id}</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
            {isNew && <span className="text-xs font-bold text-pink-600">● جديد</span>}
          </div>
          <p className="text-xs text-gray-500 mt-1 truncate">{order.customer.name || "بدون اسم"} · {order.customer.city || "—"} · {formatDate(order.createdAt)}</p>
        </div>
        <span className="font-bold text-pink-600 shrink-0">{formatPrice(order.total)}</span>
        <ChevronDown size={18} className={`text-gray-400 shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-pink-100 p-4 space-y-4 text-sm">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <p><span className="text-gray-500">الاسم: </span>{order.customer.name || "—"}</p>
              <p><span className="text-gray-500">الهاتف: </span><span dir="ltr">{order.customer.phone || "—"}</span></p>
              <p><span className="text-gray-500">العنوان: </span>{[order.customer.city, order.customer.address].filter(Boolean).join(" - ") || "—"}</p>
              {order.customer.notes && <p className="whitespace-pre-line"><span className="text-gray-500">ملاحظات: </span>{order.customer.notes}</p>}
            </div>
            <div className="space-y-1">
              {order.items.map((i) => (
                <div key={i.id} className="flex justify-between gap-2">
                  <span className="text-gray-700">{i.name} <span className="text-gray-400">× {i.qty}</span></span>
                  <span className="shrink-0">{formatPrice(i.price * i.qty)}</span>
                </div>
              ))}
              <div className="flex justify-between text-gray-500 border-t border-pink-100 pt-1"><span>التوصيل</span><span>{order.deliveryFee ? formatPrice(order.deliveryFee) : "مجاني"}</span></div>
              <div className="flex justify-between font-bold"><span>المجموع</span><span className="text-pink-600">{formatPrice(order.total)}</span></div>
              {order.pricesVerified === false && <p className="text-xs text-amber-600">⚠️ بعض المنتجات ما كانت بالكتالوج وقت الطلب، راجع الأسعار.</p>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {order.customer.phone && (
              <>
                <a href={`tel:${order.customer.phone}`} className="inline-flex items-center gap-1.5 border border-gray-300 rounded-full px-3 py-1.5 font-semibold text-gray-700"><Phone size={15} /> اتصال</a>
                <a href={`https://wa.me/${toWhatsApp(order.customer.phone)}?text=${encodeURIComponent(`هلا ${order.customer.name || ""} 🌸 بخصوص طلبج رقم ${order.id} من متجر صيدلية أيمن`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 bg-[#25d366] text-white rounded-full px-3 py-1.5 font-semibold"><MessageCircle size={15} /> واتساب الزبون</a>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-500">الحالة:</span>
            {ORDER_STATUSES.map((s) => (
              <button key={s.id} type="button" disabled={busy || s.id === order.status} onClick={() => setStatus(s.id)}
                className={`text-xs font-bold px-3 py-1.5 rounded-full border transition ${s.id === order.status ? `${s.cls} border-transparent` : "border-gray-300 text-gray-600 hover:border-gray-500"} disabled:cursor-default`}
                data-testid={`admin-order-status-${order.id}-${s.id}`}>
                {s.label}
              </button>
            ))}
            <button type="button" onClick={remove} disabled={busy} className="mr-auto text-gray-400 hover:text-red-500" aria-label="حذف الطلب" data-testid={`admin-order-delete-${order.id}`}><Trash2 size={18} /></button>
          </div>
          {err && <p className="text-red-600 text-xs">{err}</p>}
        </div>
      )}
    </div>
  );
};

export const OrdersTab = ({ token, state }) => {
  const { orders, setOrders, loading, error, refresh, seen, markSeen } = state;
  const [filter, setFilter] = useState("open");
  const [refreshing, setRefreshing] = useState(false);
  const newIds = useRef(new Set());

  // remember which orders were unseen when the tab opened, then mark them as seen
  useEffect(() => {
    const unseenIds = orders.filter((o) => !seen.has(o.id)).map((o) => o.id);
    if (unseenIds.length) {
      unseenIds.forEach((id) => newIds.current.add(id));
      markSeen(unseenIds);
    }
  }, [orders, seen, markSeen]);

  const doRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const counts = orders.reduce((m, o) => ({ ...m, [o.status]: (m[o.status] || 0) + 1 }), {});
  const visible = orders.filter((o) => (filter === "all" ? true : filter === "open" ? ["new", "confirmed", "shipped"].includes(o.status) : o.status === filter));
  const today = new Date().toDateString();
  const todayOrders = orders.filter((o) => new Date(o.createdAt).toDateString() === today && o.status !== "cancelled");
  const todayTotal = todayOrders.reduce((s, o) => s + (o.total || 0), 0);

  return (
    <div data-testid="admin-orders">
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-pink-50 rounded-2xl p-3 text-center"><p className="text-2xl font-extrabold text-pink-600">{counts.new || 0}</p><p className="text-xs text-gray-600">طلبات جديدة</p></div>
        <div className="bg-pink-50 rounded-2xl p-3 text-center"><p className="text-2xl font-extrabold text-gray-900">{todayOrders.length}</p><p className="text-xs text-gray-600">طلبات اليوم</p></div>
        <div className="bg-pink-50 rounded-2xl p-3 text-center"><p className="text-lg sm:text-2xl font-extrabold text-gray-900">{todayTotal.toLocaleString("en-US")}</p><p className="text-xs text-gray-600">مبيعات اليوم (د.ع)</p></div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-3">
        {[["open", "المفتوحة"], ...ORDER_STATUSES.map((s) => [s.id, s.label]), ["all", "الكل"]].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} className={`whitespace-nowrap text-xs font-bold px-3 py-1.5 rounded-full transition ${filter === id ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600"}`} data-testid={`admin-orders-filter-${id}`}>
            {label}{id !== "open" && id !== "all" && counts[id] ? ` (${counts[id]})` : ""}
          </button>
        ))}
        <button type="button" onClick={doRefresh} className="mr-auto shrink-0 text-gray-500 hover:text-gray-900" aria-label="تحديث" data-testid="admin-orders-refresh"><RefreshCw size={18} className={refreshing ? "animate-spin" : ""} /></button>
      </div>

      {error && <p className="text-red-600 text-sm mb-3" data-testid="admin-orders-error">{error}</p>}
      {loading ? (
        <p className="text-center text-gray-500 py-10">جاري تحميل الطلبات...</p>
      ) : visible.length === 0 ? (
        <p className="text-center text-gray-500 py-10">{orders.length ? "لا توجد طلبات بهذه الحالة." : "ما في طلبات بعد. أول ما يطلب زبون راح يظهر هنا ويوصلك إشعار."}</p>
      ) : (
        <div className="space-y-2">
          {visible.map((o) => (
            <OrderCard key={o.key} order={o} token={token} isNew={newIds.current.has(o.id) && o.status === "new"}
              onChange={(updated) => setOrders((list) => list.map((x) => (x.key === updated.key ? updated : x)))}
              onDelete={(gone) => setOrders((list) => list.filter((x) => x.key !== gone.key))} />
          ))}
        </div>
      )}
      <p className="text-xs text-gray-400 mt-4 text-center">القائمة تتحدّث تلقائياً كل 30 ثانية وتطلع نغمة عند وصول طلب جديد.</p>
    </div>
  );
};
