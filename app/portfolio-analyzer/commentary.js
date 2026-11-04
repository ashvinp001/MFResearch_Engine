/**
 * Report commentary built from the advisor's Invest / Hold / Sell choices.
 *
 * Input:  recommendation summary (engine: summarizeRecommendations).
 * Output: { points: [{ verdict, text }], conclusion }
 * Wording states only what the advisor decided and what the statement shows;
 * it never claims performance reasons.
 */

import { formatInr } from "../shared/format.js";

const pct = (share) => `${(share * 100).toFixed(1)}%`;

function listNames(holdings) {
  const names = holdings.map((holding) => holding.schemeName ?? holding.isin);
  if (names.length <= 3) return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

const fundsWord = (count) => `${count} fund${count > 1 ? "s" : ""}`;

export function buildCommentary(recommendation) {
  const { invest, hold, sell } = recommendation.byVerdict;
  const points = [];

  if (invest.count) {
    points.push({ verdict: "invest", text: `Continue and add to ${fundsWord(invest.count)}: ${listNames(invest.holdings)}. Together they are ${formatInr(invest.value)} (${pct(invest.share)} of the portfolio).` });
  }
  if (hold.count) {
    points.push({ verdict: "hold", text: `Hold ${fundsWord(hold.count)}: ${listNames(hold.holdings)}, worth ${formatInr(hold.value)} (${pct(hold.share)}). No fresh investment is recommended in these for now.` });
  }
  if (sell.count) {
    const partly = sell.partial ? ` (${sell.partial} of them a partial sale)` : "";
    points.push({ verdict: "sell", text: `Sell ${fundsWord(sell.count)}${partly}: ${listNames(sell.holdings)}, releasing ${formatInr(sell.value)} (${pct(sell.share)}) at statement value.` });
  }

  const conclusion = recommendation.complete
    ? `Of the portfolio value of ${formatInr(recommendation.totalValue)}, ${pct(invest.share)} is recommended to grow, ${pct(hold.share)} to hold and ${pct(sell.share)} to sell. ` +
      (sell.count
        ? `The sale proceeds of ${formatInr(sell.value)} (at statement value) can be redeployed into the Prosperr Recommended Portfolio.`
        : "No exits are recommended at this time.")
    : null;

  return { points, conclusion };
}
