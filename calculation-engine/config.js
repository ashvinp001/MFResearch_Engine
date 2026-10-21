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
