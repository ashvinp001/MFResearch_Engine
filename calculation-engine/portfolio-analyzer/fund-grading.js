/**
 * Stage 1 of the automatic recommendation: one fund on its own — rule set (engine), pillars and grade
 * (Recommendation_Logic.md §3–§4). Pure; every input explicit. Used by auto-recommendation.js.
 */

import { RECOMMENDATION } from "../config.js";
import { daysBetween } from "../analytics/returns.js";
import { isNum } from "../analytics/stats.js";

const UP = "+", DOWN = "-", FLAT = "0", UNKNOWN = "?";
// Two decimals in reasons, so a value next to a threshold (e.g. −1.04 vs the −1.00 limit) reads correctly.
export const pp = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)} pp`;
const pc = (x) => `${x >= 0 ? "" : "−"}${Math.abs(x).toFixed(1)}%`;

/** The fund's return for a comparison with `index`: on the index's own date when its prices arrive later than the NAVs. */
export const fundReturn = (stats, index, k) => (index?.fund ?? stats)?.[k];

/** Which rule set applies to a fund (§4). */
export function engineOf(scheme, name = "") {
  if (!scheme) return "unlisted";
  const category = scheme.category ?? "";
  const text = `${category} ${scheme.schemeName ?? ""} ${name}`;
  if (/\(legacy\)/i.test(category)) return "legacy";
  // Gold / silver only: "NIFTY Commodities" is an equity sector index, judged like any sector fund, and a gold-MINING
  // fund holds company shares ("DSP World Gold Mining Overseas Equity FoF"), as assetGroup also says.
  if (/\bgold\b|\bsilver\b|precious\s*metal/i.test(text) && !/(gold|silver)\s*min(ing|ers?)\b/i.test(text)) return "commodity";
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

export const isElss = (scheme, name) => /elss|tax\s*saver/i.test(`${scheme?.category ?? ""} ${name ?? ""}`);

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
    const young = `Only ${years === null ? "a short" : years.toFixed(1) + " years of"} NAV history — fewer than 3 years to judge`;
    // The 1-year rule (owner) is for these young funds only: their year is all the record there is. In the bottom quarter
    // of the category over 1Y → held while recovering (6M or 3M at or above the median), otherwise sold.
    if (["equity", "hybrid", "debt", "arbitrage"].includes(engine)) {
      const median = group?.median ?? {};
      const oneYear = oneYearCheck(stats, median, engine === "debt" || engine === "arbitrage" ? config.debtGapPp : 2 * config.equityGapPp, config);
      const e1 = isNum(stats.r1y) && isNum(median.r1y) ? stats.r1y - median.r1y : null;
      const extra = { oneYear, excess: { e1, e3: null, e5: null }, peers: `${scheme.category} · ${scheme.plan} (${stats.n1y ?? "?"} funds)` };
      if (oneYear?.recovering === false) return out("WEAK", "young-1y-no-recovery", `${young}. ${oneYear.text} — and no recovery in the short term, so we recommend exiting.`, extra);
      if (oneYear?.recovering) return out("MIXED", "young-1y-recovering", `${young}. ${oneYear.text} — recovering, so held.`, extra);
    }
    return out("REVIEW", "young", `${young}.`);
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
    // As for equity: rank comes from the same returns as R, so a SELL needs risk, credit quality or the benchmark too.
    const downs = [K, S, Q, B].filter((p) => p.state === DOWN);
    if (R.state === DOWN && neg(S, Q, B)) return result("WEAK", "debt-weak", `${R.text}; ${downs.map((p) => p.text).join("; ")}.`);
    if (pos(R) && (pos(K) || pos(S) || pos(B)) && !neg(S, Q, B)) return result("STRONG", "debt-strong", `${R.text}; ${[K, S, B].find(pos).text}.`);
    if (lagsBoth(K, S, Q)) return result("WEAK", "debt-lags-category-and-benchmark", lagsBothReason());
    return result("MIXED", R.state === DOWN ? "debt-watch" : "debt-mixed", R.state === DOWN ? `${R.text} — not confirmed by rank, risk, credit or benchmark; watch.` : `${R.text}.`);
  }

  if (engine === "arbitrage") {
    delete pillars.C; delete pillars.S;
    if (R.state === DOWN && B.state === DOWN) return result("WEAK", "arbitrage-weak", `${R.text}; ${B.text}.`);   // rank alone is the same returns
    if (pos(R) && (pos(K) || pos(B)) && !neg(K, B)) return result("STRONG", "arbitrage-strong", `${R.text}; ${(pos(K) ? K : B).text}.`);
    if (lagsBoth(K)) return result("WEAK", "arbitrage-lags-category-and-benchmark", lagsBothReason());
    return result("MIXED", "arbitrage-mixed", `${R.text}.`);
  }

  // equity, hybrid
  // SELL needs independent evidence: rank and consistency come from the same returns as R, so alone they need each other.
  const downs = [K, C, S, B].filter((p) => p.state === DOWN);
  const confirmed = neg(S, B) || (K.state === DOWN && C.state === DOWN);
  if (R.state === DOWN && confirmed) return result("WEAK", "weak", `${R.text}; ${downs.map((p) => p.text).join("; ")}.`);
  if (pos(R) && !neg(S, B) && ((pos(C) && (pos(K) || pos(S))) || (C.state === UNKNOWN && pos(K) && pos(S)))) {
    return result("STRONG", "strong", `${R.text}; ${pos(K) ? K.text : S.text}; ${C.state === UNKNOWN ? S.text : C.text}.`);
  }
  // Ahead of the category and of its own benchmark on 3Y and 5Y, nothing negative → STRONG as well.
  if (pos(R) && pos(B) && !neg(K, C, S)) return result("STRONG", "strong-category-and-benchmark", `${R.text}; ${B.text}.`);
  if (lagsBoth(K, C, S)) return result("WEAK", "lags-category-and-benchmark", lagsBothReason());
  return result("MIXED", R.state === DOWN ? "watch" : "mixed",
    R.state === DOWN ? `${R.text} — not confirmed by rank, consistency, risk or benchmark; watch.` : `${R.text}; ${B.text}.`);
}

/**
 * The 1-year rule's facts: worst = bottom quartile of its category over 1Y and behind its median by more than minGap
 * (2 pp for equity / hybrid, 0.3 pp for debt / arbitrage); recovering = at or above the category median
 * over 6M or 3M (true / false, or null when neither can be compared).
 */
/**
 * v2.3 (owner): a fund whose rating is pending — under 3 years of NAVs (REVIEW "young", or held while "recovering") — and
 * below youngSmallMaxWeightPct of the portfolio is decided on its last year, Hold or Sell; a larger holding stays the
 * advisor's call. Stage 2 then checks that the fund fits the portfolio, like any other fund.
 *   A year of NAVs or more: against its category over 1Y (a sectoral / thematic fund: against its own index, as its
 *     peers are other sectors). In the bottom quarter of the category → Sell (the worst performers; for debt and
 *     arbitrage only when also clearly behind, as their returns sit basis points apart); more than the gap behind the
 *     median or the index → Sell; otherwise → Hold.
 *   Under a year: an equity or sectoral fund on its absolute return since launch — above youngLaunchHoldPct → Hold,
 *     else Sell. A hybrid, debt or arbitrage fund is not held to an equity return: against its category over 6M, else 3M.
 *   No figure to judge on (or no category median) → it stays REVIEW: nothing is guessed.
 * Hold is graded MIXED and Sell WEAK, so the Stage 2 rules (overlap, fund count, limits) apply to them as to any fund.
 */
export function gradeYoungSmall(graded, { stats, median, weightPct }, config = RECOMMENDATION) {
  if (!["young", "young-1y-recovering"].includes(graded.ruleId) || !stats || !isNum(weightPct) || weightPct >= config.youngSmallMaxWeightPct) return graded;
  const engine = graded.engine;
  if (!["equity", "thematic", "hybrid", "debt", "arbitrage"].includes(engine)) return graded;
  const m = median ?? {};
  const defensive = engine === "debt" || engine === "arbitrage";
  const gap = defensive ? config.debtGapPp : config.equityGapPp;
  const years = stats.firstDate && stats.navDate ? daysBetween(stats.firstDate, stats.navDate) / 365.25 : null;
  const pending = `Rating pending: ${years === null ? "a short" : `${years.toFixed(1)} years of`} NAV history, fewer than 3 to rate. At ${weightPct.toFixed(1)}% of the portfolio (below ${config.youngSmallMaxWeightPct}%) it is decided on its last year`;
  let good, evidence, period, e1 = null, absolute = false;
  if (isNum(stats.r1y)) {
    period = "1y";
    if (engine === "thematic") {
      const bm = stats.benchmark;
      const b1 = bm && isNum(fundReturn(stats, bm, "r1y")) && isNum(bm.r1y) ? fundReturn(stats, bm, "r1y") - bm.r1y : null;
      if (b1 === null) return graded;
      good = b1 >= -config.benchmarkGapPp;
      evidence = `1Y ${pc(fundReturn(stats, bm, "r1y"))} vs ${pc(bm.r1y)} for its own index${bm.name ? ` (${bm.name})` : ""}, ${pp(b1)}`;
    } else {
      if (!isNum(m.r1y)) return graded;
      e1 = stats.r1y - m.r1y;
      const bottom = stats.quartile1y === 4 && (!defensive || e1 < -gap);
      good = !bottom && e1 >= -gap;
      const rank = isNum(stats.rank1y) && isNum(stats.n1y) ? `, rank ${stats.rank1y} of ${stats.n1y}${stats.quartile1y === 4 ? ", bottom quarter" : ""}` : "";
      evidence = `1Y ${pc(stats.r1y)} vs ${pc(m.r1y)} for the category median (${pp(e1)}${rank})`;
    }
  } else if (!defensive && engine !== "hybrid") {
    period = "new";
    if (!isNum(stats.rLaunch)) return graded;
    good = stats.rLaunch > config.youngLaunchHoldPct;
    absolute = true;
    evidence = `under a year old: ${pc(stats.rLaunch)} absolute return since ${stats.firstDate}, ${good ? "above" : "not above"} the ${config.youngLaunchHoldPct}% needed to hold`;
  } else {
    period = "new";
    const short = config.oneYearShortTermMonths.map((mo) => ({ mo, x: isNum(stats[`r${mo}m`]) && isNum(m[`r${mo}m`]) ? stats[`r${mo}m`] - m[`r${mo}m`] : null })).find((s) => s.x !== null);
    if (!short) return graded;
    good = short.x >= -gap;
    evidence = `under a year old: ${short.mo}M ${pc(stats[`r${short.mo}m`])} vs ${pc(m[`r${short.mo}m`])} for the category median (${pp(short.x)})`;
  }
  return {
    ...graded, grade: good ? "MIXED" : "WEAK", ruleId: `young-${period}-${good ? "in-line" : "behind"}`,
    reason: `${pending}: ${evidence} — ${good ? (absolute ? "so held" : "in line with or ahead, so held") : (absolute ? "so we recommend exiting" : "behind, so we recommend exiting")}.`,
    excess: { e1, e3: null, e5: null }, peers: graded.peers ?? null,
  };
}

function oneYearCheck(stats, median, minGap, config) {
  // Bottom quartile AND clearly behind: liquid funds sit within a few basis points of each other.
  if (stats.quartile1y !== 4 || !(isNum(stats.r1y) && isNum(median.r1y) && stats.r1y - median.r1y < -minGap)) return null;
  const short = config.oneYearShortTermMonths.map((m) => ({ m, x: isNum(stats[`r${m}m`]) && isNum(median[`r${m}m`]) ? stats[`r${m}m`] - median[`r${m}m`] : null }));
  const known = short.filter((s) => s.x !== null);
  const recovering = known.length ? known.some((s) => s.x >= 0) : null;
  const text = `Bottom quarter of its category over 1Y (rank ${stats.rank1y} of ${stats.n1y})`
    + (known.length ? `; ${known.map((s) => `${s.m}M ${pp(s.x)} vs category median`).join(", ")}` : "; no short-term comparison");
  return { worst: true, recovering, text };
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
  const ex = (k) => (bm && isNum(fundReturn(stats, bm, k)) && isNum(bm[k]) ? fundReturn(stats, bm, k) - bm[k] : null);
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
export const isOverseasIndex = (text) => OVERSEAS_INDEX.test(text);
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
function sectorCheck(sector, market, config = RECOMMENDATION, label = "Sector") {
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
  // r3y is the fund's return measured to the index's date: without it there is no like-for-like tracking figure.
  if (!stats || !isNum(stats.r3y) || !bm || !isNum(bm.r3y) || !isNum(fundReturn(stats, bm, "r3y"))) {
    return out("HOLD", "passive-no-tracking", "Index fund / ETF — fewer than 3 years of NAV history or no benchmark data to judge its tracking.");
  }
  const r3y = fundReturn(stats, bm, "r3y");
  const td = r3y - bm.r3y;   // tracking difference, % a year (benchmarks carry no costs)
  const pillars = { T: { state: td >= -config.passiveTrackingPp ? UP : DOWN, text: `3Y ${r3y.toFixed(2)}% vs ${bm.name ?? bm.code} ${bm.r3y.toFixed(2)}% (tracking ${pp(td)} a year)` } };
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
  const extra = { pillars, details: detailLines(pillars), benchmarkExcess: bench.excess, benchmarkName: bench.name, benchmarkCode: bm?.code ?? null };
  // The whole sector behind the market on every horizon, and the fund behind both the market and its own index → SELL.
  if (sector?.state === "lagging") {
    const f = (k) => (isNum(fundReturn(stats, stats.market, k)) && isNum(stats.market?.[k]) ? fundReturn(stats, stats.market, k) - stats.market[k] : null);
    const f3 = f("r3y"), f5 = f("r5y");
    const behindMarket = isNum(f3) && f3 < 0 && (f5 === null || f5 < 0);
    if (behindMarket && B.state !== UP) {
      return out("WEAK", "sector-lagging", `The sector is not performing — ${sector.text}; the fund too is behind the market (3Y ${pp(f3)}${f5 !== null ? `, 5Y ${pp(f5)}` : ""}).`, extra);
    }
    const saves = B.state === UP ? `the fund is ahead of its own index (${B.text})` : `the fund is not behind the market on both horizons (3Y ${pp(f3)}${f5 !== null ? `, 5Y ${pp(f5)}` : ""})`;
    return out("HOLD", "sector-lagging-fund-ahead", `The sector is behind the market (${sector.text}), but ${saves} — kept, no new money.`, extra);
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
  const td = bm && isNum(bm.r3y) && isNum(fundReturn(stats, bm, "r3y")) ? fundReturn(stats, bm, "r3y") - bm.r3y : null;
  const pillars = {};
  if (sector.state !== "unknown") pillars.M = { state: sector.state === "lagging" ? DOWN : sector.state === "ahead" ? UP : FLAT, text: sector.text };
  if (td !== null) pillars.T = { state: td >= -config.passiveTrackingPp ? UP : DOWN, text: `tracking ${pp(td)} a year vs ${bm.name ?? bm.code}` };
  const extra = { pillars, details: detailLines(pillars), benchmarkExcess: { b1: null, b3: td, b5: null }, benchmarkName: bm?.name ?? null, benchmarkCode: bm?.code ?? null };
  if (sector.state === "lagging") return out("WEAK", "sector-lagging", `The sector is not performing — ${sector.text}.`, extra);
  if (sector.state === "ahead" && (td === null || td >= -config.passiveTrackingPp)) return out("STRONG", "sector-ahead", `Sector ahead of the market — ${sector.text}.`, extra);
  return out("HOLD", sector.state === "unknown" ? "sector-unknown" : "sector-in-line", `${sector.text}${td !== null && td < -config.passiveTrackingPp ? `; trails its index (${pp(td)} a year)` : ""}.`, extra);
}
