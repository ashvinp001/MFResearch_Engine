/**
 * Automatic Invest / Hold / Sell pre-selection — Recommendation_Logic.md (owner-approved logic, v1).
 *
 * autoRecommend({ portfolio, schemes, peerStats, fundHoldings, config }) → {
 *   version, asOf,
 *   suggestions: { [holdingKey]: Suggestion }   one per active holding
 *   fit: { funds, range, smallPct, passive, passiveMax, exits, fundsAfter, staged, stagedPct, open }   portfolio summary
 *   flags: [{ id, text }]                        the Suggestion Box (portfolio-level points, client wording)
 * } | null when peer statistics are not available (nothing is pre-selected then).
 *
 *   portfolio     validated (revalued) NormalizedPortfolio
 *   schemes       { [isin]: AMFI scheme { schemeCode, schemeName, amc, plan, assetClass, category } } (fund lists)
 *   peerStats     { asOf, funds: { [code]: FundStats }, groups: { [plan|assetClass|category]: GroupStats } }
 *                 from data-pipeline/peer_stats.py (percent units; sharpe3y a plain ratio)
 *   fundHoldings  { [isin]: { holdings: [{ assetType, sector, rating, weight }] } } (PulseDB) — debt credit quality
 *   profile       buildReportProfile result (risk and horizon choose the Large / Mid / Small basket); null → Balanced
 *
 * Suggestion = { status: "invest"|"hold"|"sell"|"review", verdict: status or null for review,
 *                grade: STRONG|MIXED|WEAK|HOLD|REVIEW, engine, ruleId, reason, details: [string], notes: [string],
 *                pillars: { R, K, C, S, Q } each { state: "+"|"-"|"0"|"?", text }, peers,
 *                excess: { e1, e3, e5 } (pp vs category median) | null,
 *                benchmark: { name, b1, b3, b5 } (pp vs the fund's own benchmark; index funds: b3 = tracking) | null,
 *                schemeCode, weightPct, trim: { fromPct, toPct, cutPct, amount (₹) } | null   a partial sale,
 *                move: where the money goes | null, compare: { otherName, rows } | null   the fund it gave way to }
 * Stage 1 (fund-grading.js) grades each fund alone; Stage 2 (portfolio-fit.js) decides for the whole portfolio.
 * A REVIEW fund is never pre-selected (verdict null): the advisor decides, with the reason shown.
 *
 * Ground rules (§1): a missing figure is UNKNOWN — never a pass, never a fail; no SELL on a single
 * metric; peers = same AMFI category and plan; CAS gain on cost is never used; every call explained.
 */

import { RECOMMENDATION } from "../config.js";
import { holdingKey } from "../model/portfolio.schema.js";
import { toPaise } from "../cas/parse-values.js";
import { isNum } from "../analytics/stats.js";
import { creditQuality, elssLock, engineOf, gradeFund, isElss, pp } from "./fund-grading.js";
import { fundOverlap } from "./fund-overlap.js";
import { capSplit, comparison, decidePortfolio, fitNotes, fundCall, suggestionBox } from "./portfolio-fit.js";

/** Stage 2 + mapping to the three buttons (§5, §6). */
export function autoRecommend({ portfolio, schemes = {}, peerStats = null, fundHoldings = null, profile = null, config = RECOMMENDATION }) {
  if (!peerStats?.funds || !peerStats?.asOf) return null;
  const active = portfolio.holdings.filter((h) => h.status === "active");
  const totalPaise = active.reduce((s, h) => s + (toPaise(h.raw.marketValue) ?? 0), 0);
  const asOf = peerStats.asOf;

  const holdingRows = active.map((holding) => {
    const scheme = holding.isin ? schemes[holding.isin] ?? null : null;
    const stats = scheme ? peerStats.funds[String(scheme.schemeCode)] ?? null : null;
    const group = stats ? peerStats.groups?.[stats.group] ?? null : null;
    const paise = toPaise(holding.raw.marketValue) ?? 0;
    const graded = gradeFund({
      scheme, name: holding.schemeName, stats, group, statsAsOf: asOf,
      credit: engineOf(scheme, holding.schemeName) === "debt" ? creditQuality(fundHoldings?.[holding.isin], config) : null,
    }, config);
    return { holding, key: holdingKey(holding), scheme, stats, median: group?.median ?? null, graded, weightPct: totalPaise ? (paise / totalPaise) * 100 : 0, notes: [] };
  });

  // One fund = one call: the same scheme held in several folios, or in both its Regular and Direct plans (the same
  // portfolio), is judged once — on the holding with the larger value — with the combined share of the portfolio.
  const byFund = new Map();
  for (const row of holdingRows) {
    const k = row.scheme ? `${row.scheme.amc}|${row.scheme.schemeName.toLowerCase().replace(/\s+/g, " ").trim()}` : `holding|${row.key}`;
    byFund.set(k, [...(byFund.get(k) ?? []), row]);
  }
  const rows = [...byFund.values()].map((members) => {
    const rep = members.reduce((a, b) => (b.weightPct > a.weightPct ? b : a));
    const fund = { ...rep, members, weightPct: members.reduce((s, m) => s + m.weightPct, 0), notes: [] };
    if (members.length > 1) {
      const plans = new Set(members.map((m) => m.scheme?.plan));
      fund.notes.push(plans.size > 1
        ? `Held in both the ${[...plans].join(" and ")} plans of this fund (the same portfolio), ${fund.weightPct.toFixed(1)}% of the portfolio together — consider consolidating into one plan.`
        : `Held in ${members.length} folios (${fund.weightPct.toFixed(1)}% of the portfolio together) — consider merging them into one folio through the registrar (CAMS / KFintech); no sale is needed.`);
    }
    return fund;
  });

  // A STRONG fund that should not take new money right now (§6): already a large share, or 1Y sharply behind.
  for (const row of rows) {
    if (row.graded.grade !== "STRONG") continue;
    const e1 = row.graded.excess?.e1;
    if (row.weightPct > config.investMaxWeightPct && !["passive", "debt", "arbitrage"].includes(row.graded.engine)) {   // debt is outside the 20% limit
      row.blocker = { ruleId: "strong-large-share", reason: `Strong, but already ${row.weightPct.toFixed(1)}% of the portfolio. ${row.graded.reason}` };
    } else if (isNum(e1) && e1 < config.investMin1yExcessPp) {
      row.blocker = { ruleId: "strong-1y-lag", reason: `Strong over 3–5 years, but 1Y ${pp(e1)} vs category median — hold until it recovers. ${row.graded.reason}` };
    }
  }

  const overlaps = new Map();
  const overlapOf = (a, b) => {
    const k = [a.key, b.key].sort().join("|");
    if (!overlaps.has(k)) overlaps.set(k, fundOverlap(fundHoldings?.[a.holding.isin], fundHoldings?.[b.holding.isin]));
    return overlaps.get(k);
  };
  for (const row of rows) row.cap = capSplit(fundHoldings?.[row.holding.isin]);

  const totalRupees = totalPaise / 100;
  const plan = decidePortfolio(rows, { totalRupees, asOf, profile }, overlapOf, config);
  const exitedPlan = rows.find((r) => r.fitExit?.limit === "passive-poor")?.scheme?.plan;
  const pick = plan.passiveAllPoor ? peerStats.indexPicks?.[exitedPlan] ?? peerStats.indexPicks?.Direct ?? null : null;

  const suggestions = {};
  for (const fund of rows) {
    const call = fundCall(fund, rows, plan, config);
    const compare = comparison(fund);
    const notes = [...fund.notes, ...fitNotes(fund, rows)];   // no Regular-vs-Direct note: the advisor recommends both plans (owner's decision)
    for (const row of fund.members) {
      // The fund's call for every folio / plan of it; the ELSS lock-in is checked per folio (its own units).
      const { holding } = row;
      const { graded } = fund;
      let { status, ruleId, reason } = call;
      if (status === "sell" && isElss(row.scheme, holding.schemeName)) {
        const lock = elssLock(holding, asOf, config);
        if (lock === null) { status = "review"; ruleId = "elss-lock-unknown"; reason = `Exit suggested, but this ELSS fund's lock-in cannot be told (no transaction history in the CAS). ${reason}`; }
        else if (lock.units > 0) { status = "hold"; ruleId = "elss-locked"; reason = `Exit suggested, but ${lock.units.toFixed(3)} units are in the ELSS lock-in (all free by ${lock.until}) — review then. ${reason}`; }
      }
      const sold = status === "sell";
      // A partial sale, per folio in proportion to its value: the amount the summary and the report count as sold.
      const trim = sold && call.trim ? { ...call.trim, amount: (((toPaise(holding.raw.marketValue) ?? 0) / 100) * call.trim.cutPct) / call.trim.fromPct } : null;
      suggestions[row.key] = {
        status, verdict: status === "review" ? null : status, grade: graded.grade, engine: graded.engine, ruleId, reason,
        stage: ruleId.startsWith("fit-") ? "portfolio" : "fund",
        details: graded.details, notes, pillars: graded.pillars, peers: graded.peers ?? null, excess: graded.excess ?? null,
        benchmark: graded.benchmarkName ? { name: graded.benchmarkName, ...graded.benchmarkExcess } : null,
        schemeCode: row.scheme?.schemeCode ?? null, weightPct: row.weightPct, fundWeightPct: fund.weightPct, folios: fund.members.length,
        trim, move: sold ? call.move ?? null : null, compare,
      };
    }
  }
  return {
    version: config.version, asOf, suggestions,
    fit: { funds: plan.count0, range: plan.ctx.range, smallPct: plan.ctx.smallPct, passive: plan.passive0, passiveMax: plan.ctx.passiveMax,
      exits: plan.exits.length, fundsAfter: plan.fundsAfter, staged: plan.fundsAfter > plan.ctx.range.max, stagedPct: plan.spent, basket: plan.ctx.basket.label, open: plan.fundsAfter > plan.ctx.range.max ? ["count"] : [] },
    flags: suggestionBox(rows, plan, { totalRupees, pick, overlapOf }, config),
  };
}
