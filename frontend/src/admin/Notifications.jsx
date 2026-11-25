import React, { useCallback, useEffect, useState } from "react";
import { Bell, MessageCircle, Smartphone, Trash2 } from "lucide-react";
import { apiRequest } from "../ordersApi";

const inputCls = "w-full border-2 border-pink-100 focus:border-pink-400 outline-none rounded-xl px-3 py-2.5 bg-white";
const btnPrimary = "bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white font-bold px-5 py-2.5 rounded-full transition";
const btnGhost = "border border-gray-300 hover:border-gray-400 disabled:opacity-50 text-gray-700 font-semibold px-4 py-2 rounded-full transition";
const CALLMEBOT_URL = "https://www.callmebot.com/blog/free-api-whatsapp-messages/";

const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;

const urlBase64ToUint8Array = (base64) => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

const deviceLabel = () => {
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? "Android" : /iphone|ipad/i.test(ua) ? "iPhone" : /windows/i.test(ua) ? "Windows" : /mac/i.test(ua) ? "Mac" : "جهاز";
  const browser = /edg\//i.test(ua) ? "Edge" : /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "";
  return `${os} ${browser}`.trim();
};

export const registerServiceWorker = () =>
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).then(() => navigator.serviceWorker.ready);

export const NotificationsSettings = ({ token }) => {
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [thisEndpoint, setThisEndpoint] = useState("");
  const [pushMsg, setPushMsg] = useState(null);
  const [busy, setBusy] = useState("");
  const [wa, setWa] = useState({ enabled: false, phone: "", apikey: "" });
  const [waMsg, setWaMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const s = await apiRequest("/api/settings", { token });
      setSettings(s);
      setWa({ enabled: s.whatsapp.enabled, phone: s.whatsapp.phone, apikey: "" });
      setLoadError("");
    } catch (e) {
      setLoadError(e.message);
    }
  }, [token]);

  useEffect(() => {
    load();
    if (pushSupported()) {
      navigator.serviceWorker.getRegistration().then((reg) => reg && reg.pushManager.getSubscription()).then((sub) => setThisEndpoint(sub ? sub.endpoint : "")).catch(() => {});
    }
  }, [load]);

  const thisDeviceOn = !!thisEndpoint && !!settings && settings.pushDevices.some((d) => d.endpoint === thisEndpoint);

  const enablePush = async () => {
    setPushMsg(null);
    if (!pushSupported()) {
      setPushMsg({ ok: false, text: isIos() && !isStandalone() ? "على الآيفون: افتح الموقع بـ Safari ← زر المشاركة ← «إضافة إلى الشاشة الرئيسية»، وبعدها افتح اللوحة من الأيقونة وفعّل الإشعارات." : "هذا المتصفح ما يدعم الإشعارات. جرّب Chrome." });
      return;
    }
    setBusy("push");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("ما انطت صلاحية الإشعارات. فعّلها من إعدادات المتصفح للموقع وحاول مرة ثانية.");
      const { publicKey } = await apiRequest("/api/push");
      if (!publicKey) throw new Error("الإشعارات غير مفعلة بالسيرفر.");
      const reg = await registerServiceWorker();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await apiRequest("/api/push", { method: "POST", token, body: { subscription: sub.toJSON(), label: deviceLabel() } });
      setThisEndpoint(sub.endpoint);
      await load();
      setPushMsg({ ok: true, text: "تم ✅ راح يوصلك إشعار على هذا الجهاز مع كل طلب جديد، حتى لو اللوحة مسكّرة." });
    } catch (e) {
      setPushMsg({ ok: false, text: e.message || "صار خطأ أثناء تفعيل الإشعارات." });
    } finally {
      setBusy("");
    }
  };

  const testPush = async () => {
    setBusy("test");
    setPushMsg(null);
    try {
      const r = await apiRequest("/api/push?test=1", { method: "POST", token });
      setPushMsg(r.sent ? { ok: true, text: `انرسل إشعار تجربة إلى ${r.sent} جهاز.` } : { ok: false, text: "ما في أجهزة مفعّلة." });
    } catch (e) {
      setPushMsg({ ok: false, text: e.message });
    } finally {
      setBusy("");
    }
  };

  const removeDevice = async (endpoint) => {
    setBusy(endpoint);
    try {
      await apiRequest("/api/push", { method: "DELETE", token, body: { endpoint } });
      if (endpoint === thisEndpoint) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && (await reg.pushManager.getSubscription());
        if (sub) await sub.unsubscribe();
        setThisEndpoint("");
      }
      await load();
    } catch (e) {
      setPushMsg({ ok: false, text: e.message });
    } finally {
      setBusy("");
    }
  };

  const saveWhatsApp = async (e) => {
    e.preventDefault();
    setBusy("wa");
    setWaMsg(null);
    try {
      const s = await apiRequest("/api/settings", { method: "PUT", token, body: { whatsapp: wa } });
      setSettings(s);
      setWa({ enabled: s.whatsapp.enabled, phone: s.whatsapp.phone, apikey: "" });
      setWaMsg({ ok: true, text: "انحفظ ✅" });
    } catch (err) {
      setWaMsg({ ok: false, text: err.message });
    } finally {
      setBusy("");
    }
  };

  const testWhatsApp = async () => {
    setBusy("watest");
    setWaMsg(null);
    try {
      await apiRequest("/api/settings?test=1", { method: "POST", token, timeoutMs: 20000 });
      setWaMsg({ ok: true, text: "انرسلت رسالة تجربة على واتسابك ✅" });
    } catch (err) {
      setWaMsg({ ok: false, text: err.message });
    } finally {
      setBusy("");
    }
  };

  const msg = (m, id) => m && <p className={`text-sm ${m.ok ? "text-green-600" : "text-red-600"}`} data-testid={id}>{m.text}</p>;

  if (loadError) return <p className="text-red-600 text-sm" data-testid="admin-notify-error">{loadError}</p>;
  if (!settings) return <p className="text-gray-500 text-sm">جاري التحميل...</p>;

  return (
    <div className="space-y-6" data-testid="admin-notifications">
      <section className="space-y-3">
        <h3 className="font-bold text-gray-900 flex items-center gap-2"><Bell size={18} className="text-pink-600" /> إشعارات الطلبات على الجهاز</h3>
        <p className="text-sm text-gray-600 leading-relaxed">فعّلها على موبايلك أو حاسبتك حتى يوصلك إشعار مع صوت أول ما يجي طلب جديد، حتى لو اللوحة مسكّرة.</p>
        <div className="flex flex-wrap gap-2">
          {thisDeviceOn ? (
            <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 font-bold px-4 py-2 rounded-full text-sm" data-testid="admin-push-on">✓ مفعّلة على هذا الجهاز</span>
          ) : (
            <button type="button" onClick={enablePush} disabled={busy === "push"} className={`${btnPrimary} inline-flex items-center gap-2`} data-testid="admin-push-enable"><Bell size={18} /> {busy === "push" ? "جاري التفعيل..." : "تفعيل الإشعارات على هذا الجهاز"}</button>
          )}
          {settings.pushDevices.length > 0 && <button type="button" onClick={testPush} disabled={busy === "test"} className={btnGhost} data-testid="admin-push-test">إرسال إشعار تجربة</button>}
        </div>
        {msg(pushMsg, "admin-push-msg")}
        {isIos() && !isStandalone() && <p className="text-xs text-amber-600">على الآيفون لازم تضيف الموقع للشاشة الرئيسية أولاً (Safari ← مشاركة ← إضافة إلى الشاشة الرئيسية) وتفتح اللوحة من الأيقونة.</p>}
        {settings.pushDevices.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">الأجهزة المفعّلة:</p>
            {settings.pushDevices.map((d) => (
              <div key={d.endpoint} className="flex items-center gap-2 bg-pink-50/50 rounded-xl px-3 py-2 text-sm">
                <Smartphone size={16} className="text-gray-500" />
                <span className="flex-1">{d.label || "جهاز"}{d.endpoint === thisEndpoint ? " (هذا الجهاز)" : ""}</span>
                <button type="button" onClick={() => removeDevice(d.endpoint)} disabled={busy === d.endpoint} className="text-gray-400 hover:text-red-500" aria-label="إيقاف" data-testid="admin-push-remove"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-pink-100 pt-5 space-y-3">
        <h3 className="font-bold text-gray-900 flex items-center gap-2"><MessageCircle size={18} className="text-[#25d366]" /> إشعار على واتسابك</h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          تفاصيل كل طلب جديد توصلك رسالة على واتسابك عن طريق خدمة CallMeBot المجانية. تحتاج مفتاح منهم مرة وحدة:
          تبعث لرقمهم رسالة التفعيل المكتوبة <a href={CALLMEBOT_URL} target="_blank" rel="noopener noreferrer" className="text-pink-600 underline">بصفحتهم</a>، ويردّون عليك بالمفتاح.
        </p>
        <form onSubmit={saveWhatsApp} className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <input type="checkbox" checked={wa.enabled} onChange={(e) => setWa({ ...wa, enabled: e.target.checked })} data-testid="admin-wa-enabled" /> تفعيل إشعار الواتساب
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">رقم واتسابك (دولي)</label>
              <input value={wa.phone} onChange={(e) => setWa({ ...wa, phone: e.target.value })} placeholder="+9647701234567" dir="ltr" className={inputCls} data-testid="admin-wa-phone" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">مفتاح CallMeBot</label>
              <input type="password" value={wa.apikey} onChange={(e) => setWa({ ...wa, apikey: e.target.value })} placeholder={settings.whatsapp.hasApiKey ? "محفوظ — اتركه فارغ حتى ما يتغير" : "123456"} dir="ltr" autoComplete="off" className={inputCls} data-testid="admin-wa-key" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy === "wa"} className={btnPrimary} data-testid="admin-wa-save">{busy === "wa" ? "..." : "حفظ"}</button>
            {settings.whatsapp.enabled && settings.whatsapp.hasApiKey && <button type="button" onClick={testWhatsApp} disabled={busy === "watest"} className={btnGhost} data-testid="admin-wa-test">{busy === "watest" ? "جاري الإرسال..." : "إرسال رسالة تجربة"}</button>}
          </div>
          {msg(waMsg, "admin-wa-msg")}
        </form>
      </section>
    </div>
  );
};
