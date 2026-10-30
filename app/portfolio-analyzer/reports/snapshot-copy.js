/**
 * One-pager wording: advisor options, the "What it means" risk notes (as in the
 * Sample Portfolio Review), and suggested Investment Strategy / Observations text
 * written ONLY from numbers on the snapshot. The advisor can edit both texts.
 */

import { formatSnapshotDate } from "./snapshot-format.js";
import { benchmarkPhrase } from "../../shared/format.js";

// Options = the exact labels of the Prosperr logic (calculation-engine/portfolio-analyzer/report-profile.js).
export { RISK_PROFILE_LABELS as RISK_PROFILES, HORIZON_LABELS as HORIZONS } from "../../../calculation-engine/index.js";

export const RISK_ROWS = [
  { key: "alpha", label: "Alpha", meaning: "Extra return earned over the benchmark." },
  { key: "beta", label: "Beta", meaning: "Moves less than the market (below 1 = steadier)." },
  { key: "stdDev", label: "Standard Deviation", meaning: "How much returns swing year to year." },
  { key: "sharpe", label: "Sharpe Ratio", meaning: "Return earned per unit of risk taken." },
];

const one = (value) => value.toFixed(1);

export function suggestedStrategy(snapshot) {
  const roles = [];
  const c = snapshot.composition;
  if (c?.equity > 0) roles.push("equity for growth");
  if (c?.debt > 0) roles.push("debt for stability");
  if (c?.goldSilver > 0) roles.push("a gold/silver hedge");
  const roleText = roles.length ? ` — ${roles.length > 1 ? `${roles.slice(0, -1).join(", ")} and ${roles.at(-1)}` : roles[0]}` : "";
  return `A diversified allocation across ${snapshot.fundCount} funds and ${snapshot.amcCount} fund houses${roleText}. ` +
    `As per the Consolidated Account Statement as on ${formatSnapshotDate(snapshot.asOf)}.`;
}

export function suggestedObservations(snapshot, portfolio) {
  const sentences = [];
  const rows = snapshot.holdings.rows;

  if (rows.length) {
    const top3 = rows.slice(0, 3).reduce((sum, row) => sum + row.weightPct, 0);
    sentences.push(`The largest holding is ${rows[0].name} at ${rows[0].weightPct.toFixed(1)}% of the portfolio` +
      (snapshot.fundCount > 3 ? `; the top 3 funds together make up ${top3.toFixed(1)}%.` : "."));
  }
  const topAmc = snapshot.amcAllocation[0];
  if (topAmc && snapshot.amcCount > 1) {
    sentences.push(`${topAmc.amc} is the largest fund house exposure at ${one(topAmc.pct)}% across ${snapshot.amcCount} AMCs.`);
  }

  if (snapshot.marketCap) {
    const midSmall = snapshot.marketCap.mid + snapshot.marketCap.small;
    sentences.push(`Equity is split ${one(snapshot.marketCap.large)}% large cap and ${one(midSmall)}% mid and small cap combined.`);
  }
  if (snapshot.composition) {
    sentences.push(`Asset mix is ${one(snapshot.composition.equity)}% equity, ${one(snapshot.composition.debt)}% debt and ${one(snapshot.composition.goldSilver)}% gold/silver.`);
  }

  const losers = portfolio.holdings
    .filter((holding) => holding.status === "active" && holding.costValue && holding.marketValue !== null && holding.marketValue < holding.costValue)
    .map((holding) => ({ name: holding.schemeName, pct: ((holding.marketValue - holding.costValue) / holding.costValue) * 100 }))
    .sort((p, q) => p.pct - q.pct);
  if (losers.length) {
    const shown = losers.slice(0, 2).map((loser) => `${loser.name} (${loser.pct.toFixed(1)}%)`).join(" and ");
    sentences.push(`${losers.length} fund${losers.length > 1 ? "s show" : " shows"} a loss on cost, led by ${shown}.`);
  }

  const { invested, value, gainPct } = snapshot.totals;
  if (invested !== null && gainPct !== null) {
    const direction = gainPct > 0 ? "positive" : gainPct < 0 ? "negative" : "flat";
    sentences.push(`Overall the portfolio is ${direction} with total invested INR ${Math.round(invested).toLocaleString("en-IN")} vs current INR ${Math.round(value).toLocaleString("en-IN")} (${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(2)}%).`);
  }
  return sentences.join(" ");
}

/** The grey footnote under Observations, matching what data was actually used. */
export function sourceNote(snapshot) {
  const date = formatSnapshotDate(snapshot.asOf);
  const analytics = snapshot.trailingReturns || snapshot.risk
    ? `Trailing returns and risk ratios (Alpha, Beta, Std Dev, Sharpe) are computed from month-end NAV history${snapshot.benchmarkName ? `, benchmarked to the ${benchmarkPhrase(snapshot.benchmarkName)}` : " (the benchmark comparison is shown when funds with a verified benchmark hold at least 80% of the value)"}` +
      (snapshot.coverage ? `; fund coverage ${snapshot.coverage.covered}/${snapshot.coverage.total}` : "") +
      ". Market-cap and sector splits are modelled estimates. "
    : "Composition, sector, market-cap, return and risk figures are shown where sufficient fund data is available. ";
  return "Holdings, invested value, current value and AMC split are as per the Consolidated Account Statement. " + analytics +
    `Mutual fund investments are subject to market risks; read all scheme related documents carefully. Prepared via Prosperr Insights. Data as on ${date}.`;
}
