/**
 * Normalization — shapes parser output into the final contract (MF_Calculation_Engine.md E15.1).
 *
 * Input:  a parser's NormalizedPortfolio draft.
 * Output: the same portfolio with whitespace trimmed, holding status derived
 *         from the printed closing units, investor PANs collected, and any
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
    holding.status = holding.units === 0 ? "redeemed" : "active";
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

function tidy(text) {
  if (text == null) return null;
  const cleaned = String(text).replace(/\s+/g, " ").trim();
  return cleaned === "" ? null : cleaned;
}
