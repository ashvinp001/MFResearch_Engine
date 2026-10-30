# Portfolio Analyzer — Core Logic

The Portfolio Analyzer turns a client's Consolidated Account Statement (CAS) PDF into a verified
portfolio and produces two client reports. This document covers the core logic: what is computed,
where, and which guarantees hold. For the overall layering, see [ARCHITECTURE.md](ARCHITECTURE.md).

> **Authoritative source for every calculation rule:** `MF_Calculation_Engine.md`, section E15.
> This page explains how the pieces fit together; if the two ever differ, the Calculation Engine
> file wins.

| Concern | Location |
|---|---|
| CAS reading pipeline | `calculation-engine/cas/` |
| Data contract | `calculation-engine/model/portfolio.schema.js` |
| Tolerances | `calculation-engine/config.js` |
| Portfolio and report models | `calculation-engine/portfolio-analyzer/` |
| Workflow, screens, report layout and wording | `app/portfolio-analyzer/` |
| Screen and report styles | `design-system/portfolio-analyzer/` |

---

## 1. Guarantees

1. **As printed.** Every holding value is parsed from the statement text, and the exact printed
   string is kept in `holding.raw`, so any figure can be audited against the PDF.
2. **Never guessed.** A value that is not printed is `null`. A name, title or ISIN is never inferred.
3. **Flag, never fix.** A value that fails a check keeps its printed value and receives a flag.
   The advisor sees the flag and must acknowledge it before downloading.
4. **Exact to the paisa.** Money sums use integer paise, computed from the printed strings.
   Allocation percentages use integer basis points.
5. **Deterministic.** The same file always produces the same output.
6. **Local.** The PDF is read in the browser by pdf.js. Nothing is uploaded, and client state lives
   in memory only.

---

## 2. Pipeline

```
analyzeCasPdf({ data, password, fileName, pdfjs })
  │
  ├─ A. extract-text     PDF → StructuredDocument (positioned rows and cells)
  ├─ B. detect-format    → CAMS_KFINTECH | NSDL | CDSL | UNSUPPORTED
  ├─ C. parse            parse-cams-kfintech  |  parse-nsdl-cdsl
  ├─ D. normalize        → NormalizedPortfolio
  └─ E. validate         → flags, checks, integrity status
```

`parseCasDocument(doc, fileName)` runs steps B–E on an already-extracted document, and the tests
use it. pdf.js is **injected** rather than imported, so the engine has no hard dependency on a
loader.

### A. Text extraction — `cas/extract-text.js`

pdf.js returns loose text fragments with coordinates. These are rebuilt into a table-like structure:

- **Rows.** Fragments whose baselines are within `fontHeight × rowToleranceRatio` (0.5) share a row.
  Rows are ordered top to bottom.
- **Cells.** Within a row, adjacent fragments closer than `fontHeight × cellMergeGapRatio` (0.35)
  merge into one cell. Runs separated by wide spaces are split, so two columns are never glued
  together.
- **Output.** `{ pageCount, textItemCount, pages: [{ pageNumber, rows: [{ y, height, text, cells: [{ x, right, str }] }] }] }`.
  Parsers read `cells`. `text` exists only for label search.
- **Errors.** A wrong or missing password throws `PASSWORD_REQUIRED` / `PASSWORD_INCORRECT`. A file
  with fewer than `minTextItemsForTextLayer` (20) text items is treated as a scan
  (`NO_TEXT_LAYER`), and a corrupt file gives `UNREADABLE_PDF`.
- **`probePdf`** opens the file without parsing it. The upload screen uses it to ask for a password
  as soon as a protected file is chosen.

### B. Format detection — `cas/detect-format.js`

Keyword matching misfires because an NSDL CAS mentions CDSL, CAMS and KFintech. Detection is
therefore an **ordered, structural** rule set. Rules 1 and 2 read the first `pagesToScan` (3) pages:

1. **MF RTA statement:** per-scheme "Closing Unit Balance" together with "Folio No" → `CAMS_KFINTECH`.
2. **Depository statement:** depository markers (DP ID / Client ID / BO ID / Demat). The issuer is
   the depository whose full name appears **first** (the letterhead) → `NSDL` or `CDSL`.
3. **Long single-scheme statement:** rule 1 again, over the **whole** document.
   - Why: a CAMS/KFintech CAS with one scheme and years of SIPs can print "Closing Unit Balance" only after many
     pages of transactions. Seen 28-Oct-2026: one scheme, 452 transactions, closing balance on page 8.
   - Why it runs after rule 2: a depository statement is never misread, and every earlier statement is detected
     exactly as before.
4. Otherwise → `UNSUPPORTED`, which throws `UNSUPPORTED_FORMAT`.

### C1. CAMS / KFintech parser — `cas/parse-cams-kfintech.js`

- The layout is AMC → Folio → Scheme. Each scheme block is **anchored on its ISIN**.
  - An ISIN split across two lines (e.g. `INF917K01QA` / `1(Advisor…)`) is rejoined only when
    the 12-character code passes the check digit.
  - Scheme names that wrap onto the line before the ISIN are joined. The right-hand
    "Registrar : CAMS" cell is ignored.
  - Fund-house headings are recognised from the portfolio summary as well (e.g. "Zerodha Fund House").
- Values are read **by label** ("Closing Unit Balance:", "NAV on <date>:", "Total Cost Value",
  "Market Value") and never by fixed position.
- The transaction table is read through **column bands** built from the block's own header
  (Date | Transaction | Amount | Units | Price | Unit Balance) by `cas/table-columns.js`.
- Statement period, investor PAN/email and printed portfolio totals are read from the header and
  summary.

### C2. NSDL / CDSL parser — `cas/parse-nsdl-cdsl.js`

Depository statements are true tables with wrapped, vertically centred cells:

1. **Header blocks.** A header is the block of lines around a cell reading "ISIN…". Header text
   wraps over 2–3 lines. Fragments that overlap horizontally merge into one column label, and
   the columns become bands split at the midpoints between column centres.
2. **Row clustering.** One logical row can span several text lines (a wrapped fund name, ISIN with
   UCC, centred numbers). Lines closer than 1.45 line heights form a **cluster**. A cluster holding
   several ISINs is split by assigning each line to its nearest ISIN line.
3. **Lanes.** Cells are assigned to column bands by x position, and left-edge lanes keep a wrapped
   name in its own column.
4. **Scope.** A row is a mutual-fund holding when its ISIN starts with `INF`. Other securities
   (shares, bonds) are counted and reported in a warning, never silently dropped.
5. **Totals.** A depository grand total includes equities, so reconciliation uses the "Total" row of
   each **mutual-fund table segment**, including segments that continue across pages. A cost
   check runs only for tables that print a cost column.

### Investor name — `cas/investor-name.js`

Shared by both parsers. The strategies below are tried in order of reliability, and a candidate is
accepted only if it reads like a person's name:

1. A labelled field: "Name : X", "Investor Name X", "Sole / First Holder: X" (label and value may
   be in separate cells).
2. A left-column name near the email line (two-column CAMS headers with prose on the right).
3. The first cell that looks like a name.
4. The holder line repeated under the first "Folio No".

### D. Normalize — `cas/normalize.js`

- Trims whitespace and keeps rows in printed order. No arithmetic is done on printed values.
- `status` is `"redeemed"` when the printed closing units are zero, and `"active"` otherwise.
- Collects every PAN into `investor.pans`.
- Splits a title printed before the name (MR, SHRI, MRS, SMT, MS, MISS, KUM…) into
  `investor.title`. The app maps it to **Mr. / Mrs. / Ms.** for the salutation. If no title is
  printed, none is set.

### E. Validate — `cas/validate.js`

**Row flags** (`holding.flags`, using the `FLAG` constants):

| Flag | Rule |
|---|---|
| `MISSING_REQUIRED` | ISIN or scheme name not read |
| `ISIN_INVALID` | ISIN fails the ISO 6166 check digit (`identity/isin.js`) |
| `NAV_WITHOUT_DATE` | NAV printed without a NAV date |
| `VALUE_WITHOUT_UNITS` | Value printed but no unit balance |
| `UNITS_NAV_VALUE_MISMATCH` | \|units × NAV − value\| exceeds the rounding bound |
| `COST_MISMATCH` | \|units × average cost − cost\| exceeds the rounding bound |
| `GAIN_MISMATCH` | value − cost ≠ printed profit/loss (in paise, ± ₹1) |
| `UNIT_BALANCE_MISMATCH` | opening units + Σ transaction units, or the last running balance, ≠ closing units (± 0.002) |

**Rounding bound.** For `a × b ≈ c`, the tolerance comes from the decimals the statement itself
printed: `|a|·½·10^−dec(b) + |b|·½·10^−dec(a) + ½·10^−dec(c) + ₹0.05 slack`. A NAV printed to 4
decimals is therefore held to that precision, and a mismatch means a misread, not rounding.

**Portfolio checks** (`integrity.checks`):

| Check | Rule |
|---|---|
| `TOTAL_MARKET_RECONCILES` | Σ printed holding values = printed total value (± ₹1) |
| `TOTAL_COST_RECONCILES` | Σ printed holding costs = printed total cost (± ₹1) |
| `HOLDING_COUNT_SANITY` | 1 ≤ holdings ≤ 500 |
| `NO_DUPLICATE_ISIN_FOLIO` | Each ISIN + folio pair appears once |
| `AMC_TOTALS_RECONCILE` | For each fund house in the CAMS/KFintech portfolio summary, Σ funds read = printed value (± ₹1). Names the fund house and amount when it fails |

**After upload,** if any check fails, a popup lists the problems in plain words, the fund house first.
The advisor can choose another file or continue; flagged figures stay marked and must be confirmed
before download.

A holding the parser missed still appears in the printed total, so a missing row always shows up as
a failed reconciliation. `integrity.status` is `"needs_review"` if any flag or check fails, and
`"ok"` otherwise.

All tolerances live in `calculation-engine/config.js`.

---

## 3. Data contract — `NormalizedPortfolio`

```
source      { format, statementAsOf, statementPeriod { from, to }, generatedOn, rawFileName }
investor    { name, title, pan, pans[], email, address }
holdings[]  { isin, schemeName, rtaSchemeCode, amc, folio, pan, registrar, status,
              openingUnits, units, nav, navDate, costValue, marketValue, averageCost, printedGain,
              raw { …same fields as printed strings },
              transactions[] { date, description, amount, units, price, unitBalance, raw },
              category, assetClass,            // Phase 2 enrichment
              flags[] }
printedTotals { totalCostValue, totalMarketValue, raw }
integrity   { status: "ok" | "needs_review", checks[], warnings[] }
```

Dates are ISO `YYYY-MM-DD`. `holdingKey(h)` = `ISIN|folio` is a holding's stable identity, because
one ISIN can sit in several folios. Advisor choices are keyed by it.

---

## 4. Portfolio models — `calculation-engine/portfolio-analyzer/`

All are pure functions over a validated portfolio and return plain objects.

| Function | File | Produces |
|---|---|---|
| `summarizePortfolio(p)` | `summary.js` | Fund/AMC counts, total value, cost, gain and gain %, AMC split, `shareOf(h)` |
| `holdingGain(h)` | `summary.js` | `{ gain, gainPct }` for one fund from printed cost and value |
| `summarizeRecommendations(p, verdicts)` | `recommendation.js` | Invest/Hold/Sell counts, values and shares; `complete` and `unset` |
| `allocatePortfolio({ amount, rows })` | `recommended-portfolio.js` | Exact rupee amount per fund plus validation issues |
| `buildSnapshot(p, fundData)` | `snapshot.js` | Every number on the One-Pager |
| `buildDetailedReport({ portfolio, fundData, verdicts, allocation })` | `detailed-report.js` | Every number in the Detailed Report |

**Exact allocation.** Percentages become integer basis points and the amount becomes paise. When the
rows total 100%, each row's amount is floored, and the leftover paise go to the rows with the
largest remainders. The row amounts therefore always sum to the amount exactly. Issue codes:
`AMOUNT_INVALID, NO_ROWS, NO_FUND, ZERO_PCT, PCT_INVALID, DUPLICATE_FUND, ISIN_INVALID, TOTAL_NOT_100`.
They are reported, never auto-fixed.

**One-Pager model.** Every active holding is listed, ranked by current value. Redeemed holdings
(zero closing units) are never shown, and there is no "Other holdings" row by default; the
`topN` option can still fold the rest into one. Weights come from exact paise sums. The printed
sheet stays on one page through `fitSnapshotSheet`, which measures the sheet and then tightens
rows, then zooms the holdings table, then zooms the whole page content, never below 70%. Average edge = mean of (portfolio − benchmark) across the
trailing periods.

**Detailed model.** Active holdings are grouped by asset class (Equity, Hybrid, Debt, Gold/Silver; Hybrid =
AMFI's Hybrid class) and listed alphabetically within each group.
- **Group of a fund.** `assetGroup` reads the AMFI class, category and name.
  - A fund of funds, domestic or overseas (FoF Overseas and overseas ETFs too), goes by what its name says
    (`fofGroup`). An overseas one is equity unless its name says bonds, treasury or debt. "Income" means debt only
    when the name does not say "equity", so "Global Equity Income" is equity. Gold- or silver-*mining* funds are
    equity, not gold. For example, "Diversified Equity All Cap FOF" is equity, "Income Plus Arbitrage FOF" is debt,
    "Multi-Asset FOF" is hybrid, and a gold or silver FoF is gold/silver.
  - A fund the name cannot place goes by its look-through holdings (`groupFromMix`): the asset type that makes up 65%
    or more, otherwise hybrid.
  - Name patterns are whole-word. "G-Sec" must not match "esG SECtor", which once put an ESG equity FoF under debt.
- **Unplaced funds.** A fund that still cannot be placed is listed under its own **OTHER** heading. It never appears
  under the heading above it. Before this fix, an unplaced equity FoF appeared to sit under Gold / Silver. Group totals are exact. Fund Performance
(Section 03) lists equity, hybrid and gold/silver funds; debt funds and ETFs are left out. A fund appears once there
even when it is held in several folios (one row per ISIN, because the returns are identical); Regular and Direct
plans of a scheme are separate rows, because their returns differ. Holdings (Section 01) still lists every folio.
Market-Cap Breakdown – Fund-wise (Section 02) lists each scheme once. There the Regular and Direct plans count as one
fund (the same portfolio, so the same large / mid / small split), and several folios merge too. The row shows the
scheme's name without plan, option or demat wording. The blended row is still value-weighted across every holding.
With only one fund in the portfolio (in any number of folios), Portfolio Overlap is left out of the preview and the PDF,
and Returns & Risk and Conclusion become Sections 04 and 05 (`overlapApplies`). Otherwise, Portfolio Overlap
(Section 04) shows the share of the same stocks held by each pair of funds (0–100%, `fundOverlap` on PulseDB holdings;
several folios and both plans of a fund count once, under the plan-neutral scheme name). Compared: equity and hybrid
funds (index funds and equity ETFs included; a hybrid fund's stock portion). Left out: debt, gold & silver, funds of
funds (owner's rule) and arbitrage funds (hedged stock positions). One page:
- **Closest overlap for every fund**: a lollipop row per pair on one 0–100% scale (red ≥ 50%, amber 25–50%, green
  < 25%), highest first; every fund is on the row of the fund it overlaps with most (two funds that are each other's
  closest share a row); a fund below 10% with every fund gets its own row ("No overlap above 8% with any fund").
  Above 16 rows the chart runs in two columns. Tested with 50 funds (45 rows) on one A4 page;
- Overlap Summary: one compact box per bucket with a single comment (what it means for the client, plus the stocks
  most often held in common for High / Moderate) and the pairs' names with their % (High up to 10, Moderate up to 8,
  the rest counted). Low lists the funds with low overlap against every other fund.
- The chart, then the summary, are scaled down (to 60% / 82% at most) until both fit; only beyond that does the summary
  continue on the next page.
Returns & Risk is Section 05, Conclusion & Recommendation Section 06. A blended return is shown only when every
fund has that period. Without fund data, the holdings form one ungrouped list and analytics are `null`.

**Fund data (Phase 2).** `getFundData(portfolio)` currently returns `null`. Its `FundData` /
`FundInfo` typedefs in `market/fund-data-provider.js` define exactly what the reports will consume.
All analytics fields render as "—" until it is connected. Nothing is estimated.

---

## 5. Advisor workflow — `app/portfolio-analyzer/`

```
Upload ─► (password asked immediately if protected) ─► Analyse ─► choose report
                                                                    │
         ┌──────────────────────────────────────────────────────────┴──────────┐
   One-Pager Snapshot                                     Detailed Recommendation Report
   overview + infographics + settings                     1 Upload
   → download factsheet (1 page)                          2 Portfolio review
                                                          3 Recommendation (Invest / Hold / Sell)
                                                          4 Recommended portfolio
                                                          5 Final review → download
```

- **Gating.** A step opens only when the steps before it are complete. The "report reviewed" box
  unlocks only after the report details are set, and the download requires that box to be ticked.
- **State.** `client-store.js` holds the salutation, verdicts, recommended rows and acknowledgements
  **in memory only**. A refresh, Home or a new upload starts fresh, so one client's choices never
  leak into another's.
- **Salutation.** It defaults to the title printed on the CAS (mapped to Mr. / Mrs. / Ms.), and the
  advisor can change it.
- **Report details (automatic).** Risk profile, Horizon and Diversification are computed by
  `buildReportProfile` (`calculation-engine/portfolio-analyzer/report-profile.js`) and pre-filled.
  Each field shows its basis, and the advisor can change it. The full logic is in
  [report-profile-logic.md](report-profile-logic.md).
- **Optional recommended portfolio.** Step 4 can be skipped. While the portfolio is incomplete,
  the Next button reads "Skip this step". When it is skipped, the report leaves out The Way Forward
  (Section 05 is the last section), and Sell wording no longer refers to a Prosperr Recommended
  Portfolio. A complete portfolio is always included.
- **Model portfolios.** In Step 4, the **Model Portfolio** button opens a popup of colour-coded
  baskets. Choosing one fills the recommended list with that basket's funds and allocations, and
  the advisor can still edit every row. Baskets are defined only in
  `app/portfolio-analyzer/model-portfolios.js`; the current ones are placeholders marked "Draft".
- **Screens** (`screens/`): `upload`, `review`, `recommendation`, `builder`, `final` and `snapshot`.
  Each screen is glue: it takes engine output and renders design-system components.

---

## 6. Reports — `app/portfolio-analyzer/reports/`

Both reports are replicas of the reference PDFs in US Letter (8.5 × 11 in), and are printed with the
browser's "Save as PDF" through `app/shared/print.js`. The report element is cloned into
`#print-root`, and print CSS hides everything else.

| Report | Layout | Wording | Styles | Reference |
|---|---|---|---|---|
| One-Pager Snapshot | `snapshot-sheet.js`, `snapshot-format.js` | `snapshot-copy.js` | `design-system/portfolio-analyzer/snapshot.css` | *Sample Portfolio Review.pdf* |
| Detailed Recommendation | `detailed-report.js` | `detailed-copy.js` | `design-system/portfolio-analyzer/detailed-report.css` | *Portfolio Review & Recommandation Updated.pdf* |

**Detailed report pagination.** Pages are filled **by measurement** in a hidden staging area after
fonts load. A section writer appends blocks and tables, and when content overflows a page, it moves
to a "(continued)" page of the same section with the table header repeated. The Overview Holdings
table zooms to fit one page, down to 0.6× at minimum. The "As On" date is the day the report is
downloaded.

**Report commentary** (`commentary.js`, `detailed-copy.js`) states only what the advisor decided and
what the statement shows. It never claims a performance reason without the numbers behind it.

---

## 7. Testing

| Suite | Covers |
|---|---|
| `tests/engine.test.js` (`/tests/`) | Value parsing, ISIN, both parsers on synthetic layouts, flags, name and title extraction, snapshot and detailed models, exact allocation, determinism |
| `tests/pdf.test.js` (`/tests/pdf.html`) | Real CAMS, NSDL and CDSL PDFs through the full pipeline, with field-by-field comparison |
| `tests/preview.html` | Opens the real workflow at any step, with sample or fixture data, for visual and print checks |

When a real statement misreads, open `/tests/dump.html` with that file to see the extracted rows,
add an anonymised fixture that reproduces the problem, and then fix the parser. Never patch values
downstream.
