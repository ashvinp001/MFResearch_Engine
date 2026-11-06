/**
 * Engine tests — run in the browser at /tests/ (no Node required).
 * Synthetic StructuredDocuments mimic real CAS layouts cell-by-cell, so the
 * parsers, detection and validation are exercised without a PDF.
 * Add real anonymized statements as fixtures as they become available.
 */

import {
  parseCasDocument, isValidIsin, CAS_FORMAT, FLAG, summarizePortfolio, allocatePortfolio, summarizeRecommendations, holdingKey,
  buildSnapshot, buildDetailedReport, buildReportProfile, diversificationStatus, categoryFromText,
  buildSchemeMap, mapHoldings, UNMATCHED_REASON, revalueAtLatestNav, VALUATION_REASON, VALUATION_SOURCE, classifyFund, FUND_CATEGORY,
  autoRecommend, gradeFund, engineOf, creditQuality, isSectorPassive, fundOverlap,
  RETURN_VIEW, returnColumns, columnReturn, returnsTable,
  scoreCategory, backtestCategory, fundMeasures, resolveSettings, quartileOf, quarterEnds, quarterlyQuartiles, normalizedComparison, rebasedOn,
  scoreIndexCategory, indexFundMeasures, indexFamily, indexCategoryLabel, isIndexFund, TRACKED_INDICES,
} from "../calculation-engine/index.js";
import { formatPaise, multiplyToPaise } from "../calculation-engine/portfolio-analyzer/revalue.js";
import { daysBetween, navOn, navSeries, periodStart, trailingReturn, xirr } from "../calculation-engine/analytics/returns.js";
import { holdingCashflows, portfolioXirr, XIRR_EXCLUSION } from "../calculation-engine/portfolio-analyzer/xirr.js";
import { buildAllocation, normalisedHoldings, withAllocation } from "../calculation-engine/portfolio-analyzer/allocation.js";
import { returnNotes } from "../calculation-engine/portfolio-analyzer/return-notes.js";
import { lastCompletedMonthEnd, monthEnds, riskMetrics } from "../calculation-engine/analytics/risk.js";
import { assetGroup, benchmarkDisplayName, buildFundData, groupFromMix } from "../calculation-engine/portfolio-analyzer/portfolio-performance.js";
import { createHolding, createPortfolio } from "../calculation-engine/model/portfolio.schema.js";
import { parsePrintedDate, parsePrintedNumber, toPaise } from "../calculation-engine/cas/parse-values.js";
import { detectFormat } from "../calculation-engine/cas/detect-format.js";
import { camsDoc, doc, nsdlDoc } from "./fixtures.js";
import { isNotHeld } from "../calculation-engine/cas/normalize.js";
import { fundCommentary } from "../app/portfolio-analyzer/reports/detailed-copy.js";
import { samplePortfolio, SAMPLE_FUND_DATA } from "./sample-snapshot.js";
import { capBasket } from "../calculation-engine/portfolio-analyzer/portfolio-fit.js";
import { gradeYoungSmall } from "../calculation-engine/portfolio-analyzer/fund-grading.js";
import { RECOMMENDATION } from "../calculation-engine/config.js";

const SHIPPED_LISTS = await Promise.all(["regular", "direct", "etf"].map(async (f) => (await fetch(`../data/schemes/${f}.json`)).json()));

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  }
}
function eq(actual, expected, label = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label} expected ${e}, got ${a}`);
}

// ---------- value parsing ----------
test("Indian number parsing keeps raw and value", () => {
  eq(parsePrintedNumber("1,00,000.50"), { raw: "1,00,000.50", value: 100000.5, decimals: 2 });
  eq(parsePrintedNumber("(1,234.567)").value, -1234.567);
  eq(parsePrintedNumber("INR 45.6789").value, 45.6789);
  eq(parsePrintedNumber("-"), null);
});
test("toPaise is exact", () => {
  eq(toPaise("1,00,000.50"), 10000050);
  eq(toPaise("0.10") + toPaise("0.20"), 30);
  eq(toPaise("(25.00)"), -2500);
});
test("Date parsing to ISO", () => {
  eq(parsePrintedDate("05-Jan-2024"), "2024-01-05");
  eq(parsePrintedDate("31/12/2024"), "2024-12-31");
  eq(parsePrintedDate("garbage"), null);
});

// ---------- ISIN ----------
test("ISIN check digit", () => {
  eq(isValidIsin("INF846K01EW2"), true, "Axis ELSS");
  eq(isValidIsin("US0378331005"), true, "Apple");
  eq(isValidIsin("INE002A01018"), true, "Reliance");
  eq(isValidIsin("INF846K01EW3"), false, "bad check digit");
  eq(isValidIsin("INF846K01EW"), false, "short");
});

// ---------- CAMS / KFintech ----------

test("CAMS: detected as CAMS_KFINTECH", () => eq(detectFormat(camsDoc), CAS_FORMAT.CAMS_KFINTECH));

test("CAS: a fund the client no longer holds (0 units, a leftover fraction, or ₹0 value) is never treated as held", () => {
  const h = (units, marketValue) => isNotHeld({ units, marketValue });
  eq([h(0, 0), h(0, null), h(0.0004, 0.03), h(-0.0002, 0), h(null, 0)], [true, true, true, true, true]);
  eq([h(125, 12000), h(0.5, 40), h(null, null), h(null, 1500)], [false, false, false, false]);   // unread figures: kept and flagged, never dropped
  // through the parser: a closing balance of 0.000 is redeemed and stays out of every report
  const p = parseCasDocument(doc([camsDoc.pages[0].rows.map((r) => r.cells.map((c) => [c.x, c.str
    .replace("Closing Unit Balance: 125.000", "Closing Unit Balance: 0.000").replace("INR 12,000.00", "INR 0.00")]))]), "cams.pdf");
  eq(p.holdings[0].status, "redeemed");
});

test("Detailed report: folios with less than one unit are listed to close (incl. leftovers no report shows)", () => {
  const p = samplePortfolio();
  const base = p.holdings.filter((h) => h.status === "active")[0];
  const mk = (isin, schemeName, units, status, folio) => ({ ...structuredClone(base), isin, schemeName, units, status, folio, raw: { ...base.raw, units: String(units) } });
  const holdings = [mk("INFL0001", "Alpha Large Cap Fund - Direct Growth", 0.4521, "active", "111"), mk("INFL0002", "Beta Mid Cap Fund - Direct Growth", 0.0003, "redeemed", "222"),
    mk("INFL0003", "Gamma Flexi Cap Fund - Direct Growth", 0, "redeemed", "333"), mk("INFL0004", "Delta Small Cap Fund - Direct Growth", 125.5, "active", "444")];
  const m = buildDetailedReport({ portfolio: { ...p, holdings }, fundData: SAMPLE_FUND_DATA, verdicts: {} });
  eq(m.leftovers.map((l) => [l.name, l.folio, l.units]), [["Alpha Large Cap Fund", "111", "0.4521"], ["Beta Mid Cap Fund", "222", "0.0003"]]);
});

test("CAS: a scheme name the layout hides is taken from the AMFI list by its exact ISIN — no false warning", () => {
  // The ISIN line carries no name and the name row sits right under the folio line, where the reader does not join it.
  const rows = [
    [[40, "Consolidated Account Statement"]], [[40, "01-Apr-2024 To 31-Dec-2024"]], [[40, "Email Id: investor@example.com"]],
    [[40, "RAHUL SHARMA"]], [[40, "PORTFOLIO SUMMARY"]], [[40, "Mutual Fund"], [300, "Cost Value"], [420, "Market Value"]],
    [[40, "PPFAS Mutual Fund"], [300, "10,000.00"], [420, "12,000.00"]], [[40, "Total"], [300, "10,000.00"], [420, "12,000.00"]],
    [[40, "PPFAS Mutual Fund"]],
    [[40, "Folio No: 1234567 / 0"], [200, "PAN: ABCDE1234F"], [320, "KYC: OK PAN: OK"]],
    [[40, "Parag Parikh Flexi Cap Fund Direct Plan Growth"]],
    [[40, "ISIN: INF879O01027(Advisor: DIRECT) Registrar : CAMS"]],
    [[40, "Opening Unit Balance: 0.000"]],
    [[40, "Date"], [110, "Transaction"], [300, "Amount"], [360, "Units"], [420, "Price"], [480, "Unit"]],
    [[300, "(INR)"], [420, "(INR)"], [480, "Balance"]],
    [[40, "05-Apr-2024"], [110, "Purchase - via Internet"], [300, "10,000.00"], [360, "125.000"], [420, "80.0000"], [480, "125.000"]],
    [[40, "Closing Unit Balance: 125.000"], [200, "NAV on 31-Dec-2024: INR 96.0000"], [340, "Total Cost Value: 10,000.00"], [460, "Market Value on 31-Dec-2024: INR 12,000.00"]],
  ];
  const without = parseCasDocument(doc([rows]), "ppfas.pdf");
  eq(without.holdings[0].isin, "INF879O01027");
  eq(without.integrity.warnings.some((w) => /could not be read/.test(w)), !without.holdings[0].schemeName);
  const amfi = (isin) => (isin === "INF879O01027" ? "Parag Parikh Flexi Cap Fund - Direct Plan - Growth" : null);
  const filled = parseCasDocument(doc([rows]), "ppfas.pdf", { nameByIsin: amfi });
  eq(Boolean(filled.holdings[0].schemeName), true);
  eq(filled.integrity.warnings.some((w) => /could not be read/.test(w)), false);
  if (!without.holdings[0].schemeName) eq(filled.holdings[0].nameSource, "amfi");
  // a name read from the statement is never replaced
  eq(parseCasDocument(camsDoc, "cams.pdf", { nameByIsin: () => "WRONG" }).holdings[0].schemeName.includes("Axis ELSS"), true);
});
test("CAMS: one scheme with years of SIPs — Closing Unit Balance only on page 5 — is still CAMS_KFINTECH", () => {
  const row = (text) => [[40, text]];
  const filler = (n) => Array.from({ length: 30 }, (_, i) => row(`15-Jan-20${10 + n} Purchase - Systematic - Instalment ${n * 30 + i} 2,000.00 17.166 116.5102 ${i}.000`));
  const long = doc([
    [row("Consolidated Account Statement"), row("Folio No: 14364484 / 0 PAN: ABCDE1234F"), row("Opening Unit Balance: 0.000"), ...filler(0)],
    filler(1), filler(2), filler(3),
    [...filler(4), row("Closing Unit Balance: 2,931.402 NAV on 24-Oct-2026: INR 319.5329")],
  ]);
  eq(detectFormat(long), CAS_FORMAT.CAMS_KFINTECH);
  eq(detectFormat(doc([[row("Consolidated Account Statement"), row("Some other document")]])), CAS_FORMAT.UNSUPPORTED);
});

test("CAMS: holding read exactly as printed", () => {
  const p = parseCasDocument(camsDoc, "cams.pdf");
  eq(p.holdings.length, 1);
  const h = p.holdings[0];
  eq(h.isin, "INF846K01EW2");
  eq(h.schemeName, "Axis ELSS Tax Saver Fund - Direct Growth");
  eq(h.rtaSchemeCode, "G");
  eq(h.amc, "Axis Mutual Fund");
  eq(h.folio, "9104567 / 0");
  eq(h.pan, "ABCDE1234F");
  eq(h.registrar, "KFINTECH");
  eq([h.units, h.nav, h.costValue, h.marketValue], [125, 96, 10000, 12000]);
  eq(h.raw.nav, "96.0000");
  eq(h.navDate, "2024-12-31");
  eq(h.transactions.length, 3);
  eq(h.transactions[1].raw, { amount: "0.30", units: null, price: null, unitBalance: null });
  eq(h.transactions[2].units, 50);
});

test("CAMS: investor + statement header", () => {
  const p = parseCasDocument(camsDoc, "cams.pdf");
  eq(p.investor.name, "RAHUL SHARMA");
  eq(p.investor.email, "investor@example.com");
  eq(p.investor.pans, ["ABCDE1234F"]);
  eq(p.source.statementPeriod, { from: "2024-04-01", to: "2024-12-31" });
  eq(p.printedTotals.totalMarketValue, 12000);
});

test("CAMS: integrity passes", () => {
  const p = parseCasDocument(camsDoc, "cams.pdf");
  eq(p.integrity.status, "ok", p.integrity.warnings.join(" | "));
  eq(p.holdings[0].flags, []);
});

test("CAMS: a misread value is flagged, never fixed", () => {
  const tampered = structuredClone(camsDoc);
  const closing = tampered.pages[0].rows.at(-1);
  closing.cells[3].str = "Market Value on 31-Dec-2024: INR 12,900.00";
  closing.text = closing.cells.map((c) => c.str).join(" ");
  const p = parseCasDocument(tampered, "cams.pdf");
  eq(p.holdings[0].marketValue, 12900);
  eq(p.holdings[0].flags.includes(FLAG.UNITS_NAV_VALUE_MISMATCH), true);
  eq(p.integrity.status, "needs_review");
  eq(p.integrity.checks.find((c) => c.name === "TOTAL_MARKET_RECONCILES").passed, false);
});

test("CAMS: summary figures", () => {
  const s = summarizePortfolio(parseCasDocument(camsDoc, "cams.pdf"));
  eq([s.totalMarketValue, s.totalCostValue, s.unrealisedGain, s.activeCount], [12000, 10000, 2000, 1]);
});

// ---------- NSDL ----------

test("NSDL: detected as NSDL even though CDSL is mentioned", () => eq(detectFormat(nsdlDoc), CAS_FORMAT.NSDL));

test("NSDL: MF rows read by column band; equities excluded and reported", () => {
  const p = parseCasDocument(nsdlDoc, "nsdl.pdf");
  eq(p.holdings.map((h) => h.isin), ["INF846K01EW2", "INF179K01VQ4"]);
  eq(p.holdings[0].schemeName, "AXIS ELSS TAX SAVER FUND - DIRECT GROWTH");
  eq(p.holdings[0].folio, "9104567");
  eq([p.holdings[1].units, p.holdings[1].nav, p.holdings[1].costValue, p.holdings[1].marketValue], [10, 1800, 15000, 18000]);
  eq(p.investor.name, "RAHUL SHARMA");
  eq(p.investor.pan, "ABCDE1234F");
  eq(p.integrity.warnings.some((w) => w.includes("other investment")), true);
});

test("NSDL: reconciles against the MF table subtotal, not the grand total", () => {
  const p = parseCasDocument(nsdlDoc, "nsdl.pdf");
  eq(p.printedTotals.totalMarketValue, 30000);
  eq(p.printedTotals.totalCostValue, 25000);
  eq(p.integrity.status, "ok", p.integrity.warnings.join(" | "));
});

test("Unsupported document throws UNSUPPORTED_FORMAT", () => {
  try {
    parseCasDocument(doc([[[[40, "Hello world"]]]]), "x.pdf");
    throw new Error("did not throw");
  } catch (error) {
    eq(error.code, "UNSUPPORTED_FORMAT");
  }
});

test("Deterministic output", () => {
  eq(JSON.stringify(parseCasDocument(camsDoc, "a.pdf")), JSON.stringify(parseCasDocument(camsDoc, "a.pdf")));
});

// ---------- client title ----------
test("Title printed before the name is captured; name stays as printed", () => {
  const titled = structuredClone(camsDoc);
  const nameRow = titled.pages[0].rows[3];
  nameRow.cells[0].str = "MR RAHUL SHARMA";
  nameRow.text = "MR RAHUL SHARMA";
  const p = parseCasDocument(titled, "cams.pdf");
  eq([p.investor.title, p.investor.name], ["MR", "RAHUL SHARMA"]);
});
test("No title printed → none is invented", () => {
  const p = parseCasDocument(camsDoc, "cams.pdf");
  eq([p.investor.title, p.investor.name], [null, "RAHUL SHARMA"]);
});
test("A name merely starting with title letters is not split", () => {
  const titled = structuredClone(camsDoc);
  const nameRow = titled.pages[0].rows[3];
  nameRow.cells[0].str = "MRINAL SEN";
  nameRow.text = "MRINAL SEN";
  const p = parseCasDocument(titled, "cams.pdf");
  eq([p.investor.title, p.investor.name], [null, "MRINAL SEN"]);
});

// ---------- client name: different header layouts ----------
function withRows(base, edit) {
  const copy = structuredClone(base);
  edit(copy.pages[0].rows);
  for (const row of copy.pages[0].rows) row.text = row.cells.map((c) => c.str).join(" ");
  return copy;
}
const cell = (x, str) => ({ x, right: x + str.length * 4.5, str });

test("Name: two-column CAMS header (right column text on the same lines)", () => {
  const doc2 = withRows(camsDoc, (rows) => {
    rows[2].cells.push(cell(330, "This Consolidated Account Statement is brought to you"));
    rows[3].cells.push(cell(330, "as an investor friendly initiative by CAMS"));
  });
  eq(parseCasDocument(doc2, "x.pdf").investor.name, "RAHUL SHARMA");
});
test("Name: real CAMS layout — right-column prose rows between email and name", () => {
  const doc2 = withRows(camsDoc, (rows) => {
    rows[2].cells = [cell(35, "Email Id: kavita@example.com"), cell(360, "This Consolidated Account Statement is an investor")];
    rows[3].cells = [cell(35, "KAVITA ARUN DESAI"), cell(306, "balances"), cell(342, "and"), cell(360, "valuation")];
    // a right-column-only row inserted between the email and the name
    rows.splice(3, 0, { y: 0, height: 9, text: "", cells: [cell(360, "friendly initiative"), cell(574, "by"), cell(588, "CAMS")] });
  });
  eq(parseCasDocument(doc2, "x.pdf").investor.name, "KAVITA ARUN DESAI");
});
test("Name: labelled field 'Name : …'", () => {
  const doc2 = withRows(camsDoc, (rows) => {
    rows[2].cells = [cell(40, "Name : SUNITA RAO")];
    rows[3].cells = [cell(40, "Mobile: +919999999999")];
  });
  eq(parseCasDocument(doc2, "x.pdf").investor.name, "SUNITA RAO");
});
test("Name: label and value in separate cells", () => {
  const doc2 = withRows(camsDoc, (rows) => {
    rows[2].cells = [cell(40, "Investor Name:"), cell(160, "ANIL GUPTA")];
    rows[3].cells = [cell(40, "Mobile: +919999999999")];
  });
  eq(parseCasDocument(doc2, "x.pdf").investor.name, "ANIL GUPTA");
});
test("Name: falls back to the holder line under the first folio", () => {
  const doc2 = withRows(camsDoc, (rows) => {
    rows[3].cells = [cell(40, "Mobile: +919999999999")];
  });
  eq(parseCasDocument(doc2, "x.pdf").investor.name, "RAHUL SHARMA");
});
test("Name: NSDL 'Sole / First Holder' label", () => {
  const doc2 = withRows(nsdlDoc, (rows) => {
    rows[3].cells = [cell(40, "Sole / First Holder :"), cell(150, "MEERA IYER"), cell(300, "PAN : ABCDE1234F")];
  });
  eq(parseCasDocument(doc2, "x.pdf").investor.name, "MEERA IYER");
});

// ---------- one-pager snapshot ----------
test("Snapshot: every active holding listed (no 'Other' row); weights and totals match the sample", () => {
  const s = buildSnapshot(samplePortfolio(), SAMPLE_FUND_DATA);
  eq(s.holdings.rows.length, 13);
  eq(s.holdings.other, null);
  eq(s.holdings.rows.slice(0, 6).map((r) => r.weightPct.toFixed(2)), ["21.89", "19.05", "17.22", "9.98", "8.72", "6.16"]);
  // The 7 smaller funds add up to what the sample shows as "Other holdings".
  const rest = s.holdings.rows.slice(6);
  eq(rest.reduce((sum, r) => sum + r.weightPct, 0).toFixed(2), "16.98");
  eq([rest.reduce((sum, r) => sum + r.invested, 0), rest.reduce((sum, r) => sum + r.current, 0)], [104650, 96943]);
  eq([s.totals.invested, s.totals.value, s.totals.gain], [572050, 570982, -1068]);
  eq(s.totals.gainPct.toFixed(2), "-0.19");
  eq([s.fundCount, s.amcCount], [13, 6]);
});
test("Snapshot: average edge = mean of (portfolio − benchmark)", () => {
  const s = buildSnapshot(samplePortfolio(), SAMPLE_FUND_DATA);
  eq(s.averageEdge.toFixed(4), (((4.4 + 5.7) + (19.3 - 10.5) + (15.6 - 8.8)) / 3).toFixed(4));
});
test("Snapshot: without fund data, analytics are null — never estimated", () => {
  const s = buildSnapshot(samplePortfolio(), null);
  eq([s.composition, s.sectors, s.marketCap, s.trailingReturns, s.averageEdge, s.risk], [null, null, null, null, null, null]);
});
test("Snapshot: redeemed (zero-unit) holdings are never listed", () => {
  const p = samplePortfolio();
  p.holdings[0] = { ...p.holdings[0], status: "redeemed" };
  const s = buildSnapshot(p, null);
  eq([s.holdings.rows.length, s.fundCount], [12, 12]);
  eq(s.holdings.rows.some((r) => r.isin === p.holdings[0].isin && r.name === p.holdings[0].schemeName), false);
});
test("Snapshot: topN option still folds the rest into 'Other holdings'", () => {
  const s = buildSnapshot(samplePortfolio(), null, { topN: 6 });
  eq([s.holdings.rows.length, s.holdings.otherCount], [6, 7]);
});

// ---------- CAMS: wrapped ISIN / name, per-AMC reconciliation (real-statement regression) ----------
function wrappedCamsDoc({ splitIsin = true } = {}) {
  return doc([[
    [[160, "Consolidated Account Statement"]],
    [[240, "01-Jan-1970 To 16-Oct-2026"]],
    [[35, "Email Id: a@b.in"]],
    [[35, "TEST INVESTOR"]],
    [[254, "PORTFOLIO SUMMARY"]],
    [[278, "Cost Value"], [454, "Market Value"]],
    [[41, "HSBC Mutual Fund"], [281, "680,611.00"], [461, "980,342.25"]],
    [[41, "HDFC Mutual Fund"], [282, "50,000.00"], [462, "65,816.42"]],
    [[110, "Total"], [279, "730,611.00"], [461, "1,046,158.67"]],
    [[29, "HSBC Mutual Fund"]],
    [[29, "Folio No: 1234567 / 89"], [348, "PAN: ABCPE1234F"]],
    [[29, "Test Investor"]],
    splitIsin
      ? [[29, "OLEBDG-HSBC Small Cap Fund - Direct Growth (Demat) - ISIN: INF917K01QA"], [514, "Registrar : CAMS"]]
      : [[29, "OLEBDG-HSBC Small Cap Fund - Direct Growth (Demat) - ISIN: INF917K01QA1(Advisor: X)"], [514, "Registrar : CAMS"]],
    ...(splitIsin ? [[[29, "1(Advisor: INZ000031633)"]]] : []),
    [[477, "Opening Unit Balance: 0.000"]],
    [[29, "Closing Unit Balance: 7,000.000"], [164, "NAV on 15-Oct-2026: INR 140.04889"], [291, "Total Cost Value: 680,611.00"], [443, "Market Value on 15-Oct-2026: INR 980,342.25"]],
    [[29, "HDFC Mutual Fund"]],
    [[29, "Folio No: 123 / 4"], [348, "PAN: ABCPE1234F"]],
    [[29, "Test Investor"]],
    [[29, "XYZ-HDFC Balanced Advantage Fund - Regular Plan - Growth (formerly HDFC Growth Fund) (Non"], [514, "Registrar : CAMS"]],
    [[29, "-Demat) - ISIN: INF179K01830(Advisor: ARN-1)"]],
    [[477, "Opening Unit Balance: 0.000"]],
    [[29, "Closing Unit Balance: 129.787"], [164, "NAV on 15-Oct-2026: INR 507.111"], [291, "Total Cost Value: 50,000.00"], [443, "Market Value on 15-Oct-2026: INR 65,816.42"]],
  ]]);
}

test("CAMS: an ISIN split across two lines is rejoined (check digit verified); no fund is missed", () => {
  const p = parseCasDocument(wrappedCamsDoc(), "x.pdf");
  eq(p.holdings.map((h) => h.isin), ["INF917K01QA1", "INF179K01830"]);
  eq(p.holdings[0].raw.marketValue, "980,342.25");
  eq(p.integrity.status, "ok");
});
test("CAMS: 'ISIN:' ends the line before the Registrar cell, code on the next line → the fund is read (real-statement regression)", () => {
  const d = doc([[
    [[160, "Consolidated Account Statement"]],
    [[240, "01-Jan-1970 To 19-Oct-2026"]],
    [[35, "Email Id: a@b.in"]],
    [[35, "TEST INVESTOR"]],
    [[254, "PORTFOLIO SUMMARY"]],
    [[278, "Cost Value"], [454, "Market Value"]],
    [[41, "HDFC Mutual Fund"], [281, "386,000.00"], [461, "409,153.56"]],
    [[110, "Total"], [279, "386,000.00"], [458, "409,153.56"]],
    [[29, "HDFC Mutual Fund"]],
    [[29, "Folio No: 22596134 / 48"], [351, "PAN: ABCPE1234F"]],
    [[29, "Test Investor"]],
    [[29, "HACG1G-HDFC Small Cap Fund - Direct Growth Plan (Demat) - ISIN: INF179KA1RW5(Advisor: INZ000031633)"], [514, "Registrar : CAMS"]],
    [[477, "Opening Unit Balance: 0.000"]],
    [[29, "Closing Unit Balance: 1,476.044"], [164, "NAV on 16-Oct-2026: INR 155.056"], [291, "Total Cost Value: 211,000.00"], [421, "Market Value on 16-Oct-2026: INR 228,869.48"]],
    [[29, "Folio No: 22596134 / 48"], [351, "PAN: ABCPE1234F"]],
    [[29, "Test Investor"]],
    [[29, "HINSPT-HDFC BSE Sensex Index Fund - Direct Plan - Growth Option (erstwhile HDFC Index Fund - Sensex Plus Plan merged) (Demat) - ISIN:"], [514, "Registrar : CAMS"]],
    [[29, "INF179K01WN9(Advisor: INZ000031633)"]],
    [[477, "Opening Unit Balance: 0.000"]],
    [[29, "Closing Unit Balance: 251.962"], [164, "NAV on 16-Oct-2026: INR 715.5209"], [291, "Total Cost Value: 175,000.00"], [421, "Market Value on 16-Oct-2026: INR 180,284.08"]],
  ]]);
  const p = parseCasDocument(d, "x.pdf");
  eq(p.holdings.map((h) => h.isin), ["INF179KA1RW5", "INF179K01WN9"]);
  eq([p.holdings[1].schemeName, p.holdings[1].registrar, p.holdings[1].raw.marketValue, p.holdings[1].folio],
    ["HDFC BSE Sensex Index Fund - Direct Plan - Growth Option (erstwhile HDFC Index Fund - Sensex Plus Plan merged) (Demat)", "CAMS", "180,284.08", "22596134 / 48"]);
  eq(p.integrity.status, "ok");
});
test("CAMS: a scheme name wrapped before the ISIN line is read in full", () => {
  const p = parseCasDocument(wrappedCamsDoc(), "x.pdf");
  eq(p.holdings[1].schemeName, "HDFC Balanced Advantage Fund - Regular Plan - Growth (formerly HDFC Growth Fund) (Non-Demat)");
  eq(p.holdings[0].schemeName, "HSBC Small Cap Fund - Direct Growth (Demat)");
});
test("CAMS: per fund house check names the fund house when a fund is not read", () => {
  // Simulate the old failure: drop the HSBC fund after parsing and re-validate.
  const p = parseCasDocument(wrappedCamsDoc(), "x.pdf");
  const amcProblems = (portfolio) => portfolio.integrity.checks.find((c) => c.name === "AMC_TOTALS_RECONCILE");
  eq(amcProblems(p).passed, true);
  const broken = doc([wrappedCamsDoc().pages[0].rows.filter((row) => !/INF917K01QA|^1\(Advisor/.test(row.text)).map((row) => row.cells.map((c) => [c.x, c.str]))]);
  const q = parseCasDocument(broken, "x.pdf");
  eq(q.integrity.status, "needs_review");
  eq(amcProblems(q).problems.length, 1);
  eq(amcProblems(q).problems[0].startsWith("HSBC Mutual Fund: the statement's summary shows ₹9,80,342.25 (cost ₹6,80,611.00), but no fund from this fund house could be read"), true);
});

// ---------- report profile: diversification, risk profile, horizon ----------
/** Portfolio from [schemeName, currentValue (printed string), isin?] rows. */
function profilePortfolio(rows) {
  const portfolio = createPortfolio("CAMS_KFINTECH", "t.pdf");
  rows.forEach(([name, value, isin], i) => {
    const holding = createHolding();
    Object.assign(holding, { schemeName: name, isin: isin ?? `INF000TEST${String(i).padStart(2, "0")}`, folio: String(i), status: "active" });
    holding.raw.marketValue = value;
    portfolio.holdings.push(holding);
  });
  return portfolio;
}

test("Fund category: read from the scheme name only when it is plain", () => {
  const cases = [
    ["Parag Parikh Flexi Cap Fund Direct Plan Growth", "equity"],
    ["SBI Banking & Financial Services Fund Direct Plan Growth", "equity"],
    ["UTI Nifty 50 Index Fund Direct Growth", "equity"],
    ["Motilal Oswal Nifty Midcap 150 Index Fund", "equity"], // SEBI "Index Funds"
    ["Axis Long Term Equity Fund", "equity"],
    ["Mirae Asset Large & Midcap Fund", "equity"],
    ["SBI Contra Fund Direct Growth", "equity"],
    ["Axis Midcap Fund", "midCap"],
    ["Quant Small Cap Fund Direct Plan Growth", "smallCap"],
    ["HDFC Gold ETF Fund of Fund Direct Plan Growth Option", "goldSilver"],
    ["HDFC Silver ETF Fund of Fund Direct Plan Growth", "goldSilver"],
    ["ICICI Prudential Gilt Fund Direct Plan Growth", "gilt"],
    ["SBI Magnum Constant Maturity Fund", "gilt"],
    ["Nippon India Banking & PSU Debt Fund", "bankingPsu"],
    ["HDFC Corporate Bond Fund", "corporateBond"],
    ["Aditya Birla Sun Life Medium Term Plan", "mediumDuration"],
    ["ICICI Prudential Medium to Long Duration Fund", "mediumToLong"],
    ["Axis Ultra Short Term Fund", "ultraShort"],
    ["HDFC Short Term Debt Fund", "shortDuration"],
    ["Nippon India ETF Nifty 1D Rate Liquid BeES", "liquid"],
    ["HDFC Overnight Fund", "overnight"],
    ["Kotak Equity Arbitrage Fund", "arbitrage"],
    ["Kotak Debt Hybrid Fund", "conservativeHybrid"],
    ["HDFC Balanced Advantage Fund", "balancedAdvantage"],
    ["ICICI Prudential Equity & Debt Fund", "aggressiveHybrid"],
    ["SBI Equity Hybrid Fund", "aggressiveHybrid"],
    ["ICICI Prudential Multi-Asset Fund", "multiAsset"],
    ["HDFC Equity Savings Fund", "equitySavings"],
    // Ambiguous or not in the logic tables → never guessed.
    ["Kotak Emerging Equity Fund", null],
    ["Nippon India Growth Fund", null],
    ["Bharat Bond ETF April 2030", null],
    ["ICICI Prudential Nifty PSU Bond Plus SDL 40:60 Index Fund", null],
    ["Motilal Oswal Nasdaq 100 Fund of Fund", null],
    ["ICICI Prudential Commodities Fund", null],
    ["Tata Retirement Savings Fund", null],
  ];
  for (const [name, expected] of cases) eq(categoryFromText(name), expected, name);
});

test("Diversification: ideal range by value and status rules (spec form)", () => {
  const d = (numFunds, portfolioValue, fundValues) => diversificationStatus({ numFunds, portfolioValue, fundValues });
  eq(d(1, 100000).status, "Concentrated");
  eq(d(2, 100000, [50000, 50000]).status, "Concentrated", "a fund at exactly 50%");
  eq(d(3, 499999.99, [200000, 150000, 149999.99]).range, { min: 2, max: 4, band: "< ₹5L" });
  eq(d(3, 500000, [200000, 150000, 150000]), { status: "Well Diversified", range: { min: 3, max: 6, band: "₹5L–₹25L" } });
  eq(d(3, 2500000, [1000000, 800000, 700000]), { status: "Under Diversified", range: { min: 4, max: 8, band: "₹25L–₹1Cr" } });
  eq(d(5, 10000000).range.band, "₹1Cr–₹5Cr", "₹1Cr exactly");
  eq(d(5, 50000000).range.band, "₹1Cr–₹5Cr", "₹5Cr exactly");
  eq(d(5, 50000000.01).range, { min: 6, max: 13, band: "> ₹5Cr" });
  eq(d(7, 500000, Array(7).fill(500000 / 7)).status, "Over Diversified");
  eq(d(6, 500000, Array(6).fill(500000 / 6)).status, "Well Diversified", "6 funds is within 3–6");
});

test("Risk profile: value-weighted equity %, exact band edges", () => {
  const risk = (rows) => buildReportProfile(profilePortfolio(rows)).risk;
  eq(risk([["HDFC Flexi Cap Fund", "100.00"]]), { label: "Aggressive", equityPct: 100, unclassified: [], others: [], othersPct: 0 });
  eq(risk([["HDFC Flexi Cap Fund", "80.00"], ["HDFC Liquid Fund", "20.00"]]).label, "Aggressive", "exactly 80%");
  eq(risk([["HDFC Flexi Cap Fund", "79.99"], ["HDFC Liquid Fund", "20.01"]]).label, "Moderately Aggressive");
  eq(risk([["SBI Equity Hybrid Fund", "100.00"]]).equityPct, 70);
  eq(risk([["ICICI Prudential Multi-Asset Fund", "100.00"]]).label, "Moderate", "40% = Moderate");
  eq(risk([["HDFC Gold ETF Fund of Fund", "100.00"]]).label, "Moderately Conservative", "gold 30%");
  eq(risk([["HDFC Flexi Cap Fund", "20.00"], ["HDFC Liquid Fund", "80.00"]]).label, "Moderately Conservative", "exactly 20%");
  eq(risk([["Kotak Equity Arbitrage Fund", "100.00"]]), { label: "Conservative", equityPct: 0, unclassified: [], others: [], othersPct: 0 });
});

test("Horizon: value-weighted years, exact band edges", () => {
  const horizon = (rows) => buildReportProfile(profilePortfolio(rows)).horizon;
  eq(horizon([["HDFC Liquid Fund", "100.00"]]), { label: "Short Term", years: 0.25, unclassified: [], others: [], othersPct: 0 });
  eq(horizon([["HDFC Liquid Fund", "400.00"], ["HDFC Short Term Debt Fund", "300.00"]]), { label: "Mid Term", years: 1, unclassified: [], others: [], othersPct: 0 });
  eq(horizon([["HDFC Equity Savings Fund", "100.00"], ["ABSL Medium Term Plan", "100.00"]]).label, "Mid to Long Term", "exactly 3 yrs");
  eq(horizon([["SBI Equity Hybrid Fund", "100.00"]]).label, "Long Term", "exactly 5 yrs");
  eq(horizon([["Quant Small Cap Fund", "100.00"]]).years, 10);
  eq(horizon([["Axis Midcap Fund", "100.00"]]).years, 8);
});

test("Report profile: sample portfolio (by scheme name and by fund data agree)", () => {
  for (const fundData of [null, SAMPLE_FUND_DATA]) {
    const p = buildReportProfile(samplePortfolio(), fundData);
    eq([p.diversification.status, p.diversification.numFunds, p.diversification.range.min, p.diversification.range.max], ["Over Diversified", 13, 3, 6]);
    eq([p.risk.label, p.risk.equityPct], ["Aggressive", 89.79]); // (4,88,956 + 0.3 × 79,172) / 5,70,982
    eq([p.horizon.label, p.horizon.years], ["Long Term", 6.69]); // 38,20,923 / 5,70,982
  }
});

test("Report profile: funds outside the logic tables are 'Others' — named, not counted, never given a factor", () => {
  const p = buildReportProfile(profilePortfolio([["HDFC Flexi Cap Fund", "60.00"], ["HDFC Liquid Fund", "20.00"],
    ["Aditya Birla Sun Life US Treasury 3-10 Year Bonds ETFs Passive FOF", "20.00"]]));
  eq([p.risk.label, p.risk.equityPct], ["Moderately Aggressive", 75]);   // 60 / 80 counted
  eq([p.horizon.years], [5.31]);                                                                                                   // (60×7 + 20×0.25) / 80
  eq([p.risk.others, p.risk.othersPct, p.risk.unclassified], [[{ name: "Aditya Birla Sun Life US Treasury 3-10 Year Bonds ETFs Passive FOF", sharePct: 20,
    reason: "International / overseas fund — not in the Risk / Horizon tables" }], 20, []]);
  eq(p.diversification.numFunds, 3, "diversification counts every fund");
  const allOthers = buildReportProfile(profilePortfolio([["Motilal Oswal Nasdaq 100 Fund of Fund", "100.00"]]));
  eq([allOthers.risk.label, allOthers.horizon.label, allOthers.risk.othersPct], [null, null, 100]);
});
test("Fund category: the AMFI category is read with the name (a G-Sec index fund is not equity)", () => {
  const holding = (schemeName) => ({ schemeName });
  eq(classifyFund(holding("HDFC Nifty G-Sec July 2031 Index Fund"), { category: "Index Funds" }).category, FUND_CATEGORY.OTHERS);
  eq(classifyFund(holding("UTI Nifty 50 Index Fund"), { category: "Index Funds" }).category, FUND_CATEGORY.EQUITY);
  eq(classifyFund(holding("Kotak Emerging Equity Fund"), { category: "Mid Cap Fund" }).category, FUND_CATEGORY.MID_CAP);
  eq(classifyFund(holding("Kotak Emerging Equity Fund"), null), { category: FUND_CATEGORY.OTHERS, source: "not in the logic tables",
    reason: "Category not known (no AMFI data, and the name does not state it)" });
  eq(classifyFund(holding("HDFC Nifty G-Sec July 2031 Index Fund"), { category: "Index Funds" }).reason, "Debt index, target-maturity, ETF or fund-of-funds — not in the Risk / Horizon tables");
  eq(classifyFund(holding("Nippon India US Equity Opportunities Fund"), { category: "Thematic Fund" }).category, FUND_CATEGORY.EQUITY);   // SEBI category decides
  eq(classifyFund(holding("Aditya Birla Sun Life US Treasury 3-10 Year Bonds ETFs Passive FOF"), { category: "FoF Overseas" }).category, FUND_CATEGORY.OTHERS);
  eq(classifyFund(holding("HDFC Gold ETF Fund of Fund"), { category: "FoF Domestic" }).category, FUND_CATEGORY.GOLD_SILVER);
});

test("Report profile: same ISIN in two folios is one fund; redeemed funds are left out", () => {
  const portfolio = profilePortfolio([["HDFC Flexi Cap Fund", "30.00", "INF179K01VQ4"], ["HDFC Flexi Cap Fund", "30.00", "INF179K01VQ4"], ["HDFC Liquid Fund", "40.00"], ["SBI Small Cap Fund", "10.00"]]);
  portfolio.holdings[3].status = "redeemed";
  const p = buildReportProfile(portfolio);
  eq([p.diversification.numFunds, p.diversification.status], [2, "Concentrated"]); // Flexi Cap = 60% across two folios
  eq(p.risk.equityPct, 60);
});

// ---------- detailed report model ----------
test("Detailed report: a fund held in two folios counts as one fund in the Invest / Hold / Sell tiles", () => {
  const p = samplePortfolio();
  const first = p.holdings.find((h) => h.status === "active");
  p.holdings.push({ ...structuredClone(first), folio: "7654321" });
  const verdicts = Object.fromEntries(p.holdings.filter((h) => h.status === "active").map((h) => [holdingKey(h), "hold"]));
  const m = buildDetailedReport({ portfolio: p, fundData: SAMPLE_FUND_DATA, verdicts });
  const distinct = new Set(p.holdings.filter((h) => h.status === "active").map((h) => h.isin)).size;
  eq(m.verdictSummary.hold.count, distinct);
});
test("Detailed report: Fund Performance lists a fund once when it is held in several folios (Holdings still lists each folio)", () => {
  const p = samplePortfolio();
  const first = p.holdings.find((h) => h.status === "active" && SAMPLE_FUND_DATA.funds[h.isin]?.assetClass === "equity");
  p.holdings.push({ ...structuredClone(first), folio: "7654321" }, { ...structuredClone(first), folio: "1111111" });
  const m = buildDetailedReport({ portfolio: p, fundData: SAMPLE_FUND_DATA, verdicts: {} });
  const perf = m.performance.flatMap((g) => g.rows).filter((r) => r.isin === first.isin);
  const held = m.holdings.groups.flatMap((g) => g.rows).filter((r) => r.isin === first.isin);
  eq([perf.length, held.length], [1, 3]);
  const isins = m.performance.flatMap((g) => g.rows.map((r) => r.isin));
  eq(isins.length, new Set(isins).size, "no ISIN twice");
});
test("Detailed report: fund-wise market cap lists a scheme once — Regular + Direct + extra folio = one row, plan-neutral name", () => {
  const p = samplePortfolio();
  const fundData = structuredClone(SAMPLE_FUND_DATA);
  const regular = p.holdings.find((h) => h.status === "active" && fundData.funds[h.isin]?.assetClass === "equity" && fundData.funds[h.isin]?.marketCap
    && !/index|etf/i.test(`${fundData.funds[h.isin].category ?? ""} ${h.schemeName}`));
  regular.schemeName = "Alpha Large Cap Fund - Regular Plan - Growth (Non-Demat)";
  const direct = { ...structuredClone(regular), isin: "INF000Z01AA1", folio: "999", schemeName: "Alpha Large Cap Fund - Direct Plan - Growth (Demat)" };
  fundData.funds[direct.isin] = { ...fundData.funds[regular.isin], plan: "Direct" };
  p.holdings.push(direct, { ...structuredClone(regular), folio: "555" });
  const m = buildDetailedReport({ portfolio: p, fundData, verdicts: {} });
  const alpha = m.marketCapByFund.rows.filter((r) => /Alpha Large Cap/.test(r.name));
  eq(alpha.map((r) => r.name), ["Alpha Large Cap Fund"]);
  const perf = m.performance.flatMap((g) => g.rows).filter((r) => /Alpha Large Cap/.test(r.name));
  eq(perf.length, 2, "Fund Performance keeps Regular and Direct apart");
});
test("Detailed report: Portfolio Overlap applies only with two or more different funds (one fund in two folios = one fund)", () => {
  const many = buildDetailedReport({ portfolio: samplePortfolio(), fundData: SAMPLE_FUND_DATA, verdicts: {} });
  const p = samplePortfolio();
  const first = p.holdings.find((h) => h.status === "active");
  p.holdings = [first, { ...structuredClone(first), folio: "7654321" }];
  const one = buildDetailedReport({ portfolio: p, fundData: SAMPLE_FUND_DATA, verdicts: {} });
  eq([many.overlapApplies, one.overlapApplies], [true, false]);
});
test("Detailed report: groups by asset class, alphabetical, totals exact", () => {
  const m = buildDetailedReport({ portfolio: samplePortfolio(), fundData: SAMPLE_FUND_DATA, verdicts: {} });
  eq(m.holdings.groups.map((g) => g.key), ["equity", "debt", "goldSilver"]);
  const names = m.holdings.groups[0].rows.map((r) => r.name);
  eq(names, [...names].sort((p, q) => p.localeCompare(q, "en", { sensitivity: "base" })));
  const sum = m.holdings.groups.reduce((s, g) => s + Math.round(g.value * 100), 0);
  eq(sum, 57098200);
  eq(m.holdings.groups.reduce((s, g) => s + g.rows.length, 0), 13);
});
test("Detailed report: Hybrid is its own group (Equity, Hybrid, Debt); Fund Performance leaves out debt funds and ETFs", () => {
  const fundData = structuredClone(SAMPLE_FUND_DATA);
  const equityIsins = Object.keys(fundData.funds).filter((isin) => fundData.funds[isin].assetClass === "equity");
  fundData.funds[equityIsins[0]].assetClass = "hybrid";
  fundData.funds[equityIsins[1]].plan = "ETF";
  const m = buildDetailedReport({ portfolio: samplePortfolio(), fundData, verdicts: {} });
  eq(m.holdings.groups.map((g) => g.key), ["equity", "hybrid", "debt", "goldSilver"]);
  eq(m.performance.map((g) => g.key), ["equity", "hybrid", "goldSilver"]);
  const listed = new Set(m.performance.flatMap((g) => g.rows.map((r) => r.isin)));
  eq(listed.has(equityIsins[1]), false, "ETF not listed");
  eq(m.performance.some((g) => g.rows.some((r) => r.assetClass === "debt")), false, "no debt fund");
  eq(assetGroup({ assetClass: "Hybrid", category: "Arbitrage Fund", schemeName: "Kotak Equity Arbitrage Fund" }), "hybrid");
  eq(assetGroup({ assetClass: "Hybrid", category: "Multi Asset Allocation", schemeName: "X Multi Asset Gold Fund" }), "hybrid");
});
test("Detailed report: the recommended portfolio carries Lumpsum or SIP (default and unknown values = lumpsum)", () => {
  const allocation = allocatePortfolio({ amount: 25000, rows: [{ fundId: "a", name: "Parag Parikh Flexi Cap Fund Direct Plan Growth", isin: "INF879O01027", pct: "100" }] });
  const mode = (m) => buildDetailedReport({ portfolio: samplePortfolio(), fundData: SAMPLE_FUND_DATA, verdicts: {}, allocation: m === undefined ? allocation : { ...allocation, mode: m } }).recommended.mode;
  eq([mode("sip"), mode("lumpsum"), mode(undefined), mode("weekly")], ["sip", "lumpsum", "lumpsum", "lumpsum"]);
});
test("Detailed report: Lumpsum + SIP gives two plans, Lumpsum first, each with its own amount and rows", () => {
  const lump = allocatePortfolio({ amount: 500000, rows: [{ fundId: "a", name: "Parag Parikh Flexi Cap Fund Direct Plan Growth", isin: "INF879O01027", pct: "100" }] });
  const sip = allocatePortfolio({ amount: 20000, rows: [
    { fundId: "a", name: "Parag Parikh Flexi Cap Fund Direct Plan Growth", isin: "INF879O01027", pct: "50" },
    { fundId: "b", name: "Quant Small Cap Fund Direct Plan Growth", isin: "INF966L01689", pct: "50" },
  ] });
  const m = buildDetailedReport({ portfolio: samplePortfolio(), fundData: SAMPLE_FUND_DATA, verdicts: {},
    allocations: [{ ...lump, mode: "lumpsum" }, { ...sip, mode: "sip" }] });
  eq(m.recommendedPlans.map((p) => [p.mode, p.amount, p.rows.length]), [["lumpsum", 500000, 1], ["sip", 20000, 2]]);
  eq(m.recommended.mode, "lumpsum", "first plan is the single-plan view");
  eq(m.recommendedPlans[1].rows.reduce((t, r) => t + r.amount, 0), 20000, "SIP amounts add up to the SIP");
  eq(buildDetailedReport({ portfolio: samplePortfolio(), fundData: SAMPLE_FUND_DATA, verdicts: {}, allocations: null }).recommendedPlans, [], "skipped → no plans");
});
test("Detailed report: blended return only when every fund has the period", () => {
  const allocation = allocatePortfolio({ amount: 100000, rows: [
    { fundId: "a", name: "Parag Parikh Flexi Cap Fund Direct Plan Growth", isin: "INF879O01027", pct: "50" },
    { fundId: "b", name: "Quant Small Cap Fund Direct Plan Growth", isin: "INF966L01689", pct: "50" },
  ] });
  const m = buildDetailedReport({ portfolio: samplePortfolio(), fundData: SAMPLE_FUND_DATA, verdicts: {}, allocation });
  eq(m.recommended.blended.r1y.toFixed(2), ((-5.9 + 12.26) / 2).toFixed(2));
  const partial = allocatePortfolio({ amount: 100000, rows: [
    { fundId: "a", name: "X", isin: "INF879O01027", pct: "50" },
    { fundId: "other", name: "Unknown fund", isin: "", pct: "50" },
  ] });
  eq(buildDetailedReport({ portfolio: samplePortfolio(), fundData: SAMPLE_FUND_DATA, allocation: partial }).recommended.blended.r1y, null);
});
test("Detailed report: without fund data, one ungrouped list and no analytics", () => {
  const m = buildDetailedReport({ portfolio: samplePortfolio(), fundData: null });
  eq([m.holdings.groups.length, m.holdings.groups[0].key, m.marketCapByFund, m.portfolioReturns, m.xirr], [1, null, null, null, null]);
});

// ---------- recommended portfolio ----------
test("Allocation: amounts add up to the amount exactly (thirds)", () => {
  const r = allocatePortfolio({ amount: 1000000, rows: [
    { fundId: "a", name: "A", isin: "", pct: "33.33" },
    { fundId: "b", name: "B", isin: "", pct: "33.33" },
    { fundId: "c", name: "C", isin: "", pct: "33.34" },
  ] });
  eq(r.complete, true, r.issues.map((i) => i.code).join());
  eq(r.rows.map((x) => x.amount), [333300, 333300, 333400]);
  eq(r.allocatedAmount, 1000000);
});
test("Allocation: odd amount distributes leftover paise exactly", () => {
  const r = allocatePortfolio({ amount: 100.01, rows: [
    { fundId: "a", name: "A", isin: "", pct: "33.33" },
    { fundId: "b", name: "B", isin: "", pct: "33.33" },
    { fundId: "c", name: "C", isin: "", pct: "33.34" },
  ] });
  eq(Math.round(r.rows.reduce((s, x) => s + x.amount * 100, 0)), 10001);
  eq(r.allocatedAmount, 100.01);
});
test("Allocation: huge amount stays exact", () => {
  const r = allocatePortfolio({ amount: 98765432109.87, rows: [
    { fundId: "a", name: "A", isin: "", pct: "12.34" },
    { fundId: "b", name: "B", isin: "", pct: "87.66" },
  ] });
  eq(r.allocatedAmount, 98765432109.87);
});
test("Allocation: issues are reported, never auto-fixed", () => {
  const r = allocatePortfolio({ amount: 0, rows: [
    { fundId: "a", name: "A", isin: "INF846K01EW2", pct: "60" },
    { fundId: "other", name: "a", isin: "INF846K01EW2", pct: "50" },
    { fundId: "", name: "", isin: "", pct: "" },
    { fundId: "other", name: "X", isin: "INF846K01EW3", pct: "1.234" },
  ] });
  const codes = r.issues.map((i) => `${i.index}:${i.code}`);
  eq(r.complete, false);
  for (const expected of ["null:AMOUNT_INVALID", "1:DUPLICATE_FUND", "2:NO_FUND", "2:ZERO_PCT", "3:ISIN_INVALID", "3:PCT_INVALID", "null:TOTAL_NOT_100"]) {
    if (!codes.includes(expected)) throw new Error(`missing ${expected} in ${codes.join(",")}`);
  }
});
test("Recommendation summary: counts, values and completeness", () => {
  const p = parseCasDocument(nsdlDoc, "nsdl.pdf");
  const [a, b] = p.holdings;
  const s = summarizeRecommendations(p, { [holdingKey(a)]: "invest" });
  eq([s.complete, s.unset.length, s.byVerdict.invest.count, s.byVerdict.invest.value], [false, 1, 1, 12000]);
  const all = summarizeRecommendations(p, { [holdingKey(a)]: "invest", [holdingKey(b)]: "sell" });
  eq([all.complete, all.byVerdict.sell.value, all.byVerdict.sell.share], [true, 18000, 0.6]);
});

// ---------- scheme map: ISIN → AMFI scheme code (data/schemes/) ----------
const LIST = (plan, schemes) => ({ source: "AMFI", dataAsOf: "2026-10-20", plan, count: schemes.length, schemes });
const SCHEME = (schemeCode, isin, extra = {}) => ({
  schemeCode, schemeName: `Fund ${schemeCode}`, amc: "X Mutual Fund", assetClass: "Equity", category: "Flexi Cap Fund",
  isin, isinReinvest: null, active: true, ...extra,
});
test("Scheme map: ISIN finds the scheme code, plan and category; Regular and Direct stay apart", () => {
  const map = buildSchemeMap([LIST("Regular", [SCHEME(101762, "INF179K01608")]), LIST("Direct", [SCHEME(118955, "INF179K01UT0")]),
    LIST("ETF", [SCHEME(140084, null, { isinReinvest: "INF204KB14I2", assetClass: "Other" })])]);
  eq([map.size, map.dataAsOf], [3, "2026-10-20"]);
  eq([map.byIsin("INF179K01608").schemeCode, map.byIsin("INF179K01608").plan], [101762, "Regular"]);
  eq([map.byIsin("INF179K01UT0").schemeCode, map.byIsin("INF179K01UT0").plan, map.byIsin("INF179K01UT0").matchedOn], [118955, "Direct", "isin"]);
  eq([map.byIsin("INF204KB14I2").schemeCode, map.byIsin("INF204KB14I2").matchedOn], [140084, "isinReinvest"]);
  eq(map.byIsin("INF846K01EW2"), null);
});
test("Scheme map: an ambiguous or malformed list is refused, never half-used", () => {
  const throws = (lists, text) => {
    try { buildSchemeMap(lists); } catch (error) { eq(error.name, "SchemeMapError"); eq(error.message.includes(text), true, error.message); return; }
    throw new Error("expected SchemeMapError");
  };
  throws([LIST("Regular", [SCHEME(1, "INF179K01608")]), LIST("Direct", [SCHEME(2, "INF179K01608")])], "belongs to both 1 and 2");
  throws([LIST("Regular", [SCHEME(1, "INF179K01608"), SCHEME(1, "INF179K01UT0")])], "appears twice");
  throws([LIST("Regular", [SCHEME(1, "INF179K01609")])], "fails the check digit");
  throws([{ ...LIST("Regular", [SCHEME(1, "INF179K01608")]), count: 2 }], "says 2 schemes but holds 1");
  throws([LIST("Retail", [])], "not in the expected format");
});
test("Scheme map: holdings are matched by ISIN only; misses carry a plain reason", () => {
  const map = buildSchemeMap([LIST("Direct", [SCHEME(118955, "INF179K01UT0")])]);
  const holdings = [
    { isin: "INF179K01UT0", schemeName: "Totally different printed name - Direct Growth" },
    { isin: "INF209K01P49", schemeName: "ABSL Digital India Fund - IDCW#-Direct Plan" },
    { isin: "INF846K01EW2", schemeName: "Axis ELSS Tax Saver Fund - Direct Growth" },
    { isin: null, schemeName: "No ISIN Fund" },
  ];
  const { matched, unmatched } = mapHoldings(holdings, map);
  eq(matched.map((m) => m.scheme.schemeCode), [118955]);
  eq(unmatched.map((u) => u.reason), [UNMATCHED_REASON.IDCW_PLAN, UNMATCHED_REASON.NOT_LISTED, UNMATCHED_REASON.NO_ISIN]);
});
test("Scheme map: the shipped AMFI lists load cleanly (Regular, Direct, ETF)", () => {
  const map = buildSchemeMap(SHIPPED_LISTS);
  eq(SHIPPED_LISTS.map((l) => l.plan), ["Regular", "Direct", "ETF"]);
  eq(map.size, SHIPPED_LISTS.reduce((n, l) => n + l.count, 0));
  const ppfas = map.byIsin("INF879O01027");
  eq([ppfas.schemeCode, ppfas.plan, ppfas.category], [122639, "Direct", "Flexi Cap Fund"]);
});

// ---------- current value at the latest NAV ----------
test("Latest NAV: units × NAV is exact to the paisa (matches the statement's own arithmetic)", () => {
  eq(String(multiplyToPaise("4,321.987", "85.6543")), "37019677");       // ₹3,70,196.77 as printed on the fixture
  eq(String(multiplyToPaise("105.000", "96.0000")), "1008000");
  eq(String(multiplyToPaise("0.005", "1.00")), "1");                      // half-up: 0.005 → 1 paisa
  eq(formatPaise(37019677n), "3,70,196.77");
  eq(formatPaise(5n), "0.05");
});
test("Latest NAV: mapped holdings are revalued; statement figures kept; others keep the statement value", () => {
  const p = parseCasDocument(nsdlDoc, "nsdl.pdf");
  const active = p.holdings.filter((x) => x.status === "active");
  const [first, second] = active;
  const map = buildSchemeMap([LIST("Direct", [SCHEME(1, first.isin), SCHEME(2, second.isin)])]);
  const latestNavs = { asOf: "2026-10-21", navs: { 1: { date: "2026-10-21", nav: "120.500000" } } };
  const { portfolio, valuation } = revalueAtLatestNav(p, { schemeMap: map, latestNavs });
  const a = portfolio.holdings.find((x) => x.isin === first.isin && x.status === "active");
  eq([a.navDate, a.raw.nav, a.raw.marketValue], ["2026-10-21", "120.50", formatPaise(multiplyToPaise(first.raw.units, "120.5"))]);
  eq([a.statement.raw.marketValue, a.valuation.source, a.valuation.schemeCode], [first.raw.marketValue, VALUATION_SOURCE.LATEST_NAV, 1]);
  const b = portfolio.holdings.find((x) => x.isin === second.isin && x.status === "active");
  eq([b.raw.marketValue, b.valuation.reason], [second.raw.marketValue, VALUATION_REASON.NO_LATEST_NAV]);
  const older = revalueAtLatestNav({ ...p, holdings: p.holdings.map((x) => ({ ...x, navDate: "2026-10-22" })) },
    { schemeMap: map, latestNavs });
  eq(older.portfolio.holdings.find((x) => x.isin === first.isin).valuation.reason, VALUATION_REASON.STATEMENT_NEWER);
  eq([valuation.asOf, valuation.latest, valuation.statement], ["2026-10-21", 1, active.length - 1]);
  eq(portfolio.valuation, valuation);
  eq(p.holdings.find((x) => x.isin === first.isin).raw.marketValue, first.raw.marketValue);   // input untouched
  // Totals now follow the latest value.
  eq(summarizePortfolio(portfolio).totalMarketValue !== summarizePortfolio(p).totalMarketValue, true);
});

// ---------- returns & risk from NAV history (E1, E2, E12, E15.5.9) ----------
const close = (actual, expected, digits = 2, label = "") => {
  if (actual === null || Math.abs(actual - expected) > 0.5 * 10 ** -digits) throw new Error(`${label} expected ≈${expected}, got ${actual}`);
};
test("E5.1 worked example: trailing 1M (simple, start by NEAREST-PREVIOUS)", () => {
  const s = navSeries([{ date: "2026-06-06", nav: 145 }, { date: "2026-07-08", nav: 150 }]);
  close(trailingReturn(s, { months: 1 }) * 100, 3.45, 2);
  eq(navOn(s, "2026-06-08", "previous"), { date: "2026-06-06", nav: 145 });
});
test("E5.1 worked example: trailing 3Y CAGR on the actual day count (1097 days → +14.44%)", () => {
  const s = navSeries([{ date: "2023-07-07", nav: 100 }, { date: "2026-07-08", nav: 150 }]);
  close(trailingReturn(s, { years: 3 }) * 100, 14.44, 2);
});
test("E1: lookups stop after 10 days; short histories are never extrapolated", () => {
  const s = navSeries([{ date: "2026-01-01", nav: 100 }, { date: "2026-07-08", nav: 150 }]);
  eq(navOn(s, "2026-01-12", "previous"), null);                  // 11 days away
  eq(navOn(s, "2026-01-11", "previous"), { date: "2026-01-01", nav: 100 });
  eq(trailingReturn(s, { years: 3 }), null);                      // launched after T − 3Y
  eq(periodStart("2026-03-31", { months: 1 }), "2026-02-28");
  eq(periodStart("2024-02-29", { years: 1 }), "2023-02-28");
});
test("E12: σ = STDEV.S × √12, Sharpe and Sortino with Rf 6.5%; beta/alpha only with a benchmark", () => {
  const monthly = Array.from({ length: 36 }, (_, i) => (i % 2 ? -0.01 : 0.03));
  const m = riskMetrics({ monthly, cagr3y: 0.12 });
  const sd = Math.sqrt(monthly.reduce((s, r) => s + (r - 0.01) ** 2, 0) / 35) * Math.sqrt(12);
  close(m.stdDev, sd, 10);
  close(m.sharpe, (0.12 - 0.065) / sd, 10);
  const rfm = 1.065 ** (1 / 12) - 1;
  close(m.sortino, (0.12 - 0.065) / (Math.sqrt(monthly.reduce((s, r) => s + Math.min(r - rfm, 0) ** 2, 0) / 36) * Math.sqrt(12)), 10);
  eq([m.beta, m.alpha, m.observations], [null, null, 36]);
  const withBench = riskMetrics({ monthly, cagr3y: 0.12, benchmarkMonthly: monthly.map((r) => r / 2), benchmarkCagr3y: 0.05 });
  close(withBench.beta, 2, 10);
  close(withBench.alpha, 0.12 - (0.065 + 2 * (0.05 - 0.065)), 10);
  eq(riskMetrics({ monthly: monthly.slice(0, 29), cagr3y: 0.1 }), null);   // < 30 observations
  eq(lastCompletedMonthEnd("2026-10-21"), "2026-09-30");
  eq(monthEnds("2026-09-30", 3), ["2026-07-31", "2026-08-31", "2026-09-30"]);
});
test("Portfolio returns: current units looked back; ≥ 80% of value must have data, else —", () => {
  // Daily NAVs for 6 years: fund A grows 1% a month, fund B is flat at 10.
  const days = [];
  for (let t = Date.parse("2020-10-01T00:00:00Z"); t <= Date.parse("2026-10-19T00:00:00Z"); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  const monthsFrom = (d) => (Number(d.slice(0, 4)) - 2020) * 12 + Number(d.slice(5, 7)) - 10 + (Number(d.slice(8)) - 1) / 30;
  const A = navSeries(days.map((d) => ({ date: d, nav: 100 * 1.01 ** monthsFrom(d) })));
  const B = navSeries(days.map((d) => ({ date: d, nav: 10 })));
  const holding = (isin, units, value) => ({ ...createHolding(), isin, status: "active", schemeName: isin, units, raw: { ...createHolding().raw, units: String(units), marketValue: value } });
  const map = buildSchemeMap([LIST("Direct", [SCHEME(1, "INF179K01608"), SCHEME(2, "INF179K01UT0", { assetClass: "Debt", category: "Liquid Fund" })])]);
  const p = { ...createPortfolio("CAMS_KFINTECH", "x"), holdings: [holding("INF179K01608", 10, "2,000.00"), holding("INF179K01UT0", 100, "1,000.00")] };
  const fd = buildFundData({ portfolio: p, schemeMap: map, histories: { 1: A, 2: B } });
  const valueOn = (d) => 10 * navOn(A, d, "previous").nav + 100 * 10;
  const T = "2026-10-19";
  close(fd.trailingReturns[0].portfolio, (valueOn(T) / valueOn(periodStart(T, { months: 12 })) - 1) * 100, 8, "1Y");
  const s3 = periodStart(T, { years: 3 });
  close(fd.trailingReturns[1].portfolio, ((valueOn(T) / valueOn(s3)) ** (365 / daysBetween(s3, T)) - 1) * 100, 8, "3Y");
  eq([fd.asOf, fd.funds.INF179K01608.assetClass, fd.funds.INF179K01UT0.assetClass, fd.funds.INF179K01UT0.returns.r1y], [T, "equity", "debt", 0]);
  close(fd.funds.INF179K01608.returns.r1y, (A.navs.at(-1) / navOn(A, periodStart(T, { months: 12 }), "previous").nav - 1) * 100, 8);
  eq(fd.risk.observations, 36);
  eq(fd.trailingReturns.map((r) => r.benchmark), [null, null, null]);
  // An unmapped holding worth 30% of the portfolio → coverage 70% < 80% → no portfolio figures.
  const thin = { ...p, holdings: [...p.holdings, holding("INF846K01EW2", 1, "1,285.72")] };
  const none = buildFundData({ portfolio: thin, schemeMap: map, histories: { 1: A, 2: B } });
  eq([none.trailingReturns, none.risk, none.coverage], [null, null, { covered: 2, total: 3 }]);
  eq(none.funds.INF179K01608.returns.r1y !== null, true);   // fund-level returns still shown
});

// ---------- XIRR (E15.5.10) ----------
test("XIRR: Excel's documented example (37.34%) and a simple year (10.00%)", () => {
  const excel = [["2008-01-01", -10000], ["2008-03-01", 2750], ["2008-10-30", 4250], ["2009-02-15", 3250], ["2009-04-01", 2750]];
  close(xirr(excel.map(([date, amount]) => ({ date, amount }))), 0.373362535, 8);
  close(xirr([{ date: "2025-01-01", amount: -100 }, { date: "2026-01-01", amount: 110 }]), 0.1, 10);
  eq(xirr([{ date: "2025-01-01", amount: -100 }]), null);
});
test("XIRR cash flows: purchases and stamp duty paid; redemptions (net of STT) and payouts received; tax / reinvest / info lines ignored", () => {
  const tx = (date, description, amount, units) => ({ date, description, amount: amount === null ? null : Number(amount.replace(/[(),]/g, "")) * (amount.startsWith("(") ? -1 : 1), units, raw: { amount } });
  const h = {
    ...createHolding(), isin: "INF179K01608", schemeName: "X", status: "active", openingUnits: 0, navDate: "2026-10-19",
    raw: { ...createHolding().raw, marketValue: "1,20,000.00" },
    transactions: [
      tx("2024-01-10", "Purchase", "99,995.00", 100), tx("2024-01-10", "*** Stamp Duty ***", "5.00", null),
      tx("2025-06-01", "Redemption , less STT", "(10,000.00)", -8), tx("2025-06-01", "*** STT Paid ***", "0.10", null),
      tx("2025-07-01", "***IDCW Payout @ Rs.1 per unit***", "92.00", null), tx("2025-08-01", "IDCW Reinvestment", "50.00", 0.05),
      tx("2025-09-01", "***Address Updated from KRA Data***", null, null),
    ],
  };
  eq(holdingCashflows(h).flows, [
    { date: "2024-01-10", amount: -99995 }, { date: "2024-01-10", amount: -5 },
    { date: "2025-06-01", amount: 10000 }, { date: "2025-07-01", amount: 92 }, { date: "2026-10-19", amount: 120000 },
  ]);
  const p = { ...createPortfolio("CAMS_KFINTECH", "x"), holdings: [h] };
  close(portfolioXirr(p).xirr, xirr(holdingCashflows(h).flows), 12);
  const partial = { ...p, holdings: [h, { ...h, isin: "INF179K01UT0", openingUnits: 5 }] };
  eq([portfolioXirr(partial).xirr, portfolioXirr(partial).excluded[0].reason], [null, XIRR_EXCLUSION.OPENING_UNITS]);
});

// ---------- Portfolio Allocation from real holdings (E15.5.12) ----------
test("Allocation: value-weighted asset mix, market cap (domestic equity) and sectors — hand-checked", () => {
  const h = (isin, value) => ({ ...createHolding(), isin, status: "active", raw: { ...createHolding().raw, marketValue: value } });
  const p = { ...createPortfolio("CAMS_KFINTECH", "x"), holdings: [h("A", "60,000.00"), h("B", "40,000.00")] };
  const fundHoldings = {
    A: { asOn: "2026-09", holdings: [
      { name: "Bank", assetType: "equity", sector: "Financial Services", marketCap: "large", weight: 50 },
      { name: "Tech", assetType: "equity", sector: "Information Technology", marketCap: "mid", weight: 30 },
      { name: "Bond", assetType: "debt", weight: 15 }, { name: "TREPS", assetType: "cash", weight: 5 },
    ] },
    B: { asOn: "2026-09", holdings: [{ name: "Gold", assetType: "gold", weight: 99 }] },   // 99% → scaled to 100%
  };
  const a = buildAllocation({ portfolio: p, fundHoldings });
  eq(a.composition, { equity: 48, debt: 12, goldSilver: 40, other: 0 });   // 60k×80% | 60k×20% | 40k
  eq(a.marketCap, { large: 62.5, mid: 37.5, small: 0 });                    // 30k / 48k, 18k / 48k
  eq(a.sectors, [{ sector: "Financial Services", pct: 62.5 }, { sector: "Information Technology", pct: 37.5 }]);
  eq(a.funds.A.marketCap, { large: 62.5, mid: 37.5, small: 0 });
  eq([a.coverage.value, a.coverage.asOn], [1, "2026-09"]);
  const fd = withAllocation({ funds: { A: { r1y: 1 } } }, a);
  eq([fd.composition.goldSilver, fd.funds.A.marketCap.large, fd.funds.A.r1y], [40, 62.5, 1]);
});
test("Allocation: weights that do not add up are refused; < 80% of value with data → —", () => {
  eq(normalisedHoldings({ holdings: [{ assetType: "equity", weight: 96 }] }), null);           // off by 4 points
  eq(normalisedHoldings({ holdings: [{ assetType: "equity", weight: 101 }] })[0].weight, 100);
  const h = (isin, value) => ({ ...createHolding(), isin, status: "active", raw: { ...createHolding().raw, marketValue: value } });
  const p = { ...createPortfolio("CAMS_KFINTECH", "x"), holdings: [h("A", "70,000.00"), h("C", "30,000.00")] };
  const a = buildAllocation({ portfolio: p, fundHoldings: { A: { holdings: [{ assetType: "equity", marketCap: "large", sector: "X", weight: 100 }] } } });
  eq([a.composition, a.marketCap, a.sectors, a.coverage.value], [null, null, null, 0.7]);
});

test("Return notes: only funds with — in every time frame, each with its reason", () => {
  const h = (isin, extra = {}) => ({ ...createHolding(), isin, schemeName: isin, status: "active", ...extra });
  const p = { ...createPortfolio("CAMS_KFINTECH", "x"), holdings: [
    h("OLD"), h("YOUNG"), h("IDCW", { valuation: { reason: VALUATION_REASON.NOT_MAPPED } }), h("NONE"), h("GONE", { status: "redeemed" }),
  ] };
  const fundData = { asOf: "2026-10-19", funds: {
    OLD: { returns: { r1y: 5, r3y: null, r5y: null }, navDate: "2026-10-19" },
    YOUNG: { returns: { r1y: null, r3y: null, r5y: null }, navDate: "2026-10-19", sinceLaunch: { pct: 1.8, from: "2026-01-01" } },
  } };
  const notes = returnNotes(p, fundData);
  eq(notes.map((n) => [n.isin, n.kind]), [["YOUNG", "young"], ["IDCW", "notListed"], ["NONE", "noHistory"]]);
  eq(notes[0].reason.startsWith("Launched on 01 Jan 2026"), true, notes[0].reason);
});

// ---------- blended benchmark (E15.5.13a) ----------
test("Blended benchmark: funds that move exactly with their index → benchmark = portfolio, Beta 1, Alpha 0", () => {
  // Daily series over 6 years: index A grows 12% a year with a monthly wiggle, index B 7%; each fund = its index × k.
  const days = [];
  for (let t = Date.UTC(2020, 9, 1); t <= Date.UTC(2026, 9, 19); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  const idx = (rate, wig) => days.map((d, i) => 100 * (1 + rate) ** (i / 365) * (1 + wig * Math.sin(i / 30)));
  const A = idx(0.12, 0.03), B = idx(0.07, 0.01);
  const s = (vals, k = 1) => navSeries({ dates: days, navs: vals.map((v) => v * k) });
  const map = buildSchemeMap([LIST("Direct", [SCHEME(1, "INF179K01608"), SCHEME(2, "INF179K01UT0", { assetClass: "Debt", category: "Liquid Fund" })])]);
  const holding = (isin, units, value) => ({ ...createHolding(), isin, status: "active", schemeName: isin, units, raw: { ...createHolding().raw, units: String(units), marketValue: value } });
  const p = { ...createPortfolio("CAMS_KFINTECH", "x"), holdings: [holding("INF179K01608", 10, "6,000.00"), holding("INF179K01UT0", 100, "4,000.00")] };
  const histories = { 1: s(A, 0.5), 2: s(B, 0.2) };
  const fd = buildFundData({ portfolio: p, schemeMap: map, histories,
    benchmarks: { 1: { code: "OB1", name: "Index A", series: s(A) }, 2: { code: "OB2", name: "Index B", series: s(B) } } });
  eq(fd.benchmarkName, "Blended Benchmark");
  for (const r of fd.trailingReturns) if (Math.abs(r.portfolio - r.benchmark) > 1e-9) throw new Error(`${r.period}: ${r.portfolio} vs ${r.benchmark}`);
  if (Math.abs(fd.risk.beta - 1) > 1e-9 || Math.abs(fd.risk.alpha) > 1e-9) throw new Error(`beta ${fd.risk.beta} alpha ${fd.risk.alpha}`);
  // the fund's own line: same returns as its index
  const f1 = fd.funds.INF179K01608;
  eq([f1.benchmark, Math.abs(f1.returns.r3y - f1.benchmarkReturns.r3y) < 1e-9], ["Index A", true]);
  // only one fund benchmarked, holding 60% of the value (< 80%) → no benchmark figures, never a partial one
  const partial = buildFundData({ portfolio: p, schemeMap: map, histories, benchmarks: { 1: { code: "OB1", name: "Index A", series: s(A) } } });
  eq([partial.trailingReturns.every((r) => r.benchmark === null), partial.risk.benchmark, partial.benchmarkName], [true, null, null]);
  // no benchmark data at all → as before
  eq(buildFundData({ portfolio: p, schemeMap: map, histories }).benchmarkName, null);
  // below 80% with the market index available → measured against the market: Alpha / Beta always present
  const vsMarket = buildFundData({ portfolio: p, schemeMap: map, histories, benchmarks: { 1: { code: "OB1", name: "Index A", series: s(A) } },
    market: { code: "OB56", name: "NIFTY 500 Index", series: s(A) } });
  eq([vsMarket.benchmarkBasis, vsMarket.benchmarkName], ["market", "NIFTY 500 Index"]);
  eq([Number.isFinite(vsMarket.risk.beta), Number.isFinite(vsMarket.risk.alpha), vsMarket.trailingReturns.every((r) => r.portfolio === null || Number.isFinite(r.benchmark))], [true, true, true]);
  eq(fd.benchmarkBasis, "funds");
});

// ---------- automatic Invest / Hold / Sell (Recommendation_Logic.md §8) ----------
const REC_AS_OF = "2026-10-21";
const recScheme = (code, category, extra = {}) => ({ schemeCode: code, schemeName: `Fund ${code}`, amc: `AMC ${code}`, plan: "Direct", assetClass: "Equity", category, ...extra });
const recGroup = (median = {}) => ({ funds: 30, n: { r3y: 30 }, median: { r1y: 10, r3y: 15, r5y: 14, sharpe3y: 0.8, maxDrawdown3y: -20, ...median } });
/** A fund ahead of its category median on every pillar, unless overridden. */
const recStats = (over = {}) => ({ group: "G", navDate: REC_AS_OF, firstDate: "2015-01-01", r1y: 12, r3y: 17, r5y: 16, sharpe3y: 1.0, maxDrawdown3y: -15,
  worstDay3y: -3, rank3y: 3, quartile3y: 1, n3y: 30, sharpeRank: 4, sharpeQuartile: 1, nSharpe: 30, consistency: 80, windows: 24, ...over });
const WEAK = { r1y: 6, r3y: 12, r5y: 11, rank3y: 28, quartile3y: 4, consistency: 20, sharpe3y: 0.4, sharpeQuartile: 4, maxDrawdown3y: -25 };
/** The fund's own benchmark returns (peer statistics `benchmark`), percent. */
const bm = (r1y, r3y, r5y, name = "NIFTY 500 TRI", code = "OB56") => ({ code, name, anchorDate: REC_AS_OF, r1y, r3y, r5y });
const DEBT = { assetClass: "Debt" };
const DEBT_MEDIAN = { r1y: 7, r3y: 7, r5y: 6.5, maxDrawdown3y: -0.5, worstDay3y: -0.2 };   // worstDay3y: used as a fund figure only
const recGrade = (category, over = {}, { scheme, credit = null, median } = {}) =>
  gradeFund({ scheme: recScheme(1, category, scheme), name: "", stats: recStats(over), group: recGroup(median), statsAsOf: REC_AS_OF, credit });

/** funds: [{ isin, value, scheme, stats?, group?, units?, txns? }] → autoRecommend result. */
function recPortfolio(funds, { fundHoldings = null, profile = null } = {}) {
  const portfolio = createPortfolio("CAMS_KFINTECH", "t.pdf");
  const schemes = {}, peerFunds = {}, groups = {};
  funds.forEach((f, i) => {
    const holding = createHolding();
    Object.assign(holding, { schemeName: f.scheme?.schemeName ?? `Unlisted ${i}`, isin: f.isin, folio: String(i), status: "active", transactions: f.txns ?? [] });
    holding.raw.marketValue = f.value;
    holding.raw.units = f.units ?? "100.000";
    portfolio.holdings.push(holding);
    if (!f.scheme) return;
    schemes[f.isin] = f.scheme;
    if (f.stats) {
      const key = `${f.scheme.plan}|${f.scheme.assetClass}|${f.scheme.category}`;
      peerFunds[String(f.scheme.schemeCode)] = { ...f.stats, group: key };
      groups[key] = f.group ?? recGroup();
    }
  });
  const result = autoRecommend({ portfolio, schemes, peerStats: { asOf: REC_AS_OF, funds: peerFunds, groups }, fundHoldings, ...(profile ? { profile } : {}) });
  const by = (i) => result.suggestions[holdingKey(portfolio.holdings[i])];
  return { result, by };
}
const recCount = (result, status) => Object.values(result.suggestions).filter((s) => s.status === status).length;

test("Auto T1: strong on every pillar, only fund in its category → INVEST", () => {
  const { by } = recPortfolio([{ isin: "A", value: "10,000.00", scheme: recScheme(1, "Flexi Cap Fund"), stats: recStats() },
    { isin: "B", value: "90,000.00", scheme: recScheme(2, "Liquid Fund", DEBT), stats: recStats({ ...DEBT_MEDIAN }), group: recGroup(DEBT_MEDIAN) }]);
  eq([by(0).status, by(0).grade, by(0).verdict], ["invest", "STRONG", "invest"]);
});

test("Auto T2: two STRONG funds in one category → best INVEST, the other HOLD (never SELL)", () => {
  const { by, result } = recPortfolio([
    { isin: "A", value: "10,000.00", scheme: recScheme(1, "Large Cap Fund"), stats: recStats({ r3y: 16, r5y: 15 }) },
    { isin: "B", value: "10,000.00", scheme: recScheme(2, "Large Cap Fund"), stats: recStats({ r3y: 18, r5y: 17 }) },
    { isin: "C", value: "80,000.00", scheme: recScheme(3, "Liquid Fund", DEBT), stats: recStats(DEBT_MEDIAN), group: recGroup(DEBT_MEDIAN) }]);
  eq([by(0).status, by(0).ruleId, by(1).status], ["hold", "strong-not-best", "invest"]);
  eq(recCount(result, "sell"), 0);
});

test("Auto T2b: best STRONG fund held back (1Y lag) → the next STRONG fund in the category gets INVEST", () => {
  const { by } = recPortfolio([
    { isin: "A", value: "10,000.00", scheme: recScheme(1, "Large Cap Fund"), stats: recStats({ r3y: 19, r5y: 18, r1y: 4 }) },   // best, 1Y −6 pp
    { isin: "B", value: "10,000.00", scheme: recScheme(2, "Large Cap Fund"), stats: recStats({ r3y: 16, r5y: 15 }) },
    { isin: "C", value: "10,000.00", scheme: recScheme(3, "Large Cap Fund"), stats: recStats({ r3y: 17, r5y: 16 }) },
    { isin: "D", value: "70,000.00", scheme: recScheme(4, "Liquid Fund", DEBT), stats: recStats(DEBT_MEDIAN), group: recGroup(DEBT_MEDIAN) }]);
  eq([by(0).status, by(0).ruleId], ["hold", "strong-1y-lag"]);
  eq([by(2).status, by(1).status, by(1).ruleId], ["invest", "hold", "strong-not-best"]);
  eq(by(1).reason.includes("Fund 3 (Direct)"), true);
});

test("Auto T3: 3Y and 5Y > 1 pp below median, bottom quartile → SELL", () => {
  const g = recGrade("Large Cap Fund", WEAK);
  eq([g.grade, g.pillars.R.state, g.pillars.K.state], ["WEAK", "-", "-"]);
  const { by } = recPortfolio([{ isin: "A", value: "10,000.00", scheme: recScheme(1, "Large Cap Fund"), stats: recStats(WEAK) }]);
  eq(by(0).status, "sell");
});

test("Auto T4: persistent under-performance with nothing else weak → HOLD (watch), not SELL", () => {
  const g = recGrade("Mid Cap Fund", { r3y: 13.5, r5y: 12.5, quartile3y: 3, rank3y: 20, consistency: 50, sharpe3y: 0.7, sharpeQuartile: 3, maxDrawdown3y: -21 });
  eq([g.grade, g.ruleId], ["MIXED", "watch"]);
});

test("Auto T5: strong returns, only one weak metric (consistency, or risk) → never SELL, and not STRONG with weak risk", () => {
  eq(recGrade("Small Cap Fund", { consistency: 30, quartile3y: 2 }).grade, "MIXED");
  eq(recGrade("Small Cap Fund", { sharpe3y: 0.3, sharpeQuartile: 4, maxDrawdown3y: -30 }).grade, "MIXED");   // R+, C+, K+ but S−
  eq(recGrade("Small Cap Fund", { quartile3y: 4, rank3y: 29 }).grade === "WEAK", false);
});

test("Auto T6: 12 STRONG funds in 12 categories → 12 INVEST, 0 SELL", () => {
  const cats = ["Large Cap Fund", "Mid Cap Fund", "Small Cap Fund", "Flexi Cap Fund", "Multi Cap Fund", "Large & Mid Cap Fund", "Focused Fund",
    "Value Fund", "Contra Fund", "Dividend Yield Fund", "Aggressive Hybrid Fund", "Multi Asset Allocation"];
  const { result } = recPortfolio(cats.map((c, i) => ({ isin: `F${i}`, value: "10,000.00",
    scheme: recScheme(i + 1, c, /Hybrid|Multi Asset/.test(c) ? { assetClass: "Hybrid" } : {}), stats: recStats() })));
  eq([recCount(result, "invest"), recCount(result, "sell")], [12, 0]);
});

test("Auto T7: index fund / ETF → HOLD whatever the numbers", () => {
  eq(recGrade("Index Funds", WEAK, { scheme: { assetClass: "Other" } }).grade, "HOLD");
  eq(recGrade("Other ETFs", WEAK, { scheme: { assetClass: "Other", plan: "ETF" } }).grade, "HOLD");
});

test("Auto T8: debt fund with risk data missing → never SELL; R alone decides HOLD", () => {
  const missing = { ...DEBT_MEDIAN, r3y: 6.8, r5y: 6.3, maxDrawdown3y: null, quartile3y: null, rank3y: null, consistency: null };
  eq(recGrade("Short Term Fund", missing, { scheme: DEBT, median: DEBT_MEDIAN }).grade, "MIXED");
  const below = { ...missing, r3y: 6.5, r5y: 6.0 };   // −0.5 pp both: R−, nothing to confirm it
  eq([recGrade("Short Term Fund", below, { scheme: DEBT, median: DEBT_MEDIAN }).grade, recGrade("Short Term Fund", below, { scheme: DEBT, median: DEBT_MEDIAN }).ruleId], ["MIXED", "debt-watch"]);
});

test("Auto T9: gold / silver / overseas / domestic FoF / solution-oriented → HOLD", () => {
  eq(recGrade("FoF Domestic", WEAK, { scheme: { assetClass: "Other", schemeName: "Axis Gold and Silver Passive FoF" } }).engine, "commodity");
  eq(recGrade("Gold ETF", WEAK, { scheme: { assetClass: "Other", plan: "ETF" } }).grade, "HOLD");
  eq(recGrade("FoF Overseas", WEAK, { scheme: { assetClass: "Other" } }).engine, "overseas");
  eq(recGrade("FoF Domestic", WEAK, { scheme: { assetClass: "Other" } }).grade, "HOLD");
  eq(recGrade("Retirement Fund", WEAK, { scheme: { assetClass: "Solution Oriented" } }).grade, "HOLD");
});

test("Auto T10/T11: fund under 3 years, or not in the AMFI list → REVIEW, not pre-selected", () => {
  const { by } = recPortfolio([
    { isin: "A", value: "10,000.00", scheme: recScheme(1, "Mid Cap Fund"), stats: recStats({ r3y: null, r5y: null, firstDate: "2024-04-01" }) },
    { isin: "B", value: "10,000.00", scheme: null }]);
  eq([by(0).status, by(0).verdict, by(0).ruleId], ["review", null, "young"]);
  eq([by(1).status, by(1).verdict, by(1).ruleId], ["review", null, "not-in-list"]);
});

test("Auto T12: weak ELSS — locked units HOLD, free units SELL, unknown lock REVIEW", () => {
  const elss = recScheme(1, "ELSS (Tax Saver)");
  const tx = (date, units) => ({ date, description: "Purchase", amount: 1000, units, price: 10, unitBalance: null, raw: {} });
  const run = (txns) => recPortfolio([{ isin: "A", value: "10,000.00", units: "100.000", scheme: elss, stats: recStats(WEAK), txns }]).by(0);
  const locked = run([tx("2021-01-05", 60), tx("2025-03-10", 40)]);
  eq([locked.status, locked.ruleId], ["hold", "elss-locked"]);
  if (!locked.reason.includes("40.000 units") || !locked.reason.includes("2028-03-10")) throw new Error(locked.reason);
  eq(run([tx("2020-01-05", 100)]).status, "sell");
  eq(run([]).status, "review");
});

test("Auto T13: sectoral / thematic — judged on its own index only; without benchmark data → HOLD", () => {
  eq(recGrade("Sectoral/Thematic", WEAK).ruleId, "thematic-no-benchmark");   // mixed-sector peers are never used
  eq(recGrade("Thematic Fund", {}).grade, "HOLD");
  eq(recGrade("Sectoral Fund", {}).engine, "thematic");
  const ahead = recGrade("Sectoral/Thematic", { ...WEAK, benchmark: bm(5, 11, 10) });               // weak vs peers, ahead of its index
  eq([ahead.grade, ahead.ruleId], ["STRONG", "thematic-beats-benchmark"]);
  eq(recGrade("Sectoral/Thematic", { benchmark: bm(14, 19, 18) }).ruleId, "thematic-lags-benchmark"); // behind on 1Y, 3Y, 5Y
  eq(recGrade("Sectoral/Thematic", { benchmark: bm(10, 19, 18) }).ruleId, "thematic-in-line");         // 1Y ahead: not persistent
});

test("Auto T14: one-day fall > 1% in a short / medium debt fund → REVIEW; gilt fund exempt", () => {
  eq(recGrade("Short Term Fund", { ...DEBT_MEDIAN, worstDay3y: -1.6 }, { scheme: DEBT, median: DEBT_MEDIAN }).ruleId, "credit-event");
  eq(recGrade("Gilt Fund", { ...DEBT_MEDIAN, worstDay3y: -1.6 }, { scheme: DEBT, median: DEBT_MEDIAN }).ruleId === "credit-event", false);
});

test("Auto T15: STRONG fund above 20% of the portfolio, or 1Y > 5 pp behind → HOLD; 1Y 3 pp behind → still INVEST", () => {
  const { by } = recPortfolio([
    { isin: "A", value: "30,000.00", scheme: recScheme(1, "Flexi Cap Fund"), stats: recStats() },
    { isin: "B", value: "10,000.00", scheme: recScheme(2, "Mid Cap Fund"), stats: recStats({ r1y: 4.5 }) },
    { isin: "D", value: "10,000.00", scheme: recScheme(4, "Small Cap Fund"), stats: recStats({ r1y: 7 }) },
    { isin: "C", value: "50,000.00", scheme: recScheme(3, "Liquid Fund", DEBT), stats: recStats(DEBT_MEDIAN), group: recGroup(DEBT_MEDIAN) }]);
  eq([by(0).status, by(0).ruleId, by(0).trim.toPct], ["sell", "fit-trim", 25]);   // four funds: an equal share is the limit
  eq([by(1).status, by(1).ruleId], ["hold", "strong-1y-lag"]);
  eq(by(2).status, "invest");
});

// v1.1 — the fund's own benchmark (pillar B)
const IN_LINE = { r3y: 15.4, r5y: 14.3, quartile3y: 2, rank3y: 12, consistency: 55, sharpe3y: 0.8, sharpeQuartile: 2, maxDrawdown3y: -20.5 };

test("Auto B1: in line with the category but ahead of its benchmark on 3Y and 5Y, nothing negative → INVEST", () => {
  const g = recGrade("Flexi Cap Fund", { ...IN_LINE, benchmark: bm(9, 14, 13) });
  eq([g.grade, g.ruleId, g.pillars.B.state], ["STRONG", "strong-category-and-benchmark", "+"]);
});

test("Auto B2: below the category median on 3Y and 5Y and > 1 pp behind its benchmark → SELL (two confirmations)", () => {
  const g = recGrade("Flexi Cap Fund", { ...IN_LINE, r3y: 14.6, r5y: 13.5, benchmark: bm(9, 16, 15) });
  eq([g.grade, g.ruleId, g.pillars.R.state, g.pillars.B.state], ["WEAK", "lags-category-and-benchmark", "0", "-"]);
  // … but not when another pillar is positive (e.g. top-quartile consistency), and never on the benchmark alone
  eq(recGrade("Flexi Cap Fund", { ...IN_LINE, r3y: 14.6, r5y: 13.5, consistency: 70, benchmark: bm(9, 16, 15) }).grade, "MIXED");
  eq(recGrade("Flexi Cap Fund", { ...IN_LINE, benchmark: bm(9, 18, 17) }).grade, "MIXED");    // above median, behind index
});

test("Auto B3: benchmark confirms persistent under-performance (R−, B−) → SELL; unknown benchmark is never a fail", () => {
  const weakish = { r3y: 13.5, r5y: 12.5, quartile3y: 3, rank3y: 20, consistency: 50, sharpe3y: 0.7, sharpeQuartile: 3, maxDrawdown3y: -21 };
  eq(recGrade("Mid Cap Fund", { ...weakish, benchmark: bm(9, 16, 15) }).grade, "WEAK");
  eq(recGrade("Mid Cap Fund", weakish).grade, "MIXED");                                  // no benchmark: as v1.0
  eq(recGrade("Mid Cap Fund", weakish).pillars.B.state, "?");
});

test("Auto B4: index fund — tracks its index within 1 pp a year → INVEST; trails by more → HOLD; no data → HOLD", () => {
  const idx = { assetClass: "Other" };
  eq(recGrade("Index Funds", { r3y: 13.6, benchmark: bm(9, 14.1, 13) }, { scheme: idx }).ruleId, "passive-tracks");
  eq(recGrade("Index Funds", { r3y: 12.6, benchmark: bm(9, 14.1, 13) }, { scheme: idx }).ruleId, "passive-tracking-poor");
  eq(recGrade("Index Funds", { r3y: null, benchmark: bm(9, 14.1, 13) }, { scheme: idx }).ruleId, "passive-no-tracking");
  const { by } = recPortfolio([   // two index funds in AMFI's mixed "Index Funds" group are not ranked against each other
    { isin: "A", value: "8,000.00", scheme: recScheme(1, "Index Funds", idx), stats: recStats({ r3y: 13.6, benchmark: bm(9, 14.1, 13) }) },
    { isin: "B", value: "8,000.00", scheme: recScheme(2, "Index Funds", idx), stats: recStats({ r3y: 13.9, benchmark: { ...bm(9, 14.1, 13), code: "OB44" } }) },
    { isin: "C", value: "84,000.00", scheme: recScheme(3, "Liquid Fund", DEBT), stats: recStats(DEBT_MEDIAN), group: recGroup(DEBT_MEDIAN) }]);
  eq([by(0).status, by(1).status], ["invest", "invest"]);   // different indices: both may take new money
});

test("Auto S1: sector index fund / ETF — the sector vs the market decides (on the sector index when mapped)", () => {
  const market = { code: "OB56", name: "NIFTY 500 Index", r1y: 8, r3y: 14, r5y: 13 };
  const etf = (name, over) => gradeFund({ scheme: recScheme(1, "Other ETFs", { plan: "ETF", assetClass: "Other", schemeName: name }), stats: recStats({ market, ...over }), group: null, statsAsOf: REC_AS_OF });
  // whole sector behind on 3Y, 5Y (> 2 pp a year) and 1Y → SELL
  eq(etf("XYZ Nifty Housing ETF", { r1y: 5, r3y: 10, r5y: 9 }).ruleId, "sector-lagging");
  // behind on 3Y / 5Y but recovering over the last year → HOLD (no selling at the bottom)
  eq(etf("XYZ Nifty Housing ETF", { r1y: 9, r3y: 10, r5y: 9 }).ruleId, "sector-in-line");
  // ahead on 3Y and 5Y → INVEST
  eq(etf("XYZ Nifty Pharma ETF", { r1y: 20, r3y: 22, r5y: 16 }).ruleId, "sector-ahead");
  // a unit split in the NAV history: never judged on it
  eq(etf("XYZ Nifty Bank ETF", { r1y: -75, r3y: -40, r5y: -25, worstDay3y: -90 }).ruleId, "sector-unknown");
  // mapped index fund: the sector index decides, the same for every fund on it
  const a = etf("XYZ Nifty IT Index Fund", { r1y: 9, r3y: 9.5, r5y: 9, benchmark: { code: "OB70", name: "NIFTY IT Index", r1y: 7, r3y: 9.8, r5y: 9.5 } });
  eq(a.ruleId, "sector-lagging");
  // broad, factor, debt and overseas index funds are not sector funds
  eq(["Nifty 50 ETF", "Nifty200 Momentum 30 Index Fund", "Nifty PSU Bond Plus SDL Index Fund", "Nasdaq 100 ETF", "Nifty Bank ETF"].map((n) => isSectorPassive({ schemeName: n })),
    [false, false, false, false, true]);
  // gold / silver stay commodity; NIFTY Commodities is an equity sector
  eq([engineOf({ ...recScheme(1, "Other ETFs", { plan: "ETF", assetClass: "Other" }), schemeName: "XYZ Gold ETF" }),
      engineOf({ ...recScheme(1, "Other ETFs", { plan: "ETF", assetClass: "Other" }), schemeName: "XYZ Nifty Commodities ETF" })], ["commodity", "passive"]);
});

test("Auto S2: active sector fund — sector not performing AND fund behind the market → SELL; fund ahead of the market → HOLD", () => {
  const market = { code: "OB56", name: "NIFTY 500 Index", r1y: 8, r3y: 14, r5y: 13 };
  const housing = { code: "OB300", name: "BSE Housing Index", r1y: 3, r3y: 9, r5y: 8 };
  eq(recGrade("Sectoral/Thematic", { r1y: 2, r3y: 7, r5y: 6, market, benchmark: housing }).ruleId, "sector-lagging");
  // Ahead of its own index: kept, however weak the sector.
  const ownIndex = recGrade("Sectoral/Thematic", { r1y: 4, r3y: 10, r5y: 9, market, benchmark: housing });
  eq([ownIndex.ruleId, ownIndex.reason.includes("ahead of its own index")], ["sector-lagging-fund-ahead", true]);
  // Behind the market on 3Y, ahead on 5Y: kept, and the reason says exactly that.
  eq(recGrade("Sectoral/Thematic", { r1y: 4, r3y: 8.5, r5y: 14, market, benchmark: housing }).reason.includes("not behind the market on both horizons"), true);
  eq(recGrade("Sectoral/Thematic", { r1y: 9, r3y: 15, r5y: 14, market, benchmark: housing }).ruleId, "sector-lagging-fund-ahead");
  // a thematic fund benchmarked to a broad index: no sector check (its own-index rule applies)
  eq(recGrade("Thematic Fund", { r1y: 4, r3y: 10, r5y: 9, market, benchmark: { ...market, code: "OB98", name: "BSE 200 Index" } }).ruleId === "sector-lagging", false);
});

test("Auto F1: the same fund in two folios, or in both plans → one call, never 'ranks higher than itself'", () => {
  const mid = recScheme(1, "Mid Cap Fund", { schemeName: "HDFC Mid Cap Fund", amc: "HDFC Mutual Fund" });
  const { by } = recPortfolio([
    { isin: "A", value: "5,260.00", scheme: mid, stats: recStats() },
    { isin: "A", value: "11,410.00", scheme: mid, stats: recStats() },
    { isin: "Z", value: "83,330.00", scheme: recScheme(9, "Liquid Fund", DEBT), stats: recStats(DEBT_MEDIAN), group: recGroup(DEBT_MEDIAN) }]);
  eq([by(0).status, by(1).status, by(0).reason === by(1).reason], ["invest", "invest", true]);
  eq([by(0).folios, by(0).notes.some((n) => /2 folios/.test(n)), /ranks higher/.test(by(0).reason)], [2, true, false]);
  // Regular and Direct of one scheme: one call (judged on the larger holding)
  const reg = { ...mid, schemeCode: 2, plan: "Regular" };
  const plans = recPortfolio([
    { isin: "A", value: "5,000.00", scheme: mid, stats: recStats() },
    { isin: "B", value: "6,000.00", scheme: reg, stats: recStats({ r3y: 16.5 }) },
    { isin: "Z", value: "89,000.00", scheme: recScheme(9, "Liquid Fund", DEBT), stats: recStats(DEBT_MEDIAN), group: recGroup(DEBT_MEDIAN) }]).by;
  eq([plans(0).status, plans(1).status, plans(0).notes.some((n) => /Regular and Direct|Direct and Regular/.test(n))], ["invest", "invest", true]);
});

test("Auto F2: high overlap (≥ 50%) — the fund worse on most measures: MIXED → SELL, STRONG → HOLD; low overlap → nothing", () => {
  const rows = (pairs) => ({ holdings: pairs.map(([isin, weight]) => ({ assetType: "equity", isin, weight })) });
  const same = rows([["S1", 30], ["S2", 30], ["S3", 25], ["S4", 15]]);
  const mostly = rows([["S1", 30], ["S2", 30], ["S3", 10], ["X9", 30]]);         // 70% in common
  const other = rows([["S1", 10], ["Y1", 45], ["Y2", 45]]);                     // 10% in common
  eq(Math.round(fundOverlap(same, mostly)), 70);
  const run = (bStats, bHoldings = mostly) => recPortfolio([
    { isin: "A", value: "10,000.00", scheme: recScheme(1, "Flexi Cap Fund"), stats: recStats() },
    { isin: "B", value: "10,000.00", scheme: recScheme(2, "Large & Mid Cap Fund"), stats: recStats(bStats) },
    { isin: "Z", value: "80,000.00", scheme: recScheme(9, "Liquid Fund", DEBT), stats: recStats(DEBT_MEDIAN), group: recGroup(DEBT_MEDIAN) }],
    { fundHoldings: { A: same, B: bHoldings } }).by;
  const weaker = { ...IN_LINE, sharpe3y: 0.7, maxDrawdown3y: -22, consistency: 50 };   // MIXED, worse on most measures
  eq([run(weaker)(1).status, run(weaker)(1).ruleId], ["sell", "overlap-weaker"]);
  eq(run(weaker)(0).notes.some((n) => /High overlap \(70%\)/.test(n)), true);
  // a STRONG but weaker fund is held, not sold
  const strongWeaker = { r3y: 16.5, r5y: 15.5, consistency: 70, sharpe3y: 0.9, maxDrawdown3y: -18 };
  eq([run(strongWeaker)(1).status, run(strongWeaker)(1).ruleId], ["hold", "overlap-strong-weaker"]);
  // low overlap: no action
  eq(run(weaker, other)(1).ruleId === "overlap-weaker", false);
  // 55% in common (between the old 60% and the new 50% threshold) → acted on; 45% → not
  const fiftyFive = rows([["S1", 30], ["S2", 25], ["Z1", 45]]);
  const fortyFive = rows([["S1", 30], ["S2", 15], ["Z1", 55]]);
  eq([Math.round(fundOverlap(same, fiftyFive)), run(weaker, fiftyFive)(1).ruleId], [55, "overlap-weaker"]);
  eq([Math.round(fundOverlap(same, fortyFive)), run(weaker, fortyFive)(1).ruleId === "overlap-weaker"], [45, false]);
});

test("Auto B4b: two index funds on the same index → the closer tracker INVEST, the other HOLD", () => {
  const idx = { assetClass: "Other" };
  const nifty = (r3y) => recStats({ r3y, benchmark: bm(9, 6.53, 6, "NIFTY 50 Index") });
  const { by } = recPortfolio([
    { isin: "A", value: "8,000.00", scheme: recScheme(1, "Index Funds", idx), stats: nifty(6.23) },
    { isin: "B", value: "8,000.00", scheme: recScheme(2, "Index Funds", idx), stats: nifty(6.06) },
    { isin: "C", value: "84,000.00", scheme: recScheme(3, "Liquid Fund", DEBT), stats: recStats(DEBT_MEDIAN), group: recGroup(DEBT_MEDIAN) }]);
  eq([by(0).status, by(1).status, by(1).ruleId], ["invest", "hold", "passive-same-index"]);
});

test("Auto B5: same category — best INVEST; a duplicate behind its category and benchmark → SELL; ELSS lock still holds", () => {
  const lagging = { ...IN_LINE, r3y: 14.4, r5y: 13.4, benchmark: bm(9, 15.5, 14) };   // behind both on 3Y and 5Y, by 0.5–1 pp
  const { by } = recPortfolio([
    { isin: "A", value: "10,000.00", scheme: recScheme(1, "Large Cap Fund"), stats: recStats() },
    { isin: "B", value: "10,000.00", scheme: recScheme(2, "Large Cap Fund"), stats: recStats(lagging) },
    { isin: "C", value: "10,000.00", scheme: recScheme(3, "Large Cap Fund"), stats: recStats({ ...IN_LINE, benchmark: bm(9, 14, 13) }) },
    { isin: "D", value: "70,000.00", scheme: recScheme(4, "Liquid Fund", DEBT), stats: recStats(DEBT_MEDIAN), group: recGroup(DEBT_MEDIAN) }]);
  eq(by(0).status, "invest");
  eq([by(1).status, by(1).ruleId], ["sell", "weakest-in-category"]);
  eq(by(2).status === "sell", false);   // ahead of its benchmark: kept
  // Behind on 3Y but ahead on 5Y (category or benchmark) → not the weak duplicate: HOLD
  const mixedHorizons = recPortfolio([
    { isin: "A", value: "10,000.00", scheme: recScheme(1, "Large Cap Fund"), stats: recStats() },
    { isin: "B", value: "10,000.00", scheme: recScheme(2, "Large Cap Fund"), stats: recStats({ ...lagging, benchmark: bm(9, 15.5, 11.5) }) },
    { isin: "D", value: "80,000.00", scheme: recScheme(4, "Liquid Fund", DEBT), stats: recStats(DEBT_MEDIAN), group: recGroup(DEBT_MEDIAN) }]).by(1);
  eq(mixedHorizons.status, "hold");
  const elss = recScheme(5, "ELSS (Tax Saver)"), elss2 = recScheme(6, "ELSS (Tax Saver)");
  const tx = (date, units) => ({ date, description: "Purchase", amount: 1000, units, price: 10, unitBalance: null, raw: {} });
  const locked = recPortfolio([
    { isin: "E", value: "10,000.00", scheme: elss, stats: recStats() },
    { isin: "F", value: "10,000.00", units: "100.000", scheme: elss2, stats: recStats(lagging), txns: [tx("2025-03-10", 100)] },
    { isin: "G", value: "80,000.00", scheme: recScheme(7, "Liquid Fund", DEBT), stats: recStats(DEBT_MEDIAN), group: recGroup(DEBT_MEDIAN) }]).by(1);
  eq([locked.status, locked.ruleId], ["hold", "elss-locked"]);
});

test("Auto T16: peer group under 5 funds (no median) → REVIEW", () => {
  const g = gradeFund({ scheme: recScheme(1, "Contra Fund"), stats: recStats(), group: { funds: 3, n: { r3y: 3 }, median: { r1y: null, r3y: null, r5y: null } }, statsAsOf: REC_AS_OF });
  eq([g.grade, g.ruleId], ["REVIEW", "no-peers"]);
  // … with its own benchmark it is judged against that alone
  const small = { funds: 3, n: { r3y: 3 }, median: { r1y: null, r3y: null, r5y: null } };
  const ahead = gradeFund({ scheme: recScheme(1, "Contra Fund"), stats: recStats({ benchmark: bm(9, 15, 14) }), group: small, statsAsOf: REC_AS_OF });
  eq([ahead.grade, ahead.ruleId], ["STRONG", "no-peers-beats-benchmark"]);
  const behind = gradeFund({ scheme: recScheme(1, "Contra Fund"), stats: recStats({ benchmark: bm(14, 19, 18) }), group: small, statsAsOf: REC_AS_OF });
  eq([behind.grade, behind.ruleId], ["WEAK", "no-peers-lags-benchmark"]);
});

test("Auto T17: a missing figure is unknown — never counted as 0 / a fail", () => {
  const g = recGrade("Mid Cap Fund", { ...WEAK, quartile3y: null, rank3y: null, consistency: null, sharpe3y: null, sharpeQuartile: null, maxDrawdown3y: null });
  eq([g.grade, g.pillars.K.state, g.pillars.C.state, g.pillars.S.state], ["MIXED", "?", "?", "?"]);
  // no 5Y comparison → 3Y + 1Y rule
  const young = recGrade("Mid Cap Fund", { r5y: null });
  eq([young.pillars.R.state, young.pillars.R.text.includes("1Y")], ["+", true]);
  // stale statistics → REVIEW
  eq(recGrade("Mid Cap Fund", { navDate: "2026-10-05" }).ruleId, "stale");
  // no statistics at all → nothing pre-selected
  eq(autoRecommend({ portfolio: createPortfolio("CAMS_KFINTECH", "x"), peerStats: null }), null);
});

test("Auto: debt credit quality from holdings ratings; credit-risk funds exempt", () => {
  const entry = (rows) => ({ holdings: rows.map(([assetType, rating, weight, sector = null]) => ({ assetType, rating, weight, sector })) });
  eq(creditQuality(entry([["debt", "AAA", 50], ["debt", "Sovereign", 20], ["debt", "AA", 20], ["cash", null, 10]])), 80);
  eq(creditQuality(entry([["debt", "AAA(SO)", 40], ["debt", "A1+", 40], ["debt", null, 20]])), null);    // 20% unrated
  eq(creditQuality(entry([["debt", null, 90, "Govt-Sec"], ["cash", null, 10]])), 100);
  eq(creditQuality(entry([["equity", null, 100]])), null);
  const weakish = { ...DEBT_MEDIAN, r3y: 6.5, r5y: 6.0, quartile3y: 3, maxDrawdown3y: -0.6 };
  eq(recGrade("Corporate Bond Fund", weakish, { scheme: DEBT, median: DEBT_MEDIAN, credit: 50 }).grade, "WEAK");
  eq(recGrade("Credit Risk Fund", weakish, { scheme: DEBT, median: DEBT_MEDIAN, credit: 50 }).grade, "MIXED");
  eq(recGrade("Corporate Bond Fund", { ...DEBT_MEDIAN, r3y: 7.4, r5y: 6.9 }, { scheme: DEBT, median: DEBT_MEDIAN, credit: 95 }).grade, "STRONG");
});

test("Auto: arbitrage judged on return and rank only; Regular plan note; fund-house flag", () => {
  eq(recGrade("Arbitrage Fund", { consistency: 10 }, { scheme: { assetClass: "Hybrid" } }).grade, "STRONG");
  const { by, result } = recPortfolio([
    { isin: "A", value: "50,000.00", scheme: recScheme(1, "Flexi Cap Fund", { plan: "Regular", amc: "Same AMC" }), stats: recStats() },
    { isin: "B", value: "50,000.00", scheme: recScheme(2, "Mid Cap Fund", { amc: "Same AMC" }), stats: recStats() }]);
  eq(by(0).notes.some((n) => /regular plan|direct plan/i.test(n)), false);   // both plans are recommended: no switch note
  eq(result.flags.some((f) => f.id === "amc"), true);
  // v2.1: the Mid Cap fund is cut to the Balanced basket's 25% Mid Cap limit; the Flexi Cap fund is already at its
  // two-fund equal share, so the money goes to the Recommended Portfolio rather than pushing it to 75%.
  eq([by(1).status, by(1).trim.toPct, by(1).move], ["sell", 25, "the Prosperr Recommended Portfolio"]);
  eq(result.flags.filter((f) => f.id === "fund").length, 1);   // the Flexi Cap fund at 50%; the Mid Cap fund has its own cut line
  eq(result.flags.some((f) => f.id === "category"), true);
  const etf = recPortfolio([{ isin: "E", value: "60,000.00", scheme: recScheme(5, "Other ETFs", { plan: "ETF", assetClass: "Other" }), stats: recStats() },
    { isin: "F", value: "40,000.00", scheme: recScheme(6, "Mid Cap Fund"), stats: recStats() }]).result;
  eq(etf.flags.filter((f) => f.id === "fund").some((f) => f.text.startsWith("Fund 5")), false);   // the ETF is not flagged
  eq(etf.flags.some((f) => f.id === "category" && /Mid Cap funds were 40\.0%/.test(f.text)), true);   // v2.1: the Mid Cap fund is cut to its category limit
});

// ---------- Stage 2b: portfolio fit (v1.4) ----------
const strong = (code, category, value, extra = {}) => ({ isin: `S${code}`, value, scheme: recScheme(code, category, extra), stats: recStats() });
const mixed = (code, category, value, over = {}, extra = {}) => ({ isin: `M${code}`, value, scheme: recScheme(code, category, extra), stats: recStats({ ...IN_LINE, ...over }) });
const indexHold = (code, value) => ({ isin: `I${code}`, value, scheme: recScheme(code, "Index Funds", { assetClass: "Other" }), stats: recStats() });   // no benchmark → HOLD
const exitsOf = (result) => Object.values(result.suggestions).filter((s) => s.ruleId === "fit-exit" || s.ruleId === "fit-small");

test("Fit P1: more funds than the portfolio's ideal range → the small, then the weakest Hold funds exit; no more than needed", () => {
  // ₹1L portfolio → ideal 2–4 funds; small = below 100 / 4 × 0.25 = 6.25%
  const { by, result } = recPortfolio([
    strong(1, "Large Cap Fund", "20000.00"), strong(2, "Mid Cap Fund", "20000.00"), strong(3, "Small Cap Fund", "20000.00"),
    mixed(4, "Flexi Cap Fund", "20000.00"),
    mixed(5, "Value Fund", "5000.00"),
    mixed(6, "Focused Fund", "15000.00", { r3y: 14.5, r5y: 13.5 })]);
  eq([by(0).status, by(1).status], ["invest", "invest"]);
  eq([by(2).status, by(2).ruleId, by(2).trim.toPct], ["sell", "fit-trim", 15]);   // v2.1: Small Cap funds at most 15% (Balanced)
  // v2.2: below 6.25% a holding is cleaned up whatever its record; the fund count then exits the weakest Hold.
  eq([by(4).status, by(4).ruleId, by(4).stage], ["sell", "fit-small", "portfolio"]);
  eq(by(4).reason.includes("at 5.0% of the portfolio this holding is at or below 5%"), true);   // equal to 5% counts
  eq(by(5).reason.includes("holds 6 funds where 2–4 suit its size"), true);
  eq(by(5).reason.includes("among the weakest of the funds held"), true);   // measured: 3Y / 5Y behind the others
  eq([by(5).status, by(3).status, by(3).ruleId], ["sell", "hold", "mixed"]);   // 2 exits bring 6 → 4; the stronger Hold stays
  eq([result.fit.funds, result.fit.fundsAfter, result.fit.exits, result.fit.open], [6, 4, 1, []]);   // the small holding is a clean-up, not a fund-count exit
  eq(result.flags.some((f) => f.id === "count"), true);
});

test("Fit P2: protections — category leader, last gold fund, ELSS in lock-in are never exited; the duplicate is", () => {
  const tx = (date, units) => ({ date, description: "Purchase", amount: 1000, units, price: 10, unitBalance: null, raw: {} });
  const { by, result } = recPortfolio([
    strong(1, "Large Cap Fund", "17000.00"), strong(2, "Mid Cap Fund", "17000.00"), strong(3, "Small Cap Fund", "17000.00"),
    strong(4, "Flexi Cap Fund", "17000.00"), strong(5, "Value Fund", "17000.00"),
    { isin: "G", value: "3000.00", scheme: recScheme(6, "FoF Domestic", { assetClass: "Other", schemeName: "Gold Savings Fund" }) },
    { ...mixed(7, "ELSS (Tax Saver)", "3000.00"), units: "100.000", txns: [tx("2025-03-10", 100)] },
    mixed(8, "Large Cap Fund", "4000.00")]);
  eq([by(5).status, by(6).status], ["hold", "hold"]);   // last gold / silver fund; ELSS units locked
  eq([by(7).status, by(7).ruleId], ["sell", "fit-small"]);   // v2.2: 4.2%, below 6.25% — cleaned up into the same category
  // Fund 1 (17.9%) takes only what fits under the 20% one-fund limit; the rest fills the gap through the other Invest funds.
  eq([by(7).moveSplit[0].to, by(7).moveSplit[0].pct.toFixed(1), by(7).reason.includes("consolidate the money into Fund 1 (Direct) (about")], ["Fund 1 (Direct)", "2.1", true]);
  eq(by(0).status, "invest");                           // the category leader is kept
  // Not enough candidates: the job stops honestly — still above the range, no other fund forced out
  eq([result.fit.exits, result.fit.fundsAfter, result.fit.open.includes("count")], [0, 7, true]);   // the small duplicate is a clean-up, not a fund-count exit
});

test("Fit P2b: two gold funds over the fund count → one exits, named as duplicate exposure; never called 'weakest' unmeasured", () => {
  const gold = (code, value, name) => ({ isin: `G${code}`, value, scheme: recScheme(code, "FoF Domestic", { assetClass: "Other", schemeName: name }) });
  const { by } = recPortfolio([strong(1, "Large Cap Fund", "20000.00"), strong(2, "Mid Cap Fund", "20000.00"), strong(3, "Small Cap Fund", "20000.00"),
    gold(4, "15000.00", "Gold Fund A"), gold(5, "25000.00", "Gold Fund B")]);
  const exited = [by(3), by(4)].filter((s) => s.status === "sell");
  const full = exited.filter((s) => s.ruleId === "fit-exit");
  eq(full.length, 1);
  eq([/already gives the gold \/ silver exposure/.test(full[0].reason), /weakest/.test(full[0].reason)], [true, false]);
});

test("Fit P3: more index funds / ETFs than the portfolio needs → the extra (weakest, then smallest) exits", () => {
  // ₹1L → ideal max 4 ≤ 6 → at most 2 index funds / ETFs
  const { by, result } = recPortfolio([indexHold(1, "10000.00"), indexHold(2, "8000.00"), indexHold(3, "12000.00"), strong(4, "Flexi Cap Fund", "70000.00")]);
  eq([by(1).status, by(1).ruleId], ["sell", "fit-exit"]);
  eq(by(1).reason.includes("it holds 3 index funds / ETFs where 2 are enough"), true);
  eq([by(0).status, by(2).status, by(2).ruleId, by(2).trim.toPct], ["hold", "sell", "fit-trim", 10]);   // the two kept share the 20%
  eq([result.fit.passive, result.fit.passiveMax, result.flags.some((f) => f.id === "passive")], [3, 2, true]);
});

test("Fit P4: index funds and fund count together — extras exit first, then the small Hold, down to the range", () => {
  const { result } = recPortfolio([
    strong(1, "Large Cap Fund", "20000.00"), strong(2, "Mid Cap Fund", "20000.00"), strong(3, "Small Cap Fund", "20000.00"),
    indexHold(4, "12000.00"), indexHold(5, "11000.00"), indexHold(6, "14000.00"), mixed(7, "Value Fund", "3000.00")]);
  const exits = exitsOf(result);
  eq([exits.length, result.fit.fundsAfter, result.fit.open], [3, 4, []]);
  eq(exits.filter((s) => s.engine === "passive").length, 2);
  eq(exits.some((s) => s.ruleId === "fit-small" && s.reason.includes("this holding is at or below 5%")), true);
});

test("Fit P5: theme above its limit is cut to the limit, weakest first, and takes no new money", () => {
  const thematic = (code, value, b) => ({ isin: `T${code}`, value, scheme: recScheme(code, "Sectoral/Thematic"), stats: recStats({ benchmark: b }) });
  const two = recPortfolio([strong(1, "Large Cap Fund", "50000.00"), strong(2, "Mid Cap Fund", "28000.00"),
    thematic(3, "12000.00", bm(12, 17.3, 15.5)),    // in line with its index → HOLD
    thematic(4, "10000.00", bm(9, 15, 14))]);       // ahead of its index → STRONG
  eq([two.by(2).status, two.by(2).ruleId, two.by(2).trim], ["sell", "fit-exit", null]);   // 12% cut to 5% leaves less than a small holding: exit in full
  eq(two.by(2).reason.includes("sectoral / thematic funds are 22.0% of the portfolio (limit 15%)"), true);
  eq(two.by(3).status, "invest");   // 10% after the exit: within the limit, so it takes new money
  eq(two.result.flags.some((f) => f.id === "thematic" && /limit/.test(f.text)), true);
  const lone = recPortfolio([strong(1, "Large Cap Fund", "40000.00"), strong(2, "Mid Cap Fund", "40000.00"), thematic(3, "20000.00", bm(9, 15, 14))]);
  eq([lone.by(2).status, lone.by(2).trim.toPct], ["sell", 15]);
});

test("Fit P6: a fund house above 40% → its INVEST calls become HOLD (no new money); within range nothing is sold", () => {
  const x = { amc: "AMC X" };
  const { by, result } = recPortfolio([   // ₹30L → ideal 4–8; 6 funds
    strong(1, "Large Cap Fund", "600000.00", x), strong(2, "Mid Cap Fund", "600000.00", x), strong(3, "Small Cap Fund", "150000.00", x),
    strong(4, "Flexi Cap Fund", "600000.00"), strong(5, "Value Fund", "600000.00"), strong(6, "Focused Fund", "450000.00")]);
  eq([by(0).ruleId, by(1).ruleId, by(2).ruleId], ["fit-amc-limit", "fit-amc-limit", "fit-small"]);   // Fund 3 is exactly 5%: cleaned up (v2.2)
  eq([by(0).status, by(3).status, by(5).status], ["hold", "invest", "invest"]);
  eq([exitsOf(result).length, result.fit.range], [1, { min: 4, max: 8, band: "₹25L–₹1Cr" }]);   // only the 5% clean-up
  eq(result.flags.filter((f) => f.id === "amc").length, 1);
});

test("Fit P7: within the ideal range and every limit → Stage 2 changes nothing", () => {
  const { result } = recPortfolio([strong(1, "Large Cap Fund", "600000.00"), strong(2, "Mid Cap Fund", "600000.00"),
    mixed(3, "Flexi Cap Fund", "600000.00"), mixed(4, "Value Fund", "600000.00"), indexHold(5, "600000.00")]);
  eq([exitsOf(result).length, Object.values(result.suggestions).some((s) => s.stage === "portfolio"), result.fit.open], [0, false, []]);
  eq(result.flags.some((f) => ["count", "passive", "amc", "thematic"].includes(f.id)), false);
});

test("Fit P8: Suggestion Box — folios, both plans, overlap pairs; written without depending on the advisor's final calls", () => {
  const mid = recScheme(1, "Mid Cap Fund", { schemeName: "HDFC Mid Cap Fund", amc: "HDFC Mutual Fund" });
  const { result } = recPortfolio([
    { isin: "A", value: "20000.00", scheme: mid, stats: recStats() }, { isin: "A", value: "20000.00", scheme: mid, stats: recStats() },
    strong(2, "Large Cap Fund", "30000.00"), strong(3, "Small Cap Fund", "30000.00")]);
  const folios = result.flags.filter((f) => f.id === "folios");
  eq([folios.length, /2 folios/.test(folios[0].text), /no sale is needed/.test(folios[0].text)], [1, true, true]);
  eq(result.flags.every((f) => !/\bwe sold\b|you changed/i.test(f.text)), true);
});

test("Fit v2.1 C1: Mid / Small Cap funds together stay within the basket's limit, shared equally when alike", () => {
  // ₹10L, 5 funds, no profile → Balanced: Small Cap ≤ 15%, Mid Cap ≤ 25%. Two alike Small Cap funds at 12% each = 24%.
  const { by, result } = recPortfolio([strong(1, "Large Cap Fund", "300000.00"), strong(2, "Flexi Cap Fund", "260000.00"),
    strong(3, "Small Cap Fund", "120000.00"), strong(4, "Small Cap Fund", "120000.00", { amc: "AMC 3" }), strong(5, "Mid Cap Fund", "200000.00")]);
  eq([by(2).status, by(2).trim.toPct, by(3).status, by(3).trim.toPct], ["sell", 7.5, "sell", 7.5]);   // 15% shared 7.5 / 7.5
  eq(by(4).status === "sell", false);   // Mid Cap 20% is within its 25% limit
  eq(result.flags.some((f) => f.id === "category" && /Small Cap funds were 24\.0%/.test(f.text) && /Balanced/.test(f.text)), true);
});

test("Fit v2.1 C2: the basket sets the limit — Conservative Small Cap 10%, Growth 20%", () => {
  const funds = () => [strong(1, "Large Cap Fund", "450000.00"), strong(2, "Flexi Cap Fund", "250000.00"), strong(3, "Small Cap Fund", "180000.00"),
    strong(4, "Value Fund", "120000.00")];
  const conservative = recPortfolio(funds(), { profile: { risk: { label: "Conservative" }, horizon: { label: "Long Term" } } });
  const growth = recPortfolio(funds(), { profile: { risk: { label: "Aggressive" }, horizon: { label: "Long Term" } } });
  eq([conservative.by(2).status, conservative.by(2).trim.toPct], ["sell", 10]);
  eq(growth.by(2).status === "sell", false);   // 18% is within Growth's 20%
});

test("Fit v2.1 C3: a fund house above 25% takes no new money; with fewer than 4 funds its equal share is the limit", () => {
  const x = { amc: "AMC X" };
  const { by } = recPortfolio([strong(1, "Large Cap Fund", "250000.00", x), strong(2, "Flexi Cap Fund", "250000.00"),
    strong(3, "Value Fund", "250000.00"), strong(4, "Focused Fund", "250000.00"), strong(5, "Large & Mid Cap Fund", "250000.00", x)]);
  eq([by(0).ruleId, by(4).ruleId], ["fit-amc-limit", "fit-amc-limit"]);   // 20% each (within the one-fund limit); AMC X = 40%
  eq([by(1).status, by(2).status], ["invest", "invest"]);
  const three = recPortfolio([strong(1, "Large Cap Fund", "100000.00"), strong(2, "Flexi Cap Fund", "100000.00"), strong(3, "Value Fund", "100000.00")]);
  eq([0, 1, 2].every((i) => three.by(i).ruleId !== "fit-amc-limit"), true);   // 33% each: their equal share, not over the limit
});

test("Fit v2.1 C4: money from a sale goes to Invest funds only while they have room under the one-fund limit", () => {
  const funds = (big) => [strong(1, "Large Cap Fund", big), strong(2, "Flexi Cap Fund", big), strong(3, "Value Fund", big),
    strong(4, "Focused Fund", big), strong(5, "Large & Mid Cap Fund", big), strong(6, "Small Cap Fund", "250000.00")];
  const roomy = recPortfolio(funds("150000.00"));   // ₹10L: Small Cap 25% → 15%; five Invest funds at 15% have 25 points of room
  // v2.2: the 10 points cut go to the Invest funds, each only up to its room — never to the Recommended Portfolio here.
  eq([roomy.by(5).trim.toPct, roomy.by(5).moveSplit.every((p) => /^Fund [1-5] \(Direct\)$/.test(p.to))], [15, true]);
  const full = recPortfolio([strong(1, "Large Cap Fund", "200000.00"), strong(2, "Flexi Cap Fund", "200000.00"), strong(3, "Value Fund", "200000.00"),
    strong(4, "Focused Fund", "150000.00"), strong(5, "Small Cap Fund", "250000.00")]);   // the others are at 20% (room 5 < the 10 cut)
  // v2.2: the one fund with room takes what fits (5 points, to 20%); only the rest goes to the Recommended Portfolio.
  const parts = Object.fromEntries(full.by(4).moveSplit.map((p) => [p.to, p.pct.toFixed(1)]));
  eq([full.by(4).trim.toPct, parts], [15, { "Fund 4 (Direct)": "5.0", "the Prosperr Recommended Portfolio": "5.0" }]);
});

test("Fit v2.1 C5: an index fund whose return to the index's date is missing is not called a poor tracker", () => {
  const idx = { assetClass: "Other" };
  const g = recGrade("Index Funds", { r3y: 13.6, benchmark: { ...bm(9, 14.1, 13), fund: { r1y: 9, r3y: null, r5y: 13 } } }, { scheme: idx });
  eq(g.ruleId, "passive-no-tracking");
});

test("Fit v2.1 C6: a gold fund exited because another gold fund is kept consolidates into it — gold stays gold", () => {
  const gold = (code, value, name) => ({ isin: `G${code}`, value, scheme: recScheme(code, "FoF Domestic", { assetClass: "Other", schemeName: name }) });
  const { by } = recPortfolio([strong(1, "Large Cap Fund", "17200.00"), strong(2, "Flexi Cap Fund", "17200.00"), strong(3, "Value Fund", "17200.00"),
    strong(4, "Focused Fund", "17200.00"), strong(5, "Large & Mid Cap Fund", "17200.00"), gold(6, "8000.00", "Gold Fund A"), gold(7, "6000.00", "Gold Fund B")]);
  const golds = [by(5), by(6)], sold = golds.filter((s) => s.status === "sell"), kept = golds.find((s) => s.status !== "sell");
  eq([sold.length, Boolean(kept)], [1, true]);   // one exits for the fund count; the last gold fund stays
  eq(/^Gold Fund [AB] \(Direct\)$/.test(sold[0].move), true);   // its money goes to the gold fund kept, not to equity
});

test("Fit v2.2 R1: duplicate gold — gold stays gold up to the 15% limit; the rest fills the portfolio's gap", () => {
  const gold = (code, value, name) => ({ isin: `G${code}`, value, scheme: recScheme(code, "FoF Domestic", { assetClass: "Other", schemeName: name }) });
  // ₹1L, ideal 2–4 funds: Gold A 12% kept, Gold B 8% exits for the count → 3 points fit under 15%, 5 go to equity.
  const { by, result } = recPortfolio([strong(1, "Large Cap Fund", "40000.00"), strong(2, "Flexi Cap Fund", "40000.00"),
    gold(3, "12000.00", "Gold Fund A"), gold(4, "8000.00", "Gold Fund B")]);
  const goldSold = [by(2), by(3)].find((s) => s.status === "sell" && !s.trim);
  const parts = Object.fromEntries(goldSold.moveSplit.map((p) => [p.to, p.pct.toFixed(1)]));
  eq(Object.entries(parts).some(([to, pct]) => /^Gold Fund [AB]/.test(to) && pct === "3.0"), true);   // the kept gold fund up to 15%
  eq(Object.entries(parts).filter(([to]) => !/^Gold Fund/.test(to)).reduce((t, [, pct]) => t + Number(pct), 0).toFixed(1), "5.0");   // the rest to equity
  eq(result.flags.some((f) => f.id === "proceeds" && /Gold Fund [AB] \(Direct\) about ₹3,000/.test(f.text)), true);
});

test("Fit v2.2 R2: small holdings are cleaned up whatever their record; the money goes to the same category first", () => {
  // ₹30L → ideal 4–8, small = below 100 / 8 × 0.25 = 3.125%. Fund 5 (Mid Cap, STRONG) is 2%: exits.
  const { by, result } = recPortfolio([strong(1, "Large Cap Fund", "720000.00"), strong(2, "Flexi Cap Fund", "720000.00"),
    strong(3, "Mid Cap Fund", "600000.00", { amc: "AMC 3" }), strong(4, "Value Fund", "900000.00"), strong(5, "Mid Cap Fund", "60000.00", { amc: "AMC 5" })]);
  eq([by(4).status, by(4).ruleId, by(4).grade], ["sell", "fit-small", "STRONG"]);
  eq(/not a view on the fund/.test(by(4).reason), true);
  eq(by(4).move, "Fund 3 (Direct)");   // the Mid Cap fund marked Invest, which has room under the 25% Mid Cap limit
  eq(result.flags.some((f) => f.id === "small" && /Fund 5 \(Direct\) is at or below 5% of the portfolio/.test(f.text)), true);
  // In the PDF the reason is a clean-up, not the fund's performance.
  const comment = fundCommentary({ name: "Fund 5", returns: { r1y: 20 }, benchmarkReturns: { r1y: 15 }, benchmark: "NIFTY Midcap 150 TRI",
    call: { grade: "STRONG", ruleId: "fit-small", stage: "portfolio", move: by(4).move, moveSplit: by(4).moveSplit, fundWeightPct: 2 } }, "sell");
  eq([/ahead of NIFTY Midcap 150 TRI/.test(comment), /at 2\.0% of the portfolio it is too small/.test(comment), /not a view on the fund/.test(comment), /consolidating the proceeds into Fund 3 \(Direct\)/.test(comment)], [true, true, true, true]);
  // The only debt / gold / hybrid fund is not sold for being small: that would change the asset mix.
  const debtOnly = recPortfolio([strong(1, "Large Cap Fund", "1450000.00"), strong(2, "Flexi Cap Fund", "1500000.00"),
    { isin: "D", value: "50000.00", scheme: recScheme(3, "Liquid Fund", DEBT), stats: recStats(DEBT_MEDIAN), group: recGroup(DEBT_MEDIAN) }]);
  eq(debtOnly.by(2).ruleId === "fit-small", false);
});

test("Fit v2.2 R2b: two small gold funds — the larger stays (less selling and tax), the smaller consolidates into it", () => {
  const gold = (code, value, name) => ({ isin: `G${code}`, value, scheme: recScheme(code, "FoF Domestic", { assetClass: "Other", schemeName: name }) });
  const { by } = recPortfolio([strong(1, "Large Cap Fund", "1600000.00"), strong(2, "Flexi Cap Fund", "1600000.00"), strong(3, "Value Fund", "1500000.00"),
    gold(4, "50000.00", "Gold Fund Tiny"), gold(5, "250000.00", "Gold Fund Larger")]);
  eq([by(3).status, by(3).ruleId, by(3).move, by(4).status], ["sell", "fit-small", "Gold Fund Larger (Direct)", "hold"]);
});

test("Fit v2.3 R2c: the only overseas fund is kept however small, and new money is suggested for it", () => {
  const abroad = (code, value) => ({ isin: `O${code}`, value, scheme: recScheme(code, "FoF Overseas", { assetClass: "Other", schemeName: `Global Fund ${code}` }) });
  const one = recPortfolio([strong(1, "Large Cap Fund", "1500000.00"), strong(2, "Flexi Cap Fund", "1500000.00"), strong(3, "Value Fund", "1380000.00"), abroad(4, "120000.00")]);
  eq([one.by(3).status === "sell", one.result.flags.some((f) => f.id === "overseas" && /only overseas fund, at 2\.7%/.test(f.text) && /about ₹3,30,000/.test(f.text))], [false, true]);
  // Two small overseas funds: the larger stays, the smaller consolidates into it.
  const two = recPortfolio([strong(1, "Large Cap Fund", "1500000.00"), strong(2, "Flexi Cap Fund", "1500000.00"), strong(3, "Value Fund", "1300000.00"), abroad(4, "150000.00"), abroad(5, "50000.00")]);
  eq([two.by(4).status, two.by(4).move, two.by(3).status === "sell"], ["sell", "Global Fund 4 (Direct)", false]);
});

test("Fit v2.2 R3: proceeds fill the Large / Mid / Small gap first, each fund only up to its room", () => {
  const caps = (id, large, mid, small) => ({ holdings: [["large", large], ["mid", mid], ["small", small]].map(([marketCap, weight]) => ({ isin: `${id}-${marketCap}`, assetType: "equity", marketCap, weight })) });
  // ₹50L: four Invest funds at 12.5% (room 7.5 each under 20%), two Hold funds, and a WEAK fund at 10% that exits.
  // The equity is mostly large caps, so the Invest fund with the most mid / small caps (Fund 2) takes the money first.
  const { by } = recPortfolio([strong(1, "Large Cap Fund", "625000.00"), strong(2, "Flexi Cap Fund", "625000.00"), strong(3, "Value Fund", "625000.00"),
    strong(4, "Focused Fund", "625000.00"), mixed(5, "Multi Cap Fund", "1000000.00"), mixed(6, "Large & Mid Cap Fund", "1000000.00"),
    { isin: "W", value: "500000.00", scheme: recScheme(7, "Contra Fund"), stats: recStats(WEAK) }],
  { fundHoldings: { S1: caps("a", 95, 5, 0), S2: caps("b", 40, 35, 25), S3: caps("c", 90, 10, 0), S4: caps("d", 92, 8, 0), W: caps("e", 90, 10, 0) } });
  eq(by(6).status, "sell");
  eq(by(6).moveSplit[0].to, "Fund 2 (Direct)");
  eq(by(6).moveSplit[0].pct >= Math.max(...by(6).moveSplit.map((p) => p.pct)), true);
  eq(by(6).moveSplit.every((p) => p.to !== "the Prosperr Recommended Portfolio"), true);   // 10 points fit in 30 points of room
});

test("Fit P9: 400 random portfolios — the safety rules hold in every one (seeded, repeatable)", () => {
  let seed = 20261023;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const CATS = ["Large Cap Fund", "Mid Cap Fund", "Small Cap Fund", "Flexi Cap Fund", "Value Fund", "ELSS (Tax Saver)", "Sectoral/Thematic", "Index Funds", "FoF Domestic", "Liquid Fund", "Aggressive Hybrid Fund"];
  const tx = (date, units) => ({ date, description: "Purchase", amount: 1000, units, price: 10, unitBalance: null, raw: {} });
  for (let run = 0; run < 400; run++) {
    const n = 1 + Math.floor(rnd() * 30);
    const scale = pick([1000, 20000, 300000, 2000000]);   // ₹ portfolio sizes across every Diversification band
    const funds = [];
    for (let i = 0; i < n; i++) {
      const cat = pick(CATS), code = run * 100 + i + 1;
      const extra = cat === "Index Funds" || cat === "FoF Domestic" ? { assetClass: "Other" } : cat === "Liquid Fund" ? { ...DEBT } : /Hybrid/.test(cat) ? { assetClass: "Hybrid" } : {};
      if (cat === "FoF Domestic") extra.schemeName = `Gold Fund ${code}`;
      if (rnd() < 0.3) extra.amc = "AMC Big";
      const stats = cat === "Liquid Fund" ? recStats(DEBT_MEDIAN)
        : recStats(pick([{}, IN_LINE, WEAK, { ...IN_LINE, r3y: 14.4, r5y: 13.6 }, { benchmark: bm(9, 15, 14) }, { benchmark: bm(12, 17.3, 15.5) }]));
      const f = { isin: `R${code}`, value: (scale * (0.05 + rnd())).toFixed(2), scheme: recScheme(code, cat, extra),
        stats: cat === "FoF Domestic" ? undefined : stats, group: cat === "Liquid Fund" ? recGroup(DEBT_MEDIAN) : undefined };
      if (cat === "ELSS (Tax Saver)") Object.assign(f, { units: "100.000", txns: [tx(rnd() < 0.5 ? "2025-06-01" : "2021-01-01", 100)] });
      funds.push(f);
    }
    const { result, by } = recPortfolio(funds);
    const all = funds.map((f, i) => ({ f, s: by(i) }));
    for (const { f, s } of all) {
      const label = `run ${run}, ${f.scheme.category} ${f.isin}`;
      eq(["invest", "hold", "sell", "review"].includes(s.status), true, label);
      if (s.ruleId === "fit-exit") {
        eq(s.reason.startsWith("Portfolio fit — "), true, label);
        eq(s.grade !== "STRONG" || s.weightPct < result.fit.smallPct || s.reason.includes("index funds / ETFs where") || s.reason.includes("debt and arbitrage funds where") || /% of the portfolio \(limit \d+%\)/.test(s.reason), true, `${label}: a large STRONG fund sold for fit`);
      }
      if (s.grade === "REVIEW") eq(s.status, "review", label);
      if (f.scheme.category === "ELSS (Tax Saver)" && f.txns[0].date === "2025-06-01") eq(s.status === "sell", false, `${label}: locked ELSS sold`);
    }
    // The last gold / silver fund is never exited for fit.
    const gold = all.filter(({ f }) => f.scheme.category === "FoF Domestic");
    if (gold.length) eq(gold.some(({ s }) => s.status !== "sell" || s.trim), true, `run ${run}: every gold fund exited`);
    // Money only moves to a fund that is INVEST in the final result (or, for gold / silver and overseas, the kept fund of
    // its kind), and no fund is filled above the one-fund limit or a capped category above its limit by the money.
    const nameOf = (f) => `${f.scheme.schemeName} (${f.scheme.plan})`;
    const invest = new Set(all.filter(({ s }) => s.status === "invest").map(({ f }) => nameOf(f)));
    const inflow = new Map();
    for (const { f, s } of all) {
      if (s.status !== "sell" || !s.moveSplit) continue;
      eq(Math.abs(s.moveSplit.reduce((t, p) => t + p.share, 0) - 1) < 1e-6, true, `run ${run}, ${f.isin}: shares add to 1`);
      for (const p of s.moveSplit) {
        const keptSame = all.find(({ f: o, s: t }) => nameOf(o) === p.to && t.status !== "sell" && t.engine === s.engine && ["commodity", "overseas"].includes(s.engine));
        eq(p.to === "the Prosperr Recommended Portfolio" || invest.has(p.to) || Boolean(keptSame), true, `run ${run}, ${f.isin}: money moved to ${p.to}`);
        inflow.set(p.to, (inflow.get(p.to) ?? 0) + p.pct);
      }
    }
    const after = (f, s) => (s.status === "sell" ? (s.trim ? s.trim.toPct : 0) : s.weightPct) + (inflow.get(nameOf(f)) ?? 0);
    const keptCount = all.filter(({ s }) => s.status !== "sell" || s.trim).length;
    for (const { f, s } of all) {
      if (!inflow.has(nameOf(f)) || !["Large Cap Fund", "Mid Cap Fund", "Small Cap Fund", "Flexi Cap Fund", "Value Fund"].includes(f.scheme.category)) continue;
      eq(after(f, s) <= Math.max(20, 100 / keptCount) + 1e-6, true, `run ${run}, ${f.isin}: filled above the one-fund limit`);
    }
    for (const [cat, limit] of [["Mid Cap Fund", 25], ["Small Cap Fund", 15]]) {
      const group = all.filter(({ f }) => f.scheme.category === cat);
      if (group.some(({ f }) => inflow.has(nameOf(f)))) eq(group.reduce((t, { f, s }) => t + after(f, s), 0) <= limit + 1e-6, true, `run ${run}: ${cat} filled above its limit`);
    }
    // A Hold never sends new money to a fund that does not take it.
    for (const { f, s } of all) {
      const target = s.status === "hold" && /new money goes there/.test(s.reason) ? /same stocks as (.+?), the stronger/.exec(s.reason)?.[1] ?? /Same index as (.+?), which/.exec(s.reason)?.[1] : null;
      if (target) eq(invest.has(target), true, `run ${run}, ${f.isin}: new money sent to ${target}`);
    }
    // Stage 1 grade is never rewritten: a fund graded WEAK is weak on its own numbers.
    for (const { s } of all) eq(["overlap-weaker", "weakest-in-category", "fit-exit", "fit-trim"].includes(s.ruleId) && s.grade === "WEAK" && !/fit/.test(s.ruleId), false, `run ${run}: grade rewritten`);
    // Fund-count exits stay within the review's limit by value.
    eq(result.fit.stagedPct <= 25 + 1e-6, true, `run ${run}: staged limit`);
    // Equity index funds together stay at 20%, unless a lock or the exits left them lower.
    const idx = all.filter(({ f, s }) => f.scheme.category === "Index Funds" && !(s.status === "sell" && !s.trim));
    eq(idx.length <= result.fit.passiveMax, true, `run ${run}: too many index funds`);
    // A cut smaller than the 1% minimum trade is not made, so the total may sit that little above 20%.
    eq(idx.reduce((t, { s }) => t + (s.trim ? s.trim.toPct : s.weightPct), 0) <= 20 + 1 + 1e-6, true, `run ${run}: index funds above 20%`);
    eq(Array.isArray(result.flags) && result.flags.every((x) => typeof x.text === "string" && x.text.length > 10), true, `run ${run}: box`);
  }
});

// ---------- Stage 2: no call contradicts another ----------
const REC_BIG = "1,00,00,000.00";   // a large portfolio, so no test fund passes 20% by accident
const padding = (n) => [...Array(n)].map((_, i) => ({ isin: `Z${i}`, value: REC_BIG, scheme: recScheme(900 + i, "Retirement Fund", { assetClass: "Solution Oriented Scheme" }), stats: recStats() }));
const sameStocks = { holdings: [...Array(10)].map((_, i) => ({ isin: `STK${i}`, assetType: "equity", weight: 10 })) };

test("Stage 2 C1: same category and high overlap never point at each other — exactly one fund takes the money", () => {
  const flat = bm(10, 15, 14), value = "50,00,000.00";
  const { by } = recPortfolio([
    { isin: "A", value, scheme: recScheme(1, "Large Cap Fund"), stats: recStats({ r3y: 22, r5y: 14.5, consistency: 70, sharpe3y: 1, maxDrawdown3y: -18, benchmark: flat }) },
    { isin: "B", value, scheme: recScheme(2, "Large Cap Fund"), stats: recStats({ r3y: 16, r5y: 15.5, consistency: 90, sharpe3y: 1.2, maxDrawdown3y: -12, benchmark: flat }) }, ...padding(6)],
  { fundHoldings: { A: sameStocks, B: sameStocks } });
  eq([by(0).status, by(1).status].sort(), ["hold", "invest"]);
});

test("Stage 2 C2: a STRONG fund never gives way to a MIXED one", () => {
  const value = "50,00,000.00";
  const { by } = recPortfolio([
    { isin: "A", value, scheme: recScheme(1, "Flexi Cap Fund"), stats: recStats({ r3y: 15.1, r5y: 14.1, consistency: 66, sharpe3y: 0.81, maxDrawdown3y: -19.9, benchmark: bm(10, 14, 13) }) },
    { isin: "B", value, scheme: recScheme(2, "Multi Cap Fund"), stats: recStats({ r1y: 11, r3y: 18, r5y: 13.5, consistency: 60, sharpe3y: 1.1, maxDrawdown3y: -15, quartile3y: 2, benchmark: bm(10, 16, 12) }) }, ...padding(6)],
  { fundHoldings: { A: sameStocks, B: sameStocks } });
  eq([by(0).status, by(1).status, by(1).ruleId, by(1).grade], ["invest", "sell", "overlap-weaker", "MIXED"]);
});

test("Stage 2 C3: no chain — a fund is never told to consolidate into a fund that is itself sold", () => {
  const flat = bm(10, 15, 14), part = { holdings: [...Array(10)].map((_, i) => ({ isin: i < 6 ? `STK${i}` : `OTH${i}`, assetType: "equity", weight: 10 })) };
  const low = { ...IN_LINE, r3y: 15.3, r5y: 14.2, benchmark: flat };
  const { result } = recPortfolio([
    { isin: "A", value: "50,00,000.00", scheme: recScheme(1, "Flexi Cap Fund"), stats: recStats({ ...low, r3y: 15.5 }) },
    { isin: "B", value: "50,00,000.00", scheme: recScheme(2, "Multi Cap Fund"), stats: recStats({ ...low, consistency: 45, sharpe3y: 0.75, maxDrawdown3y: -22 }) },
    { isin: "C", value: "50,00,000.00", scheme: recScheme(3, "Value Fund"), stats: recStats({ ...low, r3y: 15.9 }) }, ...padding(6)],
  { fundHoldings: { A: sameStocks, B: sameStocks, C: part } });
  const sold = Object.values(result.suggestions).filter((s) => s.status === "sell");
  eq(sold.filter((s) => s.move && /Fund [123] /.test(s.move)).length, 0);   // none of them is an INVEST fund: no consolidation is claimed
});

test("Stage 2 C4: the best index tracker above the limit is replaced; a poor tracker never takes money", () => {
  const idx = (code, value, r3y, name = "NIFTY 50", code2 = "OB48") => ({ isin: `I${code}`, value, scheme: recScheme(code, "Index Funds", { assetClass: "Other", schemeName: `${name} Index Fund` }), stats: recStats({ r3y, benchmark: bm(10, 15, 14, name, code2) }) });
  // Both track well and together are 12% each: 24% → 10% each.
  const both = recPortfolio([idx(1, "1,50,00,000.00", 14.9), idx(2, "1,50,00,000.00", 14.8, "NIFTY Next 50", "B2"), ...padding(9)]);
  eq([both.by(0).trim?.toPct.toFixed(1), both.by(1).trim?.toPct.toFixed(1)], ["10.0", "10.0"]);
  eq(both.by(0).ruleId, "fit-trim");
  // One good, one poor: the better one keeps the larger share.
  const one = recPortfolio([idx(1, "2,00,00,000.00", 14.9), idx(2, "2,00,00,000.00", 13.5, "NIFTY Next 50", "B2"), ...padding(9)]);
  eq([one.by(0).trim?.toPct.toFixed(1), one.by(1).trim?.toPct.toFixed(1)], ["12.0", "8.0"]);
  // All poor: every one exits, and a good tracker is suggested.
  const poor = recPortfolio([idx(1, "60,00,000.00", 13.5), idx(2, "60,00,000.00", 13.4, "NIFTY Next 50", "B2"), ...padding(9)]);   // 5.9% each: above the 5% clean-up
  eq([poor.by(0).status, poor.by(1).status, poor.result.flags.some((f) => f.id === "passive" && /trails its index/.test(f.text))], ["sell", "sell", true]);
  // Four good funds where 3 are enough: the box only promises what is marked.
  const four = recPortfolio([idx(1, "40,00,000.00", 14.95), idx(2, "40,00,000.00", 14.9, "NIFTY Next 50", "B2"), idx(3, "40,00,000.00", 14.85, "NIFTY Midcap 150", "B3"), idx(4, "40,00,000.00", 14.8, "NIFTY Smallcap 250", "B4"), ...padding(9)]);
  eq(four.by(3).status, "sell");
});

test("Stage 2 C5: a weak ELSS kept by its lock-in stays in the fund count", () => {
  const tx = [{ date: "2026-01-01", description: "Purchase", amount: 1000, units: 100, price: 10, unitBalance: null, raw: {} }];
  const { result } = recPortfolio([mixed(1, "Flexi Cap Fund", "20000.00"), mixed(2, "Value Fund", "20000.00"), mixed(3, "Mid Cap Fund", "20000.00"), mixed(4, "Small Cap Fund", "20000.00"),
    { isin: "E", value: "20000.00", units: "100.000", scheme: recScheme(9, "ELSS (Tax Saver)"), stats: recStats(WEAK), txns: tx }]);
  eq([result.fit.exits, result.fit.fundsAfter], [1, 4]);
});

test("Stage 2 C6: overseas funds share a 30% limit, equally or with more for the clearly better one", () => {
  const over = (code, name, value, r3y = 14.9) => ({ isin: `O${code}`, value, scheme: recScheme(code, "Index Funds", { assetClass: "Other", schemeName: name }), stats: recStats({ r3y, benchmark: bm(10, 15, 14, name, `B${code}`) }) });
  const alike = recPortfolio([over(1, "S&P 500 Index Fund", "2,00,00,000.00"), over(2, "NASDAQ 100 Index Fund", "2,00,00,000.00"), ...padding(7)]);
  const shares = [alike.by(0), alike.by(1)].map((x) => (x.trim ? x.trim.toPct : x.weightPct));
  eq(shares.reduce((a, b) => a + b, 0) <= 30.001, true);
  eq(alike.by(0).status === "invest" || alike.by(1).status === "invest", false);
  const fof = (code, value, stats) => ({ isin: `F${code}`, value, scheme: recScheme(code, "FoF Overseas", { assetClass: "Other" }), stats });
  const lead = recPortfolio([fof(1, "2,50,00,000.00", recStats({ r3y: 20, r5y: 18, sharpe3y: 1.4, maxDrawdown3y: -10, consistency: 90 })),
    fof(2, "2,50,00,000.00", recStats({ r3y: 10, r5y: 9, sharpe3y: 0.3, maxDrawdown3y: -30, consistency: 20 })), ...padding(5)]);
  eq([lead.by(0).trim.toPct.toFixed(0), lead.by(1).trim.toPct.toFixed(0)], ["18", "12"]);
});

test("Stage 2 C6b: debt and arbitrage — above 20% is left alone, at most 2–3 funds, equal shares, money stays in debt", () => {
  const debt = (code, value, cat, stats) => ({ isin: `D${code}`, value, scheme: recScheme(code, cat, DEBT), stats: recStats({ ...DEBT_MEDIAN, ...stats }), group: recGroup(DEBT_MEDIAN) });
  const alone = recPortfolio([debt(1, "70,00,000.00", "Liquid Fund"), strong(2, "Flexi Cap Fund", "15,00,000.00"), strong(3, "Mid Cap Fund", "15,00,000.00")]);
  eq(alone.by(0).status === "sell", false);   // 70%, but debt is outside the 20% limit
  const many = recPortfolio([debt(1, "30,00,000.00", "Liquid Fund", { r3y: 8, r5y: 7.5, r1y: 8, quartile3y: 1 }), debt(2, "10,00,000.00", "Corporate Bond Fund", { r3y: 7.2, r5y: 6.7, quartile3y: 2 }),
    debt(3, "10,00,000.00", "Gilt Fund", { r3y: 7.1, r5y: 6.6, quartile3y: 2 }), debt(4, "10,00,000.00", "Short Duration Fund", { r3y: 7.05, r5y: 6.55, quartile3y: 2 }), ...padding(4).map((f) => ({ ...f, value: "10,00,000.00" }))]);
  const calls = [0, 1, 2, 3].map((i) => many.by(i));
  eq(calls.filter((x) => x.status === "sell" && !x.trim).length >= 1, true);
  const debtNames = new Set([1, 2, 3, 4].map((code) => `Fund ${code} (Direct)`));
  // The money stays in debt funds while one can take it; past the fund house's 25% it goes to the Recommended Portfolio.
  eq(calls.filter((x) => x.moveSplit).every((x) => x.moveSplit.every((p) => debtNames.has(p.to) || p.to === "the Prosperr Recommended Portfolio")), true);
  eq(calls.filter((x) => x.moveSplit).some((x) => x.moveSplit.some((p) => debtNames.has(p.to))), true);
});

test("Stage 2 C6c: the Large / Mid / Small basket is the lower of what risk and horizon allow", () => {
  const b = (risk, horizon) => capBasket({ risk: { label: risk }, horizon: { label: horizon } }, RECOMMENDATION).label;
  eq([b("Aggressive", "Long Term"), b("Aggressive", "Short Term"), b("Moderate", "Long Term"), b("Conservative", "Long Term"), b(null, null), b("Aggressive", null)],
     ["Growth", "Conservative", "Balanced", "Conservative", "Balanced", "Growth"]);
});

test("Stage 2 C6d: index prices a day behind the NAVs — the comparison uses the fund on the index's own date", () => {
  const late = { ...bm(9, 15, 14), anchorDate: "2026-10-20", fund: { r1y: 9, r3y: 15, r5y: 14 } };
  const g = recGrade("Flexi Cap Fund", { r1y: 11, r3y: 17, r5y: 16, benchmark: late });
  eq(g.pillars.B.text.includes("3Y +0.00 pp, 5Y +0.00 pp"), true);   // not +2.00: the extra day is not counted
});

test("Auto Y2: a gold-mining FoF is overseas equity, not gold; overseas funds in Indian categories count in the overseas limit", () => {
  eq(engineOf({ category: "FoF Overseas", assetClass: "Other", schemeName: "DSP World Gold Mining Overseas Equity Omni FoF" }), "overseas");
  eq(engineOf({ category: "Gold ETF", assetClass: "Other", schemeName: "Some Gold ETF" }), "commodity");
  const us = (code, value) => ({ isin: `U${code}`, value, scheme: recScheme(code, "Thematic Fund", { schemeName: `US Equity Opportunities Fund ${code}` }), stats: recStats({ benchmark: bm(9, 15, 14, "S&P 500 Index", `SP${code}`) }) });
  const { by } = recPortfolio([us(1, "2,00,00,000.00"), us(2, "2,00,00,000.00"), ...padding(6)]);
  eq([by(0), by(1)].some((x) => x.reason.includes("overseas funds are")), true);
  eq([by(0), by(1)].some((x) => x.reason.includes("sectoral / thematic funds are")), false);
});

test("Stage 2 C9: sale money stays on its side — equity to equity, debt to debt; a debt fund is not stopped at 20%", () => {
  const debt = (code, value, cat) => ({ isin: `D${code}`, value, scheme: recScheme(code, cat, DEBT), stats: recStats({ ...DEBT_MEDIAN, r3y: 7.5, r5y: 7, quartile3y: 1 }), group: recGroup(DEBT_MEDIAN) });
  const { by } = recPortfolio([debt(1, "30,00,000.00", "Liquid Fund"), debt(2, "20,00,000.00", "Corporate Bond Fund"),
    { isin: "W", value: "20,00,000.00", scheme: recScheme(3, "Large Cap Fund"), stats: recStats(WEAK) }]);
  // 43% and 29%: outside the 20% limit, but two debt funds are kept equal — the larger is cut and its money stays in debt.
  eq([by(0).status, by(0).trim?.toPct.toFixed(1), by(0).move, by(1).status], ["sell", "35.7", "Fund 2 (Direct)", "invest"]);
  eq([by(2).status, by(2).move], ["sell", "the Prosperr Recommended Portfolio"]);   // no equity fund takes it: never into debt
});

test("Stage 2 C10: index funds — a second fund on the same index goes first; a stub left by a cut exits in full", () => {
  const idx = (code, value, r3y, name, c) => ({ isin: `I${code}`, value, scheme: recScheme(code, "Index Funds", { assetClass: "Other", schemeName: `${name} Index Fund ${code}` }), stats: recStats({ r3y, benchmark: bm(10, 15, 14, name, c) }) });
  const { by } = recPortfolio([idx(1, "80,00,000.00", 14.95, "NIFTY 50", "N50"), idx(2, "80,00,000.00", 14.9, "NIFTY 50", "N50"), idx(3, "80,00,000.00", 14.8, "NIFTY Midcap 150", "M150"),
    idx(4, "80,00,000.00", 14.7, "NIFTY Smallcap 250", "S250"), ...padding(9)]);   // 6.6% each: above the 5% clean-up
  eq([by(1).status, by(1).trim, by(1).reason.includes("already covers the same index")], ["sell", null, true]);
  const thematic = (code, value, b) => ({ isin: `T${code}`, value, scheme: recScheme(code, "Sectoral/Thematic"), stats: recStats({ benchmark: b }) });
  const stub = recPortfolio([strong(1, "Large Cap Fund", "45000.00"), strong(2, "Mid Cap Fund", "30000.00"), thematic(3, "16000.00", bm(12, 17.3, 15.5)), thematic(4, "9000.00", bm(9, 15, 14))]);
  eq([stub.by(2).status, stub.by(2).trim], ["sell", null]);   // 16% cut to 6% would leave less than a small holding (6.25%)
});

test("Stage 2 C11: same index, tracking within 0.5 pp — the large holding stays and the tiny one goes; one fund is flagged under-diversified", () => {
  const idx = (code, value, r3y) => ({ isin: `I${code}`, value, scheme: recScheme(code, "Index Funds", { assetClass: "Other", schemeName: `NIFTY 50 Index Fund ${code}` }), stats: recStats({ r3y, benchmark: bm(10, 15, 14, "NIFTY 50", "N50") }) });
  const { by } = recPortfolio([idx(1, "1,50,00,000.00", 14.85), idx(2, "3,00,000.00", 14.95), ...padding(8)]);
  eq([by(0).status, by(1).status, by(1).ruleId, by(1).move], ["invest", "sell", "fit-small", "NIFTY 50 Index Fund 1 (Direct)"]);   // 0.1 pp better tracking: the large fund leads; v2.2: the 0.3% stub is cleaned up into it
  const one = recPortfolio([strong(1, "Flexi Cap Fund", "9,00,000.00")]);
  eq(one.result.flags.some((f) => f.id === "count" && /holds 1 fund, fewer than/.test(f.text)), true);
});

test("Auto Y1: 1-year rule, young funds only — bottom quarter: recovering → HOLD, not → SELL; an established fund is not judged on 1Y", () => {
  const median = { r3m: 2, r6m: 4 };
  const young = { r3y: null, r5y: null, firstDate: "2025-03-01", r1y: 6, rank1y: 29, quartile1y: 4, n1y: 30 };   // 4 pp behind the 1Y median
  const recovering = recGrade("Flexi Cap Fund", { ...young, r6m: 5, r3m: 1 }, { median });
  eq([recovering.grade, recovering.ruleId], ["MIXED", "young-1y-recovering"]);
  const notRecovering = recGrade("Flexi Cap Fund", { ...young, r6m: 2, r3m: 0.5 }, { median });
  eq([notRecovering.grade, notRecovering.ruleId, /Bottom quarter of its category over 1Y \(rank 29 of 30\)/.test(notRecovering.reason)], ["WEAK", "young-1y-no-recovery", true]);
  eq(recGrade("Flexi Cap Fund", { ...young, quartile1y: 2 }, { median }).ruleId, "young");   // not in the bottom quarter: advisor decides
  eq(recGrade("Flexi Cap Fund", { ...young, r1y: 8.5, r6m: 2, r3m: 0.5 }, { median }).ruleId, "young");   // within 2 pp: not "worst"
  const established = recGrade("Flexi Cap Fund", { ...IN_LINE, r1y: 6, rank1y: 29, quartile1y: 4, n1y: 30, r6m: 2, r3m: 0.5 }, { median });
  eq(established.ruleId.startsWith("young"), false);
  eq(established.grade, "MIXED");
});

test("Stage 2 C7: consolidation is staged by value; the box says how far this review goes", () => {
  const cats = ["Flexi Cap Fund", "Value Fund", "Mid Cap Fund", "Small Cap Fund", "Multi Cap Fund", "Contra Fund", "Focused Fund", "Dividend Yield Fund", "Large & Mid Cap Fund", "Large Cap Fund"];
  const funds = cats.map((cat, i) => mixed(i + 1, cat, "1,00,00,000.00", { r3y: 15.1 + i / 10 }));
  const many = [...funds, ...funds.map((f, i) => ({ ...f, isin: `X${i}`, scheme: recScheme(i + 50, `${cats[i]} B`) }))];
  const { result } = recPortfolio(many);   // 20 funds, ideal 6–13: seven must go, but 25% of the value allows five
  eq([result.fit.exits, result.fit.fundsAfter, result.fit.staged], [5, 15, true]);
  eq(result.flags.some((f) => f.id === "count" && /staged over later reviews/.test(f.text)), true);
});

test("Stage 2 C8: a partial sale counts only the amount sold, the rest stays as Hold", () => {
  const { by } = recPortfolio([strong(1, "Flexi Cap Fund", "40000.00"), mixed(2, "Value Fund", "20000.00"), mixed(3, "Mid Cap Fund", "20000.00"), mixed(4, "Small Cap Fund", "10000.00"), mixed(5, "Contra Fund", "10000.00")]);
  eq([by(0).status, by(0).trim.toPct, Math.round(by(0).trim.amount)], ["sell", 20, 20000]);
  eq(by(0).reason.includes("from 40.0% to 20.0%"), true);
  eq(by(0).move !== null, true);
});

test("Detailed report: Portfolio Overlap — lower-triangle matrix (0–1), one entry per fund, stock-free funds left out, high pairs listed", () => {
  const p = samplePortfolio();
  const active = p.holdings.filter((h) => h.status === "active");
  const eqRows = (pairs) => ({ asOn: "2026-09", holdings: pairs.map(([isin, weight]) => ({ assetType: "equity", isin, weight })) });
  const [a, b, c, d] = active;
  const fundHoldings = {
    [a.isin]: eqRows([["S1", 40], ["S2", 30], ["S3", 30]]),
    [b.isin]: eqRows([["S1", 40], ["S2", 30], ["S9", 30]]),            // 70% the same stocks as a
    [c.isin]: eqRows([["X1", 50], ["X2", 50]]),                          // nothing in common
    [d.isin]: { asOn: "2026-09", holdings: [{ assetType: "debt", isin: "B1", weight: 100 }] },   // no stocks → not compared
  };
  const m = buildDetailedReport({ portfolio: p, fundData: SAMPLE_FUND_DATA, verdicts: {}, fundHoldings });
  const o = m.overlap;
  eq(o.funds.length, 3);
  eq(o.funds.some((f) => f.isin === d.isin), false);
  const all = [...o.buckets.high, ...o.buckets.moderate, ...o.buckets.low];
  const at = (x, y) => all.find((p) => [p.a, p.b].sort().join("|") === [x, y].map((h) => o.funds.find((f) => f.isin === h.isin).name).sort().join("|")).overlap;
  eq([at(a, b).toFixed(2), at(a, c).toFixed(2)], ["0.70", "0.00"]);
  // closest overlap for every fund: a and b share one row; c has none above 10% → its own row
  eq(o.closest.map((r) => (r.solo ? "solo" : r.overlap.toFixed(2))), ["0.70", "solo"]);
  eq(o.pairs.map((x) => x.overlap.toFixed(2)), ["0.70"]);
  eq(buildDetailedReport({ portfolio: p, fundData: SAMPLE_FUND_DATA, verdicts: {} }).overlap, null);   // no holdings data
});

test("Detailed report: Portfolio Overlap — every fund in the matrix (no cap), buckets with shared stocks, duplicates once", () => {
  const p = samplePortfolio();
  const active = p.holdings.filter((h) => h.status === "active");
  const eqRows = (pairs) => ({ asOn: "2026-09", holdings: pairs.map(([isin, weight]) => ({ assetType: "equity", isin, name: `Stock ${isin}`, weight })) });
  // 14 equity holdings (more than the old 12-fund cap)
  const sample = Array.from({ length: 14 }, (_, i) => ({ ...structuredClone(active[0]), isin: `INFTEST${String(i).padStart(4, "0")}`, schemeName: `Test ${String.fromCharCode(65 + i)} Large Cap Fund - Direct Plan - Growth`, folio: `F${i}` }));
  // the same scheme again in its Regular plan → one fund
  sample.push({ ...structuredClone(sample[0]), isin: "INFTESTREG01", schemeName: "Test A Large Cap Fund - Regular Plan - Growth", folio: "F99" });
  const portfolio = { ...p, holdings: sample };
  const fundHoldings = Object.fromEntries(sample.map((h, i) => [h.isin, i === 1 ? eqRows([["S1", 40], ["S2", 30], ["S9", 30]])
    : i === 2 ? eqRows([["S1", 30], ["X2", 70]]) : i < 14 && i > 2 ? eqRows([[`Z${i}`, 100]]) : eqRows([["S1", 40], ["S2", 30], ["S3", 30]])]));
  const info = Object.fromEntries(sample.map((h) => [h.isin, { assetClass: "equity", category: "Large Cap Fund" }]));
  const o = buildDetailedReport({ portfolio, fundData: { ...SAMPLE_FUND_DATA, funds: info }, verdicts: {}, fundHoldings }).overlap;
  eq(o.funds.length, 14);                                                    // all funds; Regular + Direct of Test A once
  eq(o.funds.filter((f) => /Test A/.test(f.name)).map((f) => f.name), ["Test A Large Cap Fund"]);   // plan-neutral name
  const n = 14 * 13 / 2;
  // every fund appears in the closest-overlap chart: 1 row for funds 1–3 (A↔B 70%, C closest to A or B at 30%), 11 solo
  const inChart = new Set(o.closest.flatMap((r) => (r.solo ? [r.n] : [r.aN, r.bN])));
  eq(inChart.size, 14);
  eq(o.buckets.high.length + o.buckets.moderate.length + o.buckets.low.length, n);
  const high = o.buckets.high[0];
  eq([high.overlap.toFixed(2), high.band, high.shared], ["0.70", "high", ["Stock S1", "Stock S2"]]);
  eq(o.buckets.moderate.map((x) => x.overlap.toFixed(2)), ["0.30", "0.30"]);
  eq(o.buckets.low.every((x) => x.overlap < 0.25 && x.band === "low"), true);
  eq(o.distinct.length, 11);                                                 // funds 4–14 share nothing with anyone
});

test("Detailed report: Portfolio Overlap — hybrid funds compared; FoFs, arbitrage, debt and gold funds left out", () => {
  const p = samplePortfolio();
  const base = p.holdings.filter((h) => h.status === "active")[0];
  const mk = (isin, schemeName) => ({ ...structuredClone(base), isin, schemeName, folio: isin });
  const sample = [mk("INFT0001", "Alpha Large Cap Fund - Direct Growth"), mk("INFT0002", "Beta Aggressive Hybrid Fund - Direct Growth"),
    mk("INFT0003", "Gamma Diversified Equity All Cap Active FOF - Direct Growth"), mk("INFT0004", "Delta Arbitrage Fund - Direct Growth"),
    mk("INFT0005", "Epsilon Gold ETF FOF - Direct Growth"), mk("INFT0006", "Zeta Corporate Bond Fund - Direct Growth")];
  const stocks = { assetType: "equity", isin: "S1", name: "Stock S1", weight: 100 };
  const fundHoldings = Object.fromEntries(sample.map((h) => [h.isin, { asOn: "2026-09", holdings: [stocks] }]));
  const info = { INFT0001: ["equity", "Large Cap Fund"], INFT0002: ["hybrid", "Aggressive Hybrid Fund"], INFT0003: ["equity", "FoF Domestic"],
    INFT0004: ["hybrid", "Arbitrage Fund"], INFT0005: ["goldSilver", "FoF Domestic"], INFT0006: ["debt", "Corporate Bond Fund"] };
  const funds = Object.fromEntries(Object.entries(info).map(([isin, [assetClass, category]]) => [isin, { assetClass, category }]));
  const o = buildDetailedReport({ portfolio: { ...p, holdings: sample }, fundData: { ...SAMPLE_FUND_DATA, funds }, verdicts: {}, fundHoldings }).overlap;
  eq(o.funds.map((f) => f.isin).sort(), ["INFT0001", "INFT0002"]);
});

test("Report commentary: a Sell states only its real basis (weak fund / portfolio fit / advisor's own choice)", () => {
  const row = (call) => ({ name: "X Fund", category: "Mid Cap Fund", benchmark: "NIFTY Midcap 150 Index", returns: { r1y: 12 }, benchmarkReturns: { r1y: 10 }, call });
  const weak = fundCommentary(row({ grade: "WEAK", stage: "fund" }), "sell");
  const fit = fundCommentary(row({ grade: "STRONG", stage: "portfolio" }), "sell");
  const own = fundCommentary(row(null), "sell");
  eq(/trails its peers/.test(weak), true);
  eq([/trails its peers/.test(fit), /consolidate the portfolio/.test(fit), /ahead of NIFTY Midcap 150 Index/.test(fit)], [false, true, true]);
  eq([/trails its peers/.test(own), /We recommend exiting it/.test(own)], [false, true]);
  // The 1-year rule says what it is, never "trails its peers"; an overlap sale names the fund it consolidates into.
  const oneYear = fundCommentary(row({ grade: "WEAK", stage: "fund", ruleId: "young-1y-no-recovery" }), "sell");
  eq([/bottom quarter of its category over the past year/.test(oneYear), /trails its peers/.test(oneYear)], [true, false]);
  const overlap = fundCommentary(row({ grade: "MIXED", stage: "fund", ruleId: "overlap-weaker", move: "Y Fund (Direct)" }), "sell");
  eq([/duplicates Y Fund \(Direct\)/.test(overlap), /consolidating into Y Fund \(Direct\)/.test(overlap)], [true, true]);
  // A Hold never invites fresh money: that goes to the Invest funds.
  eq(/fresh investment directed to the funds marked Invest/.test(fundCommentary(row(null), "hold")), true);
});

test("Detailed report: the logic's basis reaches a row only when the advisor kept that call", () => {
  const p = samplePortfolio();
  const keys = p.holdings.filter((h) => h.status === "active").map((h) => holdingKey(h));
  const calls = { [keys[0]]: { verdict: "sell", grade: "STRONG", stage: "portfolio" }, [keys[1]]: { verdict: "sell", grade: "WEAK", stage: "fund" } };
  const m = buildDetailedReport({ portfolio: p, fundData: SAMPLE_FUND_DATA, verdicts: { [keys[0]]: "sell", [keys[1]]: "hold" }, calls, suggestions: [{ id: "count", text: "x".repeat(20) }] });
  const rows = m.holdings.groups.flatMap((g) => g.rows);
  eq([rows.find((r) => r.key === keys[0]).call, rows.find((r) => r.key === keys[1]).call], [{ grade: "STRONG", ruleId: null, stage: "portfolio", trim: null, move: null, moveSplit: null, fundWeightPct: null }, null]);
  eq(m.suggestions.length, 1);
});

test("Auto v2.3 Y2: a small fund whose rating is pending is decided on its last year — Hold or Sell", () => {
  const young = { r3y: null, r5y: null, firstDate: "2024-06-01", rank1y: 10, quartile1y: 2, n1y: 30 };
  const decide = (category, stats, weightPct, { scheme, median } = {}) => {
    const st = recStats({ ...young, ...stats }), group = recGroup(median);
    const g = gradeFund({ scheme: recScheme(1, category, scheme), name: "", stats: st, group, statsAsOf: REC_AS_OF });
    const d = gradeYoungSmall(g, { stats: st, median: group.median, weightPct }, RECOMMENDATION);
    return [g.ruleId, d.grade, d.ruleId];
  };
  // 1 year or more: against the category's 1Y median (10%); the gap is 1 pp.
  eq(decide("Flexi Cap Fund", { r1y: 11 }, 5), ["young", "MIXED", "young-1y-in-line"]);
  eq(decide("Flexi Cap Fund", { r1y: 9.5 }, 5), ["young", "MIXED", "young-1y-in-line"]);     // 0.5 pp behind: in line
  eq(decide("Flexi Cap Fund", { r1y: 8.5, quartile1y: 3 }, 5), ["young", "WEAK", "young-1y-behind"]);
  // The worst performers (bottom quarter) are sold, even when recovering in the short term.
  eq(decide("Flexi Cap Fund", { r1y: 6, quartile1y: 4, rank1y: 29, r6m: 9, r3m: 5 }, 5, { median: { r6m: 4, r3m: 2 } }), ["young-1y-recovering", "WEAK", "young-1y-behind"]);
  // 8% or more of the portfolio: still the advisor's call.
  eq(decide("Flexi Cap Fund", { r1y: 11 }, 8), ["young", "REVIEW", "young"]);
  eq(decide("Flexi Cap Fund", { r1y: 6, quartile1y: 4, r6m: 9, r3m: 5 }, 9, { median: { r6m: 4, r3m: 2 } }), ["young-1y-recovering", "MIXED", "young-1y-recovering"]);
  // Under a year (no 1Y): equity on its absolute return since launch, above 15% → Hold.
  const fresh = { r1y: null, rank1y: null, quartile1y: null, n1y: null, firstDate: "2026-03-01" };
  eq(decide("Mid Cap Fund", { ...fresh, rLaunch: 16 }, 3), ["young", "MIXED", "young-new-in-line"]);
  eq(decide("Mid Cap Fund", { ...fresh, rLaunch: 15 }, 3), ["young", "WEAK", "young-new-behind"]);   // not above 15
  eq(decide("Mid Cap Fund", { ...fresh, rLaunch: null }, 3), ["young", "REVIEW", "young"]);          // nothing to judge on
  // Debt: not held to an equity return — 6M against the category; a few basis points apart is in line.
  eq(decide("Liquid Fund", { ...fresh, r6m: 3.4 }, 3, { scheme: DEBT, median: { r6m: 3.5 } }), ["young", "MIXED", "young-new-in-line"]);
  eq(decide("Liquid Fund", { ...fresh, r6m: 3.0 }, 3, { scheme: DEBT, median: { r6m: 3.5 } }), ["young", "WEAK", "young-new-behind"]);
  eq(decide("Liquid Fund", { r1y: 6.95, quartile1y: 4 }, 3, { scheme: DEBT, median: { r1y: 7 } }), ["young", "MIXED", "young-1y-in-line"]);   // bottom quarter by 5 bp
  // Sectoral: against its own index, not other sectors; without the index figure it stays REVIEW.
  eq(decide("Sectoral/Thematic", { r1y: 20, benchmark: bm(18, 15, 14) }, 4), ["young", "MIXED", "young-1y-in-line"]);
  eq(decide("Sectoral/Thematic", { r1y: 12, benchmark: bm(18, 15, 14) }, 4), ["young", "WEAK", "young-1y-behind"]);
  eq(decide("Sectoral/Thematic", { r1y: 12 }, 4), ["young", "REVIEW", "young"]);
  // No category median: nothing is guessed.
  eq(decide("Flexi Cap Fund", { r1y: 11 }, 5, { median: { r1y: null } }), ["young", "REVIEW", "young"]);
});

test("Auto v2.3 Y3: the young-fund call then goes through the portfolio check like any fund", () => {
  const young = (code, value, over) => ({ isin: `Y${code}`, value, scheme: recScheme(code, "Flexi Cap Fund"), stats: recStats({ r3y: null, r5y: null, firstDate: "2024-06-01", rank1y: 10, quartile1y: 2, n1y: 30, ...over }) });
  // ₹30L, ideal 4–8, small below 3.125%. Fund 5 (7%, ahead over 1Y) → Hold; Fund 6 (6%, behind) → Sell to an Invest fund.
  const { by } = recPortfolio([strong(1, "Large Cap Fund", "600000.00"), strong(2, "Value Fund", "600000.00"), strong(3, "Focused Fund", "600000.00"),
    strong(4, "Large & Mid Cap Fund", "600000.00"), young(5, "210000.00", { r1y: 12 }), young(6, "180000.00", { r1y: 7, quartile1y: 4 }), young(7, "60000.00", { r1y: 13 })]);
  eq([by(4).status, by(4).ruleId], ["hold", "young-1y-in-line"]);
  eq([by(5).status, by(5).ruleId, by(5).grade, Boolean(by(5).move)], ["sell", "young-1y-behind", "WEAK", true]);
  eq([by(6).status, by(6).ruleId], ["sell", "fit-small"]);   // good on its year, but 2% of the portfolio: the clean-up applies
  const pdf = fundCommentary({ name: "Fund 6", returns: { r1y: 7 }, benchmarkReturns: { r1y: 9 }, benchmark: "NIFTY 500 TRI", call: { grade: "WEAK", ruleId: "young-1y-behind", stage: "fund", move: by(5).move } }, "sell");
  eq(/rating is still pending, and over the last year it is behind its peers/.test(pdf), true);
});

test("Auto: legacy AMFI category and unknown asset class → REVIEW", () => {
  eq(recGrade("Income (legacy)", {}, { scheme: DEBT }).ruleId, "legacy-category");
  eq(engineOf(null), "unlisted");
});

// ---------- Fund Research returns (E5.1 worked examples) ----------
const E51 = navSeries([
  { date: "2023-07-07", nav: 100 }, { date: "2025-01-02", nav: 120 }, { date: "2025-12-31", nav: 138 }, { date: "2026-01-02", nav: 138 },
  { date: "2026-06-01", nav: 148 }, { date: "2026-06-06", nav: 145 }, { date: "2026-06-30", nav: 152 }, { date: "2026-07-08", nav: 150 },
]);
const pct2 = (x) => (x === null ? null : Math.round(x * 10000) / 100);
const colOf = (view, key) => returnColumns(view, "2026-07-08").find((c) => c.key === key);

test("Research: E5.1 trailing 1M (simple, nearest-previous) and 3Y (CAGR on actual days)", () => {
  eq(pct2(columnReturn(E51, colOf(RETURN_VIEW.TRAILING, "1M"), "2026-07-08")), 3.45);
  eq(pct2(columnReturn(E51, colOf(RETURN_VIEW.TRAILING, "3Y"), "2026-07-08")), 14.44);
  eq(columnReturn(E51, colOf(RETURN_VIEW.TRAILING, "5Y"), "2026-07-08"), null);   // no NAV that far back
});

test("Research: E5.1 monthly June 2026, annual 2025 (nearest-next start), YTD 2026", () => {
  eq(pct2(columnReturn(E51, colOf(RETURN_VIEW.MONTHLY, "2026-06"), "2026-07-08")), 2.7);
  eq(pct2(columnReturn(E51, colOf(RETURN_VIEW.ANNUAL, "2025"), "2026-07-08")), 15);
  eq(pct2(columnReturn(E51, colOf(RETURN_VIEW.ANNUAL, "2026"), "2026-07-08")), 8.7);
  eq(columnReturn(E51, colOf(RETURN_VIEW.ANNUAL, "2023"), "2026-07-08"), null);    // launched mid-2023: never a part year
});

test("Research: columns, category average leaves out funds without a figure, benchmark row", () => {
  const monthly = returnColumns(RETURN_VIEW.MONTHLY, "2026-07-08");
  eq([monthly.length, monthly[0].label, monthly[1].label, monthly.at(-1).label], [13, "MTD", "Jun 26", "Jul 25"]);
  const annual = returnColumns(RETURN_VIEW.ANNUAL, "2026-07-08", { firstYear: 2024 });
  eq(annual.map((c) => c.label), ["YTD 2026", "2025", "2024"]);
  const young = navSeries([{ date: "2025-12-31", nav: 10 }, { date: "2026-01-02", nav: 10 }, { date: "2026-07-08", nav: 12 }]);
  const t = returnsTable({ funds: [{ name: "A", series: E51 }, { name: "B", series: young }], benchmark: { name: "IDX", series: E51 }, view: RETURN_VIEW.ANNUAL, asOf: "2026-07-08", firstYear: 2025 });
  eq([pct2(t.average.returns["2026"]), t.average.counts["2026"], pct2(t.average.returns["2025"]), t.average.counts["2025"]], [14.35, 2, 15, 1]);
  eq([t.benchmark.name, pct2(t.benchmark.returns["2025"])], ["IDX", 15]);
});

// ---------- Fund Scorecard ----------
const scDays = (from, to) => { const out = []; for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const scSynth = (from, to, g, amp = 0.03, phase = 0) => navSeries(scDays(from, to).map((date, i) => ({ date, nav: 10 * Math.exp((g * i) / 365) * (1 + amp * Math.sin(i / 45 + phase)) })));
const SC_ASOF = "2026-10-26";
const scFund = (code, g, extra = {}) => ({ code, name: `Fund ${code}`, series: scSynth("2015-01-01", SC_ASOF, g), aum: 5000, ...extra });
const SC_BENCH = scSynth("2015-01-01", SC_ASOF, 0.10);

test("Scorecard: E9 quartile formula (owner's ROUNDUP)", () => {
  eq([1, 3, 4, 5, 6, 8, 9, 10].map((r) => quartileOf(r, 10)), [1, 1, 2, 2, 3, 3, 4, 4]);
  eq([quartileOf(1, 1), quartileOf(null, 5), quartileOf(2, 0)], [1, null, null]);
});

test("Scorecard: better funds rank higher; percentiles run 0–100; quartiles by rank", () => {
  const funds = [0.06, 0.08, 0.10, 0.12, 0.14, 0.16].map((g, i) => scFund(i + 1, g));
  const r = scoreCategory({ funds, benchmark: SC_BENCH, asOf: SC_ASOF });
  eq(r.categoryReason, null);
  eq(r.rated.map((x) => x.code), [6, 5, 4, 3, 2, 1]);
  eq([r.rated[0].measures.r3y.pct, r.rated[5].measures.r3y.pct], [100, 0]);
  eq(r.rated.map((x) => x.quartile), [1, 1, 2, 3, 3, 4]);
  eq(r.rated[0].measures.aum.pct, 50);   // equal AUM: every fund shares the middle position
  eq(r.rated.every((x) => x.score >= 0 && x.score <= 100), true);
});

test("Scorecard: conditions — new fund, stale NAV, AUM below minimum / not published, NAV break → Not rated", () => {
  const breakSeries = navSeries(scDays("2015-01-01", SC_ASOF).map((date, i) => ({ date, nav: (10 + i * 0.001) * (date >= "2024-06-03" ? 1.4 : 1) })));
  const funds = [
    ...[0.06, 0.08, 0.10, 0.12, 0.14].map((g, i) => scFund(i + 1, g)),
    { code: 10, name: "New", series: scSynth("2024-02-01", SC_ASOF, 0.1), aum: 5000 },
    { code: 11, name: "Stale", series: scSynth("2015-01-01", "2026-10-05", 0.1), aum: 5000 },
    scFund(12, 0.1, { aum: 120 }),
    scFund(13, 0.1, { aum: null }),
    { code: 14, name: "Break", series: breakSeries, aum: 5000 },
  ];
  const r = scoreCategory({ funds, benchmark: SC_BENCH, asOf: SC_ASOF });
  const why = Object.fromEntries(r.notRated.map((n) => [n.code, n.reason]));
  eq([/New fund/.test(why[10]), /more than 7 days old/.test(why[11]), /below the minimum/.test(why[12]), /AUM not published/.test(why[13]), /NAV history break on 2024-06-03/.test(why[14])], [true, true, true, true, true]);
  eq(r.rated.length, 5);
});

test("Scorecard: too few eligible funds → nobody is ranked", () => {
  const r = scoreCategory({ funds: [scFund(1, 0.1), scFund(2, 0.12), scFund(3, 0.14, { aum: 10 })], benchmark: SC_BENCH, asOf: SC_ASOF });
  eq([r.rated.length, /Only 2 funds meet the conditions/.test(r.categoryReason)], [0, true]);
});

test("Scorecard: a fund identical to its index — beta 1, capture 100/100, tracking error 0 (information ratio not defined)", () => {
  const f = fundMeasures({ code: 1, series: SC_BENCH, aum: 1 }, { benchmark: SC_BENCH, asOf: SC_ASOF });
  const r2 = (x) => Math.round(x * 100) / 100;
  eq([r2(f.measures.beta), r2(f.measures.upCapture), r2(f.measures.downCapture), r2(f.measures.trackingError), f.measures.informationRatio, r2(f.measures.excess3y)], [1, 100, 100, 0, null, 0]);
});

// ---------- index funds (index-funds.js, research/index-scorecard.js) ----------
test("Index funds: one classifier — family and asset group from the tracked index", () => {
  const f = (name, benchmarkName = null, category = "Index Funds") => indexFamily({ category, name, benchmarkName }).family;
  eq(f("UTI Nifty 50 Index Fund", "NIFTY 50 Index"), "broad");
  eq(f("Motilal Oswal Nifty 200 Momentum 30 Index Fund", "NIFTY 200 Momentum 30 Index"), "factor");
  eq(f("Motilal Oswal BSE Enhanced Value Index Fund", "BSE Enhanced Value Index"), "factor");
  eq(f("Kotak Nifty Bank Index Fund", "NIFTY Bank Index"), "sector");
  eq(f("Motilal Oswal S&P 500 Index Fund", "S&P 500 Index"), "international");
  eq(f("Bandhan CRISIL IBX Gilt June 2027 Index Fund", "CCIL All Sovereign Bonds Index TRI"), "debt");
  // two debt indices are debt; an equity index plus G-Sec is hybrid
  eq(f("DSP Nifty SDL Plus G-Sec Sep 2027 50:50 Index Fund", "CCIL All Sovereign Bonds Index TRI"), "debt");
  eq(f("HDFC Nifty LargeMidcap250 Plus 8-13 yr G-sec 70:30 Index Fund", "NIFTY LargeMidcap250 Plus 8-13 yr G-Sec 70:30 Index"), "hybrid");
  eq(f("X Nifty 50 Index Fund", null, "Index Funds - Debt"), "debt");
  eq([isIndexFund({ category: "Index Funds" }), isIndexFund({ category: "Index Funds - Equity" }), isIndexFund({ category: "Other ETFs" })], [true, true, false]);
  eq(indexCategoryLabel({ category: "Index Funds", name: "UTI Nifty 50 Index Fund", benchmarkName: "NIFTY 50 Index" }), "Index Fund · NIFTY 50");
  eq(indexCategoryLabel({ category: "Index Funds", name: "Bandhan CRISIL IBX Gilt 2027 Index Fund", benchmarkName: "CCIL All Sovereign Bonds Index TRI" }), "Index Fund · Debt index");
  // the Portfolio Analyzer's report group comes from the same classifier (the 70:30 fund was "debt" before)
  const group = (schemeName) => assetGroup({ assetClass: "Other", category: "Index Funds", schemeName });
  eq([group("HDFC Nifty LargeMidcap250 Plus 8-13 yr G-sec 70:30 Index Fund"), group("Axis Nifty SDL September 2026 Debt Index Fund"), group("UTI Nifty 50 Index Fund")], ["hybrid", "debt", "equity"]);
  eq(TRACKED_INDICES.every((t) => t.code && t.name && t.family), true);
});

test("Report benchmark names: BAF and Multi Asset blends by their category; other benchmarks unchanged", () => {
  const baf = { category: "Balanced Advantage / Dynamic Asset Allocation" }, maaf = { category: "Multi Asset Allocation" };
  eq(benchmarkDisplayName(baf, { code: "SBAB124", name: "NIFTY 50 50% + CRISIL Short Term Bond 50%" }), "Hybrid: Dynamic Asset Allocation");
  eq(benchmarkDisplayName(maaf, { code: "SBAHB99", name: "BSE 200 65% + CRISIL Short Term Bond 20% + Gold 10% + Silver 5%" }), "Hybrid: Multi Asset Allocation");
  eq(benchmarkDisplayName({ category: "Equity Savings" }, { code: "SBOHB30", name: "NIFTY 50 Arbitrage 75% + NIFTY 50 25%" }), "NIFTY 50 Arbitrage 75% + NIFTY 50 25%");
  eq(benchmarkDisplayName(baf, { code: "AUB11", name: "CRISIL Hybrid 35+65 - Aggressive Fund Index" }), "CRISIL Hybrid 35+65 - Aggressive Fund Index");
  eq(benchmarkDisplayName(baf, null), null);
  // their funds of funds (AMFI: FoF Domestic) by name
  eq(benchmarkDisplayName({ category: "FoF Domestic", schemeName: "ICICI Prudential Dynamic Asset Allocation Active FOF" }, { code: "SBAB124", name: "x" }), "Hybrid: Dynamic Asset Allocation");
  eq(benchmarkDisplayName({ category: "FoF Domestic", schemeName: "Axis Multi-Asset Omni FoF" }, { code: "SBAHB10", name: "x" }), "Hybrid: Multi Asset Allocation");
  eq(benchmarkDisplayName({ category: "Balanced Hybrid Fund", schemeName: "WhiteOak Capital Balanced Hybrid Fund" }, { code: "SBAB124", name: "NIFTY 50 50% + CRISIL Short Term Bond 50%" }), "NIFTY 50 50% + CRISIL Short Term Bond 50%");
});

test("Index scorecard: a fund identical to its index tracks perfectly; a costlier tracker ranks lower", () => {
  const idx = scSynth("2015-01-01", SC_ASOF, 0.11);
  // fund k: the index minus k% a year (cost drag) — tracking difference ≈ −k%, tracking error ≈ 0
  const dragged = (k) => navSeries(idx.dates.map((date, i) => ({ date, nav: idx.navs[i] * Math.exp((-k / 100) * (i / 365)) })));
  const perfect = indexFundMeasures({ code: 1, series: idx, aum: 1000, benchmarkSeries: idx }, { asOf: SC_ASOF });
  const r4 = (x) => Math.round(x * 10000) / 10000;
  eq([r4(perfect.measures.td1y), r4(perfect.measures.te1y), r4(perfect.measures.tdSpread)], [0, 0, 0]);
  const funds = [0.1, 0.3, 0.5, 0.8, 1.2, 2].map((k, i) => ({ code: i + 1, name: `Tracker ${i + 1}`, series: dragged(k), aum: 1000, benchmarkSeries: idx }));
  const card = scoreIndexCategory({ funds, asOf: SC_ASOF });
  eq(card.kind, "index");
  eq(card.rated.map((r) => r.code), [1, 2, 3, 4, 5, 6]);   // the cheapest tracker first
  eq(Math.round(card.rated[0].measures.td1y.value * 1000) / 1000, -0.001);
  // conditions: a fund under 1 year, a small fund, a fund without index history
  const young = { code: 7, name: "Young", series: navSeries(idx.dates.slice(-200).map((date, i) => ({ date, nav: idx.navs[idx.dates.length - 200 + i] }))), aum: 1000, benchmarkSeries: idx };
  const tiny = { code: 8, name: "Tiny", series: dragged(0.2), aum: 50, benchmarkSeries: idx };
  const noIndex = { code: 9, name: "No index", series: dragged(0.2), aum: 1000, benchmarkSeries: null };
  const reasons = Object.fromEntries(scoreIndexCategory({ funds: [...funds, young, tiny, noIndex], asOf: SC_ASOF }).notRated.map((n) => [n.code, n.reason]));
  eq([/New fund/.test(reasons[7]), /below the minimum/.test(reasons[8]), /index's price history/.test(reasons[9])], [true, true, true]);
  // too few funds tracking the index → nobody ranked
  eq(scoreIndexCategory({ funds: funds.slice(0, 3), asOf: SC_ASOF }).categoryReason !== null, true);
});

test("Scorecard: max drawdown and recovery days on a crafted dip", () => {
  // Flat 100, a fall to 75 on 2025-03-01 (−25%), back to 100 on 2025-05-01, then flat.
  const series = navSeries(scDays("2015-01-01", SC_ASOF).map((date) => ({ date, nav: date >= "2025-03-01" && date < "2025-05-01" ? 75 : 100 + (date > "2025-05-01" ? 0.0001 : 0) })));
  const f = fundMeasures({ code: 1, series, aum: 1 }, { benchmark: SC_BENCH, asOf: SC_ASOF });
  eq([Math.round(f.measures.maxDrawdown * 1000) / 1000, f.measures.recoveryDays], [-0.25, 61]);
});

test("Scorecard: invalid owner settings fall back to the defaults as a whole", () => {
  eq(resolveSettings({ weights: { returns: 100 }, conditions: {} }).custom, false);
  const ok = resolveSettings({ weights: { returns: 30, riskAdjusted: 20, benchmark: 10, volatility: 10, downside: 10, consistency: 10, quality: 10 }, conditions: { minHistoryYears: 5, maxNavAgeDays: 7, minPeers: 5, minAumCr: 1000 } });
  eq([ok.custom, ok.weights.returns, ok.conditions.minAumCr], [true, 30, 1000]);
  eq(resolveSettings({ weights: ok.weights, conditions: { ...ok.conditions, minHistoryYears: 1 } }).custom, false);
  eq(resolveSettings({ weights: ok.weights, conditions: { ...ok.conditions, minHistoryYears: 2 } }).custom, true);
});

test("Scorecard: model check rates the category 3 years back and measures each quartile since", () => {
  const funds = [0.06, 0.08, 0.10, 0.12, 0.14, 0.16, 0.18, 0.20].map((g, i) => scFund(i + 1, g));
  const b = backtestCategory({ funds, benchmark: SC_BENCH, asOf: SC_ASOF });
  eq([b.from, b.funds, b.quartiles.reduce((s, q) => s + q.funds, 0)], ["2023-10-26", 8, 8]);
  eq(b.quartiles[0].avgReturn > b.quartiles[3].avgReturn, true);   // steady growth: the top quartile stayed ahead
});

test("Scorecard: quarter ends before a date, oldest first, across a year end", () => {
  eq(quarterEnds("2026-10-30"), ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"]);
  eq(quarterEnds("2026-01-05", 2), ["2025-09-30", "2025-12-31"]);
  eq(quarterEnds("2026-03-31", 1), ["2025-12-31"]);   // the quarter still running is never counted
});

test("Scorecard: quarterly quartiles re-rate the category at each quarter end; a fund missing then has no rank", () => {
  const funds = [0.06, 0.08, 0.10, 0.12, 0.14, 0.16, 0.18, 0.20].map((g, i) => scFund(i + 1, g));
  funds.push({ code: 9, name: "Young", series: scSynth("2023-06-01", SC_ASOF, 0.5), aum: 5000 });
  const score = (asOf) => scoreCategory({ funds, benchmark: SC_BENCH, asOf, ignoreAum: true });
  const best = quarterlyQuartiles({ score, code: 8, asOf: SC_ASOF });
  eq([best.map((q) => q.date), best.every((q) => q.rated >= 8 && q.quartile === 1)], [["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"], true]);
  eq(quarterlyQuartiles({ score, code: 77, asOf: SC_ASOF, count: 1 })[0].rank, null);
});

test("Scorecard: normalised comparison starts both at 100 on common dates and keeps the last date", () => {
  const dates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"];
  const fund = navSeries({ dates, navs: [50, 55, 60, 65, 75] });
  const bench = navSeries({ dates: ["2026-01-02", "2026-01-03", "2026-01-05"], navs: [200, 210, 220] });
  const v = normalizedComparison(fund, bench, "2026-01-01", "2026-01-05");
  eq([v.dates, v.fund.map((x) => Math.round(x * 100) / 100), v.benchmark.map((x) => Math.round(x * 100) / 100)],
     [["2026-01-02", "2026-01-03", "2026-01-05"], [100, 109.09, 136.36], [100, 105, 110]]);
  const long = normalizedComparison(SC_BENCH, SC_BENCH, "2016-01-01", SC_ASOF, 100);
  eq([long.dates.length <= 101, long.dates.at(-1), long.fund[0]], [true, SC_ASOF, 100]);
  eq(normalizedComparison(fund, bench, "2026-01-05", "2026-01-05"), null);
});

test("Scorecard: rebasing another fund carries its last NAV over a gap and refuses a fund not yet launched", () => {
  const fund = navSeries({ dates: ["2026-01-02", "2026-01-05"], navs: [20, 22] });
  eq(rebasedOn(fund, ["2026-01-02", "2026-01-03", "2026-01-05"]).map((x) => Math.round(x)), [100, 100, 110]);
  eq(rebasedOn(fund, ["2026-01-01", "2026-01-05"]), null);
});

test("Scorecard: minimum history 2 years — a 2½-year fund is rated, every fund measured over the same 24 months", () => {
  const funds = [0.06, 0.08, 0.10, 0.12, 0.14].map((g, i) => scFund(i + 1, g));
  funds.push({ code: 9, name: "Young", series: scSynth("2024-04-01", SC_ASOF, 0.15), aum: 5000 });
  const settings = { weights: { returns: 20, riskAdjusted: 20, benchmark: 10, volatility: 15, downside: 15, consistency: 10, quality: 10 }, conditions: { minHistoryYears: 2, maxNavAgeDays: 7, minPeers: 5, minAumCr: 500 } };
  const two = scoreCategory({ funds, benchmark: SC_BENCH, asOf: SC_ASOF, settings });
  const three = scoreCategory({ funds, benchmark: SC_BENCH, asOf: SC_ASOF });
  const young = two.rated.find((r) => r.code === 9);
  eq([two.windowYears, three.windowYears, Boolean(young), three.rated.some((r) => r.code === 9)], [2, 3, true, false]);
  eq([young.measures.sharpe.value !== null, young.measures.r3y.value, two.pillars.find((p) => p.key === "downside").measures[0].label], [true, null, "Max drawdown (2Y)"]);
});

test("Asset group: domestic funds of funds by name — equity / debt / hybrid / gold — and whole-word G-Sec", () => {
  const fof = (schemeName) => assetGroup({ assetClass: "Other", category: "FoF Domestic", schemeName });
  eq([
    fof("ICICI Prudential Diversified Equity All Cap Active FOF"),
    fof("Mirae Asset Nifty 100 ESG Sector Leaders Fund of Fund"),   // "esG SECtor" must not read as G-Sec
    fof("Motilal Oswal Nasdaq 100 Fund of Fund"),
    fof("Kotak Multi Factor Passive FOF"),
    fof("BHARAT Bond FOF- April 2031"),
    fof("Motilal Oswal 5 Year G-Sec Fund of Fund"),
    fof("Kotak Income Plus Arbitrage Omni FOF"),
    fof("HDFC Multi-Asset Active FOF"),
    fof("HDFC Gold ETF Fund of Fund"),
  ], ["equity", "equity", "equity", "equity", "debt", "debt", "debt", "hybrid", "goldSilver"]);
  eq(assetGroup({ assetClass: "Other", category: "Other ETFs", schemeName: "Mirae Asset Nifty 100 ESG Sector Leaders ETF" }), "equity");
});

test("Asset group: overseas funds of funds — equity unless bonds / treasury / debt; equity income and gold mining are equity", () => {
  const ov = (schemeName, category = "FoF Overseas") => assetGroup({ assetClass: "Other", category, schemeName });
  eq([
    ov("Franklin U. S. Opportunities Equity Active Fund of Funds"),
    ov("Invesco India - Invesco Global Equity Income Fund of Fund"),    // "income" with "equity" is not debt
    ov("DSP World Gold Mining Overseas Equity Omni FoF"),                 // gold-mining shares are equity
    ov("Kotak International REIT Overseas Equity Active FOF"),
    ov("Mirae Asset NYSE FANG+ ETF", "ETFs investing overseas"),
    ov("Aditya Birla Sun Life US Treasury 3-10 Year Bond ETFs Passive FOF"),
    ov("Axis US Specific Treasury Dynamic Debt Passive FOF"),
  ], ["equity", "equity", "equity", "equity", "equity", "debt", "debt"]);
  eq(assetGroup({ assetClass: "Other", category: "FoF Domestic", schemeName: "Kotak Income Plus Arbitrage Omni FOF" }), "debt");
});

test("Asset group: an unplaced fund goes by its look-through holdings (65% rule), else hybrid", () => {
  eq([groupFromMix({ equity: 92, debt: 8, goldSilver: 0, other: 0 }), groupFromMix({ equity: 10, debt: 85, goldSilver: 5, other: 0 }),
      groupFromMix({ equity: 0, debt: 2, goldSilver: 98, other: 0 }), groupFromMix({ equity: 50, debt: 40, goldSilver: 10, other: 0 }), groupFromMix(null)],
     ["equity", "debt", "goldSilver", "hybrid", null]);
});

// ---------- report ----------
const failed = results.filter((r) => !r.ok);
const out = document.getElementById("results");
out.textContent = [
  `RESULT: ${results.length - failed.length}/${results.length} passed`,
  ...results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  →  ${r.error}`}`),
].join("\n");
document.body.dataset.done = failed.length ? "fail" : "pass";
