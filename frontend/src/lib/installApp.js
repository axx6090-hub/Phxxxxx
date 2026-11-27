// Home-screen install: registers the service worker and keeps the browser's install
// prompt (Android Chrome, Edge, desktop Chrome) so the «ثبّتي على أندرويد» button can open it.
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export const isStandalone = () =>
  typeof window !== "undefined" &&
  ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true);

export const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export const canPromptInstall = () => !!deferredPrompt;

export const subscribeInstall = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Opens the browser's own install window. Resolves to "accepted", "dismissed" or "unavailable".
export const promptInstall = async () => {
  if (!deferredPrompt) return "unavailable";
  const e = deferredPrompt;
  deferredPrompt = null;
  notify();
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    return outcome;
  } catch (err) {
    return "unavailable";
  }
};

export const setupInstall = () => {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it for our button instead of the browser's mini bar
    deferredPrompt = e;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    try { localStorage.setItem("app_installed", "1"); } catch (err) { /* ignore */ }
    notify();
  });
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
    });
  }
};
