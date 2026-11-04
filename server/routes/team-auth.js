// Team password for other computers (this PC is never asked). SITE_PASSWORD in .env. A correct password
// gives a random session cookie (HttpOnly, SameSite=Strict, 12 hours). Too many wrong tries from one
// address within the window block it for the rest of that window.
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { LIMITS, LOGIN_PAGE, TEAM } from "../config.js";
import { readEnv } from "../lib/env.js";
import { readBody, send, sendJson, sendText } from "../lib/http.js";

const sessions = new Map();   // token -> expiry (ms)
const failures = new Map();   // client address -> times (ms) of recent wrong tries

const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest();
export const samePassword = (given, expected) => crypto.timingSafeEqual(sha256(given), sha256(expected));

function sessionToken(req) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "pw_session") return rest.join("=");
  }
  return null;
}

function hasSession(req) {
  const token = sessionToken(req);
  const expiry = token && sessions.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) { sessions.delete(token); return false; }
  return true;
}

async function login(req, res, client, password) {
  const cutoff = Date.now() - TEAM.failureWindowMinutes * 60_000;
  const recent = (failures.get(client) || []).filter((t) => t > cutoff);
  if (recent.length >= TEAM.maxFailures) return sendJson(res, 429, { ok: false, error: "too many attempts" });
  let given = "";
  try { given = String(JSON.parse(await readBody(req, LIMITS.loginBody)).password ?? ""); } catch { given = ""; }
  if (given && samePassword(given, password)) {
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + TEAM.sessionHours * 3_600_000);
    failures.delete(client);
    return sendJson(res, 200, { ok: true }, {
      "Set-Cookie": `pw_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TEAM.sessionHours * 3600}`,
    });
  }
  failures.set(client, [...recent, Date.now()]);
  await new Promise((r) => setTimeout(r, TEAM.wrongPasswordDelayMs));   // slows down guessing
  sendJson(res, 401, { ok: false });
}

/** For another computer: answers the request itself (sign-in) and returns true, or returns false to continue. */
export async function teamGate({ req, res, pathname, client }) {
  const password = readEnv().SITE_PASSWORD;
  if (!password) { sendText(res, 503, "Team access is not set up (SITE_PASSWORD missing in .env)."); return true; }
  if (req.method === "POST" && pathname === "/__login") { await login(req, res, client, password); return true; }
  if (hasSession(req)) return false;
  if (/^\/assets\/prosperr-(logo|icon)\.png$/.test(pathname)) return false;   // the logo on the sign-in page
  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    send(res, 200, "text/html; charset=utf-8", await readFile(LOGIN_PAGE));
    return true;
  }
  sendText(res, 401, "Sign in first.");
  return true;
}
