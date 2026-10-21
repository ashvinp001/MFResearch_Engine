/**
 * ISIN → market-data scheme key (MF_Calculation_Engine.md E15.4) — INTERFACE (Phase 2).
 *
 * Input: an ISIN. Output: the scheme key the NAV store understands, or null
 * (null = unmatched; callers surface it as a warning, never guess by name).
 * The map will be built from the AMFI NAV master (ISIN ↔ scheme code), cached
 * and refreshed daily through a server endpoint (the browser cannot fetch AMFI
 * directly because of CORS).
 */

const schemeKeyByIsin = new Map();

export async function loadSchemeMap() {
  // TODO (Phase 2): fetch the ISIN ↔ scheme-code reference and fill the map.
  throw new Error("Scheme map is not implemented yet (Phase 2).");
}

export function getSchemeIdByIsin(isin) {
  return schemeKeyByIsin.get(isin) ?? null;
}
