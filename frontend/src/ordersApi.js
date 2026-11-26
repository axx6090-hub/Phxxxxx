// Orders API (Vercel project "ph-orders-api"): saves orders and notifies the admin.
export const ORDERS_API = (process.env.REACT_APP_ORDERS_API || "https://api.balyiq.site").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const apiRequest = async (path, { method = "GET", body, token, timeoutMs = 15000 } = {}) => {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetch(`${ORDERS_API}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      // admin calls carry the HttpOnly session cookie; the public store sends none
      credentials: token ? "include" : "omit",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller ? controller.signal : undefined,
      cache: "no-store",
    });
  } catch (e) {
    throw new ApiError(0, "تعذّر الاتصال بالسيرفر. تأكد من الإنترنت.");
  } finally {
    if (timer) clearTimeout(timer);
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `خطأ من السيرفر (${res.status}).`);
  return data;
};
