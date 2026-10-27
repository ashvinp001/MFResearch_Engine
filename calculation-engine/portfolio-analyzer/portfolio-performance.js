/**
 * Portfolio and fund performance from NAV history (MF_Calculation_Engine.md E15.5.9).
 *
 * buildFundData({ portfolio, schemeMap, histories }) → FundData (see market/fund-data-provider.js)
 *   portfolio  — validated (and revalued) NormalizedPortfolio
 *   schemeMap  — buildSchemeMap(data/schemes lists): ISIN → AMFI scheme
 *   histories  — { [schemeCode]: navSeries(...) } daily NAVs (E1 series), from the NAV store
 *
 * Per fund (keyed by ISIN): 1Y / 3Y / 5Y trailing returns by E2 at the fund's own ANCHOR (latest NAV),
 * AMFI category, asset group. Benchmark figures stay null until index data is connected.
 *
 * Portfolio (the client's CURRENT units, looked back — "current holdings" method):
 *   T = the latest NAV date across the portfolio's funds. A fund's NAV on any date d is E1
 *   NEAREST-PREVIOUS (10-day cap); a fund takes part in a figure only when it has a NAV for every date
 *   that figure needs ("eligible").
 *   Value(d)            = Σ eligible units × NAV(d)
 *   Trailing p ≤ 12M    = Value(T) / Value(T − p) − 1
 *   Trailing p > 12M    = (Value(T) / Value(T − p)) ^ (365 / days(T − p → T)) − 1
 *   Monthly returns     = Value at the last 37 completed month-ends → 36 returns (E12)
 *   Risk (E12 R1–R3)    = σ, Sharpe, Sortino on those returns with the same funds' 3Y CAGR
 *   A portfolio figure is published only when its eligible funds hold ≥ PORTFOLIO_ANALYTICS.minValueCoverage
 *   of the portfolio's current value (all active holdings); otherwise null ("—"). Never extrapolated.
 * Percent outputs (12.34 = 12.34%) at this boundary, as the reports expect.
 */

import { PORTFOLIO_ANALYTICS, RISK } from "../config.js";
import { anchorNav, daysBetween, navOn, periodMonths, periodStart, trailingReturn } from "../analytics/returns.js";
import { lastCompletedMonthEnd, monthEnds, riskMetrics } from "../analytics/risk.js";
import { isValidIsin } from "../identity/isin.js";
import { toPaise } from "../cas/parse-values.js";
import { portfolioXirr } from "./xirr.js";

const pct = (ratio) => (ratio === null || ratio === undefined || !Number.isFinite(ratio) ? null : ratio * 100);

/** Report asset group from the AMFI asset class, category and name — null when it cannot be told apart. */
export function assetGroup(scheme, name = "") {
  const text = `${scheme.category} ${scheme.schemeName} ${name}`.toLowerCase();
  // AMFI's Hybrid class (incl. arbitrage and multi-asset funds that hold some gold) is its own group.
  if (scheme.assetClass === "Hybrid" || (scheme.assetClass === "Other" && /hybrid/i.test(scheme.category ?? ""))) return "hybrid";
  if (/\bgold\b|\bsilver\b|precious\s*metal/.test(text)) return "goldSilver";
  if (scheme.assetClass === "Equity") return "equity";
  if (scheme.assetClass === "Debt") return "debt";
  if (scheme.assetClass === "Other") {
    if (/\bgilt\b|g[\s-]*sec|\bsdl\b|\bbond\b|\bdebt\b|t[\s-]*bill|treasury|liquid|overnight|money\s*market|crisil\s*ibx|target\s*maturity|bharat\s*bond|income|arbitrage/.test(text)) return "debt";
    if (/index funds|equity etf|other etfs|fof overseas|nifty|sensex|equity/.test(text) && !/fof domestic/.test(scheme.category.toLowerCase())) return "equity";
  }
  return null; // solution-oriented, domestic fund of funds: needs the fund's holdings to split
}

/**
 * One fund's figures (FundInfo): 1Y / 3Y / 5Y by E2 at its own ANCHOR; for a fund under a year old,
 * the plain return since its first NAV (never annualised, E1). Used for the client's funds and for
 * funds the advisor adds to the Recommended Portfolio.
 */
export function fundInfo(scheme, series, name = "", bench = null) {
  const anchor = anchorNav(series);
  const r = (period) => pct(trailingReturn(series, period, anchor));
  const r1y = r({ months: 12 });
  // The fund's own benchmark over the same periods: its price on the fund's ANCHOR date (E1 NEAREST-PREVIOUS).
  const bAnchor = bench?.series && anchor ? navOn(bench.series, anchor.date, "previous") : null;
  const b = (period) => (bAnchor ? pct(trailingReturn(bench.series, period, bAnchor)) : null);
  return {
    schemeCode: scheme.schemeCode,
    plan: scheme.plan ?? null,   // Regular | Direct | ETF (AMFI list)
    assetClass: assetGroup(scheme, name),
    category: scheme.category,
    benchmark: bAnchor ? bench.name ?? bench.code : null,
    benchmarkCode: bAnchor ? bench.code : null,
    navDate: anchor?.date ?? null,
    returns: { r1y, r3y: r({ years: 3 }), r5y: r({ years: 5 }) },
    sinceLaunch: r1y === null && anchor && series.dates.length > 1 ? { pct: pct(anchor.nav / series.navs[0] - 1), from: series.first } : null,
    benchmarkReturns: { r1y: b({ months: 12 }), r3y: b({ years: 3 }), r5y: b({ years: 5 }) },
    marketCap: null,
  };
}

function units(holding) {
  const text = String(holding.raw?.units ?? "").replace(/,/g, "").trim();
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}

export const BLENDED_BENCHMARK = "Blended Benchmark";

export function buildFundData({ portfolio, schemeMap, histories, benchmarks = {}, market = null }) {
  const active = portfolio.holdings.filter((h) => h.status === "active");
  const totalPaise = active.reduce((sum, h) => sum + (toPaise(h.raw.marketValue) ?? 0), 0);

  // Funds that can take part: mapped, with units, a value and a NAV history.
  const members = [];
  for (const holding of active) {
    const scheme = isValidIsin(holding.isin) ? schemeMap.byIsin(holding.isin) : null;
    const series = scheme ? histories[scheme.schemeCode] : null;
    const u = units(holding);
    const paise = toPaise(holding.raw.marketValue);
    if (scheme && series && series.dates.length && u && paise !== null) {
      members.push({ holding, scheme, series, units: u, paise, bench: benchmarks[scheme.schemeCode] ?? null });
    }
  }
  const T = members.reduce((latest, m) => (m.series.last > latest ? m.series.last : latest), "");

  const funds = {};
  for (const m of members) funds[m.holding.isin] = fundInfo(m.scheme, m.series, m.holding.schemeName, m.bench);

  const covered = (set) => (totalPaise ? set.reduce((s, m) => s + m.paise, 0) / totalPaise : 0);
  const valueOn = (set, date) => set.reduce((s, m) => s + m.units * navOn(m.series, date, "previous").nav, 0);
  const eligibleFor = (dates) => members.filter((m) => dates.every((d) => navOn(m.series, d, "previous")));

  // Blended benchmark (E15.5.13a): for each fund, a position in its own benchmark worth the fund's value on T,
  // looked back exactly like the fund (current-holdings method). A fund whose benchmark has no price on one of
  // the dates (or has none stored) stands in with its own NAV — neutral. Published only when funds with a real
  // benchmark hold ≥ minValueCoverage of the portfolio's value.
  // Which benchmark the portfolio is measured against: the blend of the funds' own indices when funds with a
  // verified benchmark hold ≥ minValueCoverage of the value; otherwise the broad market (NIFTY 500), so Alpha /
  // Beta are always measured — every fund then sits in that one index.
  const ownCoverage = covered(members.filter((m) => m.bench?.series && T && navOn(m.bench.series, T, "previous")));
  const mode = ownCoverage >= PORTFOLIO_ANALYTICS.minValueCoverage || !market?.series ? "own" : "market";
  const benchOf = (m) => (mode === "market" ? market : m.bench);
  const legs = (set, dates) => set.map((m) => {
    const b = benchOf(m)?.series;
    if (b && dates.every((d) => navOn(b, d, "previous"))) {
      const scale = (m.units * navOn(m.series, T, "previous").nav) / navOn(b, T, "previous").nav;
      return { m, real: true, value: (d) => scale * navOn(b, d, "previous").nav };
    }
    return { m, real: false, value: (d) => m.units * navOn(m.series, d, "previous").nav };
  });
  const benchCoverage = (ls) => covered(ls.filter((l) => l.real).map((l) => l.m));
  const legValue = (ls, d) => ls.reduce((s, l) => s + l.value(d), 0);
  const usedNames = new Set();

  const trailing = T ? PORTFOLIO_ANALYTICS.trailingPeriods.map(({ key, period }) => {
    const start = periodStart(T, period);
    const set = eligibleFor([T, start]);
    const coverage = covered(set);
    const annualise = (growth) => (periodMonths(period) > 12 ? growth ** (365 / daysBetween(start, T)) - 1 : growth - 1);
    let value = null, bench = null, benchmarkCoverage = 0;
    if (set.length && coverage >= PORTFOLIO_ANALYTICS.minValueCoverage) {
      value = annualise(valueOn(set, T) / valueOn(set, start));
      const ls = legs(set, [T, start]);
      benchmarkCoverage = benchCoverage(ls);
      if (benchmarkCoverage >= PORTFOLIO_ANALYTICS.minValueCoverage) {
        bench = annualise(legValue(ls, T) / legValue(ls, start));
        ls.filter((l) => l.real).forEach((l) => usedNames.add(benchOf(l.m).name ?? benchOf(l.m).code));
      }
    }
    return { period: key, portfolio: pct(value), benchmark: pct(bench), coverage, benchmarkCoverage };
  }) : [];

  let risk = null;
  if (T) {
    const ends = monthEnds(lastCompletedMonthEnd(T), RISK.windowMonths + 1);
    const start3y = periodStart(T, { years: 3 });
    const set = eligibleFor([...ends, T, start3y]);
    if (set.length && covered(set) >= PORTFOLIO_ANALYTICS.minValueCoverage) {
      const values = ends.map((d) => valueOn(set, d));
      const monthly = values.slice(1).map((v, i) => v / values[i] - 1);
      const cagr3y = (valueOn(set, T) / valueOn(set, start3y)) ** (365 / daysBetween(start3y, T)) - 1;
      // The blended benchmark over the same month-ends → Beta / Alpha (E12 R4) and its own Std Dev / Sharpe.
      const ls = legs(set, [...ends, T, start3y]);
      const withBench = benchCoverage(ls) >= PORTFOLIO_ANALYTICS.minValueCoverage;
      const bValues = withBench ? ends.map((d) => legValue(ls, d)) : null;
      const benchmarkMonthly = bValues ? bValues.slice(1).map((v, i) => v / bValues[i] - 1) : null;
      const benchmarkCagr3y = withBench ? (legValue(ls, T) / legValue(ls, start3y)) ** (365 / daysBetween(start3y, T)) - 1 : null;
      const m = riskMetrics({ monthly, cagr3y, benchmarkMonthly, benchmarkCagr3y });
      const bm = withBench ? riskMetrics({ monthly: benchmarkMonthly, cagr3y: benchmarkCagr3y }) : null;
      if (withBench) ls.filter((l) => l.real).forEach((l) => usedNames.add(benchOf(l.m).name ?? benchOf(l.m).code));
      if (m) {
        risk = {
          stdDev: pct(m.stdDev), sharpe: m.sharpe, sortino: m.sortino, alpha: pct(m.alpha), beta: m.beta,
          benchmark: bm ? { stdDev: pct(bm.stdDev), sharpe: bm.sharpe, beta: 1 } : null,
          benchmarkCoverage: benchCoverage(ls),
          observations: m.observations, coverage: covered(set), window: { from: ends[0], to: ends.at(-1) },
        };
      }
    }
  }

  const xirrResult = portfolioXirr(portfolio);
  return {
    asOf: T || null,
    // One index when every benchmarked fund shares it; otherwise the blend of the funds' own indices.
    benchmarkName: usedNames.size === 0 ? null : usedNames.size === 1 ? [...usedNames][0] : BLENDED_BENCHMARK,
    benchmarkComponents: [...usedNames],
    benchmarkBasis: usedNames.size ? (mode === "market" ? "market" : "funds") : null,   // "funds" = each fund's own index
    benchmarkOwnCoverage: ownCoverage,
    composition: null,
    sectors: null,
    marketCap: null,
    trailingReturns: trailing.some((r) => r.portfolio !== null) ? trailing : null,
    risk,
    coverage: { covered: members.length, total: active.length },
    xirr: pct(xirrResult.xirr),
    xirrDetail: xirrResult,
    funds,
  };
}
