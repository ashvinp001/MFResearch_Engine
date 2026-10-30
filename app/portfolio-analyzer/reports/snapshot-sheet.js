/**
 * One-Pager "Portfolio Snapshot" — a faithful replica of the Sample Portfolio
 * Review factsheet (US Letter, double frame), filled from the snapshot.
 * The same element is shown as the on-screen preview and printed for download.
 *
 * Input:  { portfolio, snapshot (engine buildSnapshot), settings: { riskProfile, horizon, strategy, observations } }
 * Output: <section class="snap-sheet">
 * Missing fund-level data renders as "—" in the same structure, never estimated.
 *
 * fitSnapshotSheet(sheet) → Promise<sheet>: every active holding is listed, so a long
 * list is fitted to the single page by measurement — tighter rows, then denser text,
 * then a gentle zoom of the holdings table (never below MIN_TABLE_ZOOM), and for very
 * long lists an even zoom of the whole page content (never below MIN_PAGE_ZOOM).
 */

import { h } from "../../../design-system/components/dom.js";
import { Logo } from "../../../design-system/components/basics.js";
import { DonutSvg, GroupedBars } from "../../../design-system/components/infographics.js";
import { RISK_ROWS, sourceNote } from "./snapshot-copy.js";
import { DASH, benchmarkPhrase } from "../../shared/format.js";
import { trueSizeZoom } from "../../shared/print.js";
import { formatSnapshotDate, pct1, pct2, rupees, signedPct, signedWhole, tone } from "./snapshot-format.js";
import { marketCapBlock } from "./market-cap-view.js";

/** Series colours in the order the sample uses them. */
export const SNAPSHOT_COLORS = ["var(--navy)", "var(--blue)", "var(--green)", "var(--lime)", "var(--steel)", "var(--grey)"];

const DENSITY_STEPS = ["is-compact", "is-dense"];
const MIN_TABLE_ZOOM = 0.6;
const MIN_PAGE_ZOOM = 0.7;

export async function fitSnapshotSheet(sheet) {
  // Measured at true size (the on-screen fit-to-screen scale cancelled), so the fit matches the printed page.
  const stage = h("div", { "aria-hidden": "true", style: { position: "fixed", left: "-10000px", top: "0", zoom: trueSizeZoom() } }, sheet);
  document.body.append(stage);
  await document.fonts?.ready;
  const frame = sheet.querySelector(".snap-frame");
  const table = sheet.querySelector(".snap-holdings");
  const overflowing = () => frame.scrollHeight > frame.clientHeight + 1;

  for (const step of DENSITY_STEPS) {
    if (!overflowing()) break;
    table.classList.add(step);
  }
  for (let zoom = 0.95; overflowing() && zoom >= MIN_TABLE_ZOOM - 1e-9; zoom -= 0.05) {
    table.style.zoom = zoom.toFixed(2);
  }
  // Very long lists: scale the whole page content evenly so nothing is cut off.
  const blocks = [...frame.children];
  for (let zoom = 0.97; overflowing() && zoom >= MIN_PAGE_ZOOM - 1e-9; zoom -= 0.03) {
    blocks.forEach((block) => { block.style.zoom = zoom.toFixed(2); });
  }
  stage.remove();
  return sheet;
}

const head = (title) => h("div", { class: "snap-h" }, h("span", { class: "snap-h-bar" }), h("span", {}, title));

export function buildSnapshotSheet({ portfolio, snapshot, settings }) {
  const name = (portfolio.investor.name ?? "Client").toUpperCase();
  const metaParts = [
    `As On ${formatSnapshotDate(snapshot.asOf)}`,
    settings.riskProfile || null,
    settings.horizon ? `Horizon ${settings.horizon}` : null,
    `${snapshot.fundCount} Funds · ${snapshot.amcCount} AMCs`,
  ].filter(Boolean);
  const meta = metaParts.flatMap((part, i) => (i ? [h("span", { class: "snap-sep" }, "·"), part] : [part]));

  return h("section", { class: "snap-sheet ds-paper" },
    h("div", { class: "snap-frame" },
      h("header", { class: "snap-header" },
        h("div", {},
          h("div", { class: "snap-title-row" },
            h("h1", { class: "snap-title" }, `${name} — Portfolio Snapshot`),
            h("span", { class: "snap-badge" }, "MUTUAL FUND")),
          h("div", { class: "snap-meta" }, meta)),
        Logo({ size: 25 })),
      h("div", { class: "snap-rule" }),

      h("div", { class: "snap-top" },
        h("div", {}, head("Investment Strategy"), h("p", { class: "snap-strategy" }, settings.strategy)),
        kpis(snapshot)),

      head("Holdings Performance Summary"),
      holdingsTable(snapshot),

      h("div", { class: "snap-three" },
        h("div", {}, head("Composition (%)"), compositionList(snapshot)),
        h("div", {}, head("Top Sectors (Equity)"), sectorList(snapshot)),
        h("div", {}, head("Market Cap (Equity)"), marketCapList(snapshot))),

      head("Trailing Returns vs Benchmark (%)"),
      returnsBox(snapshot),

      h("div", { class: "snap-two" },
        h("div", {}, head("Risk Analysis (3-Year vs Benchmark)"), riskTable(snapshot)),
        h("div", {}, head("AMC-wise Allocation"), amcAllocation(snapshot))),

      head("Observations"),
      h("div", { class: "snap-obs" }, settings.observations || DASH),
      h("p", { class: "snap-source" }, sourceNote(snapshot))),

    h("footer", { class: "snap-foot" }, h("span", {}, "PROSPERR.IO"), h("span", {}, "PORTFOLIO FACTSHEET")));
}

function kpis({ totals }) {
  const card = (label, value, variant, valueTone = "") =>
    h("div", { class: `snap-kpi is-${variant}` }, h("div", { class: "snap-kpi-label" }, label), h("div", { class: `snap-kpi-value ${valueTone}` }, value));
  return h("div", { class: "snap-kpis" },
    card("Portfolio Value", rupees(totals.value), "navy"),
    card("Invested", rupees(totals.invested), "blue"),
    card("Gain %", signedPct(totals.gainPct), "green", tone(totals.gainPct)),
    card("Absolute Gain", signedWhole(totals.gain), "lime", tone(totals.gain)));
}

function holdingsTable({ holdings }) {
  const tr = (row, className = "") => h("tr", { class: className },
    h("td", { class: "snap-fund" }, row.name),
    h("td", { class: "num wt" }, className === "total" ? "100.0" : pct2(row.weightPct)),
    h("td", { class: "num" }, rupees(row.invested)),
    h("td", { class: "num" }, rupees(row.current)),
    h("td", { class: `num profit ${tone(row.profit)}` }, signedWhole(row.profit)));

  return h("table", { class: "snap-holdings" },
    h("thead", {}, h("tr", {},
      h("th", { class: "snap-th-fund" }, "FUND"), h("th", { class: "num" }, "WT %"), h("th", { class: "num" }, "INVESTED"),
      h("th", { class: "num" }, "CURRENT"), h("th", { class: "num" }, "PROFIT"))),
    h("tbody", {},
      holdings.rows.map((row) => tr(row)),
      holdings.other ? tr(holdings.other) : null,
      tr(holdings.total, "total")));
}

function listRows(rows) {
  return h("ul", { class: "snap-list" }, rows.map(({ label, value, swatch, total }) =>
    h("li", { class: total ? "total" : "" },
      h("span", { class: "snap-list-label" }, swatch ? h("i", { class: "snap-swatch", style: { background: swatch } }) : null, label),
      h("span", { class: "snap-list-value" }, value))));
}

function compositionList({ composition }) {
  return listRows([
    { label: "Equity", value: pct1(composition?.equity), swatch: "var(--navy)" },
    { label: "Debt", value: pct1(composition?.debt), swatch: "var(--green)" },
    { label: "Gold / Silver", value: pct1(composition?.goldSilver), swatch: "var(--lime)" },
    ...(composition?.other > 0 ? [{ label: "Other (REIT / InvIT)", value: pct1(composition.other), swatch: "var(--grey)" }] : []),
  ]);
}

function sectorList({ sectors }) {
  if (!sectors?.length) return h("p", { class: "snap-pending" }, "Sector allocation data is not available for the funds held.");
  return listRows(sectors.slice(0, 7).map((item) => ({ label: item.sector, value: pct1(item.pct) })));
}

function marketCapList({ marketCap }) {
  if (!marketCap) return h("p", { class: "snap-pending" }, "Market-capitalisation data is not available for the funds held.");
  return marketCapBlock(marketCap, { size: "print" });
}

function returnsBox(snapshot) {
  const periods = ["1Y", "3Y", "5Y"];
  const byPeriod = new Map((snapshot.trailingReturns ?? []).map((r) => [r.period, r]));
  const chart = GroupedBars({
    groups: periods.map((period) => ({ label: period, values: [byPeriod.get(period)?.portfolio ?? null, byPeriod.get(period)?.benchmark ?? null] })),
    series: [
      { name: "Portfolio", color: "var(--navy)" },
      { name: "Benchmark", color: "var(--lime)", labelColor: "var(--olive)" },
    ],
    height: 86,
    barWidth: 15,
    slotWidth: 126,
    fixedSize: true,
    ariaLabel: "Trailing returns vs benchmark",
  });

  const insight = snapshot.averageEdge === null
    ? h("p", {}, portfolioReturnsLine(snapshot))
    : h("p", {}, "Across the periods shown the portfolio runs an average edge of ",
        h("strong", { class: tone(snapshot.averageEdge) }, `${signedPct(snapshot.averageEdge, 1)}`),
        ` over its ${benchmarkPhrase(snapshot.benchmarkName)}.`);

  return h("div", { class: "snap-returns" },
    h("div", { class: "snap-returns-chart" },
      h("div", { class: "snap-legend" },
        h("span", {}, h("i", { style: { background: "var(--navy)" } }), "Portfolio"),
        h("span", {}, h("i", { style: { background: "var(--lime)" } }), "Benchmark")),
      chart),
    h("div", { class: "snap-insight" }, h("div", { class: "snap-insight-title" }, "KEY INSIGHT"), insight));
}

/** "Portfolio returns: 1Y +12.3% · 3Y +15.1% p.a. · 5Y —." (shown when no benchmark comparison can be made). */
export function portfolioReturnsLine(snapshot) {
  const rows = snapshot.trailingReturns ?? [];
  if (!rows.some((r) => Number.isFinite(r.portfolio))) return "Trailing returns are not available for the current holdings.";
  const parts = rows.map((r) => `${r.period} ${Number.isFinite(r.portfolio) ? `${signedPct(r.portfolio, 1)}${r.period === "1Y" ? "" : " p.a."}` : "—"}`);
  return `Portfolio returns: ${parts.join(" · ")}. A benchmark comparison is shown when funds with a verified benchmark hold at least 80% of the portfolio value.`;
}

function riskTable({ risk }) {
  const fmt = {
    alpha: (v) => v.toFixed(2),
    beta: (v) => v.toFixed(2),
    stdDev: (v) => `${v.toFixed(1)}%`,
    sharpe: (v) => v.toFixed(2),
  };
  const portfolioTone = {
    alpha: (v) => (v > 0 ? "up" : v < 0 ? "down" : ""),
    beta: () => "",
    stdDev: () => "",
    sharpe: (v, b) => (b === undefined ? "" : v > b ? "up" : v < b ? "down" : ""),
  };
  return h("table", { class: "snap-risk" },
    h("thead", {}, h("tr", {}, h("th", { class: "snap-th-fund" }, "RATIO"), h("th", { class: "num" }, "PORTFOLIO"), h("th", { class: "num" }, "BMK"), h("th", { class: "meaning" }, "WHAT IT MEANS"))),
    h("tbody", {}, RISK_ROWS.map(({ key, label, meaning }) => {
      const value = Number.isFinite(risk?.[key]) ? risk[key] : undefined;
      const bench = key === "alpha" || !Number.isFinite(risk?.benchmark?.[key]) ? undefined : risk.benchmark[key];
      return h("tr", {},
        h("td", { class: "snap-fund" }, label),
        h("td", { class: `num strong ${value === undefined ? "" : portfolioTone[key](value, bench)}` }, value === undefined ? DASH : fmt[key](value)),
        h("td", { class: "num bmk" }, bench === undefined ? DASH : fmt[key](bench)),
        h("td", { class: "meaning" }, meaning));
    })));
}

function amcAllocation({ amcAllocation, amcCount }) {
  const items = amcAllocation.map((item, i) => ({ ...item, color: SNAPSHOT_COLORS[i % SNAPSHOT_COLORS.length] }));
  return h("div", { class: "snap-amc" },
    DonutSvg({ items: items.map((item) => ({ value: item.pct, color: item.color, title: `${item.amc} ${item.pct.toFixed(1)}%` })), size: 85, thickness: 25, centerTop: String(amcCount), centerBottom: "AMCS", ariaLabel: "AMC-wise allocation" }),
    h("ul", { class: "snap-amc-legend" }, items.map((item) =>
      h("li", {},
        h("span", { class: "snap-list-label" }, h("i", { class: "snap-swatch", style: { background: item.color } }), item.amc),
        h("span", { class: "snap-amc-value", style: { color: item.color } }, pct1(item.pct))))));
}
