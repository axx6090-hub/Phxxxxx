// GET    /api/admin  — { loggedIn, configured }
// POST   /api/admin  — { password } → sets the admin session cookie
// DELETE /api/admin  — signs this device out
import { route, readBody, HttpError } from "../lib/http.js";
import { checkPassword, makeSession, setSessionCookie, clearSessionCookie, sessionValid, passwordConfigured } from "../lib/auth.js";

export default route({
  GET: async (req) => ({ loggedIn: sessionValid(req), configured: passwordConfigured() }),
  POST: async (req, res) => {
    const body = readBody(req);
    const attempt = String(body.password || "");
    if (!attempt || attempt.length > 200) throw new HttpError(400, "اكتب كلمة السر.");
    await checkPassword(req, attempt);
    setSessionCookie(res, makeSession());
    return { ok: true };
  },
  DELETE: async (req, res) => {
    clearSessionCookie(res);
    return { ok: true };
  },
});
