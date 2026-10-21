# Architecture

## Principles

1. **Two cores, one thin glue layer.** All calculation lives in `calculation-engine/` (specified in
   `MF_Calculation_Engine.md`, section E15), and presentation lives in `design-system/`. `app/`
   connects them and holds neither math nor raw styling.
2. **Read, never guess.** Every figure comes from the statement as printed. Missing values stay
   `null` and display as "—". Inconsistencies are flagged and never silently corrected.
3. **Exact money.** Sums run in integer paise and allocations in integer basis points. There is no
   floating-point drift in anything a client sees.
4. **Free and private.** Plain ES modules run in the browser with no bundler, server code, AI or paid
   APIs. Client statements never leave the device.

## Layers

```
            ┌───────────────────────────────────────────────┐
            │ app/  — routing, pages, workflow, report      │
            │         layout, copy, display formatting      │
            └──────────────┬────────────────┬───────────────┘
                 calls     │                │   renders with
                           ▼                ▼
   ┌──────────────────────────────┐  ┌──────────────────────────────┐
   │ calculation-engine/          │  │ design-system/               │
   │ CAS → NormalizedPortfolio    │  │ tokens · components · layout │
   │ → models (summary, reports)  │  │ page & report styles         │
   │ No DOM, no CSS, no colors    │  │ No business logic            │
   └──────────────────────────────┘  └──────────────────────────────┘
```

**Dependency rules**

| Module | May import | Must not import |
|---|---|---|
| `calculation-engine/**` | Other engine modules | `app/`, `design-system/`, the DOM |
| `design-system/**` | Other design-system modules | `app/`, `calculation-engine/` |
| `app/**` | `calculation-engine/index.js` (public API only), `design-system/**` | Deep engine files |

## Directory map

```
calculation-engine/
  index.js                 Public API: the only entry point the app imports
  config.js                Every tolerance and tunable (no magic numbers elsewhere)
  errors.js                CasError + CAS_ERROR codes
  model/                   NormalizedPortfolio contract and factories
  cas/                     PDF → NormalizedPortfolio pipeline (see portfolio-analyzer.md)
  identity/                ISIN check digit; ISIN → scheme map (Phase 2 interface)
  market/                  NAV and fund-data providers (Phase 2 interfaces)
  analytics/               Returns and risk (Phase 2 interfaces)
  portfolio-analyzer/      Models for the Portfolio Analyzer: summary, recommendations,
                           allocation, one-pager and detailed-report models

design-system/
  index.css                The single stylesheet entry; import order = cascade order
  tokens.css / tokens.js   All colors, type, spacing, radius and shadows
  typography.css
  components/              Dumb UI components (DOM builders) + their CSS
  layout/                  App shell, site header/footer/bands, print rules
  pages/                   Home and Fund Research page styles
  portfolio-analyzer/      Analyzer screen styles and the two report replicas

app/
  main.js                  Hash router
  shell.js                 Mounts the site header + footer once
  pages/                   Home and Fund Research (coming soon) pages
  shared/                  Formatting, printing, site config (routes, nav, footer)
  portfolio-analyzer/      Workflow, in-memory client state, screen copy,
    screens/               Upload, review, recommendation, builder, final, one-pager
    reports/               Printable one-pager and detailed report (layout + wording)
```

## Request flow

```
index.html
  └─ app/main.js
       ├─ mountSiteShell(#app)                → header, <view>, footer (rendered once)
       └─ on hashchange → render(route)
            ├─ #/                    renderHomePage(view)
            ├─ #/portfolio-analyzer  mountPortfolioAnalyzer(view).showUpload()
            └─ #/fund-research       renderFundResearchPage(view)
```

Each navigation re-renders the page into `view`, so returning to the analyzer always starts fresh.
Client data is held in memory only, and a refresh clears it by design.

## Portfolio Analyzer data flow

```
CAS PDF ──► analyzeCasPdf()        ──► NormalizedPortfolio (validated, flagged)
                                          │
              advisor input ──────────────┤  verdicts, recommended rows, report details
                                          ▼
            summarizePortfolio · summarizeRecommendations · allocatePortfolio
            buildSnapshot · buildDetailedReport          (pure functions, calculation-engine)
                                          │
                                          ▼
            screens/*  and  reports/*                    (app, rendered with design-system)
                                          │
                                          ▼
            printElement() → browser "Save as PDF" (US Letter)
```

See [portfolio-analyzer.md](portfolio-analyzer.md) for each stage in detail.

## Conventions

- **Module header.** Every module opens with a doc comment that states its purpose and its
  input → output.
- **Naming.** Files use `kebab-case.js`. Functions and variables use `camelCase`, constants
  use `UPPER_SNAKE_CASE`, and DOM builders that return components use `PascalCase`.
- **Pure engine.** Engine functions take data and return new data, with no hidden state. The
  same input always gives the same output (this is covered by a test).
- **Styling.** Colors come only from tokens. CSS is grouped by owner, so a component's styles
  live next to it and a page's styles live in `design-system/pages/` or `design-system/portfolio-analyzer/`.
- **Copy.** User-facing wording lives in `copy.js`, `*-copy.js` or `site-config.js`, and never
  inside layout code.
- **Formatting.** Display formatting (₹, %, dates) happens only in `app/shared/format.js` and
  the report formatters. The engine returns raw numbers.
- **Configuration.** Tolerances and limits belong in `calculation-engine/config.js`, with a comment
  explaining each.

## Phase 2 seams

These interfaces exist with stable signatures but return `null`, or throw "not implemented", until a
free data source is connected. The UI already renders `null` as "—".

| Module | Will provide |
|---|---|
| `market/fund-data-provider.js` | Category, asset class, benchmark, returns, risk, sectors and market cap per fund |
| `market/nav-provider.js` | NAV history per scheme |
| `identity/scheme-map.js` | ISIN → scheme code |
| `analytics/returns.js`, `analytics/risk.js` | Trailing returns, XIRR and risk ratios |
