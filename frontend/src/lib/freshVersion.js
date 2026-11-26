// Keeps open tabs on the newest store: when a new version is published, a tab that was
// opened before it reloads itself (the cart is kept), so nobody keeps an old checkout.
const BUILD = process.env.REACT_APP_BUILD || "";
let lastCheck = 0;

export const checkForNewVersion = async (force = false) => {
  if (!BUILD || typeof window === "undefined") return false;
  if (!force && Date.now() - lastCheck < 20000) return false;
  lastCheck = Date.now();
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return false;
    const { v } = await res.json();
    if (!v || v === BUILD) return false;
    let already = "";
    try { already = sessionStorage.getItem("store-reloaded-for") || ""; } catch (e) { /* ignore */ }
    if (already === v) return false; // reload at most once per version
    try { sessionStorage.setItem("store-reloaded-for", v); } catch (e) { /* ignore */ }
    window.location.reload();
    return true;
  } catch (e) {
    return false;
  }
};

export const watchForNewVersion = () => {
  if (!BUILD || typeof document === "undefined") return;
  checkForNewVersion(true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForNewVersion();
  });
  window.addEventListener("focus", () => checkForNewVersion());
  setInterval(() => checkForNewVersion(), 5 * 60 * 1000);
};
