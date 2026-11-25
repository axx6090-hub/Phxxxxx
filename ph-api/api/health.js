import { route } from "../lib/http.js";
export default route({
  GET: async () => ({ ok: true, push: !!process.env.VAPID_PUBLIC_KEY, storage: !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID), time: new Date().toISOString() }),
});
