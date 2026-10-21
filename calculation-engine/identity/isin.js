/**
 * ISIN identity helpers.
 *
 * Input: candidate strings. Output: booleans / extracted ISIN tokens.
 *  - isValidIsin("INF846K01EW2") → true when shape and check digit are valid.
 *  - findIsins(text) → every ISIN-shaped token in the text, in order.
 *  - isMutualFundIsin(isin) → true for Indian MF units (prefix "INF").
 *
 * Check digit (ISO 6166): expand letters to numbers (A=10 … Z=35), then apply
 * Luhn over the full expanded string INCLUDING the check digit — counting from
 * the rightmost digit as position 1, double every even position (2nd, 4th, …),
 * add the digits of each product, and the total must be divisible by 10.
 */

const ISIN_SHAPE_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const ISIN_SCAN_RE = /\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b/g;

export function isValidIsin(isin) {
  if (typeof isin !== "string" || !ISIN_SHAPE_RE.test(isin)) return false;

  const expanded = [...isin]
    .map((ch) => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch))
    .join("");

  let sum = 0;
  for (let i = 0; i < expanded.length; i++) {
    let digit = Number(expanded[expanded.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function findIsins(text) {
  return String(text).match(ISIN_SCAN_RE) ?? [];
}

export function isMutualFundIsin(isin) {
  return typeof isin === "string" && isin.startsWith("INF");
}
