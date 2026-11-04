// One line per event in %LOCALAPPDATA%\Prosperr\logs\serve.log. Logging never stops the server.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { LOG_FILE } from "../config.js";

try { mkdirSync(path.dirname(LOG_FILE), { recursive: true }); } catch { /* best effort */ }

export function log(text) {
  const now = new Date();
  const stamp = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);   // local time
  try { appendFileSync(LOG_FILE, `${stamp} ${text}\n`, "utf8"); } catch { /* best effort */ }
}
