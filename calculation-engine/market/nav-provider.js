/**
 * NAV provider (MF_Calculation_Engine.md E15.6) — the ONLY module that knows where raw NAV lives.
 *
 * Backed by a dedicated Supabase store (compressed Parquet), read through a
 * server endpoint so no database credentials ever ship inside the shared HTML.
 * Input: a scheme key (from scheme-map.js) and a date range.
 * Output: [{ date: "YYYY-MM-DD", nav: Number }] sorted ascending.
 *
 * IMPLEMENTATION DEFERRED — connection and query details provided in Phase 2.
 * Keep these signatures stable so callers never change.
 */

export async function getNavHistory(schemeKey, { from, to }) {
  // TODO (Phase 2): read the NAV series for this scheme and date range.
  throw new Error("NAV provider is not implemented yet (Phase 2).");
}

export async function getLatestNav(schemeKey) {
  // TODO (Phase 2): return { date, nav } for the most recent NAV.
  throw new Error("NAV provider is not implemented yet (Phase 2).");
}
