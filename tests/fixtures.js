/**
 * Synthetic StructuredDocuments that mimic real CAS layouts cell-by-cell.
 * Used by engine tests and the UI preview. Replace / extend with anonymized
 * real statements as they become available.
 */

/** Build a document from rows given as arrays of [x, text] cells (top → bottom). */
export function doc(pagesOfRows) {
  return {
    pageCount: pagesOfRows.length,
    textItemCount: 999,
    pages: pagesOfRows.map((rows, p) => ({
      pageNumber: p + 1,
      rows: rows.map((cells, i) => {
        const built = cells.map(([x, str]) => ({ x, right: x + str.length * 4.5, str }));
        return { y: 800 - i * 12, height: 9, text: built.map((c) => c.str).join(" "), cells: built };
      }),
    })),
  };
}

export const camsDoc = doc([[
  [[40, "Consolidated Account Statement"]],
  [[40, "01-Apr-2024 To 31-Dec-2024"]],
  [[40, "Email Id: investor@example.com"]],
  [[40, "RAHUL SHARMA"]],
  [[40, "12 MG Road"]],
  [[40, "Bengaluru 560001"]],
  [[40, "Mobile: +919999999999"]],
  [[40, "PORTFOLIO SUMMARY"]],
  [[40, "Mutual Fund"], [300, "Cost Value"], [420, "Market Value"]],
  [[40, "Axis Mutual Fund"], [300, "10,000.00"], [420, "12,000.00"]],
  [[40, "Total"], [300, "10,000.00"], [420, "12,000.00"]],
  [[40, "Axis Mutual Fund"]],
  [[40, "Folio No: 9104567 / 0"], [200, "PAN: ABCDE1234F"], [320, "KYC: OK PAN: OK"]],
  [[40, "RAHUL SHARMA"]],
  [[40, "G-Axis ELSS Tax Saver Fund - Direct Growth - ISIN: INF846K01EW2(Advisor: DIRECT) Registrar : KFINTECH"]],
  [[40, "Opening Unit Balance: 0.000"]],
  [[40, "Date"], [110, "Transaction"], [300, "Amount"], [360, "Units"], [420, "Price"], [480, "Unit"]],
  [[300, "(INR)"], [420, "(INR)"], [480, "Balance"]],
  [[40, "05-Apr-2024"], [110, "Purchase - via Internet"], [300, "6,000.00"], [360, "75.000"], [420, "80.0000"], [480, "75.000"]],
  [[40, "05-Apr-2024"], [110, "*** Stamp Duty ***"], [300, "0.30"]],
  [[40, "10-Jun-2024"], [110, "Purchase - via Internet"], [300, "4,000.00"], [360, "50.000"], [420, "80.0000"], [480, "125.000"]],
  [[40, "Closing Unit Balance: 125.000"], [200, "NAV on 31-Dec-2024: INR 96.0000"], [340, "Total Cost Value: 10,000.00"], [460, "Market Value on 31-Dec-2024: INR 12,000.00"]],
]]);

export const nsdlDoc = doc([[
  [[40, "National Securities Depository Limited"]],
  [[40, "NSDL Consolidated Account Statement"]],
  [[40, "Statement for the period from 01-Dec-2024 to 31-Dec-2024"]],
  [[40, "RAHUL SHARMA (PAN:ABCDE1234F)"]],
  [[40, "DP ID: IN300000 Client ID: 10000000"], [300, "CDSL demat accounts are also consolidated"]],
  [[40, "Equities (E)"]],
  [[40, "ISIN"], [120, "Security"], [300, "Current Bal"], [380, "Market Price"], [460, "Value"]],
  [[40, "INE002A01018"], [120, "RELIANCE INDUSTRIES LTD"], [300, "10"], [380, "1,250.00"], [460, "12,500.00"]],
  [[40, "Total"], [460, "12,500.00"]],
  [[40, "Mutual Fund Folios (F)"]],
  [[40, "ISIN"], [120, "ISIN Description"], [230, "Folio No."], [300, "No. of Units"], [360, "Total Cost"], [420, "NAV"], [480, "Current Value"]],
  [[40, "INF846K01EW2"], [120, "AXIS ELSS TAX SAVER FUND"], [230, "9104567"], [300, "125.000"], [360, "10,000.00"], [420, "96.0000"], [480, "12,000.00"]],
  [[120, "- DIRECT GROWTH"]],
  [[40, "INF179K01VQ4"], [120, "HDFC FLEXI CAP FUND"], [230, "1234567"], [300, "10.000"], [360, "15,000.00"], [420, "1,800.0000"], [480, "18,000.00"]],
  [[40, "Total"], [360, "25,000.00"], [480, "30,000.00"]],
]]);
