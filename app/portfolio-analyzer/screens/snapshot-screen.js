/**
 * One-Pager Snapshot screen — the same overview as the portfolio review, then
 * infographic sections (Holdings, Composition, Top Sectors, Market Cap, AMC
 * Allocation, Trailing Returns vs Benchmark, Risk Analysis, Observations), the
 * advisor's report settings. The download prints the one-page factsheet.
 *
 * Input:  { portfolio, summary, snapshot (engine), profile (engine buildReportProfile), store, onChange() }
 * Output: { element, download() } — download builds and prints the factsheet.
 */

import { h } from "../../../design-system/components/dom.js";
import { Card } from "../../../design-system/components/basics.js";
import { ChartEmpty, DonutSvg, GroupedBars } from "../../../design-system/components/infographics.js";
import { BarChart } from "../../../design-system/components/charts.js";
import { accentAt } from "../../../design-system/tokens.js";
import { heroBand, kpiRow } from "./review-screen.js";
import { buildSnapshotSheet, fitSnapshotSheet, portfolioReturnsLine, SNAPSHOT_COLORS } from "../reports/snapshot-sheet.js";
import { HORIZONS, RISK_PROFILES, RISK_ROWS, suggestedObservations, suggestedStrategy } from "../reports/snapshot-copy.js";
import { formatSnapshotDate, pct1, pct2, rupees, signedPct, signedWhole, tone } from "../reports/snapshot-format.js";
import { DASH, benchmarkPhrase } from "../../shared/format.js";
import { printElement } from "../../shared/print.js";
import { autoDetails, autoNote } from "../report-profile-notes.js";
import { marketCapBlock } from "../reports/market-cap-view.js";

export function createSnapshotScreen({ portfolio, summary, snapshot, profile = null, store, onChange, overlap = null }) {
  // Risk profile and horizon are pre-filled by the Prosperr logic (engine buildReportProfile); editable.
  const auto = autoDetails(profile);
  const settings = store.state.snapshot ??= {
    riskProfile: auto.riskProfile,
    horizon: auto.horizon,
    strategy: suggestedStrategy(snapshot),
    observations: suggestedObservations(snapshot, portfolio),
  };

  const observationsView = h("div", { class: "snp-obs" });

  function refresh() {
    observationsView.textContent = settings.observations || DASH;
    onChange?.();
  }

  const element = h("main", { class: "app-dashboard" },
    heroBand(portfolio, summary, store, () => onChange?.()),
    h("div", { class: "app-container app-dashboard-body snp-body" },
      kpiRow(summary, snapshot.xirr),
      section("Holdings", "Holdings performance summary", holdingsCard(snapshot)),
      h("div", { class: "ds-grid" },
        Card({ title: "Composition", eyebrow: "Asset mix (%)", icon: "pie", accent: accentAt(0), className: "ds-col-4 site-reveal", children: compositionView(snapshot) }),
        Card({ title: "Top sectors", eyebrow: "Equity (%)", icon: "list", accent: accentAt(1), className: "ds-col-4 site-reveal", children: sectorsView(snapshot) }),
        Card({ title: "Market cap", eyebrow: "Equity (%)", icon: "layers", accent: accentAt(2), className: "ds-col-4 site-reveal", children: marketCapView(snapshot) })),
      h("div", { class: "ds-grid" },
        Card({ title: "AMC allocation", eyebrow: "Share of current value", icon: "building", accent: accentAt(3), className: "ds-col-5 site-reveal", children: amcView(snapshot) }),
        Card({ title: "Trailing returns vs benchmark", eyebrow: "Returns (%)", icon: "trend", accent: accentAt(0), className: "ds-col-7 site-reveal", children: returnsView(snapshot) })),
      Card({ title: "Risk analysis", eyebrow: "3-year vs benchmark", icon: "shield", accent: accentAt(1), className: "site-reveal", children: riskView(snapshot) }),
      overlap ? Card({ title: "Portfolio overlap", eyebrow: "On screen only — not in the one-pager PDF", icon: "layers", accent: accentAt(3), className: "site-reveal", children: overlapView(overlap) }) : null,
      Card({ title: "Observations", eyebrow: "Summary", icon: "file", accent: accentAt(2), className: "site-reveal", children: observationsView }),
      section("Report settings", "Personalise the one-pager", settingsForm(settings, snapshot, portfolio, refresh, profile, auto))));

  async function download() {
    const name = (portfolio.investor.name ?? "Client").trim();
    const sheet = await fitSnapshotSheet(buildSnapshotSheet({ portfolio, snapshot, settings }));
    printElement(sheet, `${name} - Portfolio Snapshot - ${formatSnapshotDate(snapshot.asOf)}`);
  }

  refresh();
  return { element, download };
}

function section(eyebrow, title, body) {
  return h("section", {},
    h("div", { class: "app-section-head" }, h("div", { class: "ds-eyebrow" }, eyebrow), h("h2", {}, title)),
    body);
}

// ---------- Portfolio overlap (screen only) ----------
/**
 * Lower-triangle matrix: every compared fund numbered, the share of the same stocks for each pair in %, coloured
 * green (below 25%) / amber (25–50%) / red (50% and above); the fund's number on the diagonal. Wide matrices scroll.
 */
function overlapView(o) {
  const at = new Map([...o.buckets.high, ...o.buckets.moderate, ...o.buckets.low].map((p) => [`${p.aN}-${p.bN}`, p]));
  const band = (v) => (v >= 0.5 ? "high" : v >= 0.25 ? "moderate" : "low");
  const rows = o.funds.map((f, i) => h("tr", {},
    h("th", { scope: "row", class: "snp-ov-name" }, h("span", { class: "snp-ov-n" }, String(f.n)), f.name),
    ...o.funds.map((g, j) => {
      if (j > i) return h("td", { class: "snp-ov-empty" });
      if (i === j) return h("td", { class: "snp-ov-cell is-self" }, String(f.n));
      const p = at.get(`${Math.min(g.n, f.n)}-${Math.max(g.n, f.n)}`);
      return p ? h("td", { class: `snp-ov-cell is-${band(p.overlap)}`, title: `${f.name} vs ${g.name}: ${Math.round(p.overlap * 100)}%` }, `${Math.round(p.overlap * 100)}%`)
        : h("td", { class: "snp-ov-cell" }, DASH);
    })));
  return h("div", {},
    h("div", { class: "snp-ov-wrap" }, h("table", { class: "snp-ov" },
      h("thead", {}, h("tr", {}, h("th", { class: "snp-ov-name" }, "Fund"), ...o.funds.map((f) => h("th", { class: "snp-ov-col" }, String(f.n))))),
      h("tbody", {}, rows))),
    h("div", { class: "snp-ov-keys" },
      h("span", {}, h("i", { class: "is-low" }), "Low — below 25%"),
      h("span", {}, h("i", { class: "is-moderate" }), "Moderate — 25% to 50%"),
      h("span", {}, h("i", { class: "is-high" }), "High — 50% and above"),
      h("span", { class: "ds-muted" }, `${o.buckets.high.length} high · ${o.buckets.moderate.length} moderate · ${o.buckets.low.length} low pairs${o.asOn ? ` · holdings as disclosed for ${o.asOn}` : ""}`)),
    h("p", { class: "ds-muted snp-ov-note" }, "Equity and hybrid funds are compared; a fund in several folios or in both plans counts once. Debt, gold & silver funds, funds of funds and arbitrage funds are not compared."));
}

// ---------- Holdings ----------
function holdingsCard(snapshot) {
  const { rows, other, total } = snapshot.holdings;
  const tr = (row, isTotal = false) => h("tr", { class: isTotal ? "total" : "" },
    h("td", {},
      h("div", { class: isTotal ? "" : "app-fund-name" }, row.name),
      isTotal ? null : h("div", { class: "snp-weight" },
        h("div", { class: "snp-weight-track" }, h("div", { class: "snp-weight-fill", style: { width: `${Math.max(row.weightPct, 0.5)}%` } })),
        h("span", {}, `${pct2(row.weightPct)}% of portfolio`))),
    h("td", {}, isTotal ? "100.0" : pct2(row.weightPct)),
    h("td", {}, rupees(row.invested)),
    h("td", {}, rupees(row.current)),
    h("td", { class: tone(row.profit) === "up" ? "snp-up" : tone(row.profit) === "down" ? "snp-down" : "" }, signedWhole(row.profit)));

  return h("div", { class: "ds-card site-reveal", style: { "--accent": "var(--navy)" } },
    h("table", { class: "snp-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Fund"), h("th", {}, "Wt %"), h("th", {}, "Invested"), h("th", {}, "Current"), h("th", {}, "Profit"))),
      h("tbody", {}, rows.map((row) => tr(row)), other ? tr({ ...other, name: `Other holdings (${snapshot.holdings.otherCount} funds)` }) : null, tr(total, true))));
}

// ---------- Composition / sectors / market cap ----------
function legendList(items) {
  return h("ul", { class: "snp-legend-list" }, items.map((item) =>
    h("li", {}, h("i", { style: { background: item.color } }), h("span", {}, item.label), h("strong", {}, `${pct1(item.value)}%`))));
}

function compositionView({ composition }) {
  if (!composition) return ChartEmpty({ title: "Asset mix not available", note: "Asset allocation data is not available for the funds held." });
  const items = [
    { label: "Equity", value: composition.equity, color: "var(--navy)" },
    { label: "Debt", value: composition.debt, color: "var(--green)" },
    { label: "Gold / Silver", value: composition.goldSilver, color: "var(--lime)" },
    ...(composition.other > 0 ? [{ label: "Other (REIT / InvIT)", value: composition.other, color: "var(--grey)" }] : []),
  ];
  return h("div", { class: "snp-donut-wrap" }, DonutSvg({ items, size: 150, thickness: 30, gap: 2, centerTop: `${pct1(composition.equity)}%`, centerBottom: "EQUITY" }), legendList(items));
}

function sectorsView({ sectors }) {
  if (!sectors?.length) return ChartEmpty({ title: "Sector split not available", note: "Sector allocation data is not available for the funds held." });
  return BarChart({ items: sectors.slice(0, 7).map((item) => ({ label: item.sector, value: item.pct, display: `${pct1(item.pct)}%` })), ariaLabel: "Top sectors" });
}

function marketCapView({ marketCap }) {
  if (!marketCap) return ChartEmpty({ title: "Market-cap split not available", note: "Market-capitalisation data is not available for the funds held." });
  return marketCapBlock(marketCap, { size: "screen" });
}

// ---------- AMC allocation ----------
function amcView({ amcAllocation, amcCount }) {
  const items = amcAllocation.map((item, i) => ({ label: item.amc, value: item.pct, color: SNAPSHOT_COLORS[i % SNAPSHOT_COLORS.length] }));
  return h("div", { class: "snp-donut-wrap" },
    DonutSvg({ items, size: 170, thickness: 34, gap: 2, centerTop: String(amcCount || items.length), centerBottom: "AMCS", ariaLabel: "AMC allocation" }),
    legendList(items));
}

// ---------- Returns & risk ----------
function returnsView(snapshot) {
  if (!snapshot.trailingReturns) return ChartEmpty({ title: "Returns not available", note: "Trailing returns are not available for the current holdings." });
  const byPeriod = new Map(snapshot.trailingReturns.map((r) => [r.period, r]));
  return h("div", { class: "snp-returns" },
    GroupedBars({
      groups: ["1Y", "3Y", "5Y"].map((period) => ({ label: period, values: [byPeriod.get(period)?.portfolio ?? null, byPeriod.get(period)?.benchmark ?? null] })),
      series: [{ name: "Portfolio", color: "var(--navy)" }, { name: snapshot.benchmarkName ?? "Benchmark", color: "var(--lime)", labelColor: "var(--olive)" }],
      height: 200, barWidth: 30, ariaLabel: "Trailing returns vs benchmark",
    }),
    h("div", { class: "snp-insight" }, h("strong", {}, "KEY INSIGHT"),
      h("p", {}, snapshot.averageEdge === null
        ? portfolioReturnsLine(snapshot)
        : `Across the periods shown the portfolio runs an average edge of ${signedPct(snapshot.averageEdge, 1)} over its ${benchmarkPhrase(snapshot.benchmarkName)}.`)));
}

function riskView({ risk }) {
  if (!risk) return ChartEmpty({ title: "Risk ratios not available", note: "Standard Deviation and Sharpe Ratio (3-year) need 3 years of NAV history for funds holding at least 80% of the portfolio." });
  const fmt = { alpha: (v) => v.toFixed(2), beta: (v) => v.toFixed(2), stdDev: (v) => `${v.toFixed(1)}%`, sharpe: (v) => v.toFixed(2) };
  const show = (key, v) => (Number.isFinite(v) ? fmt[key](v) : DASH);
  return h("div", { class: "snp-risk-grid" }, RISK_ROWS.map(({ key, label, meaning }) =>
    h("div", { class: "snp-risk-row" },
      h("strong", {}, label),
      h("div", {},
        h("div", { class: "snp-risk-values" },
          h("span", {}, `Portfolio ${show(key, risk[key])}`),
          key === "alpha" ? null : h("span", { class: "ds-muted" }, `Benchmark ${show(key, risk.benchmark?.[key])}`)),
        h("span", {}, meaning)))));
}

// ---------- Settings ----------
function settingsForm(settings, snapshot, portfolio, refresh, profile, auto) {
  const select = (label, options, key) => {
    const input = h("select", {}, h("option", { value: "" }, "Not shown"), options.map((option) => h("option", { value: option }, option)));
    input.value = settings[key];
    const note = autoNote({ profile, key, auto, current: () => settings[key] });
    input.addEventListener("change", () => { settings[key] = input.value; note.update(); refresh(); });
    return h("label", { class: "snp-field" }, h("span", { class: "ds-label" }, label), input, note.element);
  };
  const textarea = (label, key, suggest) => {
    const input = h("textarea", {});
    input.value = settings[key];
    let timer = null;
    input.addEventListener("input", () => { settings[key] = input.value; clearTimeout(timer); timer = setTimeout(refresh, 250); });
    const reset = h("button", { type: "button", class: "snp-reset", onclick: () => { input.value = settings[key] = suggest(); refresh(); } }, "Use suggested text");
    return h("div", { class: "snp-field full" }, h("div", { class: "snp-field-head" }, h("span", { class: "ds-label" }, label), reset), input);
  };

  return h("div", { class: "ds-card snp-settings", style: { "--accent": "var(--green)" } },
    select("Risk profile", RISK_PROFILES, "riskProfile"),
    select("Investment horizon", HORIZONS, "horizon"),
    textarea("Investment strategy", "strategy", () => suggestedStrategy(snapshot)),
    textarea("Observations", "observations", () => suggestedObservations(snapshot, portfolio)));
}
