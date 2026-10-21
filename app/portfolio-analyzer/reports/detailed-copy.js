/**
 * Wording for the Detailed Report ("Portfolio Review & Recommendation").
 * Fixed text is copied verbatim from the sample report. Fund commentary uses the
 * sample's sentences when return data exists, and neutral wording until then —
 * no performance claim is ever made without the numbers behind it.
 */

import { formatInr } from "../../shared/format.js";

export const GROUP_LABEL = { equity: "EQUITY", debt: "DEBT", goldSilver: "GOLD / SILVER" };
// Report details options = the exact labels of the Prosperr logic (calculation-engine/portfolio-analyzer/report-profile.js).
export {
  DIVERSIFICATION_STATUS as DIVERSIFICATION, RISK_PROFILE_LABELS as RISK_PROFILES, HORIZON_LABELS as HORIZONS,
} from "../../../calculation-engine/index.js";

export const WHAT_THESE_MEAN = [
  { title: "Alpha", text: "Return earned above what the benchmark would predict — positive means value added beyond the market.", tone: "green" },
  { title: "Beta", text: "Sensitivity to market moves. Below 1.0 is steadier than the Nifty 500; above 1.0 is more volatile.", tone: "navy" },
  { title: "Standard Deviation", text: "How much returns swing around their average — lower is a smoother ride.", tone: "blue" },
  { title: "Sharpe Ratio", text: "Return earned per unit of risk — higher is better.", tone: "green" },
];

export const RETURNS_INTRO = "Portfolio returns across time frames, and three-year risk-adjusted performance — both measured against the Nifty 500.";
export const PERFORMANCE_NOTE = "Each fund's return is shown on the first line, with its category benchmark highlighted on the blue line below (1Y, 3Y, 5Y; 3Y & 5Y annualised). Debt holdings are excluded as an equity index is not their benchmark.";

const PENDING = "Available once fund and NAV data is connected.";
const pct1 = (v) => `${v.toFixed(1)}%`;
const signed1 = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Footnote shared by Section 04 and the Way Forward page. */
export function sourceNote(model, { amountsNote = false } = {}) {
  const date = model.asOf ?? "";
  const lead = amountsNote ? "Amounts are Investment Amount × allocation. " : "";
  if (!model.portfolioReturns && !model.risk) {
    return `${lead}Holdings, invested value and current value are read from the uploaded CAS. Trailing returns, risk ratios, market-cap and sector splits will appear once fund and NAV data is connected. Mutual fund investments are subject to market risks; read all scheme related documents carefully. Prepared via Prosperr Insights. Data as on ${date}.`;
  }
  const coverage = model.coverage ? `; fund coverage ${model.coverage.covered}/${model.coverage.total}` : "";
  return `${lead}Trailing returns and risk ratios (Alpha, Beta, Std Dev, Sharpe) are computed from month-end NAV history (AMFI via mfapi.in), benchmarked to the ${model.benchmarkName ?? "Nifty 500"}${coverage}. Market-cap and sector splits are modelled estimates. Mutual fund investments are subject to market risks; read all scheme related documents carefully. Prepared via Prosperr Insights. Data as on ${date}.`;
}

/** The six "At a glance" observation cards. Each returns rich parts: strings or { b: text } / { up|down: text }. */
export function observations(model) {
  const all = model.holdings.groups.flatMap((group) => group.rows);
  const withGain = all.filter((row) => row.invested).map((row) => ({ ...row, gainPct: (row.profit / row.invested) * 100 }));
  const best = [...withGain].sort((p, q) => q.gainPct - p.gainPct)[0];
  const worst = [...withGain].sort((p, q) => p.gainPct - q.gainPct)[0];
  const { totals } = model;

  const composition = [
    "Holds ", { b: plural(model.fundCount, "fund") }, " across ", { b: plural(model.amcCount, "AMC") }, " worth ", { b: formatInr(totals.value, { whole: true }) },
  ];
  if (totals.gain !== null) {
    const tone = totals.gain >= 0 ? "up" : "down";
    composition.push(", ", totals.gain >= 0 ? "up " : "down ", { [tone]: `${totals.gain >= 0 ? "+" : "−"}${formatInr(Math.abs(totals.gain), { whole: true }).replace("₹", "")} (${signed1(totals.gainPct)})` }, ".");
  } else composition.push(".");
  if (best && worst && best !== worst) {
    composition.push(" ", { b: best.name }, ` leads (${signed1(best.gainPct)} on cost), while `, { b: worst.name }, ` lags (${signed1(worst.gainPct)}).`);
  }

  const r3 = model.portfolioReturns?.find((r) => r.period === "3Y");
  const returns = r3
    ? ["Compounding at ", { b: `${pct1(r3.portfolio)} p.a.` }, ` over 3Y vs ${pct1(r3.benchmark)} — `, { [r3.excess >= 0 ? "up" : "down"]: `${signed1(r3.excess)} ${r3.excess >= 0 ? "ahead" : "behind"}` }, "."]
    : [PENDING];

  const r = model.risk;
  const risk = r
    ? [{ b: r.beta < 1 ? "Lower risk" : "Higher risk" }, " than the market (beta ", { b: r.beta.toFixed(2) }, "), Sharpe ", { b: r.sharpe.toFixed(2) }, ", vol ", { b: pct1(r.stdDev) }, ", alpha ", { [r.alpha >= 0 ? "up" : "down"]: `${r.alpha >= 0 ? "+" : ""}${r.alpha.toFixed(2)}` }, "."]
    : [PENDING];

  const c = model.composition;
  const m = model.marketCap;
  const allocation = c
    ? [{ b: `${Math.round(c.equity)}% equity / ${Math.round(c.debt)}% debt / ${Math.round(c.goldSilver)}% gold-silver` }, m ? `; equity is ${m.large >= Math.max(m.mid, m.small) ? "large-cap led" : "mid/small-cap led"} (${Math.round(m.large)}L / ${Math.round(m.mid)}M / ${Math.round(m.small)}S).` : "."]
    : [PENDING];

  const sectors = model.sectors?.length
    ? [`Equity leans to ${model.sectors.slice(0, 3).map((s) => `${s.sector} ${Math.round(s.pct)}%`).join(", ")}, so returns track these themes closely.`]
    : [PENDING];

  const counts = { invest: 0, hold: 0, sell: 0 };
  for (const row of all) if (row.verdict) counts[row.verdict]++;
  const conclusion = counts.sell
    ? [`Add to ${plural(counts.invest, "fund")}, hold ${counts.hold} and exit ${counts.sell}. The main lever now is `, { b: "pruning underperformers" }, ", not adding funds."]
    : [`Add to ${plural(counts.invest, "fund")} and hold ${counts.hold}. The portfolio is on track — no exits are recommended at this time.`];

  return [
    { key: "composition", title: "COMPOSITION", icon: "◆", tone: "navy", parts: composition },
    { key: "returns", title: "RETURNS", icon: "▲", tone: "green", parts: returns },
    { key: "risk", title: "RISK", icon: "●", tone: "blue", parts: risk },
    { key: "allocation", title: "ALLOCATION", icon: "▣", tone: "steel", parts: allocation },
    { key: "sectors", title: "SECTORS", icon: "✦", tone: "blue", parts: sectors },
    { key: "conclusion", title: "CONCLUSION", icon: "✓", tone: "green", parts: conclusion },
  ];
}

const benchName = (row) => row.benchmark ?? "the Nifty 500";
const className = (row) => row.category ?? "core";

/**
 * Section 05 / Way Forward commentary for one fund.
 * hasRecommended: false when the advisor skipped the recommended portfolio, so the
 * text never points to a Prosperr Recommended Portfolio that is not in the report.
 */
export function fundCommentary(row, verdict, { hasRecommended = true } = {}) {
  const r1 = row.returns?.r1y;
  const b1 = row.benchmarkReturns?.r1y;
  const hasData = typeof r1 === "number" && typeof b1 === "number";
  const edge = hasData ? r1 - b1 : null;
  const precious = row.assetClass === "goldSilver";

  if (verdict === "invest") {
    return hasData
      ? `${row.name} has been a standout — up ${pct1(r1)} over the last year versus ${pct1(b1)} for ${benchName(row)} (an edge of ${signed1(edge)}). A high-conviction ${className(row)} holding; consider adding to it and letting it take a larger share of your equity allocation.`
      : `${row.name} is recommended for fresh investment — consider adding to it and letting it take a larger share of your allocation.`;
  }
  if (verdict === "hold") {
    if (precious) {
      return `${row.name} is doing its job as a gold/silver holding${typeof r1 === "number" ? ` (1Y ${pct1(r1)})` : ""}, adding stability and diversification to the portfolio. Maintain the current allocation and continue your existing investments — an equity index is not its benchmark.`;
    }
    return hasData
      ? `${row.name} is performing in line with the market (${pct1(r1)} vs ${pct1(b1)} benchmark). It remains a solid ${className(row)} holding — maintain the current allocation and continue your existing investments.`
      : `${row.name} remains a solid holding — maintain the current allocation and continue your existing investments.`;
  }
  if (verdict === "sell") {
    if (hasData && edge >= 0) {
      return `${row.name} is up ${pct1(r1)} (ahead of ${pct1(b1)} for ${benchName(row)}), but we are flagging it for exit — near-term momentum is fading and we see better risk-adjusted opportunities in the same ${className(row)} space. Consider booking the gain and redeploying into a higher-conviction performer.`;
    }
    return hasData
      ? `${row.name} has underperformed — ${pct1(r1)} over the last year versus ${pct1(b1)} for ${benchName(row)}. Consider exiting and redeploying into a stronger performer.`
      : `${row.name} is flagged for exit — consider redeeming and redeploying the proceeds into ${hasRecommended ? "the Prosperr Recommended Portfolio" : "higher-conviction funds"}.`;
  }
  return `${row.name} — recommendation not set.`;
}

/** "1Y 18.9% (+25.2% vs Nifty 500)" or "1Y —". */
export function oneYearTag(row) {
  const r1 = row.returns?.r1y;
  const b1 = row.benchmarkReturns?.r1y;
  if (typeof r1 !== "number") return { text: "1Y —", tone: "" };
  if (typeof b1 !== "number") return { text: `1Y ${pct1(r1)}`, tone: r1 >= 0 ? "up" : "down" };
  const edge = r1 - b1;
  return { text: `1Y ${pct1(r1)} (${signed1(edge)} vs ${row.benchmark ?? "Nifty 500"})`, tone: edge >= 0 ? "up" : "down" };
}
