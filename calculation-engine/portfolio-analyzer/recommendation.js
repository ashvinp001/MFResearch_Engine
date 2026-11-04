/**
 * Prosperr Recommendation — the advisor's Invest / Hold / Sell call per fund.
 *
 * Input:  a validated portfolio, the advisor's verdicts { [holdingKey]: verdict } and the logic's suggestions
 *         ({ [holdingKey]: { trim: { amount } | null } }, optional).
 * Output: summarizeRecommendations → {
 *   totalValue, complete, unset: Holding[],
 *   byVerdict: { invest|hold|sell: { holdings, count, value, share, partial? } }
 * }
 * A partial sale stays one Sell fund, but sell.value holds only the amount sold; what stays invested counts in hold
 * (sell.partial = how many of the Sell funds are partial sales).
 * Values are summed in integer paise from the printed strings. Verdicts are the
 * advisor's decision; the engine never sets one.
 */

import { holdingKey } from "../model/portfolio.schema.js";
import { toPaise } from "../cas/parse-values.js";

const VERDICT = Object.freeze({ INVEST: "invest", HOLD: "hold", SELL: "sell" });
const VERDICTS = Object.freeze([VERDICT.INVEST, VERDICT.HOLD, VERDICT.SELL]);

export function summarizeRecommendations(portfolio, verdicts, suggestions = {}) {
  const active = portfolio.holdings.filter((holding) => holding.status === "active");
  const totalPaise = active.reduce((sum, holding) => sum + (toPaise(holding.raw.marketValue) ?? 0), 0);

  const byVerdict = {};
  for (const verdict of VERDICTS) byVerdict[verdict] = { holdings: [], paise: 0 };
  const unset = [];
  let partial = 0;

  for (const holding of active) {
    const verdict = verdicts[holdingKey(holding)];
    if (!VERDICTS.includes(verdict)) {
      unset.push(holding);
      continue;
    }
    byVerdict[verdict].holdings.push(holding);
    const paise = toPaise(holding.raw.marketValue) ?? 0;
    const trim = verdict === VERDICT.SELL ? suggestions[holdingKey(holding)]?.trim ?? null : null;
    const sold = trim ? Math.min(paise, Math.round(trim.amount * 100)) : paise;
    byVerdict[verdict].paise += sold;
    if (sold < paise) { byVerdict[VERDICT.HOLD].paise += paise - sold; partial += 1; }
  }

  const result = {};
  for (const verdict of VERDICTS) {
    const { holdings, paise } = byVerdict[verdict];
    result[verdict] = { holdings, count: holdings.length, value: paise / 100, share: totalPaise ? paise / totalPaise : 0 };
  }
  result.sell.partial = partial;
  return { totalValue: totalPaise / 100, byVerdict: result, unset, complete: active.length > 0 && unset.length === 0 };
}
