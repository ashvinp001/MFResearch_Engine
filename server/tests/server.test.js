// Server unit tests (node --test). Run: npm test
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { handleRequest } from "../app.js";
import { sendJson } from "../lib/http.js";
import { isLoopback, isPrivateAddress } from "../lib/network.js";
import { allowedPath } from "../routes/static.js";
import { samePassword } from "../routes/team-auth.js";

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

test("other computers see only the website", () => {
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

async function request(path, method = "GET") {
  const server = http.createServer(handleRequest);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method });
    return { status: response.status, type: response.headers.get("content-type"), cache: response.headers.get("cache-control"), text: await response.text() };
  } finally {
    server.close();
  }
}

test("serves the website with the right type and no caching", async () => {
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(page.type, /^text\/html/);
  assert.equal(page.cache, "no-store");
  assert.equal((await request("/.env")).status, 404);
  assert.equal((await request("/missing-file.js")).status, 404);
});

test("API input is validated before Python runs", async () => {
  for (const path of ["/api/nav-history?codes=1;rm", "/api/nav-history?codes=1&years=99", "/api/benchmark-history?codes=XX1",
    "/api/fund-holdings?isins=INF879", "/api/peer-stats?codes=", "/api/fund-metadata?codes=a"]) {
    const r = await request(path);
    assert.equal(r.status, 400, path);
    assert.match(JSON.parse(r.text).error, /must be/);
  }
});
