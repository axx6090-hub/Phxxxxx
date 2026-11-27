// GET /api/alert-test — test only: sends a sample "new order" WhatsApp alert through CallMeBot
// to CALLMEBOT_PHONE with CALLMEBOT_APIKEY (Vercel env vars). Works on preview deployments only.
import { route, HttpError } from "../lib/http.js";
import { sendWhatsApp, orderSummary } from "../lib/notify.js";

export default route({
  GET: async () => {
    if (process.env.VERCEL_ENV === "production") throw new HttpError(404, "Not found");
    const configured = { phone: !!process.env.CALLMEBOT_PHONE, apikey: !!process.env.CALLMEBOT_APIKEY };
    if (!configured.phone || !configured.apikey) return { sent: false, configured, reason: "أضف CALLMEBOT_PHONE و CALLMEBOT_APIKEY ببيئة Preview" };
    const sample = {
      id: "تجربة",
      customer: { name: "زبونة تجربة", phone: "07700000000", city: "بغداد" },
      items: [{ name: "منتج تجربة", qty: 2 }],
      total: 25000,
    };
    const result = await sendWhatsApp({}, `🧪 رسالة تجربة\n${orderSummary(sample)}`);
    return { ...result, configured };
  },
});
