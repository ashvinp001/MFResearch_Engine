// Server settings in one place. Secrets (Supabase key, site password) are never here: they are read
// from .env at request time (lib/env.js), so editing .env needs no restart.
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PIPELINE_DIR = path.join(ROOT, "data-pipeline");
export const ENV_FILE = path.join(ROOT, ".env");
export const LOGIN_PAGE = path.join(ROOT, "login.html");
export const TEST_RESULTS_FILE = path.join(ROOT, "tests", "last-results.txt");

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
export const LOG_FILE = path.join(localAppData, "Prosperr", "logs", "serve.log");

// The Python used for the data pipeline: PYTHON (environment), else the project's usual install, else PATH.
const usualPython = path.join(localAppData, "Programs", "Python", "Python312", "python.exe");
export const PYTHON = process.env.PYTHON || (existsSync(usualPython) ? usualPython : "python");

export const DEFAULT_PORT = 5173;

// What another computer on the network may open (everything else answers 404 for them).
export const LAN_ALLOWED =
  /^(index\.html|app\/.+\.js|design-system\/.+\.(js|css)|calculation-engine\/.+\.js|assets\/[^/]+\.(png|svg|ico)|data\/schemes\/[a-z]+\.json)$/;
// Never served to anyone: dot-files (.env, .git), the data pipeline, the server, owner settings, local-only notes.
export const PRIVATE_PATH =
  /(^|\/)\.|^(data-pipeline|server|node_modules|config)(\/|$)|^(CLAUDE\.md|package(-lock)?\.json)$/i;

export const TEAM = {
  sessionHours: 12,
  maxFailures: 5,
  failureWindowMinutes: 10,
  wrongPasswordDelayMs: 800,
};

export const LIMITS = {
  loginBody: 2048,
  settingsBody: 4096,
  testResultsBody: 5 * 1024 * 1024,
  pythonTimeoutMs: 180_000,
  pythonOutput: 256 * 1024 * 1024,
  pythonConcurrency: 4,
  latestNavCacheMs: 10 * 60 * 1000,
};

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".md": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};
