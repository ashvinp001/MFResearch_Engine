/**
 * ISIN → scheme identity (MF_Calculation_Engine.md E15.4).
 *
 *  buildSchemeMap(lists) → SchemeMap
 *      lists = the parsed files from data/schemes/ (regular.json, direct.json, etf.json), each
 *      { plan, dataAsOf, count, schemes: [{ schemeCode, schemeName, amc, assetClass, category,
 *        isin, isinReinvest, active }] }. Throws SchemeMapError when a file is malformed, a
 *      count is wrong, or one ISIN / scheme code appears twice — a lookup is never ambiguous.
 *  SchemeMap.byIsin(isin) → { schemeCode, schemeName, amc, assetClass, category, plan, active,
 *      matchedOn: "isin" | "isinReinvest" } | null
 *  mapHoldings(holdings, schemeMap) → { matched: [{ holding, scheme }], unmatched: [{ holding, reason }] }
 *      The scheme code is the key used to fetch fund data from the database. Matching is by
 *      ISIN only — never by name; an unmatched holding is reported with a plain reason.
 */

import { isValidIsin } from "./isin.js";

export class SchemeMapError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemeMapError";
  }
}

export const UNMATCHED_REASON = Object.freeze({
  NO_ISIN: "The statement prints no valid ISIN for this fund.",
  IDCW_PLAN: "IDCW / dividend plan — the fund list holds Growth plans only.",
  NOT_LISTED: "This ISIN is not in the AMFI fund list (closed, merged, or outside the list).",
});

const PLANS = new Set(["Regular", "Direct", "ETF"]);
const IDCW_RE = /\b(idcw|dividend|payout|reinvest(ment)?|bonus)\b/i;

export function buildSchemeMap(lists) {
  if (!Array.isArray(lists) || lists.length === 0) throw new SchemeMapError("No scheme lists given.");
  const byIsin = new Map();
  const codes = new Set();
  const dates = new Set();

  for (const list of lists) {
    if (!PLANS.has(list?.plan) || !Array.isArray(list.schemes)) {
      throw new SchemeMapError(`Scheme list "${list?.plan}" is not in the expected format.`);
    }
    if (list.schemes.length !== list.count) {
      throw new SchemeMapError(`${list.plan} list says ${list.count} schemes but holds ${list.schemes.length}.`);
    }
    dates.add(list.dataAsOf);
    for (const scheme of list.schemes) {
      if (codes.has(scheme.schemeCode)) throw new SchemeMapError(`Scheme code ${scheme.schemeCode} appears twice.`);
      codes.add(scheme.schemeCode);
      const entry = Object.freeze({
        schemeCode: scheme.schemeCode, schemeName: scheme.schemeName, amc: scheme.amc,
        assetClass: scheme.assetClass, category: scheme.category, plan: list.plan, active: scheme.active,
      });
      addIsin(byIsin, scheme.isin, entry, "isin");
      addIsin(byIsin, scheme.isinReinvest, entry, "isinReinvest");
    }
  }

  return Object.freeze({
    size: codes.size,
    dataAsOf: [...dates].sort().at(-1) ?? null,
    byIsin(isin) {
      const hit = byIsin.get(isin);
      return hit ? { ...hit.entry, matchedOn: hit.matchedOn } : null;
    },
  });
}

function addIsin(byIsin, isin, entry, matchedOn) {
  if (isin == null) return;
  if (!isValidIsin(isin)) throw new SchemeMapError(`Scheme ${entry.schemeCode}: ISIN ${isin} fails the check digit.`);
  const existing = byIsin.get(isin);
  if (existing) {
    throw new SchemeMapError(`ISIN ${isin} belongs to both ${existing.entry.schemeCode} and ${entry.schemeCode}.`);
  }
  byIsin.set(isin, { entry, matchedOn });
}

export function mapHoldings(holdings, schemeMap) {
  const matched = [];
  const unmatched = [];
  for (const holding of holdings) {
    const scheme = isValidIsin(holding.isin) ? schemeMap.byIsin(holding.isin) : null;
    if (scheme) matched.push({ holding, scheme });
    else unmatched.push({ holding, reason: unmatchedReason(holding) });
  }
  return { matched, unmatched };
}

function unmatchedReason(holding) {
  if (!isValidIsin(holding.isin)) return UNMATCHED_REASON.NO_ISIN;
  if (IDCW_RE.test(holding.schemeName ?? "")) return UNMATCHED_REASON.IDCW_PLAN;
  return UNMATCHED_REASON.NOT_LISTED;
}
