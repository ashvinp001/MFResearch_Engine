/**
 * Fund Scorecard for index funds — every fund tracking ONE index (index-funds.js TRACKED_INDICES) rated 0–100 on how
 * well it tracks that index, and ranked. Active-fund measures (alpha, beta, capture) say nothing about an index fund;
 * what separates two NIFTY 50 index funds is cost and tracking quality.
 *
 * scoreIndexCategory({ funds, asOf, config }) → same shape as fund-scorecard.scoreCategory:
 *   { asOf, weights, conditions, custom: false, kind: "index", pillars, rated, notRated, categoryReason }
 * funds: [{ code, name, series, aum, benchmarkSeries (the tracked index, from the verified mapping) }]
 *
 * Measures (each fund at its own ANCHOR — latest NAV on or before asOf; the index at the price on that date, E1
 * NEAREST-PREVIOUS):
 *   Tracking difference   fund return − index return: 1Y (E2), 3Y CAGR (E2). Higher (closer to zero) is better.
 *   Tracking error        STDEV.S of daily (fund − index) returns over consecutive dates both have, × √252:
 *                         last 1 year, last 3 years. Lower is better.
 *   Tracking consistency  spread (STDEV.S) of the rolling 1Y tracking difference at the last 12 completed month-ends.
 *                         Lower is steadier. Needs about 2 years of history.
 *   Fund quality          AUM (larger is better — lower impact cost for an index fund).
 * Conditions: NAV history ≥ minHistoryYears, latest NAV ≤ maxNavAgeDays old, index history available, AUM published and
 *   ≥ minAumCr, no day-on-day NAV move above navJumpMax in the last year. Failing funds are Not rated with the reason.
 * Normalisation as fund-scorecard: percentile among eligible funds per measure (only when ≥ minPeers funds have it);
 * pillar = mean of its measures; score = weighted mean of the pillars the fund has. Tracking difference and tracking
 * error are required; without consistency (a fund under ~2 years) the other pillars carry its weight (noted).
 */

import { SCORECARD } from "../config.js";
import { anchorNav, daysBetween, navOn, periodStart, trailingReturn } from "../analytics/returns.js";
import { lastCompletedMonthEnd, monthEnds } from "../analytics/risk.js";
import { percentiles, quartileOf } from "./fund-scorecard.js";

export const INDEX_PILLARS = Object.freeze([
  { key: "trackingDiff", label: "Tracking difference", required: true, measures: [
    { key: "td1y", label: "Tracking difference (1Y)", better: "higher", unit: "pct" },
    { key: "td3y", label: "Tracking difference (3Y, p.a.)", better: "higher", unit: "pct" }] },
  { key: "trackingError", label: "Tracking error", required: true, measures: [
    { key: "te1y", label: "Tracking error (1Y)", better: "lower", unit: "pct" },
    { key: "te3y", label: "Tracking error (3Y)", better: "lower", unit: "pct" }] },
  { key: "trackingConsistency", label: "Tracking consistency", required: false, measures: [
    { key: "tdSpread", label: "Spread of rolling 1Y tracking difference", better: "lower", unit: "pct" }] },
  { key: "quality", label: "Fund quality", required: false, measures: [
    { key: "aum", label: "AUM", better: "higher", unit: "cr" }] },
]);

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
function sampleStd(xs) {
  if (xs.length < 2) return null;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Tracking difference for a period: fund return − index return, both at the fund's anchor date. */
function trackingDiff(series, index, anchor, period) {
  const f = trailingReturn(series, period, anchor);
  const ia = navOn(index, anchor.date, "previous");
  const i = ia ? trailingReturn(index, period, ia) : null;
  return isNum(f) && isNum(i) ? f - i : null;
}

/** Annualised tracking error from daily return differences over consecutive dates both series have, (from, anchor]. */
function trackingError(series, index, fromDate, anchor, cfg, minDays) {
  const i0 = series.dates.findIndex((d) => d > fromDate);
  if (i0 < 0) return null;
  const diffs = [];
  let prev = null;
  for (let i = i0 - 1 < 0 ? 0 : i0 - 1; i < series.dates.length && series.dates[i] <= anchor.date; i++) {
    const d = series.dates[i], k = index.index.get(d);
    if (k === undefined) continue;
    if (prev && d > fromDate) diffs.push((series.navs[i] / prev.f - 1) - (index.navs[k] / prev.i - 1));
    prev = { f: series.navs[i], i: index.navs[k] };
  }
  const s = diffs.length >= minDays ? sampleStd(diffs) : null;
  return s === null ? null : s * Math.sqrt(cfg.tradingDaysPerYear);
}

export function indexFundMeasures(fund, { asOf, config = SCORECARD }) {
  const cfg = config.index;
  const series = fund.series, index = fund.benchmarkSeries;
  const anchor = series ? anchorNav(series, asOf) : null;
  if (!anchor || !index) return { anchor, measures: {} };
  const m = {
    td1y: trackingDiff(series, index, anchor, { months: 12 }),
    td3y: trackingDiff(series, index, anchor, { years: 3 }),
    te1y: trackingError(series, index, periodStart(anchor.date, { years: 1 }), anchor, cfg, cfg.minCommonDays),
    te3y: trackingError(series, index, periodStart(anchor.date, { years: 3 }), anchor, cfg, cfg.minCommonDays * 3),
    aum: isNum(fund.aum) ? fund.aum : null,
  };
  const rolling = monthEnds(lastCompletedMonthEnd(anchor.date), cfg.consistencyMonths).map((e) => {
    const a = anchorNav(series, e);
    return a && daysBetween(a.date, e) <= 10 ? trackingDiff(series, index, a, { months: 12 }) : null;
  });
  m.tdSpread = rolling.every(isNum) ? sampleStd(rolling) : null;
  return { anchor, measures: m };
}

function conditionFailure(fund, f, { asOf, conditions, config }) {
  const series = fund.series;
  if (!series?.dates.length || !f.anchor) return "No NAV history";
  if (!fund.benchmarkSeries) return "The tracked index's price history is not available";
  const start = periodStart(f.anchor.date, { years: conditions.minHistoryYears });
  if (series.first > start || !navOn(series, start, "previous")) {
    return `New fund — less than ${conditions.minHistoryYears} year${conditions.minHistoryYears === 1 ? "" : "s"} of NAV history (first NAV ${series.first})`;
  }
  if (daysBetween(f.anchor.date, asOf) > conditions.maxNavAgeDays) return `Latest NAV is from ${f.anchor.date}, more than ${conditions.maxNavAgeDays} days old`;
  const from = series.dates.findIndex((d) => d >= periodStart(f.anchor.date, { years: 1 }));
  for (let i = Math.max(1, from); i < series.dates.length && series.dates[i] <= f.anchor.date; i++) {
    const move = Math.abs(series.navs[i] / series.navs[i - 1] - 1);
    if (move > config.navJumpMax) return `NAV history break on ${series.dates[i]} (one-day move of ${(move * 100).toFixed(1)}%)`;
  }
  if (!isNum(fund.aum)) return "AUM not published";
  if (fund.aum < conditions.minAumCr) return `AUM ₹${fund.aum.toLocaleString("en-IN")} Cr is below the minimum ₹${conditions.minAumCr.toLocaleString("en-IN")} Cr`;
  return null;
}

export function scoreIndexCategory({ funds, asOf, config = SCORECARD }) {
  const { weights, conditions } = config.index;
  const all = funds.map((fund) => ({ fund, f: indexFundMeasures(fund, { asOf, config }) }));
  const notRated = [], eligible = [];
  for (const row of all) {
    const reason = conditionFailure(row.fund, row.f, { asOf, conditions, config });
    if (reason) notRated.push({ code: row.fund.code, name: row.fund.name, reason, measures: row.f.measures });
    else eligible.push(row);
  }
  const pillars = INDEX_PILLARS.map((p) => ({ key: p.key, label: p.label, weight: weights[p.key], measures: p.measures.map((m) => ({ ...m, used: false })) }));
  const base = { asOf, weights, conditions, custom: false, kind: "index", pillars };
  const tooFew = (n) => `Only ${n} fund${n === 1 ? "" : "s"} tracking this index meet the conditions — at least ${conditions.minPeers} are needed to rank them.`;
  if (eligible.length < conditions.minPeers) {
    return { ...base, rated: [], notRated: [...notRated, ...eligible.map((r) => ({ code: r.fund.code, name: r.fund.name, reason: "Too few eligible funds track this index to rank" }))], categoryReason: tooFew(eligible.length) };
  }
  const pct = {};
  for (const p of pillars) for (const m of p.measures) {
    const entries = eligible.filter((r) => isNum(r.f.measures[m.key])).map((r) => ({ code: r.fund.code, value: r.f.measures[m.key] }));
    if (entries.length < conditions.minPeers) continue;
    m.used = true;
    pct[m.key] = percentiles(entries, m.better);
  }
  const scored = [];
  for (const r of eligible) {
    const pillarScores = {}, notes = [];
    let missing = null, sum = 0, wsum = 0;
    for (const p of pillars) {
      const vals = p.measures.filter((m) => m.used && pct[m.key].has(r.fund.code)).map((m) => pct[m.key].get(r.fund.code));
      const absent = p.measures.filter((m) => m.used && !pct[m.key].has(r.fund.code)).map((m) => m.label);
      if (!vals.length) {
        pillarScores[p.key] = null;
        if (INDEX_PILLARS.find((x) => x.key === p.key).required) missing = p.label;
        else if (p.weight > 0) notes.push(`${p.label} not available (needs a longer history) — the score rests on the other pillars`);
        continue;
      }
      if (absent.length) notes.push(`${absent.join(", ")} not available — ${p.label} scored on the other measures`);
      pillarScores[p.key] = vals.reduce((s, v) => s + v, 0) / vals.length;
      sum += p.weight * pillarScores[p.key];
      wsum += p.weight;
    }
    if (missing) { notRated.push({ code: r.fund.code, name: r.fund.name, reason: `Not enough data to score ${missing}`, measures: r.f.measures }); continue; }
    const measures = {};
    for (const p of pillars) for (const m of p.measures) {
      measures[m.key] = { value: r.f.measures[m.key] ?? null, pct: m.used && pct[m.key].has(r.fund.code) ? pct[m.key].get(r.fund.code) : null };
    }
    measures.trackingError = { value: null, pct: null };
    scored.push({ code: r.fund.code, name: r.fund.name, score: Math.round((sum / wsum) * 100) / 100, pillars: pillarScores, measures, notes });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  scored.forEach((s, i) => { s.rank = i > 0 && s.score === scored[i - 1].score ? scored[i - 1].rank : i + 1; });
  scored.forEach((s) => { s.quartile = quartileOf(s.rank, scored.length); });
  if (scored.length < conditions.minPeers) {
    return { ...base, rated: [], notRated: [...notRated, ...scored.map((s) => ({ code: s.code, name: s.name, reason: "Too few eligible funds track this index to rank" }))], categoryReason: tooFew(scored.length) };
  }
  return { ...base, rated: scored, notRated, categoryReason: null };
}
