// WhatsApp Cloud API: send every new order to the staff numbers with two buttons
// («تم التجهيز» / «بعده ما تجهز»), record who prepared it, and remind until someone does.
//
// Environment (set in Vercel → Project → Settings → Environment Variables, never in code):
//   WHATSAPP_TOKEN            permanent System User token with whatsapp_business_messaging
//   WHATSAPP_PHONE_NUMBER_ID  the bot number's id in WhatsApp Manager
//   WHATSAPP_STAFF_NUMBERS    staff numbers, comma separated, e.g. 9647701234567,9647801234567
//   WHATSAPP_ORDER_TEMPLATE   approved template name (default new_order), language ar,
//                             body {{1}} order no, {{2}} items, {{3}} total, {{4}} customer,
//                             two quick-reply buttons: «تم التجهيز» and «بعده ما تجهز»
//   WHATSAPP_TEMPLATE_LANG    default ar
//   WHATSAPP_REMIND_MINUTES   remind staff when nobody prepared it after this many minutes (default 15, 0 = off)
import { readJson, writeJson, listOrderKeys } from "./store.js";

const GRAPH = "https://graph.facebook.com/v21.0";
const env = (k, d = "") => String(process.env[k] ?? d).trim();
const formatPrice = (n) => Number(n || 0).toLocaleString("en-US") + " د.ع";

export const whatsappReady = () => !!(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID") && staffNumbers().length);

export const staffNumbers = () =>
  env("WHATSAPP_STAFF_NUMBERS")
    .split(/[,\s]+/)
    .map((n) => n.replace(/[^\d]/g, "").replace(/^00/, "").replace(/^0(7\d{9})$/, "964$1"))
    .filter((n) => /^\d{8,15}$/.test(n));

const graphSend = async (payload) => {
  const res = await fetch(`${GRAPH}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    signal: AbortSignal.timeout(10000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.code = body?.error?.code;
    throw err;
  }
  return body;
};

// Template params can't hold new lines or more than 4 spaces in a row.
const flat = (s, max = 900) => String(s || "-").replace(/\s*\n\s*/g, " · ").replace(/\s{4,}/g, "   ").slice(0, max) || "-";
const itemsLine = (order) => order.items.map((i) => `${i.name} × ${i.qty}`).join("، ");
const customerLine = (order) =>
  [order.customer.name, order.customer.phone, [order.customer.city, order.customer.address].filter(Boolean).join(" - "), order.customer.notes]
    .filter(Boolean)
    .join(" | ");

// Button payloads carry the order's storage key so the webhook can find it.
export const PREP = "prep";
export const NOT_PREP = "notprep";
const payloadFor = (kind, order) => `${kind}|${order.key}`;

const orderTemplate = (to, order, reminder) => ({
  to,
  type: "template",
  template: {
    name: env("WHATSAPP_ORDER_TEMPLATE", "new_order"),
    language: { code: env("WHATSAPP_TEMPLATE_LANG", "ar") },
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: flat(`${reminder ? "⏰ تذكير " : ""}#${order.id}`, 60) },
          { type: "text", text: flat(itemsLine(order)) },
          { type: "text", text: flat(formatPrice(order.total), 60) },
          { type: "text", text: flat(customerLine(order)) },
        ],
      },
      { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: payloadFor(PREP, order) }] },
      { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: payloadFor(NOT_PREP, order) }] },
    ],
  },
});

// Inside the 24h window a free-form interactive message works even before the template is approved.
const orderInteractive = (to, order, reminder) => ({
  to,
  type: "interactive",
  interactive: {
    type: "button",
    body: {
      text: [
        `${reminder ? "⏰ تذكير: بعده محد جهّز " : "🛍️ طلب جديد "}#${order.id}`,
        ...order.items.map((i) => `• ${i.name} × ${i.qty}`),
        `💰 ${formatPrice(order.total)}`,
        `👤 ${customerLine(order)}`,
      ].join("\n").slice(0, 1024),
    },
    action: {
      buttons: [
        { type: "reply", reply: { id: payloadFor(PREP, order), title: "تم التجهيز" } },
        { type: "reply", reply: { id: payloadFor(NOT_PREP, order), title: "بعده ما تجهز" } },
      ],
    },
  },
});

const sendOrderTo = async (to, order, reminder) => {
  try {
    await graphSend(orderTemplate(to, order, reminder));
    return true;
  } catch (e) {
    try {
      await graphSend(orderInteractive(to, order, reminder));
      return true;
    } catch (e2) {
      console.error("whatsapp order send failed", to.slice(-4), e.message, "|", e2.message);
      return false;
    }
  }
};

export const sendOrderToStaff = async (order, { reminder = false } = {}) => {
  if (!whatsappReady()) return { sent: 0, reason: "whatsapp not configured" };
  const results = await Promise.all(staffNumbers().map((to) => sendOrderTo(to, order, reminder)));
  return { sent: results.filter(Boolean).length, failed: results.filter((r) => !r).length };
};

export const sendTextToStaff = async (text, except) => {
  if (!whatsappReady()) return { sent: 0 };
  const results = await Promise.all(
    staffNumbers()
      .filter((n) => n !== except)
      .map((to) => graphSend({ to, type: "text", text: { body: text.slice(0, 4000) } }).then(() => true, () => false)),
  );
  return { sent: results.filter(Boolean).length };
};

export const replyText = (to, text) => graphSend({ to, type: "text", text: { body: text } }).catch(() => null);

// Reminder loop: orders that nobody prepared get re-sent to everyone every N minutes (max 8 times).
export const remindUnprepared = async ({ maxOrders = 50 } = {}) => {
  const minutes = Number(env("WHATSAPP_REMIND_MINUTES", "15"));
  if (!whatsappReady() || !(minutes > 0)) return { reminded: 0 };
  const now = Date.now();
  const keys = await listOrderKeys(maxOrders);
  let reminded = 0;
  for (const key of keys) {
    const order = await readJson(key).catch(() => null);
    if (!order || order.prep?.state === "prepared") continue;
    if (["shipped", "delivered", "cancelled"].includes(order.status)) continue;
    if (now - Date.parse(order.createdAt) > 24 * 3600 * 1000) continue;
    const last = Date.parse(order.prep?.lastReminderAt || order.createdAt);
    if (now - last < minutes * 60 * 1000) continue;
    if ((order.prep?.reminders || 0) >= 8) continue;
    order.prep = { ...(order.prep || { state: "waiting" }), lastReminderAt: new Date(now).toISOString(), reminders: (order.prep?.reminders || 0) + 1 };
    await writeJson(key, order);
    await sendOrderToStaff(order, { reminder: true });
    reminded++;
  }
  return { reminded };
};
