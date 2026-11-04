// /api/* — market data for the website. Each route validates its input, then asks the Python data
// pipeline (which reads Supabase / PulseDB with the keys in .env); the browser never sees a key.
import { readEnv } from "../lib/env.js";
import { BodyTooLarge, readBody, sendJson } from "../lib/http.js";
import { log } from "../lib/logger.js";
import { runPipeline } from "../lib/python.js";
import { LIMITS } from "../config.js";

const YEARS = /^([1-9]|1\d|20)$/;
const SCHEME_CODES = (max) => new RegExp(`^\\d{1,7}(,\\d{1,7}){0,${max - 1}}$`);
const BENCH = "((OB|OHB|AB|AHB|AUB)\\d{1,5}|SB(GOLD|GS|(OB|OHB|AB|AHB|AUB)\\d{1,5}))";
const BENCH_CODES = new RegExp(`^${BENCH}(,${BENCH}){0,79}$`);
const ISINS = /^IN[A-Z0-9]{9}[0-9](,IN[A-Z0-9]{9}[0-9]){0,79}$/;

// A GET route that passes a validated list (and optional years) to a pipeline script.
function listRoute({ param, pattern, script, years = false, upper = false, invalid, unavailable }) {
  return async ({ res, query }) => {
    let list = query.get(param) ?? "";
    if (upper) list = list.toUpperCase();
    const y = years ? query.get("years") ?? "" : "";
    if (!pattern.test(list) || (y && !YEARS.test(y))) return sendJson(res, 400, { error: invalid });
    try {
      const { stdout } = await runPipeline(script, [...(y ? [`--years=${y}`] : []), ...list.split(",")]);
      if (!stdout) throw new Error(`${script} returned nothing`);
      sendJson(res, 200, stdout);
    } catch (error) {
      log(`${script}: ${error.message}`);
      sendJson(res, 503, { error: unavailable });
    }
  };
}

const codesError = "codes must be a comma-separated list of scheme codes";

// GET /api/latest-nav -> nav/latest.json from the private Supabase bucket. Cached 10 minutes.
const navCache = { body: null, at: 0 };
async function latestNav({ res }) {
  try {
    if (!navCache.body || Date.now() - navCache.at >= LIMITS.latestNavCacheMs) {
      const env = readEnv();
      const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
      const key = env.SUPABASE_SERVICE_KEY;
      const bucket = env.SUPABASE_BUCKET || "mf-data";
      if (!url.startsWith("https://") || !key) throw new Error("Supabase is not configured in .env");
      const headers = { apikey: key };
      if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
      // A unique query string: Supabase's CDN can otherwise serve an earlier copy of the overwritten file.
      const response = await fetch(`${url}/storage/v1/object/authenticated/${bucket}/nav/latest.json?fresh=${Date.now()}`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Supabase answered ${response.status}`);
      navCache.body = Buffer.from(await response.arrayBuffer());
      navCache.at = Date.now();
    }
    sendJson(res, 200, navCache.body);
  } catch (error) {
    log(`latest-nav: ${error.message}`);
    sendJson(res, 503, { error: "Latest NAVs are not available right now" });
  }
}

// /api/scorecard-settings — GET: anyone (the reply says whether this visitor may edit). POST save, /verify and
// /password: this PC (the owner) only, and the pipeline script also checks the edit password.
const SETTINGS_COMMANDS = {
  "/api/scorecard-settings": "set",
  "/api/scorecard-settings/verify": "verify",
  "/api/scorecard-settings/password": "password",
};
async function scorecardSettings({ req, res, pathname, isLocalPc }) {
  try {
    if (req.method === "GET" && pathname === "/api/scorecard-settings") {
      const { stdout } = await runPipeline("scorecard_settings.py", ["get", `--can-edit=${isLocalPc}`]);
      if (!stdout) throw new Error("scorecard_settings get returned nothing");
      return sendJson(res, 200, stdout);
    }
    if (req.method !== "POST" || !isLocalPc) {
      return sendJson(res, 403, { error: "Only the owner can change the scorecard settings" });
    }
    const body = await readBody(req, LIMITS.settingsBody);
    const command = SETTINGS_COMMANDS[pathname];
    const { stdout, code } = await runPipeline("scorecard_settings.py", [command], { input: body, allowFailure: true });
    if (!stdout) throw new Error(`scorecard_settings ${command} returned nothing`);
    sendJson(res, code === 0 ? 200 : 400, stdout);
  } catch (error) {
    if (error instanceof BodyTooLarge) return sendJson(res, 403, { error: "Only the owner can change the scorecard settings" });
    log(`scorecard-settings: ${error.message}`);
    sendJson(res, 503, { error: "Scorecard settings are not available right now" });
  }
}

const GET_ROUTES = {
  "/api/nav-history": listRoute({
    param: "codes", pattern: SCHEME_CODES(80), script: "nav_api.py", years: true,
    invalid: codesError, unavailable: "NAV history is not available right now",
  }),
  "/api/benchmark-history": listRoute({
    param: "codes", pattern: BENCH_CODES, script: "benchmark_api.py", years: true,
    invalid: "codes must be a comma-separated list of benchmark codes", unavailable: "Benchmark history is not available right now",
  }),
  "/api/peer-stats": listRoute({
    param: "codes", pattern: SCHEME_CODES(80), script: "peer_stats_api.py",
    invalid: codesError, unavailable: "Peer statistics are not available right now",
  }),
  "/api/fund-metadata": listRoute({
    param: "codes", pattern: SCHEME_CODES(400), script: "fund_metadata_api.py",
    invalid: codesError, unavailable: "Fund details are not available right now",
  }),
  "/api/fund-holdings": listRoute({
    param: "isins", pattern: ISINS, script: "holdings_api.py", upper: true,
    invalid: "isins must be a comma-separated list of ISINs", unavailable: "Fund holdings are not available right now",
  }),
  "/api/latest-nav": latestNav,
};

// Optional routes kept out of the repository (the research assistant, assistant-routes.js): used when the file is
// present; the site runs the same without it.
const OPTIONAL_ROUTES = await import("./assistant-routes.js").then((m) => m.ROUTES).catch((error) => {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") log(`assistant routes not loaded: ${error.message}`);
  return {};
});

/** Handles the request when it is an API route; returns false otherwise. */
export async function handleApi(ctx) {
  const { req, pathname } = ctx;
  if (pathname in SETTINGS_COMMANDS) { await scorecardSettings(ctx); return true; }
  const route = req.method === "GET" ? GET_ROUTES[pathname] ?? OPTIONAL_ROUTES[pathname] : undefined;
  if (!route) return false;
  await route(ctx);
  return true;
}
