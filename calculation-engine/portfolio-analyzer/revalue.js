/**
 * Current value at the latest NAV (MF_Calculation_Engine.md E15.5.8).
 *
 * revalueAtLatestNav(portfolio, { schemeMap, latestNavs }) → { portfolio, valuation }
 *   schemeMap  = buildSchemeMap(data/schemes lists)         ISIN → AMFI scheme code
 *   latestNavs = nav/latest.json { asOf, navs: { "<scheme code>": { date: "YYYY-MM-DD", nav: "90.354600" } } }
 *
 * For every ACTIVE holding whose ISIN maps to a scheme with a latest NAV dated AFTER the statement's
 * NAV date: value = units × latest NAV, computed exactly (integers, no floating point) and rounded
 * half-up to the paisa. The holding then carries the latest NAV, its date and that value; the
 * statement's own NAV / date / value move to holding.statement. Every other holding keeps the
 * statement figures, with the reason in holding.valuation.
 *
 * Runs AFTER validation, so the statement checks always compare the figures as printed.
 * valuation = { asOf, latest, statement, reasons: [{ schemeName, reason }] } — asOf is the latest
 * NAV date used (null when no holding was revalued).
 */

import { isValidIsin } from "../identity/isin.js";

export const VALUATION_SOURCE = Object.freeze({ LATEST_NAV: "latest-nav", STATEMENT: "statement" });

export const VALUATION_REASON = Object.freeze({
  NOT_ACTIVE: "Redeemed — no units held.",
  NO_UNITS: "The statement prints no unit balance.",
  NOT_MAPPED: "Not in the AMFI fund list (e.g. an IDCW plan), so the statement value is used.",
  NO_LATEST_NAV: "No latest NAV stored for this fund yet, so the statement value is used.",
  STATEMENT_NEWER: "The statement's NAV is as recent as the latest stored NAV.",
});

export function revalueAtLatestNav(portfolio, { schemeMap, latestNavs }) {
  const navs = latestNavs?.navs ?? {};
  const reasons = [];
  let latest = 0;
  let asOf = null;

  const holdings = portfolio.holdings.map((holding) => {
    const reason = skipReason(holding, schemeMap, navs);
    if (reason) {
      if (holding.status === "active") reasons.push({ schemeName: holding.schemeName, reason });
      return { ...holding, valuation: { source: VALUATION_SOURCE.STATEMENT, reason } };
    }
    const scheme = schemeMap.byIsin(holding.isin);
    const point = navs[String(scheme.schemeCode)];
    const paise = multiplyToPaise(holding.raw.units, point.nav);
    if (paise === null) {
      reasons.push({ schemeName: holding.schemeName, reason: VALUATION_REASON.NO_UNITS });
      return { ...holding, valuation: { source: VALUATION_SOURCE.STATEMENT, reason: VALUATION_REASON.NO_UNITS } };
    }
    latest += 1;
    if (!asOf || point.date > asOf) asOf = point.date;
    const navText = trimNav(point.nav);
    return {
      ...holding,
      nav: Number(navText),
      navDate: point.date,
      marketValue: Number(paise) / 100,
      raw: { ...holding.raw, nav: navText, marketValue: formatPaise(paise) },
      statement: { nav: holding.nav, navDate: holding.navDate, marketValue: holding.marketValue,
                   raw: { nav: holding.raw.nav, marketValue: holding.raw.marketValue } },
      valuation: { source: VALUATION_SOURCE.LATEST_NAV, schemeCode: scheme.schemeCode, navDate: point.date },
    };
  });

  const active = holdings.filter((holding) => holding.status === "active").length;
  const valuation = { asOf, latest, statement: active - latest, reasons };
  return { portfolio: { ...portfolio, holdings, valuation }, valuation };
}

function skipReason(holding, schemeMap, navs) {
  if (holding.status !== "active") return VALUATION_REASON.NOT_ACTIVE;
  if (decimalParts(holding.raw.units) === null) return VALUATION_REASON.NO_UNITS;
  const scheme = isValidIsin(holding.isin) ? schemeMap.byIsin(holding.isin) : null;
  if (!scheme) return VALUATION_REASON.NOT_MAPPED;
  const point = navs[String(scheme.schemeCode)];
  if (!point || decimalParts(point.nav) === null || !/^\d{4}-\d{2}-\d{2}$/.test(point.date ?? "")) return VALUATION_REASON.NO_LATEST_NAV;
  if (holding.navDate && point.date <= holding.navDate) return VALUATION_REASON.STATEMENT_NEWER;
  return null;
}

/** "1,003.278" → { digits: 1003278n, scale: 3 }; null for anything that is not a plain positive number. */
function decimalParts(text) {
  if (text == null) return null;
  const clean = String(text).replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const [whole, fraction = ""] = clean.split(".");
  return { digits: BigInt(whole + fraction), scale: fraction.length };
}

/** units × NAV in paise, exact, rounded half-up. */
export function multiplyToPaise(unitsText, navText) {
  const units = decimalParts(unitsText);
  const nav = decimalParts(navText);
  if (!units || !nav) return null;
  const product = units.digits * nav.digits;      // scale = units.scale + nav.scale
  const drop = units.scale + nav.scale - 2;       // digits beyond the paisa
  if (drop <= 0) return product * 10n ** BigInt(-drop);
  const divisor = 10n ** BigInt(drop);
  return (product + divisor / 2n) / divisor;
}

/** 10875400n → "1,08,754.00" (Indian grouping, the way statements print money). */
export function formatPaise(paise) {
  const whole = (paise / 100n).toString();
  const fraction = (paise % 100n).toString().padStart(2, "0");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest ? `${rest},` : ""}${last3}.${fraction}`;
}

/** "90.354600" → "90.3546"; keeps at least two decimals ("21.730000" → "21.73"). */
function trimNav(text) {
  const [whole, fraction = ""] = String(text).split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return `${whole}.${trimmed.padEnd(2, "0")}`;
}
