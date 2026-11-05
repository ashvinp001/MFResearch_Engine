// Sign-in for every visitor, this PC included. Two logins, both set in .env:
//   admin  ADMIN_ID (default "admin") + ADMIN_PASSWORD   everything
//   team   TEAM_ID  (default "team")  + TEAM_PASSWORD    everything except the Fund Scorecard
//          (SITE_PASSWORD, the earlier single team password, still works as TEAM_PASSWORD when that is not set)
// Passwords live only in .env, are read on every request (no restart after a change) and are compared in constant
// time. A correct ID + password gives a random session cookie (HttpOnly, SameSite=Strict) that carries no role: the
// role is kept here, on the server. The cookie has no expiry date, so the browser forgets it when it closes; the
// server forgets the session after TEAM.sessionHours anyway, and on sign-out. (Closing just the tab is handled by the
// website: app/shared/access.js.) Too many wrong tries from one address within the window block it for
// the rest of that window.
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { LIMITS, LOGIN_PAGE, TEAM } from "../config.js";
import { readEnv } from "../lib/env.js";
import { readBody, send, sendJson, sendText } from "../lib/http.js";

export const ROLES = Object.freeze({ ADMIN: "admin", TEAM: "team" });

const sessions = new Map();   // token -> { role, expiry (ms) }
const failures = new Map();   // client address -> times (ms) of recent wrong tries

const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest();
export const samePassword = (given, expected) => crypto.timingSafeEqual(sha256(given), sha256(expected));

/** The logins set up in .env (a login without a password is not offered). */
export function accounts(env = readEnv()) {
  const list = [
    { role: ROLES.ADMIN, id: (env.ADMIN_ID || "admin").trim(), password: env.ADMIN_PASSWORD || "" },
    { role: ROLES.TEAM, id: (env.TEAM_ID || "team").trim(), password: env.TEAM_PASSWORD || env.SITE_PASSWORD || "" },
  ];
  return list.filter((a) => a.id && a.password);
}

/** The role for an ID + password, or null. Every account is checked, so the time taken does not tell which ID exists. */
export function roleFor(id, password, list = accounts()) {
  let role = null;
  for (const a of list) {
    const idOk = samePassword(String(id).trim().toLowerCase(), a.id.toLowerCase());
    const pwOk = samePassword(String(password), a.password);
    if (idOk && pwOk && role === null) role = a.role;
  }
  return role;
}

function sessionToken(req) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "pw_session") return rest.join("=");
  }
  return null;
}

/** The signed-in role of this request, or null. */
function sessionRole(req) {
  const token = sessionToken(req);
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expiry < Date.now()) { sessions.delete(token); return null; }
  return session.role;
}

async function login(req, res, client, list) {
  const cutoff = Date.now() - TEAM.failureWindowMinutes * 60_000;
  const recent = (failures.get(client) || []).filter((t) => t > cutoff);
  if (recent.length >= TEAM.maxFailures) return sendJson(res, 429, { ok: false, error: "too many attempts" });
  let id = "", password = "";
  try {
    const body = JSON.parse(await readBody(req, LIMITS.loginBody));
    id = String(body.id ?? "");
    password = String(body.password ?? "");
  } catch { /* an unreadable body is a wrong sign-in */ }
  const role = id && password ? roleFor(id, password, list) : null;
  if (role) {
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { role, expiry: Date.now() + TEAM.sessionHours * 3_600_000 });
    failures.delete(client);
    return sendJson(res, 200, { ok: true }, {
      "Set-Cookie": `pw_session=${token}; Path=/; HttpOnly; SameSite=Strict`,
    });
  }
  failures.set(client, [...recent, Date.now()]);
  await new Promise((r) => setTimeout(r, TEAM.wrongPasswordDelayMs));   // slows down guessing
  sendJson(res, 401, { ok: false });
}

function logout(req, res) {
  const token = sessionToken(req);
  if (token) sessions.delete(token);
  sendJson(res, 200, { ok: true }, { "Set-Cookie": "pw_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" });
}

/**
 * For every visitor: answers the request itself (sign-in, sign-out, the sign-in page) and returns true, or sets
 * ctx.role ("admin" | "team") and returns false to continue.
 */
export async function teamGate(ctx) {
  const { req, res, pathname, client } = ctx;
  const list = accounts();
  if (!list.length) { sendText(res, 503, "Sign-in is not set up (ADMIN_PASSWORD / TEAM_PASSWORD missing in .env)."); return true; }
  if (req.method === "POST" && pathname === "/__login") { await login(req, res, client, list); return true; }
  if (req.method === "POST" && pathname === "/__logout") { logout(req, res); return true; }
  const role = sessionRole(req);
  if (role) { ctx.role = role; return false; }
  if (/^\/assets\/prosperr-(logo|icon)\.png$/.test(pathname)) return false;   // the logo on the sign-in page
  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    send(res, 200, "text/html; charset=utf-8", await readFile(LOGIN_PAGE));
    return true;
  }
  sendText(res, 401, "Sign in first.");
  return true;
}
