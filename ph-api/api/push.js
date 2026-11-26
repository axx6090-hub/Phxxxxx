// GET    /api/push           — public VAPID key (used by the admin panel to subscribe)
// POST   /api/push           — admin saves this device's push subscription
// DELETE /api/push           — admin removes a subscription { endpoint }
// POST   /api/push?test=1    — admin sends a test notification
import { route, readBody, HttpError } from "../lib/http.js";
import { readJson, writeJson } from "../lib/store.js";
import { requireAdmin } from "../lib/auth.js";
import { SUBS_PATH, sendPush } from "../lib/notify.js";

const ADMIN_URL = process.env.ADMIN_URL || "https://admin.balyiq.site/";

const validSub = (s) =>
  s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000 &&
  s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string";

export default route({
  GET: async () => ({ publicKey: process.env.VAPID_PUBLIC_KEY || null }),
  POST: async (req) => {
    await requireAdmin(req);
    if (req.query?.test) {
      const result = await sendPush({ title: "🔔 تجربة الإشعارات", body: "الإشعارات شغّالة على هذا الجهاز ✅", url: ADMIN_URL, tag: "test" });
      return { ok: true, ...result };
    }
    const { subscription, label } = readBody(req);
    if (!validSub(subscription)) throw new HttpError(400, "اشتراك الإشعارات غير صالح.");
    const subs = ((await readJson(SUBS_PATH, [])) || []).filter((s) => s.endpoint !== subscription.endpoint);
    subs.push({ endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }, label: String(label || "").slice(0, 80), addedAt: new Date().toISOString() });
    await writeJson(SUBS_PATH, subs.slice(-20));
    return { ok: true, devices: Math.min(subs.length, 20) };
  },
  DELETE: async (req) => {
    await requireAdmin(req);
    const { endpoint } = readBody(req);
    const subs = ((await readJson(SUBS_PATH, [])) || []).filter((s) => s.endpoint !== endpoint);
    await writeJson(SUBS_PATH, subs);
    return { ok: true, devices: subs.length };
  },
});
