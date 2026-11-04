/**
 * Stage 2 of the automatic recommendation: one decision for the whole portfolio (Recommendation_Logic.md §5–§6).
 * Used by auto-recommendation.js.
 *
 * rankFunds         one strength order for every comparison: Stage 1 grade, then the fund's place inside this portfolio
 *                   on return, Sharpe, drawdown, consistency and overlap with the other funds.
 * decidePortfolio   walks the funds best first, then applies the limits in a fixed order:
 *                     1. fund against fund   a fund gives way only to a stronger fund that takes new money
 *                     2. index funds / ETFs  at most 2–3 funds and 20% of the portfolio together
 *                     3. themes              sectoral / thematic and gold / silver 15% each, overseas 30%
 *                        debt + arbitrage    at most 2 funds (1 in a small portfolio), equal shares; the money stays in debt
 *                     4. one fund            20%, or an equal share when too few funds remain to meet that
 *                     5. fund count          the ideal range, staged: at most reviewSellMaxPct of the portfolio a review
 *                     6. fund house, theme   a fund above its limit takes no new money
 *                   Step 6 can take an INVEST away, so the walk runs again until nothing changes: money only ever
 *                   moves to a fund that is INVEST in the final result, and never to a fund being sold.
 * The Stage 1 grade is never changed here: a sale for overlap or fit does not make a fund WEAK.
 */

import { isNum, mean } from "../analytics/stats.js";
import { percentiles } from "../research/fund-scorecard.js";
import { assetGroup } from "./portfolio-performance.js";
import { diversificationStatus } from "./report-profile.js";
import { elssLock, fundReturn, isElss, isOverseasIndex, isSectorPassive, pp } from "./fund-grading.js";

const GRADE_RANK = { STRONG: 3, MIXED: 2, HOLD: 2, WEAK: 1 };
const ACTIVE_ENGINES = ["equity", "hybrid", "debt", "arbitrage"];
const EPSILON = 1e-6;

/** The fund's AMFI name and plan (the CAS name can carry long former-name / folio text). */
export function fundLabel(row) {
  return row.scheme ? `${row.scheme.schemeName} (${row.scheme.plan})` : row.holding.schemeName ?? row.holding.isin;
}

/** Positive when a is stronger than b. The only ordering used in Stage 2. */
export const stronger = (a, b) => (GRADE_RANK[a.graded.grade] ?? 0) - (GRADE_RANK[b.graded.grade] ?? 0)
  || a.portfolioScore - b.portfolioScore || a.weightPct - b.weightPct;

/**
 * Average tracking difference (fund − index) over 1Y, 3Y and 5Y, pp a year: how well an index fund does its one job.
 * Signed, not absolute: after costs a fund cannot truly beat its index, so a positive gap comes from the index data, and
 * funds on the same index share that error; the higher figure is the fund losing least to costs.
 */
function trackingGap(r) {
  const bm = r.stats?.benchmark;
  const gaps = ["r1y", "r3y", "r5y"].filter((k) => isNum(fundReturn(r.stats, bm, k)) && isNum(bm?.[k])).map((k) => fundReturn(r.stats, bm, k) - bm[k]);
  return r.graded.engine === "passive" && gaps.length ? mean(gaps) : null;
}

/** Which Large / Mid / Small basket fits: the lower of what risk and horizon allow (either one alone can rule out small caps). */
export function capBasket(profile, config) {
  const tiers = [
    { Conservative: 0, "Moderately Conservative": 0, Moderate: 1, "Moderately Aggressive": 2, Aggressive: 2 }[profile?.risk?.label],
    { "Short Term": 0, "Mid Term": 0, "Mid to Long Term": 1, "Long Term": 2 }[profile?.horizon?.label],
  ].filter(isNum);
  return config.fit.capBaskets[tiers.length ? Math.min(...tiers) : 1];
}

/** Sets row.portfolioScore (0–100): the fund's percentile among the funds held, on the measures it has. */
export function rankFunds(rows, overlapOf, config) {
  const others = (r) => rows.filter((o) => o !== r);
  const measures = [
    (r) => {
      const { e1, e3, e5 } = r.graded.excess ?? {}, { b1, b3, b5 } = r.graded.benchmarkExcess ?? {};
      if (isNum(e3)) return (e3 + (e5 ?? e1 ?? 0)) / (r.graded.engine === "debt" ? config.debtGapPp : config.equityGapPp);
      if (isNum(b3)) return b3 + (b5 ?? b1 ?? 0);
      return isNum(r.stats?.r3y) && isNum(r.median?.r3y) ? r.stats.r3y - r.median.r3y : null;   // funds held by type: against their own group
    },
    (r) => (isNum(r.stats?.sharpe3y) && isNum(r.median?.sharpe3y) ? r.stats.sharpe3y - r.median.sharpe3y : null),
    (r) => (isNum(r.stats?.maxDrawdown3y) && isNum(r.median?.maxDrawdown3y) ? r.stats.maxDrawdown3y - r.median.maxDrawdown3y : null),
    (r) => r.stats?.consistency ?? null,
    (r) => {   // less overlap with the other funds is better, weighted by what they hold
      const known = others(r).map((o) => ({ o: overlapOf(r, o), w: o.weightPct })).filter((x) => isNum(x.o));
      const total = known.reduce((s, x) => s + x.w, 0);
      return total > 0 ? -known.reduce((s, x) => s + x.o * x.w, 0) / total : null;
    },
  ];
  const ranks = measures.map((m) => percentiles(rows.filter((r) => isNum(m(r))).map((r) => ({ code: r.key, value: m(r) })), "higher"));
  for (const r of rows) {
    r.portfolioScore = mean(ranks.filter((p) => p.has(r.key)).map((p) => p.get(r.key))) ?? 50;
  }
  // An index fund has one job: among index funds, its tracking is its score.
  const tracked = rows.filter((r) => isNum(trackingGap(r)));
  const tracking = percentiles(tracked.map((r) => ({ code: r.key, value: trackingGap(r) })), "higher");
  if (tracked.length > 1) for (const r of tracked) r.portfolioScore = tracking.get(r.key);
  // On one index the largest holding leads, unless another fund tracks it better by more than trackingSamePp a year: a
  // large fund is never sold to consolidate into a tiny one for a difference of a few basis points.
  const byIndex = new Map();
  for (const r of tracked) if (r.graded.benchmarkCode) byIndex.set(r.graded.benchmarkCode, [...(byIndex.get(r.graded.benchmarkCode) ?? []), r]);
  for (const group of byIndex.values()) {
    if (group.length < 2) continue;
    const largest = group.reduce((a, b) => (b.weightPct > a.weightPct ? b : a));
    const better = group.filter((r) => trackingGap(r) > trackingGap(largest) + config.fit.trackingSamePp).sort((a, b) => trackingGap(b) - trackingGap(a))[0];
    const lead = better ?? largest;
    lead.portfolioScore = Math.max(...group.map((r) => r.portfolioScore)) + 0.001;   // first of its index in every ordering
  }
}

/**
 * Head-to-head on the measures both funds have, for the reason shown. The vs-benchmark gaps count only when the two
 * benchmarks differ: on the same benchmark they repeat the vs-category gaps.
 */
export function compareFunds(a, b) {
  const measures = [(r) => r.graded.excess?.e3, (r) => r.graded.excess?.e5, (r) => r.stats?.consistency, (r) => r.stats?.sharpe3y,
    (r) => r.stats?.maxDrawdown3y];   // less negative = better
  if (a.graded.benchmarkName !== b.graded.benchmarkName) measures.push((r) => r.graded.benchmarkExcess?.b3, (r) => r.graded.benchmarkExcess?.b5);
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

/** The Large / Mid / Small split a fund's holdings show, in % of its domestic equity; null without that data. */
export function capSplit(entry) {
  const parts = { large: 0, mid: 0, small: 0 };
  for (const r of entry?.holdings ?? []) if (r.assetType === "equity" && isNum(r.weight) && parts[r.marketCap] !== undefined) parts[r.marketCap] += r.weight;
  const total = parts.large + parts.mid + parts.small;
  return total > 0 ? { large: (parts.large / total) * 100, mid: (parts.mid / total) * 100, small: (parts.small / total) * 100 } : null;
}

/** Theme exposure groups with their limits (config.flags) — one definition for every use. */
function themeGroups(config) {
  const name = (r) => `${r.scheme?.schemeName ?? ""} ${r.holding.schemeName ?? ""}`;
  // Overseas exposure wherever AMFI files it: overseas FoFs, overseas index funds / ETFs, Indian thematic funds on an
  // overseas index (US Equity, S&P 500) and domestic FoFs that hold overseas funds (Nasdaq 100 FoF).
  const overseas = (r) => r.graded.engine === "overseas"
    || (["passive", "thematic", "fof"].includes(r.graded.engine) && isOverseasIndex(`${name(r)} ${r.graded.benchmarkName ?? ""}`));
  return [
    { id: "thematic", label: "sectoral / thematic funds", limit: config.flags.thematicPct,
      test: (r) => !overseas(r) && (r.graded.engine === "thematic" || (r.graded.engine === "passive" && isSectorPassive(r.scheme))) },
    { id: "goldSilver", label: "gold / silver funds", limit: config.flags.goldSilverPct, test: (r) => r.graded.engine === "commodity" },
    { id: "overseas", label: "overseas funds", limit: config.flags.overseasPct, test: overseas },
  ];
}

const assetOf = (r) => (r.scheme ? assetGroup(r.scheme, r.holding.schemeName) : null);
const isEquityPassive = (r) => r.graded.engine === "passive" && assetOf(r) === "equity";
const isDefensive = (r) => assetOf(r) === "debt" || r.graded.engine === "arbitrage";
const isin = (r) => r.members.map((m) => m.holding.isin ?? m.key);
const countFunds = (list) => new Set(list.flatMap(isin)).size;

/** Each fund's share of a limit, strongest first: equal when alike, more for a clearly better first fund. A fund smaller than its share leaves room for the others. */
function shareOut(funds, limit, clearlyBetter, config) {
  const best = funds.length === 2 && clearlyBetter ? config.fit.bestShare : 1 / funds.length;
  const rest = funds.length > 1 ? (1 - best) / (funds.length - 1) : 0;
  const room = funds.map((r, i) => Math.min(r.weightPct, limit * (i === 0 ? best : rest)));
  let spare = limit - room.reduce((s, x) => s + x, 0);
  funds.forEach((r, i) => { const add = Math.min(spare, r.weightPct - room[i]); room[i] += add; spare -= add; });
  return room;
}

/** Same exposure as an INVEST fund: how the two are related, or null. */
function sameExposure(a, b, overlapOf, config) {
  const ga = a.graded, gb = b.graded;
  if (ACTIVE_ENGINES.includes(ga.engine) && ACTIVE_ENGINES.includes(gb.engine)
    && a.scheme.assetClass === b.scheme.assetClass && a.scheme.category === b.scheme.category) return { kind: "category" };
  if (ga.engine === gb.engine && ["passive", "thematic"].includes(ga.engine) && ga.benchmarkCode && ga.benchmarkCode === gb.benchmarkCode) return { kind: "index" };
  if (ga.engine === "equity" && gb.engine === "equity") {
    const o = overlapOf(a, b);
    if (isNum(o) && o >= config.highOverlapPct && compareFunds(a, b).n >= config.overlapMinMeasures) return { kind: "stocks", overlap: o };
  }
  return null;
}

/** Behind its category and its own benchmark on both horizons by duplicateGapPp, with nothing positive to set against that. */
function clearlyBehind(row, config) {
  const { e1, e3, e5 } = row.graded.excess ?? {}, { b1, b3, b5 } = row.graded.benchmarkExcess ?? {};
  const gap = config.duplicateGapPp;
  const behind = (x3, x5, x1) => isNum(x3) && x3 < -gap && (isNum(x5) ? x5 < -gap : isNum(x1) && x1 < 0);
  return behind(e3, e5, e1) && behind(b3, b5, b1) && !Object.values(row.graded.pillars ?? {}).some((p) => p.state === "+");
}

/** Step 1: best first; the first STRONG fund free to take money leads its exposure, and the others give way to it. */
function fundAgainstFund(rows, overlapOf, config) {
  const investors = [];
  const ordered = rows.filter((r) => r.scheme && GRADE_RANK[r.graded.grade] >= 2).sort((a, b) => stronger(b, a));
  for (const row of ordered) {
    let link = null, lead = null;
    for (const inv of investors) {
      link = sameExposure(row, inv, overlapOf, config);
      if (link) { lead = inv; break; }
    }
    if (!lead) {
      if (row.graded.grade === "STRONG" && !row.blocker) { row.invest = true; investors.push(row); }
      continue;
    }
    row.behind = { lead, ...link };
    if (row.graded.grade !== "MIXED") continue;
    if (link.kind === "stocks") row.fundSell = "overlap-weaker";
    else if (link.kind === "category" && clearlyBehind(row, config)) row.fundSell = "weakest-in-category";
  }
}

/** One pass over the limits. rows carry the outcome; returns what was done, for the summary and the Suggestion Box. */
function applyLimits(rows, ctx, config) {
  const { range, smallPct, passiveMax, asOf, basket } = ctx;
  const f = config.fit;
  const themes = themeGroups(config);
  const lockedElss = (r) => r.members.some((m) => isElss(m.scheme, m.holding.schemeName) && (elssLock(m.holding, asOf, config)?.units ?? 1) > 0);
  const soldOut = (r) => Boolean(r.fitExit) || Boolean(r.fundSell) || r.graded.grade === "WEAK";
  // A fund the ELSS lock-in keeps stays in every count: it is still held after this review.
  const kept = () => rows.filter((r) => !soldOut(r) || lockedElss(r));
  const now = (r) => r.trimTo ?? r.weightPct;
  const share = (list, test) => list.filter(test).reduce((s, r) => s + now(r), 0);
  const canSell = (r) => !lockedElss(r) && r.graded.grade !== "REVIEW";
  const exit = (r, facts) => { r.exitedInvest = r.invest; r.fitExit = facts; r.trimTo = null; r.invest = false; };
  const trim = (r, to, facts) => {
    if (r.weightPct - to < f.minTrimPct) return false;
    if (to < smallPct) { exit(r, facts); return true; }   // a stub this small is not worth keeping: exit in full
    r.trimTo = to; r.trimFacts = [...(r.trimFacts ?? []), facts];
    return true;
  };
  const capNow = () => {
    const list = kept().filter((r) => r.cap), sum = { large: 0, mid: 0, small: 0 };
    for (const r of list) for (const k of Object.keys(sum)) sum[k] += (now(r) * r.cap[k]) / 100;
    const total = sum.large + sum.mid + sum.small;
    return total > 0 ? Object.fromEntries(Object.keys(sum).map((k) => [k, (sum[k] / total) * 100])) : null;
  };
  // The Large / Mid / Small segment furthest above this portfolio's basket.
  const heaviestNow = () => { const split = capNow(); return split ? Object.keys(split).sort((a, b) => (split[b] - basket[b]) - (split[a] - basket[a]))[0] : null; };
  const inHeavy = (r, heavy) => Boolean(heavy && r.cap && dominant(r.cap) === heavy);

  // 2. Index funds / ETFs: the best stay; all poor → all exit, and a good tracker is suggested instead. A second fund on
  // an index already held goes first, then a small holding (a large core holding is not sold to keep a stub), then one
  // from the segment furthest above the basket, then the weaker tracker.
  let passiveAllPoor = false;
  const heavy0 = heaviestNow();
  const passiveAll = kept().filter(isEquityPassive);
  // A duplicate is any index fund with a stronger fund on the same index — whether or not that one takes new money now.
  const indexLead = new Map();
  for (const r of [...passiveAll].sort((a, b) => stronger(b, a))) if (r.graded.benchmarkCode && !indexLead.has(r.graded.benchmarkCode)) indexLead.set(r.graded.benchmarkCode, r);
  const leadOf = (r) => indexLead.get(r.graded.benchmarkCode);
  const sameIndex = (r) => Boolean(leadOf(r)) && leadOf(r) !== r;
  const small = (r) => r.weightPct < smallPct;
  const passive = passiveAll.sort((a, b) => (sameIndex(a) - sameIndex(b)) || (small(a) - small(b)) || (inHeavy(a, heavy0) - inHeavy(b, heavy0)) || stronger(b, a));
  const poor = (r) => r.graded.ruleId === "passive-tracking-poor";
  if (passive.length && passive.every(poor)) {
    passiveAllPoor = true;
    for (const r of passive) if (canSell(r)) exit(r, { limit: "passive-poor" });
  } else {
    passive.slice(passiveMax).filter(canSell).forEach((r) => exit(r, { limit: "passive-count", dup: sameIndex(r), sameIndexAs: sameIndex(r) ? leadOf(r) : null, small: small(r), heavy: !small(r) && inHeavy(r, heavy0) ? heavy0 : null }));
    const left = kept().filter(isEquityPassive).sort(stronger).reverse();
    const total = share(left, () => true);
    if (total > f.passiveMaxPct + EPSILON) {
      const room = shareOut(left, f.passiveMaxPct, left.length === 2 && left[0].graded.grade === "STRONG" && left[1].graded.grade !== "STRONG", config);
      // A cut too small to make (or units that cannot be sold) stays as it is; the others take that much more, so the
      // index funds still end at the limit.
      left.forEach((r, i) => { if (!canSell(r) || r.weightPct - room[i] < f.minTrimPct) room[i] = r.weightPct; });
      let over = room.reduce((s, x) => s + x, 0) - f.passiveMaxPct;
      for (let i = left.length - 1; i >= 0 && over > EPSILON; i--) {
        if (room[i] === left[i].weightPct || !canSell(left[i])) continue;
        const take = Math.min(over, room[i]);
        room[i] -= take; over -= take;
      }
      left.forEach((r, i) => { if (canSell(r)) trim(r, room[i], { limit: "passive", limitPct: f.passiveMaxPct, groupPct: total, fundsIn: left.length }); });
    }
  }

  // 3. Themes: down to the limit, weakest first. A non-STRONG fund that fits inside the excess exits; otherwise it is cut.
  const themeBefore = {};
  for (const t of themes) {
    const groupNow = share(kept(), t.test);
    if (groupNow <= t.limit + EPSILON) continue;
    themeBefore[t.id] = groupNow;
    const members = kept().filter(t.test).sort(stronger);
    if (t.id === "overseas") {
      // Overseas funds share the limit: equally, or more for a clearly better fund. None is singled out to exit.
      const best = [...members].reverse();
      const clear = best.length === 2 && best[0].portfolioScore - best[1].portfolioScore >= f.clearLeadScore;
      const room = shareOut(best, t.limit, clear, config);
      best.forEach((r, i) => { if (canSell(r)) trim(r, room[i], { limit: t.id, label: t.label, limitPct: t.limit, groupPct: groupNow }); });
      continue;
    }
    for (const r of members) {
      const excess = share(kept(), t.test) - t.limit;
      if (excess <= EPSILON) break;
      if (!canSell(r)) continue;
      const isLast = kept().filter(t.test).length === 1;
      if (!isLast && r.graded.grade !== "STRONG" && now(r) <= excess + EPSILON) exit(r, { limit: t.id, label: t.label, limitPct: t.limit, groupPct: groupNow });
      else trim(r, Math.max(0, now(r) - excess), { limit: t.id, label: t.label, limitPct: t.limit, groupPct: groupNow });
    }
  }

  // Debt + arbitrage: no limit on the total (that is the risk profile's business), very few funds (2, or 1 in a small
  // portfolio), equal shares.
  // The total stays in debt: larger funds are cut only when a debt fund takes the money.
  let debtTarget = null;
  const defensive = kept().filter(isDefensive).sort(stronger).reverse();
  const debtMax = range.max <= 4 ? f.debtMaxFundsSmall : f.debtMaxFunds;
  defensive.slice(debtMax).filter(canSell).forEach((r) => exit(r, { limit: "debt-count", funds: defensive.length, max: debtMax }));
  const stayed = kept().filter(isDefensive);
  if (stayed.length > 1) {
    debtTarget = defensive.reduce((t, r) => t + r.weightPct, 0) / stayed.length;
    if (stayed.some((r) => r.invest && now(r) < debtTarget - f.minTrimPct)) {
      for (const r of stayed) if (canSell(r) && now(r) > debtTarget + EPSILON) trim(r, debtTarget, { limit: "debt-equal", limitPct: debtTarget, funds: stayed.length });
    }
  }

  // 4. One fund: a hard 20% cannot hold with fewer than five funds, so the limit is then an equal share. Debt and
  // arbitrage funds are left out: moving that money would change the portfolio's risk, not only its balance.
  const fundLimit = Math.max(config.investMaxWeightPct, 100 / Math.max(kept().length, 1));
  for (const r of kept()) {
    if (r.graded.engine === "passive" || r.graded.engine === "arbitrage" || assetOf(r) === "debt" || !canSell(r) || now(r) <= fundLimit + EPSILON) continue;
    trim(r, fundLimit, { limit: "fund", limitPct: fundLimit, groupPct: r.weightPct });
  }

  // 5. Fund count: the same rule at every size, staged by value so a large portfolio is not turned over at once.
  const exits = [];
  const budget = config.fit.reviewSellMaxPct;
  let spent = 0, staged = false;
  while (countFunds(kept()) > range.max) {
    const list = kept();
    const amcs = overAmcs(list, now, config);
    const heaviest = heaviestNow();
    const dup = (r) => Boolean(r.behind) && list.includes(r.behind.lead);
    const overlapped = (r) => dup(r) || Boolean(r.overlapWith && list.includes(r.overlapWith));
    const lastOfClass = (r) => ["hybrid", "debt", "goldSilver"].includes(assetOf(r)) && list.filter((o) => assetOf(o) === assetOf(r)).length === 1;
    const eligible = (r) => !r.invest && canSell(r) && !soldOut(r) && !lastOfClass(r)
      && (r.graded.grade !== "STRONG" || (r.weightPct < smallPct && dup(r)));
    const order = (r) => [r.weightPct < smallPct ? 0 : 1, overlapped(r) ? 0 : 1, heaviest && r.cap && dominant(r.cap) === heaviest ? 0 : 1, amcs.has(r.scheme?.amc) ? 0 : 1];
    const ranked = list.filter(eligible).sort((a, b) => order(a).reduce((d, x, i) => d || x - order(b)[i], 0) || stronger(a, b));
    if (!ranked.length) break;
    const pick = ranked.find((r) => spent + now(r) <= budget + EPSILON);
    if (!pick) { staged = true; break; }
    spent += now(pick);
    exit(pick, { limit: "count", small: pick.weightPct < smallPct, dup: dup(pick), overlapped: overlapped(pick), amc: amcs.has(pick.scheme?.amc), heavy: heaviest && pick.cap && dominant(pick.cap) === heaviest ? heaviest : null });
    exits.push(pick);
  }

  return { kept: kept(), now, share, themes, passiveAllPoor, exits, spent, staged, split: capNow(), debtTarget, themeBefore };
}

const dominant = (cap) => Object.keys(cap).sort((a, b) => cap[b] - cap[a])[0];

function overAmcs(list, now, config) {
  const by = new Map();
  for (const r of list) if (r.scheme?.amc) by.set(r.scheme.amc, (by.get(r.scheme.amc) ?? 0) + now(r));
  return new Map([...by].filter(([, pct]) => pct > config.flags.amcPct));
}

/** Step 6: an INVEST that a limit stops, or a fund being cut. Returns whether anything changed. */
function noNewMoney(rows, result, config) {
  const { kept, now, share, themes } = result;
  const amcs = overAmcs(kept, now, config);
  let changed = false;
  for (const r of rows) {
    // A limit sold a fund that led its exposure: the walk runs without it, so nothing points at it.
    if (r.exitedInvest) {
      r.blocker = { ruleId: "fit-limit-held", reason: `Strong, but a portfolio limit applies to this fund — no new money. ${r.graded.reason}` };
      changed = true;
      continue;
    }
    if (!r.invest || r.fundSell) continue;
    const theme = themes.find((t) => t.test(r) && share(kept, t.test) >= t.limit - EPSILON);
    if (isEquityPassive(r) && share(kept, isEquityPassive) >= config.fit.passiveMaxPct - EPSILON) {
      r.blocker = { ruleId: "fit-index-limit", reason: `Strong, but index funds / ETFs are at their ${config.fit.passiveMaxPct}% limit — no new money. ${r.graded.reason}` };
      changed = true;
    } else if (r.trimTo !== null) {
      r.blocker = { ruleId: "fit-trimmed", reason: `Strong, but being reduced to its limit — no new money. ${r.graded.reason}` };
      changed = true;
    } else if (amcs.has(r.scheme?.amc)) {
      r.blocker = { ruleId: "fit-amc-limit", reason: `Strong, but ${r.scheme.amc} is already ${amcs.get(r.scheme.amc).toFixed(1)}% of the portfolio (limit ${config.flags.amcPct}%) — no new money to this fund house. ${r.graded.reason}` };
      changed = true;
    } else if (theme) {
      r.blocker = { ruleId: "fit-theme-limit", reason: `Strong, but ${theme.label} are at their ${theme.limit}% limit — no new money. ${r.graded.reason}` };
      changed = true;
    }
  }
  return changed;
}

/** Stage 2 for the whole portfolio. Runs until no limit takes away an INVEST: the result is then stable. */
export function decidePortfolio(rows, { totalRupees, asOf, profile }, overlapOf, config) {
  const f = config.fit;
  const count0 = countFunds(rows);
  const { range } = diversificationStatus({ numFunds: count0, portfolioValue: totalRupees });
  const ctx = { range, smallPct: (100 / range.max) * f.smallShareOfAverage, passiveMax: range.max <= f.smallPortfolioIdealMax ? f.passiveMaxFundsSmall : f.passiveMaxFunds, asOf, basket: capBasket(profile, config) };
  rankFunds(rows, overlapOf, config);
  let result;
  for (let pass = 0; pass <= rows.length; pass++) {
    for (const r of rows) Object.assign(r, { invest: false, exitedInvest: false, behind: null, fundSell: null, fitExit: null, trimTo: null, trimFacts: null });
    fundAgainstFund(rows, overlapOf, config);
    markHeldOverlaps(rows, overlapOf, config);
    result = applyLimits(rows, ctx, config);
    if (!noNewMoney(rows, result, config)) break;
  }
  const passive0 = rows.filter(isEquityPassive).length;
  return { ...result, ctx, count0, passive0, fundsAfter: countFunds(result.kept) };
}

/** Two funds that share their stocks with neither one leading: the weaker is first in line in a consolidation. */
function markHeldOverlaps(rows, overlapOf, config) {
  for (const r of rows) { r.overlapWith = null; r.overlapPct = null; }
  const held = rows.filter((r) => r.scheme && r.graded.engine === "equity" && !r.behind && !r.invest).sort((a, b) => stronger(b, a));
  held.forEach((r, i) => {
    r.overlapWith = rows.filter((o) => o.invest).concat(held.slice(0, i)).find((o) => sameExposure(r, o, overlapOf, config)?.kind === "stocks") ?? null;
    if (r.overlapWith) r.overlapPct = overlapOf(r, r.overlapWith);
  });
}

/**
 * Where the money from a sale goes: the fund it gave way to, else an INVEST fund on the same side of the portfolio —
 * equity money to equity funds, debt money to debt funds, so a sale never changes the portfolio's risk on its own —
 * else the Prosperr Recommended Portfolio. Debt money goes to the debt fund furthest below its equal share.
 */
function destination(row, rows) {
  if (row.behind?.lead.invest) return fundLabel(row.behind.lead);
  const side = isDefensive(row);
  const homes = rows.filter((r) => r.invest && isDefensive(r) === side);
  if (!homes.length) return "the Prosperr Recommended Portfolio";
  if (side || homes.length === 1) return fundLabel(homes.sort((a, b) => (a.trimTo ?? a.weightPct) - (b.trimTo ?? b.weightPct))[0]);
  return homes.length === rows.filter((r) => r.invest).length ? "the Invest funds" : "the equity funds marked Invest";
}

function limitText(facts, count0, range, passive0, passiveMax) {
  switch (facts.limit) {
    case "count": return `the portfolio holds ${count0} funds where ${range.min}–${range.max} suit its size`;
    case "passive-poor": return "every index fund / ETF held trails its index by more than the tracking limit";
    case "debt-count": return `it holds ${facts.funds} debt and arbitrage funds where ${facts.max} ${facts.max === 1 ? "is" : "are"} enough`;
    case "debt-equal": return `the ${facts.funds} debt and arbitrage funds kept should be equal, at ${facts.limitPct.toFixed(1)}% each`;
    case "passive-count": return `it holds ${passive0} index funds / ETFs where ${passiveMax} are enough`;
    case "passive": return `index funds / ETFs are ${facts.groupPct.toFixed(1)}% of the portfolio (limit ${facts.limitPct}%)`;
    case "fund": return `this one fund is ${facts.groupPct.toFixed(1)}% of the portfolio (limit ${facts.limitPct.toFixed(0)}%)`;
    default: return `${facts.label} are ${facts.groupPct.toFixed(1)}% of the portfolio (limit ${facts.limitPct}%)`;
  }
}

/** A fund's final call (§6), before the per-folio ELSS check. The one place status, rule and reason are written. */
export function fundCall(fund, rows, plan, config) {
  const { graded, behind } = fund;
  const { ctx, count0, passive0 } = plan;
  const { range, passiveMax } = ctx;
  const to = destination(fund, rows);
  if (fund.fitExit) {
    const facts = fund.fitExit, why = [];
    if (facts.small) why.push(`a small holding (${fund.weightPct.toFixed(1)}% of the portfolio)`);
    if (facts.dup) why.push(`${fundLabel(facts.sameIndexAs ?? behind.lead)} already covers the same ${facts.sameIndexAs ? "index" : behind.kind}`);
    else if (facts.overlapped) why.push(`it shares its stocks with ${fundLabel(fund.overlapWith)}, the stronger of the two`);
    if (facts.heavy) why.push(`${facts.heavy} caps are above this portfolio's ${ctx.basket.label} reference mix`);
    if (facts.amc) why.push(`${fund.scheme.amc} is above ${config.flags.amcPct}% of the portfolio`);
    // Another fund still held gives the same gold / silver / overseas exposure.
    const same = ["commodity", "overseas"].includes(graded.engine) ? plan.kept.find((o) => o !== fund && o.graded.engine === graded.engine) : null;
    if (same) why.push(`${fundLabel(same)} already gives the ${graded.engine === "commodity" ? "gold / silver" : "overseas"} exposure`);
    if (!why.length && facts.limit === "passive-count") why.push("the index funds kept track their indices more closely");
    if (!why.length && facts.limit === "debt-count") why.push("the debt and arbitrage funds kept rank higher");
    if (!why.length) {
      const measured = isNum(graded.excess?.e3) || isNum(graded.benchmarkExcess?.b3);
      why.push(measured ? "among the weakest of the funds held" : `not compared with peers (${fund.weightPct.toFixed(1)}% of the portfolio), so it is the easiest to do without`);
    }
    return { status: "sell", ruleId: "fit-exit", move: to,
      reason: `Portfolio fit — ${limitText(facts, count0, range, passive0, passiveMax)}. This fund: ${why.join("; ")} — exit and move the money to ${to}. On its own: ${graded.reason}` };
  }
  if (fund.fundSell === "weakest-in-category") {
    return { status: "sell", ruleId: "weakest-in-category", move: to, stage: "fund",
      reason: `Same category as ${fundLabel(behind.lead)}, and clearly behind both its category median and its benchmark, with no strength to set against that — consolidate into ${to}.` };
  }
  if (fund.fundSell === "overlap-weaker") {
    const { aWins, bWins, n } = compareFunds(behind.lead, fund);
    return { status: "sell", ruleId: "overlap-weaker", move: to,
      reason: `${Math.round(behind.overlap)}% of its equity holdings are the same stocks as ${fundLabel(behind.lead)}, which takes the new money and is better on ${Math.max(aWins, bWins)} of ${n} measures — consolidate into ${to}.` };
  }
  if (graded.grade === "WEAK") return { status: "sell", ruleId: graded.ruleId, reason: graded.reason, move: to };
  if (fund.trimTo !== null && fund.trimTo !== undefined) {
    const cut = fund.weightPct - fund.trimTo;
    const why = fund.trimFacts.map((facts) => limitText(facts, count0, range, passive0, passiveMax)).join("; ");
    return { status: "sell", ruleId: "fit-trim", move: to, trim: { fromPct: fund.weightPct, toPct: fund.trimTo, cutPct: cut },
      reason: `Portfolio fit — ${why}. Reduce this fund from ${fund.weightPct.toFixed(1)}% to ${fund.trimTo.toFixed(1)}% of the portfolio and move the money to ${to}; the rest stays invested. On its own: ${graded.reason}` };
  }
  if (fund.invest) return { status: "invest", ruleId: graded.ruleId, reason: graded.reason };
  if (graded.grade === "REVIEW") return { status: "review", ruleId: graded.ruleId, reason: graded.reason };
  if (graded.grade === "STRONG") {
    if (fund.blocker) return { status: "hold", ruleId: fund.blocker.ruleId, reason: fund.blocker.reason };
    if (!behind) return { status: "hold", ruleId: graded.ruleId, reason: graded.reason };
    const lead = fundLabel(behind.lead);
    if (behind.kind === "category") return { status: "hold", ruleId: "strong-not-best", reason: `Strong, but ${lead} ranks higher in the same category. ${graded.reason}` };
    if (behind.kind === "index") return { status: "hold", ruleId: "passive-same-index", reason: `Same index as ${lead}, which ranks higher — new money goes there. ${graded.reason}` };
    return { status: "hold", ruleId: "overlap-strong-weaker", reason: `Strong, but ${Math.round(behind.overlap)}% of its equity holdings are the same stocks as ${lead}, the stronger of the two — new money goes there. ${graded.reason}` };
  }
  const shared = fund.overlapWith ? `${Math.round(fund.overlapPct)}% of its equity holdings are the same stocks as ${fundLabel(fund.overlapWith)}, the stronger of the two, but neither takes new money, so it is held for now. ` : "";
  return { status: "hold", ruleId: graded.ruleId, reason: `${shared}${graded.reason}` };
}

/** Notes shown with a fund, from the same decision: nothing here sets a call. */
export function fitNotes(fund, rows) {
  const notes = [];
  if (fund.behind && !fund.fundSell && !fund.fitExit && fund.graded.grade !== "WEAK") {
    const lead = fundLabel(fund.behind.lead);
    notes.push(fund.behind.kind === "stocks" ? `Shares ${Math.round(fund.behind.overlap)}% of its stocks with ${lead} — new money goes there.`
      : `Same ${fund.behind.kind === "index" ? "index" : "category"} as ${lead} — consider consolidating; new money goes to ${lead}.`);
  }
  for (const other of rows) {
    if (other.behind?.lead === fund && other.behind.kind === "stocks") notes.push(`High overlap (${Math.round(other.behind.overlap)}%) with ${fundLabel(other)} — the two hold largely the same stocks.`);
  }
  return notes;
}

const inr = (rupees) => `₹${Math.round(rupees).toLocaleString("en-IN")}`;

/** What a fund's call means for the fund it gave way to, as figures, for the "why this fund" comparison. */
export function comparison(fund) {
  const other = fund.behind?.lead ?? fund.overlapWith ?? null;
  if (!other) return null;
  const line = (label, read, show) => {
    const a = read(fund), b = read(other);
    return isNum(a) && isNum(b) ? { label, fund: show(a), other: show(b), otherBetter: b > a } : null;
  };
  const pct = (x) => `${x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)}%`;
  return { otherName: fundLabel(other), rows: [
    line("3Y vs category", (r) => r.graded.excess?.e3, pp), line("5Y vs category", (r) => r.graded.excess?.e5, pp),
    line("3Y vs benchmark", (r) => r.graded.benchmarkExcess?.b3, pp), line("5Y vs benchmark", (r) => r.graded.benchmarkExcess?.b5, pp),
    line("Consistency", (r) => r.stats?.consistency, (x) => `${Math.round(x)}%`), line("Sharpe (3Y)", (r) => r.stats?.sharpe3y, (x) => x.toFixed(2)),
    line("Deepest fall (3Y)", (r) => r.stats?.maxDrawdown3y, pct),
  ].filter(Boolean) };
}

/**
 * Suggestion Box (§5.3), client wording. It reads the same decision as the calls and says only what was done,
 * so a line can never promise an exit that no fund carries.
 */
export function suggestionBox(rows, plan, { totalRupees, pick, overlapOf }, config) {
  const out = [];
  const { ctx, count0, passive0, kept, exits, spent, staged, passiveAllPoor, fundsAfter, split, now, share, themes } = plan;
  const { range, passiveMax } = ctx;
  const sold = rows.filter((r) => !kept.includes(r));
  if (fundsAfter < range.min) {
    out.push({ id: "count", text: fundsAfter < count0
      ? `After these changes the portfolio holds ${fundsAfter} fund${fundsAfter === 1 ? "" : "s"}, fewer than the ${range.min}–${range.max} that suit a portfolio of this size; we recommend redeploying the proceeds across the Prosperr Recommended Portfolio to restore diversification.`
      : `The portfolio holds ${count0} fund${count0 === 1 ? "" : "s"}, fewer than the ${range.min}–${range.max} that suit a portfolio of this size; we recommend directing new investments to the Prosperr Recommended Portfolio to build diversification.` });
  }
  if (count0 > range.max) {
    const soldPct = sold.reduce((s, r) => s + r.weightPct, 0);
    const done = sold.length ? `This review exits ${sold.length} fund${sold.length > 1 ? "s" : ""} (${soldPct.toFixed(1)}% of the portfolio), which brings it to ${fundsAfter}.` : "No fund can be exited in this review without losing a needed exposure.";
    out.push({ id: "count", text: `The portfolio holds ${count0} funds, where ${range.min}–${range.max} suit a portfolio of this size. ${done}`
      + (fundsAfter <= range.max ? ""
        : plan.staged ? ` Further consolidation is staged over later reviews: exits made only to reduce the number of funds are kept to ${config.fit.reviewSellMaxPct}% of the portfolio per review.`
          : " The other funds stay for now: they take new money, are the only fund of their kind, or have units in the ELSS lock-in.") });
  }
  if (passiveAllPoor) {
    const amount = (totalRupees * config.fit.passiveSuggestPct) / 100;
    out.push({ id: "passive", text: `Every index fund / ETF held trails its index beyond the tracking limit, so we recommend exiting them${pick ? ` and placing ${config.fit.passiveSuggestPct}% of the portfolio (about ${inr(amount)}) in ${pick.name}, which has tracked ${pick.index} best over 1, 3 and 5 years` : ""}.` });
  } else if (passive0 > passiveMax && rows.some((r) => r.fitExit?.limit === "passive-count")) {
    out.push({ id: "passive", text: `The portfolio holds ${passive0} index funds / ETFs; ${passiveMax} are enough for it, so the best ${passiveMax} are kept and the others are marked for exit.` });
  } else if (passive0 > passiveMax) {
    out.push({ id: "passive", text: `The portfolio holds ${passive0} index funds / ETFs, above the ${passiveMax} it needs; the others cannot be exited in this review.` });
  }
  for (const r of rows.filter((x) => x.trimTo !== null && x.trimTo !== undefined && !x.fitExit)) {
    const cut = r.weightPct - r.trimTo;
    out.push({ id: "trim", text: `${fundLabel(r)}: reduce from ${r.weightPct.toFixed(1)}% to ${r.trimTo.toFixed(1)}% of the portfolio (about ${inr((totalRupees * cut) / 100)}) — ${limitText(r.trimFacts[0], count0, range, passive0, passiveMax)}.` });
  }
  if (rows.some((r) => r.fitExit?.limit === "debt-count")) {
    const max = rows.find((r) => r.fitExit?.limit === "debt-count").fitExit.max;
    out.push({ id: "debt", text: `The debt and arbitrage funds are consolidated into ${max === 1 ? "one fund, the strongest held" : `${max}, the strongest of those held`}; the money stays in debt wherever a debt fund can take it.` });
  }
  // The equal share among the debt funds still held at the end (the fund-count step may have exited one after the debt step).
  const debtKept = kept.filter(isDefensive);
  const debtEqual = debtKept.length > 1 ? debtKept.reduce((t, r) => t + now(r), 0) / debtKept.length : null;
  if (plan.debtTarget !== null && debtKept.length > 1 && rows.some((r) => r.invest && isDefensive(r)) && debtKept.some((r) => now(r) < plan.debtTarget - config.fit.minTrimPct)) {
    out.push({ id: "debt", text: `The debt and arbitrage funds kept are brought towards an equal share of about ${plan.debtTarget.toFixed(1)}% each, with the money from the debt sales.` });
  }
  if (debtEqual !== null && !rows.some((r) => r.invest && isDefensive(r))
    && debtKept.some((r) => now(r) > debtEqual + config.fit.minTrimPct)) {
    out.push({ id: "debt", text: `The debt and arbitrage funds should be equal, at about ${debtEqual.toFixed(1)}% each; no change is made now because none of them is taking new money.` });
  }
  for (const [amc, pct] of overAmcs(kept, now, config)) {
    out.push({ id: "amc", text: `${pct.toFixed(1)}% of the portfolio is with one fund house (${amc}), above ${config.flags.amcPct}% — new investments should go to other fund houses.` });
  }
  for (const t of themes) {
    const after = share(kept, t.test);
    if (plan.themeBefore[t.id] && after < t.limit - EPSILON) out.push({ id: t.id, text: `${t.label[0].toUpperCase()}${t.label.slice(1)} were ${plan.themeBefore[t.id].toFixed(1)}% of the portfolio, above the ${t.limit}% limit; the weaker are marked for exit or reduction, which brings them to ${after.toFixed(1)}%.` });
    else if (Math.abs(after - t.limit) < EPSILON) out.push({ id: t.id, text: `${t.label[0].toUpperCase()}${t.label.slice(1)} are brought to their ${t.limit}% limit — no new money into them.` });
    else if (after > t.limit) out.push({ id: t.id, text: `${after.toFixed(1)}% of the portfolio stays in ${t.label}, above ${t.limit}%, because these units cannot be sold yet — no new money into them.` });
  }
  for (const r of rows.filter((x) => x.behind?.kind === "stocks" && kept.includes(x) === false)) {
    out.push({ id: "overlap", text: `${fundLabel(r)} and ${fundLabel(r.behind.lead)} hold ${Math.round(r.behind.overlap)}% of the same stocks, so the first is consolidated into the second.` });
  }
  for (const r of rows.filter((x) => x.overlapWith && kept.includes(x))) {
    out.push({ id: "overlap", text: `${fundLabel(r)} and ${fundLabel(r.overlapWith)} hold ${Math.round(overlapOf(r, r.overlapWith))}% of the same stocks — largely the same exposure.` });
  }
  // An index fund / ETF is itself diversified across its index: no single-fund concentration point.
  // Debt and arbitrage funds are outside this limit; a fund already being cut has its own line.
  for (const r of kept.filter((x) => now(x) > config.investMaxWeightPct + EPSILON && x.graded.engine !== "passive" && !isDefensive(x) && (x.trimTo === null || x.trimTo === undefined))) {
    out.push({ id: "fund", text: `${fundLabel(r)} is ${now(r).toFixed(1)}% of the portfolio, above ${config.investMaxWeightPct}% — new investments should go to other funds.` });
  }
  if (split) {
    const { basket } = plan.ctx;
    out.push({ id: "cap", text: `For this portfolio's risk profile and horizon, the ${basket.label} mix of Large ${basket.large}%, Mid ${basket.mid}%, Small ${basket.small}% is the reference. After these changes, equity is split Large ${split.large.toFixed(0)}%, Mid ${split.mid.toFixed(0)}%, Small ${split.small.toFixed(0)}%, before the proceeds are reinvested.` });
  }
  for (const r of rows.filter((x) => x.members.length > 1)) {
    const plans = new Set(r.members.map((m) => m.scheme?.plan));
    out.push({ id: "folios", text: plans.size > 1
      ? `${r.scheme.schemeName} is held in both its ${[...plans].join(" and ")} plans — consider consolidating into one plan.`
      : `${fundLabel(r)} is held in ${r.members.length} folios — they can be merged into one folio through the registrar (CAMS / KFintech); no sale is needed.` });
  }
  return out;
}
