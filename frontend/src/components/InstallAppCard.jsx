import React, { useEffect, useState } from "react";
import { X, Share, MoreVertical, PlusSquare, Smartphone, CheckCircle2 } from "lucide-react";
import { SETTINGS } from "../siteSettings";
import { canPromptInstall, isIOS, isStandalone, promptInstall, subscribeInstall } from "../lib/installApp";

const ICON = "./icon-192.png"; // the store uses hash routes, so the page is always at the site root

const AndroidMark = ({ size = 30 }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
    <path d="M9 13.5a7 7 0 0 1 14 0z" fill="#3ddc84" />
    <rect x="9" y="14.5" width="14" height="10" rx="2" fill="#3ddc84" />
    <rect x="5.6" y="14.5" width="2.4" height="7" rx="1.2" fill="#3ddc84" />
    <rect x="24" y="14.5" width="2.4" height="7" rx="1.2" fill="#3ddc84" />
    <rect x="11.6" y="23" width="2.4" height="5" rx="1.2" fill="#3ddc84" />
    <rect x="18" y="23" width="2.4" height="5" rx="1.2" fill="#3ddc84" />
    <path d="M11.2 6.3l1.6 2.6M20.8 6.3l-1.6 2.6" stroke="#3ddc84" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="13.2" cy="11.3" r="0.9" fill="#111827" />
    <circle cx="18.8" cy="11.3" r="0.9" fill="#111827" />
  </svg>
);

const IPhoneMark = ({ size = 30 }) => (
  <span
    className="inline-flex items-center justify-center rounded-xl"
    style={{ width: size, height: size, background: "linear-gradient(160deg,#5ac8fa,#0a84ff)" }}
    aria-hidden="true"
  >
    <Smartphone size={size * 0.6} color="#fff" strokeWidth={2.2} />
  </span>
);

const StoreButton = ({ onClick, mark, small, big, testId }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className="flex-1 min-w-0 flex items-center gap-3 bg-gray-900 hover:bg-black active:scale-[0.98] text-white rounded-2xl px-4 py-3 border border-gray-800 shadow-md transition"
  >
    {mark}
    <span className="flex flex-col items-start leading-tight text-right min-w-0">
      <span className="text-[11px] text-gray-300">{small}</span>
      <span className="text-lg font-bold truncate">{big}</span>
    </span>
  </button>
);

const Step = ({ n, children }) => (
  <li className="flex items-start gap-3">
    <span className="shrink-0 w-7 h-7 rounded-full bg-pink-100 text-[#e91e63] font-bold text-sm flex items-center justify-center">{n}</span>
    <span className="pt-0.5 text-gray-700 leading-relaxed">{children}</span>
  </li>
);

const Kbd = ({ children }) => (
  <span className="inline-flex items-center gap-1 align-middle bg-gray-100 border border-gray-200 rounded-lg px-1.5 py-0.5 mx-0.5 text-gray-800 text-sm font-semibold">
    {children}
  </span>
);

const InstallSteps = ({ kind, onClose }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const host = typeof window !== "undefined" ? window.location.host : "";
  const ios = kind === "ios";
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-labelledby="install-title" data-testid="install-steps">
      <button type="button" aria-label="إغلاق" className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-pink-100 p-6" style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <button type="button" onClick={onClose} aria-label="إغلاق" className="absolute top-4 left-4 w-9 h-9 rounded-full bg-pink-50 text-gray-600 hover:text-[#e91e63] flex items-center justify-center" data-testid="install-steps-close">
          <X size={18} />
        </button>
        <div className="flex items-center gap-3 mb-3 pl-10">
          <img src={ICON} alt="" width="48" height="48" className="w-12 h-12 rounded-2xl shadow" />
          <h3 id="install-title" className="text-xl font-extrabold text-gray-900">
            {SETTINGS.storeName} على {ios ? "الآيفون" : "الأندرويد"}
          </h3>
        </div>
        <p className="text-gray-500 text-sm leading-relaxed mb-5">
          تنحط أيقونة {SETTINGS.storeName} على الشاشة الرئيسية وتنفتح مثل التطبيق، بكامل الشاشة، وبدون تحميل من المتجر.
        </p>
        <ol className="space-y-3.5">
          {ios ? (
            <>
              <Step n="1">افتحي <b dir="ltr">{host}</b> بمتصفح <b>Safari</b> على الآيفون.</Step>
              <Step n="2">اضغطي زر المشاركة <Kbd><Share size={15} /></Kbd> بأسفل الشاشة.</Step>
              <Step n="3">اختاري <Kbd><PlusSquare size={15} /> إضافة إلى الشاشة الرئيسية</Kbd> وبعدها اضغطي <b>«إضافة»</b>.</Step>
            </>
          ) : (
            <>
              <Step n="1">افتحي <b dir="ltr">{host}</b> بمتصفح <b>Chrome</b> على موبايلك.</Step>
              <Step n="2">اضغطي زر القائمة <Kbd><MoreVertical size={15} /></Kbd> بالأعلى.</Step>
              <Step n="3">اختاري <b>«تثبيت التطبيق»</b> أو <b>«إضافة إلى الشاشة الرئيسية»</b>.</Step>
            </>
          )}
        </ol>
        <button type="button" onClick={onClose} className="mt-6 w-full bg-[#e91e63] hover:bg-pink-600 text-white rounded-full py-3 font-bold transition">
          تمام
        </button>
      </div>
    </div>
  );
};

// «صيدلية أيمن على موبايلك»: two buttons that put the store on the home screen like an app.
// Android opens the browser's own install window when it can, otherwise shows the steps.
const InstallAppCard = () => {
  const [installed, setInstalled] = useState(() => isStandalone());
  const [canPrompt, setCanPrompt] = useState(() => canPromptInstall());
  const [open, setOpen] = useState(null); // "android" | "ios" | null
  const [done, setDone] = useState(false);

  useEffect(() => subscribeInstall(() => {
    setCanPrompt(canPromptInstall());
    try { if (localStorage.getItem("app_installed") === "1") setDone(true); } catch (e) { /* ignore */ }
  }), []);

  useEffect(() => {
    const mq = window.matchMedia && window.matchMedia("(display-mode: standalone)");
    if (!mq) return undefined;
    const fn = () => setInstalled(isStandalone());
    mq.addEventListener ? mq.addEventListener("change", fn) : mq.addListener(fn);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", fn) : mq.removeListener(fn));
  }, []);

  if (installed) return null; // already opened as the app

  const onAndroid = async () => {
    if (canPrompt) {
      const r = await promptInstall();
      if (r === "accepted") { setDone(true); return; }
      if (r === "dismissed") return;
    }
    setOpen("android");
  };
  const onIPhone = () => setOpen("ios");
  const iosFirst = isIOS();

  const android = <StoreButton key="a" onClick={onAndroid} mark={<AndroidMark />} small="ثبّتيه على" big="أندرويد" testId="install-android" />;
  const iphone = <StoreButton key="i" onClick={onIPhone} mark={<IPhoneMark />} small="ثبّتيه على" big="آيفون" testId="install-iphone" />;

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-14" data-testid="install-app">
      <div className="relative overflow-hidden rounded-[28px] border border-pink-200 bg-gradient-to-br from-pink-50 via-white to-rose-100 shadow-[0_10px_40px_rgba(233,30,99,0.12)] p-5 sm:p-8">
        <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-pink-200/40 blur-2xl" aria-hidden="true" />
        <div className="relative flex items-center gap-4 mb-5">
          <img src={ICON} alt={SETTINGS.storeName} width="72" height="72" className="w-16 h-16 sm:w-20 sm:h-20 rounded-[22px] shadow-lg shrink-0" />
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900">{SETTINGS.storeName} على موبايلك</h2>
            <p className="text-gray-600 text-sm sm:text-base mt-1 leading-relaxed">
              ثبّتيها بثواني وافتحيها مثل التطبيق من الشاشة الرئيسية 💕
            </p>
          </div>
        </div>
        {done ? (
          <div className="relative flex items-center gap-2 bg-white/80 border border-green-200 text-green-700 rounded-2xl px-4 py-3 font-semibold">
            <CheckCircle2 size={20} /> تمت إضافة {SETTINGS.storeName} للشاشة الرئيسية
          </div>
        ) : (
          <div className="relative flex gap-3">{iosFirst ? [iphone, android] : [android, iphone]}</div>
        )}
      </div>
      {open && <InstallSteps kind={open} onClose={() => setOpen(null)} />}
    </section>
  );
};

export default InstallAppCard;
