/**
 * Engine tests — run in the browser at /tests/ (no Node required).
 * Synthetic StructuredDocuments mimic real CAS layouts cell-by-cell, so the
 * parsers, detection and validation are exercised without a PDF.
 * Add real anonymized statements as fixtures as they become available.
 */

import {
  parseCasDocument, isValidIsin, CAS_FORMAT, FLAG, summarizePortfolio, allocatePortfolio, summarizeRecommendations, holdingKey,
  buildSnapshot, buildDetailedReport, buildReportProfile, diversificationStatus, categoryFromText,
} from "../calculation-engine/index.js";
import { createHolding, createPortfolio } from "../calculation-engine/model/portfolio.schema.js";
import { parsePrintedDate, parsePrintedNumber, toPaise } from "../calculation-engine/cas/parse-values.js";
import { detectFormat } from "../calculation-engine/cas/detect-format.js";
import { camsDoc, doc, nsdlDoc } from "./fixtures.js";
import { samplePortfolio, SAMPLE_FUND_DATA } from "./sample-snapshot.js";

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
  eq(risk([["HDFC Flexi Cap Fund", "100.00"]]), { label: "Aggressive", equityPct: 100, unclassified: [] });
  eq(risk([["HDFC Flexi Cap Fund", "80.00"], ["HDFC Liquid Fund", "20.00"]]).label, "Aggressive", "exactly 80%");
  eq(risk([["HDFC Flexi Cap Fund", "79.99"], ["HDFC Liquid Fund", "20.01"]]).label, "Moderately Aggressive");
  eq(risk([["SBI Equity Hybrid Fund", "100.00"]]).equityPct, 70);
  eq(risk([["ICICI Prudential Multi-Asset Fund", "100.00"]]).label, "Moderate", "40% = Moderate");
  eq(risk([["HDFC Gold ETF Fund of Fund", "100.00"]]).label, "Moderately Conservative", "gold 30%");
  eq(risk([["HDFC Flexi Cap Fund", "20.00"], ["HDFC Liquid Fund", "80.00"]]).label, "Moderately Conservative", "exactly 20%");
  eq(risk([["Kotak Equity Arbitrage Fund", "100.00"]]), { label: "Conservative", equityPct: 0, unclassified: [] });
});

test("Horizon: value-weighted years, exact band edges", () => {
  const horizon = (rows) => buildReportProfile(profilePortfolio(rows)).horizon;
  eq(horizon([["HDFC Liquid Fund", "100.00"]]), { label: "Short Term", years: 0.25, unclassified: [] });
  eq(horizon([["HDFC Liquid Fund", "400.00"], ["HDFC Short Term Debt Fund", "300.00"]]), { label: "Mid Term", years: 1, unclassified: [] });
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

test("Report profile: an unclassifiable fund blocks risk and horizon — never guessed", () => {
  const p = buildReportProfile(profilePortfolio([["HDFC Flexi Cap Fund", "60.00"], ["Kotak Emerging Equity Fund", "40.00"]]));
  eq([p.risk.label, p.horizon.label], [null, null]);
  eq(p.risk.unclassified, ["Kotak Emerging Equity Fund"]);
  eq(p.diversification.numFunds, 2, "diversification still works");
});

test("Report profile: same ISIN in two folios is one fund; redeemed funds are left out", () => {
  const portfolio = profilePortfolio([["HDFC Flexi Cap Fund", "30.00", "INF179K01VQ4"], ["HDFC Flexi Cap Fund", "30.00", "INF179K01VQ4"], ["HDFC Liquid Fund", "40.00"], ["SBI Small Cap Fund", "10.00"]]);
  portfolio.holdings[3].status = "redeemed";
  const p = buildReportProfile(portfolio);
  eq([p.diversification.numFunds, p.diversification.status], [2, "Concentrated"]); // Flexi Cap = 60% across two folios
  eq(p.risk.equityPct, 60);
});

// ---------- detailed report model ----------
test("Detailed report: groups by asset class, alphabetical, totals exact", () => {
  const m = buildDetailedReport({ portfolio: samplePortfolio(), fundData: SAMPLE_FUND_DATA, verdicts: {} });
  eq(m.holdings.groups.map((g) => g.key), ["equity", "debt", "goldSilver"]);
  const names = m.holdings.groups[0].rows.map((r) => r.name);
  eq(names, [...names].sort((p, q) => p.localeCompare(q, "en", { sensitivity: "base" })));
  const sum = m.holdings.groups.reduce((s, g) => s + Math.round(g.value * 100), 0);
  eq(sum, 57098200);
  eq(m.holdings.groups.reduce((s, g) => s + g.rows.length, 0), 13);
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

// ---------- report ----------
const failed = results.filter((r) => !r.ok);
const out = document.getElementById("results");
out.textContent = [
  `RESULT: ${results.length - failed.length}/${results.length} passed`,
  ...results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  →  ${r.error}`}`),
].join("\n");
document.body.dataset.done = failed.length ? "fail" : "pass";
