/**
 * Returns (MF_Calculation_Engine.md E15.6) — INTERFACE ONLY. Formulas are deferred; do not assume.
 *
 * Input: a NAV series [{date, nav}] or cash flows [{date, amount}].
 * Output: null until the method is specified; the UI renders null as "—".
 *  - trailingReturns(navSeries) → { r3m, r6m, r1y, r3y, r5y } | null
 *  - xirr(cashflows) → annualised rate | null
 */

export function trailingReturns(navSeries) {
  return null;
}

export function xirr(cashflows) {
  return null;
}
