// Admin = whoever knows ADMIN_PASSWORD (a Vercel env var on this project, set by the owner).
// Login gives a signed, HttpOnly session cookie; every admin endpoint checks it on the server.
// Changing ADMIN_PASSWORD in Vercel signs every device out.
import { createHash, createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { HttpError, clientIp } from "./http.js";
import { readJson, writeJson } from "./store.js";

export const COOKIE = "ph_admin";
const SESSION_DAYS = 14;
const MAX_FAILS = 8; // per IP per window
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAILS_PATH = "admin/login-fails.json";

const password = () => String(process.env.ADMIN_PASSWORD || "");
export const passwordConfigured = () => password().length >= 8;

// signing key comes from the password itself, so a new password ends all old sessions
const key = () => createHash("sha256").update(`ph-admin-session:v1:${password()}`).digest();
const sign = (payload) => createHmac("sha256", key()).update(payload).digest("base64url");

const safeEqual = (a, b) => {
  const x = createHash("sha256").update(String(a)).digest();
  const y = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(x, y);
};

export const makeSession = () => {
  const exp = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  const payload = `${exp}.${randomBytes(12).toString("base64url")}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: SESSION_DAYS * 24 * 3600 };
};

const readCookie = (req, name) => {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
};

export const sessionValid = (req) => {
  if (!passwordConfigured()) return false;
  const value = readCookie(req, COOKIE);
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [exp, nonce, mac] = parts;
  if (!/^\d{13}$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(mac, sign(`${exp}.${nonce}`));
};

export const requireAdmin = async (req) => {
  if (!passwordConfigured()) throw new HttpError(503, "كلمة سر الأدمن مو مضبوطة بالسيرفر بعد.");
  if (!sessionValid(req)) throw new HttpError(401, "لازم تسجيل الدخول للوحة الأدمن.");
};

export const setSessionCookie = (res, session) => {
  res.setHeader("Set-Cookie", `${COOKIE}=${session.value}; Path=/; Max-Age=${session.maxAge}; HttpOnly; Secure; SameSite=Lax`);
};
export const clearSessionCookie = (res) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
};

const ipKey = (req) => createHash("sha256").update(`ip:${clientIp(req)}`).digest("hex").slice(0, 24);

/** Checks a login attempt; throws after too many wrong tries from the same address. */
export const checkPassword = async (req, attempt) => {
  if (!passwordConfigured()) throw new HttpError(503, "كلمة سر الأدمن مو مضبوطة بالسيرفر بعد.");
  const now = Date.now();
  const id = ipKey(req);
  const fails = (await readJson(FAILS_PATH, {}).catch(() => ({}))) || {};
  for (const k of Object.keys(fails)) if (fails[k].until < now) delete fails[k];
  const mine = fails[id];
  if (mine && mine.count >= MAX_FAILS) throw new HttpError(429, "محاولات كثيرة غلط. جرّب بعد ربع ساعة.");

  if (safeEqual(attempt, password())) {
    if (mine) { delete fails[id]; await writeJson(FAILS_PATH, fails).catch(() => {}); }
    return true;
  }
  fails[id] = { count: (mine ? mine.count : 0) + 1, until: now + FAIL_WINDOW_MS };
  await writeJson(FAILS_PATH, fails).catch(() => {});
  await new Promise((r) => setTimeout(r, 700));
  throw new HttpError(401, "كلمة السر غلط.");
};
