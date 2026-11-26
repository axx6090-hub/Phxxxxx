import { route } from "../lib/http.js";
import { checkToken } from "./repo.js";
import { requireAdmin } from "../lib/auth.js";
export default route({
  GET: async (req) => {
    // the write test makes a throwaway branch, so only the signed-in admin may run it
    if (req.query?.github === "write") await requireAdmin(req);
    return { ok: true, push: !!process.env.VAPID_PUBLIC_KEY, whatsappBot: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_STAFF_NUMBERS), adminPassword: (process.env.ADMIN_PASSWORD || "").length >= 8, repoToken: !!process.env.STORE_GITHUB_TOKEN, storage: !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID), time: new Date().toISOString(), ...(req.query?.github ? { github: await checkToken(req.query.github === "write") } : {}) };
  },
});
