# Prosperr.io Wealth

An advisor workspace for reviewing clients' mutual fund portfolios. An advisor uploads a client's
Consolidated Account Statement (CAS), gets a verified fund-by-fund review, records an
Invest / Hold / Sell call per fund, builds a recommended portfolio and downloads a branded report.

- **Free to run.** No AI, no tokens, no paid services, no build step.
- **Private.** Statements are read inside the browser and never uploaded.
- **Exact.** Every figure is read as printed and reconciled against the statement's own totals in integer paise.

## Quick start

Requirements: Node.js 20+ (`winget install OpenJS.NodeJS.LTS`), Python 3.12 for the data pipeline
(`pip install -r data-pipeline/requirements.txt`), and a modern browser (Edge or Chrome). No npm packages are needed.

```powershell
npm start                 # the website on this PC only (sign-in with the admin or team ID)
# Start hidden in the background (no window)
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
calculation-engine/   CORE 1 — all calculation: CAS parsing, validation, portfolio models. No DOM.
design-system/        CORE 2 — all presentation: tokens, components, layout, page styles. No logic.
app/                  Thin glue: routing, pages, and the Portfolio Analyzer workflow
server/               Node.js web server (port 5173): website files, /api routes, team sign-in, security
  config.js           Paths, limits, which files may be served
  app.js              Request handler: access check → sign-in → API → files
  routes/             api.js (market data), static.js (website files), team-auth.js (admin / team sign-in)
  lib/                env, logging, network, HTTP and Python-runner helpers
  tests/              Server unit tests (npm test)
data-pipeline/        Python: all heavy data work — AMFI/PulseDB collection, NAVs, benchmarks, peer stats, Supabase
config/               Owner settings written by the server (never served)
serve.ps1             Starts the server (finds Node.js)
assets/               Logo files
docs/                 Architecture and feature documentation
tests/                Browser-run unit tests, end-to-end PDF tests and visual tools
```

The browser never holds a key: every `/api` route validates its input, then the server runs the matching
`data-pipeline/*_api.py` script, which reads Supabase / PulseDB with the keys in `.env`.

## Where to change what

| To change… | Go to |
|---|---|
| A formula or threshold | `calculation-engine/` (limits in `config.js`), and its rule in `docs/MF_Calculation_Engine.md` |
| Invest / Hold / Sell logic | `calculation-engine/portfolio-analyzer/`: `fund-grading.js` (one fund), `portfolio-fit.js` (portfolio rules), `auto-recommendation.js` (ties them together) |
| Fund Scorecard | `calculation-engine/research/` (scoring), `app/pages/fund-scorecard/` (page) |
| A section of the Detailed Report | `app/portfolio-analyzer/reports/detailed/section-*.js`; wording in `detailed-copy.js` |
| A workflow screen | `app/portfolio-analyzer/screens/` |
| Colours, fonts, buttons | `design-system/` (tokens first) |
| An API route or access rule | `server/routes/` |
| NAVs, benchmarks, peer statistics | `data-pipeline/` (see its README: every file is listed there) |

## Documentation

| Document | Read it for |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layering, data flow, routing and coding conventions |
| [docs/portfolio-analyzer.md](docs/portfolio-analyzer.md) | The CAS core logic: pipeline, data contract, validation rules, report models |
| [docs/report-profile-logic.md](docs/report-profile-logic.md) | Diversification, Risk Profile and Horizon rules that fill the Report details |
| [calculation-engine/README.md](calculation-engine/README.md) | Engine public API and how to add an analyzer |
| [design-system/README.md](design-system/README.md) | Design rules, tokens and components |
| [docs/Recommendation_Logic.md](docs/Recommendation_Logic.md) | Invest / Hold / Sell rules (the owner-approved logic) |
| [docs/MF_Calculation_Engine.md](docs/MF_Calculation_Engine.md) | **All calculation** — the single source of truth (CAS engine: section E15) |
| [Project_Specification_TEMP.md](Project_Specification_TEMP.md) | Product, design system, website and workflow (temporary file) |
| [MF_Platform_Specification.md](MF_Platform_Specification.md) | Reference platform spec: AMFI database, automation, research dashboard |

## Testing

```powershell
npm test                  # server unit tests
npm run test:pipeline     # data-pipeline unit tests (Python)
```

With the server running, open these in a browser:

| URL | What it runs |
|---|---|
| `/tests/` | Engine unit tests (parsing, validation, allocation, report models) |
| `/tests/pdf.html` | End-to-end: real CAMS, NSDL and CDSL PDFs through the full pipeline |
| `/tests/preview.html?sample=1` | One-pager with sample data |
| `/tests/preview.html?sample=1&report=detailed&step=4&demo=1` | Detailed workflow at step 4 with sample data |
| `/tests/dump.html` | Diagnostic: shows the text rows extracted from any CAS |
| `/tests/mapping.html` | Diagnostic: checks each holding of a statement maps to the AMFI lists |
| `/tests/peer-stats-check.html` | Recomputes stored peer and benchmark figures with the engine and reports mismatches |

`tests/screenshot.ps1` captures a page (or its print output with `-Pdf`) using headless Edge.

Real client statements used for local testing go in `tests/pdf-fixtures/local/`, which git ignores. Never commit them.
