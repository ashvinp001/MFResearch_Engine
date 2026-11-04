/**
 * Stock-level overlap between two funds' equity holdings. Used by the recommendation logic and the reports.
 */

import { isNum } from "../analytics/stats.js";

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
