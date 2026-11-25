// Admin = anyone whose GitHub token can push to the store repository.
// The admin panel already uses that token, so no extra password is needed.
import { createHash } from "node:crypto";
import { HttpError } from "./http.js";

const REPO = process.env.STORE_REPO || "axx6090-hub/Ph";
const cache = new Map(); // sha256(token) -> expiry ms

export const requireAdmin = async (req) => {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "لازم تسجيل الدخول للوحة الأدمن.");

  const hash = createHash("sha256").update(token).digest("hex");
  const until = cache.get(hash);
  if (until && until > Date.now()) return;

  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "ph-orders-api" },
    });
  } catch (e) {
    throw new HttpError(503, "تعذّر التحقق من الحساب، حاول بعد قليل.");
  }
  if (res.status === 401) throw new HttpError(401, "رمز GitHub غير صحيح أو منتهي.");
  if (!res.ok) throw new HttpError(403, "هذا الحساب ما عنده صلاحية على المتجر.");
  const repo = await res.json();
  const perms = repo.permissions || {};
  if (!perms.push && !perms.admin) throw new HttpError(403, "هذا الحساب ما عنده صلاحية على المتجر.");
  cache.set(hash, Date.now() + 5 * 60 * 1000);
};
