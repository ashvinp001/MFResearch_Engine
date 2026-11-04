// The request handler: who is asking → team sign-in (other computers) → dev hooks → API → website files.
import { writeFile } from "node:fs/promises";
import { LIMITS, TEST_RESULTS_FILE } from "./config.js";
import { readBody, sendText } from "./lib/http.js";
import { log } from "./lib/logger.js";
import { clientAddress, isLoopback, isPrivateAddress } from "./lib/network.js";
import { handleApi } from "./routes/api.js";
import { serveStatic } from "./routes/static.js";
import { teamGate } from "./routes/team-auth.js";

export async function handleRequest(req, res) {
  try {
    const client = clientAddress(req);
    const isLocalPc = isLoopback(client);
    if (!isLocalPc && !isPrivateAddress(client)) return sendText(res, 403, "Forbidden");

    const url = new URL(req.url, "http://localhost");
    const ctx = { req, res, client, isLocalPc, pathname: url.pathname, query: url.searchParams };

    if (!isLocalPc && (await teamGate(ctx))) return;

    // Dev-only (this PC only): test pages POST their result text here so headless runs can read it.
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
