/**
 * Report profile — Diversification, Risk Profile and Investment Horizon of a portfolio.
 * These fill the "Report details" automatically; the advisor can still change them.
 * The rules below are the Prosperr logic EXACTLY as specified (see docs/report-profile-logic.md).
 *
 * Input:  a validated portfolio and fundData (Phase 2, may be null).
 * Output: buildReportProfile → {
 *   diversification: { status, numFunds, portfolioValue, range: { min, max }, largestFund: { name, sharePct } },
 *   risk:    { label | null, equityPct | null, unclassified: [fundName] },
 *   horizon: { label | null, years | null,     unclassified: [fundName] },
 *   funds:   [ { name, isin, value, category | null, source | null } ]
 * }
 *
 * Exactness: values are the printed CAS current values in integer paise; factors and years
 * are held as integers (×100) and bands are compared with BigInt arithmetic, so a portfolio
 * sitting exactly on a boundary (e.g. 80.00% equity) always lands in the right band.
 * Risk and Horizon need every fund's SEBI category: if any fund cannot be classified
 * (see fund-category.js) the label is null and those funds are listed — never guessed.
 * Funds: active holdings (zero closing units excluded); the same ISIN held in several
 * folios counts as ONE fund, with its values added together.
 */

import { toPaise } from "../cas/parse-values.js";
import { classifyFund, FUND_CATEGORY as C } from "./fund-category.js";

const LAKH = 100000n * 100n; // ₹1 lakh in paise
const CRORE = 100n * LAKH;

// ---------------------------------------------------------------------------
// 1. DIVERSIFICATION
// Ideal fund range by portfolio value:
//   < ₹5L → 2–4 | ₹5L–₹25L → 3–6 | ₹25L–₹1Cr → 4–8 | ₹1Cr–₹5Cr → 5–10 | > ₹5Cr → 6–13
// Band edges: each band includes its lower edge; ₹5Cr exactly is in "₹1Cr–₹5Cr" (the last band is "> ₹5Cr").
// Status (first match wins):
//   1 fund, OR any fund ≥ 50% of value → Concentrated
//   num_funds < range minimum         → Under Diversified
//   num_funds > range maximum         → Over Diversified
//   otherwise                         → Well Diversified
// ---------------------------------------------------------------------------
export const DIVERSIFICATION_STATUS = Object.freeze(["Concentrated", "Under Diversified", "Well Diversified", "Over Diversified"]);

function idealFundRange(valuePaise) {
  if (valuePaise < 5n * LAKH) return { min: 2, max: 4, band: "< ₹5L" };
  if (valuePaise < 25n * LAKH) return { min: 3, max: 6, band: "₹5L–₹25L" };
  if (valuePaise < 1n * CRORE) return { min: 4, max: 8, band: "₹25L–₹1Cr" };
  if (valuePaise <= 5n * CRORE) return { min: 5, max: 10, band: "₹1Cr–₹5Cr" };
  return { min: 6, max: 13, band: "> ₹5Cr" };
}

/**
 * Spec form: { numFunds, portfolioValue (₹), fundValues? (₹ list) } → { status, range }.
 * Without fundValues the "≥ 50%" test cannot run, so only the fund count decides.
 */
export function diversificationStatus({ numFunds, portfolioValue, fundValues = null }) {
  const totalPaise = BigInt(Math.round(portfolioValue * 100));
  const fundPaise = fundValues ? fundValues.map((value) => BigInt(Math.round(value * 100))) : null;
  return diversificationFromPaise(numFunds, totalPaise, fundPaise);
}

function diversificationFromPaise(numFunds, totalPaise, fundPaise) {
  const range = idealFundRange(totalPaise);
  // any fund ≥ 50%  ⇔  2 × fund ≥ total  (exact, integer paise)
  const dominant = totalPaise > 0n && (fundPaise ?? []).some((paise) => 2n * paise >= totalPaise);
  let status;
  if (numFunds === 1 || dominant) status = "Concentrated";
  else if (numFunds < range.min) status = "Under Diversified";
  else if (numFunds > range.max) status = "Over Diversified";
  else status = "Well Diversified";
  return { status, range };
}

// ---------------------------------------------------------------------------
// 2. RISK PROFILE = value-weighted equity exposure % of the portfolio.
// Step 1 — equity factor per holding (by SEBI category), held ×100:
//   Equity funds (large/mid/small/flexi/multi/ELSS/index …) 1.00 | Aggressive Hybrid 0.70
//   Balanced Hybrid / Balanced Advantage / Dynamic AA 0.50   | Multi-Asset 0.40
//   Equity Savings 0.30 | Conservative Hybrid 0.20 | Gold / Silver / Commodity 0.30
//   Arbitrage 0.00 | Debt / Liquid (all) 0.00
// Step 2 — equity% = Σ(value × factor) / Σ(value) × 100
// Step 3 — < 20 Conservative | 20–40 Moderately Conservative | 40–60 Moderate
//          | 60–80 Moderately Aggressive | ≥ 80 Aggressive   (each band includes its lower edge)
// ---------------------------------------------------------------------------
export const RISK_PROFILE_LABELS = Object.freeze(["Conservative", "Moderately Conservative", "Moderate", "Moderately Aggressive", "Aggressive"]);

const EQUITY_FACTOR_X100 = Object.freeze({
  [C.EQUITY]: 100, [C.MID_CAP]: 100, [C.SMALL_CAP]: 100,
  [C.AGGRESSIVE_HYBRID]: 70,
  [C.BALANCED_HYBRID]: 50, [C.BALANCED_ADVANTAGE]: 50,
  [C.MULTI_ASSET]: 40,
  [C.EQUITY_SAVINGS]: 30,
  [C.CONSERVATIVE_HYBRID]: 20,
  [C.GOLD_SILVER]: 30,
  [C.ARBITRAGE]: 0,
  [C.OVERNIGHT]: 0, [C.LIQUID]: 0, [C.ULTRA_SHORT]: 0, [C.LOW_DURATION]: 0, [C.MONEY_MARKET]: 0, [C.FLOATER]: 0,
  [C.SHORT_DURATION]: 0, [C.BANKING_PSU]: 0, [C.CORPORATE_BOND]: 0, [C.CREDIT_RISK]: 0, [C.DYNAMIC_BOND]: 0,
  [C.MEDIUM_TO_LONG]: 0, [C.MEDIUM_DURATION]: 0, [C.LONG_DURATION]: 0, [C.GILT]: 0,
});

const RISK_BANDS = [[80, "Aggressive"], [60, "Moderately Aggressive"], [40, "Moderate"], [20, "Moderately Conservative"], [0, "Conservative"]];

// ---------------------------------------------------------------------------
// 3. INVESTMENT HORIZON = value-weighted ideal holding period (years), held ×100:
//   Overnight, Liquid 0.25 | Ultra-Short, Low Duration, Money Market, Floater 0.75 | Arbitrage 0.75
//   Short Duration, Corporate Bond, Banking & PSU 2.0 | Conservative Hybrid, Equity Savings 2.5
//   Medium Duration, Credit Risk, Dynamic Bond 3.5 | Balanced Hybrid, Balanced Advantage, Multi-Asset, Gold 4.0
//   Gilt, Medium-to-Long Duration 4.5 | Aggressive Hybrid 5.0 | Long Duration 7.0
//   Equity (large/flexi/multi/ELSS/index/sectoral) 7.0 | Mid Cap 8.0 | Small Cap 10.0
// Step 2 — avg_years = Σ(value × years) / Σ(value)
// Step 3 — < 1 Short Term | 1–3 Mid Term | 3–5 Mid to Long Term | ≥ 5 Long Term (lower edge included)
// Interpretation notes: Silver is treated like Gold (4.0); Large & Mid Cap, Focused, Value, Contra
// and Dividend Yield funds use the general Equity row (7.0).
// ---------------------------------------------------------------------------
export const HORIZON_LABELS = Object.freeze(["Short Term", "Mid Term", "Mid to Long Term", "Long Term"]);

const YEARS_X100 = Object.freeze({
  [C.OVERNIGHT]: 25, [C.LIQUID]: 25,
  [C.ULTRA_SHORT]: 75, [C.LOW_DURATION]: 75, [C.MONEY_MARKET]: 75, [C.FLOATER]: 75,
  [C.ARBITRAGE]: 75,
  [C.SHORT_DURATION]: 200, [C.CORPORATE_BOND]: 200, [C.BANKING_PSU]: 200,
  [C.CONSERVATIVE_HYBRID]: 250, [C.EQUITY_SAVINGS]: 250,
  [C.MEDIUM_DURATION]: 350, [C.CREDIT_RISK]: 350, [C.DYNAMIC_BOND]: 350,
  [C.BALANCED_HYBRID]: 400, [C.BALANCED_ADVANTAGE]: 400, [C.MULTI_ASSET]: 400, [C.GOLD_SILVER]: 400,
  [C.GILT]: 450, [C.MEDIUM_TO_LONG]: 450,
  [C.AGGRESSIVE_HYBRID]: 500,
  [C.LONG_DURATION]: 700,
  [C.EQUITY]: 700,
  [C.MID_CAP]: 800,
  [C.SMALL_CAP]: 1000,
});

const HORIZON_BANDS = [[5, "Long Term"], [3, "Mid to Long Term"], [1, "Mid Term"], [0, "Short Term"]];

// ---------------------------------------------------------------------------

/**
 * Value-weighted average of an integer table over [{ paise, category }], banded.
 *   average (in band units) = Σ(paise × table) / (Σ paise × scale)
 *   Risk:    table = equity factor × 100  → the average IS the equity %   → scale 1
 *   Horizon: table = years × 100          → divide by 100 to get years    → scale 100
 * Band test (exact): average ≥ threshold ⇔ Σ(paise × table) ≥ threshold × scale × Σ paise.
 * bands: [[threshold, label], …] highest first. value: the average, 2 decimals, for display.
 */
function weightedBand(items, table, bands, scale) {
  const total = items.reduce((sum, item) => sum + item.paise, 0n);
  if (total === 0n) return { label: null, value: null };
  const weighted = items.reduce((sum, item) => sum + item.paise * BigInt(table[item.category]), 0n);
  const denominator = total * BigInt(scale);
  const label = bands.find(([threshold]) => weighted >= BigInt(threshold) * denominator)[1];
  const value = Number((weighted * 100n) / denominator) / 100;
  return { label, value };
}

export function buildReportProfile(portfolio, fundData = null) {
  const funds = new Map(); // one entry per fund (ISIN), values summed across folios
  for (const holding of portfolio.holdings) {
    if (holding.status !== "active") continue;
    const paise = toPaise(holding.raw.marketValue);
    if (paise === null) continue;
    const key = holding.isin ?? holding.schemeName;
    const fund = funds.get(key) ?? {
      name: holding.schemeName ?? holding.isin,
      isin: holding.isin,
      paise: 0n,
      ...(classifyFund(holding, fundData?.funds?.[holding.isin] ?? null) ?? { category: null, source: null }),
    };
    fund.paise += BigInt(paise);
    funds.set(key, fund);
  }

  const list = [...funds.values()];
  const totalPaise = list.reduce((sum, fund) => sum + fund.paise, 0n);
  const largest = list.reduce((top, fund) => (!top || fund.paise > top.paise ? fund : top), null);
  const diversification = {
    ...diversificationFromPaise(list.length, totalPaise, list.map((fund) => fund.paise)),
    numFunds: list.length,
    portfolioValue: Number(totalPaise) / 100,
    largestFund: largest && totalPaise > 0n
      ? { name: largest.name, sharePct: Number((largest.paise * 10000n) / totalPaise) / 100 }
      : null,
  };

  const unclassified = list.filter((fund) => !fund.category).map((fund) => fund.name);
  const complete = list.length > 0 && unclassified.length === 0;
  const riskResult = complete ? weightedBand(list, EQUITY_FACTOR_X100, RISK_BANDS, 1) : { label: null, value: null };
  const horizonResult = complete ? weightedBand(list, YEARS_X100, HORIZON_BANDS, 100) : { label: null, value: null };
  return {
    diversification,
    risk: { label: riskResult.label, equityPct: riskResult.value, unclassified },
    horizon: { label: horizonResult.label, years: horizonResult.value, unclassified },
    funds: list.map((fund) => ({ name: fund.name, isin: fund.isin, value: Number(fund.paise) / 100, category: fund.category, source: fund.source })),
  };
}
