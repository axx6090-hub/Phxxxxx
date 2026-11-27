// POST   /api/orders            — customer places an order (public)
// GET    /api/orders[?since=ms] — admin lists orders (newest first)
// GET    /api/orders?number=12  — admin finds one order by its number (or an old code like K7Q3-9F2A)
// PATCH  /api/orders            — admin changes an order's status { key, status }
// DELETE /api/orders?key=...    — admin deletes an order
// PUT    /api/orders            — admin bulk action on selected orders
//                                 { action: "status", keys: [...], status } or { action: "delete", keys: [...] }
import { randomBytes } from "node:crypto";
import { route, readBody, HttpError, clientIp } from "../lib/http.js";
import { readJson, writeJson, orderKey, listOrderKeys, ORDER_KEY_RE, deleteBlob, claimOrderNumber, orderKeyForNumber } from "../lib/store.js";
import { requireAdmin } from "../lib/auth.js";
import { loadCatalog, deliveryFee as settingsDeliveryFee } from "../lib/catalog.js";
import { notifyNewOrder } from "../lib/notify.js";
import { sendOrderToStaff, remindUnprepared } from "../lib/whatsapp.js";

const DELIVERY_FEE = Number(process.env.DELIVERY_FEE || 5000);
const ADMIN_URL = process.env.ADMIN_URL || "https://admin.balyiq.site/";
export const STATUSES = ["new", "confirmed", "shipped", "delivered", "cancelled"];

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const cleanMultiline = (v, max) => String(v ?? "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, max);

const normalizeIraqiPhone = (value) => {
  let v = String(value || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[^\d+]/g, "");
  if (v.startsWith("+964")) v = "0" + v.slice(4);
  else if (v.startsWith("00964")) v = "0" + v.slice(5);
  else if (v.startsWith("964")) v = "0" + v.slice(3);
  if (/^7\d{9}$/.test(v)) v = "0" + v;
  return v;
};
const isIraqiPhone = (v) => /^07[3-9]\d{8}$/.test(v);

// Order numbers like K7Q3-9F2A: short, easy to read over the phone, no 0/O/1/I.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const newOrderId = () => {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
};

// best-effort spam protection per server instance
const recent = new Map();
const rateLimit = (ip) => {
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (hits.length >= 8) throw new HttpError(429, "طلبات كثيرة من نفس الجهاز، حاول بعد دقائق.");
  hits.push(now);
  recent.set(ip, hits);
};

// Vercel keeps the function running for a promise handed to waitUntil
// (the same hook @vercel/functions uses); elsewhere we simply wait for it.
const runAfterResponse = (promise) => {
  const ctx = globalThis[Symbol.for("@vercel/request-context")]?.get?.();
  if (ctx && typeof ctx.waitUntil === "function") { ctx.waitUntil(promise); return true; }
  return false;
};

const createOrder = async (req) => {
  rateLimit(clientIp(req));
  const body = readBody(req);
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  if (!rawItems.length) throw new HttpError(400, "السلة فارغة.");

  const catalog = await loadCatalog();
  let unverified = false;
  const items = rawItems.map((it) => {
    const id = clean(it.id, 120);
    const qty = Math.max(1, Math.min(99, Math.floor(Number(it.qty) || 1)));
    const product = catalog && catalog.get(id);
    // with the catalog loaded, an unknown product id is a forged or stale cart
    if (catalog && !product) throw new HttpError(400, "منتج بالسلة مو موجود بالمتجر، حدّث الصفحة وجرب مرة ثانية.");
    if (product && product.out_of_stock === true) throw new HttpError(400, `«${String(product.name || "منتج").slice(0, 80)}» غير متوفر حالياً، احذفيه من السلة.`);
    if (!product) unverified = true;
    const price = product ? Number(product.price) || 0 : Math.max(0, Math.round(Number(it.price) || 0));
    const name = product ? product.name : clean(it.name, 200);
    const freeDelivery = product ? !!product.free_delivery : !!it.free_delivery;
    return { id, name, price, qty, lineTotal: price * qty, free_delivery: freeDelivery };
  });

  const kidsVideoOnly = items.every((i) => i.id === "kids-video-design");
  const c = body.customer || {};
  const customer = {
    name: clean(c.name, 80),
    phone: normalizeIraqiPhone(c.phone),
    city: clean(c.city, 40),
    address: clean(c.address, 300),
    delivery: c.delivery !== false, // delivery is optional at checkout
    notes: cleanMultiline(c.notes, 1000),
  };
  if (!kidsVideoOnly) {
    if (!isIraqiPhone(customer.phone)) throw new HttpError(400, "رقم الهاتف لازم يكون عراقي صحيح، مثل 07701234567.");
    if (customer.delivery && !customer.address) throw new HttpError(400, "اكتب العنوان.");
  } else if (customer.phone && !isIraqiPhone(customer.phone)) {
    throw new HttpError(400, "رقم الهاتف لازم يكون عراقي صحيح، مثل 07701234567.");
  }

  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const deliveryFee = !customer.delivery || items.every((i) => i.free_delivery) ? 0 : settingsDeliveryFee(DELIVERY_FEE);
  const createdAt = Date.now();
  // numbers go 1, 2, 3, ...; if the counter can't be reached the order still goes through with a code
  let id;
  try {
    id = String(await claimOrderNumber((n) => ({ key: orderKey(createdAt, String(n)), createdAt: new Date(createdAt).toISOString() })));
  } catch (e) {
    console.error("order number failed", e);
    id = newOrderId();
  }
  const order = {
    id,
    key: orderKey(createdAt, id),
    createdAt: new Date(createdAt).toISOString(),
    status: "new",
    customer,
    items: items.map(({ free_delivery, ...rest }) => rest),
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    pricesVerified: !unverified,
  };
  await writeJson(order.key, order);

  // tell the admin and staff after answering the customer, so «تأكيد الطلب» returns fast
  const notifyAll = async () => {
    let notified = null;
    let staff = null;
    try {
      [notified, staff] = await Promise.all([
        notifyNewOrder(order, ADMIN_URL),
        sendOrderToStaff(order).catch((e) => ({ sent: 0, reason: e.message })),
      ]);
    } catch (e) {
      console.error("notify failed", e);
    }
    if (staff?.sent) order.prep = { state: "waiting", sentTo: staff.sent };
    if (notified || staff?.sent) {
      order.notified = { push: notified?.push?.sent || 0, whatsapp: !!notified?.whatsapp?.sent, staff: staff?.sent || 0 };
      await writeJson(order.key, order).catch(() => {});
    }
  };
  const job = notifyAll();
  if (!runAfterResponse(job)) await job;
  return { ok: true, id: order.id, items: order.items, subtotal, deliveryFee, total: order.total };
};

const findOrder = async (raw) => {
  const q = String(raw).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/^#/, "").trim().toUpperCase();
  if (!q || q.length > 20) return [];
  let key = null;
  if (/^\d+$/.test(q)) key = await orderKeyForNumber(Number(q));
  if (!key && /^[A-Z0-9-]+$/.test(q)) {
    // older orders have codes like K7Q3-9F2A and no number record
    const keys = await listOrderKeys(5000);
    key = keys.find((k) => k.endsWith(`-${q}.json`)) || null;
  }
  const order = key ? await readJson(key).catch(() => null) : null;
  return order ? [order] : [];
};

const listOrders = async (req) => {
  await requireAdmin(req);
  if (req.query?.number) return { orders: await findOrder(req.query.number), serverTime: Date.now() };
  const since = Number(req.query?.since) || 0;
  const limit = Math.min(200, Number(req.query?.limit) || 100);
  const keys = await listOrderKeys(limit);
  const orders = (await Promise.all(keys.map((k) => readJson(k).catch(() => null)))).filter(Boolean);
  const filtered = since ? orders.filter((o) => Date.parse(o.createdAt) > since) : orders;
  // the admin page polls every 30s, so it also drives the "nobody prepared it yet" reminders
  await remindUnprepared().catch((e) => console.error("remind failed", e));
  return { orders: filtered, serverTime: Date.now() };
};

const updateOrder = async (req) => {
  await requireAdmin(req);
  const { key, status } = readBody(req);
  if (!ORDER_KEY_RE.test(String(key))) throw new HttpError(400, "طلب غير معروف.");
  if (!STATUSES.includes(status)) throw new HttpError(400, "حالة غير صحيحة.");
  const order = await readJson(key);
  if (!order) throw new HttpError(404, "الطلب غير موجود.");
  order.status = status;
  order.updatedAt = new Date().toISOString();
  await writeJson(key, order);
  return { ok: true, order };
};

const removeOrder = async (req) => {
  await requireAdmin(req);
  const key = String(req.query?.key || "");
  if (!ORDER_KEY_RE.test(key)) throw new HttpError(400, "طلب غير معروف.");
  await deleteBlob(key);
  return { ok: true };
};

const BULK_MAX = 200;
const bulkOrders = async (req) => {
  await requireAdmin(req);
  const { action, keys, status } = readBody(req);
  if (!Array.isArray(keys) || !keys.length) throw new HttpError(400, "ما محدد أي طلب.");
  if (keys.length > BULK_MAX) throw new HttpError(400, `تكدر تحدد ${BULK_MAX} طلب كحد أقصى بالمرة الوحدة.`);
  const list = [...new Set(keys.map(String))];
  if (!list.every((k) => ORDER_KEY_RE.test(k))) throw new HttpError(400, "طلب غير معروف.");

  if (action === "delete") {
    await deleteBlob(list);
    return { ok: true, deleted: list.length, keys: list };
  }
  if (action === "status") {
    if (!STATUSES.includes(status)) throw new HttpError(400, "حالة غير صحيحة.");
    const now = new Date().toISOString();
    const results = await Promise.all(list.map(async (key) => {
      const order = await readJson(key).catch(() => null);
      if (!order) return null;
      order.status = status;
      order.updatedAt = now;
      await writeJson(key, order);
      return order;
    }));
    const orders = results.filter(Boolean);
    return { ok: true, updated: orders.length, orders };
  }
  throw new HttpError(400, "عملية غير معروفة.");
};

export default route({ POST: createOrder, GET: listOrders, PATCH: updateOrder, PUT: bulkOrders, DELETE: removeOrder });
