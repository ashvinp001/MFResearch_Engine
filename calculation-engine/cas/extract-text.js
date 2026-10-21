/**
 * Positional text extraction (MF_Calculation_Engine.md E15.2 A).
 *
 * Input:  { data: ArrayBuffer, password?: string, pdfjs } — pdf.js is INJECTED so
 *         the engine runs unchanged in the browser or in Node (legacy build).
 * Output: StructuredDocument
 *   { pageCount, textItemCount,
 *     pages: [ { pageNumber, rows: [ { y, height, text, cells: [ { x, right, str } ] } ] } ] }
 * Rows are ordered top → bottom, cells left → right. `text` joins cells with a
 * single space and exists only for label searching; parsers read `cells`.
 */

import { EXTRACTION } from "../config.js";
import { CasError, CAS_ERROR } from "../errors.js";

export async function extractStructuredText({ data, password, pdfjs }) {
  const pdf = await openDocument({ data, password, pdfjs });
  const pages = [];
  let textItemCount = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items
      .filter((item) => typeof item.str === "string" && item.str.trim() !== "")
      .map(toPositionedItem)
      .flatMap(splitOnWideSpaces);
    textItemCount += items.length;
    pages.push({ pageNumber, rows: groupIntoRows(items) });
  }

  await pdf.destroy();

  if (textItemCount < EXTRACTION.minTextItemsForTextLayer) {
    throw new CasError(
      CAS_ERROR.NO_TEXT_LAYER,
      "This PDF has no readable text layer (it may be a scanned image). Please download the original CAS PDF from the issuer."
    );
  }
  return { pageCount: pdf.numPages, textItemCount, pages };
}

/**
 * Quick check before analysis: can the PDF be opened without a password?
 * Input: { data, pdfjs }. Output: "open" | "password" | "unreadable".
 */
export async function probePdf({ data, pdfjs }) {
  try {
    const pdf = await openDocument({ data, pdfjs });
    await pdf.destroy();
    return "open";
  } catch (error) {
    return error?.code === CAS_ERROR.PASSWORD_REQUIRED || error?.code === CAS_ERROR.PASSWORD_INCORRECT ? "password" : "unreadable";
  }
}

async function openDocument({ data, password, pdfjs }) {
  try {
    // pdf.js may transfer (detach) the buffer, so always hand it a copy.
    return await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), password: password || undefined }).promise;
  } catch (error) {
    if (error?.name === "PasswordException") {
      const incorrect = error.code === pdfjs.PasswordResponses?.INCORRECT_PASSWORD;
      throw new CasError(
        incorrect ? CAS_ERROR.PASSWORD_INCORRECT : CAS_ERROR.PASSWORD_REQUIRED,
        incorrect ? "The password is incorrect. Please check and try again." : "This CAS is password-protected. Please enter the password."
      );
    }
    throw new CasError(CAS_ERROR.UNREADABLE_PDF, "The file could not be read as a PDF.");
  }
}

function toPositionedItem(item) {
  const [a, b, c, d, x, y] = item.transform;
  const fontHeight = Math.hypot(c, d) || Math.hypot(a, b) || item.height || 1;
  return { str: item.str, x, y, width: item.width, fontHeight };
}

/**
 * Some PDF generators emit a whole table line as ONE text run, padding columns
 * with runs of spaces. Split such runs into separate items and estimate each
 * part's x from its character offset, so column bands still work.
 */
function splitOnWideSpaces(item) {
  if (!/\S\s{2,}\S/.test(item.str)) return [item];
  const charWidth = item.width / item.str.length;
  const parts = [];
  const pattern = /\S+(?:\s\S+)*/g;
  let match;
  while ((match = pattern.exec(item.str)) !== null) {
    parts.push({
      str: match[0],
      x: item.x + match.index * charWidth,
      y: item.y,
      width: match[0].length * charWidth,
      fontHeight: item.fontHeight,
    });
  }
  return parts;
}

/** Group items into rows by baseline y, then merge touching items into cells. */
function groupIntoRows(items) {
  const sorted = [...items].sort((p, q) => q.y - p.y || p.x - q.x);
  const rows = [];

  for (const item of sorted) {
    const row = rows[rows.length - 1];
    const tolerance = Math.max(item.fontHeight * EXTRACTION.rowToleranceRatio, 1);
    if (row && Math.abs(row.y - item.y) <= tolerance) {
      row.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  return rows.map((row) => {
    const cells = mergeIntoCells(row.items.sort((p, q) => p.x - q.x));
    const height = Math.max(...row.items.map((item) => item.fontHeight));
    return { y: row.y, height, text: cells.map((cell) => cell.str).join(" "), cells };
  });
}

function mergeIntoCells(items) {
  const cells = [];
  for (const item of items) {
    const last = cells[cells.length - 1];
    const gap = last ? item.x - last.right : Infinity;
    if (last && gap <= item.fontHeight * EXTRACTION.cellMergeGapRatio) {
      const needsSpace = gap > item.fontHeight * 0.1 && !last.str.endsWith(" ") && !item.str.startsWith(" ");
      last.str += (needsSpace ? " " : "") + item.str;
      last.right = Math.max(last.right, item.x + item.width);
    } else {
      cells.push({ x: item.x, right: item.x + item.width, str: item.str });
    }
  }
  return cells.map((cell) => ({ ...cell, str: cell.str.replace(/\s+/g, " ").trim() })).filter((cell) => cell.str !== "");
}
