/**
 * One fund category — every fund's returns (MF_Platform_Specification.md P7 Section 4).
 *
 * categoryView(category) → element
 *   Heading with the plan switch (Regular | Direct) at its far right; below, the view Trailing | Monthly | Annual
 *   (engine returnsTable) with the scheme count and data date opposite.
 *   Table: funds A→Z (any column header sorts), returns heat-mapped against the category average,
 *   two rows pinned at the bottom: the category's benchmark index and the Category Average (E6).
 * Data: AMFI fund list + NAV history (RESEARCH_YEARS) and the benchmark's closes, loaded once per plan.
 */

import { h } from "../../../design-system/components/dom.js";
import { Icon } from "../../../design-system/components/icons.js";
import { RETURN_VIEW, returnsTable } from "../../../calculation-engine/index.js";
import { loadBenchmarkHistories, loadNavHistories, loadValuationData } from "../../shared/market-data.js";
import { DASH, formatDate } from "../../shared/format.js";
import { RESEARCH_YEARS } from "./research-config.js";

const VIEWS = [
  { key: RETURN_VIEW.TRAILING, label: "Trailing" },
  { key: RETURN_VIEW.MONTHLY, label: "Monthly" },
  { key: RETURN_VIEW.ANNUAL, label: "Annually" },
];
const PLANS = ["Regular", "Direct"];
const PLAN_HINT = {
  Regular: "Purchased through a distributor; the expense ratio includes distribution commission.",
  Direct: "Purchased directly from the AMC; no distribution commission, hence a lower expense ratio.",
};
const FIRST_YEAR = 2015;        // fund NAV history is stored from 1-Jan-2015
const STALE_DAYS = 7;           // a fund whose last NAV is this much older than the table's date is marked
const cache = new Map();        // `${slug}|${plan}` → Promise<data>, kept for the whole visit

/** The category's data for one plan (fetched once, then shared): used to warm the cache before the page opens. */
function categoryData(category, plan) {
  const key = `${category.slug}|${plan}`;
  if (!cache.has(key)) {
    cache.set(key, fetchCategory(category, plan).then((result) => {
      if (result.error) cache.delete(key);   // a failure is retried on the next request
      return result;
    }));
  }
  return cache.get(key);
}

export function prefetchCategory(category, plan = "Regular") {
  categoryData(category, plan);
}

export function categoryView(category) {
  const state = { view: RETURN_VIEW.TRAILING, plan: "Regular", sort: { key: "name", dir: 1 } };
  const body = h("div", { class: "frx-table-area" });
  const asOf = h("span", { class: "frx-data-date" });
  const count = h("span", { class: "frx-count" });

  const segmented = (items, current, onPick, label) => h("div", { class: "frx-seg", role: "group", "aria-label": label },
    items.map((item) => h("button", { type: "button", class: item.key === current ? "is-on" : null, "aria-pressed": String(item.key === current),
      onclick: () => onPick(item.key) }, item.label)));
  const controls = h("div", { class: "frx-controls" });

  // Plan switch: built once, so its thumb slides between Regular and Direct.
  const planButtons = PLANS.map((plan) => h("button", { type: "button", class: "frx-plan-btn", "data-plan": plan,
    title: PLAN_HINT[plan], onclick: () => { if (state.plan !== plan) { state.plan = plan; showPlan(); load(); } } },
    Icon(plan === "Direct" ? "bolt" : "user", { size: 15, strokeWidth: 2.2 }), `${plan} plans`));
  const planToggle = h("div", { class: "frx-plan", role: "group", "aria-label": "Plan" },
    h("span", { class: "frx-plan-thumb", "aria-hidden": "true" }), ...planButtons);
  function showPlan() {
    planToggle.dataset.plan = state.plan;
    planButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.plan === state.plan)));
  }
  showPlan();

  function drawControls() {
    controls.replaceChildren(
      segmented(VIEWS, state.view, (key) => { state.view = key; state.sort = { key: "name", dir: 1 }; drawControls(); draw(); }, "Return type"),
      h("div", { class: "frx-controls-end" }, count, asOf));   // scheme count and data date opposite the view switch
  }

  let data = null;
  async function load() {
    data = null;
    const plan = state.plan;
    body.replaceChildren(skeleton());
    const result = await categoryData(category, plan);
    if (plan !== state.plan) return;   // the plan was switched while this was loading
    if (result.error) { body.replaceChildren(h("div", { class: "frx-error" }, Icon("alert", { size: 18 }), ` ${result.error}`)); return; }
    data = result;
    draw();
    PLANS.filter((p) => p !== plan).forEach((p) => categoryData(category, p));   // the other plan, ready for the switch
  }

  function draw() {
    if (!data) return;
    const table = returnsTable({ funds: data.funds, benchmark: data.benchmark, view: state.view, asOf: data.asOf, firstYear: FIRST_YEAR });
    asOf.replaceChildren(Icon("calendar", { size: 14, strokeWidth: 2.2 }), "Data as on ", h("strong", {}, formatDate(data.asOf)));
    count.textContent = `${data.funds.length} schemes · ${state.plan} plan, Growth option`;
    const rows = [...table.rows];
    const { key, dir } = state.sort;
    rows.sort((a, b) => {
      if (key === "name") return dir * a.name.localeCompare(b.name, "en", { sensitivity: "base" });
      const x = a.returns[key], y = b.returns[key];
      if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;   // "—" always last
      return dir * (x - y);
    });
    body.replaceChildren(renderTable(table, rows, data, state, (column) => {
      state.sort = state.sort.key === column ? { key: column, dir: -state.sort.dir } : { key: column, dir: column === "name" ? 1 : -1 };
      draw();
    }), legend(table));
  }

  drawControls();
  load();
  const section = h("section", { class: "frx-category" },
    h("div", { class: "frx-cat-head" },
      h("div", {},
        h("div", { class: "ds-eyebrow" }, "Equity · SEBI category"),
        h("h1", {}, `${category.name} Funds`),
        h("p", {}, category.text, " Benchmark: ", h("strong", {}, category.benchmark.name), ".")),
      h("div", { class: "frx-cat-meta" }, planToggle)),   // plan switch at the far right of the heading
    controls, body);
  // The table header sticks just below the site's sticky header.
  requestAnimationFrame(() => {
    const header = document.querySelector(".site-header");
    if (header) section.style.setProperty("--frx-top", `${header.offsetHeight}px`);
  });
  return section;
}

/** Placeholder rows with a shimmer while the table loads (MF_Platform_Specification.md P8). */
function skeleton() {
  const bar = (w) => h("span", { class: "frx-sk", style: { width: w } });
  return h("div", { class: "frx-table-wrap frx-skeleton", "aria-busy": "true", "aria-label": "Loading fund returns" },
    h("div", { class: "frx-sk-head" }),
    Array.from({ length: 8 }, (_, i) => h("div", { class: "frx-sk-row" }, bar(`${38 + ((i * 7) % 18)}%`), Array.from({ length: 6 }, () => bar("7%")))));
}

async function fetchCategory(category, plan) {
  const market = await loadValuationData();
  if (market.error) return { error: `The fund list could not be loaded: ${market.error}` };
  const schemes = market.schemes.filter((s) => s.plan === plan && s.active !== false && category.amfi.includes(s.category));
  if (!schemes.length) return { error: `No ${plan} plan funds are listed in ${category.name}.` };
  const [navs, benchmarks] = await Promise.all([
    loadNavHistories(schemes.map((s) => s.schemeCode), { years: RESEARCH_YEARS }),
    loadBenchmarkHistories([category.benchmark.code], { years: RESEARCH_YEARS }),
  ]);
  if (navs.error) return { error: `NAV history is not available right now (${navs.error}).` };
  const funds = schemes.map((s) => ({ code: s.schemeCode, name: s.schemeName, amc: s.amc, series: navs.histories[s.schemeCode] }))
    .filter((f) => f.series?.dates.length);
  if (!funds.length) return { error: "None of these funds has stored NAV history yet." };
  const asOf = funds.reduce((latest, f) => (f.series.last > latest ? f.series.last : latest), "");
  const index = benchmarks?.[category.benchmark.code];
  return {
    asOf, funds, missing: schemes.length - funds.length,
    benchmark: index ? { name: category.benchmark.name, series: index.series } : null,
  };
}

const pct = (x) => (x === null || x === undefined ? DASH : `${x >= 0 ? "" : "−"}${Math.abs(x * 100).toFixed(2)}%`);

/** Heat-map tint for a fund's figure: green above the category average, red below, stronger further away. */
function heat(value, average, spread) {
  if (value === null || average === null || !(spread > 0)) return null;
  const strength = Math.min(1, Math.abs(value - average) / spread);
  const share = Math.round(8 + strength * 30);
  return `color-mix(in srgb, var(${value >= average ? "--color-positive" : "--color-negative"}) ${share}%, transparent)`;
}

function renderTable(table, rows, data, state, onSort) {
  const { columns, average } = table;
  const spread = Object.fromEntries(columns.map((c) => {
    const values = table.rows.map((r) => r.returns[c.key]).filter((v) => v !== null);
    const avg = average.returns[c.key];
    return [c.key, values.length && avg !== null ? Math.max(...values.map((v) => Math.abs(v - avg))) : 0];
  }));
  const arrow = (key) => (state.sort.key === key ? (state.sort.dir > 0 ? " ▲" : " ▼") : "");
  const th = (key, label, title, cls = "") => h("th", { class: cls, scope: "col", "aria-sort": state.sort.key === key ? (state.sort.dir > 0 ? "ascending" : "descending") : "none" },
    h("button", { type: "button", title: title ?? null, onclick: () => onSort(key) }, label, arrow(key)));
  const staleBefore = new Date(Date.parse(`${data.asOf}T00:00:00Z`) - STALE_DAYS * 86400000).toISOString().slice(0, 10);

  return h("div", { class: "frx-table-wrap" }, h("table", { class: "frx-table" },
    h("thead", {}, h("tr", {},
      th("name", "Fund name", "Sort by name", "frx-name"),
      columns.map((c) => th(c.key, c.label, c.title ?? (c.annualised ? `${c.label} — annualised (CAGR)` : `${c.label} — absolute return`))))),
    h("tbody", {}, rows.length ? rows.map((r) => h("tr", {},
      h("th", { scope: "row", class: "frx-name" }, r.name,
        r.series.last < staleBefore ? h("span", { class: "frx-stale", title: "This fund's latest NAV is older than the table date" }, `NAV as on ${formatDate(r.series.last)}`) : null),
      columns.map((c) => {
        const v = r.returns[c.key];
        const tint = heat(v, average.returns[c.key], spread[c.key]);
        return h("td", { class: v === null ? "is-na" : null, style: tint ? { background: tint } : null }, pct(v));
      })))
      : h("tr", {}, h("td", { colspan: columns.length + 1, class: "frx-none" }, "No schemes to show."))),
    h("tfoot", {},
      h("tr", { class: "is-benchmark" },
        h("th", { scope: "row", class: "frx-name" }, h("span", { class: "frx-pin" }, "Benchmark"), table.benchmark?.name ?? "Not available"),
        columns.map((c) => h("td", {}, pct(table.benchmark?.returns[c.key] ?? null)))),
      h("tr", { class: "is-average" },
        h("th", { scope: "row", class: "frx-name" }, h("span", { class: "frx-pin" }, "Category"), "Category Average"),
        columns.map((c) => h("td", { title: `Average of ${average.counts[c.key]} fund${average.counts[c.key] === 1 ? "" : "s"}` }, pct(average.returns[c.key])))))));
}

function legend(table) {
  const note = table.view === RETURN_VIEW.TRAILING
    ? "1M–1Y are absolute returns; 3Y, 5Y and 10Y are annualised (CAGR)."
    : table.view === RETURN_VIEW.MONTHLY
      ? "Each month from its first to its last trading day; MTD runs to the latest NAV."
      : "Each calendar year from its first to its last trading day; YTD runs to the latest NAV.";
  return h("div", { class: "frx-legend" },
    h("span", { class: "frx-key is-up" }), "Above category average",
    h("span", { class: "frx-key is-down" }), "Below category average",
    h("span", { class: "frx-legend-note" }, ` · ${note} “—” = the fund did not exist for the whole period. Category Average = simple average of the funds with a figure (hover for the count).`));
}
