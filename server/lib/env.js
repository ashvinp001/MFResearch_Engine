// Reads the settings: .env (KEY=value lines), read on every call so a changed value applies without a restart.
// In a container the secrets come as environment variables instead, and those win over the file (same rule as
// data-pipeline/settings.py). Only the keys the server uses are taken from the environment.
import { readFileSync } from "node:fs";
import { ENV_FILE } from "../config.js";

const FROM_ENVIRONMENT = /^(SUPABASE_|PULSE_|ADMIN_|TEAM_|SCORECARD_)|^SITE_PASSWORD$/;

export function readEnv(file = ENV_FILE) {
  const values = {};
  let text = null;
  try { text = readFileSync(file, "utf8"); } catch { /* no file: the environment alone */ }
  for (const line of (text ?? "").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) values[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (FROM_ENVIRONMENT.test(key) && value) values[key] = value;
  }
  return values;
}
