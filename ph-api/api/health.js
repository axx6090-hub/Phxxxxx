import { route } from "../lib/http.js";
export default route({
  GET: async () => ({ ok: true, push: !!process.env.VAPID_PUBLIC_KEY, whatsappBot: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_STAFF_NUMBERS), storage: !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID), time: new Date().toISOString() }),
});
