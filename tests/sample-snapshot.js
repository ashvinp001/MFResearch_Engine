/**
 * Test data reproducing the "Sample Portfolio Review" factsheet, used ONLY to
 * compare our one-pager against the sample. The top-6 holdings and all totals
 * match the sample exactly (invested ₹5,72,050, current ₹5,70,982). The 7 smaller
 * funds are illustrative and sum to the sample's "Other holdings" row.
 * Fund-level analytics are the sample's printed figures (stand-in for Phase 2 data).
 */

import { createHolding, createPortfolio } from "../calculation-engine/model/portfolio.schema.js";

const FUNDS = [
  ["SBI Mutual Fund", "SBI Banking & Financial Services Fund Direct Plan Growth", "INF200K01T28", "1,00,000.00", "1,08,754.00"],
  ["PPFAS Mutual Fund", "Parag Parikh Flexi Cap Fund Direct Plan Growth", "INF879O01027", "1,24,000.00", "1,24,990.00"],
  ["SBI Mutual Fund", "SBI Healthcare Opportunities Fund Direct Growth", "INF200K01UM9", "1,00,000.00", "98,349.00"],
  ["HDFC Mutual Fund", "HDFC Gold ETF Fund of Fund Direct Plan Growth Option", "INF179K01VY8", "58,400.00", "56,972.00"],
  ["HDFC Mutual Fund", "HDFC Flexi Cap Fund Direct Plan Growth Option", "INF179K01VQ4", "50,000.00", "49,803.00"],
  ["ICICI Prudential Mutual Fund", "ICICI Prudential Large Cap Fund Direct Plan Growth", "INF109K016L0", "35,000.00", "35,171.00"],
  ["HDFC Mutual Fund", "HDFC Silver ETF Fund of Fund Direct Plan Growth", "INF179KC1EM3", "30,000.00", "22,200.00"],
  ["UTI Mutual Fund", "UTI Nifty 50 Index Fund Direct Growth", "INF789F01XA0", "25,000.00", "28,549.00"],
  ["Quant Mutual Fund", "Quant Small Cap Fund Direct Plan Growth", "INF966L01689", "18,000.00", "17,700.00"],
  ["ICICI Prudential Mutual Fund", "ICICI Prudential Technology Fund Direct Plan Growth", "INF109K01Z48", "15,000.00", "14,640.00"],
  ["SBI Mutual Fund", "SBI Contra Fund Direct Growth", "INF200K01RO8", "7,000.00", "5,800.00"],
  ["HDFC Mutual Fund", "HDFC Small Cap Fund Direct Growth", "INF179KA1RZ8", "7,000.00", "5,200.00"],
  ["ICICI Prudential Mutual Fund", "ICICI Prudential Gilt Fund Direct Plan Growth", "INF109K01Q49", "2,650.00", "2,854.00"],
];

export function samplePortfolio() {
  const portfolio = createPortfolio("CAMS_KFINTECH", "sample.pdf");
  portfolio.source.statementAsOf = "2026-02-05";
  portfolio.source.statementPeriod = { from: "2025-02-05", to: "2026-02-05" };
  portfolio.investor = { name: "SAMPLE CLIENT", title: null, pan: "ABCDE1234F", pans: ["ABCDE1234F"], email: null, address: null };
  for (const [amc, name, isin, cost, value] of FUNDS) {
    const holding = createHolding();
    Object.assign(holding, {
      amc, schemeName: name, isin, folio: "1234567", status: "active",
      costValue: Number(cost.replace(/,/g, "")), marketValue: Number(value.replace(/,/g, "")),
    });
    holding.raw.costValue = cost;
    holding.raw.marketValue = value;
    portfolio.holdings.push(holding);
  }
  portfolio.integrity = { status: "ok", checks: [], warnings: [] };
  return portfolio;
}

const NIFTY500 = [-6.25, 10.26, 8.64];

export const SAMPLE_FUND_DATA = {
  benchmarkName: "Nifty 50",
  composition: { equity: 85.6, debt: 0.5, goldSilver: 13.9 },
  sectors: [
    { sector: "Financial Services", pct: 22.0 },
    { sector: "Healthcare", pct: 18.0 },
    { sector: "Technology", pct: 12.0 },
    { sector: "Consumer Discretionary", pct: 10.0 },
    { sector: "Industrials", pct: 9.0 },
    { sector: "Commodities/Gold/Silver", pct: 14.0 },
    { sector: "International Equity", pct: 8.0 },
  ],
  marketCap: { large: 35.0, mid: 25.0, small: 40.0 },
  trailingReturns: [
    { period: "1Y", portfolio: 4.4, benchmark: -5.7 },
    { period: "3Y", portfolio: 19.3, benchmark: 10.5 },
    { period: "5Y", portfolio: 15.6, benchmark: 8.8 },
  ],
  risk: { alpha: 7.8, beta: 0.75, stdDev: 14.0, sharpe: 1.04, benchmark: { beta: 1.0, stdDev: 18.0, sharpe: 0.5 } },
  coverage: { covered: 11, total: 13 },
  xirr: -0.4,
  // Per-fund analytics as printed in "Portfolio Review & Recommendation" (stand-in for Phase 2 data).
  funds: {
    INF200K01T28: fund("equity", "Thematic Fund", "Nifty 500 TRI", [-4.54, 15.22, 11.05], NIFTY500, [70, 22, 8]),
    INF879O01027: fund("equity", "Flexi/Multi Cap", "Nifty 500 TRI", [-5.9, 12.25, 10.82], NIFTY500, [60, 28, 12]),
    INF200K01UM9: fund("equity", "Thematic Fund", "Nifty 500 TRI", [16.88, 24.45, 19.02], NIFTY500, [70, 22, 8]),
    INF179K01VY8: fund("goldSilver", "Gold", "Nifty 500 TRI", [21.03, 32.45, 23.91], NIFTY500, null),
    INF179K01VQ4: fund("equity", "Flexi/Multi Cap", "Nifty 500 TRI", [-4.32, 15.45, 15.33], NIFTY500, [60, 28, 12]),
    INF109K016L0: fund("equity", "Large Cap", "Nifty 100 TRI", [-5.72, 14.48, 13.48], [-9.48, 8.45, 6.72], [88, 9, 3]),
    INF179KC1EM3: fund("goldSilver", "Silver", "Nifty 500 TRI", [46.22, 42.87, null], NIFTY500, null),
    INF789F01XA0: fund("equity", "Index Fund", "Nifty 100 TRI", [-11.4, 6.79, 6.03], [-9.48, 8.45, 6.72], [88, 9, 3]),
    INF966L01689: fund("equity", "Small Cap", "Nifty Smallcap 250 TRI", [12.26, 18.78, 18.78], [3.59, 14.02, 13.73], [5, 20, 75]),
    INF109K01Z48: fund("equity", "Thematic Fund", "Nifty 500 TRI", [null, null, null], NIFTY500, [70, 22, 8]),
    INF200K01RO8: fund("equity", "Value/Contra", "Nifty 500 TRI", [null, null, null], NIFTY500, [60, 28, 12]),
    INF179KA1RZ8: fund("equity", "Small Cap", "Nifty Smallcap 250 TRI", [null, null, null], [3.59, 14.02, 13.73], [5, 20, 75]),
    INF109K01Q49: fund("debt", "Gilt", "CRISIL Dynamic Gilt Index", [null, null, null], [null, null, null], null),
  },
};

function fund(assetClass, category, benchmark, [r1y, r3y, r5y], [b1y, b3y, b5y], cap) {
  return {
    assetClass, category, benchmark,
    returns: { r1y, r3y, r5y },
    benchmarkReturns: { r1y: b1y, r3y: b3y, r5y: b5y },
    marketCap: cap ? { large: cap[0], mid: cap[1], small: cap[2] } : null,
  };
}

export const SAMPLE_SETTINGS = {
  riskProfile: "Moderately Aggressive",
  horizon: "Mid to Long Term",
  strategy: "A diversified allocation across 13 funds and 6 fund houses — equity for growth, debt for stability and a gold/silver hedge. Read from the uploaded CAS as on 05-Feb-2026.",
  observations: "Portfolio shows diversification across market caps with tilt towards small and mid caps (65% combined). Significant allocation to thematic funds (36% in Banking/Financial Services and Healthcare). Gold and Silver allocation at 14% provides commodity diversification. International equity exposure is minimal at 0.5%. Minor losses observed in Silver ETF FoF (-26%) and HDFC Gold FoF (-2.4%). Overall portfolio is slightly negative with total invested INR 572,050 vs current INR 570,981 (-0.19%). High concentration in equity (79%) suggests aggressive risk profile. Consider rebalancing precious metals allocation given current underperformance.",
};
