/**
 * Shared wording used by the dashboard, workflow steps and the report, so every
 * view says exactly the same thing about the same data.
 */

import { formatInr, titleCase } from "../shared/format.js";

export const FORMAT_LABEL = {
  CAMS_KFINTECH: "CAMS / KFintech statement",
  NSDL: "NSDL statement",
  CDSL: "CDSL statement",
};

export const FLAG_LABEL = {
  ISIN_INVALID: "ISIN looks incorrect",
  MISSING_REQUIRED: "Fund name or ISIN missing",
  UNITS_NAV_VALUE_MISMATCH: "Value ≠ units × NAV",
  NAV_WITHOUT_DATE: "NAV date missing",
  VALUE_WITHOUT_UNITS: "Units missing",
  UNIT_BALANCE_MISMATCH: "Units don't add up",
  COST_MISMATCH: "Cost ≠ units × average cost",
  GAIN_MISMATCH: "Gain differs from statement",
};

export const VERDICT_LABEL = { invest: "Invest", hold: "Hold", sell: "Sell" };

/** "Ms." + "PRIYA KAPOOR" → "Ms. Priya Kapoor". */
export function clientDisplayName(salutation, name) {
  return [salutation, titleCase(name) ?? "Client"].filter(Boolean).join(" ");
}

/** Client-friendly copy per engine check. When a check fails, the engine's precise detail is shown instead. */
const CHECK_COPY = {
  TOTAL_MARKET_RECONCILES: {
    title: "Current value matches the statement",
    ok: (p) => p.printedTotals.totalMarketValue === null
      ? "The statement doesn't print a total value to compare against."
      : `The funds add up to ${formatInr(p.printedTotals.totalMarketValue)}, exactly the total printed on the statement.`,
  },
  TOTAL_COST_RECONCILES: {
    title: "Invested amount matches the statement",
    ok: (p) => p.printedTotals.totalCostValue === null
      ? "The statement doesn't print a total invested amount to compare against."
      : `The invested amounts add up to ${formatInr(p.printedTotals.totalCostValue)}, exactly as printed on the statement.`,
  },
  HOLDING_COUNT_SANITY: {
    title: "All funds were found",
    ok: (p) => {
      const redeemed = p.holdings.filter((holding) => holding.status === "redeemed").length;
      const note = redeemed ? ` (including ${redeemed} fully redeemed)` : "";
      return `All ${p.holdings.length} fund${p.holdings.length > 1 ? "s" : ""} listed in the statement${note} were captured.`;
    },
  },
  NO_DUPLICATE_ISIN_FOLIO: {
    title: "No fund is counted twice",
    ok: () => "Each fund and folio is counted only once in the totals.",
  },
  AMC_TOTALS_RECONCILE: {
    title: "Every fund house matches the statement",
    ok: (p) => `Each of the ${p.printedTotals.byAmc.length} fund houses in the statement's portfolio summary matches the funds read.`,
  },
};

/**
 * The statement's problems in plain words, most specific first: the fund house that does not
 * add up (names the AMC and the amount), then fund-level flags, then the overall totals.
 * Used by the after-upload popup and the dashboard notice, so both say the same thing.
 */
export function statementProblems(portfolio) {
  const amcProblems = portfolio.integrity.checks.find((check) => check.name === "AMC_TOTALS_RECONCILE")?.problems ?? [];
  const rest = portfolio.integrity.warnings.filter((warning) => !amcProblems.includes(warning));
  return [...amcProblems, ...rest];
}

/** The verification items shown on the dashboard and in the report. */
export function verificationItems(portfolio) {
  const flagged = portfolio.holdings.filter((holding) => holding.flags.length > 0).length;
  return [
    ...portfolio.integrity.checks.map((check) => {
      const copy = CHECK_COPY[check.name];
      return { title: copy?.title ?? check.name, passed: check.passed, detail: check.passed && copy ? copy.ok(portfolio) : check.detail };
    }),
    {
      title: "Every fund double-checked",
      passed: flagged === 0,
      detail: flagged === 0
        ? "For each fund, units × NAV matches the current value, and units add up across transactions."
        : `${flagged} fund(s) have values that don't add up and are marked for review.`,
    },
  ];
}
