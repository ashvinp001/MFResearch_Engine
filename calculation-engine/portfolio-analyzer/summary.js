/**
 * Portfolio summary — headline figures from PRINTED values only.
 *
 * Input:  a validated NormalizedPortfolio.
 * Output: {
 *   activeCount, redeemedCount, amcCount,
 *   totalMarketValue, totalCostValue, unrealisedGain, unrealisedGainPct, holdingsWithoutCost,
 *   shareOf(holding) → share of current value (0–1) | null,
 *   byAmc: [ { amc, marketValue, share } ]   // sorted by value, descending
 * }
 * Sums run in integer paise from the printed strings. Cost and gain cover only
 * holdings that print both cost and value; `holdingsWithoutCost` counts the rest.
 * holdingGain(holding) → { gain, gainPct } | null for a single row.
 */

import { toPaise } from "../cas/parse-values.js";

export function summarizePortfolio(portfolio) {
  const active = portfolio.holdings.filter((holding) => holding.status === "active");

  const marketPaise = sumPaise(active.map((holding) => holding.raw.marketValue));

  // Cost and gain only over holdings that print BOTH values (depository demat
  // units often print no cost); the excluded count is reported, never hidden.
  const withCost = active.filter((holding) => toPaise(holding.raw.costValue) !== null && toPaise(holding.raw.marketValue) !== null);
  const costPaise = withCost.length ? sumPaise(withCost.map((holding) => holding.raw.costValue)) : null;
  const costedMarketPaise = withCost.length ? sumPaise(withCost.map((holding) => holding.raw.marketValue)) : null;
  const gainPaise = costPaise !== null ? costedMarketPaise - costPaise : null;

  const amcTotals = new Map();
  for (const holding of active) {
    const paise = toPaise(holding.raw.marketValue);
    if (paise === null) continue;
    const amc = holding.amc ?? "Unspecified AMC";
    amcTotals.set(amc, (amcTotals.get(amc) ?? 0) + paise);
  }
  const allocated = [...amcTotals.values()].reduce((sum, paise) => sum + paise, 0);
  const byAmc = [...amcTotals.entries()]
    .map(([amc, paise]) => ({ amc, marketValue: paise / 100, share: allocated ? paise / allocated : 0 }))
    .sort((p, q) => q.marketValue - p.marketValue || p.amc.localeCompare(q.amc));

  return {
    activeCount: active.length,
    redeemedCount: portfolio.holdings.length - active.length,
    amcCount: new Set(active.map((holding) => holding.amc).filter(Boolean)).size,
    totalMarketValue: marketPaise === null ? null : marketPaise / 100,
    totalCostValue: costPaise === null ? null : costPaise / 100,
    unrealisedGain: gainPaise === null ? null : gainPaise / 100,
    unrealisedGainPct: gainPaise === null || !costPaise ? null : gainPaise / costPaise,
    holdingsWithoutCost: active.length - withCost.length,
    shareOf: (holding) => {
      const paise = toPaise(holding.raw.marketValue);
      return paise === null || !marketPaise || holding.status !== "active" ? null : paise / marketPaise;
    },
    byAmc,
  };
}

/**
 * Unrealised gain for one holding from its printed cost and market value.
 * Returns { gain, gainPct } or null when either value was not printed.
 */
export function holdingGain(holding) {
  const market = toPaise(holding.raw.marketValue);
  const cost = toPaise(holding.raw.costValue);
  if (market === null || cost === null) return null;
  return { gain: (market - cost) / 100, gainPct: cost ? (market - cost) / cost : null };
}

/** Null if any value is missing — a partial sum would be a confident-but-wrong number. */
function sumPaise(rawValues) {
  if (rawValues.length === 0) return null;
  let total = 0;
  for (const raw of rawValues) {
    const paise = toPaise(raw);
    if (paise === null) return null;
    total += paise;
  }
  return total;
}
