/**
 * Portfolio Snapshot (one-pager) — every number on the factsheet.
 *
 * Input:  a validated portfolio; fundData from market/fund-data-provider.js (null until Phase 2);
 *         options { topN } — funds listed individually before "Other holdings"
 *         (default: every active holding is listed, so there is no "Other" row).
 * Holdings with zero closing units (redeemed) are never listed.
 * Output: {
 *   asOf, fundCount, amcCount,
 *   totals:   { value, invested, gain, gainPct },          // gainPct as a % (e.g. -0.19)
 *   holdings: { rows: [Row], other: Row|null, total: Row }  // Row = { name, isin, weightPct, invested, current, profit }
 *   amcAllocation: [ { amc, pct } ],                       // % of current value, largest first
 *   composition, sectors, marketCap, trailingReturns, averageEdge, risk, benchmarkName, coverage  // null without fundData
 * }
 * Money is summed in integer paise from the printed CAS values; weights come from
 * those exact sums. Fund-level analytics are passed through untouched — never estimated here.
 */

import { toPaise } from "../cas/parse-values.js";

const DEFAULT_TOP_N = Infinity;

function row(name, isin, investedPaise, currentPaise, totalPaise) {
  return {
    name,
    isin,
    weightPct: totalPaise ? (currentPaise / totalPaise) * 100 : 0,
    invested: investedPaise === null ? null : investedPaise / 100,
    current: currentPaise / 100,
    profit: investedPaise === null ? null : (currentPaise - investedPaise) / 100,
  };
}

export function buildSnapshot(portfolio, fundData = null, { topN = DEFAULT_TOP_N } = {}) {
  const active = portfolio.holdings
    .filter((holding) => holding.status === "active" && toPaise(holding.raw.marketValue) !== null)
    .map((holding) => ({
      holding,
      current: toPaise(holding.raw.marketValue),
      invested: toPaise(holding.raw.costValue),
    }))
    .sort((p, q) => q.current - p.current || (p.holding.schemeName ?? "").localeCompare(q.holding.schemeName ?? ""));

  const totalCurrent = active.reduce((sum, item) => sum + item.current, 0);
  const allCosted = active.every((item) => item.invested !== null);
  const totalInvested = allCosted ? active.reduce((sum, item) => sum + item.invested, 0) : null;

  const listed = active.length > topN + 1 ? active.slice(0, topN) : active;
  const rest = active.length > topN + 1 ? active.slice(topN) : [];
  const restInvested = rest.every((item) => item.invested !== null) ? rest.reduce((sum, item) => sum + item.invested, 0) : null;

  const amcTotals = new Map();
  for (const item of active) {
    const amc = item.holding.amc ?? "Unspecified AMC";
    amcTotals.set(amc, (amcTotals.get(amc) ?? 0) + item.current);
  }
  const amcAllocation = [...amcTotals.entries()]
    .map(([amc, paise]) => ({ amc, pct: totalCurrent ? (paise / totalCurrent) * 100 : 0 }))
    .sort((p, q) => q.pct - p.pct || p.amc.localeCompare(q.amc));

  const returns = fundData?.trailingReturns ?? null;
  const averageEdge = returns?.length
    ? returns.reduce((sum, r) => sum + (r.portfolio - r.benchmark), 0) / returns.length
    : null;

  return {
    asOf: portfolio.source.statementAsOf ?? portfolio.source.statementPeriod.to,
    fundCount: active.length,
    amcCount: new Set(active.map((item) => item.holding.amc).filter(Boolean)).size,
    totals: {
      value: totalCurrent / 100,
      invested: totalInvested === null ? null : totalInvested / 100,
      gain: totalInvested === null ? null : (totalCurrent - totalInvested) / 100,
      gainPct: totalInvested ? ((totalCurrent - totalInvested) / totalInvested) * 100 : null,
    },
    holdings: {
      rows: listed.map((item) => row(item.holding.schemeName ?? item.holding.isin, item.holding.isin, item.invested, item.current, totalCurrent)),
      other: rest.length ? row(`Other holdings`, null, restInvested, rest.reduce((sum, item) => sum + item.current, 0), totalCurrent) : null,
      otherCount: rest.length,
      total: row("Total Portfolio", null, totalInvested, totalCurrent, totalCurrent),
    },
    amcAllocation,
    benchmarkName: fundData?.benchmarkName ?? null,
    composition: fundData?.composition ?? null,
    sectors: fundData?.sectors ?? null,
    marketCap: fundData?.marketCap ?? null,
    trailingReturns: returns,
    averageEdge,
    risk: fundData?.risk ?? null,
    coverage: fundData?.coverage ?? null,
  };
}
