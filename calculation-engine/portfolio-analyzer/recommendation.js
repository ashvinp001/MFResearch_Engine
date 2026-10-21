/**
 * Prosperr Recommendation — the advisor's Invest / Hold / Sell call per fund.
 *
 * Input:  a validated portfolio and the advisor's verdicts { [holdingKey]: verdict }.
 * Output: summarizeRecommendations → {
 *   totalValue, complete, unset: Holding[],
 *   byVerdict: { invest|hold|sell: { holdings, count, value, share } }
 * }
 * Values are summed in integer paise from the printed strings. Verdicts are the
 * advisor's decision; the engine never sets one. Excess return needs NAV data
 * (Phase 2) and returns null until both returns are available.
 */

import { holdingKey } from "../model/portfolio.schema.js";
import { toPaise } from "../cas/parse-values.js";

export const VERDICT = Object.freeze({ INVEST: "invest", HOLD: "hold", SELL: "sell" });
export const VERDICTS = Object.freeze([VERDICT.INVEST, VERDICT.HOLD, VERDICT.SELL]);

/** Fund 1-year return minus benchmark 1-year return (both as ratios), or null. */
export function excessReturn(fundReturn, benchmarkReturn) {
  if (fundReturn === null || fundReturn === undefined || benchmarkReturn === null || benchmarkReturn === undefined) return null;
  return fundReturn - benchmarkReturn;
}

export function summarizeRecommendations(portfolio, verdicts) {
  const active = portfolio.holdings.filter((holding) => holding.status === "active");
  const totalPaise = active.reduce((sum, holding) => sum + (toPaise(holding.raw.marketValue) ?? 0), 0);

  const byVerdict = {};
  for (const verdict of VERDICTS) byVerdict[verdict] = { holdings: [], paise: 0 };
  const unset = [];

  for (const holding of active) {
    const verdict = verdicts[holdingKey(holding)];
    if (!VERDICTS.includes(verdict)) {
      unset.push(holding);
      continue;
    }
    byVerdict[verdict].holdings.push(holding);
    byVerdict[verdict].paise += toPaise(holding.raw.marketValue) ?? 0;
  }

  const result = {};
  for (const verdict of VERDICTS) {
    const { holdings, paise } = byVerdict[verdict];
    result[verdict] = { holdings, count: holdings.length, value: paise / 100, share: totalPaise ? paise / totalPaise : 0 };
  }
  return { totalValue: totalPaise / 100, byVerdict: result, unset, complete: active.length > 0 && unset.length === 0 };
}
