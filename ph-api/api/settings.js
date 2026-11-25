// GET  /api/settings          — admin reads notification settings (API key masked)
// PUT  /api/settings          — admin saves { whatsapp: { enabled, phone, apikey } }
// POST /api/settings?test=1   — admin sends a test WhatsApp message
import { route, readBody, HttpError } from "../lib/http.js";
import { readJson, writeJson } from "../lib/store.js";
import { requireAdmin } from "../lib/auth.js";
import { SETTINGS_PATH, SUBS_PATH, sendWhatsApp } from "../lib/notify.js";

const publicView = async (settings) => {
  const wa = settings.whatsapp || {};
  const subs = (await readJson(SUBS_PATH, [])) || [];
  return {
    whatsapp: { enabled: !!wa.enabled, phone: wa.phone || "", hasApiKey: !!wa.apikey },
    pushDevices: subs.map((s) => ({ endpoint: s.endpoint, label: s.label, addedAt: s.addedAt })),
  };
};

export default route({
  GET: async (req) => {
    await requireAdmin(req);
    return publicView((await readJson(SETTINGS_PATH, {})) || {});
  },
  PUT: async (req) => {
    await requireAdmin(req);
    const body = readBody(req);
    const settings = (await readJson(SETTINGS_PATH, {})) || {};
    const wa = body.whatsapp || {};
    const phone = String(wa.phone || "").replace(/[^\d+]/g, "");
    if (wa.enabled && !/^\+?\d{8,15}$/.test(phone)) throw new HttpError(400, "اكتب رقم الواتساب بالصيغة الدولية، مثل +9647701234567.");
    settings.whatsapp = {
      enabled: !!wa.enabled,
      phone,
      // keep the saved key when the panel sends an empty field
      apikey: wa.apikey ? String(wa.apikey).trim().slice(0, 100) : (settings.whatsapp || {}).apikey || "",
    };
    if (settings.whatsapp.enabled && !settings.whatsapp.apikey) throw new HttpError(400, "اكتب مفتاح CallMeBot.");
    await writeJson(SETTINGS_PATH, settings);
    return publicView(settings);
  },
  POST: async (req) => {
    await requireAdmin(req);
    if (!req.query?.test) throw new HttpError(400, "Unknown action");
    const settings = (await readJson(SETTINGS_PATH, {})) || {};
    const result = await sendWhatsApp(settings, "🔔 تجربة: إشعارات طلبات متجر كليشة على الواتساب شغّالة ✅");
    if (!result.sent) throw new HttpError(400, result.reason === "disabled" ? "فعّل إشعار الواتساب واحفظ أولاً." : `ما وصلت الرسالة: ${result.reason}`);
    return { ok: true };
  },
});
