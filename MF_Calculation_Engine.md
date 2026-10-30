# FILE 1 of 2 — CALCULATION ENGINE SPECIFICATION (`MF_Calculation_Engine.md`)

> **THE SINGLE SOURCE OF TRUTH FOR ALL MATH.**
> Every return, average, ranking, quartile, and chart value shown anywhere in the platform is computed ONLY by the logic in this file, implemented as ONE Python module: `engine/calculation_engine.py`.
> **Rule for the agent:** never re-implement, duplicate, or "optimize" any formula elsewhere (not in SQL, not in JavaScript, not in a second Python file). When the owner wants a logic change, it is changed HERE and only here, and the whole platform updates automatically.
> **Status: LOCKED.** Modify only when the owner explicitly instructs a logic change.

---

## E1. NAV Lookup Conventions (Used by Everything Below)

Three date-resolution rules. Use exactly the rule named by each calculation:

| Rule | Meaning | Used for |
|---|---|---|
| **NEAREST-PREVIOUS** | If NAV missing on target date, step BACKWARD: −1, −2, −3 … days until a NAV is found | Trailing return start dates; all period END dates |
| **NEAREST-NEXT** | If NAV missing on target date, step FORWARD: +1, +2, +3 … days until a NAV is found | All period START dates (start of month / quarter / year) |
| **ANCHOR (T)** | Latest available NAV date ≤ selected date (default: today) | The "as of" date for trailing returns and all live tables |

- Search window cap: 10 calendar days. If no NAV found within 10 days → value is `null` → display `—`.
- A fund is **eligible** for a period only if its first-ever NAV date ≤ the period's resolved start date. Otherwise `—`. Never annualize or extrapolate short histories.

---

## E2. Trailing Returns (T-Anchored) — periods: 1M, 3M, 6M, 12M, 3Y, 5Y, 10Y

1. **T** = ANCHOR date (latest NAV ≤ today). Updates automatically every trading day as new NAVs arrive.
2. Start target = T − period (calendar arithmetic). Resolve start NAV with **NEAREST-PREVIOUS**.
3. Formulas:
   - **≤ 12M (simple absolute):** `(NAV_T / NAV_start) − 1`
   - **> 12M (CAGR, exact day count):** `(NAV_T / NAV_start) ^ (365 / actual_days_between_the_two_NAV_dates) − 1`

## E3. Annual Returns (Calendar Year) — 2010 → current year

- **Start NAV:** first trading day of the year → target 01-Jan, resolve with **NEAREST-NEXT** (+1, +2 …).
- **End NAV:** last trading day of the year → target 31-Dec, resolve with **NEAREST-PREVIOUS** (−1, −2 …).
- **Return:** `(NAV_end / NAV_start) − 1` (simple, never annualized).
- **Current year = YTD:** start NAV as above; end NAV = ANCHOR (T). Label the column `YTD 2026`, never just the year. Rolls into a completed year automatically when the calendar year ends.

## E4. Quarterly Returns (Point-to-Point)

- Quarters: Q1 = 01-Jan→31-Mar, Q2 = 01-Apr→30-Jun, Q3 = 01-Jul→30-Sep, Q4 = 01-Oct→31-Dec.
- **Start NAV:** quarter start date, resolve **NEAREST-NEXT** (+1, +2 …).
- **End NAV:** quarter end date, resolve **NEAREST-PREVIOUS** (−1, −2 …).
- **Return:** `(NAV_end / NAV_start) − 1`.
- **Current (incomplete) quarter:** end NAV = ANCHOR (T), label `QTD`. Rolls automatically at quarter end.

## E5. Monthly Returns (Point-to-Point)

- **Start NAV:** 1st of month, resolve **NEAREST-NEXT**. **End NAV:** last calendar day of month, resolve **NEAREST-PREVIOUS**.
- **Return:** `(NAV_end / NAV_start) − 1`. Current month = `MTD` (end = ANCHOR T), rolls automatically.

## E5.1 WORKED EXAMPLES — Every Return Type (follow these exactly)

Assume today = 08-Jul-2026 and this fund's data where needed:

**Trailing 1M (simple):**
- T = 08-Jul-2026, NAV_T = 150.00. Target start = 08-Jun-2026 → no NAV (Sunday) → NEAREST-PREVIOUS → 06-Jun-2026, NAV = 145.00.
- Return = (150.00 / 145.00) − 1 = **+3.45%**
- *Identical procedure for 3M (target 08-Apr-2026), 6M (08-Jan-2026), 12M (08-Jul-2025) — always simple, never annualized.*

**Trailing 3Y (CAGR):**
- Target start = 08-Jul-2023 → NEAREST-PREVIOUS → 07-Jul-2023, NAV = 100.00.
- Actual days between 07-Jul-2023 and 08-Jul-2026 = 1097.
- CAGR = (150.00 / 100.00) ^ (365 / 1097) − 1 = 1.5^0.33272 − 1 = **+14.44% p.a.**
- *Identical procedure for 5Y and 10Y — always CAGR with the actual day count between the two NAV dates actually used.*

**Monthly (June 2026):**
- Start: 01-Jun-2026 has NAV 148.00 (if missing → +1, +2 …). End: 30-Jun-2026 has NAV 152.00 (if missing → −1, −2 …).
- Return = (152.00 / 148.00) − 1 = **+2.70%**

**Quarterly (Q1-2026):**
- Start: 01-Jan-2026 is a holiday → NEAREST-NEXT → 02-Jan-2026, NAV = 140.00.
- End: 31-Mar-2026, NAV = 146.00 (if missing → −1, −2 …).
- Return = (146.00 / 140.00) − 1 = **+4.29%**

**Annual (2025):**
- Start: 01-Jan-2025 holiday → +1 → 02-Jan-2025, NAV = 120.00. End: 31-Dec-2025, NAV = 138.00.
- Return = (138.00 / 120.00) − 1 = **+15.00%**

**YTD (2026, today = 08-Jul-2026):**
- Start: 02-Jan-2026 (NEAREST-NEXT from 01-Jan), NAV = 138.00. End: ANCHOR T = 08-Jul-2026, NAV = 150.00.
- YTD = (150.00 / 138.00) − 1 = **+8.70%** — recomputed every trading day; becomes "2026" automatically after the year's last trading day.

**Ineligibility:** fund launched 15-Mar-2024 → 3Y/5Y/10Y trailing, Annual 2010–2023, and Q1-2024-and-earlier quarters all = `—`.

## E6. Category Average

For any category and any timeframe (trailing / monthly / quarterly / annual):
`Category Average = equal-weighted mean of all eligible funds' returns` — funds showing `—` for that timeframe are EXCLUDED from that cell's average (never counted as zero). Fund count per cell available on hover.

## E7. Benchmark / Index Returns

Index returns use **THE SAME FUNCTIONS E2–E5** applied to the index's daily closing prices (stored like NAVs). One engine, identical methodology → fund vs index comparisons are always like-for-like.

### E7.1 Synthetic Blended Benchmarks (for Hybrid & Multi-Asset categories)

Composite hybrid indices (e.g., "NIFTY 50 Hybrid Composite Debt 65:35") are not available on Yahoo Finance, so hybrid benchmarks are built as **daily-rebalanced blends of available component indices**:

1. Each blended benchmark is defined in config as components + weights, e.g. `65% NIFTY 50 + 35% Gilt ETF`.
2. Build a synthetic daily series starting at 100:
   ```
   blend_value_0 = 100
   blend_value_t = blend_value_{t-1} × (1 + Σ_i [ w_i × r_{i,t} ])
   where r_{i,t} = (close_{i,t} / close_{i,t-1}) − 1   (component daily return)
   ```
   Dates where any component is missing a close are skipped (carried forward) for all components together, keeping the blend internally consistent.
3. Store the synthetic series in `index_history` like any real index — every downstream calculation (E2–E5, charts, tables) then treats it identically. Weights/components are data (config table), changeable without code.
4. **Interactive Blend Builder (dashboard):** the owner can type new weight numbers into the Hybrid benchmark panel and the blended series recomputes instantly on screen (client-side implementation of THIS formula only — the single sanctioned UI-side calculation, because it is an interactive what-if tool). The stored/permanent blend still comes from the config table.

## E8. Chart Normalization (All Comparison Charts)

- All series (funds + index) are rebased to **start at 0%**:
  `value_t = ((NAV_t / NAV_series_start) − 1) × 100`
- Common start date = latest first-available date across all selected series, resolved NEAREST-NEXT.
- Timeframe presets resolve start dates exactly as: 1M/3M/6M/12M/3Y/5Y → T minus period (NEAREST-PREVIOUS); **Annually** → fixed start 01-Jan-2017 (NEAREST-NEXT), end = ANCHOR, keeps extending automatically; **Custom** → user's start (NEAREST-NEXT) and end (NEAREST-PREVIOUS) dates.
- Hover tooltip shows: date, each series' NAV/close AND its normalized % value.

## E9. Quartile Ranking — Equity & Hybrid categories only

**Step 1 — Period returns:** Quarterly mode uses E4 returns; Annual mode uses E3 returns. Only COMPLETED periods are ranked (no QTD/YTD ranking).

**Step 2 — Rank** all eligible funds in the category for that period by return, descending (rank 1 = best). Funds with `—` are excluded and display `-`.

**Step 3 — Quartile assignment (owner's Excel formula, transcribed exactly — AUTHORITATIVE):**
```
=IFERROR( IF(rank <= ROUNDUP(N*0.25,0), 1,
          IF(rank <= ROUNDUP(N*0.50,0), 2,
          IF(rank <= ROUNDUP(N*0.75,0), 3, 4))), "-")
```
Python equivalent (must match the Excel output exactly, including remainder distribution):
```python
import math
def quartile(rank: int, n: int):
    if rank is None or n == 0:
        return None                      # displays '-'
    if rank <= math.ceil(n * 0.25): return 1
    if rank <= math.ceil(n * 0.50): return 2
    if rank <= math.ceil(n * 0.75): return 3
    return 4
```

**Step 4 — Colors (fixed):** Q1 = Green `#16A34A` · Q2 = Yellow `#EAB308` · Q3 = Light Orange `#FB923C` · Q4 = Red `#DC2626`. Rendered as colored pills/cells in the quartile grid (funds as rows, periods as columns).

## E10. Consistency & Volatility Boxes (beside Quartile section)

*Default definitions — owner may revise; change here only.* Computed over the last 8 completed quarters (minimum 6 with data):

- **Top 5 Consistent Performers:** lowest average quartile number; tie-break = higher % of periods in Q1. Shown with their avg-quartile score and mini quartile-history strip.
- **Top 5 Volatile Performers:** highest standard deviation of quarterly returns (population σ). Shown with σ and their best/worst quarter.
- In Annual mode: same definitions over the last 5 completed years (minimum 4).

## E11. Automatic Update Rules (No Manual Intervention, Ever)

After every daily data ingestion, the engine recomputes and republishes ALL derived outputs:
1. Trailing returns — recomputed daily (anchor T moves with each trading day).
2. MTD / QTD / YTD — recomputed daily; automatically become the completed month/quarter/year when the calendar rolls (a new column/period appears by itself, correctly labeled).
3. Category averages, benchmark returns, quartile ranks, consistency/volatility boxes, Top-10 winners/losers, chart series — all refreshed in the same run.
4. Every table and chart displays its **"Data as of DD-MMM-YYYY"** (the ANCHOR date) — dates always visible, never ambiguous.
5. The pipeline must be idempotent and fail-safe: a failed run leaves the previous day's published data intact; nothing ever half-updates or gets stuck.

## E12. RISK ANALYTICS — LOCKED (Industry-Standard Formulas) · **INTERNAL USE ONLY**

> **These metrics are for INTERNAL research use only** — the dashboard section must carry a visible "INTERNAL USE ONLY" badge and is never part of client-facing exports.

**Data conventions (apply to all metrics below):**
- Computation window: **trailing 3 years of MONTHLY returns (36 observations)** — the industry standard (Morningstar / factsheet convention). Minimum 30 monthly observations, else `—`.
- Monthly returns derived from month-end NAVs (E5 end-of-month convention): `r_m = (NAV_end_this_month / NAV_end_prev_month) − 1`. Benchmark monthly returns identically from index closes.
- **Risk-free rate (Rf):** configurable constant in config, default **6.5% p.a.** (India 91-day T-Bill proxy); monthly Rf = `(1 + Rf)^(1/12) − 1`. Owner changes it as data, not code.
- Fund annualized return over the window = 3Y CAGR (E2 logic).

**R1 — Standard Deviation (annualized):**
`σ_annual = STDEV(36 monthly returns, sample) × √12`
*Caption: "How much the fund's returns swing around their average — higher = bumpier ride."*

**R2 — Sharpe Ratio:**
`Sharpe = (Fund 3Y CAGR − Rf) / σ_annual`
*Caption: "Extra return earned per unit of total risk — higher is better."*

**R3 — Sortino Ratio:**
`Downside deviation σ_d = √( mean( min(r_m − Rf_monthly, 0)² ) ) × √12`
`Sortino = (Fund 3Y CAGR − Rf) / σ_d`
*Caption: "Like Sharpe, but only punishes downside swings — higher is better."*

**R4 — Beta & Alpha (vs category benchmark):**
`Beta = COVAR(fund monthly returns, benchmark monthly returns) / VAR(benchmark monthly returns)`
`Alpha (Jensen's, annualized) = Fund 3Y CAGR − [ Rf + Beta × (Benchmark 3Y CAGR − Rf) ]`
*Caption: "Beta = how hard the fund moves when its index moves (1 = same). Alpha = return the manager added beyond what Beta alone explains."*

**R5 — Maximum Drawdown + Recovery Time (daily NAVs, full available history):**
```
running_peak_t = max(NAV_0 … NAV_t)
drawdown_t     = NAV_t / running_peak_t − 1          # the underwater curve
Max Drawdown   = min(drawdown_t)                      # deepest fall, e.g. −38.4%
Recovery Time  = calendar days from the trough date until NAV first regains the prior peak
                 (display "Ongoing" if not yet recovered)
```
*Caption: "Worst peak-to-bottom fall an investor would have suffered, and how long it took to get their money back."*
**Dynamic graph (required):** interactive **underwater chart** — drawdown_t plotted as a shaded area below 0%, with the max-drawdown trough marked, the recovery point flagged, hover showing date/drawdown%, and the benchmark's underwater curve overlaid for comparison. Timeframe pills: 3Y | 5Y | Full history.

**R6 — Upside / Downside Capture Ratio (36 monthly returns):**
```
Up months  = months where benchmark return > 0;  Down months = benchmark return < 0
Upside Capture   = [ (Π(1+fund r_m in up months))^(12/n_up) − 1 ]  /  [ (Π(1+bench r_m in up months))^(12/n_up) − 1 ] × 100
Downside Capture = same construction over down months × 100
```
*Caption: "Of the index's gains, how much the fund captured (>100 = more than index); of the index's falls, how much it suffered (<100 = fell less). Ideal: high upside, low downside."*

**R7 — Risk-Adjusted Composite Ranking (0–100, within category):**
Percentile-score each fund within its category on: Sharpe (30%), Sortino (20%), Alpha (20%), Max Drawdown (15%, shallower = better), Capture Spread = Upside − Downside (15%). Composite = weighted sum → rank funds. *Weights are defaults in config — owner-editable as data.*
*Caption: "One 0–100 score combining all risk-adjusted measures — who delivers the best returns for the risk taken."*

## E13. Extension Protocol

Any future section the owner adds (new metric, new ranking, new analysis) follows this same pattern: its calculation is appended to THIS file as E15, E16, …, implemented only in the engine module, and consumed by the dashboard as pre-computed data. The engine file stays the only place math lives.

## E14. Rolling & Point-to-Point Returns (Separate Section)

**Mode A — "Current" (dynamic as-of date):**
- A date picker sets the **ANCHOR date** (default = today's latest NAV). ALL trailing windows — **1M, 3M, 6M, 1Y, 3Y, 5Y** — are computed with the exact E2 logic, just with ANCHOR = the selected date instead of today (e.g., pick 07-Jun-2024 → "1Y" = 07-Jun-2023 → 07-Jun-2024).
- Same lookup rules, same simple/CAGR split. Selecting any historical date replays the calculation exactly as it stood on that day. Default view = today, updating dynamically with each trading day.
- **Rolling statistics (per fund, per window length):** across ALL historical windows of that length (rolled daily) up to the anchor: `Average · Minimum · Maximum · % of windows positive · % of windows beating the category benchmark` (benchmark windows computed identically over index closes).

**Mode B — Point-to-Point:**
- Two date pickers: Start (resolve NEAREST-NEXT) and End (resolve NEAREST-PREVIOUS).
- Return = `(NAV_end / NAV_start) − 1`; if the two resolved dates are **> 366 days apart**, also show the CAGR: `(NAV_end/NAV_start)^(365/days) − 1`.
- Runs across **all categories, all funds, and AMC groupings** — the section offers Category view / AMC view exactly like the Returns Explorer.

Only these two modes exist in this section. All outputs recompute automatically as new data arrives.

---

## E15. CAS PORTFOLIO ENGINE

> Added per the E13 Extension Protocol. Everything that decides a NUMBER or FACT for the CAS Portfolio Analyzer lives here — parsing, validation, portfolio math, report models and report-profile rules. Design, wording and screens are NOT calculation and are specified elsewhere.

### E15.0 Scope, implementation and hard rules

- **Implementation:** the JavaScript module folder **`calculation-engine/`** (public API `calculation-engine/index.js`). It runs **inside the browser** so a client's CAS PDF is never uploaded anywhere. *(The NAV/AMFI sections E1–E14 and E16 are implemented in the Python module when the database is built; the same single-source rule applies to both.)*
- **No AI, no paid services.** CAS reading is 100% deterministic. pdf.js (open source, public CDN) is **injected** by the caller (`analyzeCasPdf({ pdfjs })`), never imported, so the engine runs unchanged in a browser or Node.
- **Pure functions:** no DOM, no CSS, no colors, no globals. Same input → byte-identical output.
- **Exactly as printed:** every printed number keeps its original string in `raw`. Values are never rounded, re-derived, "cleaned" or invented. A value not printed is `null`.
- **Flag, never fix:** a value that fails a check keeps its printed value and gets a flag; the advisor sees it and confirms before any report is downloaded.
- **Exact money:** sums use **integer paise** from the printed strings; allocations use **integer basis points** (BigInt where products can be large). No float drift ever reaches a client-facing figure.
- **No magic numbers:** every tolerance lives in `calculation-engine/config.js` (E15.7).

### E15.1 Normalized portfolio — the data contract (`model/portfolio.schema.js`)

Both CAS parsers MUST output exactly this shape; everything downstream reads ONLY this.

```
source       { format: CAMS_KFINTECH | NSDL | CDSL, statementAsOf, statementPeriod { from, to }, generatedOn, rawFileName }
investor     { name, title, pan, pans[], email, address }
holdings[]   { isin (PRIMARY KEY), schemeName, rtaSchemeCode, amc, folio, pan, registrar (CAMS | KFINTECH | null),
               status (active | redeemed), openingUnits, units, nav, navDate, costValue, marketValue,
               averageCost, printedGain,
               raw { openingUnits, units, nav, costValue, marketValue, averageCost, printedGain },   ← printed strings
               transactions[] { date, description, amount, units, price, unitBalance, raw },
               category, assetClass,   ← enrichment, null from the CAS
               flags[] }
printedTotals { totalCostValue, totalMarketValue, raw, byAmc[] { amc, costValue, marketValue, raw } }
integrity    { status: ok | needs_review, checks[] { name, passed, detail }, warnings[] }
```

- Dates ISO `YYYY-MM-DD`. Money in rupees as Number, with the printed string in `raw`.
- `holdingKey(h) = ISIN + "|" + folio` — one ISIN can sit in several folios; advisor choices are keyed by it.
- `printedTotals` come FROM the statement and are never computed to fill them.

### E15.2 CAS reading pipeline

`extract-text → detect-format → parse (CAMS/KFintech | NSDL/CDSL) → normalize → validate`

**A. Positional extraction (`cas/extract-text.js`).** pdf.js text items keep x, y and font height. Items whose baselines differ by ≤ fontHeight × 0.5 form one row; adjacent items closer than fontHeight × 0.35 merge into one cell; runs separated by wide spaces are split. Rows top→bottom, cells left→right. Fewer than 20 text items in the file → `NO_TEXT_LAYER` (scanned PDF). Errors are typed: `PASSWORD_REQUIRED`, `PASSWORD_INCORRECT`, `UNREADABLE_PDF`, `NO_TEXT_LAYER`, `UNSUPPORTED_FORMAT`. `probePdf` checks for a password before analysis.

**B. Format detection (`cas/detect-format.js`) — ordered, structural rules**:
1. Over the first 3 pages: "Closing Unit Balance" AND "Folio No" → `CAMS_KFINTECH`.
2. Over the first 3 pages: a depository marker (DP ID / Client ID / BO ID / Demat) → `NSDL` or `CDSL`, whichever depository's full name appears FIRST (the letterhead).
3. **Long single-scheme statements — rule 1 over the WHOLE document.** A CAMS/KFintech CAS holding one scheme with years of SIPs prints its transactions for many pages, so "Closing Unit Balance" can first appear late (seen 28-Oct-2026: one SBI ELSS scheme, 452 transactions, 8 pages, closing balance on page 8). When rules 1–2 find nothing, rule 1 is applied to every page. It runs only after rule 2, so a depository statement (which can list MF folios later on) is never misread as CAMS, and every statement detected before is detected exactly as before. Test: *"CAMS: one scheme with years of SIPs — Closing Unit Balance only on page 5"*.
4. Otherwise `UNSUPPORTED`.

**C. CAMS / KFintech parser (`cas/parse-cams-kfintech.js`).** Layout AMC → Folio → Scheme; each scheme block is anchored on its ISIN; values are read by LABEL ("Closing Unit Balance:", "NAV on <date>:", "Total Cost Value", "Market Value on <date>:"), never by position.
- **Wrapped ISIN:** "ISIN:" at line end with the code on the next line, OR the code itself split across lines (e.g. `INF917K01QA` / `1(Advisor…)`) is rejoined — accepted ONLY if the 12-character code passes the ISIN check digit (E15.4).
- **Wrapped scheme name:** a name fragment on the line(s) before the ISIN line (no labels, no numbers; the right-hand "Registrar : CAMS" cell ignored) is joined; `(Non` + `-Demat)` joins without a space.
- **Fund-house headings:** a row matching "… Mutual Fund / MF", or any fund-house name listed in the PORTFOLIO SUMMARY (e.g. "Zerodha Fund House").
- **Portfolio summary:** one row per fund house (cost, market value) → `printedTotals.byAmc`; the "Total" row → `printedTotals` totals.
- **Transactions:** read through column bands built from the block's own header (Date | Transaction | Amount | Units | Price | Unit Balance).

**D. NSDL / CDSL parser (`cas/parse-nsdl-cdsl.js`).** True tables:
1. The header is the block of lines around a cell reading "ISIN…" (wraps over several lines); its fragments become column bands split at midpoints between column centres.
2. Lines closer than 1.45 line heights form one cluster (one logical row); a cluster with several ISINs is split by nearest ISIN line. Text cells sharing a left edge form a lane that takes the column of its widest cell.
3. A numeric column with more than one fragment in a row is ambiguous → left `null` (and flagged), never guessed.
4. A row is a mutual fund when its ISIN starts with `INF`; other securities are counted in a warning, never silently dropped.
5. Printed totals = the "Total" row of each MUTUAL-FUND table segment (continuing across pages), summed in paise — never the statement's grand total (it includes equities). A segment mixing MF and non-MF rows cannot give an MF subtotal → `null` + warning.
6. `navDate` = the statement's "as on" date.

**E. Normalize (`cas/normalize.js`).** Trims whitespace, keeps printed order, no arithmetic. `status = redeemed` when printed closing units = 0, else `active`. Collects every PAN into `investor.pans`. A title printed before the name (MR, MRS, MS, MISS, DR, SHRI, SMT, KUMARI, KUM) is split into `investor.title`; none is inferred.

**Investor name (`cas/investor-name.js`)**, strategies in order, accepted only if it reads like a person's name: labelled field ("Name :", "Investor Name", "Sole / First Holder") → left-column name near the email line → first name-like cell → holder line under the first "Folio No".

### E15.3 Validation & integrity (`cas/validate.js`)

**Row flags:**

| Flag | Rule |
|---|---|
| `MISSING_REQUIRED` | ISIN or scheme name not read |
| `ISIN_INVALID` | fails the ISIN check digit (E15.4) |
| `NAV_WITHOUT_DATE` | NAV printed without a NAV date |
| `VALUE_WITHOUT_UNITS` | value printed but no unit balance |
| `UNITS_NAV_VALUE_MISMATCH` | \|units × NAV − value\| > rounding bound |
| `COST_MISMATCH` | \|units × average cost − cost\| > rounding bound |
| `GAIN_MISMATCH` | value − cost ≠ printed profit/loss, in paise, beyond ± ₹1 |
| `UNIT_BALANCE_MISMATCH` | opening units + Σ transaction units, or the last printed running balance, ≠ closing units (± 0.002) |

**Rounding bound** for a × b ≈ c, from the decimals the statement itself printed:
`|a|·½·10^−dec(b) + |b|·½·10^−dec(a) + ½·10^−dec(c) + ₹0.05 slack`.

**Portfolio checks:**

| Check | Rule |
|---|---|
| `TOTAL_MARKET_RECONCILES` | Σ printed holding values = printed total current value (± ₹1, integer paise) |
| `TOTAL_COST_RECONCILES` | Σ printed holding costs = printed total invested amount (± ₹1) |
| `HOLDING_COUNT_SANITY` | 1 ≤ holdings ≤ 500 |
| `NO_DUPLICATE_ISIN_FOLIO` | each ISIN + folio appears once |
| `AMC_TOTALS_RECONCILE` | per fund house in the CAMS/KFintech summary, Σ funds read = printed value (± ₹1); names the fund house and amount when it fails |

A printed total that cannot be found fails its check ("could not be verified"). A fund the parser missed still sits in the printed total, so a missing row always fails reconciliation. Any failure → `integrity.status = needs_review`, with plain-language warnings, most specific (fund house) first.

### E15.4 ISIN — primary key and check digit (`identity/isin.js`)

- Shape: 12 characters; Indian MF ISINs start `INF`.
- Check digit (mod-10 on the digit-expanded string): replace letters A=10 … Z=35; over the full string INCLUDING the check digit, counting from the right starting at 1, double every digit at an EVEN position; sum all digits (split two-digit products); valid if sum % 10 = 0. Verified: `INF846K01EW2`, `US0378331005`, `INE002A01018`.

**ISIN → AMFI scheme code (`identity/scheme-map.js`).** `buildSchemeMap(lists)` indexes the mapping
lists in `data/schemes/` (Regular, Direct, ETF — kept apart) by ISIN: the growth ISIN, and the second
AMFI ISIN column when printed. It refuses (SchemeMapError) a list whose count is wrong, an ISIN that
fails the check digit, or any ISIN / scheme code that appears twice, so a lookup is never ambiguous.
`mapHoldings(holdings, map)` matches by ISIN ONLY — never by name — and returns `matched`
(holding + scheme code, name, AMC, asset class, category, plan, active) and `unmatched` with a plain
reason: no valid ISIN · IDCW / dividend plan (the lists hold Growth only) · not in the AMFI list.
The scheme code is the key used to fetch the fund's data.
- Holdings are matched to market data by ISIN only — never by name.

### E15.5 Portfolio models (`portfolio-analyzer/`)

All are pure functions over a validated portfolio; money summed in integer paise from the printed strings.

**E15.5.1 Summary (`summary.js`).** Over ACTIVE holdings: fund/AMC counts; total current value (null if any active holding prints no value — a partial sum is never shown); invested amount and gain only over holdings printing BOTH cost and value (`holdingsWithoutCost` reports the rest); gain % = gain ÷ cost; AMC split sorted by value; `holdingGain(h) = { gain: value − cost, gainPct: gain ÷ cost }` or null.

**E15.5.2 Recommendation summary (`recommendation.js`).** For verdicts Invest / Hold / Sell: count, value and share of the active portfolio value; `unset` = active funds without a verdict; `complete` only when every active fund has one. Verdicts are the advisor's decision — the engine never sets one, except through E15.5.7 when rules are supplied.

**E15.5.3 Exact recommended-portfolio allocation (`recommended-portfolio.js`).**
- Percent → integer basis points (max 2 decimals; "12.5" → 1250). Amount → paise.
- Row paise = ⌊amount × bps ÷ 10000⌋ (BigInt). When allocations total exactly 100%, the leftover paise go one by one to the rows with the largest remainders (ties → earlier row), so row amounts ALWAYS sum to the amount exactly.
- Issues (reported, never auto-fixed): `AMOUNT_INVALID, NO_ROWS, NO_FUND, ZERO_PCT, PCT_INVALID, DUPLICATE_FUND, ISIN_INVALID, TOTAL_NOT_100`.
- The recommended portfolio is optional; a skipped or incomplete portfolio is not included in the report.

**E15.5.4 One-Pager model (`snapshot.js`).**
- Every ACTIVE holding with a printed value is listed, ranked by current value (ties by name); redeemed (zero-unit) funds are never shown. No "Other holdings" row by default (the `topN` option can fold the rest into one).
- Weight % = holding value ÷ total value (exact paise). Totals: value, invested (null unless every fund prints cost), gain, gain %.
- AMC allocation % of current value, largest first.
- Average edge (key insight) = mean over the periods shown of (portfolio return − benchmark return).
- Composition, sectors, market cap, trailing returns, risk, benchmark name and coverage are passed through from fund data — never estimated here.

**E15.5.5 Detailed-report model (`detailed-report.js`).**
- Active holdings grouped by asset class (Equity → Debt → Gold/Silver → unknown) when fund data gives it, alphabetical within each group; otherwise one list. Group values and weights in exact paise.
- Verdict summary (Invest / Hold / Sell: count, value, share).
- Fund-wise market cap for equity funds plus the blended split; performance groups (Equity, Gold/Silver — debt excluded).
- Portfolio vs benchmark returns: excess = portfolio − benchmark.
- Recommended portfolio rows sorted by allocation; **blended return per period = allocation-weighted average, shown ONLY when every fund has that period**.
- Section 05 lists funds in the order Invest → Hold → Sell, alphabetical within each (ordering applied when the report is laid out).

**E15.5.6 Report profile — Diversification, Risk Profile, Horizon (`report-profile.js`).** Fills the report details automatically; the advisor can change them. Funds = active holdings with a printed value; the same ISIN in several folios counts as ONE fund (values added). Bands include their lower edge. Comparisons are exact (paise × integer factors, BigInt).

*Diversification* — ideal fund range by portfolio value: < ₹5L → 2–4 · ₹5L–₹25L → 3–6 · ₹25L–₹1Cr → 4–8 · ₹1Cr–₹5Cr → 5–10 (₹5Cr exactly is here) · > ₹5Cr → 6–13. Status, first match wins: 1 fund OR any fund ≥ 50% of value → **Concentrated**; fewer than the minimum → **Under Diversified**; more than the maximum → **Over Diversified**; otherwise **Well Diversified**.

*Risk profile* = value-weighted equity exposure: `equity% = Σ(value × factor) ÷ Σ(value) × 100`.

| SEBI category | Equity factor |
|---|---|
| Equity (large/mid/small/flexi/multi/ELSS/index, incl. large & mid, focused, value, contra, dividend yield, sectoral) | 1.00 |
| Aggressive Hybrid | 0.70 |
| Balanced Hybrid / Balanced Advantage / Dynamic AA | 0.50 |
| Multi-Asset | 0.40 |
| Equity Savings | 0.30 |
| Conservative Hybrid | 0.20 |
| Gold / Silver / Commodity | 0.30 |
| Arbitrage | 0.00 |
| Debt / Liquid (all) | 0.00 |

Bands: < 20 Conservative · 20–40 Moderately Conservative · 40–60 Moderate · 60–80 Moderately Aggressive · ≥ 80 Aggressive.

*Horizon* = value-weighted ideal holding period: `avg_years = Σ(value × years) ÷ Σ(value)`.

| SEBI category | Years |
|---|---|
| Overnight, Liquid | 0.25 |
| Ultra-Short, Low Duration, Money Market, Floater, Arbitrage | 0.75 |
| Short Duration, Corporate Bond, Banking & PSU | 2.0 |
| Conservative Hybrid, Equity Savings | 2.5 |
| Medium Duration, Credit Risk, Dynamic Bond | 3.5 |
| Balanced Hybrid, Balanced Advantage, Multi-Asset, Gold (Silver treated as Gold) | 4.0 |
| Gilt, Medium-to-Long Duration | 4.5 |
| Aggressive Hybrid | 5.0 |
| Long Duration; Equity (large/flexi/multi/ELSS/index/sectoral, incl. large & mid, focused, value, contra, dividend yield) | 7.0 |
| Mid Cap | 8.0 |
| Small Cap | 10.0 |

Bands: < 1 Short Term · 1–3 Mid Term · 3–5 Mid to Long Term · ≥ 5 Long Term. Index funds tracking mid/small-cap indices are SEBI "Index Funds" → 7.0.

**Others (owner's rule, 22-Oct-2026):** a fund that fits no row of the two tables (international /
overseas FoFs, debt index / target-maturity funds, retirement / children's funds, other FoFs, unclear
names) is **"Others"**. It gets no equity factor and no years (never guessed), is LEFT OUT of both
averages (Risk and Horizon are computed over the remaining funds), and is named with its share of the
value next to the result, e.g. "1 fund in Others (1.34% of value, not counted): ABSL US Treasury 3-10
Year Bonds ETFs Passive FoF". Only when every fund is in Others are Risk and Horizon left blank.
Diversification counts every fund and needs no category.

*Fund category (`fund-category.js`)* — from the AMFI (SEBI) category when available (a generic AMFI label —
"Index Funds", "Other ETFs", "FoF Domestic / Overseas" — is read together with the fund's name, so a
G-Sec index fund is not equity), else from the scheme name ONLY when the name states it plainly; rules
are checked IN ORDER:
1. Others (not in the tables, never guessed): retirement/children's funds; international / overseas / Nasdaq / S&P 500 / regional funds; debt index, ETF, FoF or target-maturity funds (index/ETF/FoF + gilt/G-Sec/SDL/bond/debt/T-bill/treasury/CRISIL IBX); any other debt-looking name not matched below; "Commodities" equity funds.
2. Hybrids: arbitrage → equity savings → conservative hybrid / debt hybrid → balanced advantage / dynamic asset allocation → balanced hybrid → multi-asset → aggressive hybrid / equity & debt / equity hybrid.
3. Gold / silver / precious metals.
4. Debt: overnight → liquid → ultra short → low duration → money market → floater → short duration/term → banking & PSU → corporate bond → credit risk → dynamic bond → medium to long → medium duration/term → long duration → gilt / constant maturity.
5. ELSS (ELSS, tax saver/savings, long term equity, tax plan/advantage) → equity.
6. Equity: index/ETF/Nifty/Sensex/BeES → large & mid cap → small cap → mid cap → large cap / bluechip / top 100 / focused / flexi / multi cap / value / contra / dividend yield → sectoral/thematic keywords.

**E15.5.7 Rule-based verdict suggestions (`recommendation-rules.js`) — framework, inactive until rules are supplied.** Rules `{ id, verdict, reason, when: [ { metric, op, value } ] }` are checked top to bottom; the first rule whose conditions ALL hold pre-selects the fund's verdict (the advisor can change it). Metrics: `absoluteReturnPct, gainAmount, currentValue, investedValue, weightPct, return1y/3y/5y, excess1y/3y/5y, assetClass, category`. Operators: `< <= > >= = != in, not in`. A condition on unavailable data is FALSE. The rule set (`app/portfolio-analyzer/recommendation-rules.js`) is currently empty.

### E15.5.8 Current value at the latest NAV (`portfolio-analyzer/revalue.js`)

Runs AFTER validation (E15.3), so every statement check compares the figures as printed.
For each ACTIVE holding whose ISIN maps (E15.4) to a scheme with a latest stored NAV dated AFTER the
statement's NAV date: `value = units × latest NAV`, computed with integers (no floating point) and
rounded half-up to the paisa. The holding then carries the latest NAV, its date and that value; the
statement's NAV / date / value are kept in `holding.statement`. Any other holding keeps the statement
figures with the reason (redeemed · no units · not in the AMFI list, e.g. IDCW · no stored NAV · statement
as recent). `portfolio.valuation = { asOf, latest, statement, reasons }`; asOf = the latest NAV date used,
shown as "Data as on …". Every total, report and recommendation then uses these values.

### E15.5.9 Fund and portfolio returns & risk from NAV history (`portfolio-analyzer/portfolio-performance.js`)

**Data sources (owner's rule):** all return and risk calculations use the platform's own NAV store
(Supabase, by AMFI scheme code). Benchmark / index data, sector details, the large/mid/small split,
overlap and other holdings-level data come from PulseDB when connected; until then those figures are
null ("—"), never estimated.

- **Per fund:** 1Y / 3Y / 5Y trailing returns by E1/E2 at the fund's own ANCHOR (latest NAV).
- **Portfolio — the client's CURRENT units, looked back:**
  - T = the latest NAV date across the portfolio's funds.
  - A fund's NAV on any date = E1 NEAREST-PREVIOUS (10-day cap). A fund takes part in a figure only
    when it has a NAV for every date that figure needs.
  - `Value(d) = Σ units × NAV(d)` over the funds taking part.
  - Trailing ≤ 12M: `Value(T) / Value(T − p) − 1`.
  - Trailing > 12M: `(Value(T) / Value(T − p)) ^ (365 / calendar days from T − p to T) − 1`.
  - Risk (E12 R1–R3): the last 37 completed month-ends (last calendar day of each month before T's
    month, NEAREST-PREVIOUS) → 36 monthly returns `Value(mₖ) / Value(mₖ₋₁) − 1`; σ, Sharpe and Sortino
    with the same funds' 3Y CAGR and Rf 6.5%. Beta / Alpha need benchmark monthly returns → null.
  - **Coverage:** a portfolio figure is published only when the funds taking part hold ≥ 80%
    (`PORTFOLIO_ANALYTICS.minValueCoverage`) of the portfolio's current value (all active holdings);
    otherwise "—".
- **Asset group** for the reports (equity / debt / goldSilver) from the AMFI asset class, category and
  name; hybrid, solution-oriented and domestic fund-of-funds stay unclassified until holdings data.

Verified: the E5.1 worked examples (1M +3.45%, 3Y CAGR +14.44%) are unit tests; on a real 45-fund CAS
the engine's fund 1Y returns equal an independent recomputation from the stored NAVs (e.g. −5.27%, +7.96%).

- **Funds under a year old:** 1Y / 3Y / 5Y stay `—` (E1, never annualised); the fund shows its plain
  return since its first NAV, `NAV_T / NAV_first − 1`, labelled "since <month year>". Across the active
  universe on 21-Oct-2026: 431 funds are under 1 year, 1,300 under 3 years, 2,013 under 5 years; no
  fund old enough lacks a figure.

### E15.5.10 XIRR — portfolio and fund (`analytics/returns.js` xirr, `portfolio-analyzer/xirr.js`)

`XIRR = r` solving `Σ CFᵢ / (1 + r)^(daysᵢ / 365) = 0`, `daysᵢ` = calendar days from the first cash flow
(Excel XIRR convention). Solved by bisection on (−99.99%, +10,000%) to 1e-10; `—` when no rate solves it.
Verified: Excel's documented example = 37.3362535%.

Investor cash flows from the statement's transactions (exact paise from the printed amounts;
investments negative):

| Transaction | Cash flow | Why |
|---|---|---|
| Purchase / SIP / switch-in / NFO (amount > 0, units > 0) | − amount | money paid in (amount = units × price) |
| *** Stamp Duty *** | − amount | paid on top of the purchase amount |
| Redemption / switch-out / SIP rejection (amount < 0) | + amount | received — printed NET of STT / TDS |
| *** STT Paid *** / *** TDS on Above *** | none | already deducted from the redemption amount |
| IDCW / dividend payout (no units) | + amount | received |
| IDCW reinvestment | none | no cash moves |
| Lines without an amount (address, nominee, KYC) | none | not money |
| Each active holding today | + current value (E15.5.8) on its NAV date | |

Verified on a real CAS: redemption amount + STT line = units × price; purchase amount = units × price,
stamp duty separate. A holding is left out — and the PORTFOLIO XIRR is then `—` (a partial XIRR would
mislead) — when units are held at the start of the statement, it has no transactions, or opening units
+ transactions ≠ closing units (UNIT_BALANCE_MISMATCH). Real 45-fund CAS: 893 cash flows, engine XIRR
8.7737% = an independent recomputation.

### E15.5.11 Notes — funds without any trailing return (`portfolio-analyzer/return-notes.js`)

Shown at the end of the final review ("Cross-verify and download"), so a `—` is never mistaken for a
bug. Listed ONLY when a fund's 1Y, 3Y AND 5Y are all `—`, each with its reason:

| Kind | Reason shown |
|---|---|
| young | Launched on <first NAV date> — under a year of NAV history (return since launch given) |
| notListed | Not in the AMFI Growth fund list (e.g. IDCW plan) — statement value used |
| noRecentNav | Latest NAV published is older than 31 days |
| noHistory | No / too little NAV history stored |
| unavailable | NAV history could not be loaded when the report was prepared |

### E15.5.12 Portfolio Allocation from real holdings (`portfolio-analyzer/allocation.js`)

Runs automatically on every CAS upload with each fund's latest disclosed holdings from PulseDB
(benchmark, sector, market-cap and overlap data come from there; see the data-source rule in E15.5.9).
Report Section 02, the one-pager and the dashboard read its output.

**Holdings contract** (provider → engine), per fund ISIN: `{ asOn: "YYYY-MM", holdings: [{ name, isin,
assetType, sector, marketCap, weight }] }` — `assetType` ∈ equity · foreignEquity · debt · cash · gold ·
silver · reit · other; `marketCap` ∈ large · mid · small for domestic equity (SEBI/AMFI half-yearly list:
ranks 1–100 / 101–250 / 251+); `weight` = % of the fund's net assets. Fund-of-funds are passed through
to their underlying funds' holdings (weighted by the FoF's holding in each).

1. **Weights:** used only when they total 100% ± 2 points (disclosures round); then scaled to exactly
   100%. Otherwise the fund counts as "no holdings data".
2. **Value:** each fund counts with its current value (E15.5.8): `part = value × weight / 100`.
3. **Asset allocation:** equity = equity + foreignEquity; debt = debt + cash (cash, TREPS, T-bills);
   gold/silver = gold + silver; other = REIT / InvIT / rest. `% = Σ parts / Σ covered value × 100`.
4. **Market cap (equity):** over DOMESTIC equity only — `large % = Σ value × w(large) / Σ value × w(domestic
   equity)`; same for mid, small. Domestic equity without a class is reported in coverage, never guessed.
5. **Top sectors (equity):** `Σ value × w(sector) / Σ value × w(all equity)`, ranked largest first; no
   sector → "Unclassified".
6. **Fund-wise market-cap breakdown:** each fund's own large / mid / small split of its domestic equity —
   actively managed equity funds only: index funds, ETFs and debt funds are not listed (owner's rule).
   Its "Blended Equity" row = Σ (fund value × fund split) / Σ fund value over the funds listed.
7. **Coverage:** a portfolio figure is shown only when funds with holdings data hold ≥ 80% of the
   portfolio's current value; otherwise `—`. The holdings date ("as on") is reported.
8. **Overlap (next, same data):** overlap(A, B) = Σ over common securities (by ISIN) of min(wA, wB).
9. **Other:** REIT / InvIT and anything unclassifiable is shown as "Other (REIT / InvIT)" when above 0,
   so the asset split always totals 100%. Small negative weights (net payables) are kept: the split is net.

**PulseDB connection (live):** `data-pipeline/pulse_source.py` + `holdings_api.py`, served by the local
server as `GET /api/fund-holdings?isins=…`. Endpoint `mf/scheme_holdings_security` (latest disclosed month
when no `as_on` is sent); each row's asset type is derived, in this order: fund units ("ETF Units" /
"Mutual Fund Units" / INF… ISIN → looked through, up to 2 levels) · cash (TREPS, repo, margins, net
receivables) · debt (a credit rating, "Govt-Sec", or a coupon) · REIT/InvIT · foreign equity ("Overseas
Equity" or a non-Indian ISIN) · Indian equity with Large / Mid / Small Cap · gold / silver (sector
"Commodity" by name) · other Indian equity ISINs (no cap class) · other. Holdings are cached in Supabase
(`holdings/<scheme code>.json`) for 24 hours. Known limit: arbitrage funds disclose their long stock
positions but not the offsetting futures, so their equity shows gross (hedged).

Verified by a hand-computed unit test (60k fund 80% equity / 20% debt + 40k gold fund → 48 / 12 / 40;
large 62.5 / mid 37.5).

### E15.5.13 Peer statistics and automatic Invest / Hold / Sell (`data-pipeline/peer_stats.py`, `portfolio-analyzer/auto-recommendation.js`)

The decision rules (pillars, grades, fund types, portfolio stage, thresholds) are in **Recommendation_Logic.md**;
this section fixes the figures they use. Computed daily after the NAV update for every current fund (latest NAV
at most 7 days before AMFI's data date), each at its own ANCHOR T, and published to Supabase
`stats/peer-stats.json` (percent figures to 4 decimals; Sharpe as a ratio).

1. **Fund figures:** r1y / r3y / r5y by E2; Sharpe by E12 R1–R2 (month-end NAVs of the last 36 completed
   months by E1 NEAREST-PREVIOUS; pairs where both month-ends have a NAV; min 30 returns); max drawdown by
   E12 R5 over the daily NAVs from the 3Y start NAV (E1) to T; worst one-step fall over the same NAVs.
2. **Peer group** = plan (Regular / Direct / ETF) + AMFI asset class + AMFI category, exactly as listed.
3. **Median** per group and figure over funds that have it; only when ≥ 5 funds have it, else null.
4. **Rank** on r3y and on Sharpe: 1 + number of peers with a strictly higher value (ties share the better
   rank); quartile by E9. Only when ≥ 5 peers have the figure.
5. **Consistency:** for each of the last 24 completed month-ends M (common to all funds, from AMFI's data
   date), the fund's 3Y CAGR anchored at NAV(M) by E1 NEAREST-PREVIOUS (E2); the group median of that window
   (≥ 5 funds). Consistency = % of windows with both values where fund ≥ median; null with fewer than 12.
6. **Credit quality** (debt rule Q): Σ weight of debt rows rated AAA… / A1+ / Sovereign (or Govt-Sec
   without a rating) + cash, ÷ Σ weight of debt + cash rows (PulseDB holdings). Null when unrated
   non-government debt exceeds 10% of that total.
6a. **Own benchmark (v1.1):** the fund's benchmark (benchmark bucket `mapping/funds.json`, PulseDB prices)
   b1y / b3y / b5y by E2, anchored at the benchmark price on the fund's ANCHOR date by E1 NEAREST-PREVIOUS
   (10-day cap), so both cover the same days; excess = fund − benchmark (pp). Index funds: tracking difference
   = fund 3Y − benchmark 3Y. Null when the fund has no stored benchmark.
6b. **Excluded benchmarks:** a Pulse-made multi-index blend (weights in its name, e.g. "NIFTY 50 Index(50%)+CRISIL
   Short Term Index(50%)") is not used anywhere — checked 22-Oct-2026, these series do not follow their stated
   weights (AB124 1Y −9.07% vs −3.35% rebuilt from its components by E7; OHB30 −7.83% vs +2.71%; OHB76 −8.31% vs
   −2.42%). Official single indices (incl. CRISIL Hybrid 35+65 and NIFTY 50 Hybrid Composite 50:50) are used.
6b-1. **Our own benchmarks (29-Oct-2026, owner's request; `data-pipeline/benchmark_blends.py`):** built daily by
   E7.1 from stored indices and stored like any index (codes SB…):
   - **Every fund with a Pulse blend** (Balanced Advantage, Multi Asset, Equity Savings, Balanced Hybrid, Aggressive
     Hybrid, their FoFs, …): the blend rebuilt from its component indices with its stated weights (e.g. SBAB124 =
     NIFTY 50 50% + CRISIL Short Term Bond 50%; SBOHB30 = NIFTY 50 Arbitrage 75% + NIFTY 50 25%). A blend with a
     component we do not store (iCOMDEX, CRISIL Hybrid 50+50, BSE Oil & Gas, "gold and silver" as one) or weights that
     do not add up to 100% is not approximated — the fund shows no benchmark (18 schemes on 29-Oct-2026).
     Verified 29-Oct-2026: all 48 stored blends rebuilt independently from the component prices (max relative
     difference 6e-9); tests/peer-stats-check.html recomputes every benchmark figure with the engine (0 mismatches).
   - **Gold funds** (gold ETFs, gold FoFs): SBGOLD = Nippon India ETF Gold BeES NAV (AMFI). Pulse's gold price OB26
     is not used: one-day jumps that reverse (+14.9% / −12.9% / +13.7% on 1–3 Jun 2020, +16.7% on 16-Oct-2023).
     Gold BeES runs about its expense ratio (~0.8% a year) below the physical price.
   - **Silver funds:** OB202 Price of Silver. **Gold-and-silver funds:** SBGS = Gold 50% + Silver 50%.
   - **FoF Overseas / ETFs investing overseas:** S&P 500 (OB94); NASDAQ funds keep NASDAQ 100, Hang Seng funds Hang
     Seng TECH; overseas bond / treasury funds stay as Pulse maps them.
   Mining-equity funds (World Gold Mining) are not gold-price funds; "Equity Income" is not a bond fund.
6c. **Sector check:** the sector index (or, for an unmapped ETF, its own NAV when that history has no break) vs
   NIFTY 500 (OB56) at the same anchor — see Recommendation_Logic.md §4.2a.
7. **ELSS locked units:** min(current units, Σ units of transactions with positive units dated after
   asOf − 3 years) — redemptions consume the oldest units first (FIFO); all free 3 years after the last.

Verified: unit tests on hand-computed series (`data-pipeline/tests/test_peer_stats.py`), and an independent
recomputation of every figure with the browser engine's own E1 / E2 / E9 / E12 functions for six whole peer
groups (`tests/peer-stats-check.html`: 1,952 figures, 0 mismatches).

### E15.5.13a Benchmark in the reports (`portfolio-performance.js` fundInfo / buildFundData)

- **Per fund:** its own benchmark (benchmark bucket, verified as in E15.5.13 6a/6b): name, and 1Y / 3Y / 5Y by
  E2 anchored at the benchmark price on the fund's ANCHOR date (E1 NEAREST-PREVIOUS) — the blue benchmark line of
  Fund Performance. No verified benchmark → "BENCHMARK — NOT AVAILABLE", values "—".
- **Portfolio (blended benchmark):** each fund holds a position in its own benchmark worth the fund's value on T:
  `units_b = units × NAV(T) / B(T)`; `BenchValue(d) = Σ units_b × B(d)` (E1 NEAREST-PREVIOUS), looked back exactly
  like the portfolio (E15.5.9). A fund without a verified benchmark (or without a benchmark price on a needed date)
  stands in with its own NAV — neutral. Trailing returns as E15.5.9; Beta / Alpha by E12 R4 on the same 36
  month-ends; the benchmark's own Std Dev / Sharpe by E12 R1–R2. Used when funds with a verified benchmark
  hold ≥ 80% of the portfolio's value. Name: the index when all benchmarked funds share one, else "Blended
  Benchmark" (described as "each fund's own index, by value").
- **Otherwise the broad market (owner, 22-Oct-2026: Alpha and Beta must always be shown):** every fund is
  measured against NIFTY 500 (OB56) by the same method, and the report says so ("the funds' own benchmarks
  are verified for less than 80% of the portfolio's value"). `benchmarkBasis` = "funds" | "market".
- Verified by a unit test: funds that move exactly with their index give benchmark = portfolio, Beta 1, Alpha 0;
  below 80% coverage nothing is published.

### E15.6 Market-data interfaces (pending data source)

NAV history is connected (E15.5.8, E15.5.9; `analytics/returns.js`, `analytics/risk.js` implement E1/E2/E12). `market/fund-data-provider.js` (`getFundData`) and `market/nav-provider.js` remain interfaces for the PulseDB-backed data and return `null` / "not implemented" until connected; every consumer renders `null` as "—". The formulas used when they are wired are specified in this file by the owner (E1–E5 and E12 hold the platform's existing return and risk methodology).

### E15.7 Tunables (`calculation-engine/config.js`)

| Constant | Value | Meaning |
|---|---|---|
| `EXTRACTION.rowToleranceRatio` | 0.5 | items within fontHeight × 0.5 share a row |
| `EXTRACTION.cellMergeGapRatio` | 0.35 | items closer than fontHeight × 0.35 merge into a cell |
| `EXTRACTION.minTextItemsForTextLayer` | 20 | below this → scanned PDF |
| `DETECTION.pagesToScan` | 3 | pages scanned for format detection |
| `VALIDATION.rowValueSlackRupees` | 0.05 | slack added to the rounding bound |
| `VALIDATION.totalReconcileToleranceRupees` | 1 | allowed gap for totals (overall and per fund house) and printed gain |
| `VALIDATION.unitBalanceTolerance` | 0.002 | allowed unit-balance gap |
| `VALIDATION.maxPlausibleHoldings` | 500 | holding-count sanity limit |

### E15.8 Acceptance (CAS engine)

- All engine unit tests pass (`tests/` — parsing, wrapped ISIN/name, flags, per-AMC reconciliation, name/title, models, allocation, report-profile band edges).
- Real CAMS, NSDL and CDSL PDFs pass field-by-field (`tests/pdf.html`).
- Determinism: the same statement always produces identical output.

---

## E16. AMFI DATA COLLECTION — Historical Backfill & Daily Update

> Copied verbatim from `MF_Platform_Specification.md` P2.3 and P2.4 at the owner's instruction (that file is unchanged). Universe, scheme-code key and file parsing rules referenced here are in that file (P2.1, P2.2, Appendix PA).

### P2.3 Historical Backfill (one-time, 2010 → today)
Endpoint modes (all return the same semicolon format, Appendix PA):
- **PRIMARY — Mode 2 (all-AMC, monthly batches):** `https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?tp=1&frmdt=01-Jan-2010&todt=31-Jan-2010` … loop monthly to today (~195 requests; 90-day cap per request). Small batches fail loudly and retry — nothing lost silently.
- **Mode 1 (per-AMC long range, cross-check only):** `...?mf=3&frmdt=01-Jan-2023&todt=31-Jan-2026`
- **Mode 3 (single-date, gap repair):** `...?frmdt=27-Jan-2025` → all funds' NAV for that one date.
- Every batch logged (row counts); failed/empty batches retried via `--repair` until **zero failures**; then a completeness audit (any scheme with >5 consecutive missing trading days → Mode 3 repair per missing date).

### P2.4 Daily Update (forever)
- Source: `https://portal.amfiindia.com/spages/NAVOpen.txt` (latest trading day, all funds).
- Parse → filter to P2.1 universe → UPSERT by (scheme_code, nav_date) → each trading day lands as **one new row per fund**. Weekends/holidays = 0 new rows = success.
- Gap detector: any scheme >3 trading days stale → Mode 3 single-date repairs, automatically.
