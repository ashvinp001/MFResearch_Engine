# Design System

Core 2: **presentation only.** It covers tokens, typography, components, layout and page/report
styles, with no business logic.

## Entry point

Pages link exactly one stylesheet, `design-system/index.css`. It imports every other stylesheet in
cascade order: tokens → typography → shell → components → site → pages → Portfolio Analyzer → print.
Add a new stylesheet by importing it there, in its layer.

## Rules

- Colors are defined **only** in `tokens.css`. `tokens.js` exposes them to JavaScript as `var(--…)`
  references and never redefines a value.
- Components use **semantic** tokens (`--color-positive`, `--text-muted`, …), never raw hex values.
- Text uses the `--text-*` tokens, which pass WCAG AA contrast. Brand `--grey`, `--lime` and
  `--green` are fills only and are never used for body text.
- Components are "dumb": they receive finished, formatted values and render them.
- Accent rotation (`ACCENT_CYCLE`) is for neutral cards only. Semantic tones (positive, negative,
  info, warning) always win.
- A positive or negative value is never signalled by color alone. Show a sign (+/−) or an icon too.
- Motion respects `prefers-reduced-motion`.

## Files

| Path | Purpose |
|---|---|
| `index.css` | Single stylesheet entry |
| `tokens.css` / `tokens.js` | Palette, semantic colors, type scale, spacing, radius, shadows |
| `typography.css` | Type roles |
| `components/dom.js` | `h()` element builder |
| `components/basics.js` | Logo, SectionHeader, KpiCard, Badge, Callout, Card |
| `components/data-table.js` | DataTable with group bands |
| `components/charts.js`, `infographics.js` | Donut, bars, stacked bars (inline SVG/CSS, print-safe) |
| `components/icons.js` | Inline SVG icon set |
| `components/choice-dialog.js` | Modal choice dialog |
| `components/workflow.js` | Stepper, VerdictToggle, ActionBar |
| `components/site-shell.js` | SiteHeader (brand strip · logo + colour-coded tabs left · optional CTA right), SiteFooter |
| `layout/shell.css` | Base, buttons, inputs, page grid |
| `layout/site.css` | Site header, footer, hero bands, full-height layout |
| `layout/print.css` | Print isolation (`#print-root`) and page rules |
| `pages/home.css` | Home and Fund Research pages |
| `portfolio-analyzer/*.css` | Analyzer screens, One-Pager and Detailed Report replicas |
