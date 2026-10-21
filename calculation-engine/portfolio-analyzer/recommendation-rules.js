/**
 * Rule-based Invest / Hold / Sell suggestions.
 *
 * Input:  { portfolio (validated), fundData (Phase 2, may be null), rules }
 *   rules: [ { id, verdict: "invest"|"hold"|"sell", reason, when: [ { metric, op, value } ] } ]
 *   Rules are checked top to bottom; the FIRST rule whose every condition holds wins.
 *   A rule with an empty `when` always matches (use it last, as a default).
 * Output: suggestVerdicts → { [holdingKey]: { verdict, ruleId, reason } } for active holdings
 *   that matched a rule. Unmatched holdings are left for the advisor to decide.
 *
 * A condition on a metric that is not available (null — e.g. returns before NAV data is
 * connected) is FALSE, so a rule never fires on a guessed value. Money comes from the
 * printed CAS strings in integer paise, like every other engine figure.
 */

import { toPaise } from "../cas/parse-values.js";
import { holdingKey } from "../model/portfolio.schema.js";

/** Metrics a condition can test, per fund. Percentages are in % (e.g. -12.5). */
export const RULE_METRICS = Object.freeze({
  absoluteReturnPct: "Gain on the amount invested, % (from the CAS)",
  gainAmount: "Gain on the amount invested, ₹ (from the CAS)",
  currentValue: "Current value, ₹ (from the CAS)",
  investedValue: "Amount invested, ₹ (from the CAS)",
  weightPct: "Share of the portfolio's current value, %",
  return1y: "1-year return, % (NAV data)",
  return3y: "3-year return, % p.a. (NAV data)",
  return5y: "5-year return, % p.a. (NAV data)",
  excess1y: "1-year return minus its benchmark, % (NAV data)",
  excess3y: "3-year return minus its benchmark, % (NAV data)",
  excess5y: "5-year return minus its benchmark, % (NAV data)",
  assetClass: 'Asset class: "equity" | "debt" | "goldSilver" (fund data)',
  category: 'Category, e.g. "Mid Cap" (fund data)',
});

export const RULE_OPERATORS = Object.freeze(["<", "<=", ">", ">=", "=", "!=", "in", "not in"]);
const VERDICTS = new Set(["invest", "hold", "sell"]);

/** Every metric for one holding; null where the data is not available. */
export function fundMetrics(holding, totalCurrentPaise, info = null) {
  const current = toPaise(holding.raw.marketValue);
  const invested = toPaise(holding.raw.costValue);
  const r = info?.returns ?? {};
  const b = info?.benchmarkReturns ?? {};
  const excess = (period) => (isNum(r[period]) && isNum(b[period]) ? r[period] - b[period] : null);
  return {
    currentValue: current === null ? null : current / 100,
    investedValue: invested === null ? null : invested / 100,
    gainAmount: current === null || invested === null ? null : (current - invested) / 100,
    absoluteReturnPct: current === null || !invested ? null : ((current - invested) / invested) * 100,
    weightPct: current === null || !totalCurrentPaise ? null : (current / totalCurrentPaise) * 100,
    return1y: isNum(r.r1y) ? r.r1y : null,
    return3y: isNum(r.r3y) ? r.r3y : null,
    return5y: isNum(r.r5y) ? r.r5y : null,
    excess1y: excess("r1y"),
    excess3y: excess("r3y"),
    excess5y: excess("r5y"),
    assetClass: info?.assetClass ?? null,
    category: info?.category ?? null,
  };
}

export function suggestVerdicts({ portfolio, fundData = null, rules = [] }) {
  const active = portfolio.holdings.filter((holding) => holding.status === "active");
  const totalCurrentPaise = active.reduce((sum, holding) => sum + (toPaise(holding.raw.marketValue) ?? 0), 0);
  const suggestions = {};
  if (!rules.length) return suggestions;

  for (const holding of active) {
    const metrics = fundMetrics(holding, totalCurrentPaise, fundData?.funds?.[holding.isin] ?? null);
    const rule = rules.find((candidate) => (candidate.when ?? []).every((condition) => holds(condition, metrics)));
    if (rule) suggestions[holdingKey(holding)] = { verdict: rule.verdict, ruleId: rule.id, reason: rule.reason };
  }
  return suggestions;
}

/** Problems in a rule set (unknown metric / operator / verdict); empty when valid. */
export function validateRules(rules) {
  const problems = [];
  rules.forEach((rule, i) => {
    const name = rule.id ?? `rule ${i + 1}`;
    if (!VERDICTS.has(rule.verdict)) problems.push(`${name}: verdict must be invest, hold or sell.`);
    for (const condition of rule.when ?? []) {
      if (!(condition.metric in RULE_METRICS)) problems.push(`${name}: unknown metric "${condition.metric}".`);
      if (!RULE_OPERATORS.includes(condition.op)) problems.push(`${name}: unknown operator "${condition.op}".`);
    }
  });
  return problems;
}

function holds({ metric, op, value }, metrics) {
  const actual = metrics[metric];
  if (actual === null || actual === undefined) return false; // missing data never satisfies a rule
  switch (op) {
    case "<": return actual < value;
    case "<=": return actual <= value;
    case ">": return actual > value;
    case ">=": return actual >= value;
    case "=": return actual === value;
    case "!=": return actual !== value;
    case "in": return Array.isArray(value) && value.includes(actual);
    case "not in": return Array.isArray(value) && !value.includes(actual);
    default: return false;
  }
}

function isNum(value) {
  return typeof value === "number" && Number.isFinite(value);
}
