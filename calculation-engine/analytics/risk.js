/**
 * Risk metrics (MF_Calculation_Engine.md E12, R1–R4).
 *
 * Input:  monthly returns (ratios) and the annualised 3Y CAGR (E2) of the same series; optionally the
 *         benchmark's monthly returns and 3Y CAGR (same months). Rf from config RISK.riskFreeRate.
 * Output: riskMetrics({ monthly, cagr3y, benchmarkMonthly?, benchmarkCagr3y? }) →
 *           { stdDev, sharpe, sortino, beta, alpha, observations } (ratios; null when not computable)
 *         or null when there are fewer than RISK.minObservations monthly returns.
 *  - monthEnds(lastMonthEnd, count) → ["YYYY-MM-DD", …] the last calendar day of `count` months, oldest first
 *  - lastCompletedMonthEnd(anchorDate) → last calendar day of the month before the anchor's month
 *
 *  R1  σ_annual   = STDEV.S(monthly) × √12
 *  R2  Sharpe     = (CAGR3Y − Rf) / σ_annual
 *  R3  Sortino    = (CAGR3Y − Rf) / σ_d,  σ_d = √( mean( min(r_m − Rf_m, 0)² ) ) × √12,  Rf_m = (1 + Rf)^(1/12) − 1
 *  R4  Beta       = COVAR.S(fund, bench) / VAR.S(bench);  Alpha = CAGR3Y − [ Rf + Beta × (Bench CAGR3Y − Rf) ]
 */

import { RISK } from "../config.js";

export function lastCompletedMonthEnd(anchorDate) {
  const [y, m] = anchorDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
}

export function monthEnds(lastMonthEnd, count) {
  const [y, m] = lastMonthEnd.split("-").map(Number);
  const out = [];
  for (let k = count - 1; k >= 0; k--) {
    out.push(new Date(Date.UTC(y, m - k, 0)).toISOString().slice(0, 10));
  }
  return out;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Sample variance / covariance (n − 1), as Excel STDEV.S / COVARIANCE.S. */
function sampleCovariance(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  return xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / (xs.length - 1);
}

export function riskMetrics({ monthly, cagr3y, benchmarkMonthly = null, benchmarkCagr3y = null, riskFreeRate = RISK.riskFreeRate }) {
  if (!Array.isArray(monthly) || monthly.length < RISK.minObservations || monthly.some((r) => !Number.isFinite(r))) return null;
  const stdDev = Math.sqrt(sampleCovariance(monthly, monthly)) * Math.sqrt(12);
  const rfMonthly = (1 + riskFreeRate) ** (1 / 12) - 1;
  const downside = Math.sqrt(mean(monthly.map((r) => Math.min(r - rfMonthly, 0) ** 2))) * Math.sqrt(12);
  const excess = cagr3y === null || cagr3y === undefined ? null : cagr3y - riskFreeRate;

  let beta = null, alpha = null;
  if (Array.isArray(benchmarkMonthly) && benchmarkMonthly.length === monthly.length && benchmarkMonthly.every(Number.isFinite)) {
    const variance = sampleCovariance(benchmarkMonthly, benchmarkMonthly);
    beta = variance > 0 ? sampleCovariance(monthly, benchmarkMonthly) / variance : null;
    if (beta !== null && excess !== null && Number.isFinite(benchmarkCagr3y)) {
      alpha = cagr3y - (riskFreeRate + beta * (benchmarkCagr3y - riskFreeRate));
    }
  }
  return {
    stdDev,
    sharpe: excess === null || !(stdDev > 0) ? null : excess / stdDev,
    sortino: excess === null || !(downside > 0) ? null : excess / downside,
    beta,
    alpha,
    observations: monthly.length,
  };
}
