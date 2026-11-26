// Admin-only bridge to the store repository on GitHub, so the panel needs no GitHub token.
// The server's token (STORE_GITHUB_TOKEN, Contents: Read and write on the store repo) never
// reaches the browser, and only the store data file and product/banner photos can be touched.
// GET /api/repo?path=...   — { content (base64), sha } or 404
// PUT /api/repo            — { path, content (base64), message, sha? }
import { createHash } from "node:crypto";
import { route, readBody, HttpError } from "../lib/http.js";
import { requireAdmin } from "../lib/auth.js";

const REPO = process.env.STORE_REPO || "axx6090-hub/Phxxxxx";
const BRANCH = process.env.STORE_BRANCH || "main";
const ALLOWED = /^(frontend\/src\/staticData\.json|frontend\/public\/images\/(products|banners)\/[A-Za-z0-9_-]{1,80}\.jpg)$/;
const MAX_B64 = 4_000_000;

// trim: a pasted token often carries a space or a line break
const rawToken = () => (process.env.STORE_GITHUB_TOKEN || "").trim();
const ghToken = () => {
  const t = rawToken();
  if (!t) throw new HttpError(503, "رمز GitHub مال السيرفر (STORE_GITHUB_TOKEN) مو مضاف بـ Vercel بعد.");
  return t;
};
const checkPath = (p) => {
  const path = String(p || "");
  if (!ALLOWED.test(path)) throw new HttpError(400, "مسار غير مسموح.");
  return path;
};
const url = (path) => `https://api.github.com/repos/${REPO}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
const headers = () => ({
  Authorization: `Bearer ${ghToken()}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "ph-orders-api",
});
const fail = (status) => {
  if (status === 401) return new HttpError(502, "رمز GitHub بالسيرفر غير صحيح أو منتهي.");
  if (status === 403) return new HttpError(502, "رمز GitHub بالسيرفر ما عنده صلاحية الكتابة (Contents: Read and write).");
  if (status === 404) return new HttpError(404, "الملف غير موجود.");
  if (status === 409 || status === 422) return new HttpError(409, "البيانات تغيّرت على GitHub. حدّث الصفحة وأعد المحاولة.");
  return new HttpError(502, `خطأ من GitHub (${status}).`);
};

// Before STORE_GITHUB_TOKEN is set the panel can still open: the repo is public, so files
// are read from raw.githubusercontent.com and their git blob sha is computed here.
const readPublic = async (path, metaOnly) => {
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}?t=${Date.now()}`, { cache: "no-store" });
  if (res.status === 404) throw new HttpError(404, "الملف غير موجود.");
  if (!res.ok) throw new HttpError(502, `تعذّر قراءة الملف (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
  return metaOnly ? { sha } : { content: buf.toString("base64"), sha, readOnly: true };
};

/** Checks the server token against GitHub. Returns only statuses and flags, never the token. */
export const checkToken = async (writeTest = false) => {
  const t = rawToken();
  if (!t) return { set: false };
  const kind = t.startsWith("github_pat_") ? "fine-grained" : t.startsWith("ghp_") ? "classic" : "other";
  const out = { set: true, kind, hadSpaces: t !== (process.env.STORE_GITHUB_TOKEN || ""), innerSpaces: /\s/.test(t) };
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, { headers: headers(), cache: "no-store" });
    out.status = res.status;
    const body = await res.json().catch(() => ({}));
    if (res.ok) out.canWrite = !!(body.permissions && body.permissions.push);
    else out.message = String(body.message || "").slice(0, 120);
    if (res.ok && writeTest) {
      // harmless write: make a throwaway branch at main's commit, then delete it
      const h = { ...headers(), "Content-Type": "application/json" };
      const main = await fetch(`https://api.github.com/repos/${REPO}/git/ref/heads/${BRANCH}`, { headers: h, cache: "no-store" });
      const sha = main.ok ? ((await main.json()).object || {}).sha : "";
      const ref = `token-check-${Date.now()}`;
      const mk = await fetch(`https://api.github.com/repos/${REPO}/git/refs`, { method: "POST", headers: h, body: JSON.stringify({ ref: `refs/heads/${ref}`, sha }) });
      out.writeStatus = mk.status;
      if (!mk.ok) {
        out.writeMessage = String(((await mk.json().catch(() => ({}))).message) || "").slice(0, 120);
        out.needs = mk.headers.get("x-accepted-github-permissions") || "";
      } else {
        const del = await fetch(`https://api.github.com/repos/${REPO}/git/refs/heads/${ref}`, { method: "DELETE", headers: h });
        out.cleanup = del.status;
      }
    }
  } catch (e) {
    out.status = 0;
  }
  console.log("store token check", JSON.stringify(out)); // statuses only, no token
  return out;
};

const tokenProblem = (status) => fail(status).message;

export default route({
  GET: async (req) => {
    await requireAdmin(req);
    const path = checkPath(req.query?.path);
    if (!rawToken()) return readPublic(path, !!req.query?.meta);
    const res = await fetch(`${url(path)}?ref=${BRANCH}`, { headers: headers(), cache: "no-store" });
    // The repo is public: when the token is refused, still read the file so the panel opens,
    // and tell the panel why saving won't work yet.
    if (!res.ok && [401, 403, 404].includes(res.status)) {
      console.error("store token refused on read", res.status);
      const pub = await readPublic(path, !!req.query?.meta);
      return { ...pub, tokenProblem: tokenProblem(res.status) };
    }
    if (!res.ok) throw fail(res.status);
    const file = await res.json();
    if (req.query?.meta) return { sha: file.sha };
    if (file.content) return { content: file.content, sha: file.sha };
    // files over 1 MB come without content; fetch the raw blob
    const raw = await fetch(file.git_url, { headers: headers() });
    if (!raw.ok) throw fail(raw.status);
    const blob = await raw.json();
    return { content: blob.content, sha: file.sha };
  },
  PUT: async (req) => {
    await requireAdmin(req);
    const body = readBody(req);
    const path = checkPath(body.path);
    const content = String(body.content || "").replace(/\s/g, "");
    if (!content || content.length > MAX_B64 || !/^[A-Za-z0-9+/]+=*$/.test(content)) throw new HttpError(400, "محتوى الملف غير صالح أو كبير.");
    const message = String(body.message || "Update from admin panel").slice(0, 120);
    const sha = body.sha ? String(body.sha).replace(/[^a-f0-9]/g, "").slice(0, 40) : undefined;
    const res = await fetch(url(path), {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ message, content, branch: BRANCH, ...(sha ? { sha } : {}) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("store token refused on write", res.status, String(err.message || "").slice(0, 120), res.headers.get("x-accepted-github-permissions") || "");
      throw fail(res.status);
    }
    const out = await res.json();
    return { sha: out.content && out.content.sha };
  },
});
