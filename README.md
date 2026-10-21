# Prosperr.io Wealth

An advisor workspace for reviewing clients' mutual fund portfolios. An advisor uploads a client's
Consolidated Account Statement (CAS), gets a verified fund-by-fund review, records an
Invest / Hold / Sell call per fund, builds a recommended portfolio and downloads a branded report.

- **Free to run.** No AI, no tokens, no paid services, no build step.
- **Private.** Statements are read inside the browser and never uploaded.
- **Exact.** Every figure is read as printed and reconciled against the statement's own totals in integer paise.

## Quick start

Requirements: Windows with PowerShell 5.1+ and a modern browser (Edge or Chrome). Nothing to install.

```powershell
# Start the local server hidden in the background (no window)
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PWD\serve.ps1`""
```

Open <http://localhost:5173/>.

| Route | Page |
|---|---|
| `#/` | Home — landing page for advisors |
| `#/portfolio-analyzer` | Portfolio Analyzer — upload a CAS, review, recommend, download |
| `#/fund-research` | Fund Research — coming soon |

## Project layout

```
index.html            App entry: one stylesheet, one script
serve.ps1             Local static server (port 5173)
calculation-engine/   CORE 1 — all calculation: CAS parsing, validation, portfolio models. No DOM.
design-system/        CORE 2 — all presentation: tokens, components, layout, page styles. No logic.
app/                  Thin glue: routing, pages, and the Portfolio Analyzer workflow
assets/               Logo files
docs/                 Architecture and feature documentation
tests/                Browser-run unit tests, end-to-end PDF tests and visual tools
```

## Documentation

| Document | Read it for |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layering, data flow, routing and coding conventions |
| [docs/portfolio-analyzer.md](docs/portfolio-analyzer.md) | The CAS core logic: pipeline, data contract, validation rules, report models |
| [docs/report-profile-logic.md](docs/report-profile-logic.md) | Diversification, Risk Profile and Horizon rules that fill the Report details |
| [calculation-engine/README.md](calculation-engine/README.md) | Engine public API and how to add an analyzer |
| [design-system/README.md](design-system/README.md) | Design rules, tokens and components |
| [MF_Calculation_Engine.md](MF_Calculation_Engine.md) | **All calculation** — the single source of truth (CAS engine: section E15) |
| [Project_Specification_TEMP.md](Project_Specification_TEMP.md) | Product, design system, website and workflow (temporary file) |
| [MF_Platform_Specification.md](MF_Platform_Specification.md) | Reference platform spec: AMFI database, automation, research dashboard |

## Testing

With the server running, open these in a browser:

| URL | What it runs |
|---|---|
| `/tests/` | Engine unit tests (parsing, validation, allocation, report models) |
| `/tests/pdf.html` | End-to-end: real CAMS, NSDL and CDSL PDFs through the full pipeline |
| `/tests/preview.html?sample=1` | One-pager with sample data |
| `/tests/preview.html?sample=1&report=detailed&step=4&demo=1` | Detailed workflow at step 4 with sample data |
| `/tests/dump.html` | Diagnostic: shows the text rows extracted from any CAS |

`tests/screenshot.ps1` captures a page (or its print output with `-Pdf`) using headless Edge.

Real client statements used for local testing go in `tests/pdf-fixtures/local/`, which git ignores. Never commit them.
