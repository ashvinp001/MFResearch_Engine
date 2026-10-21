/**
 * Parser for the NSDL / CDSL depository CAS (MF_Calculation_Engine.md E15.2 D).
 *
 * Input:  StructuredDocument (extract-text.js), the detected format, file name.
 * Output: NormalizedPortfolio (before normalize/validate), every value as printed.
 *
 * Tables are read as true tables:
 *  1. A header is a block of lines around a cell that reads "ISIN…". Header text
 *     wraps over several lines; the whole block is turned into column bands.
 *  2. A single table row can spread over several text lines (wrapped fund names,
 *     ISIN + UCC, vertically centred cells). Lines that sit close together form
 *     one CLUSTER; a cluster holding several ISINs is split by nearest ISIN line.
 *  3. Every cell of a logical row is assigned to its column band by x.
 * A row is a mutual-fund holding when its ISIN starts with "INF"; other
 * securities (shares, bonds) are counted and reported, never silently dropped.
 *
 * Printed totals: a depository statement's grand total includes equities, so we
 * reconcile against the "Total" row of each MUTUAL-FUND table segment instead.
 * A segment that mixes MF and non-MF rows cannot provide an MF subtotal.
 */

import { createHolding, createPortfolio } from "../model/portfolio.schema.js";
import { findIsins, isMutualFundIsin } from "../identity/isin.js";
import { isNumberToken, parsePrintedDate, parsePrintedNumber, toPaise } from "./parse-values.js";
import { assignCellsToColumns, buildColumns, columnForX, hasColumns } from "./table-columns.js";
import { findLabelledName, firstNameCell, looksLikeName } from "./investor-name.js";

const DATE = String.raw`\d{1,2}[-/ ](?:[A-Za-z]{3}|\d{1,2})[-/ ]\d{4}`;

const RE = {
  period: new RegExp(`from\\s+(${DATE})\\s+to\\s+(${DATE})`, "i"),
  asOn: new RegExp(`as\\s+on\\s+(${DATE})`, "i"),
  pan: /\b([A-Z]{5}\d{4}[A-Z])\b/,
  namePan: /^([A-Za-z][A-Za-z .'-]+?)\s*[(\[]?\s*PAN\s*:?\s*([A-Z]{5}\d{4}[A-Z])/,
  isinHeader: /^ISIN\b/i,
  totalRow: /^(?:Grand\s+|Sub[- ]?)?Total\b/i,
};

const COLUMNS = [
  { key: "isin", test: (label) => /^ISIN(\s*(UCC|Code|No\.?))?$/i.test(label) },
  { key: "folio", test: (label) => /Folio/i.test(label) },
  { key: "averageCost", test: (label) => /Average\s*Cost|Cost\s*per\s*Unit/i.test(label) },
  { key: "printedGain", test: (label) => /Unreali[sz]ed|Profit|Gain|P\s*\/\s*L/i.test(label) && !/%|Return/i.test(label) },
  { key: "nav", test: (label) => /NAV|Price|Rate/i.test(label) && !/Cost|Average/i.test(label) },
  { key: "costValue", test: (label) => /Total\s*Cost|Invested|Cost\s*Value|Purchase\s*Value|Investment/i.test(label) && !/per|Average/i.test(label) },
  { key: "marketValue", test: (label) => /Current\s*Value|Market\s*Value|Valuation|\bValue\b/i.test(label) && !/Cost|per|Face|Unrealised|Gain/i.test(label) },
  { key: "units", test: (label) => /Units|Bal|Quantity|Qty/i.test(label) && !/per|Cost|Value/i.test(label) },
  { key: "description", test: (label) => /Description|Scheme|Security|Name|ISIN/i.test(label) },
];

/**
 * Two consecutive lines belong to the same table row (or header) when the gap
 * between them is at most this many line heights. Lines inside one row sit
 * ≤ ~1.2 heights apart; rows are separated by cell padding on top of that.
 */
const SAME_CLUSTER_GAP_RATIO = 1.45;

const NUMERIC_KEYS = ["units", "nav", "costValue", "marketValue", "averageCost", "printedGain"];

export function parseNsdlCdsl(doc, format, fileName) {
  const portfolio = createPortfolio(format, fileName);
  const rows = doc.pages.flatMap((page) => page.rows.map((row) => ({ ...row, pageNumber: page.pageNumber })));

  readStatementHeader(rows, portfolio);
  const segments = readTables(rows, portfolio);
  applyPrintedTotals(segments, portfolio);

  return portfolio;
}

function readStatementHeader(rows, portfolio) {
  const headerText = rows.slice(0, 80).map((row) => row.text).join("\n");

  const period = headerText.match(RE.period);
  if (period) {
    portfolio.source.statementPeriod = { from: parsePrintedDate(period[1]), to: parsePrintedDate(period[2]) };
  }
  const asOn = headerText.match(RE.asOn);
  portfolio.source.statementAsOf = parsePrintedDate(asOn?.[1]) ?? portfolio.source.statementPeriod.to;

  portfolio.investor.pan = headerText.match(RE.pan)?.[1] ?? null;

  // 1) "NAME (PAN: …)" printed together — in a single cell or across the row.
  for (const row of rows.slice(0, 120)) {
    const match = row.cells.map((cell) => cell.str).concat(row.text).map((text) => text.match(RE.namePan)).find(Boolean);
    if (match && looksLikeName(match[1])) {
      portfolio.investor.name = match[1].trim();
      portfolio.investor.pan = match[2];
      return;
    }
  }

  // 2) A labelled name ("Name : …", "Sole / First Holder : …").
  const labelled = findLabelledName(rows);
  if (labelled) {
    portfolio.investor.name = labelled;
    return;
  }

  // 3) The name printed on the line just above the PAN line (letter-style header).
  const panIndex = rows.slice(0, 120).findIndex((row) => RE.pan.test(row.text));
  const abovePan = panIndex > 0 ? firstNameCell(rows, panIndex - 1, 1) : null;
  if (abovePan) portfolio.investor.name = abovePan.name;
}

// ---------- line helpers ----------

function hasNumbers(row) {
  return row.cells.some((cell) => isNumberToken(cell.str));
}

function sameCluster(upper, lower) {
  return (
    upper.pageNumber === lower.pageNumber &&
    upper.y - lower.y <= Math.max(upper.height, lower.height) * SAME_CLUSTER_GAP_RATIO
  );
}

function isHeaderLine(row) {
  return row.cells.some((cell) => RE.isinHeader.test(cell.str)) && findIsins(row.text).length === 0;
}

function isHeaderFiller(row) {
  return findIsins(row.text).length === 0 && !hasNumbers(row) && !RE.totalRow.test(row.text);
}

/**
 * A line above the core header line is wrapped header text only if none of its
 * cells spans two or more core header cells and it is not a lone left-margin
 * title (e.g. a section heading printed just above the table).
 */
function isHeaderTextAbove(row, coreRow) {
  if (!isHeaderFiller(row)) return false;
  const core = coreRow.cells;
  const spansColumns = row.cells.some((cell) => core.filter((c) => cell.x < c.right && cell.right > c.x).length >= 2);
  const loneTitle = row.cells.length === 1 && row.cells[0].x <= core[0].x + 2;
  return !spansColumns && !loneTitle;
}

/** Expand a header line up and down through adjacent wrapped header text. */
function headerBlock(rows, index) {
  let start = index;
  while (start > 0 && sameCluster(rows[start - 1], rows[start]) && isHeaderTextAbove(rows[start - 1], rows[index])) start--;
  let end = index;
  while (end + 1 < rows.length && sameCluster(rows[end], rows[end + 1]) && isHeaderFiller(rows[end + 1])) end++;
  return { start, end };
}

/** A header block qualifies when it names units and value columns. */
function readHeader(rows, index) {
  if (!isHeaderLine(rows[index])) return null;
  const { start, end } = headerBlock(rows, index);
  const block = rows.slice(start, end + 1);
  const text = block.map((row) => row.text).join(" ");
  if (!/Unit|Bal|Quantity|Qty/i.test(text) || !/Value|Valuation/i.test(text)) return null;
  return { columns: buildColumns(block, COLUMNS), nextIndex: end + 1 };
}

// ---------- table reading ----------

function readTables(rows, portfolio) {
  const segments = [];
  let columns = null;
  let segment = null;
  let otherRows = 0;
  let i = 0;

  while (i < rows.length) {
    const header = readHeader(rows, i);
    if (header) {
      const next = hasColumns(header.columns, ["units", "marketValue"]) ? header.columns : null;
      // The same header repeated before any total = the table continues on a new page.
      const continues = segment && next && columnKeys(next) === columnKeys(segment.columns);
      if (!continues) segment = null;
      columns = next;
      i = header.nextIndex;
      continue;
    }
    if (!columns) {
      i++;
      continue;
    }

    // Collect one cluster of adjacent lines (stopping before any new header).
    let end = i + 1;
    while (end < rows.length && sameCluster(rows[end - 1], rows[end]) && !isHeaderLine(rows[end])) end++;
    const cluster = rows.slice(i, end);
    i = end;

    const totalIndex = cluster.findIndex((row) => RE.totalRow.test(row.text));
    const dataLines = totalIndex >= 0 ? cluster.slice(0, totalIndex) : cluster;

    for (const lines of splitByIsin(dataLines)) {
      const isin = findIsins(lines.map((line) => line.text).join(" "))[0];
      if (!segment) {
        segment = { columns, mutualFundCount: 0, otherCount: 0, totalRaw: null, totalCostRaw: null };
        segments.push(segment);
      }
      if (isMutualFundIsin(isin)) {
        portfolio.holdings.push(readLogicalRow(lines, isin, columns, portfolio));
        segment.mutualFundCount++;
      } else {
        segment.otherCount++;
        otherRows++;
      }
    }

    if (totalIndex >= 0) {
      if (segment) {
        const totalLine = cluster[totalIndex];
        const values = assignCellsToColumns(totalLine.cells.filter((cell) => isNumberToken(cell.str)), columns);
        segment.totalRaw = values.marketValue ?? null;
        segment.totalCostRaw = values.costValue ?? null;
      }
      segment = null; // rows after a total start a new segment (sub-totals)
    }
  }

  if (otherRows > 0) {
    portfolio.integrity.warnings.push(
      `Your statement also lists ${otherRows} other investment${otherRows > 1 ? "s" : ""} (such as shares or bonds). This view covers mutual funds only, so ${otherRows > 1 ? "they are" : "it is"} not included in the totals.`
    );
  }
  return segments;
}

function columnKeys(columns) {
  return columns.map((column) => column.key ?? "-").join("|");
}

/**
 * Split a cluster into logical rows: one per line carrying an ISIN. Lines with
 * no ISIN join the ISIN line nearest to them vertically (ties go upward).
 * Clusters without any ISIN (headings, notes, page furniture) yield nothing.
 */
function splitByIsin(lines) {
  const anchors = lines.filter((line) => findIsins(line.text).length > 0);
  if (anchors.length === 0) return [];
  if (anchors.length === 1) return [lines];

  const groups = anchors.map(() => []);
  for (const line of lines) {
    let best = 0;
    for (let a = 1; a < anchors.length; a++) {
      if (Math.abs(anchors[a].y - line.y) < Math.abs(anchors[best].y - line.y)) best = a;
    }
    groups[best].push(line);
  }
  return groups;
}

/** Text cells starting within this many points of each other share a column. */
const LEFT_EDGE_TOLERANCE = 2;

/**
 * Assign every cell of a logical row to a column. Numbers go by their centre.
 * Text in a wide left-aligned column can sit far from the centred header, so
 * text cells sharing a left edge form a "lane", and the whole lane takes the
 * column of its widest cell (a short wrapped word like "BEES" follows its line).
 * Returns { key: [fragment, …] } in reading order.
 */
function assignRowCells(lines, columns) {
  const cells = lines.flatMap((line) => line.cells);
  const columnOf = new Map();

  for (const cell of cells.filter((c) => isNumberToken(c.str))) {
    columnOf.set(cell, columnForX((cell.x + cell.right) / 2, columns));
  }
  const textCells = cells.filter((c) => !isNumberToken(c.str));
  for (const cell of textCells) {
    const lane = textCells.filter((other) => Math.abs(other.x - cell.x) <= LEFT_EDGE_TOLERANCE);
    const widest = lane.reduce((w, c) => (c.right - c.x > w.right - w.x ? c : w));
    columnOf.set(cell, columnForX((widest.x + widest.right) / 2, columns));
  }

  const parts = {};
  for (const cell of cells) {
    const key = columnOf.get(cell)?.key;
    if (key) (parts[key] ??= []).push(cell.str);
  }
  return parts;
}

/** Read one logical row (possibly several lines) through the column bands. */
function readLogicalRow(lines, isin, columns, portfolio) {
  const parts = assignRowCells(lines, columns);

  const holding = createHolding();
  holding.isin = isin;
  const description = (parts.description ?? []).join(" ").replace(isin, "");
  holding.schemeName = description.replace(/\s+/g, " ").replace(/^[\s\-–:]+|[\s\-–:]+$/g, "") || null;
  holding.folio = parts.folio ? parts.folio.join(" ") : null;
  holding.navDate = portfolio.source.statementAsOf;

  for (const key of NUMERIC_KEYS) {
    // A numeric cell is a single printed number. More than one fragment in the
    // same column is ambiguous: keep it unparsed (null) so validation flags it.
    const fragments = parts[key] ?? [];
    const raw = fragments.length === 1 ? fragments[0] : null;
    const parsed = parsePrintedNumber(raw);
    holding.raw[key] = parsed ? parsed.raw : null;
    holding[key] = parsed ? parsed.value : null;
  }
  return holding;
}

// ---------- totals ----------

function applyPrintedTotals(segments, portfolio) {
  const mfSegments = segments.filter((segment) => segment.mutualFundCount > 0);
  if (!mfSegments.length) return;

  if (mfSegments.some((segment) => segment.otherCount > 0)) {
    portfolio.integrity.warnings.push(
      "A holdings table mixes mutual funds with other securities, so its printed total cannot be used to verify the mutual-fund value."
    );
    return;
  }

  setSummedTotal(portfolio, "totalMarketValue", mfSegments.map((segment) => segment.totalRaw));
  // Some MF tables (e.g. units held in demat) print no cost column at all; only
  // tables that HAVE a cost column contribute to, and must print, a cost total.
  const costSegments = mfSegments.filter((segment) => hasColumns(segment.columns, ["costValue"]));
  if (costSegments.length) setSummedTotal(portfolio, "totalCostValue", costSegments.map((segment) => segment.totalCostRaw));
}

/** Sum the printed subtotals of all MF segments in paise; null if any is missing. */
function setSummedTotal(portfolio, key, rawValues) {
  if (rawValues.some((raw) => toPaise(raw) === null)) return;
  const paise = rawValues.reduce((sum, raw) => sum + toPaise(raw), 0);
  portfolio.printedTotals[key] = paise / 100;
  portfolio.printedTotals.raw[key] = rawValues.join(" + ");
}
