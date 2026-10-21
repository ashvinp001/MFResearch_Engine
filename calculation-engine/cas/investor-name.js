/**
 * Investor name finder shared by both CAS parsers.
 *
 * Input:  positional rows. Output: the name exactly as printed, or null.
 * Statement headers vary (two-column layouts, labelled fields, name above the
 * address), so several anchored strategies are tried in order of reliability.
 * A candidate is accepted only if it reads like a person's name — never guessed.
 *  - findLabelledName(rows)   "Name : X", "Investor Name X", "Sole/First Holder: X"
 *  - firstNameCell(rows)      first cell of a row that looks like a name
 *  - nameNearAnchor(rows, i)  left-column name near the email line (two-column headers)
 *  - nameUnderFolios(rows)    holder name repeated under "Folio No" lines
 *  - looksLikeName(text)
 */

const TITLE = String.raw`(?:(?:MRS|MR|MS|MISS|DR|SHRI|SMT|KUMARI|KUM)\.?\s+)?`;
const NAME_RE = new RegExp(`^${TITLE}[A-Za-z][A-Za-z .'-]{1,80}$`);
const NOT_A_NAME = /\b(statement|account|consolidated|mutual|fund|funds|limited|ltd|depository|services|period|page|email|e-mail|mobile|phone|address|nominee|registrar|summary|total|india|private|pvt|investor|holder|kyc|pan|folio|transaction|date|portfolio|value|cost|units|nav|dear|welcome|cas|nsdl|cdsl|cams|kfintech|demat|opening|closing|balance)\b/i;

const LABEL_RE = /^(?:investor\s*name|name\s*of\s*(?:the\s*)?(?:investor|account\s*holder|first\s*holder|holder)|(?:sole\s*\/?\s*)?first\s*holder(?:\s*name)?|holder\s*name|account\s*holder(?:\s*name)?|name)\s*[:\-]?\s*/i;

export function looksLikeName(text) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (value.length < 3 || !NAME_RE.test(value) || NOT_A_NAME.test(value)) return false;
  const words = value.split(" ");
  return words.length >= 1 && words.length <= 6;
}

/** A labelled name: value in the same cell ("Name : X") or in the next cell. */
export function findLabelledName(rows, limit = 150) {
  for (const row of rows.slice(0, limit)) {
    for (let i = 0; i < row.cells.length; i++) {
      const cell = row.cells[i].str.trim();
      const match = cell.match(LABEL_RE);
      if (!match) continue;
      const sameCell = cell.slice(match[0].length).trim();
      if (sameCell && looksLikeName(sameCell)) return sameCell;
      // Label alone in its cell (must end with ":" or be a known label) → value is the next cell.
      if (!sameCell && /[:\-]\s*$|name$|holder$/i.test(cell)) {
        const next = row.cells[i + 1]?.str.trim();
        if (next && looksLikeName(next)) return next;
      }
    }
  }
  return null;
}

/** First cell of rows[from..from+span) that reads like a name (two-column headers). */
export function firstNameCell(rows, from, span = 2) {
  for (let i = from; i >= 0 && i < Math.min(rows.length, from + span); i++) {
    const first = rows[i]?.cells[0]?.str.trim();
    if (first && looksLikeName(first)) return { name: first, index: i };
  }
  return null;
}

/** Statements print the investor block in the LEFT column; right-column prose is ignored. */
const LEFT_COLUMN_MAX_X = 280;

function leftNameCell(row) {
  const cell = row?.cells.find((c) => c.x < LEFT_COLUMN_MAX_X && looksLikeName(c.str));
  return cell ? cell.str.trim() : null;
}

/**
 * Name in the left column near an anchor line (e.g. the email line). Right-column
 * paragraphs add extra rows in between, so a window of rows is searched: first
 * below the anchor (nearest first), then just above it.
 */
export function nameNearAnchor(rows, anchorIndex, { after = 8, before = 3 } = {}) {
  for (let i = anchorIndex + 1; i <= Math.min(rows.length - 1, anchorIndex + after); i++) {
    const name = leftNameCell(rows[i]);
    if (name) return { name, index: i };
  }
  for (let i = anchorIndex - 1; i >= Math.max(0, anchorIndex - before); i--) {
    const name = leftNameCell(rows[i]);
    if (name) return { name, index: i };
  }
  return null;
}

/**
 * The holder name printed under "Folio No" lines (CAMS / KFintech). The name
 * repeated most often across folios wins; ties go to the first one printed.
 */
export function nameUnderFolios(rows, folioPattern) {
  const counts = new Map();
  rows.forEach((row, index) => {
    if (!folioPattern.test(row.text)) return;
    for (let i = index + 1; i <= Math.min(rows.length - 1, index + 2); i++) {
      const name = leftNameCell(rows[i]);
      if (name) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        break;
      }
    }
  });
  let best = null;
  for (const [name, count] of counts) if (!best || count > best.count) best = { name, count };
  return best?.name ?? null;
}
