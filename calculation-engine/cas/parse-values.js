/**
 * Value parsers for printed statement text.
 *
 * Input: raw strings exactly as printed. Output: parsed values that always keep
 * the original string alongside, so nothing printed is ever lost.
 *  - parsePrintedNumber("1,00,000.50") → { raw, value: 100000.5, decimals: 2 }
 *  - toPaise("1,00,000.50") → 10000050 (integer, string-based, no float error)
 *  - parsePrintedDate("05-Jan-2024") → "2024-01-05"
 */

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Matches a printed number token: 1,00,000.00 | (1,234.5) | -12.3 | 0.000 */
export const NUMBER_TOKEN_RE = /^\(?-?(?:₹|INR|Rs\.?)?\s*-?\d[\d,]*(?:\.\d+)?\)?$/i;

/** Date token formats seen across CAS statements. */
export const DATE_TOKEN_RE = /\b(\d{1,2})[-/ ]([A-Za-z]{3}|\d{1,2})[-/ ](\d{4})\b/;

function cleanNumberText(raw) {
  return String(raw).replace(/₹|INR|Rs\.?/gi, "").replace(/\s+/g, "").trim();
}

/** True when the token reads as a printed number. */
export function isNumberToken(raw) {
  return raw != null && NUMBER_TOKEN_RE.test(String(raw).trim());
}

/**
 * Parse an Indian- or international-format printed number.
 * Parentheses or a leading minus mean negative. Returns null for blanks / "-" / "NA".
 */
export function parsePrintedNumber(raw) {
  if (raw == null) return null;
  const text = cleanNumberText(raw);
  if (text === "" || /^(-|–|NA|N\.A\.?)$/i.test(text)) return null;

  const negative = /^\(.*\)$/.test(text) || text.startsWith("-");
  const digits = text.replace(/[(),\-]/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;

  const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
  const value = Number(digits) * (negative ? -1 : 1);
  return { raw: String(raw).trim(), value, decimals };
}

/**
 * Convert a printed money string to integer paise using string arithmetic,
 * so reconciliation never suffers floating-point drift. Returns null if unparsable.
 */
export function toPaise(raw) {
  const parsed = parsePrintedNumber(raw);
  if (!parsed) return null;
  const text = cleanNumberText(raw).replace(/[(),\-]/g, "");
  const [whole, fraction = ""] = text.split(".");
  // Round half-up on the third decimal if the statement printed more than 2.
  const padded = (fraction + "000").slice(0, 3);
  let paise = Number(whole) * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) paise += 1;
  return parsed.value < 0 ? -paise : paise;
}

/**
 * Parse a printed date (dd-Mon-yyyy, dd/mm/yyyy, dd-mm-yyyy, dd Mon yyyy) to ISO.
 * Returns null if the text holds no valid date.
 */
export function parsePrintedDate(raw) {
  if (raw == null) return null;
  const match = String(raw).match(DATE_TOKEN_RE);
  if (!match) return null;
  const day = Number(match[1]);
  const month = /^\d+$/.test(match[2]) ? Number(match[2]) : MONTHS[match[2].toLowerCase()];
  const year = Number(match[3]);
  if (!month || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
