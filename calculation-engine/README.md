# Calculation Engine

Core 1: **all calculation.** It covers CAS parsing, validation, identity, the portfolio models and
the report-profile rules. It has no DOM, no CSS, no colors and no AI.

**Specification:** every rule implemented here is specified in
[`MF_Calculation_Engine.md`](../MF_Calculation_Engine.md), section E15 — the single source of truth.
A logic change is made there first, then here.

`index.js` is the public API. The app imports from there and never from deeper files.

## Public API

| Export | Purpose |
|---|---|
| `analyzeCasPdf({ data, password, fileName, pdfjs })` | Full pipeline: PDF → validated `NormalizedPortfolio` |
| `parseCasDocument(doc, fileName)` | Same pipeline from an already-extracted document (tests) |
| `probePdf({ data, pdfjs })` | Opens a file without parsing it, to detect a password early |
| `CasError`, `CAS_ERROR`, `CAS_FORMAT`, `FLAG` | Error codes, formats and validation flags |
| `isValidIsin`, `holdingKey` | ISIN check digit; stable holding identity (`ISIN\|folio`) |
| `summarizePortfolio`, `holdingGain` | Headline figures from printed values |
| `summarizeRecommendations`, `VERDICT(S)`, `excessReturn` | Invest / Hold / Sell summary |
| `allocatePortfolio`, `percentToBps` | Exact recommended-portfolio allocation |
| `buildSnapshot` | One-Pager model |
| `buildDetailedReport`, `ASSET_GROUPS` | Detailed Report model |
| `buildReportProfile`, `diversificationStatus`, `RISK_PROFILE_LABELS`, `HORIZON_LABELS`, `DIVERSIFICATION_STATUS` | Diversification, Risk Profile and Horizon (Report details) |
| `classifyFund`, `categoryFromText`, `FUND_CATEGORY` | SEBI fund category of a holding |
| `suggestVerdicts`, `fundMetrics`, `validateRules`, `RULE_METRICS`, `RULE_OPERATORS` | Rule-based Invest / Hold / Sell suggestions (inactive until rules are set) |
| `getFundData`, `trailingReturns`, `xirr`, `riskMetrics` | Phase 2 interfaces (return `null`) |

## Layout

```
index.js                public API
config.js               every tolerance and tunable
errors.js               CasError + codes
model/                  NormalizedPortfolio contract
cas/                    extract → detect → parse → normalize → validate
identity/               ISIN; ISIN → scheme map (Phase 2)
market/                 NAV and fund-data providers (Phase 2)
analytics/              returns and risk (Phase 2)
portfolio-analyzer/     summary, recommendation, allocation, snapshot, detailed-report,
                        report-profile, fund-category and verdict-rule models
```

## Rules

- pdf.js is **injected**, so the engine runs unchanged in a browser or in Node.
- Every printed number keeps its original string in `raw`. Money is reconciled in integer paise.
- Problems become `holding.flags` and `integrity.warnings`. Values are never guessed or corrected.
- Functions are pure, and the same input always gives the same output.

## Adding an analyzer

1. Specify the calculation in `MF_Calculation_Engine.md` (next free E-section, per E13).
2. Create a module, for example `analytics/concentration.js`, with a header comment stating
   input → output.
3. Take the `NormalizedPortfolio` (`model/portfolio.schema.js`) and/or market series as input, and
   return a plain object.
4. Add no UI, colors or magic numbers. Tunables go in `config.js` with a comment.
5. Export it from `index.js` and add tests in `tests/engine.test.js`.
6. In `app/`, call it and pass the result to a design-system component.
