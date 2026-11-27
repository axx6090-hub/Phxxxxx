// Admin notifications: browser/phone push (Web Push) and optional WhatsApp via CallMeBot.
import * as webpush from "web-push";
import { readJson, writeJson } from "./store.js";

export const SUBS_PATH = "admin/push-subscriptions.json";
export const SETTINGS_PATH = "admin/settings.json";

const formatPrice = (n) => Number(n || 0).toLocaleString("en-US") + " د.ع";

let vapidReady = false;
const setupVapid = () => {
  if (vapidReady) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidReady = true;
  return true;
};

export const sendPush = async (payload) => {
  if (!setupVapid()) return { sent: 0, failed: 0, reason: "push not configured" };
  const subs = (await readJson(SUBS_PATH, [])) || [];
  if (!subs.length) return { sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  const gone = new Set();
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 24 * 3600, urgency: "high" });
        sent++;
      } catch (err) {
        failed++;
        if (err.statusCode === 404 || err.statusCode === 410) gone.add(s.endpoint);
        else console.error("push failed", err.statusCode, err.body);
      }
    }),
  );
  if (gone.size) await writeJson(SUBS_PATH, subs.filter((s) => !gone.has(s.endpoint)));
  return { sent, failed };
};

// CallMeBot wants the number in international form with "+", e.g. +9647701234567.
const callmebotPhone = (raw) => {
  let n = String(raw || "").replace(/[^\d+]/g, "").replace(/^00/, "+");
  if (/^07\d{9}$/.test(n)) n = "+964" + n.slice(1);
  else if (/^964\d{10}$/.test(n)) n = "+" + n;
  return /^\+\d{8,15}$/.test(n) ? n : "";
};

// The number and key come from the admin «التنبيهات» page, or else from the Vercel
// environment variables CALLMEBOT_PHONE and CALLMEBOT_APIKEY (never from code).
const whatsappTarget = (settings) => {
  const wa = settings && settings.whatsapp;
  if (wa && wa.enabled && wa.phone && wa.apikey) return { phone: callmebotPhone(wa.phone), apikey: String(wa.apikey).trim() };
  const phone = callmebotPhone(process.env.CALLMEBOT_PHONE);
  const apikey = String(process.env.CALLMEBOT_APIKEY || "").trim();
  return phone && apikey ? { phone, apikey } : null;
};

export const sendWhatsApp = async (settings, text) => {
  const target = whatsappTarget(settings);
  if (!target || !target.phone) return { sent: false, reason: "disabled" };
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(target.phone)}&apikey=${encodeURIComponent(target.apikey)}&text=${encodeURIComponent(text)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const body = (await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const ok = res.ok && !/error|invalid|not\s+active|apikey/i.test(body.slice(0, 300));
    if (!ok) console.error("callmebot failed", res.status);
    return { sent: ok, reason: ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    console.error("callmebot failed", e.name);
    return { sent: false, reason: e.name === "TimeoutError" ? "timeout" : e.message };
  }
};

export const orderSummary = (order) => {
  const lines = [
    `🛍️ طلب جديد #${order.id}`,
    `👤 ${order.customer.name || "بدون اسم"} — ${order.customer.phone || "بدون رقم"}`,
    `📍 ${[order.customer.city, order.customer.address].filter(Boolean).join(" - ") || "بدون عنوان"}`,
    ...order.items.map((i) => `• ${i.name} × ${i.qty}`),
    `📦 عدد القطع: ${order.items.reduce((n, i) => n + (Number(i.qty) || 0), 0)}`,
    `💰 المجموع: ${formatPrice(order.total)}`,
  ];
  if (order.customer.notes) lines.push(`📝 ${order.customer.notes}`);
  return lines.join("\n");
};

export const notifyNewOrder = async (order, adminUrl) => {
  const settings = (await readJson(SETTINGS_PATH, {})) || {};
  const [push, whatsapp] = await Promise.all([
    sendPush({
      title: `🛍️ طلب جديد #${order.id}`,
      body: `${order.customer.phone || "زبون"} · ${formatPrice(order.total)}${order.customer.delivery === false ? " · بدون توصيل" : ""}`,
      url: adminUrl,
      tag: `order-${order.id}`,
    }).catch((e) => ({ sent: 0, failed: 1, reason: e.message })),
    sendWhatsApp(settings, orderSummary(order)).catch((e) => ({ sent: false, reason: e.message })),
  ]);
  return { push, whatsapp };
};
