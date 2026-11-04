// Reads .env (KEY=value lines). Read on every call so a changed value applies without a restart.
import { readFileSync } from "node:fs";
import { ENV_FILE } from "../config.js";

export function readEnv(file = ENV_FILE) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return {}; }
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) values[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return values;
}
