// Server unit tests (node --test). Run: npm test
// They use a throwaway settings file with made-up test passwords (never the real .env): PROSPERR_ENV_FILE is set
// before the server modules load, so the modules are imported after it.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const TEST_PASSWORDS = { admin: crypto.randomBytes(12).toString("hex"), team: crypto.randomBytes(12).toString("hex") };
const envDir = mkdtempSync(path.join(os.tmpdir(), "prosperr-server-test-"));
writeFileSync(path.join(envDir, ".env"), `ADMIN_PASSWORD=${TEST_PASSWORDS.admin}
TEAM_PASSWORD=${TEST_PASSWORDS.team}
`);
process.env.PROSPERR_ENV_FILE = path.join(envDir, ".env");

const { handleRequest } = await import("../app.js");
const { sendJson } = await import("../lib/http.js");
const { isLoopback, isPrivateAddress } = await import("../lib/network.js");
const { allowedPath } = await import("../routes/static.js");
const { accounts, roleFor, samePassword } = await import("../routes/team-auth.js");

test("loopback and private addresses", () => {
  assert.ok(isLoopback("127.0.0.1"));
  assert.ok(isLoopback("::1"));
  assert.ok(isLoopback("::ffff:127.0.0.1"));
  assert.ok(!isLoopback("192.168.1.4"));
  for (const ip of ["10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.4", "::ffff:192.168.0.9"]) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "2001:db8::1", ""]) assert.ok(!isPrivateAddress(ip), ip);
});

test("private files are never served", () => {
  for (const p of ["/.env", "/.git/config", "/data-pipeline/settings.py", "/server/config.js", "/config/scorecard-settings.json",
    "/CLAUDE.md", "/claude.md", "/package.json", "/app/%2e%2e/.env", "/%2Eenv", "/a/.hidden/x.js", "/bad%E0%A4%A"]) {
    assert.equal(allowedPath(p, true), null, p);
  }
  assert.equal(allowedPath("/", true), "index.html");
  assert.equal(allowedPath("/tests/index.html", true), "tests/index.html");
});

test("a visitor that is not this PC (only possible in the Docker container) sees only the website", () => {
  assert.equal(allowedPath("/app/main.js", false), "app/main.js");
  assert.equal(allowedPath("/design-system/index.css", false), "design-system/index.css");
  assert.equal(allowedPath("/data/schemes/direct.json", false), "data/schemes/direct.json");
  for (const p of ["/tests/index.html", "/docs/ARCHITECTURE.md", "/README.md", "/tests/pdf-fixtures/local/a.pdf"]) {
    assert.equal(allowedPath(p, false), null, p);
  }
});

test("JSON already held as text or bytes is sent as it is", () => {
  const sent = (body) => {
    let out = null;
    sendJson({ headersSent: false, writeHead() {}, end(data) { out = data.toString("utf8"); } }, 200, body);
    return out;
  };
  assert.equal(sent('{"a":1}'), '{"a":1}');
  assert.equal(sent(Buffer.from('{"a":1}')), '{"a":1}');
  assert.equal(sent({ a: 1 }), '{"a":1}');
});

test("password comparison", () => {
  assert.ok(samePassword("secret", "secret"));
  assert.ok(!samePassword("secret", "Secret"));
  assert.ok(!samePassword("", "secret"));
});

test("two logins: admin and team, from .env only", () => {
  const env = { ADMIN_PASSWORD: "Adm!n-pass", TEAM_ID: "Prosperr-Team", TEAM_PASSWORD: "team-pass" };
  const list = accounts(env);
  assert.deepEqual(list.map((a) => [a.role, a.id]), [["admin", "admin"], ["team", "Prosperr-Team"]]);
  assert.equal(roleFor("admin", "Adm!n-pass", list), "admin");
  assert.equal(roleFor(" ADMIN ", "Adm!n-pass", list), "admin");            // the ID is not case-sensitive
  assert.equal(roleFor("prosperr-team", "team-pass", list), "team");
  assert.equal(roleFor("admin", "team-pass", list), null);                   // another login's password
  assert.equal(roleFor("prosperr-team", "Adm!n-pass", list), null);
  assert.equal(roleFor("admin", "adm!n-pass", list), null);                  // the password is case-sensitive
  assert.equal(roleFor("", "", list), null);
  // A login without a password is not offered; the earlier single SITE_PASSWORD still opens the team login.
  assert.deepEqual(accounts({ SITE_PASSWORD: "old" }).map((a) => a.role), ["team"]);
  assert.deepEqual(accounts({}), []);
});

let server;
before(async () => {
  server = http.createServer(handleRequest);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
});
after(() => {
  server.close();
  rmSync(envDir, { recursive: true, force: true });
});

async function request(path, { method = "GET", cookie = "", body } = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status, type: response.headers.get("content-type"), cache: response.headers.get("cache-control"),
    setCookie: response.headers.get("set-cookie") || "", text: await response.text(),
  };
}

/** Signs in and returns the session cookie ("pw_session=…"). */
async function signIn(id, password) {
  const r = await request("/__login", { method: "POST", body: { id, password } });
  assert.equal(r.status, 200, `sign-in as ${id}`);
  return r.setCookie.split(";")[0];
}

test("this PC too: nothing but the sign-in page opens before signing in", async () => {
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(page.type, /^text\/html/);
  assert.equal(page.cache, "no-store");
  assert.match(page.text, /<title>Sign in<\/title>/);
  for (const p of ["/app/main.js", "/api/whoami", "/api/peer-stats?codes=1", "/tests/index.html", "/.env", "/config/scorecard-settings.json"]) {
    assert.equal((await request(p)).status, 401, p);
  }
  assert.equal((await request("/api/scorecard-settings/verify", { method: "POST" })).status, 401);
});

test("a wrong ID or password is refused", async () => {
  assert.equal((await request("/__login", { method: "POST", body: { id: "admin", password: TEST_PASSWORDS.team } })).status, 401);
  assert.equal((await request("/__login", { method: "POST", body: { id: "nobody", password: TEST_PASSWORDS.admin } })).status, 401);
});

test("admin login: everything; the cookie is HttpOnly, SameSite=Strict and ends with the browser", async () => {
  const r = await request("/__login", { method: "POST", body: { id: "Admin", password: TEST_PASSWORDS.admin } });
  assert.equal(r.status, 200);
  assert.match(r.setCookie, /^pw_session=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Strict$/);   // no Max-Age / Expires
  const cookie = r.setCookie.split(";")[0];
  assert.deepEqual(JSON.parse((await request("/api/whoami", { cookie })).text), { role: "admin", signedIn: true });
  const page = await request("/", { cookie });
  assert.doesNotMatch(page.text, /<title>Sign in<\/title>/);   // the website itself
  assert.notEqual((await request("/api/scorecard-settings/verify", { method: "POST", cookie })).status, 403);
  assert.equal((await request("/.env", { cookie })).status, 404);                     // private files stay private
  assert.equal((await request("/server/config.js", { cookie })).status, 404);
});

test("team login: no Fund Scorecard", async () => {
  const cookie = await signIn("team", TEST_PASSWORDS.team);
  assert.deepEqual(JSON.parse((await request("/api/whoami", { cookie })).text), { role: "team", signedIn: true });
  assert.equal((await request("/api/scorecard-settings", { cookie })).status, 403);
  assert.equal((await request("/api/scorecard-settings/verify", { method: "POST", cookie })).status, 403);
  assert.equal((await request("/app/main.js", { cookie })).status, 200);
});

test("signing out ends the session; a made-up cookie opens nothing", async () => {
  const cookie = await signIn("admin", TEST_PASSWORDS.admin);
  const out = await request("/__logout", { method: "POST", cookie });
  assert.match(out.setCookie, /Max-Age=0/);
  assert.equal((await request("/api/whoami", { cookie })).status, 401);
  assert.equal((await request("/api/whoami", { cookie: `pw_session=${"0".repeat(64)}` })).status, 401);
});

test("API input is validated before Python runs", async () => {
  const cookie = await signIn("admin", TEST_PASSWORDS.admin);
  for (const p of ["/api/nav-history?codes=1;rm", "/api/nav-history?codes=1&years=99", "/api/benchmark-history?codes=XX1",
    "/api/fund-holdings?isins=INF879", "/api/peer-stats?codes=", "/api/fund-metadata?codes=a"]) {
    const r = await request(p, { cookie });
    assert.equal(r.status, 400, p);
    assert.match(JSON.parse(r.text).error, /must be/);
  }
});
