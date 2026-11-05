// The request handler: who is asking → sign-in (every visitor, this PC included: admin or team) → dev hooks → API
// → website files. A team login sees everything except the Fund Scorecard: its settings API is refused here, and
// the website hides the tab (it asks /api/whoami).
import { writeFile } from "node:fs/promises";
import { LIMITS, TEST_RESULTS_FILE } from "./config.js";
import { readBody, sendJson, sendText } from "./lib/http.js";
import { log } from "./lib/logger.js";
import { clientAddress, isLoopback, isPrivateAddress } from "./lib/network.js";
import { handleApi } from "./routes/api.js";
import { serveStatic } from "./routes/static.js";
import { ROLES, teamGate } from "./routes/team-auth.js";

export async function handleRequest(req, res) {
  try {
    const client = clientAddress(req);
    const isLocalPc = isLoopback(client);
    if (!isLocalPc && !isPrivateAddress(client)) return sendText(res, 403, "Forbidden");

    const url = new URL(req.url, "http://localhost");
    const ctx = { req, res, client, isLocalPc, role: null, pathname: url.pathname, query: url.searchParams };

    // Nothing but the sign-in page opens before a correct ID + password, on this PC too.
    if (await teamGate(ctx)) return;

    // Who is signed in, for the website (which tabs to show; the sign-out button).
    if (req.method === "GET" && ctx.pathname === "/api/whoami") return sendJson(res, 200, { role: ctx.role, signedIn: true });
    if (ctx.role !== ROLES.ADMIN && ctx.pathname.startsWith("/api/scorecard-settings")) {
      return sendJson(res, 403, { error: "The Fund Scorecard is available to the admin login only" });
    }

    // Dev-only (this PC, signed in): test pages POST their result text here so headless runs can read it.
    if (isLocalPc && req.method === "POST" && ctx.pathname === "/__test-results") {
      await writeFile(TEST_RESULTS_FILE, await readBody(req, LIMITS.testResultsBody), "utf8");
      return sendText(res, 200, "ok");
    }

    if (await handleApi(ctx)) return;
    if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Method not allowed");
    await serveStatic(ctx);
  } catch (error) {
    log(`request failed: ${error.message}`);
    if (!res.headersSent) sendText(res, 500, "Server error");
    else res.destroy();
  }
}
