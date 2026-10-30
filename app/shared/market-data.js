/**
 * Market data for the app — the AMFI fund lists (data/schemes/) and the latest NAV of every fund
 * (GET /api/latest-nav: the local server reads it from Supabase; no key ever reaches the browser).
 *
 * loadValuationData() → Promise<{ schemeMap, latestNavs, schemes } | { error }>   schemes: every listed fund (with plan)
 * Loaded once per page visit and shared. Never throws: when the data cannot be loaded the caller
 * keeps the statement's own values and shows the reason.
 * loadNavHistories(codes, { years }) → Promise<{ histories, missing } | { error }>   (GET /api/nav-history; years 1–20, default 5)
 * loadFundHoldings(isins) / loadPeerStats(codes) → data | null                (PulseDB holdings / peer statistics)
 */

import { buildSchemeMap, navSeries } from "../../calculation-engine/index.js";

const LIST_FILES = ["regular", "direct", "etf"];
let pending = null;

/** "&years=N" for the history endpoints (1–20 years; default 5 when omitted). */
const yearsParam = (years) => (Number.isInteger(years) && years >= 1 && years <= 20 ? `&years=${years}` : "");

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.json();
}

export function loadValuationData() {
  pending ??= (async () => {
    try {
      const base = new URL("../../data/schemes/", import.meta.url);
      const [lists, latestNavs] = await Promise.all([
        Promise.all(LIST_FILES.map((name) => fetchJson(new URL(`${name}.json`, base)))),
        fetchJson("/api/latest-nav"),
      ]);
      const schemes = lists.flatMap((list) => list.schemes.map((scheme) => ({ ...scheme, plan: list.plan })));
      return { schemeMap: buildSchemeMap(lists), latestNavs, schemes };
    } catch (error) {
      pending = null; // try again on the next upload
      return { error: error.message };
    }
  })();
  return pending;
}

/**
 * Each fund's latest disclosed holdings (PulseDB via GET /api/fund-holdings), in the engine's holdings
 * contract → { [isin]: { asOn, holdings: [...] } } | null when unavailable. Never throws.
 */
export async function loadFundHoldings(isins) {
  const unique = [...new Set(isins)].filter((isin) => /^IN[A-Z0-9]{9}[0-9]$/.test(isin ?? "")).sort();
  if (!unique.length) return null;
  // One retry after a short pause: a momentary failure (PulseDB or the local server busy) must not leave the
  // Composition, Top sectors and Market cap sections empty.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const funds = {};
      for (let i = 0; i < unique.length; i += 80) {
        const body = await fetchJson(`/api/fund-holdings?isins=${unique.slice(i, i + 80).join(",")}`);
        Object.assign(funds, body.funds ?? {});
      }
      return funds;
    } catch {
      if (attempt === 2) return null;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  return null;
}

/**
 * Peer-group statistics for the automatic Invest / Hold / Sell (GET /api/peer-stats, computed daily by
 * data-pipeline/peer_stats.py) → { asOf, generatedAt, method, funds, groups } | null when unavailable. Never throws.
 */
export async function loadPeerStats(codes) {
  const unique = [...new Set(codes)].filter((code) => Number.isInteger(code) && code > 0).sort((a, b) => a - b);
  if (!unique.length) return null;
  try {
    let out = null;
    for (let i = 0; i < unique.length; i += 80) {
      const body = await fetchJson(`/api/peer-stats?codes=${unique.slice(i, i + 80).join(",")}`);
      out = out ? { ...out, funds: { ...out.funds, ...body.funds }, groups: { ...out.groups, ...body.groups } } : body;
    }
    return out?.asOf ? out : null;
  } catch {
    return null;
  }
}

/**
 * Fund details from PulseDB, stored daily (GET /api/fund-metadata) → { generatedAt, funds: { [code]: { aum (₹ crore),
 * inception, manager, riskometer, exitLoad } } } | null. Never throws.
 */
export async function loadFundMetadata(codes) {
  const unique = [...new Set(codes)].filter((code) => Number.isInteger(code) && code > 0).sort((a, b) => a - b);
  if (!unique.length) return null;
  try {
    let out = null;
    for (let i = 0; i < unique.length; i += 400) {
      const body = await fetchJson(`/api/fund-metadata?codes=${unique.slice(i, i + 400).join(",")}`);
      out = out ? { ...out, funds: { ...out.funds, ...body.funds } } : body;
    }
    return out?.funds ? out : null;
  } catch {
    return null;
  }
}

/** Fund Scorecard owner settings (GET /api/scorecard-settings) → { canEdit, passwordSet, settings } | null. Never throws. */
export async function loadScorecardSettings() {
  try {
    return await fetchJson("/api/scorecard-settings");
  } catch {
    return null;
  }
}

/** Checks the scorecard edit password (POST, owner's PC only) → { ok: true } | { error }. The password is not kept. */
export async function verifyScorecardPassword(password) {
  try {
    const response = await fetch("/api/scorecard-settings/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const body = await response.json().catch(() => ({}));
    return response.ok && body.ok ? { ok: true } : { error: body.error ?? `HTTP ${response.status}` };
  } catch (error) {
    return { error: error.message };
  }
}

/** Creates the scorecard edit password while none is set (POST, owner's PC only; it is final once set) → { ok } | { error }. */
export async function setScorecardPassword({ password, confirm }) {
  try {
    const response = await fetch("/api/scorecard-settings/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, confirm }) });
    const body = await response.json().catch(() => ({}));
    return response.ok && body.ok ? { ok: true } : { error: body.error ?? `HTTP ${response.status}` };
  } catch (error) {
    return { error: error.message };
  }
}

/** Saves the owner's scorecard settings with the edit password (POST, owner's PC only) → { settings } | { error }. */
export async function saveScorecardSettings(settings, password) {
  try {
    const response = await fetch("/api/scorecard-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, password }) });
    const body = await response.json().catch(() => ({}));
    return response.ok ? { settings: body } : { error: body.error ?? `HTTP ${response.status}` };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Daily benchmark prices (last 5 years) for these benchmark codes (GET /api/benchmark-history): Pulse's, and
 * our own (SBGOLD, SBGS, SB<pulse code> — data-pipeline/benchmark_blends.py)
 * → { [code]: { name, series } } | null when unavailable. Never throws.
 */
const BENCHMARK_CODE = /^((OB|OHB|AB|AHB|AUB)\d{1,5}|SB(GOLD|GS|(OB|OHB|AB|AHB|AUB)\d{1,5}))$/;
export async function loadBenchmarkHistories(codes, { years = null } = {}) {
  const unique = [...new Set(codes)].filter((code) => BENCHMARK_CODE.test(code ?? "")).sort();
  if (!unique.length) return {};
  try {
    const out = {};
    for (let i = 0; i < unique.length; i += 80) {
      const body = await fetchJson(`/api/benchmark-history?codes=${unique.slice(i, i + 80).join(",")}${yearsParam(years)}`);
      for (const [code, s] of Object.entries(body.series ?? {})) out[code] = { name: s.name, series: navSeries({ dates: s.dates, navs: s.values }) };
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Daily NAV history (last 5 years) for these AMFI scheme codes → { histories: { [code]: navSeries }, missing } | { error }.
 * Never throws.
 */
export async function loadNavHistories(codes, { years = null } = {}) {
  const unique = [...new Set(codes)].filter((code) => Number.isInteger(code) && code > 0).sort((a, b) => a - b);
  if (!unique.length) return { histories: {}, missing: [] };
  try {
    const histories = {};
    const missing = [];
    for (let i = 0; i < unique.length; i += 80) {   // the server accepts up to 80 codes per request
      const body = await fetchJson(`/api/nav-history?codes=${unique.slice(i, i + 80).join(",")}${yearsParam(years)}`);
      for (const [code, series] of Object.entries(body.series ?? {})) histories[code] = navSeries(series);
      missing.push(...(body.missing ?? []));
    }
    return { histories, missing };
  } catch (error) {
    return { error: error.message };
  }
}
