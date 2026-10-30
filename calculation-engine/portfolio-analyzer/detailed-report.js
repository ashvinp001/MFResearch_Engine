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
 *   performance: [ { key, rows: [Row with returns] } ],                       // equity, hybrid, gold/silver; debt & ETFs excluded; one row per ISIN
 *   overlap: { funds, closest, pairs (high only), buckets: { high, moderate, low }, distinct, asOn } | null   // see overlapModel
 *   overlapApplies: boolean                                                   // false with only one fund: no Portfolio Overlap section
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
import { fundOverlap, sharedStocks } from "./auto-recommendation.js";
import { groupFromMix } from "./portfolio-performance.js";

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
      // AMFI class / category / name first; a fund of funds or solution fund the name cannot place goes by its
      // look-through holdings (65% rule). Anything still unplaced is shown under "OTHER", never under another heading.
      assetClass: info?.assetClass ?? groupFromMix(info?.assetMix) ?? null,
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
  // One row per scheme: its Regular and Direct plans hold the same portfolio (same market-cap split), and several
  // folios are the same fund — listed once, under the scheme's name without plan / option / demat wording.
  const byScheme = new Map();
  for (const row of equityRows) {
    const key = schemeKey(row.name);
    if (!byScheme.has(key)) byScheme.set(key, { name: schemeName(row.name), ...row.marketCap });
  }
  const marketCapByFund = equityRows.length
    ? {
        rows: [...byScheme.values()].sort(byName),
        blended: { large: blendOf("large"), mid: blendOf("mid"), small: blendOf("small") },
        excludedNote: "Index funds, ETFs and debt funds are not included in this table.",
      }
    : null;

  // Fund performance: equity, hybrid and gold/silver funds — ETFs and debt funds are not listed (owner's rule).
  // One row per fund: the same ISIN (same scheme, plan and option) held in several folios has identical returns, so it
  // is listed once. Regular and Direct plans of a scheme stay separate rows — their returns differ.
  const etf = (row) => row.plan === "ETF" || /\betfs?\b/i.test(row.category ?? "");
  const oncePerFund = (list) => {
    const seen = new Set();
    return list.filter((row) => {
      const id = row.isin ?? row.name;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };
  const performance = (known ? ["equity", "hybrid", "goldSilver"] : [null])
    .map((key) => ({ key, rows: oncePerFund(rows.filter((row) => (known ? row.assetClass === key : row.assetClass !== "debt") && !etf(row)).sort(byName)) }))
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
    // Portfolio Overlap needs at least two different funds; with one fund (in any number of folios) the section is left
    // out of the report and the sections after it move up.
    overlapApplies: new Set(rows.map((row) => row.isin ?? row.name)).size > 1,
  };
}

/** A scheme's name without plan, option, demat or "formerly" wording: "Mirae Asset Large Cap Fund - Direct Plan - Growth
 * (Demat)" → "Mirae Asset Large Cap Fund". */
function schemeName(name) {
  const clean = String(name ?? "").replace(/\s*\((?:formerly|erstwhile)[^)]*\)/gi, "").replace(/\s*\((?:non[\s-]*)?demat\)/gi, "");
  const parts = clean.split(/\s+-\s+/);
  const end = parts.findIndex((p) => /\b(fund|etf|fof)\b/i.test(p));
  return parts.slice(0, end >= 0 ? end + 1 : 1).join(" - ")
    .replace(/\s+\b(direct|regular|dir|reg)\b(\s+plan)?(\s+growth)?(\s+option)?\s*$/i, "").replace(/\s+growth\s*$/i, "").replace(/\s{2,}/g, " ").trim();
}

/** The scheme a CAS name belongs to, whatever its plan / option / demat wording ("DSP Equity Savings Fund - Dir - Growth (Demat)" ≡ "… - Reg - Growth (Non-Demat)"). */
function schemeKey(name) {
  return String(name ?? "").toLowerCase()
    .replace(/\((?:formerly|erstwhile)[^)]*\)/g, " ").replace(/\((?:non[\s-]*)?demat\)/g, " ")
    .replace(/\b(direct|regular|dir|reg|plan|growth|option|gr|non[\s-]*demat|demat)\b/g, " ")
    .replace(/[^a-z0-9&]+/g, " ").trim();
}

export const OVERLAP_HIGH = 0.5;        // a pair at or above this share of the same stocks: high overlap (red)
export const OVERLAP_LOW = 0.25;        // below this: low overlap (green); in between: moderate (amber)
export const OVERLAP_NONE = 0.1;        // a fund whose closest overlap is below this is shown as having none

// Compared: equity and hybrid funds (index funds and equity ETFs included). Left out: debt and gold / silver funds (no
// stocks), funds of funds (owner's rule — they hold other funds) and arbitrage funds (their stock positions are hedged).
const NOT_COMPARED = /\bfof\b|fund\s+of\s+funds?|fund-of-funds?|arbitrage/i;
const comparedInOverlap = (row) => (row.assetClass === "equity" || row.assetClass === "hybrid") && !NOT_COMPARED.test(`${row.category ?? ""} ${row.name}`);

/**
 * Portfolio Overlap (Section 04): for the client's equity and hybrid funds, the share of two funds' stock portfolios
 * invested in the same stocks (auto-recommendation.fundOverlap, 0–1; a hybrid fund's stock portion scaled to 100%).
 * One entry per fund — its folios and both its plans combined, under the scheme's plan-neutral name — largest by value.
 * → { funds: [{ n, name, isin, weightPct, category }],
 *     closest: every fund's closest overlap, one row per pair (two funds that are each other's closest share a row),
 *              highest first: [{ a, b, aN, bN, overlap, band }]; a fund below OVERLAP_NONE with every fund:
 *              [{ solo: name, n, overlap (its highest) }],
 *     pairs: high pairs, buckets: { high, moderate, low }: [{ a, b, aN, bN, overlap, band, shared: [stock names] }]
 *     (each bucket highest overlap first), distinct: names of funds below OVERLAP_LOW with every other fund, asOn }
 * null when holdings data is not available (or fewer than two funds hold stocks).
 */
function overlapModel(rows, fundHoldings) {
  if (!fundHoldings) return null;
  // One entry per fund: its folios and both its plans (Regular and Direct hold the same portfolio) are combined.
  const byScheme = new Map();
  for (const row of rows) {
    if (!row.isin || !fundHoldings[row.isin] || !comparedInOverlap(row)) continue;
    const key = schemeKey(row.name);
    const entry = byScheme.get(key);
    if (entry) entry.weightPct += row.weightPct;
    else byScheme.set(key, { isin: row.isin, name: schemeName(row.name), weightPct: row.weightPct, category: row.category ?? null });
  }
  // Funds with equity holdings only (an overlap with itself is defined): debt and gold funds have none.
  const funds = [...byScheme.values()].filter((f) => fundOverlap(fundHoldings[f.isin], fundHoldings[f.isin]) !== null)
    .sort((a, b) => b.weightPct - a.weightPct || byName(a, b))
    .map((f, i) => ({ n: i + 1, ...f }));
  if (funds.length < 2) return null;
  const value = (a, b) => {
    const o = fundOverlap(fundHoldings[a.isin], fundHoldings[b.isin]);
    return o === null ? null : Math.min(1, o / 100);
  };
  const all = [];
  for (let i = 0; i < funds.length; i++) {
    for (let j = i + 1; j < funds.length; j++) {
      const o = value(funds[i], funds[j]);
      if (o === null) continue;
      const band = overlapBand(o);
      all.push({ a: funds[i].name, b: funds[j].name, aN: funds[i].n, bN: funds[j].n, overlap: o, band,
        shared: sharedStocks(fundHoldings[funds[i].isin], fundHoldings[funds[j].isin]).map((s) => s.name) });
    }
  }
  all.sort((p, q) => q.overlap - p.overlap || p.aN - q.aN || p.bN - q.bN);
  const buckets = { high: all.filter((p) => p.band === "high"), moderate: all.filter((p) => p.band === "moderate"), low: all.filter((p) => p.band === "low") };
  // Every fund's closest overlap (`all` is highest first, so the first pair with a fund is its closest).
  const closest = [], used = new Set();
  for (const f of funds) {
    const best = all.find((p) => p.aN === f.n || p.bN === f.n);
    if (!best) continue;   // no overlap figure with any fund
    if (best.overlap < OVERLAP_NONE) closest.push({ solo: f.name, n: f.n, overlap: best.overlap });
    else if (!used.has(best)) { used.add(best); closest.push(best); }
  }
  closest.sort((p, q) => q.overlap - p.overlap);
  return {
    funds: funds.map(({ n, name, isin, weightPct, category }) => ({ n, name, isin, weightPct, category })),
    closest,
    pairs: buckets.high,
    buckets,
    distinct: funds.filter((f) => all.every((p) => (p.aN !== f.n && p.bN !== f.n) || p.band === "low")).map((f) => f.name),
    asOn: [...new Set(funds.map((f) => fundHoldings[f.isin]?.asOn).filter(Boolean))].sort().at(-1) ?? null,
  };
}

/** "high" (≥ OVERLAP_HIGH), "moderate" (OVERLAP_LOW to OVERLAP_HIGH) or "low" (< OVERLAP_LOW). */
export function overlapBand(v) {
  return v >= OVERLAP_HIGH ? "high" : v >= OVERLAP_LOW ? "moderate" : "low";
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
