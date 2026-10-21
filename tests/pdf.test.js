/**
 * End-to-end PDF tests: real PDF files (rendered from tests/pdf-fixtures/*.html)
 * go through the FULL pipeline — pdf.js extraction, detection, parsing,
 * normalization, validation — and every fund field is compared to the value
 * printed in the source statement. Regenerate the PDFs with tests/build-pdfs.ps1.
 */

import * as pdfjs from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs";
import { analyzeCasPdf } from "../calculation-engine/index.js";

pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";

const H = (isin, schemeName, folio, units, nav, costValue, marketValue, extra = {}) =>
  ({ isin, schemeName, folio, units, nav, costValue, marketValue, ...extra });

const EXPECTED = {
  "cams.pdf": {
    format: "CAMS_KFINTECH",
    investor: { name: "PRIYA KAPOOR", email: "priya.k@example.com", pans: ["ABCDE1234F"] },
    printedTotals: { totalCostValue: "17,58,400.00", totalMarketValue: "21,98,563.24" },
    holdings: [
      H("INF846K01EW2", "Axis ELSS Tax Saver Fund - Direct Growth", "9104567 / 0", "105.000", "96.0000", "8,400.00", "10,080.00",
        { amc: "Axis Mutual Fund", registrar: "KFINTECH", navDate: "2024-12-31", status: "active", transactions: 4 }),
      H("INF179K01VQ4", "HDFC Flexi Cap Fund - Direct Plan - Growth Option (formerly HDFC Equity Fund)", "1122334 / 55", "1,003.278", "1,812.3456", "15,00,000.00", "18,18,286.47",
        { amc: "HDFC Mutual Fund", registrar: "CAMS", status: "active", transactions: 1 }),
      H("INF179KB1HP9", "HDFC Liquid Fund - Direct Plan - Growth", "1122334 / 55", "0.000", "4,850.1234", "0.00", "0.00",
        { amc: "HDFC Mutual Fund", status: "redeemed", transactions: 1 }),
      H("INF879O01027", "Parag Parikh Flexi Cap Fund - Direct Plan Growth", "13579246", "4,321.987", "85.6543", "2,50,000.00", "3,70,196.77",
        { amc: "PPFAS Mutual Fund", registrar: "CAMS", status: "active", transactions: 0 }),
    ],
  },
  "nsdl.pdf": {
    format: "NSDL",
    investor: { name: "PRIYA KAPOOR", title: null, pans: ["ABCDE1234F"] },
    printedTotals: { totalCostValue: "3,65,000.00", totalMarketValue: "78,516.00 + 4,33,943.98" },
    holdings: [
      H("INF204KB14I2", "NIPPON INDIA ETF NIFTY 50 BEES", null, "1,200.000", "65.4300", null, "78,516.00"),
      H("INF769K01EG9", "MIRAE ASSET LARGE & MIDCAP FUND - DIRECT PLAN - GROWTH", "79912345678", "2,150.375", "112.8765", "2,00,000.00", "2,42,726.80", { averageCost: "93.0070", printedGain: "42,726.80" }),
      H("INF109K016L0", "ICICI PRUDENTIAL BLUECHIP FUND - DIRECT PLAN - GROWTH", "8812345/12", "845.120", "98.4567", "90,000.00", "83,207.73", { averageCost: "106.4938", printedGain: "(6,792.27)" }),
      H("INF200K01RJ1", "SBI SMALL CAP FUND - DIRECT PLAN - GROWTH", "20187654", "312.456", "345.6789", "75,000.00", "1,08,009.45", { averageCost: "240.0338", printedGain: "33,009.45" }),
    ],
  },
  "cdsl.pdf": {
    format: "CDSL",
    investor: { name: "PRIYA KAPOOR", title: "MRS", pans: ["ABCDE1234F"] },
    printedTotals: { totalCostValue: "2,58,400.00", totalMarketValue: "3,80,276.77" },
    holdings: [
      H("INF846K01EW2", "AXIS ELSS TAX SAVER FUND - DIRECT GROWTH", "9104567/0", "105.000", "96.0000", "8,400.00", "10,080.00", { navDate: "2024-12-31", printedGain: "1,680.00" }),
      H("INF879O01027", "PARAG PARIKH FLEXI CAP FUND - DIRECT PLAN - GROWTH", "13579246", "4,321.987", "85.6543", "2,50,000.00", "3,70,196.77", { printedGain: "1,20,196.77" }),
    ],
  },
};

const RAW_KEYS = ["units", "nav", "costValue", "marketValue", "averageCost", "printedGain"];
const lines = [];
let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    lines.push(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  return ok;
}

for (const [file, expected] of Object.entries(EXPECTED)) {
  lines.push(`── ${file}`);
  const before = failures;
  try {
    const data = await (await fetch(`pdf-fixtures/${file}`)).arrayBuffer();
    const p = await analyzeCasPdf({ data, fileName: file, pdfjs });

    check("format", p.source.format, expected.format);
    for (const [key, value] of Object.entries(expected.investor)) check(`investor.${key}`, p.investor[key], value);
    check("printed cost total", p.printedTotals.raw.totalCostValue, expected.printedTotals.totalCostValue);
    check("printed market total", p.printedTotals.raw.totalMarketValue, expected.printedTotals.totalMarketValue);
    check("holding count", p.holdings.length, expected.holdings.length);

    expected.holdings.forEach((want, i) => {
      const got = p.holdings[i] ?? {};
      const tag = `#${i + 1} ${want.isin}`;
      check(`${tag} isin`, got.isin, want.isin);
      check(`${tag} schemeName`, got.schemeName, want.schemeName);
      check(`${tag} folio`, got.folio, want.folio);
      for (const key of RAW_KEYS) {
        if (key in want) check(`${tag} ${key}`, got.raw?.[key] ?? null, want[key]);
      }
      for (const key of ["amc", "registrar", "navDate", "status"]) {
        if (key in want) check(`${tag} ${key}`, got[key], want[key]);
      }
      if ("transactions" in want) check(`${tag} transactions`, got.transactions?.length, want.transactions);
      check(`${tag} flags`, got.flags, []);
    });

    check("integrity status", p.integrity.status, "ok");
    if (p.integrity.status !== "ok") lines.push(`  warnings: ${p.integrity.warnings.join(" | ")}`);
    lines.push(failures === before ? "  PASS — every field matches the statement" : "");
  } catch (error) {
    failures++;
    lines.push(`  FAIL threw: ${error.message}`);
  }
}

const report = [`RESULT: ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`, ...lines.filter(Boolean)].join("\n");
document.getElementById("results").textContent = report;
document.body.dataset.done = failures ? "fail" : "pass";
// Lets a headless run read the outcome (see serve.ps1); harmless if it fails.
fetch("/__test-results", { method: "POST", body: report }).catch(() => {});
