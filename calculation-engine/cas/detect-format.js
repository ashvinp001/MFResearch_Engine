/**
 * Format detection (MF_Calculation_Engine.md E15.2 B) — an ORDERED rule set.
 *
 * Input:  StructuredDocument from extract-text.js.
 * Output: "CAMS_KFINTECH" | "NSDL" | "CDSL" | "UNSUPPORTED".
 *
 * Why ordered and structural: an NSDL CAS mentions "CDSL" (it consolidates both
 * depositories) and names CAMS/KFintech as registrars, and every issuer prints
 * "Consolidated Account Statement". Plain keyword matching therefore misfires.
 *
 *  Rule 1 — MF RTA statement: prints per-scheme "Closing Unit Balance" together
 *           with "Folio No". Only the CAMS/KFintech CAS has this structure.
 *  Rule 2 — Depository statement: prints depository-account markers
 *           (DP ID / Client ID / BO ID / Demat). The issuer is the depository
 *           whose full name appears FIRST in the document (the letterhead).
 *  Rule 1 once more on the WHOLE document (a single scheme with years of SIPs prints its closing balance late).
 *  Otherwise UNSUPPORTED.
 */

import { DETECTION } from "../config.js";

export const CAS_FORMAT = Object.freeze({
  CAMS_KFINTECH: "CAMS_KFINTECH",
  NSDL: "NSDL",
  CDSL: "CDSL",
  UNSUPPORTED: "UNSUPPORTED",
});

const RTA_STRUCTURE = [/Closing\s+Unit\s+Balance/i, /Folio\s+No/i];
const DEPOSITORY_MARKERS = /\bDP\s*ID\b|\bClient\s*ID\b|\bBO\s*ID\b|\bDemat\b/i;
const ISSUER_NAMES = [
  { format: CAS_FORMAT.NSDL, pattern: /National\s+Securities\s+Depository|\bNSDL\b/i },
  { format: CAS_FORMAT.CDSL, pattern: /Central\s+Depository\s+Services|\bCDSL\b/i },
];

export function detectFormat(doc) {
  const pageText = (pages) => pages.flatMap((page) => page.rows.map((row) => row.text)).join("\n");
  const text = pageText(doc.pages.slice(0, DETECTION.pagesToScan));

  if (RTA_STRUCTURE.every((pattern) => pattern.test(text))) {
    return CAS_FORMAT.CAMS_KFINTECH;
  }

  if (DEPOSITORY_MARKERS.test(text)) {
    const firstIssuer = ISSUER_NAMES
      .map(({ format, pattern }) => ({ format, index: text.search(pattern) }))
      .filter(({ index }) => index >= 0)
      .sort((p, q) => p.index - q.index)[0];
    if (firstIssuer) return firstIssuer.format;
  }

  // Rule 1 again on the whole statement, only once Rule 2 found no depository statement: one scheme with years of SIPs
  // can print its "Closing Unit Balance" only after many pages of transactions (seen: a single-fund CAMS CAS of 8
  // pages, closing balance on page 8).
  if (RTA_STRUCTURE.every((pattern) => pattern.test(pageText(doc.pages)))) {
    return CAS_FORMAT.CAMS_KFINTECH;
  }

  return CAS_FORMAT.UNSUPPORTED;
}
