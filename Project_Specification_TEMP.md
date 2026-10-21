# Prosperr.io Wealth — Project Specification (TEMPORARY)

> **Temporary file.** Holds the non-calculation parts of the project specification until a new
> project specification is created. **All calculation** (CAS reading, validation,
> portfolio math, report models, report-profile rules) is specified ONLY in
> [`MF_Calculation_Engine.md`](MF_Calculation_Engine.md) — section E15 — and implemented in
> `calculation-engine/`.
> Owner: Prosperr.io · Audience: Claude Code and any future developer.

---

## 1. Vision & scope

Prosperr.io Wealth is a wealth-research website for **advisors**: an advisor uploads a client's
Consolidated Account Statement (CAS), reviews it (often together with the client), records an
Invest / Hold / Sell call per fund, optionally builds a recommended portfolio and downloads a
branded report. It hosts several tools ("analyzers"), all sharing one calculation core and one
design language.

| Phase | Goal | Status |
|---|---|---|
| 1 | CAS Portfolio Analyzer — upload → read (all formats) → verified data → reports | Done |
| 2 | Market data (NAV, returns, risk, categories, sectors) wired into CAS data | Pending data source |
| 3 | More analyzers, same pattern | Future |
| 4 | Full multi-page research website | Future |

**Product rules:** free to run — no AI, no tokens, no paid services in the product; client
statements are read inside the browser and never uploaded.

---

## 2. Architecture — two cores and a thin glue layer

1. **Calculation Engine** (`calculation-engine/`) — every number and fact. No colors, no HTML,
   no DOM. Specified in `MF_Calculation_Engine.md` (E15).
2. **Design System** (`design-system/`) — every visual decision (tokens, components, layout,
   page and report styles). No business logic.
3. **App** (`app/`) — routing, pages, workflow, report layout and wording; holds neither math nor
   raw styling.

**The Golden Rule:** "Does this decide a NUMBER/FACT, or how something LOOKS?"
Number/fact → `calculation-engine/` · looks → `design-system/` · glues one screen → `app/`.
If a function does both, split it.

**Dependency rules:** the engine imports only engine modules; the design system imports only
design-system modules; the app imports the engine's public API (`calculation-engine/index.js`)
and the design system.

### 2.1 Directory layout

```
/
├─ MF_Calculation_Engine.md      ← all calculation (single source of truth)
├─ MF_Platform_Specification.md  ← reference platform spec (database, automation, dashboard)
├─ Project_Specification_TEMP.md ← THIS FILE (temporary)
├─ index.html · serve.ps1        ← app entry · local server
├─ calculation-engine/           ← CORE 1 — logic only (index.js = public API)
│   ├─ config.js · errors.js
│   ├─ model/ · cas/ · identity/ · market/ · analytics/
│   └─ portfolio-analyzer/       ← summary, recommendation, allocation, snapshot, detailed report,
│                                  report profile, fund category, verdict rules
├─ design-system/                ← CORE 2 — presentation only (index.css = the one stylesheet)
├─ app/                          ← glue: main.js (router), shell.js, pages/, shared/, portfolio-analyzer/
├─ docs/                         ← architecture and feature documentation
├─ assets/                       ← logo files
└─ tests/                        ← browser-run unit tests, real-PDF tests, preview tools
```

---

## 3. Design System

Goal: attractive, multi-colour yet fully professional, friendly to advisors and clients.
**The whole look is built around the Prosperr logo:** colors come from the logo, the logo recurs
(header, report covers, section headers) and its navy → blue → green gradient is the signature.

### 3.1 Tokens (single source of truth — `tokens.css`, mirrored in `tokens.js`)

| Token | Hex | Use |
|---|---|---|
| `--navy` | `#14346b` | headings, table headers, key borders |
| `--blue` | `#2b5aa7` | secondary accent, benchmarks |
| `--green` | `#5aa84f` | positive / growth accent |
| `--lime` | `#aed495` | benchmark bars, soft fills |
| `--steel` | `#6f90c9` | tertiary accent |
| `--grey` | `#9aa3b2` | muted fills |
| `--red` | `#c0453b` | negative / sell |
| `--gpos` | `#3f8a4a` | positive-return text |
| `--teal`, `--violet` | `#1f8a8a`, `#6b4fbb` | extra accents for colour-coded choices |

- Semantic tokens (`--color-primary`, `--color-positive`, `--color-negative`, `--color-info`,
  `--surface`, `--border`, `--text-*`) are what components use — never raw hex.
- Text tokens pass WCAG AA; brand grey/lime/green are fills only. Positive/negative values always
  carry a sign as well as colour.
- Status colours: Invest = green, Hold = blue, Sell = red.
- Accent rotation for neutral cards: navy → blue → green → steel → lime; one accent per card;
  semantic colours always win.
- Layout width: `--content-max: 1440px`; side gutter `--page-gutter: clamp(16px, 3vw, 48px)`.

### 3.2 Typography
Barlow (headings, numbers) + Source Sans 3 (body), via Google Fonts.

### 3.3 Components (`design-system/components/`) — "dumb", receive finished values
Logo, KpiCard, Badge, Callout, Card, SectionHeader, DataTable, charts/infographics (donut, bars,
stacked bar), icons, ChoiceDialog, BasketDialog, AlertDialog, workflow (Stepper, VerdictToggle,
ActionBar), SiteHeader/SiteFooter.

### 3.4 Data visualisation — "chart everything that can be charted"
Trend → line · portfolio vs benchmark → grouped bars · per-fund returns → horizontal bars ·
asset/AMC allocation → donut · market cap → stacked bar · sectors → ranked bars. Always labelled;
colours only from tokens; a chart beside the number, not instead of it. Reports draw charts as
inline SVG/CSS so they print crisply.

### 3.5 Website shell & tone
- Sticky header: brand-gradient strip, logo and colour-coded tabs on the **left** (Home navy,
  Portfolio Analyzer green, Fund Research blue with "Soon"); no header call-to-action; menu on
  mobile. Dark footer. The shell is a full-height column.
- Routes (`app/main.js`): `#/` Home, `#/portfolio-analyzer`, `#/fund-research` (coming soon).
  Browser tab = logo icon + page name.
- **Home:** short hero with a sample preview, a Portfolio Analyzer spotlight, a Fund Research teaser.
- **Fund Research (coming soon):** hero + "Explore the Top Mutual Funds to Invest" — six category
  cards (Equity, Hybrid, Index, Debt, ETF, NFO).
- **Audience = advisors.** Copy speaks to the advisor about "the client"; plain and professional,
  never internal jargon; the engine's precise detail is shown whenever a check fails.

---

## 4. Portfolio Analyzer — workflow & reports (app behaviour)

### 4.1 Upload
Choose file → password asked immediately if protected → **Analyse** (statement read and verified)
→ if any check fails, a **Statement check** popup lists the problems in plain words (fund house
first) with *Choose another file* / *Continue to the review* → popup to choose the report:
**One-Pager Snapshot** or **Detailed Recommendation Report**. The upload page also shows the two
reports and "How it works".

### 4.2 Detailed Recommendation Report — five steps (a step opens only when earlier steps are complete)

| # | Step | What happens | Gate |
|---|---|---|---|
| 1 | Upload | CAS PDF (+ password) | Read successfully |
| 2 | Portfolio review | Dashboard; client name from the CAS; title Mr. / Mrs. / Ms. from the CAS when printed, else chosen | — |
| 3 | Recommendation | Invest / Hold / Sell per active fund; 1Y and absolute return shown before the buttons; live summary and commentary | Every fund has a verdict |
| 4 | Recommended portfolio | Amount, funds and allocation %, or a **Model Portfolio** basket (popup of colour-coded baskets; click again to deselect, restoring the previous list). **Optional — "Skip this step"** while incomplete | 100% allocated, or skipped |
| 5 | Final review | Report summary, **Report details pre-filled** from the calculation engine (risk profile, horizon, diversification — editable, basis shown), cross-verification checklist, preview popup, download | All checks pass |

- Skipped portfolio → the report leaves out The Way Forward; Sell wording no longer refers to a
  recommended portfolio.
- Model Portfolio baskets are defined only in `app/portfolio-analyzer/model-portfolios.js`
  (currently blank drafts).

### 4.3 Downloaded reports (US Letter, browser "Save as PDF")
- **Detailed report** — replica of *Portfolio Review & Recommendation (Updated).pdf*: Cover →
  01 Client & Portfolio Overview → 02 Portfolio Allocation → 03 Fund Performance → 04 Returns &
  Risk → 05 Conclusion & Recommendation (Invest → Hold → Sell) → The Way Forward (when included).
  Pages are filled by measurement; content that does not fit continues on a "(continued)" page;
  the Overview Holdings table zooms to fit (≥ 60%). "As On" = download date.
- **One-Pager** — replica of *Sample Portfolio Review.pdf*: double navy frame; every active fund
  listed; kept on ONE page by measurement (tighter rows → table zoom ≥ 60% → page zoom ≥ 70%).
- Missing market data shows "—" in the same structure, never estimated.

### 4.4 Client data
Advisor choices are held **in memory only**; a refresh, Home or a new upload starts fresh, so one
client's choices never carry over to another.

---

## 5. Market data source (pending decision)

Pulse Labs API (production) is reachable with the partner credentials stored locally in
`.secrets/pulse.json` (git-ignored, never in code). Endpoints verified: metadata, analytical
(asset & market-cap split), holdings (security / sector), trailing returns (fund & benchmark),
risk parameters, NAV history, scheme master (ISIN → scheme code). Planned connection: calls go
through the local server, which adds the key, so it never reaches the browser.

---

## 6. Running locally

```
powershell -ExecutionPolicy Bypass -File serve.ps1      # start hidden in the background
```
- `http://localhost:5173/` — the website
- `/tests/` — engine unit tests · `/tests/pdf.html` — real-PDF tests
- `/tests/preview.html?...` — open the real workflow at any step · `/tests/dump.html` — text rows of any CAS
- `tests/screenshot.ps1` — screenshot or print-to-PDF via headless Edge

Real client statements for local testing go in `tests/pdf-fixtures/local/` (git-ignored).

---

## 7. Coding standards

- Professional quality everywhere: polished design, clear professional wording, clean code.
- Secure coding: no hard-coded secrets, no sensitive-data exposure, no unnecessary dependencies.
- Small named functions; a header comment on every module stating input → output.
- No magic numbers (engine tunables in `calculation-engine/config.js`).
- Money formatted for display only in the app layer; dates ISO inside the engine.
- Fail loud: problems become visible flags or warnings, never guessed values.
- One responsibility per file; follow the Golden Rule.

---

## 8. Fund universe (AMFI) — built

Our own universe of open-ended Equity, Hybrid, Debt, Other (Index/ETF/FoF) and Solution-Oriented
schemes — Regular AND Direct, Growth only, ETFs single-class — in `database/mf_universe.sqlite`
(Python 3.12 + SQLite, standard library only). Rules, sources and checks: [`database/README.md`](database/README.md).
Run: `python database/build_universe.py`.

## 9. Roadmap (non-calculation)

- Connect market data (source above) and show it on the dashboard and reports.
- AMFI NAV history (backfill + daily update, `MF_Calculation_Engine.md` E16) on top of the universe.
- Shareable single-file build (needs a bundler).
- Full research website (Phase 4).
