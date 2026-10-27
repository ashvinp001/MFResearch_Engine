/**
 * Detailed Report model — every number in "Portfolio Review & Recommendation".
 *
 * Input:  { portfolio, fundData (Phase 2, may be null), verdicts { [holdingKey]: verdict }, allocation (allocatePortfolio result),
 *           suggestions (Suggestion Box points from autoRecommend, [{ id, text }]),
 *           calls (autoRecommend suggestions by holding key — the basis of each call, for the commentary),
 *           fundHoldings ({ [isin]: { asOn, holdings } } from PulseDB — for the Portfolio Overlap matrix) }
 * Output: {
 *   asOf, fundCount, amcCount, totals, xirr,
 *   holdings: { groups: [ { key, value, weightPct, rows: [Row] } ], total },   // Row: one active holding
 *   verdictSummary: { invest|hold|sell: { count, value, share } },
 *   amcAllocation, composition, sectors, marketCap, benchmarkName,
 *   marketCapByFund: { rows: [ { name, large, mid, small } ], blended } | null,
 *   performance: [ { key, rows: [Row with returns] } ],                       // equity, hybrid, gold/silver; debt & ETFs excluded
 *   portfolioReturns: [ { period, portfolio, benchmark, excess } ] | null,
 *   risk, coverage,
 *   recommended: { rows: [ { name, isin, pct, amount, category, benchmark, returns } ], blended, amount, totalPct, mode: "lumpsum"|"sip" }
 * }
 * Money in integer paise from the printed CAS values. Fund analytics are passed
 * through from fundData and never estimated; missing values stay null.
 */

import { holdingKey } from "../model/portfolio.schema.js";
import { toPaise } from "../cas/parse-values.js";
import { buildSnapshot } from "./snapshot.js";
import { fundOverlap } from "./auto-recommendation.js";

export const ASSET_GROUPS = Object.freeze(["equity", "hybrid", "debt", "goldSilver"]);
const PERIODS = ["r1y", "r3y", "r5y"];

const byName = (p, q) => p.name.localeCompare(q.name, "en", { sensitivity: "base" });

export function buildDetailedReport({ portfolio, fundData = null, verdicts = {}, allocation = null, suggestions = [], calls = {}, fundHoldings = null }) {
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
      folio: holding.folio ?? null,
      weightPct: totalPaise ? (current / totalPaise) * 100 : 0,
      unitsRaw: holding.raw.units,
      nav: holding.nav,
      invested: invested === null ? null : invested / 100,
      current: current / 100,
      profit: invested === null ? null : (current - invested) / 100,
      verdict: verdicts[holdingKey(holding)] ?? null,
      // The logic's basis for its call (grade, stage) — used by the commentary only when the advisor kept that call.
      call: (() => {
        const s = calls[holdingKey(holding)];
        return s && s.verdict && s.verdict === verdicts[holdingKey(holding)] ? { grade: s.grade, stage: s.stage ?? "fund" } : null;
      })(),
      assetClass: info?.assetClass ?? null,
      plan: info?.plan ?? null,                    // Regular | Direct | ETF
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

  // Fund-wise market cap: actively managed equity funds only — index funds, ETFs and debt funds are
  // not listed (owner's rule). Blended = value-weighted split of the funds listed.
  const passive = (row) => /\bindex\b|\betfs?\b|\bbees\b/i.test(`${row.category ?? ""} ${row.name}`);
  const equityRows = rows.filter((row) => row.assetClass === "equity" && row.marketCap && !passive(row)).sort(byName);
  const listedPaise = equityRows.reduce((sum, row) => sum + row.currentPaise, 0);
  const blendOf = (key) => (listedPaise ? equityRows.reduce((sum, row) => sum + row.currentPaise * row.marketCap[key], 0) / listedPaise : 0);
  const marketCapByFund = equityRows.length
    ? {
        rows: equityRows.map((row) => ({ name: row.name, ...row.marketCap })),
        blended: { large: blendOf("large"), mid: blendOf("mid"), small: blendOf("small") },
        excludedNote: "Index funds, ETFs and debt funds are not included in this table.",
      }
    : null;

  // Fund performance: equity, hybrid and gold/silver funds — ETFs and debt funds are not listed (owner's rule).
  const etf = (row) => row.plan === "ETF" || /\betfs?\b/i.test(row.category ?? "");
  const performance = (known ? ["equity", "hybrid", "goldSilver"] : [null])
    .map((key) => ({ key, rows: rows.filter((row) => (known ? row.assetClass === key : row.assetClass !== "debt") && !etf(row)).sort(byName) }))
    .filter((group) => group.rows.length);

  // Invest / Hold / Sell totals (count, value, share of current value), summed in paise.
  const verdictSummary = {};
  for (const verdict of ["invest", "hold", "sell"]) {
    const members = rows.filter((row) => row.verdict === verdict);
    const paise = members.reduce((sum, row) => sum + row.currentPaise, 0);
    // count = funds, not folios: the same fund in two folios is one fund
    const count = new Set(members.map((row) => row.isin ?? row.name)).size;
    verdictSummary[verdict] = { count, value: paise / 100, share: totalPaise ? paise / totalPaise : 0 };
  }

  const portfolioReturns = snapshot.trailingReturns
    ? snapshot.trailingReturns.map((r) => ({
        period: r.period, portfolio: r.portfolio, benchmark: r.benchmark,
        excess: Number.isFinite(r.portfolio) && Number.isFinite(r.benchmark) ? r.portfolio - r.benchmark : null,
      }))
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
    benchmarkBasis: snapshot.benchmarkBasis,
    marketCapByFund,
    performance,
    portfolioReturns,
    risk: snapshot.risk,
    coverage: snapshot.coverage,
    recommended: recommendedModel(allocation, rows, fundData),
    suggestions,   // Suggestion Box (autoRecommend flags): [{ id, text }]
    overlap: overlapModel(rows, fundHoldings),
  };
}

/** The scheme a CAS name belongs to, whatever its plan / option / demat wording ("DSP Equity Savings Fund - Dir - Growth (Demat)" ≡ "… - Reg - Growth (Non-Demat)"). */
function schemeKey(name) {
  return String(name ?? "").toLowerCase()
    .replace(/\((?:formerly|erstwhile)[^)]*\)/g, " ").replace(/\((?:non[\s-]*)?demat\)/g, " ")
    .replace(/\b(direct|regular|dir|reg|plan|growth|option|gr|non[\s-]*demat|demat)\b/g, " ")
    .replace(/[^a-z0-9&]+/g, " ").trim();
}

export const OVERLAP_MAX_FUNDS = 12;    // funds shown in the matrix (largest by value); every pair is still checked
export const OVERLAP_HIGH = 0.5;        // a pair at or above this share of the same stocks is listed as high overlap

/**
 * Portfolio Overlap (Section 04): for the client's funds that hold stocks, the share of two funds' equity portfolios
 * invested in the same stocks (auto-recommendation.fundOverlap, 0–1). One entry per fund (folios combined), largest
 * by value first; the matrix shows up to OVERLAP_MAX_FUNDS of them, the high-overlap list covers every fund.
 * null when holdings data is not available (or fewer than two funds hold stocks).
 */
function overlapModel(rows, fundHoldings) {
  if (!fundHoldings) return null;
  // Equity funds only (as in a fund-overlap matrix): a hybrid's or an arbitrage fund's stock portion is only part of
  // it, so its overlap would overstate the shared exposure. One entry per fund: its folios and both its plans
  // (Regular and Direct hold the same portfolio) are combined.
  const byIsin = new Map();
  for (const row of rows) {
    if (!row.isin || !fundHoldings[row.isin] || row.assetClass !== "equity") continue;
    const key = schemeKey(row.name);
    const entry = byIsin.get(key);
    if (entry) entry.weightPct += row.weightPct;
    else byIsin.set(key, { isin: row.isin, name: row.name, weightPct: row.weightPct });
  }
  // Funds with equity holdings only (an overlap with itself is defined): debt and gold funds have none.
  const funds = [...byIsin.values()].filter((f) => fundOverlap(fundHoldings[f.isin], fundHoldings[f.isin]) !== null)
    .sort((a, b) => b.weightPct - a.weightPct || byName(a, b));
  if (funds.length < 2) return null;
  const value = (a, b) => {
    const o = fundOverlap(fundHoldings[a.isin], fundHoldings[b.isin]);
    return o === null ? null : Math.min(1, o / 100);
  };
  const pairs = [];
  for (let i = 0; i < funds.length; i++) {
    for (let j = i + 1; j < funds.length; j++) {
      const o = value(funds[i], funds[j]);
      if (o !== null && o >= OVERLAP_HIGH) pairs.push({ a: funds[i].name, b: funds[j].name, overlap: o });
    }
  }
  const shown = funds.slice(0, OVERLAP_MAX_FUNDS);
  return {
    funds: shown.map((f, i) => ({ n: i + 1, name: f.name, isin: f.isin, weightPct: f.weightPct })),
    matrix: shown.map((a, i) => shown.slice(0, i + 1).map((b, j) => (i === j ? 1 : value(a, b)))),   // lower triangle
    hidden: funds.length - shown.length,
    pairs: pairs.sort((p, q) => q.overlap - p.overlap),
    asOn: [...new Set(funds.map((f) => fundHoldings[f.isin]?.asOn).filter(Boolean))].sort().at(-1) ?? null,
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
  // mode: "sip" = the amount is a monthly SIP; "lumpsum" = a one-time investment (the advisor's choice in Step 4).
  return { rows: items, blended, amount: allocation.amount, totalPct: allocation.totalPct, mode: allocation.mode === "sip" ? "sip" : "lumpsum" };
}
