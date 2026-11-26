// GET  /api/whatsapp-webhook — Meta's verification handshake (hub.verify_token = WHATSAPP_VERIFY_TOKEN)
// POST /api/whatsapp-webhook — button taps from staff: «تم التجهيز» / «بعده ما تجهز»
//   Signed by Meta with X-Hub-Signature-256 using WHATSAPP_APP_SECRET.
// GET  /api/whatsapp-webhook?remind=1 with header x-cron-secret = CRON_SECRET runs the reminder loop.
import { createHmac, timingSafeEqual } from "node:crypto";
import { readJson, writeJson, ORDER_KEY_RE } from "../lib/store.js";
import { PREP, NOT_PREP, sendTextToStaff, replyText, remindUnprepared } from "../lib/whatsapp.js";

export const config = { api: { bodyParser: false } };

const rawBody = (req) =>
  new Promise((resolve, reject) => {
    if (typeof req.body === "string") return resolve(req.body);
    if (Buffer.isBuffer(req.body)) return resolve(req.body.toString("utf8"));
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const validSignature = (raw, header) => {
  const secret = String(process.env.WHATSAPP_APP_SECRET || "").trim();
  if (!secret) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const a = Buffer.from(String(header || ""));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const handleTap = async (msg, contacts) => {
  const id = msg.button?.payload || msg.interactive?.button_reply?.id || "";
  const [kind, key] = String(id).split("|");
  if (![PREP, NOT_PREP].includes(kind) || !ORDER_KEY_RE.test(String(key))) return;
  const from = String(msg.from || "");
  const name = contacts?.find((c) => c.wa_id === from)?.profile?.name || `+${from}`;
  const order = await readJson(key).catch(() => null);
  if (!order) return replyText(from, "ما لكيت هذا الطلب، يمكن انحذف.");

  const at = new Date().toISOString();
  const history = [...(order.prep?.history || []), { state: kind === PREP ? "prepared" : "not_prepared", by: name, phone: from, at }].slice(-20);

  if (kind === PREP) {
    if (order.prep?.state === "prepared") {
      return replyText(from, `الطلب #${order.id} جهّزه ${order.prep.by} من قبل ✅`);
    }
    order.prep = { ...(order.prep || {}), state: "prepared", by: name, phone: from, at, history };
    if (order.status === "new") order.status = "confirmed";
    order.updatedAt = at;
    await writeJson(key, order);
    await replyText(from, `✅ تم. سجّلنا إنك جهّزت الطلب #${order.id}`);
    await sendTextToStaff(`✅ الطلب #${order.id} جهّزه ${name}`, from);
  } else {
    order.prep = { ...(order.prep || {}), state: order.prep?.state === "prepared" ? "prepared" : "not_prepared", lastBy: name, history };
    order.updatedAt = at;
    await writeJson(key, order);
    await replyText(from, `تمام، الطلب #${order.id} بعده مفتوح وراح نذكّركم بيه.`);
  }
};

export default async function handler(req, res) {
  if (req.method === "GET") {
    const q = req.query || {};
    if (q.remind) {
      const secret = String(process.env.CRON_SECRET || "");
      const auth = String(req.headers["x-cron-secret"] || req.headers.authorization || "").replace(/^Bearer\s+/, "");
      if (!secret || auth !== secret) return res.status(401).end("unauthorized");
      return res.status(200).json(await remindUnprepared());
    }
    const verify = String(process.env.WHATSAPP_VERIFY_TOKEN || "");
    if (q["hub.mode"] === "subscribe" && verify && q["hub.verify_token"] === verify) {
      return res.status(200).setHeader("Content-Type", "text/plain").end(String(q["hub.challenge"] || ""));
    }
    return res.status(403).end("forbidden");
  }
  if (req.method !== "POST") return res.status(405).end();

  const raw = await rawBody(req);
  if (!validSignature(raw, req.headers["x-hub-signature-256"])) return res.status(401).end("bad signature");
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return res.status(400).end();
  }
  try {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        for (const msg of v.messages || []) {
          if (msg.type === "button" || msg.type === "interactive") await handleTap(msg, v.contacts);
        }
      }
    }
  } catch (e) {
    console.error("whatsapp webhook failed", e);
  }
  return res.status(200).end("ok");
}
