import React, { useEffect, useState } from "react";
import { X, Share, MoreVertical, PlusSquare, Download } from "lucide-react";
import { canPromptInstall, isStandalone, promptInstall, subscribeInstall } from "../lib/installApp";

// The admin panel installs as its own app, «الأدمن» with a green icon, apart from the store app.
// Its manifest lives only under the private address, so the page points the browser at it here.
const setHead = (selector, make, attr, value) => {
  let el = document.head.querySelector(selector);
  if (!el) { el = make(); document.head.appendChild(el); }
  el.setAttribute(attr, value);
};
const link = (rel, extra = {}) => () => {
  const el = document.createElement("link");
  el.rel = rel;
  Object.entries(extra).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
};
const meta = (name) => () => { const el = document.createElement("meta"); el.name = name; return el; };

export const useAdminAppHead = () => {
  useEffect(() => {
    if (!/^admin\./i.test(window.location.hostname)) return;
    const base = window.location.pathname.replace(/\/+$/, "");
    if (!base) return;
    setHead('link[rel="manifest"]', link("manifest"), "href", `${base}/manifest.webmanifest`);
    setHead('link[rel="apple-touch-icon"]', link("apple-touch-icon"), "href", "/admin-apple-touch-icon.png");
    document.head.querySelectorAll('link[rel="icon"]').forEach((el) => el.remove());
    setHead('link[rel="icon"]', link("icon", { type: "image/png", sizes: "32x32" }), "href", "/admin-favicon-32.png");
    setHead('meta[name="apple-mobile-web-app-title"]', meta("apple-mobile-web-app-title"), "content", "الأدمن");
    setHead('meta[name="application-name"]', meta("application-name"), "content", "الأدمن");
    setHead('meta[name="theme-color"]', meta("theme-color"), "content", "#16a34a");
  }, []);
};

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const Kbd = ({ children }) => (
  <span className="inline-flex items-center gap-1 align-middle bg-gray-100 border border-gray-200 rounded-lg px-1.5 py-0.5 mx-0.5 text-gray-800 text-sm font-semibold">{children}</span>
);

const Steps = ({ onClose }) => {
  const ios = isIOS();
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-labelledby="admin-install-title">
      <button type="button" aria-label="إغلاق" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-green-100 p-6">
        <button type="button" onClick={onClose} aria-label="إغلاق" className="absolute top-4 left-4 w-9 h-9 rounded-full bg-green-50 text-gray-600 flex items-center justify-center"><X size={18} /></button>
        <div className="flex items-center gap-3 mb-3 pl-10">
          <img src="/admin-icon-192.png" alt="" width="48" height="48" className="w-12 h-12 rounded-2xl shadow" />
          <h3 id="admin-install-title" className="text-xl font-extrabold text-gray-900">تطبيق الأدمن</h3>
        </div>
        <p className="text-gray-500 text-sm leading-relaxed mb-5">تنحط أيقونة خضراء باسم «الأدمن» على الشاشة الرئيسية، منفصلة عن تطبيق المتجر، وتفتح اللوحة مباشرة.</p>
        <ol className="space-y-3.5 list-decimal pr-5 text-gray-700 leading-relaxed">
          {ios ? (
            <>
              <li>افتح رابط لوحة الأدمن الخاص بمتصفح <b>Safari</b>.</li>
              <li>اضغط زر المشاركة <Kbd><Share size={15} /></Kbd> بأسفل الشاشة.</li>
              <li>اختار <Kbd><PlusSquare size={15} /> إضافة إلى الشاشة الرئيسية</Kbd> وبعدها <b>«إضافة»</b>.</li>
            </>
          ) : (
            <>
              <li>افتح رابط لوحة الأدمن الخاص بمتصفح <b>Chrome</b>.</li>
              <li>اضغط زر القائمة <Kbd><MoreVertical size={15} /></Kbd> بالأعلى.</li>
              <li>اختار <b>«تثبيت التطبيق»</b> أو <b>«إضافة إلى الشاشة الرئيسية»</b>.</li>
            </>
          )}
        </ol>
        <button type="button" onClick={onClose} className="mt-6 w-full bg-green-600 hover:bg-green-700 text-white rounded-full py-3 font-bold transition">تمام</button>
      </div>
    </div>
  );
};

// Small «ثبّت تطبيق الأدمن» button for the panel header; hidden when already opened as the app.
export const InstallAdminButton = ({ className = "" }) => {
  const [installed] = useState(() => isStandalone());
  const [canPrompt, setCanPrompt] = useState(() => canPromptInstall());
  const [open, setOpen] = useState(false);
  useEffect(() => subscribeInstall(() => setCanPrompt(canPromptInstall())), []);
  if (installed) return null;
  const onClick = async () => {
    if (canPrompt) {
      const r = await promptInstall();
      if (r === "accepted" || r === "dismissed") return;
    }
    setOpen(true);
  };
  return (
    <>
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded-full transition ${className}`} data-testid="admin-install">
        <Download size={16} /> ثبّت تطبيق الأدمن
      </button>
      {open && <Steps onClose={() => setOpen(false)} />}
    </>
  );
};
