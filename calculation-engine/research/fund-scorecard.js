/**
 * Fund Scorecard — rates every fund of one category from 0 to 100 and ranks them (MF_Calculation_Engine.md E2, E3,
 * E9, E12 R1–R7; Fund Scorecard owner settings).
 *
 * fundMeasures(fund, { benchmark, asOf, config, windowYears }) → { anchor, measures: { [key]: number | null }, rolling3y, annual }
 * windowOf(minHistoryYears) → the risk window in years: 3 (E12 standard, 36 monthly returns), or 2 when the owner allows
 *   2-year-old funds — then every fund is measured over the same 24 months, so the comparison stays like for like.
 * scoreCategory({ funds, benchmark, asOf, settings, config }) → {
 *   asOf, weights, conditions, pillars: [{ key, label, weight, measures: [{ key, label, better, used }] }],
 *   rated:    [{ code, name, score, rank, quartile, pillars: { [key]: 0–100 }, measures: { [key]: { value, pct } }, notes }],
 *   notRated: [{ code, name, reason }],
 *   categoryReason: string | null    (set when fewer than minPeers funds qualify: nobody is ranked)
 * }
 * backtestCategory({ funds, benchmark, asOf, settings, config }) → model check: rate as of `backtestYears` ago (AUM
 *   unknown then: the AUM condition and the Quality pillar are left out), then each quartile's return since.
 *
 * funds: [{ code, name, series (navSeries), aum (₹ crore | null), benchmarkSeries? (own index, when the category
 *          compares each fund with its own index) }]
 * Method:
 *  1. Conditions — history ≥ minHistoryYears (3Y start NAV must exist), latest NAV ≤ maxNavAgeDays old, AUM published
 *     and ≥ minAumCr, no day-on-day NAV move above navJumpMax in the last dataBreakYears (a data break). Failing funds
 *     are "Not rated" with the reason — never scored, never recommended.
 *  2. Measures (each fund at its own ANCHOR, the latest NAV on or before asOf):
 *     Returns        1Y, 3Y, 5Y (E2)
 *     Risk-adjusted  Sharpe, Sortino (E12 R2, R3), Information ratio = (3Y CAGR − index 3Y CAGR) / tracking error,
 *                    tracking error = STDEV.S(monthly fund − index) × √12
 *     Benchmark      Alpha (E12 R4), excess = window CAGR − index window CAGR (window = 3Y, or 2Y — windowOf)
 *     Volatility     Standard deviation (R1), Beta (R4)                                    lower is better
 *     Downside       Max drawdown (R5, daily NAVs over 3Y; shallower is better), recovery days (trough → prior peak,
 *                    or → anchor while not recovered; fewer is better), Calmar = 3Y CAGR / |max drawdown|,
 *                    upside capture (higher), downside capture (R6; lower)
 *     Consistency    rolling 3Y at or above the category median (share of rollingWindows month-ends; the median of every
 *                    fund with a current NAV — the peer statistics' group), rolling 1Y
 *                    returns positive (share of rolling1yWindows month-ends), calendar years in the top half (E9
 *                    quartile 1 or 2, last calendarYears completed years)
 *     Quality        AUM (larger is better)
 *     Monthly returns: month-end NAVs (E1 NEAREST-PREVIOUS) over the last window × 12 completed months; the index on
 *     the same month-ends.
 *  3. Normalisation — each measure becomes a percentile (0–100) among the eligible funds that have it (ties share the
 *     average position; "lower is better" measures are reversed). A measure only counts when at least minPeers funds
 *     have it. Pillar = mean of its measures' percentiles; a fund missing every measure of a weighted pillar is
 *     Not rated. Score = Σ weight × pillar / Σ weights. Rank by score (ties share a rank); quartile by E9.
 */

import { SCORECARD } from "../config.js";
import { anchorNav, daysBetween, navOn, periodStart, returnBetween, trailingReturn } from "../analytics/returns.js";
import { lastCompletedMonthEnd, monthEnds, riskMetrics } from "../analytics/risk.js";

export const PILLARS = Object.freeze([
  { key: "returns", label: "Returns", measures: [
    { key: "r1y", label: "1Y return", better: "higher", unit: "pct" },
    { key: "r3y", label: "3Y return (CAGR)", better: "higher", unit: "pct" },
    { key: "r5y", label: "5Y return (CAGR)", better: "higher", unit: "pct" }] },
  { key: "riskAdjusted", label: "Risk-adjusted return", measures: [
    { key: "sharpe", label: "Sharpe ratio", better: "higher", unit: "ratio" },
    { key: "sortino", label: "Sortino ratio", better: "higher", unit: "ratio" },
    { key: "informationRatio", label: "Information ratio", better: "higher", unit: "ratio" }] },
  { key: "benchmark", label: "Benchmark", measures: [
    { key: "alpha", label: "Alpha", better: "higher", unit: "pct" },
    { key: "excess3y", label: "Excess over index (3Y)", better: "higher", unit: "pct" }] },
  { key: "volatility", label: "Volatility", measures: [
    { key: "stdDev", label: "Standard deviation", better: "lower", unit: "pct" },
    { key: "beta", label: "Beta", better: "lower", unit: "ratio" }] },
  { key: "downside", label: "Downside & capture", measures: [
    { key: "maxDrawdown", label: "Max drawdown (3Y)", better: "higher", unit: "pct" },
    { key: "recoveryDays", label: "Recovery time", better: "lower", unit: "days" },
    { key: "calmar", label: "Calmar ratio", better: "higher", unit: "ratio" },
    { key: "upCapture", label: "Upside capture", better: "higher", unit: "num" },
    { key: "downCapture", label: "Downside capture", better: "lower", unit: "num" }] },
  { key: "consistency", label: "Consistency", measures: [
    { key: "rollingAboveMedian", label: "Rolling 3Y above category median", better: "higher", unit: "share" },
    { key: "rolling1yPositive", label: "Rolling 1Y returns positive", better: "higher", unit: "share" },
    { key: "calendarTopHalf", label: "Calendar years in top half", better: "higher", unit: "share" }] },
  { key: "quality", label: "Fund quality", measures: [
    { key: "aum", label: "AUM", better: "higher", unit: "cr" }] },
]);

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
function sampleStd(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** E9 quartile (owner's ROUNDUP formula). */
export function quartileOf(rank, n) {
  if (!rank || !n) return null;
  if (rank <= Math.ceil(n * 0.25)) return 1;
  if (rank <= Math.ceil(n * 0.5)) return 2;
  if (rank <= Math.ceil(n * 0.75)) return 3;
  return 4;
}

/** Owner settings over the defaults; anything incomplete or invalid falls back to the defaults as a whole. */
export function resolveSettings(saved, config = SCORECARD) {
  const keys = PILLARS.map((p) => p.key);
  const w = saved?.weights, c = saved?.conditions;
  const weightsOk = w && keys.every((k) => Number.isInteger(w[k]) && w[k] >= 0 && w[k] <= 100) && keys.reduce((s, k) => s + w[k], 0) === 100;
  const condKeys = Object.keys(config.conditions);
  const condOk = c && condKeys.every((k) => isNum(c[k]) && c[k] >= 0) && c.minHistoryYears >= 2;
  return {
    weights: weightsOk ? Object.fromEntries(keys.map((k) => [k, w[k]])) : { ...config.weights },
    conditions: condOk ? Object.fromEntries(condKeys.map((k) => [k, c[k]])) : { ...config.conditions },
    custom: Boolean(weightsOk && condOk),
  };
}

// ---------- series helpers (all at or before the anchor) ----------
function indexAt(series, date) {
  return series.index.get(date);
}

/** Month-end NAVs (NEAREST-PREVIOUS) for count + 1 month-ends ending at `lastEnd` → count monthly returns, or null. */
function monthlyReturns(series, lastEnd, count) {
  const ends = monthEnds(lastEnd, count + 1);
  const navs = ends.map((d) => navOn(series, d, "previous"));
  if (navs.some((p) => !p)) return null;
  return navs.slice(1).map((p, i) => p.nav / navs[i].nav - 1);
}

/** Max drawdown and recovery days over daily NAVs from `fromDate` to `anchor.date`. */
function drawdown(series, fromDate, anchor) {
  const start = navOn(series, fromDate, "previous");
  if (!start) return null;
  const i0 = indexAt(series, start.date), i1 = indexAt(series, anchor.date);
  let peak = series.navs[i0], peakIdx = i0, deepest = 0, troughIdx = i0, peakBeforeTrough = i0;
  for (let i = i0; i <= i1; i++) {
    const v = series.navs[i];
    if (v > peak) { peak = v; peakIdx = i; }
    const dd = v / peak - 1;
    if (dd < deepest) { deepest = dd; troughIdx = i; peakBeforeTrough = peakIdx; }
  }
  if (deepest === 0) return { maxDrawdown: 0, recoveryDays: 0 };
  const prior = series.navs[peakBeforeTrough];
  let recovered = null;
  for (let i = troughIdx + 1; i <= i1; i++) if (series.navs[i] >= prior) { recovered = i; break; }
  const end = recovered ?? i1;
  return { maxDrawdown: deepest, recoveryDays: daysBetween(series.dates[troughIdx], series.dates[end]), recovered: recovered !== null };
}

/** R6 capture ratios over paired monthly returns. */
function capture(fund, bench) {
  const up = [], down = [];
  bench.forEach((b, i) => { if (b > 0) up.push(i); else if (b < 0) down.push(i); });
  const annual = (rs, idx) => (idx.reduce((p, i) => p * (1 + rs[i]), 1)) ** (12 / idx.length) - 1;
  const ratio = (idx) => {
    if (!idx.length) return null;
    const b = annual(bench, idx);
    return b === 0 ? null : (annual(fund, idx) / b) * 100;
  };
  return { upCapture: ratio(up), downCapture: ratio(down) };
}

/** Largest day-on-day NAV move in the window, with its date. */
function largestJump(series, fromDate, anchor) {
  let i = series.dates.findIndex((d) => d >= fromDate);
  if (i < 1) i = 1;
  const i1 = indexAt(series, anchor.date);
  let worst = 0, at = null;
  for (let k = i; k <= i1; k++) {
    const move = Math.abs(series.navs[k] / series.navs[k - 1] - 1);
    if (move > worst) { worst = move; at = series.dates[k]; }
  }
  return { move: worst, date: at };
}

/** Calendar-year return (E3), or null when not eligible / not complete before the anchor. */
function annualReturn(series, year, anchor) {
  if (`${year}-12-31` > anchor.date || series.first > `${year}-01-01`) return null;
  const start = navOn(series, `${year}-01-01`, "next"), end = navOn(series, `${year}-12-31`, "previous");
  return start && end && end.date > start.date ? end.nav / start.nav - 1 : null;
}

/** Every per-fund measure that does not need the other funds (consistency vs the median is added by scoreCategory). */
/** Risk window in years for a minimum history: 2 only when 2-year-old funds are allowed, else the E12 standard 3. */
export function windowOf(minHistoryYears) {
  return minHistoryYears < 3 ? 2 : 3;
}

export function fundMeasures(fund, { benchmark = null, asOf, config = SCORECARD, windowYears = 3 }) {
  const series = fund.series;
  const anchor = series ? anchorNav(series, asOf) : null;
  if (!anchor) return { anchor: null, measures: {}, rolling3y: {}, annual: {} };
  const m = {};
  m.r1y = trailingReturn(series, { months: 12 }, anchor);
  m.r3y = trailingReturn(series, { years: 3 }, anchor);
  m.r5y = trailingReturn(series, { years: 5 }, anchor);

  const lastEnd = lastCompletedMonthEnd(anchor.date);
  const months = windowYears * 12;
  const windowCagr = windowYears === 3 ? m.r3y : trailingReturn(series, { years: windowYears }, anchor);
  const monthly = monthlyReturns(series, lastEnd, months);
  const bench = fund.benchmarkSeries ?? benchmark;
  const benchMonthly = bench ? monthlyReturns(bench, lastEnd, months) : null;
  const benchAnchor = bench ? navOn(bench, anchor.date, "previous") : null;
  const benchCagr = bench && benchAnchor ? trailingReturn(bench, { years: windowYears }, benchAnchor) : null;
  // E12 needs 30 of 36 months; the same share (months − 6) for a 24-month window.
  const risk = monthly ? riskMetrics({ monthly, cagr3y: windowCagr, benchmarkMonthly: benchMonthly, benchmarkCagr3y: benchCagr, minObservations: months - 6 }) : null;
  m.stdDev = risk?.stdDev ?? null;
  m.sharpe = risk?.sharpe ?? null;
  m.sortino = risk?.sortino ?? null;
  m.beta = risk?.beta ?? null;
  m.alpha = risk?.alpha ?? null;
  m.excess3y = isNum(windowCagr) && isNum(benchCagr) ? windowCagr - benchCagr : null;   // over the window
  const te = monthly && benchMonthly ? sampleStd(monthly.map((r, i) => r - benchMonthly[i])) : null;
  m.trackingError = isNum(te) ? te * Math.sqrt(12) : null;
  m.informationRatio = isNum(m.excess3y) && m.trackingError > 0 ? m.excess3y / m.trackingError : null;

  const dd = isNum(windowCagr) ? drawdown(series, periodStart(anchor.date, { years: windowYears }), anchor) : null;
  m.maxDrawdown = dd?.maxDrawdown ?? null;
  m.recoveryDays = dd?.recoveryDays ?? null;
  m.calmar = isNum(windowCagr) && dd && dd.maxDrawdown < 0 ? windowCagr / Math.abs(dd.maxDrawdown) : null;
  const cap = monthly && benchMonthly ? capture(monthly, benchMonthly) : { upCapture: null, downCapture: null };
  m.upCapture = cap.upCapture;
  m.downCapture = cap.downCapture;

  // rolling 1Y (positive share) and rolling 3Y (for the median comparison), at completed month-ends
  const ends1 = monthEnds(lastEnd, config.rolling1yWindows);
  const r1 = ends1.map((e) => { const a = anchorNav(series, e); return a && a.date > e.slice(0, 8) + "01" ? trailingReturn(series, { months: 12 }, a) : null; })
    .filter(isNum);
  m.rolling1yPositive = r1.length >= config.minWindows ? (r1.filter((r) => r > 0).length / r1.length) * 100 : null;
  const rolling3y = {};
  for (const e of monthEnds(lastEnd, config.rollingWindows)) {
    const a = anchorNav(series, e);
    const r = a && a.date > e.slice(0, 8) + "01" ? trailingReturn(series, { years: 3 }, a) : null;
    if (isNum(r)) rolling3y[e] = r;
  }
  const annual = {};
  const lastYear = Number(anchor.date.slice(0, 4)) - 1;
  for (let y = lastYear; y > lastYear - config.calendarYears; y--) {
    const r = annualReturn(series, y, anchor);
    if (isNum(r)) annual[y] = r;
  }
  m.aum = isNum(fund.aum) ? fund.aum : null;
  return { anchor, measures: m, rolling3y, annual, drawdown: dd };
}

// ---------- conditions ----------
function conditionFailure(fund, f, { asOf, conditions, config, ignoreAum }) {
  const series = fund.series;
  if (!series?.dates.length || !f.anchor) return "No NAV history";
  const historyStart = periodStart(f.anchor.date, { years: conditions.minHistoryYears });
  if (series.first > historyStart || !navOn(series, historyStart, "previous")) {
    return `New fund — less than ${conditions.minHistoryYears} years of NAV history (first NAV ${series.first})`;
  }
  const age = daysBetween(f.anchor.date, asOf);
  if (age > conditions.maxNavAgeDays) return `Latest NAV is from ${f.anchor.date}, more than ${conditions.maxNavAgeDays} days old`;
  const jump = largestJump(series, periodStart(f.anchor.date, { years: config.dataBreakYears }), f.anchor);
  if (jump.move > config.navJumpMax) return `NAV history break on ${jump.date} (one-day move of ${(jump.move * 100).toFixed(1)}%)`;
  if (!ignoreAum) {
    if (!isNum(fund.aum)) return "AUM not published";
    if (fund.aum < conditions.minAumCr) return `AUM ₹${fund.aum.toLocaleString("en-IN")} Cr is below the minimum ₹${conditions.minAumCr.toLocaleString("en-IN")} Cr`;
  }
  return null;
}

// ---------- normalisation ----------
/** Percentile of each value among `values` (0 worst … 100 best), ties at their average position. */
export function percentiles(entries, better) {
  const sorted = [...entries].sort((a, b) => (better === "lower" ? b.value - a.value : a.value - b.value));
  const n = sorted.length;
  const out = new Map();
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1].value === sorted[i].value) j++;
    const position = (i + j) / 2;
    for (let k = i; k <= j; k++) out.set(sorted[k].code, n > 1 ? (position / (n - 1)) * 100 : 50);
    i = j + 1;
  }
  return out;
}

export function scoreCategory({ funds, benchmark = null, asOf, settings = null, config = SCORECARD, ignoreAum = false }) {
  const { weights: savedWeights, conditions, custom } = resolveSettings(settings, config);
  const weights = ignoreAum ? { ...savedWeights, quality: 0 } : savedWeights;
  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);
  const windowYears = windowOf(conditions.minHistoryYears);
  const all = funds.map((fund) => ({ fund, f: fundMeasures(fund, { benchmark, asOf, config, windowYears }) }));
  const notRated = [];
  const eligible = [];
  for (const row of all) {
    const reason = conditionFailure(row.fund, row.f, { asOf, conditions, config, ignoreAum });
    if (reason) notRated.push({ code: row.fund.code, name: row.fund.name, reason, measures: row.f.measures });
    else eligible.push(row);
  }

  // Peer group for the median and the calendar quartiles: every fund of the category with a current NAV — the same
  // group as the peer statistics behind the Recommendation Logic (not only the rated funds).
  const peers = all.filter((r) => r.f.anchor && daysBetween(r.f.anchor.date, asOf) <= conditions.maxNavAgeDays);
  // Consistency vs the category median: per month-end, the median of the peer group's rolling 3Y returns.
  const ends = [...new Set(peers.flatMap((r) => Object.keys(r.f.rolling3y)))].sort();
  const medians = {};
  for (const e of ends) {
    const vals = peers.map((r) => r.f.rolling3y[e]).filter(isNum).sort((a, b) => a - b);
    if (vals.length >= conditions.minPeers) medians[e] = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
  }
  for (const r of eligible) {
    const windows = Object.keys(medians).filter((e) => isNum(r.f.rolling3y[e]));
    r.f.measures.rollingAboveMedian = windows.length >= config.minWindows
      ? (windows.filter((e) => r.f.rolling3y[e] >= medians[e]).length / windows.length) * 100 : null;
  }
  // Calendar years in the top half (E9 quartile 1–2 among the peer group's funds with that year's return).
  const years = [...new Set(peers.flatMap((r) => Object.keys(r.f.annual)))];
  const quartiles = new Map(peers.map((r) => [r.fund.code, []]));
  for (const y of years) {
    const ranked = peers.filter((r) => isNum(r.f.annual[y])).sort((a, b) => b.f.annual[y] - a.f.annual[y]);
    if (ranked.length < conditions.minPeers) continue;
    for (const r of ranked) {
      const rank = 1 + ranked.findIndex((x) => x.f.annual[y] === r.f.annual[y]);   // ties share the better rank
      quartiles.get(r.fund.code).push(quartileOf(rank, ranked.length));
    }
  }
  for (const r of eligible) {
    const q = quartiles.get(r.fund.code) ?? [];
    r.f.measures.calendarTopHalf = q.length >= config.minCalendarYears ? (q.filter((x) => x <= 2).length / q.length) * 100 : null;
  }

  const windowLabel = (label) => label.replace("(3Y)", `(${windowYears}Y)`);   // drawdown / excess follow the window
  const pillars = PILLARS.map((p) => ({ key: p.key, label: p.label, weight: weights[p.key], measures: p.measures.map((m) => ({ ...m, label: windowLabel(m.label), used: false })) }));
  const base = { asOf, weights, conditions, custom, pillars, windowYears };
  if (eligible.length < conditions.minPeers) {
    return { ...base, rated: [], notRated: [...notRated, ...eligible.map((r) => ({ code: r.fund.code, name: r.fund.name, reason: "Category has too few eligible funds to rank", measures: r.f.measures }))],
      categoryReason: `Only ${eligible.length} fund${eligible.length === 1 ? "" : "s"} meet the conditions — at least ${conditions.minPeers} are needed to rank a category.` };
  }

  // Percentiles per measure (only measures enough funds have).
  const pct = {};
  for (const p of pillars) {
    for (const m of p.measures) {
      const entries = eligible.filter((r) => isNum(r.f.measures[m.key])).map((r) => ({ code: r.fund.code, value: r.f.measures[m.key] }));
      if (entries.length < conditions.minPeers) continue;
      m.used = true;
      pct[m.key] = percentiles(entries, m.better);
    }
  }

  const scored = [];
  for (const r of eligible) {
    const pillarScores = {};
    const notes = [];
    let missingPillar = null;
    for (const p of pillars) {
      const vals = p.measures.filter((m) => m.used && pct[m.key].has(r.fund.code)).map((m) => pct[m.key].get(r.fund.code));
      const missing = p.measures.filter((m) => m.used && !pct[m.key].has(r.fund.code)).map((m) => m.label);
      if (missing.length && vals.length) notes.push(`${missing.join(", ")} not available — ${p.label} scored on the other measures`);
      if (!vals.length) { if (p.weight > 0) missingPillar = p.label; pillarScores[p.key] = null; continue; }
      pillarScores[p.key] = mean(vals);
    }
    if (missingPillar) {
      notRated.push({ code: r.fund.code, name: r.fund.name, reason: `Not enough data to score ${missingPillar}`, measures: r.f.measures });
      continue;
    }
    const score = pillars.reduce((s, p) => s + (p.weight > 0 ? p.weight * pillarScores[p.key] : 0), 0) / totalWeight;
    const measures = {};
    for (const p of pillars) for (const m of p.measures) {
      measures[m.key] = { value: r.f.measures[m.key] ?? null, pct: m.used && pct[m.key].has(r.fund.code) ? pct[m.key].get(r.fund.code) : null };
    }
    measures.trackingError = { value: r.f.measures.trackingError ?? null, pct: null };
    scored.push({ code: r.fund.code, name: r.fund.name, score: Math.round(score * 100) / 100, pillars: pillarScores, measures, notes, recovered: r.f.drawdown?.recovered ?? null });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  scored.forEach((s, i) => {
    s.rank = i > 0 && s.score === scored[i - 1].score ? scored[i - 1].rank : i + 1;
  });
  scored.forEach((s) => { s.quartile = quartileOf(s.rank, scored.length); });
  if (scored.length < conditions.minPeers) {
    return { ...base, rated: [], notRated: [...notRated, ...scored.map((s) => ({ code: s.code, name: s.name, reason: "Category has too few eligible funds to rank" }))],
      categoryReason: `Only ${scored.length} funds can be scored — at least ${conditions.minPeers} are needed to rank a category.` };
  }
  return { ...base, rated: scored, notRated, categoryReason: null };
}

/**
 * Model check: rate the category as it stood `backtestYears` ago (same method; AUM then is unknown, so the AUM
 * condition and the Quality pillar are left out), then measure each fund's return from that date to now.
 * → { from, to, years, quartiles: [{ quartile, funds, avgReturn, beatMedian }], categoryAvg, median, funds, edge } | null
 *   edge: the top quartile beat the category by backtestEdge.overCategory and the bottom quartile by .overBottom (p.a.)
 */
export function backtestCategory({ funds, benchmark = null, asOf, settings = null, config = SCORECARD }) {
  const from = periodStart(asOf, { years: config.backtestYears });
  const past = scoreCategory({ funds, benchmark, asOf: from, settings, config, ignoreAum: true });
  if (!past.rated.length) return null;
  const forward = new Map();
  for (const fund of funds) {
    const start = anchorNav(fund.series, from), end = anchorNav(fund.series, asOf);
    if (start && end && daysBetween(start.date, from) <= config.conditions.maxNavAgeDays && end.date > start.date) {
      forward.set(fund.code, returnBetween(start, end, true));
    }
  }
  const rows = past.rated.filter((r) => forward.has(r.code)).map((r) => ({ ...r, forward: forward.get(r.code) }));
  if (rows.length < past.conditions.minPeers) return null;
  const values = rows.map((r) => r.forward).sort((a, b) => a - b);
  const median = values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
  const quartiles = [1, 2, 3, 4].map((q) => {
    const group = rows.filter((r) => r.quartile === q);
    return { quartile: q, funds: group.length, avgReturn: group.length ? mean(group.map((r) => r.forward)) : null,
      beatMedian: group.filter((r) => r.forward > median).length };
  });
  const categoryAvg = mean(values);
  const q1 = quartiles[0].avgReturn, q4 = quartiles[3].avgReturn;
  // A clear edge only when the top quartile beat the category and the bottom quartile by a meaningful margin.
  const edge = isNum(q1) && isNum(q4) && q1 - categoryAvg >= config.backtestEdge.overCategory && q1 - q4 >= config.backtestEdge.overBottom;
  return { from, to: asOf, years: config.backtestYears, quartiles, categoryAvg, median, funds: rows.length, edge };
}
