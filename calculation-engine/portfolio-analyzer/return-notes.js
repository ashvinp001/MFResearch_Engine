/**
 * Notes for funds with no trailing return in any time frame (MF_Calculation_Engine.md E15.5.11).
 *
 * returnNotes(portfolio, fundData) → [{ schemeName, isin, reason, kind }]
 *   Only ACTIVE holdings whose 1Y, 3Y AND 5Y returns are all missing are listed, each with the reason,
 *   so a "—" in the report is never mistaken for a bug. kind ∈ young · notListed · noHistory · noRecentNav · unavailable.
 */

import { VALUATION_REASON } from "./revalue.js";

const STALE_DAYS = 31;

const dateText = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export function returnNotes(portfolio, fundData) {
  const notes = [];
  for (const holding of portfolio.holdings) {
    if (holding.status !== "active") continue;
    const info = fundData?.funds?.[holding.isin] ?? null;
    const r = info?.returns;
    if (r && [r.r1y, r.r3y, r.r5y].some((v) => Number.isFinite(v))) continue;
    notes.push({ schemeName: holding.schemeName, isin: holding.isin, ...reasonFor(holding, info, fundData) });
  }
  return notes;
}

function reasonFor(holding, info, fundData) {
  if (holding.valuation?.reason === VALUATION_REASON.NOT_MAPPED) {
    return { kind: "notListed", reason: "Not in the AMFI Growth fund list (for example an IDCW plan), so no NAV history is collected; the statement's value is used." };
  }
  if (!fundData) return { kind: "unavailable", reason: "NAV history could not be loaded when the report was prepared." };
  if (!info) return { kind: "noHistory", reason: "No NAV history is stored for this fund yet." };
  const asOf = fundData.asOf;
  if (info.navDate && asOf && (Date.parse(asOf) - Date.parse(info.navDate)) / 86400000 > STALE_DAYS) {
    return { kind: "noRecentNav", reason: `No recent NAV — the latest NAV published is from ${dateText(info.navDate)}.` };
  }
  if (info.sinceLaunch) {
    return {
      kind: "young",
      reason: `Launched on ${dateText(info.sinceLaunch.from)} — under a year of NAV history, so 1Y, 3Y and 5Y returns are not shown (never estimated). Return since launch: ${info.sinceLaunch.pct >= 0 ? "+" : ""}${info.sinceLaunch.pct.toFixed(2)}%.`,
    };
  }
  return { kind: "noHistory", reason: "Too little NAV history to calculate a return." };
}
