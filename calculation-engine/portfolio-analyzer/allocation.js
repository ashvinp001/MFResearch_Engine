/**
 * Portfolio Allocation from each fund's real holdings (MF_Calculation_Engine.md E15.5.12).
 *
 * buildAllocation({ portfolio, fundHoldings }) → {
 *   composition: { equity, debt, goldSilver, other } | null      % of the portfolio's covered value
 *   marketCap:   { large, mid, small } | null                    % of domestic equity
 *   sectors:     [{ sector, pct }] | null                        % of equity, largest first
 *   funds:       { [isin]: { marketCap: { large, mid, small } | null, assetMix } }
 *   coverage:    { value, funds, total, asOn }                    share of value with holdings data
 * }
 *
 * fundHoldings (from the holdings provider — PulseDB — normalised to this contract):
 *   { [isin]: { asOn: "YYYY-MM", holdings: [{ name, isin?, assetType, sector?, marketCap?, weight }] } }
 *     assetType ∈ equity | foreignEquity | debt | cash | gold | silver | reit | other
 *     marketCap ∈ large | mid | small (domestic equity: SEBI/AMFI half-yearly list, ranks 1–100 / 101–250 / 251+)
 *     weight    = % of the fund's net assets (as disclosed)
 *
 * Rules:
 *  1. A fund's weights are used only when they add up to 100% ± WEIGHT_TOLERANCE (disclosures round);
 *     within that band they are scaled to exactly 100%. Outside it the fund counts as "no data".
 *  2. Each fund counts with its CURRENT VALUE (latest NAV, E15.5.8):  part = value × weight / 100.
 *  3. composition — equity = equity + foreignEquity; debt = debt + cash (cash, TREPS, T-bills);
 *     goldSilver = gold + silver; other = REITs / InvITs / anything else.
 *  4. marketCap — over DOMESTIC equity only: large % = Σ value × w(large) / Σ value × w(domestic equity).
 *     Domestic equity without a market-cap class is reported in coverage, never guessed.
 *  5. sectors — over all equity, Σ value × w(sector) / Σ value × w(equity), ranked; no sector → "Unclassified".
 *  6. Per fund: its own large / mid / small split of its domestic equity, and its asset mix.
 *  7. A portfolio figure is shown only when funds with holdings data hold ≥ minValueCoverage (80%)
 *     of the portfolio's current value; otherwise null ("—"). Funds of funds are passed through by the
 *     provider (their underlying holdings, weighted), so they follow the same rules.
 */

import { PORTFOLIO_ANALYTICS } from "../config.js";
import { toPaise } from "../cas/parse-values.js";

export const WEIGHT_TOLERANCE = 2;   // percentage points
const GROUP = { equity: "equity", foreignEquity: "equity", debt: "debt", cash: "debt", gold: "goldSilver", silver: "goldSilver", reit: "other", other: "other" };
const round2 = (x) => Math.round(x * 100) / 100;

/** The fund's holdings scaled to exactly 100%, or null when the disclosed weights do not add up. */
export function normalisedHoldings(entry) {
  // Signed weights: small negatives (net payables, hedges) are kept so the split is net, as disclosed.
  const rows = (entry?.holdings ?? []).filter((r) => Number.isFinite(r.weight) && r.weight !== 0 && GROUP[r.assetType]);
  const total = rows.reduce((s, r) => s + r.weight, 0);
  if (!rows.length || Math.abs(total - 100) > WEIGHT_TOLERANCE) return null;
  return rows.map((r) => ({ ...r, weight: (r.weight / total) * 100 }));
}

function split(parts) {
  const total = Object.values(parts).reduce((s, v) => s + v, 0);
  if (!(total > 0)) return null;
  return Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round2((v / total) * 100)]));
}

export function buildAllocation({ portfolio, fundHoldings }) {
  const active = portfolio.holdings.filter((h) => h.status === "active");
  const totalValue = active.reduce((s, h) => s + (toPaise(h.raw.marketValue) ?? 0), 0) / 100;
  const asset = { equity: 0, debt: 0, goldSilver: 0, other: 0 };
  const cap = { large: 0, mid: 0, small: 0 };
  const sectors = new Map();
  let equityValue = 0, coveredValue = 0, coveredFunds = 0, unclassifiedCap = 0;
  const asOn = new Set();
  const funds = {};

  for (const holding of active) {
    const value = (toPaise(holding.raw.marketValue) ?? 0) / 100;
    const rows = normalisedHoldings(fundHoldings?.[holding.isin]);
    if (!rows || !(value > 0)) continue;
    coveredValue += value;
    coveredFunds += 1;
    if (fundHoldings[holding.isin].asOn) asOn.add(fundHoldings[holding.isin].asOn);

    const fundAsset = { equity: 0, debt: 0, goldSilver: 0, other: 0 };
    const fundCap = { large: 0, mid: 0, small: 0 };
    for (const r of rows) {
      const part = (value * r.weight) / 100;
      asset[GROUP[r.assetType]] += part;
      fundAsset[GROUP[r.assetType]] += r.weight;
      if (GROUP[r.assetType] !== "equity") continue;
      equityValue += part;
      const sector = r.sector?.trim() || "Unclassified";
      sectors.set(sector, (sectors.get(sector) ?? 0) + part);
      if (r.assetType === "equity") {
        if (cap[r.marketCap] !== undefined) { cap[r.marketCap] += part; fundCap[r.marketCap] += r.weight; }
        else unclassifiedCap += part;
      }
    }
    funds[holding.isin] = { assetMix: split(fundAsset), marketCap: split(fundCap) };
  }

  const coverage = { value: totalValue ? coveredValue / totalValue : 0, funds: coveredFunds, total: active.length, asOn: [...asOn].sort().at(-1) ?? null, equityWithoutCapClass: equityValue ? unclassifiedCap / equityValue : 0 };
  const enough = coverage.value >= PORTFOLIO_ANALYTICS.minValueCoverage;
  return {
    composition: enough ? split(asset) : null,
    marketCap: enough ? split(cap) : null,
    sectors: enough && equityValue > 0
      ? [...sectors.entries()].map(([sector, v]) => ({ sector, pct: round2((v / equityValue) * 100) })).sort((a, b) => b.pct - a.pct || a.sector.localeCompare(b.sector))
      : null,
    funds,
    coverage,
  };
}

/** Merge an allocation into FundData (the shape the screens and PDFs read). */
export function withAllocation(fundData, allocation) {
  if (!allocation) return fundData;
  const funds = { ...(fundData?.funds ?? {}) };
  for (const [isin, info] of Object.entries(allocation.funds)) funds[isin] = { ...(funds[isin] ?? {}), marketCap: info.marketCap, assetMix: info.assetMix };
  return {
    ...(fundData ?? {}),
    composition: allocation.composition ? { equity: allocation.composition.equity, debt: allocation.composition.debt, goldSilver: allocation.composition.goldSilver, other: allocation.composition.other } : null,
    marketCap: allocation.marketCap,
    sectors: allocation.sectors,
    allocationCoverage: allocation.coverage,
    funds,
  };
}
