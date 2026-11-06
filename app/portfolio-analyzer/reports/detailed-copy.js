/**
 * Wording for the Detailed Report ("Portfolio Review & Recommendation").
 * Fixed text is copied verbatim from the sample report. Fund commentary uses the
 * sample's sentences when return data exists, and neutral wording until then —
 * no performance claim is ever made without the numbers behind it.
 */

import { benchmarkPhrase, formatDate, formatInr } from "../../shared/format.js";
import { indexCategoryLabel, isIndexFund } from "../../../calculation-engine/index.js";

export const GROUP_LABEL = { equity: "EQUITY", hybrid: "HYBRID", debt: "DEBT", goldSilver: "GOLD / SILVER", other: "OTHER" };
// Report details options = the exact labels of the Prosperr logic (calculation-engine/portfolio-analyzer/report-profile.js).
export {
  DIVERSIFICATION_STATUS as DIVERSIFICATION, RISK_PROFILE_LABELS as RISK_PROFILES, HORIZON_LABELS as HORIZONS,
} from "../../../calculation-engine/index.js";

export const WHAT_THESE_MEAN = [
  { title: "Alpha", text: "Return earned above what the benchmark would predict — positive means value added beyond the market.", tone: "green" },
  { title: "Beta", text: "Sensitivity to market moves. Below 1.0 is steadier than the benchmark; above 1.0 is more volatile.", tone: "navy" },
  { title: "Standard Deviation", text: "How much returns swing around their average — lower is a smoother ride.", tone: "blue" },
  { title: "Sharpe Ratio", text: "Return earned per unit of risk — higher is better.", tone: "green" },
];

/** Section 04 intro — names the benchmark actually used. */
export function returnsIntro(model) {
  const lead = "Portfolio returns across time frames, and three-year risk-adjusted performance — both measured against ";
  if (model.benchmarkBasis === "market") {
    return `${lead}the ${model.benchmarkName ?? "NIFTY 500"}, the broad Indian market (the funds' own benchmarks are verified for less than 80% of the portfolio's value).`;
  }
  if (model.benchmarkBasis === "funds") return `${lead}the portfolio's benchmark: each fund's own benchmark index, weighted by its current value.`;
  return `${lead}a benchmark once one is available for the portfolio.`;
}

/** Column / heading label for the portfolio benchmark: the index name when there is one, else "BENCHMARK". */
export function benchmarkColumn(name) {
  return !name || name === "Blended Benchmark" ? "BENCHMARK" : name.toUpperCase();
}
// AMFI category names too long for a narrow table column, in the short form advisors use.
const CATEGORY_SHORT = {
  "Balanced Advantage / Dynamic Asset Allocation": "Balanced Advantage",
  "10-year Constant Maturity Gilt Fund": "10Y Constant Maturity Gilt",
  "Ultra Short to Short Term Fund": "Ultra Short to Short Term",
};
/** Category label for a table cell (upper case): an index fund by the index it tracks ("INDEX FUND · NIFTY 50"),
 * else the short form of a long AMFI name, else the name itself. */
export function categoryLabel(category, { name = "", benchmark = null } = {}) {
  if (!category) return null;
  if (isIndexFund({ category })) return indexCategoryLabel({ category, name, benchmarkName: benchmark }).toUpperCase();
  return (CATEGORY_SHORT[category] ?? category).toUpperCase();
}
export const PERFORMANCE_NOTE ="Each fund's return is shown on the first line, with its category benchmark highlighted on the blue line below (1Y, 3Y, 5Y; 3Y & 5Y annualised). Debt funds and ETFs are not included in this table.";

// Client-facing wording when a figure cannot be shown for this portfolio: a plain statement of fact.
const NOT_AVAILABLE = {
  returns: "Trailing returns are not available for the current holdings.",
  risk: "Risk measures need three years of monthly returns and are not available for the current holdings.",
  allocation: "Asset allocation data is not available for the funds held.",
  sectors: "Sector allocation data is not available for the funds held.",
};
const pct1 = (v) => `${v.toFixed(1)}%`;
const signed1 = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Footnote shared by Section 04 and the Way Forward page. */
export function sourceNote(model, { amountsNote = false } = {}) {
  const date = model.asOf ? formatDate(model.asOf) : "";
  const lead = !amountsNote ? ""
    : (model.recommendedPlans?.length ?? 0) > 1 ? "Lumpsum amounts are the one-time amount × allocation; Monthly SIP amounts are the monthly SIP amount × allocation (invested every month). "
    : model.recommended?.mode === "sip" ? "Amounts are the monthly SIP amount × allocation (invested every month). "
    : "Amounts are the lumpsum (one-time) amount × allocation. ";
  if (!model.portfolioReturns && !model.risk) {
    return `${lead}Holdings, invested value and current value are as per the Consolidated Account Statement. Trailing returns, risk measures and allocation analysis are shown where sufficient fund data is available. Mutual fund investments are subject to market risks; read all scheme related documents carefully. Prepared via Prosperr Insights. Data as on ${date}.`;
  }
  const coverage = model.coverage ? ` (NAV history for ${model.coverage.covered} of ${model.coverage.total} funds)` : "";
  const bench = model.benchmarkName
    ? `, benchmarked to the ${benchmarkPhrase(model.benchmarkName)}; index prices from PulseDB`
    : "; the portfolio benchmark comparison, Alpha and Beta are shown only when funds with a verified benchmark hold at least 80% of the portfolio's value";
  return `${lead}Current values use the latest NAV; trailing returns and risk ratios (Std Dev, Sharpe — 3-year monthly) are computed from AMFI daily NAV history for the client's current holdings${coverage}${bench}. Mutual fund investments are subject to market risks; read all scheme related documents carefully. Prepared via Prosperr Insights. Data as on ${date}.`;
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

  const has = (v) => Number.isFinite(v);
  const r3 = model.portfolioReturns?.find((r) => r.period === "3Y");
  const r1 = model.portfolioReturns?.find((r) => r.period === "1Y");
  let returns = [NOT_AVAILABLE.returns];
  if (r3 && has(r3.portfolio) && has(r3.benchmark)) {
    returns = ["Compounding at ", { b: `${pct1(r3.portfolio)} p.a.` }, ` over 3Y vs ${pct1(r3.benchmark)} — `, { [r3.excess >= 0 ? "up" : "down"]: `${signed1(r3.excess)} ${r3.excess >= 0 ? "ahead" : "behind"}` }, "."];
  } else if (r3 && has(r3.portfolio)) {
    returns = ["Compounding at ", { b: `${pct1(r3.portfolio)} p.a.` }, " over 3Y", ...(r1 && has(r1.portfolio) ? [" and ", { [r1.portfolio >= 0 ? "up" : "down"]: signed1(r1.portfolio) }, " over 1Y"] : []), " on the current holdings."];
  } else if (r1 && has(r1.portfolio)) {
    returns = [{ [r1.portfolio >= 0 ? "up" : "down"]: signed1(r1.portfolio) }, " over the last year on the current holdings."];
  }

  const r = model.risk;
  let risk = [NOT_AVAILABLE.risk];
  if (r && has(r.beta) && has(r.alpha)) {
    risk = [{ b: r.beta < 1 ? "Lower risk" : "Higher risk" }, " than the market (beta ", { b: r.beta.toFixed(2) }, "), Sharpe ", { b: r.sharpe.toFixed(2) }, ", vol ", { b: pct1(r.stdDev) }, ", alpha ", { [r.alpha >= 0 ? "up" : "down"]: `${r.alpha >= 0 ? "+" : ""}${r.alpha.toFixed(2)}` }, "."];
  } else if (r && has(r.stdDev)) {
    risk = ["Volatility of ", { b: pct1(r.stdDev) }, " a year", ...(has(r.sharpe) ? [" with a Sharpe ratio of ", { b: r.sharpe.toFixed(2) }] : []), " over the last 3 years (monthly)."];
  }

  const c = model.composition;
  const m = model.marketCap;
  const allocation = c
    ? [{ b: `${Math.round(c.equity)}% equity / ${Math.round(c.debt)}% debt / ${Math.round(c.goldSilver)}% gold-silver` }, m ? `; equity is ${m.large >= Math.max(m.mid, m.small) ? "large-cap led" : "mid/small-cap led"} (${Math.round(m.large)}L / ${Math.round(m.mid)}M / ${Math.round(m.small)}S).` : "."]
    : [NOT_AVAILABLE.allocation];

  const sectors = model.sectors?.length
    ? [`Equity leans to ${model.sectors.slice(0, 3).map((s) => `${s.sector} ${Math.round(s.pct)}%`).join(", ")}, so returns track these themes closely.`]
    : [NOT_AVAILABLE.sectors];

  // Funds, not folios: the same fund in several folios with one recommendation counts once.
  const counts = { invest: 0, hold: 0, sell: 0 };
  const seen = new Set();
  for (const row of all) {
    const id = `${row.isin ?? row.name}|${row.verdict}`;
    if (row.verdict && !seen.has(id)) { seen.add(id); counts[row.verdict]++; }
  }
  const conclusion = counts.sell
    ? [`Add to ${plural(counts.invest, "fund")}, hold ${counts.hold} and sell ${counts.sell} (in full or in part). The priority is `, { b: "consolidating into the stronger holdings" }, " rather than adding new funds."]
    : [`Add to ${plural(counts.invest, "fund")} and hold ${counts.hold}. The portfolio is on track — no sales are recommended at this time.`];

  return [
    { key: "composition", title: "COMPOSITION", icon: "◆", tone: "navy", parts: composition },
    { key: "returns", title: "RETURNS", icon: "▲", tone: "green", parts: returns },
    { key: "risk", title: "RISK", icon: "●", tone: "blue", parts: risk },
    { key: "allocation", title: "ALLOCATION", icon: "▣", tone: "steel", parts: allocation },
    { key: "sectors", title: "SECTORS", icon: "✦", tone: "blue", parts: sectors },
    { key: "conclusion", title: "CONCLUSION", icon: "✓", tone: "green", parts: conclusion },
  ];
}

const benchName = (row) => row.benchmark ?? "its benchmark";
// AMFI's plural "Index Funds" reads as "index fund"; aClass adds the article ("an ELSS (Tax Saver)", "a Large Cap Fund").
const className = (row) => (/^index funds?$/i.test(row.category ?? "") ? "index fund" : row.category ?? "core");
const aClass = (row) => `${/^[aeiou]/i.test(className(row)) ? "an" : "a"} ${className(row)}`;
const IN_LINE_PP = 1;   // within ±1 pp over 1Y the fund is described as in line with its benchmark

/**
 * Section 05 / Way Forward commentary for one fund.
 * hasRecommended: false when the advisor skipped the recommended portfolio, so the
 * text never points to a Prosperr Recommended Portfolio that is not in the report.
 */
const formatRupees = (x) => `₹${Math.round(x).toLocaleString("en-IN")}`;

export function fundCommentary(row, verdict, { hasRecommended = true } = {}) {
  const r1 = row.returns?.r1y;
  const b1 = row.benchmarkReturns?.r1y;
  const hasData = typeof r1 === "number" && typeof b1 === "number";
  const edge = hasData ? r1 - b1 : null;
  const precious = row.assetClass === "goldSilver";
  const call = row.call ?? {};

  // The one-year comparison, stated as it is: ahead / in line / behind its own benchmark.
  const yearVs = () => (edge > IN_LINE_PP
    ? `ahead of ${benchName(row)} over the last year (${pct1(r1)} vs ${pct1(b1)}, ${signed1(edge)})`
    : edge < -IN_LINE_PP
      ? `behind ${benchName(row)} over the last year (${pct1(r1)} vs ${pct1(b1)}, ${signed1(edge)})`
      : `in line with ${benchName(row)} over the last year (${pct1(r1)} vs ${pct1(b1)})`);
  const lead = hasData ? `${row.name} is ${yearVs()}; ` : `${row.name}: `;
  if (verdict === "invest") {
    if (hasData && edge > IN_LINE_PP) {
      return `${row.name} has outperformed ${benchName(row)} over the last year (${pct1(r1)} vs ${pct1(b1)}, ${signed1(edge)}). Supported by a consistent longer-term record, it remains a high-conviction ${className(row)} holding and is our preferred destination for fresh investment.`;
    }
    return hasData
      ? `${lead}its longer-term record makes it ${aClass(row)} holding to build on, and it is suitable for fresh investment.`
      : `${row.name} is recommended for fresh investment on the strength of its record against its category and benchmark.`;
  }
  if (verdict === "hold") {
    if (precious) {
      return `${row.name} continues to serve its purpose as a gold / silver allocation${typeof r1 === "number" ? ` (1Y ${pct1(r1)})` : ""}, adding stability and diversification; an equity index is not its benchmark. We recommend holding the current position.`;
    }
    // v2.3: a small fund whose rating is pending, held on its last year.
    if (call.ruleId === "young-1y-in-line") {
      return `${lead}with less than three years of record its rating is still pending, but over the last year it is in line with or ahead of its peers, so we recommend holding the current position, with fresh investment directed to the funds marked Invest.`;
    }
    if (call.ruleId === "young-new-in-line") {
      return `${row.name} was launched less than a year ago and has done well since launch, so we recommend holding the current position while its record builds, with fresh investment directed to the funds marked Invest.`;
    }
    return hasData
      ? `${lead}we recommend holding the current position, with fresh investment directed to the funds marked Invest.`
      : `We recommend holding ${row.name} at its current position, with fresh investment directed to the funds marked Invest.`;
  }
  if (verdict === "sell") {
    // Each claim only when it is the actual basis of the call: a portfolio-fit exit is about consolidation, and
    // "trails its peers" is said only of a fund the logic graded weak on its longer-term record.
    const fallback = hasRecommended ? "the Prosperr Recommended Portfolio" : "the funds marked Invest";
    // A specific fund (or funds, each with its share of the money) the logic chose; the Recommended Portfolio is named
    // only when it is part of this report.
    const chosen = call.move && !/^the /.test(call.move) ? call.move : null;
    const named = chosen && !hasRecommended ? chosen.replace(/the Prosperr Recommended Portfolio/g, "the funds marked Invest") : chosen;
    const redeploy = named ?? fallback;
    const oneFund = named && !(call.moveSplit?.length > 1) ? named : null;
    if (call.ruleId === "fit-small") {
      // v2.2: a clean-up, not a view on the fund — the record is stated, then why it goes.
      const good = call.grade === "STRONG" ? " The fund itself has a good record; this is only to tidy and consolidate the portfolio, not a view on the fund." : "";
      const size = typeof call.fundWeightPct === "number" ? ` at ${call.fundWeightPct.toFixed(1)}% of the portfolio` : "";
      return `${lead}${hasData ? "however, " : ""}${size ? `${size.trim()} it` : "it"} is too small a holding to make a difference to the portfolio's results.${good} We recommend exiting it and consolidating the proceeds into ${redeploy}.`;
    }
    if (call.trim) {
      return `${lead}it stays in the portfolio, but we recommend reducing it from ${call.trim.fromPct.toFixed(1)}% to ${call.trim.toPct.toFixed(1)}% of the portfolio (see the Suggestion Box), releasing about ${formatRupees(call.trim.amount)} for ${redeploy}.`;
    }
    if (call.stage === "portfolio") {
      return `${lead}we recommend exiting it to consolidate the portfolio into fewer, stronger funds (see the Suggestion Box) and redeploying the proceeds into ${redeploy}.`;
    }
    if (call.ruleId === "overlap-weaker" || call.ruleId === "weakest-in-category") {
      return `${lead}it largely duplicates ${oneFund ?? "a stronger fund held in the portfolio"}${call.ruleId === "overlap-weaker" ? ", holding many of the same stocks" : " in the same category"}, which has the better record. We recommend consolidating into ${redeploy}.`;
    }
    if (call.ruleId === "young-1y-behind") {
      return `${lead}with less than three years of record its rating is still pending, and over the last year it is behind its peers. We recommend exiting and redeploying the proceeds into ${redeploy}.`;
    }
    if (call.ruleId === "young-new-behind") {
      return `${row.name} was launched less than a year ago and has not yet delivered the return we look for since launch. We recommend exiting and redeploying the proceeds into ${redeploy}.`;
    }
    if (call.ruleId === "young-1y-no-recovery") {
      return `${lead}with less than three years of record, it ranks in the bottom quarter of its category over the past year and has not recovered over the last three to six months. We recommend exiting and redeploying the proceeds into ${redeploy}.`;
    }
    if (hasData && edge >= 0 && call.grade !== "WEAK") {
      return `${row.name} is ${yearVs()}. We recommend exiting it and redeploying the proceeds into ${redeploy}.`;
    }
    if (hasData && edge >= 0) {
      return `${row.name} returned ${pct1(r1)} over the last year (vs ${pct1(b1)} for ${benchName(row)}), but its longer-term record trails its peers on a consistent basis, and we see better risk-adjusted opportunities in the same ${className(row)} space. We recommend exiting and redeploying the proceeds into ${redeploy}.`;
    }
    return hasData
      ? `${row.name} has lagged ${benchName(row)} over the last year (${pct1(r1)} vs ${pct1(b1)})${call.grade === "WEAK" ? " and trails its peers over the longer term" : ""}. We recommend exiting and redeploying the proceeds into ${redeploy}.`
      : `We recommend exiting ${row.name} and redeploying the proceeds into ${hasRecommended ? "the Prosperr Recommended Portfolio" : "higher-conviction funds"}.`;
  }
  return `${row.name} — recommendation not set.`;
}
