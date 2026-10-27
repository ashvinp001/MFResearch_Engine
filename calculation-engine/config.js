/**
 * Calculation Engine configuration — every tunable lives here, never inline.
 *
 * Input: none. Output: frozen constant objects consumed by engine modules.
 * Change policy here; no other engine file should hold a magic number.
 */

export const EXTRACTION = Object.freeze({
  // Items whose baselines differ by less than (fontHeight × this) share a row.
  rowToleranceRatio: 0.5,
  // Adjacent items closer than (fontHeight × this) are merged into one cell.
  cellMergeGapRatio: 0.35,
  // Below this many text items in the whole file we treat it as a scanned PDF.
  minTextItemsForTextLayer: 20,
});

export const DETECTION = Object.freeze({
  // How many pages are scanned to decide the CAS format.
  pagesToScan: 3,
});

// MF_Calculation_Engine.md E1 — NAV lookup: step at most this many calendar days from the target date.
export const NAV_LOOKUP = Object.freeze({ maxStepDays: 10 });

// MF_Calculation_Engine.md E12 — risk analytics.
export const RISK = Object.freeze({
  riskFreeRate: 0.065,      // Rf p.a. (India 91-day T-Bill proxy); monthly = (1 + Rf)^(1/12) − 1
  windowMonths: 36,         // trailing 3 years of monthly returns
  minObservations: 30,      // fewer monthly returns → "—"
});

// MF_Calculation_Engine.md E15.5.9 — portfolio returns and risk from the funds' NAV history.
export const PORTFOLIO_ANALYTICS = Object.freeze({
  // A portfolio figure is shown only when the funds that have NAV data for that period hold at
  // least this share of the portfolio's current value; otherwise "—" (never a figure for a few funds).
  minValueCoverage: 0.8,
  trailingPeriods: Object.freeze([
    Object.freeze({ key: "1Y", period: Object.freeze({ months: 12 }) }),
    Object.freeze({ key: "3Y", period: Object.freeze({ years: 3 }) }),
    Object.freeze({ key: "5Y", period: Object.freeze({ years: 5 }) }),
  ]),
});

// Recommendation_Logic.md — automatic Invest / Hold / Sell pre-selection. Percent / percentage points.
export const RECOMMENDATION = Object.freeze({
  version: "1.4",
  highOverlapPct: 50,        // two active equity funds holding this share of the same stocks = largely the same exposure
  overlapMinMeasures: 4,     // the overlap comparison needs at least this many measures both funds have
  sectorLagPp: 2.0,          // a sector index this far a year behind NIFTY 500 on 3Y and 5Y (and behind on 1Y) = not performing
  sectorImplausiblePp: 40,   // a sector fund's own NAV this far from the market (pp a year) = a break in its history, not a result
  equityGapPp: 1.0,          // T: 3Y and 5Y both this far below the category median = persistent under-performance
  debtGapPp: 0.3,            // T for debt funds (spreads between debt funds are small)
  benchmarkGapPp: 1.0,       // B: 3Y and 5Y both this far behind the fund's own benchmark = clearly behind it
  passiveTrackingPp: 1.0,    // an index fund / ETF trailing its index by more than this a year (3Y) tracks poorly
  consistencyGood: 65,       // % of rolling 3Y windows at or above the category median
  consistencyWeak: 40,
  debtDrawdownSlackPp: 0.5,  // a debt fund's 3Y drawdown counts as deeper only beyond the median minus this
  creditGood: 80,            // % of debt + cash in AAA / A1+ / Sovereign / cash
  creditWeak: 60,
  creditUnknownMax: 10,      // more unrated (non-government) debt than this % → credit quality unknown
  creditEventDayPct: -1.0,   // a one-day fall worse than this in a short / medium debt fund → REVIEW
  investMaxWeightPct: 20,    // a STRONG fund already above this share of the portfolio → HOLD, not INVEST
  investMin1yExcessPp: -5.0, // a STRONG fund trailing its category's 1Y median by more than this (a sharp fall) → HOLD
  staleDays: 7,              // peer statistics older than this vs the fund's NAV date → REVIEW
  elssLockYears: 3,
  flags: Object.freeze({ amcPct: 40, thematicPct: 15, goldSilverPct: 15, overseasPct: 15 }),
  // Portfolio fit (v1.4): the ideal fund count is the Diversification range for the portfolio's value.
  fit: Object.freeze({
    smallShareOfAverage: 0.25, // small holding = below this × the average fund share at the ideal maximum (100 / max)
    passiveMaxFunds: 3,        // index funds / ETFs (not gold / silver) a portfolio needs at most…
    passiveMaxFundsSmall: 2,   // …or this many when its ideal maximum is ≤ smallPortfolioIdealMax funds
    smallPortfolioIdealMax: 6,
  }),
});

export const VALIDATION = Object.freeze({
  // Extra allowance (₹) added on top of the precision-derived rounding bound
  // when checking units × NAV ≈ market value for a single row.
  rowValueSlackRupees: 0.05,
  // Allowed absolute difference (₹) between Σ holdings and a printed total.
  totalReconcileToleranceRupees: 1,
  // Allowed absolute difference (units) between opening + Σ transactions and
  // the printed closing unit balance.
  unitBalanceTolerance: 0.002,
  // A statement with more holdings than this is suspicious (likely mis-split).
  maxPlausibleHoldings: 500,
});
