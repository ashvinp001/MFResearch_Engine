/**
 * Parser for the CAMS / KFintech mutual-fund CAS (MF_Calculation_Engine.md E15.2 C).
 *
 * Input:  StructuredDocument (extract-text.js) and the source file name.
 * Output: NormalizedPortfolio (before normalize/validate), every value as printed.
 *
 * Layout is AMC → Folio → Scheme. Each scheme block is anchored on its ISIN,
 * and values are read by LABEL ("Closing Unit Balance:", "NAV on <date>:", …),
 * never by fixed positions. Transactions are read through column bands taken
 * from the block's own table header (Date | Transaction | Amount | Units | Price | Unit Balance).
 */

import { createHolding, createPortfolio } from "../model/portfolio.schema.js";
import { CAS_FORMAT } from "./detect-format.js";
import { isNumberToken, parsePrintedDate, parsePrintedNumber } from "./parse-values.js";
import { assignCellsToColumns, buildColumns, hasColumns } from "./table-columns.js";
import { findLabelledName, nameNearAnchor, nameUnderFolios } from "./investor-name.js";
import { isValidIsin } from "../identity/isin.js";

const DATE = String.raw`\d{1,2}-[A-Za-z]{3}-\d{4}`;
const NUM = String.raw`\(?-?[\d,]+(?:\.\d+)?\)?`;
const CURRENCY = String.raw`(?:INR|₹|Rs\.?)?\s*`;

const RE = {
  period: new RegExp(`(${DATE})\\s*To\\s*(${DATE})`, "i"),
  email: /E-?mail\s*(?:Id|ID|Address)?\s*[:\-]?\s*(\S+@\S+)/i,
  summaryHeading: /PORTFOLIO\s+SUMMARY/i,
  totalRow: /^Total\b/i,
  amcHeading: /^[A-Za-z][A-Za-z0-9&().,'\s-]*(?:Mutual\s*Fund|\bMF)$/i,
  folio: /Folio\s*No\.?\s*:?\s*([A-Za-z0-9/ ]+?)\s*(?=PAN|KYC|$)/i,
  pan: /PAN\s*:?\s*([A-Z]{5}\d{4}[A-Z])/,
  isin: /ISIN\s*:?\s*([A-Z]{2}[A-Z0-9]{9}\d)/,
  isinLabelOnly: /ISIN\s*:?\s*$/,
  // An ISIN cut short by a line break: 1–11 code characters, then the line ends (or the
  // right-hand "Registrar : …" cell follows).
  isinPartial: /ISIN\s*:?\s*([A-Z]{2}[A-Z0-9]{0,9})(?=\s*(?:Registrar\b.*)?$)/,
  registrarCell: /\s*Registrar\s*:?\s*(?:CAMS|KFINTECH|KFIN|KARVY)\s*$/i,
  registrar: /Registrar\s*:?\s*(CAMS|KFINTECH|KFIN|KARVY)/i,
  schemeCode: /^([A-Z0-9]{1,15})-(?=\S)/,
  openingUnits: new RegExp(`Opening\\s+Unit\\s+Balance\\s*:?\\s*(${NUM})`, "i"),
  closingUnits: new RegExp(`Closing\\s+Unit\\s+Balance\\s*:?\\s*(${NUM})`, "i"),
  nav: new RegExp(`NAV\\s+on\\s+(${DATE})\\s*:?\\s*${CURRENCY}(${NUM})`, "i"),
  cost: new RegExp(`(?:Total\\s+)?Cost\\s+Value\\s*:?\\s*${CURRENCY}(${NUM})`, "i"),
  marketValue: new RegExp(`(?:Market\\s+Value|Valuation)\\s+on\\s+(${DATE})\\s*:?\\s*${CURRENCY}(${NUM})`, "i"),
  txnDateStart: new RegExp(`^(${DATE})\\s*(.*)$`),
  txnHeader: /Amount/i,
  addressStop: /Mobile|Phone|PORTFOLIO|Consolidated|statement/i,
};

const SUMMARY_COLUMNS = [
  { key: "costValue", test: (label) => /Cost/i.test(label) },
  { key: "marketValue", test: (label) => /Market|Value/i.test(label) },
];

const TXN_COLUMNS = [
  { key: "date", test: (label) => /^Date/i.test(label) },
  { key: "description", test: (label) => /Transaction|Description|Particulars/i.test(label) },
  { key: "amount", test: (label) => /Amount/i.test(label) },
  { key: "unitBalance", test: (label) => /Balance/i.test(label) },
  { key: "price", test: (label) => /Price|NAV/i.test(label) },
  { key: "units", test: (label) => /Units/i.test(label) },
];

export function parseCamsKfintech(doc, fileName) {
  const portfolio = createPortfolio(CAS_FORMAT.CAMS_KFINTECH, fileName);
  const rows = doc.pages.flatMap((page) => page.rows);

  readStatementHeader(rows, portfolio);
  readPortfolioSummary(rows, portfolio);
  readSchemeBlocks(rows, portfolio);

  return portfolio;
}

function readStatementHeader(rows, portfolio) {
  const headerText = rows.slice(0, 60).map((row) => row.text).join("\n");
  const period = headerText.match(RE.period);
  if (period) {
    portfolio.source.statementPeriod = { from: parsePrintedDate(period[1]), to: parsePrintedDate(period[2]) };
    portfolio.source.statementAsOf = parsePrintedDate(period[2]);
  }

  const emailIndex = rows.findIndex((row) => RE.email.test(row.text));
  if (emailIndex >= 0) portfolio.investor.email = rows[emailIndex].text.match(RE.email)[1];

  // 1) A labelled name ("Name : …", "Investor Name …") wins when present.
  const labelled = findLabelledName(rows);
  if (labelled) {
    portfolio.investor.name = labelled;
    return;
  }

  // 2) Name (then postal address) in the LEFT column near the email line. Headers
  //    are two-column: right-column prose shares and adds rows, so search a window.
  const nearEmail = emailIndex >= 0 ? nameNearAnchor(rows, emailIndex, { after: 30 }) : null;
  if (nearEmail) {
    portfolio.investor.name = nearEmail.name;
    portfolio.investor.address = readAddress(rows, nearEmail.index + 1);
    return;
  }

  // 3) The holder's name printed under the "Folio No" lines.
  portfolio.investor.name = nameUnderFolios(rows, RE.folio);
}

/** Postal address: left-column lines under the name, up to a stop line. */
function readAddress(rows, from) {
  const lines = [];
  for (let i = from; i < rows.length && lines.length < 6; i++) {
    const line = rows[i].cells.filter((cell) => cell.x < 280).map((cell) => cell.str).join(" ").trim();
    if (!line) continue;
    if (RE.addressStop.test(line) || RE.email.test(line)) break;
    lines.push(line);
  }
  return lines.length ? lines.join(", ") : null;
}

function readPortfolioSummary(rows, portfolio) {
  const start = rows.findIndex((row) => RE.summaryHeading.test(row.text));
  if (start < 0) return;

  let columns = null;
  for (let i = start + 1; i < Math.min(rows.length, start + 80); i++) {
    const row = rows[i];
    if (!columns && /Market\s*Value/i.test(row.text)) {
      columns = buildColumns([row], SUMMARY_COLUMNS);
      continue;
    }
    const numericCells = row.cells.filter((cell) => isNumberToken(cell.str));
    if (!numericCells.length) continue;
    const values = columns && hasColumns(columns, ["marketValue"])
      ? assignCellsToColumns(numericCells, columns)
      : { costValue: numericCells.length > 1 ? numericCells[0].str : null, marketValue: numericCells.at(-1)?.str ?? null };

    if (RE.totalRow.test(row.text)) {
      setPrintedTotal(portfolio, "totalCostValue", values.costValue);
      setPrintedTotal(portfolio, "totalMarketValue", values.marketValue);
      return;
    }
    // One row per fund house: "HSBC Mutual Fund   680,611.00   980,342.25".
    const amc = row.cells.filter((cell) => !isNumberToken(cell.str)).map((cell) => cell.str).join(" ").trim();
    if (amc && columns) {
      portfolio.printedTotals.byAmc.push({
        amc,
        costValue: parsePrintedNumber(values.costValue)?.value ?? null,
        marketValue: parsePrintedNumber(values.marketValue)?.value ?? null,
        raw: { costValue: values.costValue ?? null, marketValue: values.marketValue ?? null },
      });
    }
  }
}

function normalizeAmc(name) {
  return String(name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function setPrintedTotal(portfolio, key, raw) {
  const parsed = parsePrintedNumber(raw);
  if (!parsed) return;
  portfolio.printedTotals[key] = parsed.value;
  portfolio.printedTotals.raw[key] = parsed.raw;
}

function readSchemeBlocks(rows, portfolio) {
  const context = { amc: null, folio: null, pan: null, folioRowIndex: -1 };
  // Fund-house headings: the usual "… Mutual Fund / MF" pattern, or any name listed in
  // the portfolio summary (e.g. "Zerodha Fund House").
  const summaryAmcs = new Set(portfolio.printedTotals.byAmc.map((entry) => normalizeAmc(entry.amc)));
  const isAmcHeading = (row, text) => !row.cells.some((cell) => isNumberToken(cell.str))
    && (RE.amcHeading.test(text) || summaryAmcs.has(normalizeAmc(text)));
  let holding = null;
  let txnColumns = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const text = row.text.trim();

    const schemeLine = joinWrappedIsin(rows, i);
    if (schemeLine) {
      holding = startHolding(rows, i, schemeLine, context);
      portfolio.holdings.push(holding);
      txnColumns = null;
      continue;
    }

    if (isAmcHeading(row, text)) {
      context.amc = text;
      continue;
    }

    const folioMatch = text.match(RE.folio);
    if (folioMatch) {
      context.folio = folioMatch[1].replace(/\s+/g, " ").trim();
      context.pan = text.match(RE.pan)?.[1] ?? null;
      context.folioRowIndex = i;
      continue;
    }

    if (!holding) continue;

    if (!txnColumns && RE.txnHeader.test(text) && /Units/i.test(text) && /Price|NAV/i.test(text)) {
      txnColumns = buildColumns(collectHeaderRows(rows, i), TXN_COLUMNS);
      continue;
    }

    readLabelledValues(text, holding);

    if (RE.txnDateStart.test(row.cells[0]?.str ?? "")) {
      holding.transactions.push(readTransaction(row, txnColumns));
    }

    if (holding.raw.units !== null && holding.raw.marketValue !== null) {
      holding = null; // closing summary captured — block complete
    }
  }
}

/**
 * Returns the scheme line text if row i carries an ISIN — including an ISIN that wraps:
 *  · "ISIN:" at the end of the line and the code on the next line;
 *  · the code itself split across lines ("ISIN: INF917K01QA" / "1(Advisor: …)").
 * A split code is accepted only when the rejoined 12 characters pass the ISIN check digit.
 */
function joinWrappedIsin(rows, i) {
  const text = rows[i].text;
  if (RE.isin.test(text)) return text;
  const next = rows[i + 1]?.text ?? "";
  // "… - ISIN:" ends the name line — also when the right-hand "Registrar : CAMS" cell follows it on that line
  // (it is moved to the end, where the rest of the parser expects it).
  const registrarCell = text.match(RE.registrarCell)?.[0] ?? "";
  const head = registrarCell ? text.slice(0, text.length - registrarCell.length) : text;
  if (RE.isinLabelOnly.test(head) && next && RE.isin.test(`${head} ${next}`)) {
    return `${head} ${next.trim()}${registrarCell}`;
  }
  const partial = text.match(RE.isinPartial);
  if (partial && next) {
    const rest = next.trim().match(/^[A-Z0-9]+/)?.[0] ?? "";
    const code = `${partial[1]}${rest}`.slice(0, 12);
    if (code.length === 12 && isValidIsin(code)) {
      // Rebuild the line with the whole code so the rest of the parser reads it normally.
      return `${text.replace(RE.isinPartial, `ISIN: ${code}`)} ${next.trim().slice(12 - partial[1].length)}`;
    }
  }
  return null;
}

function startHolding(rows, i, schemeLine, context) {
  const holding = createHolding();
  holding.isin = schemeLine.match(RE.isin)[1];
  holding.amc = context.amc;
  holding.folio = context.folio;
  holding.pan = context.pan;

  // Registrar is printed on the scheme line or just after it.
  const registrarText = [schemeLine, rows[i + 1]?.text, rows[i + 2]?.text].join(" ");
  const registrar = registrarText.match(RE.registrar)?.[1]?.toUpperCase() ?? null;
  holding.registrar = registrar === "CAMS" ? "CAMS" : registrar ? "KFINTECH" : null;

  // A long scheme name can wrap so that the ISIN lands on a later line. Only
  // join earlier rows when they look like a name fragment (no labels, no numbers)
  // and either start with the registrar scheme code or the ISIN row has no name.
  let namePart = withoutRegistrar(schemeLine).split(/\s*-?\s*ISIN\b/)[0].trim();
  const fragments = [];
  for (let back = 1; back <= 2 && !RE.schemeCode.test(namePart); back++) {
    const prev = rows[i - back];
    if (!prev || i - back <= context.folioRowIndex + 1 || !isNameFragment(prev)) break;
    fragments.unshift(withoutRegistrar(prev.text).trim());
    if (RE.schemeCode.test(fragments[0])) {
      namePart = joinNameParts(fragments.join(" "), namePart);
      break;
    }
  }
  if (!namePart && fragments.length) namePart = fragments.at(-1);

  const code = namePart.match(RE.schemeCode);
  holding.rtaSchemeCode = code ? code[1] : null;
  holding.schemeName = (code ? namePart.slice(code[0].length) : namePart).replace(/[\s-]+$/, "").trim() || null;
  return holding;
}

/** A name fragment has no labels and no numbers (the right-hand "Registrar : CAMS" cell is ignored). */
function isNameFragment(row) {
  return !withoutRegistrar(row.text).includes(":") && !row.cells.some((cell) => isNumberToken(cell.str));
}

function withoutRegistrar(text) {
  return text.replace(RE.registrarCell, "");
}

/** "… Fund (Non" + "-Demat)" → "… Fund (Non-Demat)"; otherwise joined with a space. */
function joinNameParts(first, second) {
  if (!second) return first.trim();
  return /^-\S/.test(second) ? `${first.trim()}${second}` : `${first.trim()} ${second}`;
}

/** The transaction header may wrap over two lines (e.g. "(INR)" units row). */
function collectHeaderRows(rows, i) {
  const header = [rows[i]];
  const next = rows[i + 1];
  if (next && !RE.txnDateStart.test(next.cells[0]?.str ?? "") && /\(INR\)|\(Rs|Units|Price/i.test(next.text)) {
    header.push(next);
  }
  return header;
}

function readLabelledValues(text, holding) {
  const opening = text.match(RE.openingUnits);
  if (opening) setValue(holding, "openingUnits", opening[1]);

  const closing = text.match(RE.closingUnits);
  if (closing) setValue(holding, "units", closing[1]);

  const nav = text.match(RE.nav);
  if (nav) {
    setValue(holding, "nav", nav[2]);
    holding.navDate = parsePrintedDate(nav[1]);
  }

  const cost = text.match(RE.cost);
  if (cost) setValue(holding, "costValue", cost[1]);

  const market = text.match(RE.marketValue);
  if (market) setValue(holding, "marketValue", market[2]);
}

function setValue(holding, key, raw) {
  const parsed = parsePrintedNumber(raw);
  holding.raw[key] = raw.trim();
  holding[key] = parsed ? parsed.value : null;
}

function readTransaction(row, columns) {
  const [dateCell, ...rest] = row.cells;
  const [, dateText, inlineDescription] = dateCell.str.match(RE.txnDateStart);
  const numericCells = rest.filter((cell) => isNumberToken(cell.str));
  const descriptionCells = rest.filter((cell) => !isNumberToken(cell.str));
  let description = [inlineDescription, ...descriptionCells.map((cell) => cell.str)].join(" ").trim();

  let mapped;
  if (numericCells.length === 0) {
    // Some PDFs emit a whole line as one text run: peel the trailing numbers off the text.
    const tokens = description.split(/\s+/);
    const trailing = [];
    while (tokens.length && isNumberToken(tokens.at(-1))) trailing.unshift(tokens.pop());
    description = tokens.join(" ");
    mapped = mapByCount(trailing);
  } else if (columns && hasColumns(columns, ["amount", "units", "unitBalance"])) {
    mapped = assignCellsToColumns(numericCells, columns);
  } else {
    mapped = mapByCount(numericCells.map((cell) => cell.str));
  }

  const raw = {
    amount: mapped.amount ?? null,
    units: mapped.units ?? null,
    price: mapped.price ?? null,
    unitBalance: mapped.unitBalance ?? null,
  };
  return {
    date: parsePrintedDate(dateText),
    description,
    amount: parsePrintedNumber(raw.amount)?.value ?? null,
    units: parsePrintedNumber(raw.units)?.value ?? null,
    price: parsePrintedNumber(raw.price)?.value ?? null,
    unitBalance: parsePrintedNumber(raw.unitBalance)?.value ?? null,
    raw,
  };
}

/** Fallback when no header was found: CAMS prints 4, 3 or 1 trailing numbers. */
function mapByCount(values) {
  if (values.length >= 4) {
    const [amount, units, price, unitBalance] = values.slice(-4);
    return { amount, units, price, unitBalance };
  }
  if (values.length === 3) {
    const [units, price, unitBalance] = values;
    return { units, price, unitBalance };
  }
  if (values.length === 1) return { amount: values[0] };
  return {};
}
