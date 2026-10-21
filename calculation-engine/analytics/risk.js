/**
 * Risk metrics (MF_Calculation_Engine.md E15.6) — INTERFACE ONLY. Formulas are deferred.
 *
 * Input: portfolio and benchmark monthly returns; the risk-free rate is injected.
 * Output: null until specified, later { alpha, beta, stdDev, sharpe, benchStdDev, benchSharpe }.
 */

export function riskMetrics(portfolioMonthlyReturns, benchmarkMonthlyReturns, riskFreeRate) {
  return null;
}
