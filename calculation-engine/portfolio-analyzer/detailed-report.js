/**
 * Detailed Report model — every number in "Portfolio Review & Recommendation".
 *
 * Input:  { portfolio, fundData (Phase 2, may be null), verdicts { [holdingKey]: verdict }, allocation (allocatePortfolio result) }
 * Output: {
 *   asOf, fundCount, amcCount, totals, xirr,
 *   holdings: { groups: [ { key, value, weightPct, rows: [Row] } ], total },   // Row: one active holding
 *   verdictSummary: { invest|hold|sell: { count, value, share } },
 *   amcAllocation, composition, sectors, marketCap, benchmarkName,
 *   marketCapByFund: { rows: [ { name, large, mid, small } ], blended } | null,
 *   performance: [ { key, rows: [Row with returns] } ],                       // equity & gold/silver; debt excluded
 *   portfolioReturns: [ { period, portfolio, benchmark, excess } ] | null,
 *   risk, coverage,
 *   recommended: { rows: [ { name, isin, pct, amount, category, benchmark, returns } ], blended, amount, totalPct }
 * }
 * Money in integer paise from the printed CAS values. Fund analytics are passed
 * through from fundData and never estimated; missing values stay null.
 */

import { holdingKey } from "../model/portfolio.schema.js";
import { toPaise } from "../cas/parse-values.js";
import { buildSnapshot } from "./snapshot.js";

export const ASSET_GROUPS = Object.freeze(["equity", "debt", "goldSilver"]);
const PERIODS = ["r1y", "r3y", "r5y"];

const byName = (p, q) => p.name.localeCompare(q.name, "en", { sensitivity: "base" });

export function buildDetailedReport({ portfolio, fundData = null, verdicts = {}, allocation = null }) {
  const snapshot = buildSnapshot(portfolio, fundData);
  const fundInfo = (isin) => fundData?.funds?.[isin] ?? null;

  const active = portfolio.holdings.filter((holding) => holding.status === "active" && toPaise(holding.raw.marketValue) !== null);
  const totalPaise = active.reduce((sum, holding) => sum + toPaise(holding.raw.marketValue), 0);

  const rows = active.map((holding) => {
    const info = fundInfo(holding.isin);
    const current = toPaise(holding.raw.marketValue);
    const invested = toPaise(holding.raw.costValue);
    return {
      key: holdingKey(holding),
      name: holding.schemeName ?? holding.isin,
      isin: holding.isin,
      weightPct: totalPaise ? (current / totalPaise) * 100 : 0,
      unitsRaw: holding.raw.units,
      nav: holding.nav,
      invested: invested === null ? null : invested / 100,
      current: current / 100,
      profit: invested === null ? null : (current - invested) / 100,
      verdict: verdicts[holdingKey(holding)] ?? null,
      assetClass: info?.assetClass ?? null,
      category: info?.category ?? null,
      benchmark: info?.benchmark ?? null,
      returns: info?.returns ?? null,              // { r1y, r3y, r5y }
      benchmarkReturns: info?.benchmarkReturns ?? null,
      marketCap: info?.marketCap ?? null,          // { large, mid, small }
      currentPaise: current,
    };
  });

  // Group by asset class when known; otherwise one ungrouped list (key null).
  const known = rows.some((row) => row.assetClass);
  const groupKeys = known ? [...ASSET_GROUPS, null] : [null];
  const groups = groupKeys
    .map((key) => {
      const members = rows.filter((row) => (known ? (row.assetClass ?? null) === key : true)).sort(byName);
      const paise = members.reduce((sum, row) => sum + row.currentPaise, 0);
      return { key, rows: members, value: paise / 100, weightPct: totalPaise ? (paise / totalPaise) * 100 : 0 };
    })
    .filter((group) => group.rows.length);

  const equityRows = rows.filter((row) => row.assetClass === "equity" && row.marketCap).sort(byName);
  const marketCapByFund = equityRows.length
    ? {
        rows: equityRows.map((row) => ({ name: row.name, ...row.marketCap })),
        blended: snapshot.marketCap,
      }
    : null;

  const performance = (known ? ["equity", "goldSilver"] : [null])
    .map((key) => ({ key, rows: rows.filter((row) => (known ? row.assetClass === key : true)).sort(byName) }))
    .filter((group) => group.rows.length);

  // Invest / Hold / Sell totals (count, value, share of current value), summed in paise.
  const verdictSummary = {};
  for (const verdict of ["invest", "hold", "sell"]) {
    const members = rows.filter((row) => row.verdict === verdict);
    const paise = members.reduce((sum, row) => sum + row.currentPaise, 0);
    verdictSummary[verdict] = { count: members.length, value: paise / 100, share: totalPaise ? paise / totalPaise : 0 };
  }

  const portfolioReturns = snapshot.trailingReturns
    ? snapshot.trailingReturns.map((r) => ({ period: r.period, portfolio: r.portfolio, benchmark: r.benchmark, excess: r.portfolio - r.benchmark }))
    : null;

  return {
    asOf: snapshot.asOf,
    fundCount: snapshot.fundCount,
    amcCount: snapshot.amcCount,
    totals: snapshot.totals,
    xirr: fundData?.xirr ?? null,
    holdings: { groups, total: snapshot.holdings.total },
    verdictSummary,
    amcAllocation: snapshot.amcAllocation,
    composition: snapshot.composition,
    sectors: snapshot.sectors,
    marketCap: snapshot.marketCap,
    benchmarkName: snapshot.benchmarkName,
    marketCapByFund,
    performance,
    portfolioReturns,
    risk: snapshot.risk,
    coverage: snapshot.coverage,
    recommended: recommendedModel(allocation, rows, fundData),
  };
}

function recommendedModel(allocation, holdingRows, fundData) {
  if (!allocation) return null;
  const rowByIsin = new Map(holdingRows.map((row) => [row.isin, row]));
  const items = allocation.rows
    .filter((row) => row.name && row.bps > 0)
    .map((row) => {
      const info = (row.isin && fundData?.funds?.[row.isin]) || null;
      const held = row.isin ? rowByIsin.get(row.isin) : null;
      return {
        name: row.name,
        isin: row.isin || null,
        pct: row.bps / 100,
        bps: row.bps,
        amount: row.amount,
        category: info?.category ?? held?.category ?? null,
        benchmark: info?.benchmark ?? held?.benchmark ?? null,
        returns: info?.returns ?? held?.returns ?? null,
        benchmarkReturns: info?.benchmarkReturns ?? held?.benchmarkReturns ?? null,
      };
    })
    .sort((p, q) => q.bps - p.bps || byName(p, q));

  // Blended return per period = allocation-weighted average, only when every fund has that period.
  const blended = {};
  for (const period of PERIODS) {
    const complete = items.length && items.every((item) => typeof item.returns?.[period] === "number");
    blended[period] = complete ? items.reduce((sum, item) => sum + item.returns[period] * item.bps, 0) / 10000 : null;
  }
  return { rows: items, blended, amount: allocation.amount, totalPct: allocation.totalPct };
}
