/**
 * Normalization — shapes parser output into the final contract (MF_Calculation_Engine.md E15.1).
 *
 * Input:  a parser's NormalizedPortfolio draft.
 * Output: the same portfolio with whitespace trimmed, holding status derived
 *         from the printed closing units and value (isNotHeld), investor PANs collected, and any
 *         title printed before the investor name split into `investor.title`.
 * No arithmetic on printed values and no reordering: rows stay in printed order.
 * The title is taken ONLY when the statement prints one — never inferred.
 */

/** A printed honorific at the start of the name: "MR", "Mrs.", "SMT", "Kumari"… */
const PRINTED_TITLE_RE = /^(MRS|MR|MS|MISS|DR|SHRI|SMT|KUMARI|KUM)\.?\s+(?=\S)/i;

export function normalizePortfolio(portfolio) {
  for (const holding of portfolio.holdings) {
    holding.schemeName = tidy(holding.schemeName);
    holding.amc = tidy(holding.amc);
    holding.folio = tidy(holding.folio);
    holding.status = isNotHeld(holding) ? "redeemed" : "active";
  }

  const pans = [portfolio.investor.pan, ...portfolio.holdings.map((holding) => holding.pan)].filter(Boolean);
  portfolio.investor.pans = [...new Set(pans)];
  portfolio.investor.pan = portfolio.investor.pan ?? portfolio.investor.pans[0] ?? null;
  portfolio.investor.name = tidy(portfolio.investor.name);
  const title = portfolio.investor.name?.match(PRINTED_TITLE_RE);
  portfolio.investor.title = title ? title[1].toUpperCase() : null;
  if (title) portfolio.investor.name = portfolio.investor.name.slice(title[0].length);

  return portfolio;
}

/** Below this many units a balance is a leftover fraction, not a holding (owner's rule: 0-unit funds stay out of reports). */
const DUST_UNITS = 0.001;

/**
 * A fund the client no longer holds (owner's rule — never in any report, overlap or recommendation): closing units
 * printed as 0, a leftover below DUST_UNITS, or a value printed as 0 with no meaningful units. A fund whose units and
 * value were both not read is NOT treated as redeemed — it stays in and validation flags it.
 */
export function isNotHeld(holding) {
  const units = holding.units, value = holding.marketValue;
  if (units !== null && units !== undefined && Math.abs(units) < DUST_UNITS) return true;
  return value === 0 && (units === null || units === undefined || Math.abs(units) < DUST_UNITS);
}

function tidy(text) {
  if (text == null) return null;
  const cleaned = String(text).replace(/\s+/g, " ").trim();
  return cleaned === "" ? null : cleaned;
}
