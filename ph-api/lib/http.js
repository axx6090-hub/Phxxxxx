// Small HTTP helpers shared by every endpoint.
const DEFAULT_ORIGINS = ["https://axx6090-hub.github.io"];

const allowedOrigins = () =>
  (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(","))
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const cors = (req, res) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
};

export const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

export const readBody = (req) => {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      throw new HttpError(400, "بيانات الطلب غير صالحة.");
    }
  }
  return {};
};

export const clientIp = (req) =>
  String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();

/** Wraps a map of method handlers with CORS, OPTIONS and error handling. */
export const route = (handlers) => async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  const handler = handlers[req.method];
  if (!handler) return send(res, 405, { error: "Method not allowed" });
  try {
    const result = await handler(req, res);
    if (!res.writableEnded) send(res, 200, result ?? { ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.writableEnded) send(res, status, { error: status === 500 ? "صار خطأ بالسيرفر، حاول مرة ثانية." : err.message });
  }
};
