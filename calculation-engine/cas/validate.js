/**
 * Validation & integrity (MF_Calculation_Engine.md E15.3) — flag, never fix.
 *
 * Input:  a normalized portfolio.
 * Output: the same portfolio with `holding.flags`, `integrity.checks`,
 *         `integrity.warnings` and `integrity.status` filled in.
 *
 * Money reconciliation runs in integer paise from the PRINTED strings, so a
 * mismatch always means a misread or a missing row — never float drift.
 * The units × NAV tolerance is derived from the precision the statement itself
 * printed (e.g. NAV to 4 decimals, units to 3), plus a small configured slack.
 */

import { VALIDATION } from "../config.js";
import { isValidIsin } from "../identity/isin.js";
import { toPaise } from "./parse-values.js";

export const FLAG = Object.freeze({
  ISIN_INVALID: "ISIN_INVALID",
  MISSING_REQUIRED: "MISSING_REQUIRED",
  UNITS_NAV_VALUE_MISMATCH: "UNITS_NAV_VALUE_MISMATCH",
  NAV_WITHOUT_DATE: "NAV_WITHOUT_DATE",
  VALUE_WITHOUT_UNITS: "VALUE_WITHOUT_UNITS",
  UNIT_BALANCE_MISMATCH: "UNIT_BALANCE_MISMATCH",
  COST_MISMATCH: "COST_MISMATCH",
  GAIN_MISMATCH: "GAIN_MISMATCH",
});

export function validatePortfolio(portfolio) {
  const warnings = [...portfolio.integrity.warnings];
  for (const holding of portfolio.holdings) {
    holding.flags = rowFlags(holding);
    for (const flag of holding.flags) warnings.push(describeFlag(flag, holding));
  }

  const checks = [
    reconcileTotal(portfolio, "marketValue", "totalMarketValue", "TOTAL_MARKET_RECONCILES", "current value"),
    reconcileTotal(portfolio, "costValue", "totalCostValue", "TOTAL_COST_RECONCILES", "invested amount"),
    holdingCountSanity(portfolio),
    noDuplicateIsinFolio(portfolio),
  ];
  for (const check of checks) if (!check.passed) warnings.push(check.detail);

  // Per fund house: pinpoints WHERE a total does not add up (e.g. a fund that was not read).
  const amcCheck = reconcileByAmc(portfolio);
  if (amcCheck) {
    checks.push(amcCheck);
    warnings.push(...amcCheck.problems);
  }

  const anyRowFlag = portfolio.holdings.some((holding) => holding.flags.length > 0);
  portfolio.integrity = {
    status: anyRowFlag || checks.some((check) => !check.passed) ? "needs_review" : "ok",
    checks,
    warnings,
  };
  return portfolio;
}

function rowFlags(holding) {
  const flags = [];
  if (!holding.isin || !holding.schemeName) flags.push(FLAG.MISSING_REQUIRED);
  if (holding.isin && !isValidIsin(holding.isin)) flags.push(FLAG.ISIN_INVALID);
  if (holding.nav !== null && !holding.navDate) flags.push(FLAG.NAV_WITHOUT_DATE);
  if (holding.marketValue !== null && holding.units === null) flags.push(FLAG.VALUE_WITHOUT_UNITS);
  if (unitsNavValueMismatch(holding)) flags.push(FLAG.UNITS_NAV_VALUE_MISMATCH);
  if (unitBalanceMismatch(holding)) flags.push(FLAG.UNIT_BALANCE_MISMATCH);
  if (costMismatch(holding)) flags.push(FLAG.COST_MISMATCH);
  if (gainMismatch(holding)) flags.push(FLAG.GAIN_MISMATCH);
  return flags;
}

/** units × average cost per unit must match the printed total cost (when both are printed). */
function costMismatch(holding) {
  const { units, averageCost, costValue, raw } = holding;
  if (units === null || averageCost === null || costValue === null) return false;
  return Math.abs(units * averageCost - costValue) > productTolerance(units, raw.units, averageCost, raw.averageCost, raw.costValue);
}

/** market value − cost must match the printed profit/loss to the paisa (± configured tolerance). */
function gainMismatch(holding) {
  const { raw } = holding;
  const market = toPaise(raw.marketValue);
  const cost = toPaise(raw.costValue);
  const gain = toPaise(raw.printedGain);
  if (market === null || cost === null || gain === null) return false;
  return Math.abs(market - cost - gain) > VALIDATION.totalReconcileToleranceRupees * 100;
}

/** Rounding bound for a × b ≈ c given the decimals each value was printed with. */
function productTolerance(a, rawA, b, rawB, rawC) {
  return (
    Math.abs(a) * 0.5 * 10 ** -decimalsOf(rawB) +
    Math.abs(b) * 0.5 * 10 ** -decimalsOf(rawA) +
    0.5 * 10 ** -decimalsOf(rawC) +
    VALIDATION.rowValueSlackRupees
  );
}

function decimalsOf(raw) {
  const match = String(raw ?? "").match(/\.(\d+)/);
  return match ? match[1].length : 0;
}

/** |units × NAV − value| must stay within the rounding the statement printed. */
function unitsNavValueMismatch(holding) {
  const { units, nav, marketValue, raw } = holding;
  if (units === null || nav === null || marketValue === null) return false;
  return Math.abs(units * nav - marketValue) > productTolerance(units, raw.units, nav, raw.nav, raw.marketValue);
}

/**
 * Opening units + Σ transaction units must equal the printed closing units, and
 * the last printed running balance must equal it too.
 */
function unitBalanceMismatch(holding) {
  const { openingUnits, units, transactions } = holding;
  if (units === null || transactions.length === 0) return false;

  const lastBalance = [...transactions].reverse().find((txn) => txn.unitBalance !== null)?.unitBalance;
  if (lastBalance !== undefined && Math.abs(lastBalance - units) > VALIDATION.unitBalanceTolerance) return true;

  if (openingUnits === null) return false;
  const moved = transactions.reduce((sum, txn) => sum + (txn.units ?? 0), 0);
  return Math.abs(openingUnits + moved - units) > VALIDATION.unitBalanceTolerance;
}

/**
 * Σ printed holding values must equal the printed total. Holdings without a
 * value are left out of the sum: if one was printed but missed by the parser,
 * the printed total still includes it and the check fails — nothing hides.
 */
function reconcileTotal(portfolio, holdingKey, totalKey, name, label) {
  const values = portfolio.holdings.map((holding) => toPaise(holding.raw[holdingKey])).filter((paise) => paise !== null);
  // printedTotals[key] is exact to the paisa (single printed figure, or a sum of
  // printed sub-totals computed in paise), so rounding to paise is lossless.
  const printedValue = portfolio.printedTotals[totalKey];
  const printedPaise = printedValue === null ? null : Math.round(printedValue * 100);

  if (printedPaise === null) {
    return values.length === 0
      ? { name, passed: true, detail: `The statement does not print a ${label}, so there is nothing to reconcile.` }
      : { name, passed: false, detail: `The statement's printed total ${label} could not be found, so the ${label} could not be verified.` };
  }

  const sumPaise = values.reduce((sum, paise) => sum + paise, 0);
  const differencePaise = sumPaise - printedPaise;
  const passed = Math.abs(differencePaise) <= VALIDATION.totalReconcileToleranceRupees * 100;
  const notPrinted = portfolio.holdings.length - values.length;

  const detail = passed
    ? `Sum of holdings matches the printed total ${label} (${formatPaise(printedPaise)})` +
      (notPrinted ? `; ${notPrinted} holding(s) have no ${label} printed.` : ".")
    : `Total ${label}: the funds read add up to ${formatPaise(sumPaise)}, but the statement prints ${formatPaise(printedPaise)} — ${gapText(differencePaise)}.`;
  return { name, passed, detail };
}

/**
 * Σ funds read per fund house vs the statement's portfolio summary (CAMS/KFintech prints
 * one row per AMC). Returns null when the statement has no per-AMC summary.
 * problems: one plain-language message per fund house that does not add up.
 */
function reconcileByAmc(portfolio) {
  const summary = portfolio.printedTotals.byAmc ?? [];
  if (!summary.length) return null;
  const key = (name) => String(name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const tolerance = VALIDATION.totalReconcileToleranceRupees * 100;
  const problems = [];

  for (const entry of summary) {
    const printed = toPaise(entry.raw.marketValue);
    if (printed === null) continue;
    const funds = portfolio.holdings.filter((holding) => key(holding.amc) === key(entry.amc));
    const read = funds.reduce((sum, holding) => sum + (toPaise(holding.raw.marketValue) ?? 0), 0);
    if (Math.abs(read - printed) <= tolerance) continue;

    const printedCost = toPaise(entry.raw.costValue);
    const costText = printedCost === null ? "" : ` (cost ${formatPaise(printedCost)})`;
    const activeRead = funds.filter((holding) => holding.status === "active").length;
    problems.push(activeRead === 0
      ? `${entry.amc}: the statement's summary shows ${formatPaise(printed)}${costText}, but no fund from this fund house could be read — it is missing from the review.`
      : `${entry.amc}: the statement's summary shows ${formatPaise(printed)}${costText}, but the ${activeRead} fund(s) read add up to ${formatPaise(read)} (${gapText(read - printed)}) — a fund or an amount from this fund house was not read correctly.`);
  }
  return {
    name: "AMC_TOTALS_RECONCILE",
    passed: problems.length === 0,
    detail: problems.length ? problems.join(" ") : "Every fund house matches the statement's portfolio summary.",
    problems,
  };
}

function holdingCountSanity(portfolio) {
  const count = portfolio.holdings.length;
  const passed = count > 0 && count <= VALIDATION.maxPlausibleHoldings;
  return {
    name: "HOLDING_COUNT_SANITY",
    passed,
    detail: count === 0 ? "No holdings could be read from this statement." : passed ? `${count} holding(s) read.` : `${count} holdings read, which is implausibly high.`,
  };
}

function noDuplicateIsinFolio(portfolio) {
  const seen = new Set();
  const duplicates = [];
  for (const holding of portfolio.holdings) {
    const key = `${holding.isin}|${holding.folio ?? ""}`;
    if (seen.has(key)) duplicates.push(`${holding.schemeName ?? holding.isin} (folio ${holding.folio ?? "—"})`);
    seen.add(key);
  }
  return {
    name: "NO_DUPLICATE_ISIN_FOLIO",
    passed: duplicates.length === 0,
    detail: duplicates.length ? `Holding read more than once: ${duplicates.join(", ")}.` : "Every ISIN–folio pair is unique.",
  };
}

function describeFlag(flag, holding) {
  const name = holding.schemeName ?? holding.isin ?? "Unnamed holding";
  const messages = {
    [FLAG.MISSING_REQUIRED]: `${name}: ISIN or scheme name could not be read.`,
    [FLAG.ISIN_INVALID]: `${name}: ISIN ${holding.isin} fails the check-digit test.`,
    [FLAG.NAV_WITHOUT_DATE]: `${name}: NAV is printed without a NAV date.`,
    [FLAG.VALUE_WITHOUT_UNITS]: `${name}: a value is printed but no unit balance was found.`,
    [FLAG.UNITS_NAV_VALUE_MISMATCH]: `${name}: units × NAV does not match the printed market value.`,
    [FLAG.UNIT_BALANCE_MISMATCH]: `${name}: opening units plus transactions do not equal the closing unit balance.`,
    [FLAG.COST_MISMATCH]: `${name}: units × average cost does not match the printed total cost.`,
    [FLAG.GAIN_MISMATCH]: `${name}: current value minus cost does not match the printed profit/loss.`,
  };
  return messages[flag];
}

/** "₹9,80,342.23 short" or "₹1,000.00 more" for a read-minus-printed gap in paise. */
function gapText(differencePaise) {
  return differencePaise < 0 ? `${formatPaise(-differencePaise)} short` : `${formatPaise(differencePaise)} more`;
}

/** Engine-internal rupee text for messages only (display formatting lives in the app). */
function formatPaise(paise) {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100).toLocaleString("en-IN");
  return `${sign}₹${rupees}.${String(abs % 100).padStart(2, "0")}`;
}
