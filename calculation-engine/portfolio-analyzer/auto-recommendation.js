/**
 * Automatic Invest / Hold / Sell pre-selection — Recommendation_Logic.md (owner-approved logic, v1).
 *
 * autoRecommend({ portfolio, schemes, peerStats, fundHoldings, config }) → {
 *   version, asOf,
 *   suggestions: { [holdingKey]: Suggestion }   one per active holding
 *   fit: { funds, range, smallPct, passive, passiveMax, exits, fundsAfter, open }   portfolio-fit summary (v1.4)
 *   flags: [{ id, text }]                        the Suggestion Box (portfolio-level points, client wording)
 * } | null when peer statistics are not available (nothing is pre-selected then).
 *
 *   portfolio     validated (revalued) NormalizedPortfolio
 *   schemes       { [isin]: AMFI scheme { schemeCode, schemeName, amc, plan, assetClass, category } } (fund lists)
 *   peerStats     { asOf, funds: { [code]: FundStats }, groups: { [plan|assetClass|category]: GroupStats } }
 *                 from data-pipeline/peer_stats.py (percent units; sharpe3y a plain ratio)
 *   fundHoldings  { [isin]: { holdings: [{ assetType, sector, rating, weight }] } } (PulseDB) — debt credit quality
 *
 * Suggestion = { status: "invest"|"hold"|"sell"|"review", verdict: status or null for review,
 *                grade: STRONG|MIXED|WEAK|HOLD|REVIEW, engine, ruleId, reason, details: [string], notes: [string],
 *                pillars: { R, K, C, S, Q } each { state: "+"|"-"|"0"|"?", text }, peers,
 *                excess: { e1, e3, e5 } (pp vs category median) | null,
 *                benchmark: { name, b1, b3, b5 } (pp vs the fund's own benchmark; index funds: b3 = tracking) | null,
 *                schemeCode, weightPct }
 * v1.1: pillar B (own benchmark, from peerStats.funds[code].benchmark) — breaks "in line" ties both ways;
 * index funds judged on tracking; sectoral / thematic on their own index; the weakest duplicate in a category
 * is sold when it is behind both its category and its benchmark.
 * A REVIEW fund is never pre-selected (verdict null): the advisor decides, with the reason shown.
 *
 * Ground rules (§1): a missing figure is UNKNOWN — never a pass, never a fail; no SELL on a single
 * metric; peers = same AMFI category and plan; CAS gain on cost is never used; every call explained.
 */

import { RECOMMENDATION } from "../config.js";
import { holdingKey } from "../model/portfolio.schema.js";
import { toPaise } from "../cas/parse-values.js";
import { daysBetween } from "../analytics/returns.js";
import { assetGroup } from "./portfolio-performance.js";
import { diversificationStatus } from "./report-profile.js";

const UP = "+", DOWN = "-", FLAT = "0", UNKNOWN = "?";
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
// Two decimals in reasons, so a value next to a threshold (e.g. −1.04 vs the −1.00 limit) reads correctly.
const pp = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)} pp`;
const pc = (x) => `${x >= 0 ? "" : "−"}${Math.abs(x).toFixed(1)}%`;

/** Which rule set applies to a fund (§4). */
export function engineOf(scheme, name = "") {
  if (!scheme) return "unlisted";
  const category = scheme.category ?? "";
  const text = `${category} ${scheme.schemeName ?? ""} ${name}`;
  if (/\(legacy\)/i.test(category)) return "legacy";
  // Gold / silver only: "NIFTY Commodities" is an equity sector index, judged like any sector fund.
  if (/\bgold\b|\bsilver\b|precious\s*metal/i.test(text)) return "commodity";
  if (/fof overseas/i.test(category)) return "overseas";
  if (/fof domestic/i.test(category)) return "fof";
  if (/solution/i.test(scheme.assetClass ?? "")) return "solution";
  if (scheme.plan === "ETF" || /\bindex funds?\b|\betfs?\b/i.test(category)) return "passive";
  if (scheme.assetClass === "Equity") return /sectoral|thematic/i.test(category) ? "thematic" : "equity";
  if (scheme.assetClass === "Hybrid") return /arbitrage/i.test(category) ? "arbitrage" : "hybrid";
  if (scheme.assetClass === "Debt") return "debt";
  return "other";
}

const HOLD_ENGINES = {
  commodity: "Gold / silver / commodity fund — held for diversification; judged on its exposure, not against active funds.",
  overseas: "Overseas fund of funds — held for global exposure; no like-for-like Indian peer group.",
  fof: "Domestic fund of funds — its result depends on the underlying funds; no clean peer group.",
  solution: "Solution-oriented (retirement / children's) fund — lock-in and goal-based; not graded against peers.",
};

/** Share of the fund's debt + cash in AAA / A1+ / Sovereign / cash, or null when it cannot be told (§4.4 Q). */
export function creditQuality(entry, config = RECOMMENDATION) {
  const rows = (entry?.holdings ?? []).filter((r) => (r.assetType === "debt" || r.assetType === "cash") && isNum(r.weight) && r.weight > 0);
  const total = rows.reduce((s, r) => s + r.weight, 0);
  if (!(total > 0)) return null;
  let high = 0, unknown = 0;
  for (const r of rows) {
    const rating = (r.rating ?? "").toUpperCase();
    if (r.assetType === "cash" || /^(AAA|A1\+|SOVEREIGN)/.test(rating) || (!rating && /govt-sec/i.test(r.sector ?? ""))) high += r.weight;
    else if (!rating) unknown += r.weight;
  }
  if ((unknown / total) * 100 > config.creditUnknownMax) return null;
  return (high / total) * 100;
}

/**
 * Portfolio overlap of two funds' equity holdings (MF_Calculation_Engine.md E15.5.12 §8):
 * overlap = Σ over stocks held by both (by ISIN) of min(wA, wB), each fund's equity weights scaled to 100%.
 * null when either fund has no equity holdings data. 0–100.
 */
export function fundOverlap(entryA, entryB) {
  const a = equityWeights(entryA), b = equityWeights(entryB);
  if (!a || !b) return null;
  let sum = 0;
  for (const [isin, w] of a) if (b.has(isin)) sum += Math.min(w, b.get(isin));
  return sum;
}

/** The stocks two funds both hold, largest common weight first: [{ name, weight (min of the two, %) }], at most `limit`. */
export function sharedStocks(entryA, entryB, limit = 3) {
  const a = equityWeights(entryA), b = equityWeights(entryB);
  if (!a || !b) return [];
  const names = new Map((entryA?.holdings ?? []).filter((r) => r.isin && r.name).map((r) => [r.isin, r.name]));
  return [...a].filter(([isin]) => b.has(isin))
    .map(([isin, w]) => ({ name: names.get(isin) ?? isin, weight: Math.min(w, b.get(isin)) }))
    .sort((x, y) => y.weight - x.weight).slice(0, limit);
}

/** A fund's equity holdings by ISIN, weights scaled to 100% of its equity; null without equity holdings data. */
function equityWeights(entry) {
  const rows = (entry?.holdings ?? []).filter((r) => (r.assetType === "equity" || r.assetType === "foreignEquity") && r.isin && isNum(r.weight) && r.weight > 0);
  const total = rows.reduce((s, r) => s + r.weight, 0);
  if (!(total > 0)) return null;
  const by = new Map();
  for (const r of rows) by.set(r.isin, (by.get(r.isin) ?? 0) + (r.weight / total) * 100);
  return by;
}

/** ELSS units still in the 3-year lock-in on `asOf` (FIFO: redemptions use the oldest units first). */
export function elssLock(holding, asOf, config = RECOMMENDATION) {
  const units = Number(String(holding.raw?.units ?? "").replace(/,/g, ""));
  const txns = (holding.transactions ?? []).filter((t) => isNum(t.units) && t.units > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date ?? ""));
  if (!txns.length || !(units > 0)) return null;   // no transaction history → the lock cannot be told
  const [y, m, d] = asOf.split("-").map(Number);
  const cutoff = `${y - config.elssLockYears}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const recent = txns.filter((t) => t.date > cutoff).sort((a, b) => (a.date < b.date ? -1 : 1));
  const locked = Math.min(units, recent.reduce((s, t) => s + t.units, 0));
  if (!(locked > 0)) return { units: 0, until: null };
  const last = recent.at(-1).date.split("-").map(Number);
  return { units: locked, until: `${last[0] + config.elssLockYears}-${String(last[1]).padStart(2, "0")}-${String(last[2]).padStart(2, "0")}` };
}

const isElss = (scheme, name) => /elss|tax\s*saver/i.test(`${scheme?.category ?? ""} ${name ?? ""}`);

/** Stage 1 for one fund: engine, pillars, grade (§3–§4). Pure; every input explicit. */
export function gradeFund({ scheme, name, stats, group, credit = null, statsAsOf = null }, config = RECOMMENDATION) {
  const engine = engineOf(scheme, name);
  const out = (grade, ruleId, reason, extra = {}) => ({ engine, grade, ruleId, reason, pillars: {}, details: [], ...extra });

  if (engine === "unlisted") return out("REVIEW", "not-in-list", "Not in the AMFI Growth fund list (e.g. an IDCW plan) — no NAV comparison possible.");
  if (engine === "legacy") return out("REVIEW", "legacy-category", `AMFI category "${scheme.category}" is a legacy group with no clean peer set.`);
  if (engine === "other") return out("REVIEW", "no-engine", `No rule set for AMFI category "${scheme.category}".`);
  if (HOLD_ENGINES[engine]) return out("HOLD", `hold-${engine}`, HOLD_ENGINES[engine]);
  if (engine === "passive") return gradePassive(scheme, stats, config, out);
  if (!stats) return out("REVIEW", "no-stats", "No peer statistics for this fund (NAV not current or not stored).");
  if (statsAsOf && stats.navDate && daysBetween(stats.navDate, statsAsOf) > config.staleDays) {
    return out("REVIEW", "stale", `Latest NAV is from ${stats.navDate}, more than ${config.staleDays} days old.`);
  }
  if (!isNum(stats.r3y)) {
    const years = stats.firstDate && stats.navDate ? daysBetween(stats.firstDate, stats.navDate) / 365.25 : null;
    return out("REVIEW", "young", `Only ${years === null ? "a short" : years.toFixed(1) + " years of"} NAV history — fewer than 3 years to judge.`);
  }

  const bench = benchmarkPillar(stats, config);
  if (engine === "thematic") return gradeThematic(stats, bench, config, out);

  const median = group?.median ?? {};
  const excess = (k) => (isNum(stats[k]) && isNum(median[k]) ? stats[k] - median[k] : null);
  const e1 = excess("r1y"), e3 = excess("r3y"), e5 = excess("r5y");
  const peers = `${scheme.category} · ${scheme.plan} (${stats.n3y ?? group?.n?.r3y ?? "?"} funds)`;
  if (e3 === null) {
    // Too few peers: judged against its own benchmark alone, as a sectoral fund is (§4.7); REVIEW without one.
    const noPeers = `Fewer than 5 peers with a 3-year record in ${scheme.category} · ${scheme.plan}`;
    if (bench.pillar.state === UNKNOWN) return out("REVIEW", "no-peers", `${noPeers} and no benchmark data — no fair comparison.`);
    const g = gradeThematic(stats, bench, config, out, false);   // a diversified fund: no sector check
    return { ...g, ruleId: g.ruleId.replace("thematic", "no-peers"), reason: `${noPeers}, so judged against its own index. ${g.reason.replace(/^Sectoral \/ thematic fund without benchmark data — not judged against mixed-sector peers\. /, "")}` };
  }

  const gap = engine === "debt" ? config.debtGapPp : config.equityGapPp;
  const pillars = {};
  const B = bench.pillar;

  // R — return persistence (3Y and 5Y vs category median; 3Y and 1Y when there is no 5Y comparison).
  if (e5 !== null) {
    pillars.R = { state: e3 >= 0 && e5 >= 0 ? UP : e3 < -gap && e5 < -gap ? DOWN : FLAT, text: `3Y ${pp(e3)}, 5Y ${pp(e5)} vs category median` };
  } else if (e1 !== null) {
    pillars.R = { state: e3 >= 0 && e1 >= 0 ? UP : e3 < -2 * gap && e1 < 0 ? DOWN : FLAT, text: `3Y ${pp(e3)}, 1Y ${pp(e1)} vs category median (no 5Y comparison)` };
  } else {
    pillars.R = { state: FLAT, text: `3Y ${pp(e3)} vs category median (no 1Y / 5Y comparison)` };
  }
  // B — the fund's own benchmark, same periods and anchor date.
  pillars.B = B;
  // K — rank (E9 quartile on 3Y).
  pillars.K = isNum(stats.quartile3y)
    ? { state: stats.quartile3y === 1 ? UP : stats.quartile3y === 4 ? DOWN : FLAT, text: `3Y rank ${stats.rank3y} of ${stats.n3y} (Q${stats.quartile3y})` }
    : { state: UNKNOWN, text: "3Y rank not available" };
  // C — consistency (rolling 3Y windows at or above the category median).
  pillars.C = isNum(stats.consistency)
    ? { state: stats.consistency >= config.consistencyGood ? UP : stats.consistency < config.consistencyWeak ? DOWN : FLAT,
        text: `At or above the category median in ${Math.round(stats.consistency)}% of ${stats.windows} rolling 3Y windows` }
    : { state: UNKNOWN, text: "Consistency not available (not enough rolling windows)" };
  // S — risk: equity / hybrid = Sharpe and drawdown; debt = drawdown.
  const dd = stats.maxDrawdown3y, ddMedian = median.maxDrawdown3y;
  if (engine === "debt") {
    pillars.S = isNum(dd) && isNum(ddMedian)
      ? { state: dd >= ddMedian ? UP : dd < ddMedian - config.debtDrawdownSlackPp ? DOWN : FLAT, text: `3Y max drawdown ${pc(dd)} (category median ${pc(ddMedian)})` }
      : { state: UNKNOWN, text: "Drawdown comparison not available" };
  } else {
    const sharpeMedian = median.sharpe3y;
    pillars.S = isNum(stats.sharpe3y) && isNum(sharpeMedian) && isNum(stats.sharpeQuartile) && isNum(dd) && isNum(ddMedian)
      ? { state: stats.sharpe3y >= sharpeMedian && dd >= ddMedian ? UP : stats.sharpeQuartile === 4 && dd < ddMedian ? DOWN : FLAT,
          text: `Sharpe ${stats.sharpe3y.toFixed(2)} (median ${sharpeMedian.toFixed(2)}), 3Y max drawdown ${pc(dd)} (median ${pc(ddMedian)})` }
      : { state: UNKNOWN, text: "Risk comparison not available" };
  }

  const result = (grade, ruleId, reason) => ({ engine, grade, ruleId, reason, pillars, details: detailLines(pillars), excess: { e1, e3, e5 },
    benchmarkExcess: bench.excess, benchmarkName: bench.name, peers });
  const { R, K, C, S } = pillars;
  const neg = (...ps) => ps.some((p) => p?.state === DOWN);
  const pos = (p) => p?.state === UP;
  // "In line" with the category but behind it on both periods AND clearly behind its own benchmark (two
  // independent confirmations), with nothing positive to set against it → SELL (§3.1).
  const lagsBoth = (...others) => e3 < 0 && (e5 !== null ? e5 < 0 : e1 !== null && e1 < 0) && B.state === DOWN && !others.some(pos);
  const lagsBothReason = () => `Behind its category median (3Y ${pp(e3)}${e5 !== null ? `, 5Y ${pp(e5)}` : ""}) and its benchmark (${B.text}).`;

  if (engine === "debt") {
    const creditRisk = /credit risk/i.test(scheme.category);
    // Credit-event guard: a sharp one-day fall in a short / medium debt fund.
    if (!/gilt|long|dynamic|constant maturity/i.test(scheme.category) && isNum(stats.worstDay3y) && stats.worstDay3y < config.creditEventDayPct) {
      return result("REVIEW", "credit-event", `One-day NAV fall of ${pc(stats.worstDay3y)} in the last 3 years — possible credit event; check before acting.`);
    }
    pillars.Q = creditRisk
      ? { state: FLAT, text: "Credit Risk Fund — lower ratings are its mandate" }
      : isNum(credit)
        ? { state: credit >= config.creditGood ? UP : credit < config.creditWeak ? DOWN : FLAT, text: `${Math.round(credit)}% of debt in AAA / A1+ / Sovereign / cash` }
        : { state: UNKNOWN, text: "Credit quality not available" };
    const { Q } = pillars;
    const downs = [K, S, Q, B].filter((p) => p.state === DOWN);
    if (R.state === DOWN && downs.length) return result("WEAK", "debt-weak", `${R.text}; ${downs.map((p) => p.text).join("; ")}.`);
    if (pos(R) && (pos(K) || pos(S) || pos(B)) && !neg(S, Q, B)) return result("STRONG", "debt-strong", `${R.text}; ${[K, S, B].find(pos).text}.`);
    if (lagsBoth(K, S, Q)) return result("WEAK", "debt-lags-category-and-benchmark", lagsBothReason());
    return result("MIXED", R.state === DOWN ? "debt-watch" : "debt-mixed", R.state === DOWN ? `${R.text} — not confirmed by rank, risk, credit or benchmark; watch.` : `${R.text}.`);
  }

  if (engine === "arbitrage") {
    delete pillars.C; delete pillars.S;
    if (R.state === DOWN && (K.state === DOWN || B.state === DOWN)) return result("WEAK", "arbitrage-weak", `${R.text}; ${(K.state === DOWN ? K : B).text}.`);
    if (pos(R) && (pos(K) || pos(B)) && !neg(K, B)) return result("STRONG", "arbitrage-strong", `${R.text}; ${(pos(K) ? K : B).text}.`);
    if (lagsBoth(K)) return result("WEAK", "arbitrage-lags-category-and-benchmark", lagsBothReason());
    return result("MIXED", "arbitrage-mixed", `${R.text}.`);
  }

  // equity, hybrid
  const downs = [K, C, S, B].filter((p) => p.state === DOWN);
  if (R.state === DOWN && downs.length) return result("WEAK", "weak", `${R.text}; ${downs.map((p) => p.text).join("; ")}.`);
  if (pos(R) && ((pos(C) && (pos(K) || pos(S))) || (C.state === UNKNOWN && pos(K) && pos(S)))) {
    return result("STRONG", "strong", `${R.text}; ${pos(K) ? K.text : S.text}; ${C.state === UNKNOWN ? S.text : C.text}.`);
  }
  // Ahead of the category and of its own benchmark on 3Y and 5Y, nothing negative → STRONG as well.
  if (pos(R) && pos(B) && !neg(K, C, S)) return result("STRONG", "strong-category-and-benchmark", `${R.text}; ${B.text}.`);
  if (lagsBoth(K, C, S)) return result("WEAK", "lags-category-and-benchmark", lagsBothReason());
  return result("MIXED", R.state === DOWN ? "watch" : "mixed",
    R.state === DOWN ? `${R.text} — not confirmed by rank, consistency, risk or benchmark; watch.` : `${R.text}; ${B.text}.`);
}

function detailLines(pillars) {
  return Object.entries(pillars).map(([k, p]) => `${k} ${p.state === UNKNOWN ? "?" : p.state === FLAT ? "=" : p.state} · ${p.text}`);
}

/**
 * B — the fund vs its own benchmark (benchmark bucket via peer statistics), 3Y and 5Y (3Y and 1Y when there
 * is no 5Y), with the benchmark gap from config. Unknown when the fund has no stored benchmark.
 */
function benchmarkPillar(stats, config) {
  const bm = stats?.benchmark ?? null;
  const ex = (k) => (bm && isNum(stats[k]) && isNum(bm[k]) ? stats[k] - bm[k] : null);
  const b1 = ex("r1y"), b3 = ex("r3y"), b5 = ex("r5y");
  const gap = config.benchmarkGapPp;
  const name = bm?.name ?? bm?.code ?? null;
  let pillar;
  if (b3 === null) pillar = { state: UNKNOWN, text: bm ? `No 3-year comparison with ${name}` : "No benchmark data for this fund" };
  else if (b5 !== null) pillar = { state: b3 >= 0 && b5 >= 0 ? UP : b3 < -gap && b5 < -gap ? DOWN : FLAT, text: `vs ${name}: 3Y ${pp(b3)}, 5Y ${pp(b5)}` };
  else if (b1 !== null) pillar = { state: b3 >= 0 && b1 >= 0 ? UP : b3 < -2 * gap && b1 < 0 ? DOWN : FLAT, text: `vs ${name}: 3Y ${pp(b3)}, 1Y ${pp(b1)} (no 5Y)` };
  else pillar = { state: FLAT, text: `vs ${name}: 3Y ${pp(b3)}` };
  return { pillar, excess: { b1, b3, b5 }, name };
}

// A sector / theme index fund or ETF, by name (broad-market, factor and gold / silver funds do not match);
// overseas themes are left out — the Indian broad market is no yardstick for them.
const SECTOR_WORDS = /\b(bank|banking|financial|psu|cpse|it|tech|teck|technology|digital|internet|pharma|healthcare|health|auto|automobile|automotive|fmcg|consumption|consumer|infra|infrastructure|energy|oil|power|metal|metals|realty|real estate|media|defen[cs]e|manufacturing|commodities|mnc|capital markets?|housing|rail|railways|tourism|ev|mobility|transport|logistics|chemicals?|services)\b/i;
const OVERSEAS_INDEX = /s&p|nasdaq|msci|dow jones|ftse|global|world|hang seng|nyse|nikkei|\bus\b|u\.s\.|international|emerging|asia|china|japan|taiwan|europe|overseas/i;
const DEBT_INDEX = /\bbond|g-?sec|gilt|\bsdl\b|t-?bill|treasury|\bdebt\b|liquid|crisil[\s-]*ibx|target maturity|money market|overnight|corporate/i;

/** A sector / theme Indian equity index, by its name (also used for a fund's benchmark name). */
const isSectorIndexName = (text) => SECTOR_WORDS.test(text) && !OVERSEAS_INDEX.test(text) && !DEBT_INDEX.test(text);

export function isSectorPassive(scheme, name = "") {
  return isSectorIndexName(`${scheme?.schemeName ?? ""} ${name}`);
}

/**
 * Sector check (§4.2a): the sector's own returns vs the broad market (NIFTY 500, same anchor date).
 * lagging = more than sectorLagPp a year behind on 3Y and 5Y (2× on 3Y without a 5Y figure) AND behind over 1Y —
 * "the whole sector is not performing"; ahead = level or ahead on 3Y and 5Y (3Y and 1Y without 5Y).
 */
export function sectorCheck(sector, market, config = RECOMMENDATION, label = "Sector") {
  if (!sector || !market) return { state: "unknown", text: "No broad-market data for the sector check" };
  const d = (k) => (isNum(sector[k]) && isNum(market[k]) ? sector[k] - market[k] : null);
  const m1 = d("r1y"), m3 = d("r3y"), m5 = d("r5y");
  if (m3 === null) return { state: "unknown", text: "Fewer than 3 years to compare the sector with the market" };
  const gap = config.sectorLagPp;
  const text = `${label} vs ${market.name ?? "NIFTY 500"}: 3Y ${pp(m3)}${m5 !== null ? `, 5Y ${pp(m5)}` : ""}${m1 !== null ? `, 1Y ${pp(m1)}` : ""}`;
  const lagging = m3 < -(m5 !== null ? gap : 2 * gap) && (m5 === null || m5 < -gap) && m1 !== null && m1 < 0;
  const ahead = m3 >= 0 && (m5 !== null ? m5 >= 0 : m1 !== null && m1 >= 0);
  return { state: lagging ? "lagging" : ahead ? "ahead" : "mixed", text, m1, m3, m5 };
}

/** Index funds / ETFs (§4.6): judged on how closely they track their own benchmark over 3 years. */
function gradePassive(scheme, stats, config, out) {
  const bm = stats?.benchmark ?? null;
  if (isSectorPassive(scheme) && stats && isNum(stats.r3y)) return gradeSectorPassive(stats, config, out);
  if (!stats || !isNum(stats.r3y) || !bm || !isNum(bm.r3y)) {
    return out("HOLD", "passive-no-tracking", "Index fund / ETF — fewer than 3 years of NAV history or no benchmark data to judge its tracking.");
  }
  const td = stats.r3y - bm.r3y;   // tracking difference, % a year (benchmarks carry no costs)
  const pillars = { T: { state: td >= -config.passiveTrackingPp ? UP : DOWN, text: `3Y ${stats.r3y.toFixed(2)}% vs ${bm.name ?? bm.code} ${bm.r3y.toFixed(2)}% (tracking ${pp(td)} a year)` } };
  const extra = { pillars, details: detailLines(pillars), benchmarkExcess: { b1: null, b3: td, b5: null }, benchmarkName: bm.name ?? bm.code, benchmarkCode: bm.code };
  return td >= -config.passiveTrackingPp
    ? out("STRONG", "passive-tracks", `Index fund tracking its index closely: ${pillars.T.text}.`, extra)
    : out("HOLD", "passive-tracking-poor", `Index fund trailing its index by more than ${config.passiveTrackingPp.toFixed(1)} pp a year: ${pillars.T.text}.`, extra);
}

/**
 * Sectoral / thematic (§4.2): AMFI's peer group mixes unrelated sectors, so these are judged against their own
 * (sector / theme) benchmark only. INVEST: ahead of it on 3Y and 5Y. SELL: behind it by more than the gap on
 * 3Y and 5Y AND behind over the last year too (persistent on every horizon). Otherwise HOLD.
 */
function gradeThematic(stats, bench, config, out, withSector = true) {
  const B = bench.pillar;
  const pillars = { B };
  // M — the sector itself (its index) vs the broad market: only when the benchmark is a sector / theme index
  // (not a broad, factor or overseas index).
  const bm = stats.benchmark;
  const sector = withSector && bm && bm.code !== stats.market?.code && isSectorIndexName(bm.name ?? "")
    ? sectorCheck(bm, stats.market, config, `Sector index (${bm.name ?? bm.code})`) : null;
  if (sector && sector.state !== "unknown") pillars.M = { state: sector.state === "lagging" ? DOWN : sector.state === "ahead" ? UP : FLAT, text: sector.text };
  const extra = { pillars, details: detailLines(pillars), benchmarkExcess: bench.excess, benchmarkName: bench.name };
  // The whole sector behind the market on every horizon, and the fund behind the market too → SELL.
  if (sector?.state === "lagging") {
    const f3 = isNum(stats.r3y) && isNum(stats.market?.r3y) ? stats.r3y - stats.market.r3y : null;
    const f5 = isNum(stats.r5y) && isNum(stats.market?.r5y) ? stats.r5y - stats.market.r5y : null;
    if (isNum(f3) && f3 < 0 && (f5 === null || f5 < 0)) {
      return out("WEAK", "sector-lagging", `The sector is not performing — ${sector.text}; the fund too is behind the market (3Y ${pp(f3)}${f5 !== null ? `, 5Y ${pp(f5)}` : ""}).`, extra);
    }
    return out("HOLD", "sector-lagging-fund-ahead", `The sector is behind the market (${sector.text}), but the fund itself is ahead of the market — kept, no new money.`, extra);
  }
  if (B.state === UNKNOWN) return out("HOLD", "thematic-no-benchmark", `Sectoral / thematic fund without benchmark data — not judged against mixed-sector peers. ${B.text}.`, extra);
  if (B.state === UP) return out("STRONG", "thematic-beats-benchmark", `Ahead of its own index: ${B.text}.`, extra);
  const b1 = bench.excess.b1;
  if (B.state === DOWN && isNum(b1) && b1 < 0) return out("WEAK", "thematic-lags-benchmark", `Behind its own index on every horizon: ${B.text}, 1Y ${pp(b1)}.`, extra);
  return out("HOLD", "thematic-in-line", `Not clearly ahead of or behind its own index: ${B.text}.`, extra);
}

/**
 * Sector / theme index fund or ETF (§4.6): it is the sector, so the sector check decides — lagging the market on
 * every horizon → SELL; ahead on 3Y and 5Y → INVEST (unless it trails its own index by more than the tracking
 * limit, when that is known); otherwise HOLD.
 */
function gradeSectorPassive(stats, config, out) {
  const bm = stats.benchmark;
  // The sector is judged on its own index (the mapped benchmark) — every fund on that index gets the same verdict.
  // Without one (ETFs), on the fund's own NAV, but only when that history has no break (unit splits show up as a
  // one-day fall > 20%, or as returns no sector index can have vs the market).
  const own = !(bm && isNum(bm.r3y));
  let sector = sectorCheck(own ? stats : bm, stats.market, config, own ? "Sector fund (own NAV)" : `Sector index (${bm.name ?? bm.code})`);
  const implausible = [sector.m1, sector.m3, sector.m5].some((x) => isNum(x) && Math.abs(x) > config.sectorImplausiblePp);
  if (own && ((isNum(stats.worstDay3y) && stats.worstDay3y < -20) || implausible)) {
    sector = { state: "unknown", text: "The fund's NAV history has a break (e.g. a unit split) — sector performance cannot be judged from it" };
  }
  const td = bm && isNum(bm.r3y) ? stats.r3y - bm.r3y : null;
  const pillars = {};
  if (sector.state !== "unknown") pillars.M = { state: sector.state === "lagging" ? DOWN : sector.state === "ahead" ? UP : FLAT, text: sector.text };
  if (td !== null) pillars.T = { state: td >= -config.passiveTrackingPp ? UP : DOWN, text: `tracking ${pp(td)} a year vs ${bm.name ?? bm.code}` };
  const extra = { pillars, details: detailLines(pillars), benchmarkExcess: { b1: null, b3: td, b5: null }, benchmarkName: bm?.name ?? null, benchmarkCode: bm?.code ?? null };
  if (sector.state === "lagging") return out("WEAK", "sector-lagging", `The sector is not performing — ${sector.text}.`, extra);
  if (sector.state === "ahead" && (td === null || td >= -config.passiveTrackingPp)) return out("STRONG", "sector-ahead", `Sector ahead of the market — ${sector.text}.`, extra);
  return out("HOLD", sector.state === "unknown" ? "sector-unknown" : "sector-in-line", `${sector.text}${td !== null && td < -config.passiveTrackingPp ? `; trails its index (${pp(td)} a year)` : ""}.`, extra);
}

/** Stage 2 + mapping to the three buttons (§5, §6). */
export function autoRecommend({ portfolio, schemes = {}, peerStats = null, fundHoldings = null, config = RECOMMENDATION }) {
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
    return { holding, key: holdingKey(holding), scheme, stats, graded, weightPct: totalPaise ? (paise / totalPaise) * 100 : 0, notes: [] };
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
    if (row.weightPct > config.investMaxWeightPct) {
      row.blocker = { ruleId: "strong-large-share", reason: `Strong, but already ${row.weightPct.toFixed(1)}% of the portfolio. ${row.graded.reason}` };
    } else if (isNum(e1) && e1 < config.investMin1yExcessPp) {
      row.blocker = { ruleId: "strong-1y-lag", reason: `Strong over 3–5 years, but 1Y ${pp(e1)} vs category median — hold until it recovers. ${row.graded.reason}` };
    }
  }

  // Same AMFI category (any plan): only the best STRONG fund that can take new money gets INVEST; the
  // others hold, with a note to consolidate — except a fund that is also behind its category median AND its
  // own benchmark over 3Y: that one is the weak duplicate and is sold in favour of the best (owner's rule).
  // Index funds and sectoral / thematic funds are left out: their AMFI groups mix different indices / sectors.
  const byCategory = new Map();
  for (const row of rows) {
    if (!row.scheme || !["STRONG", "MIXED"].includes(row.graded.grade) || ["passive", "thematic"].includes(row.graded.engine)) continue;
    const k = `${row.scheme.assetClass}|${row.scheme.category}`;
    byCategory.set(k, [...(byCategory.get(k) ?? []), row]);
  }
  const score = (row) => { const e = row.graded.excess ?? {}; return (e.e3 ?? 0) + (e.e5 ?? e.e1 ?? 0); };

  // Index funds on the same index: the one that tracks it best takes new money; the others hold (same exposure).
  const byIndex = new Map();
  for (const row of rows) {
    if (row.graded.engine === "passive" && row.graded.grade === "STRONG" && row.graded.benchmarkCode) {
      byIndex.set(row.graded.benchmarkCode, [...(byIndex.get(row.graded.benchmarkCode) ?? []), row]);
    }
  }
  for (const members of byIndex.values()) {
    const ranked = [...members].sort((a, b) => b.graded.benchmarkExcess.b3 - a.graded.benchmarkExcess.b3);
    ranked[0].keep = true;
    for (const row of ranked.slice(1)) {
      row.duplicateOf = ranked[0];
      row.duplicateKind = "index";
      row.graded = { ...row.graded, grade: "HOLD", ruleId: "passive-same-index",
        reason: `Same index as ${fundLabel(ranked[0])}, which tracks it more closely — new money goes there. ${row.graded.reason}` };
      row.notes.push(`Same index as ${fundLabel(ranked[0])} — consider consolidating.`);
    }
  }
  for (const members of byCategory.values()) {
    if (members.length < 2) continue;
    const ranked = [...members].sort((a, b) => (a.graded.grade === b.graded.grade ? score(b) - score(a) : a.graded.grade === "STRONG" ? -1 : 1));
    const investable = ranked.find((row) => row.graded.grade === "STRONG" && !row.blocker) ?? null;
    const leader = investable ?? ranked[0];
    // Portfolio fit (v1.4) consolidates into a fund that takes new money: only a STRONG leader is a "home" for it.
    if (investable) investable.keep = true;
    for (const row of ranked) {
      if (row === leader) continue;
      if (investable) { row.duplicateOf = investable; row.duplicateKind = "category"; }
      if (investable && row.graded.grade === "STRONG") row.secondInCategory = investable;
      // Behind both yardsticks on both horizons (3Y and 5Y; 3Y and 1Y without a 5Y figure), by any margin.
      const { e1, e3, e5 } = row.graded.excess ?? {}, { b1, b3, b5 } = row.graded.benchmarkExcess ?? {};
      const behind = (x3, x5, x1) => isNum(x3) && x3 < 0 && (isNum(x5) ? x5 < 0 : isNum(x1) && x1 < 0);
      if (row.graded.grade === "MIXED" && behind(e3, e5, e1) && behind(b3, b5, b1)) {
        const horizon = isNum(e5) && isNum(b5) ? `3Y ${pp(e3)} / 5Y ${pp(e5)} vs category, 3Y ${pp(b3)} / 5Y ${pp(b5)} vs benchmark`
          : `3Y ${pp(e3)} vs category, 3Y ${pp(b3)} vs benchmark, also behind over 1Y / 5Y`;
        row.graded = { ...row.graded, grade: "WEAK", ruleId: "weakest-in-category",
          reason: `Same category as ${fundLabel(leader)}, and behind both its category median and its benchmark on every horizon (${horizon}) — consolidate into the stronger fund.` };
        continue;
      }
      row.notes.push(`Same category as ${fundLabel(leader)} — consider consolidating${investable ? `; new money goes to ${fundLabel(investable)}` : ""}.`);
    }
  }

  // High overlap (owner's rule): two actively managed diversified equity funds holding ≥ highOverlapPct of the same
  // stocks are largely the same exposure; the one that is worse on most of the comparable measures is acted on —
  // SELL (consolidate into the other) when it is not a STRONG fund, HOLD with no new money when it is.
  const candidates = rows.filter((r) => r.scheme && r.graded.engine === "equity" && ["STRONG", "MIXED"].includes(r.graded.grade));
  const pairs = [], pairsActed = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const o = fundOverlap(fundHoldings?.[candidates[i].holding.isin], fundHoldings?.[candidates[j].holding.isin]);
      if (isNum(o) && o >= config.highOverlapPct) pairs.push({ a: candidates[i], b: candidates[j], o });
    }
  }
  for (const { a, b, o } of pairs.sort((p, q) => q.o - p.o)) {
    if (a.overlapLoser || b.overlapLoser) continue;
    const { aWins, bWins, n } = compareFunds(a, b);
    if (n < config.overlapMinMeasures) continue;
    const loser = bWins > n / 2 ? a : aWins > n / 2 ? b : null;
    if (!loser) continue;
    const winner = loser === a ? b : a, wins = loser === a ? bWins : aWins;
    loser.overlapLoser = true;
    if (winner.graded.grade === "STRONG") {
      winner.keep = true;
      loser.duplicateOf ??= winner;
      loser.duplicateKind ??= "stocks";
    }
    pairsActed.push({ winner, loser, o });
    const text = `${Math.round(o)}% of its equity holdings are the same stocks as ${fundLabel(winner)}, which is better on ${wins} of ${n} measures (3Y / 5Y vs category, consistency, Sharpe, drawdown, 3Y / 5Y vs benchmark)`;
    if (loser.graded.grade === "STRONG") {
      loser.overlapHold = { ruleId: "overlap-strong-weaker", reason: `Strong, but ${text} — new money goes there. ${loser.graded.reason}` };
    } else {
      loser.graded = { ...loser.graded, grade: "WEAK", ruleId: "overlap-weaker", reason: `${text} — consolidate into the stronger fund.` };
    }
    winner.notes.push(`High overlap (${Math.round(o)}%) with ${fundLabel(loser)} — the two hold largely the same stocks.`);
  }

  // Portfolio fit (v1.4): too many funds / index funds / theme exposure for THIS portfolio → the weakest Hold
  // funds exit; over-limit fund houses and themes take no new money.
  const fit = portfolioFit(rows, { totalRupees: totalPaise / 100, asOf }, config);

  const suggestions = {};
  for (const fund of rows) for (const row of fund.members) {
    // The fund's call for every folio / plan of it; the ELSS lock-in is checked per folio (its own units).
    const { holding } = row;
    const { graded } = fund;
    let { status, ruleId, reason } = fundCall(fund);
    if (status === "sell" && isElss(row.scheme, holding.schemeName)) {
      const lock = elssLock(holding, asOf, config);
      if (lock === null) { status = "review"; ruleId = "elss-lock-unknown"; reason = `Exit suggested, but this ELSS fund's lock-in cannot be told (no transaction history in the CAS). ${reason}`; }
      else if (lock.units > 0) { status = "hold"; ruleId = "elss-locked"; reason = `Exit suggested, but ${lock.units.toFixed(3)} units are in the ELSS lock-in (all free by ${lock.until}) — review then. ${reason}`; }
    }
    const notes = [...fund.notes];   // no Regular-vs-Direct note: the advisor recommends both plans (owner's decision)
    suggestions[row.key] = {
      status, verdict: status === "review" ? null : status, grade: graded.grade, engine: graded.engine, ruleId, reason,
      stage: ruleId.startsWith("fit-") ? "portfolio" : "fund",
      details: graded.details, notes, pillars: graded.pillars, peers: graded.peers ?? null, excess: graded.excess ?? null,
      benchmark: graded.benchmarkName ? { name: graded.benchmarkName, ...graded.benchmarkExcess } : null,
      schemeCode: row.scheme?.schemeCode ?? null, weightPct: row.weightPct, fundWeightPct: fund.weightPct, folios: fund.members.length,
    };
  }
  return { version: config.version, asOf, suggestions, fit: fit.summary, flags: suggestionBox(rows, fit, pairsActed, config) };
}

/**
 * A fund's call from its grade and the portfolio rules, before the per-folio ELSS check (§6). Portfolio-fit
 * results (v1.4) come last: an exit replaces any HOLD; "no new money" turns an INVEST into HOLD.
 */
function fundCall(fund) {
  const { graded } = fund;
  if (fund.fitExit) return { status: "sell", ...fund.fitExit };
  switch (graded.grade) {
    case "STRONG": {
      const hold = fund.blocker ?? fund.overlapHold
        ?? (fund.secondInCategory ? { ruleId: "strong-not-best", reason: `Strong, but ${fundLabel(fund.secondInCategory)} ranks higher in the same category. ${graded.reason}` } : null)
        ?? fund.fitHold;
      return hold ? { status: "hold", ...hold } : { status: "invest", ruleId: graded.ruleId, reason: graded.reason };
    }
    case "WEAK": return { status: "sell", ruleId: graded.ruleId, reason: graded.reason };
    case "MIXED":
    case "HOLD": return { status: "hold", ruleId: graded.ruleId, reason: graded.reason };
    default: return { status: "review", ruleId: graded.ruleId, reason: graded.reason };
  }
}

const GRADE_RANK = { STRONG: 3, MIXED: 2, HOLD: 2, WEAK: 1 };
/** How strong a fund is, for ordering exits: grade first, then its 3Y + 5Y lead over the category (else its benchmark). */
function strength(row) {
  const { e1, e3, e5 } = row.graded.excess ?? {}, { b1, b3, b5 } = row.graded.benchmarkExcess ?? {};
  const lead = isNum(e3) ? e3 + (e5 ?? e1 ?? 0) : isNum(b3) ? b3 + (b5 ?? b1 ?? 0) : 0;
  return [GRADE_RANK[row.graded.grade] ?? 0, lead];
}
const weaker = (a, b) => strength(a)[0] - strength(b)[0] || strength(a)[1] - strength(b)[1];

/** Theme exposure groups with their limits (config.flags) — one definition for the exits, no-new-money and the Suggestion Box. */
function themeGroups(config) {
  return [
    { id: "thematic", label: "sectoral / thematic funds", limit: config.flags.thematicPct,
      test: (r) => r.graded.engine === "thematic" || (r.graded.engine === "passive" && isSectorPassive(r.scheme)) },
    { id: "goldSilver", label: "gold / silver funds", limit: config.flags.goldSilverPct, test: (r) => r.graded.engine === "commodity" },
    { id: "overseas", label: "overseas funds", limit: config.flags.overseasPct, test: (r) => r.graded.engine === "overseas" },
  ];
}

/**
 * Stage 2b — portfolio fit (Recommendation_Logic.md §5.2, v1.4). Every limit comes from this portfolio:
 *   ideal fund count  = the Diversification range for its value (report-profile.js); funds counted by ISIN, as the report does
 *   small holding     = below smallShareOfAverage × the average fund share at the ideal maximum (100 / max)
 *   index funds/ETFs  = at most passiveMaxFunds (passiveMaxFundsSmall when the ideal maximum ≤ smallPortfolioIdealMax)
 *   themes, AMC       = config.flags limits
 * Exits: only funds whose call is HOLD; never the STRONG fund taking the new money in a category / index / overlap
 * pair, a STRONG fund (unless a small duplicate of such a fund), an ELSS fund with locked (or unknown) units, the
 * last fund of the hybrid / debt / gold class, or the strongest fund of the over-limit group itself. Each exit is the candidate that relieves the most
 * open limits, worst first (small → duplicate → over-limit fund house → weakest → smallest); exits stop as soon
 * as every limit is met, so no more is sold than the portfolio needs. Afterwards an INVEST in a fund house or
 * theme still above its limit becomes HOLD (no new money).
 */
function portfolioFit(rows, { totalRupees, asOf }, config) {
  const f = config.fit;
  const isinsOf = (r) => new Set(r.members.map((m) => m.holding.isin ?? m.key));
  const count0 = new Set(rows.flatMap((r) => [...isinsOf(r)])).size;
  const { range } = diversificationStatus({ numFunds: count0, portfolioValue: totalRupees });
  const smallPct = (100 / range.max) * f.smallShareOfAverage;
  const passiveMax = range.max <= f.smallPortfolioIdealMax ? f.passiveMaxFundsSmall : f.passiveMaxFunds;
  const isPassive = (r) => r.graded.engine === "passive";
  const themes = themeGroups(config);

  const prelim = new Map(rows.map((r) => [r, fundCall(r).status]));
  const kept = () => rows.filter((r) => prelim.get(r) !== "sell" && !r.fitExit);
  const share = (list, test) => list.filter(test).reduce((s, r) => s + r.weightPct, 0);
  const amcShare = (list, amc) => share(list, (r) => r.scheme?.amc === amc);
  const pressures = (list) => {
    const open = [];
    const n = new Set(list.flatMap((r) => [...isinsOf(r)])).size;
    if (n > range.max) open.push({ id: "count" });
    if (list.filter(isPassive).length > passiveMax) open.push({ id: "passive", test: isPassive });
    for (const t of themes) if (share(list, t.test) > t.limit) open.push({ id: t.id, test: t.test });
    return open;
  };
  const start = kept();
  const passive0 = start.filter(isPassive).length;
  const themePct0 = Object.fromEntries(themes.map((t) => [t.id, share(start, t.test)]));
  const overAmc = (list) => new Set([...new Set(list.map((r) => r.scheme?.amc).filter(Boolean))].filter((amc) => amcShare(list, amc) > config.flags.amcPct));

  const lockedElss = (r) => r.members.some((m) => isElss(m.scheme, m.holding.schemeName) && (elssLock(m.holding, asOf, config)?.units ?? 1) > 0);
  const assetOf = (r) => (r.scheme ? assetGroup(r.scheme, r.holding.schemeName) : null);
  const duplicateKept = (r, list) => Boolean(r.duplicateOf) && list.includes(r.duplicateOf);
  // A STRONG fund is not sold for portfolio fit — unless it is a small duplicate of a fund that takes new money.
  const eligible = (r, list) => prelim.get(r) === "hold" && !r.fitExit && !r.keep && !r.blocker && !lockedElss(r)
    && (r.graded.grade !== "STRONG" || (r.weightPct < smallPct && duplicateKept(r, list)));

  const exits = [];
  for (;;) {
    const list = kept();
    const open = pressures(list);
    if (!open.length) break;
    const amcs = overAmc(list);
    const relieves = (r) => open.filter((p) => {
      if (p.id === "count") return true;
      if (!p.test(r)) return false;
      const group = list.filter(p.test);
      return group.some((o) => o !== r && weaker(r, o) <= 0);   // never the group's strongest
    });
    const lastOfClass = (r) => ["hybrid", "debt", "goldSilver"].includes(assetOf(r)) && list.filter((o) => assetOf(o) === assetOf(r)).length === 1;
    const order = (r) => [r.weightPct < smallPct ? 0 : 1, duplicateKept(r, list) ? 0 : 1, amcs.has(r.scheme?.amc) ? 0 : 1];
    const ranked = list.filter((r) => eligible(r, list) && !lastOfClass(r) && relieves(r).length)
      .sort((a, b) => relieves(b).length - relieves(a).length
        || order(a).reduce((d, x, i) => d || x - order(b)[i], 0) || weaker(a, b) || a.weightPct - b.weightPct);
    const pick = ranked[0];
    if (!pick) break;
    const dup = duplicateKept(pick, list) ? pick.duplicateOf : null;   // the STRONG fund it duplicates, still held
    const why = [];
    if (pick.weightPct < smallPct) why.push(`a small holding (${pick.weightPct.toFixed(1)}% of the portfolio)`);
    if (dup) why.push(`${fundLabel(dup)} already covers the same ${pick.duplicateKind}`);
    if (amcs.has(pick.scheme?.amc)) why.push(`${pick.scheme.amc} is above ${config.flags.amcPct}% of the portfolio`);
    // Another fund still held gives the same gold / silver / overseas exposure.
    const sameExposure = ["commodity", "overseas"].includes(pick.graded.engine)
      ? list.find((o) => o !== pick && o.graded.engine === pick.graded.engine) : null;
    if (sameExposure) why.push(`${fundLabel(sameExposure)} already gives the ${pick.graded.engine === "commodity" ? "gold / silver" : "overseas"} exposure`);
    // "Weakest" only when it was measured; a fund with no peer or benchmark comparison is said to be just that.
    const measured = isNum(pick.graded.excess?.e3) || isNum(pick.graded.benchmarkExcess?.b3);
    if (!why.length) why.push(measured ? "among the weakest of the funds held" : `not compared with peers (${pick.weightPct.toFixed(1)}% of the portfolio), so it is the easiest to do without`);
    const what = relieves(pick).map((p) => p.id === "count" ? `the portfolio holds ${count0} funds where ${range.min}–${range.max} suit its size`
      : p.id === "passive" ? `it holds ${passive0} index funds / ETFs where ${passiveMax} are enough`
      : `${themes.find((t) => t.id === p.id).label} are ${themePct0[p.id].toFixed(1)}% of the portfolio (limit ${themes.find((t) => t.id === p.id).limit}%)`);
    pick.fitExit = { ruleId: "fit-exit",
      reason: `Portfolio fit — ${what.join("; ")}. This fund: ${why.join("; ")} — exit and move the money to ${dup ? fundLabel(dup) : "the Invest funds"}. On its own: ${pick.graded.reason}` };
    exits.push(pick);
  }

  // No new money into a fund house or theme that is still above its limit.
  const after = kept();
  const amcsAfter = overAmc(after);
  for (const r of after) {
    if (prelim.get(r) !== "invest") continue;
    const theme = themes.find((t) => t.test(r) && share(after, t.test) > t.limit);
    if (amcsAfter.has(r.scheme?.amc)) {
      r.fitHold = { ruleId: "fit-amc-limit", reason: `Strong, but ${r.scheme.amc} is already ${amcShare(after, r.scheme.amc).toFixed(1)}% of the portfolio (limit ${config.flags.amcPct}%) — no new money to this fund house. ${r.graded.reason}` };
    } else if (theme) {
      r.fitHold = { ruleId: "fit-theme-limit", reason: `Strong, but ${theme.label} are already ${share(after, theme.test).toFixed(1)}% of the portfolio (limit ${theme.limit}%) — no new money. ${r.graded.reason}` };
    }
  }
  const countAfter = new Set(after.flatMap((r) => [...isinsOf(r)])).size;
  return {
    exits, amcsAfter,
    themesBefore: themes.filter((t) => themePct0[t.id] > t.limit).map((t) => ({ ...t, pct: themePct0[t.id], still: share(after, t.test) > t.limit })),
    summary: { funds: count0, range, smallPct, passive: passive0, passiveMax, exits: exits.length, fundsAfter: countAfter,
      limitsBefore: pressures(start).map((p) => p.id), open: pressures(after).map((p) => p.id) },
  };
}

/** Head-to-head on the measures both funds have: 3Y / 5Y vs category, consistency, Sharpe, drawdown, 3Y / 5Y vs benchmark. */
function compareFunds(a, b) {
  const measures = [
    (r) => r.graded.excess?.e3, (r) => r.graded.excess?.e5, (r) => r.stats?.consistency, (r) => r.stats?.sharpe3y,
    (r) => r.stats?.maxDrawdown3y,   // less negative = better
    (r) => r.graded.benchmarkExcess?.b3, (r) => r.graded.benchmarkExcess?.b5,
  ];
  let aWins = 0, bWins = 0, n = 0;
  for (const m of measures) {
    const x = m(a), y = m(b);
    if (!isNum(x) || !isNum(y)) continue;
    n++;
    if (x > y) aWins++;
    else if (y > x) bWins++;
  }
  return { aWins, bWins, n };
}

/** The fund's AMFI name and plan (the CAS name can carry long former-name / folio text). */
function fundLabel(row) {
  return row.scheme ? `${row.scheme.schemeName} (${row.scheme.plan})` : row.holding.schemeName ?? row.holding.isin;
}

/**
 * Suggestion Box (§5.3): the portfolio-level points, written for the client report. Built from the same
 * conditions that set the calls (portfolioFit, the overlap pairs, the fund grouping) — never a second rule set.
 * Phrased independently of the advisor's final verdicts, so it stays true when a call is changed.
 */
function suggestionBox(rows, fit, pairsActed, config) {
  const out = [];
  const s = fit.summary;
  if (s.funds > s.range.max) {
    out.push({ id: "count", text: `The portfolio holds ${s.funds} funds; ${s.range.min}–${s.range.max} suit a portfolio of this size. `
      + "We recommend consolidating into fewer, stronger funds — the smallest, weakest and duplicate holdings are marked for exit." });
  }
  if (s.passive > s.passiveMax) {
    out.push({ id: "passive", text: `The portfolio holds ${s.passive} index funds / ETFs; ${s.passiveMax} are enough for broad market exposure — the extra ones are marked for exit.` });
  }
  for (const amc of fit.amcsAfter) {
    const pct = rows.filter((r) => r.scheme?.amc === amc && !r.fitExit).reduce((t, r) => t + r.weightPct, 0);
    out.push({ id: "amc", text: `${pct.toFixed(1)}% of the portfolio is with one fund house (${amc}), above ${config.flags.amcPct}% — new investments should go to other fund houses.` });
  }
  for (const t of fit.themesBefore) {
    out.push({ id: t.id, text: `${t.pct.toFixed(1)}% of the portfolio is in ${t.label}, above ${t.limit}% — `
      + (t.still ? "no new money into them." : "the weaker ones are marked for exit to bring it within the limit.") });
  }
  // An index fund / ETF is itself diversified across its index: no single-fund concentration point.
  for (const r of rows.filter((x) => x.weightPct > config.investMaxWeightPct && x.graded.engine !== "passive")) {
    out.push({ id: "fund", text: `${fundLabel(r)} is ${r.weightPct.toFixed(1)}% of the portfolio, above ${config.investMaxWeightPct}% — new investments should go to other funds.` });
  }
  for (const { winner, loser, o } of pairsActed) {
    out.push({ id: "overlap", text: `${fundLabel(loser)} and ${fundLabel(winner)} hold ${Math.round(o)}% of the same stocks — largely the same exposure; ${fundLabel(winner)} is the stronger of the two.` });
  }
  for (const r of rows.filter((x) => x.members.length > 1)) {
    const plans = new Set(r.members.map((m) => m.scheme?.plan));
    out.push({ id: "folios", text: plans.size > 1
      ? `${r.scheme.schemeName} is held in both its ${[...plans].join(" and ")} plans — consider consolidating into one plan.`
      : `${fundLabel(r)} is held in ${r.members.length} folios — they can be merged into one folio through the registrar (CAMS / KFintech); no sale is needed.` });
  }
  return out;
}
