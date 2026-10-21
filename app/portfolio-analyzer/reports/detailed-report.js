/**
 * Detailed Report — replica of "Portfolio Review & Recommendation" (US Letter).
 *
 * Input:  { model (engine buildDetailedReport), clientName, settings: { riskProfile, horizon, diversification },
 *           reportDate (ISO, the day the report is prepared — shown as "As On") }
 * Output: Promise<HTMLElement> — a .dr-doc holding every page, ready to print.
 *
 * Pages are filled by measurement: content that does not fit moves to a new
 * page of the same section (tables repeat their header), so nothing is ever cut.
 * Must run in a document with fonts loaded; uses a hidden staging area.
 */

import { h } from "../../../design-system/components/dom.js";
import { Logo } from "../../../design-system/components/basics.js";
import { DonutSvg } from "../../../design-system/components/infographics.js";
import { SNAPSHOT_COLORS } from "./snapshot-sheet.js";
import { DASH, formatInr } from "../../shared/format.js";
import { rupees, signedPct, signedWhole, tone } from "./snapshot-format.js";
import {
  GROUP_LABEL, PERFORMANCE_NOTE, RETURNS_INTRO, WHAT_THESE_MEAN,
  fundCommentary, observations, oneYearTag, sourceNote,
} from "./detailed-copy.js";

const VERDICT_TEXT = { invest: "INVEST", hold: "HOLD", sell: "SELL" };

// ---------- formatting helpers ----------
const navText = (nav) => (nav === null || nav === undefined ? DASH : `₹${nav.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pctWhole = (v) => (v === null || v === undefined ? DASH : `${Math.round(v)}%`);
const pct1 = (v) => (v === null || v === undefined ? DASH : `${v.toFixed(1)}%`);
const num2 = (v) => (v === null || v === undefined ? DASH : v.toFixed(2));
const allocText = (v) => `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
const badge = (verdict) => (verdict ? h("span", { class: `dr-badge is-${verdict}` }, VERDICT_TEXT[verdict]) : h("span", { class: "dr-muted" }, DASH));
const rich = (parts) => parts.map((part) => (typeof part === "string" ? part : part.b ? h("strong", {}, part.b) : part.up ? h("strong", { class: "up" }, part.up) : h("strong", { class: "down" }, part.down)));

// ---------- page scaffolding ----------
function sectionPage({ eyebrow, title, footer }) {
  const body = h("div", { class: "dr-body" });
  const el = h("section", { class: "dr-page" },
    h("div", { class: "dr-frame" },
      h("header", { class: "dr-head" },
        h("div", {}, h("div", { class: "dr-eyebrow" }, eyebrow), h("h1", { class: "dr-title" }, title)),
        Logo({ size: 28 })),
      h("div", { class: "dr-rule" }),
      body),
    h("footer", { class: "dr-foot" }, h("span", {}, "PROSPERR.IO"), h("span", {}, footer)));
  return { el, body };
}

const overflowing = (body) => body.scrollHeight > body.clientHeight + 1;
/** Smallest scale a table may shrink to before it continues on a new page (keeps text readable). */
const MIN_TABLE_ZOOM = 0.6;

/** Section writer: appends blocks and opens a continuation page when a block does not fit. */
function sectionWriter(stage, spec) {
  let page = null;
  const open = (continued) => {
    page = sectionPage({ ...spec, title: continued ? `${spec.title} (continued)` : spec.title });
    stage.append(page.el);
    return page;
  };
  open(false);
  return {
    get page() { return page; },
    /** Append a block; move it to a new page if it overflows (unless it is the first block on the page). */
    block(node) {
      page.body.append(node);
      if (overflowing(page.body) && page.body.children.length > 1) {
        node.remove();
        open(true).body.append(node);
      }
    },
    /**
     * Keep a table on the current page by scaling it down (to a readable minimum).
     * Only if it still cannot fit does it flow onto a continuation page.
     */
    fitTable({ className, head, groups, before }) {
      if (before) this.block(before);
      const table = h("table", { class: `dr-table ${className ?? ""}`.trim() }, head(), h("tbody", {}, groups.flat()));
      const wrap = h("div", { class: "dr-fit" }, table);
      page.body.append(wrap);
      let zoom = 1;
      while (overflowing(page.body) && zoom > MIN_TABLE_ZOOM) {
        zoom = Math.round((zoom - 0.02) * 100) / 100;
        wrap.style.zoom = String(zoom);
      }
      if (overflowing(page.body)) {
        wrap.remove();
        this.table({ className, head, groups });
      }
    },
    /** Flow table rows (or row groups) across pages, repeating the table head. */
    table({ className, head, groups, before }) {
      let tbody = null;
      const startTable = () => {
        tbody = h("tbody");
        page.body.append(h("table", { class: `dr-table ${className ?? ""}`.trim() }, head(), tbody));
      };
      if (before) this.block(before);
      startTable();
      for (const rows of groups) {
        const list = Array.isArray(rows) ? rows : [rows];
        tbody.append(...list);
        if (overflowing(page.body) && tbody.children.length > list.length) {
          list.forEach((row) => row.remove());
          open(true);
          startTable();
          tbody.append(...list);
        }
      }
    },
  };
}

// ---------- document ----------
export async function renderDetailedReport({ model, clientName, settings, reportDate }) {
  const asOn = reportDate ?? model.asOf;
  const stage = h("div", { class: "dr-stage", "aria-hidden": "true" });
  document.body.append(stage);
  await document.fonts?.ready;

  stage.append(coverPage(model, clientName, asOn));
  section01(stage, model, clientName, settings, asOn);
  section02(stage, model);
  section03(stage, model);
  section04(stage, model);
  section05(stage, model);
  // The advisor may skip the recommended portfolio; the report then ends with Section 05.
  if (model.recommended) wayForward(stage, model);

  const doc = h("div", { class: "dr-doc" }, ...stage.children);
  stage.remove();
  return doc;
}

// ---------- cover ----------
function coverPage(model, clientName, asOn) {
  return h("section", { class: "dr-page dr-cover" },
    h("div", { class: "dr-cover-top" }),
    h("div", { class: "dr-cover-frame" }),
    h("div", { class: "dr-cover-logo" }, Logo({ size: 67 })),
    h("div", { class: "dr-cover-center" },
      h("div", { class: "dr-cover-eyebrow" }, "PRIVATE & CONFIDENTIAL"),
      h("h1", { class: "dr-cover-title" }, "Portfolio Review", h("br"), "& Recommendation"),
      h("div", { class: "dr-cover-rule" }),
      h("div", { class: "dr-cover-for" }, "PREPARED FOR"),
      h("div", { class: "dr-cover-name" }, clientName.toUpperCase()),
      h("div", { class: "dr-cover-date" }, "As On", h("span", { class: "dr-dot" }, "·"), asOn ?? DASH)),
    h("div", { class: "dr-cover-bottom" },
      h("div", { class: "dr-cover-motto" }, "CLARITY.", h("i", {}, "•"), "COMPLIANCE.", h("i", {}, "•"), "CONFIDENCE.")));
}

// ---------- Section 01 ----------
function section01(stage, model, clientName, settings, asOn) {
  const w = sectionWriter(stage, { eyebrow: "SECTION 01", title: "Client & Portfolio Overview", footer: "SECTION 01" });
  const cell = (label, value) => h("div", { class: "dr-detail" }, h("div", { class: "dr-detail-label" }, label), h("div", { class: "dr-detail-value" }, value || DASH));

  w.block(h("div", {},
    h("h2", { class: "dr-h" }, "CLIENT DETAILS"),
    h("div", { class: "dr-details" },
      cell("CLIENT", clientName.toUpperCase()),
      cell("AS ON", asOn),
      cell("FUNDS · AMCS", `${model.fundCount} · ${model.amcCount}`),
      cell("RISK PROFILE", settings.riskProfile),
      cell("HORIZON", settings.horizon),
      cell("DIVERSIFICATION", settings.diversification))));

  const t = model.totals;
  const kpi = (label, value, variant, valueTone = "") =>
    h("div", { class: `dr-kpi is-${variant}` }, h("div", { class: "dr-kpi-label" }, label), h("div", { class: `dr-kpi-value ${valueTone}` }, value));
  w.block(h("div", {},
    h("h2", { class: "dr-h" }, "PORTFOLIO SNAPSHOT"),
    h("div", { class: "dr-kpis five" },
      kpi("TOTAL INVESTED", rupees(t.invested), "navy"),
      kpi("CURRENT VALUE", rupees(t.value), "blue"),
      kpi("ABSOLUTE GAIN", signedWhole(t.gain), "green", tone(t.gain)),
      kpi("GAIN %", signedPct(t.gainPct), "lime", tone(t.gainPct)),
      kpi("XIRR", model.xirr === null ? DASH : signedPct(model.xirr, 1), "steel", tone(model.xirr)))));

  const head = () => h("thead", {}, h("tr", {},
    h("th", { class: "fund" }, "FUND"), h("th", { class: "num" }, "WT %"), h("th", { class: "num" }, "QTY"), h("th", { class: "num" }, "NAV (₹)"),
    h("th", { class: "num" }, "INVESTED AMT", h("br"), "(₹)"), h("th", { class: "num" }, "CURRENT AMT", h("br"), "(₹)"), h("th", { class: "num" }, "PROFIT"), h("th", { class: "center" }, "PROSPERR RECOMMENDATION")));

  const groups = [];
  for (const group of model.holdings.groups) {
    if (group.key) {
      groups.push(h("tr", { class: `dr-group is-${group.key}` },
        h("td", { colspan: 6 }, GROUP_LABEL[group.key]),
        h("td", { colspan: 2, class: "num" }, `${rupees(group.value)} · ${group.weightPct.toFixed(1)}%`)));
    }
    for (const row of group.rows) {
      groups.push(h("tr", {},
        h("td", { class: "fund" }, row.name),
        h("td", { class: "num wt" }, row.weightPct.toFixed(2)),
        h("td", { class: "num" }, row.unitsRaw ?? DASH),
        h("td", { class: "num" }, navText(row.nav)),
        h("td", { class: "num" }, rupees(row.invested)),
        h("td", { class: "num" }, rupees(row.current)),
        h("td", { class: `num profit ${tone(row.profit)}` }, signedWhole(row.profit)),
        h("td", { class: "center" }, badge(row.verdict))));
    }
  }
  const total = model.holdings.total;
  groups.push(h("tr", { class: "dr-total" },
    h("td", { class: "fund" }, "Total Portfolio"), h("td", { class: "num" }, "100.0"), h("td"), h("td"),
    h("td", { class: "num" }, rupees(total.invested)), h("td", { class: "num" }, rupees(total.current)),
    h("td", { class: `num profit ${tone(total.profit)}` }, signedWhole(total.profit)), h("td")));

  // Overview Holding stays on the Section 01 page: it is scaled down to fit.
  w.fitTable({ className: "dr-holdings", head, groups, before: h("h2", { class: "dr-h" }, "OVERVIEW HOLDING") });
}

// ---------- Section 02 ----------
function bars(items, { thin = false, valueText = pctWhole, colored = true } = {}) {
  return h("div", { class: `dr-bars ${thin ? "thin" : ""}` }, items.map((item) =>
    h("div", { class: "dr-bar" },
      h("div", { class: "dr-bar-top" }, h("span", {}, item.label), h("strong", { style: colored ? { color: item.color } : null }, valueText(item.value))),
      h("div", { class: "dr-bar-track" }, h("span", { style: { width: `${Math.max(0, Math.min(100, item.value ?? 0))}%`, background: item.color } })))));
}

function legend(items) {
  return h("ul", { class: "dr-legend" }, items.map((item) =>
    h("li", {}, h("i", { style: { background: item.color } }), h("span", {}, item.label), h("strong", { style: { color: item.textColor ?? item.color } }, item.value))));
}

const pending = (text = "Appears once fund data is connected.") => h("p", { class: "dr-pending" }, text);

function section02(stage, model) {
  const w = sectionWriter(stage, { eyebrow: "SECTION 02", title: "Portfolio Allocation", footer: "SECTION 02" });
  const m = model.marketCap;
  const c = model.composition;

  const capCard = h("div", { class: "dr-card" }, h("h3", { class: "dr-h in-card" }, "MARKET CAP (EQUITY)"),
    m ? bars([
      { label: "Large Cap", value: m.large, color: "var(--navy)" },
      { label: "Mid Cap", value: m.mid, color: "var(--blue)" },
      { label: "Small Cap", value: m.small, color: "var(--green)" },
    ]) : pending());

  const assetItems = c ? [
    { label: "Equity", value: c.equity, color: "var(--navy)" },
    { label: "Debt", value: c.debt, color: "var(--green)" },
    { label: "Gold / Silver", value: c.goldSilver, color: "var(--lime)", textColor: "var(--olive)" },
  ] : null;
  const assetCard = h("div", { class: "dr-card" }, h("h3", { class: "dr-h in-card" }, "ASSET ALLOCATION"),
    assetItems ? h("div", { class: "dr-donut-row" },
      DonutSvg({ items: assetItems, size: 110, thickness: 30, centerTop: rupees(model.totals.value), ariaLabel: "Asset allocation" }),
      legend(assetItems.map((item) => ({ ...item, value: pct1(item.value) })))) : pending());

  w.block(h("div", { class: "dr-grid2" }, capCard, assetCard));

  const sectorCard = h("div", {}, h("h2", { class: "dr-h" }, "TOP SECTORS (EQUITY)"),
    h("div", { class: "dr-card" }, model.sectors?.length
      ? bars(model.sectors.slice(0, 7).map((s) => ({ label: s.sector, value: s.pct, color: "var(--blue)" })), { thin: true, valueText: pct1, colored: false })
      : pending()));
  const amcItems = model.amcAllocation.map((item, i) => ({ label: item.amc, value: item.pct, color: SNAPSHOT_COLORS[i % SNAPSHOT_COLORS.length] }));
  const amcCard = h("div", {}, h("h2", { class: "dr-h" }, "AMC-WISE ALLOCATION"),
    h("div", { class: "dr-card dr-amc" }, h("div", { class: "dr-donut-row" },
      DonutSvg({ items: amcItems, size: 92, thickness: 24, centerTop: String(model.amcCount || amcItems.length), centerBottom: "AMCS", ariaLabel: "AMC-wise allocation" }),
      legend(amcItems.map((item) => ({ ...item, value: pct1(item.value) }))))));
  w.block(h("div", { class: "dr-grid2 top" }, sectorCard, amcCard));

  const intro = h("div", {}, h("h2", { class: "dr-h" }, "MARKET-CAP BREAKDOWN — FUND WISE"),
    h("p", { class: "dr-sub" }, "How each equity fund distributes across Large, Mid & Small cap."));
  if (!model.marketCapByFund) {
    w.block(h("div", {}, intro, pending("The fund-wise market-cap split appears once fund data is connected.")));
    return;
  }
  const composition = (cap) => h("div", { class: "dr-stack" },
    h("span", { style: { width: `${cap.large}%`, background: "var(--navy)" } }),
    h("span", { style: { width: `${cap.mid}%`, background: "var(--blue)" } }),
    h("span", { style: { width: `${cap.small}%`, background: "var(--green)" } }));
  const row = (r, blended = false) => h("tr", { class: blended ? "dr-blended" : "" },
    h("td", { class: "fund" }, r.name), h("td", { class: "center" }, pctWhole(r.large)), h("td", { class: "center" }, pctWhole(r.mid)),
    h("td", { class: "center" }, pctWhole(r.small)), h("td", {}, composition(r)));
  const rows = model.marketCapByFund.rows.map((r) => row(r));
  if (model.marketCapByFund.blended) rows.push(row({ name: "Blended Equity", ...model.marketCapByFund.blended }, true));
  w.table({
    className: "dr-mcap",
    before: intro,
    head: () => h("thead", {}, h("tr", {}, h("th", { class: "fund" }, "EQUITY FUND"), h("th", { class: "center" }, "LARGE"), h("th", { class: "center" }, "MID"), h("th", { class: "center" }, "SMALL"), h("th", {}, "COMPOSITION"))),
    groups: rows,
  });
  w.block(h("div", { class: "dr-keys" },
    h("span", {}, h("i", { style: { background: "var(--navy)" } }), "Large"),
    h("span", {}, h("i", { style: { background: "var(--blue)" } }), "Mid"),
    h("span", {}, h("i", { style: { background: "var(--green)" } }), "Small")));
}

// ---------- Section 03 ----------
function section03(stage, model) {
  const w = sectionWriter(stage, { eyebrow: "SECTION 03", title: "Fund Performance", footer: "SECTION 03" });
  const periods = ["r1y", "r3y", "r5y"];
  const cellTone = (row, period) => {
    const r = row.returns?.[period];
    const b = row.benchmarkReturns?.[period];
    if (typeof r !== "number" || typeof b !== "number") return "";
    return r >= b ? "up" : "down";
  };
  const value = (v) => (typeof v === "number" ? v.toFixed(2) : DASH);

  const groups = [];
  for (const group of model.performance) {
    if (group.key) groups.push(h("tr", { class: "dr-perf-group" }, h("td", { colspan: 4 }, GROUP_LABEL[group.key])));
    for (const row of group.rows) {
      const fundRow = h("tr", { class: "dr-perf-fund" }, h("td", {}, row.name),
        ...periods.map((p) => h("td", { class: `num ${cellTone(row, p)}` }, value(row.returns?.[p]))));
      // The benchmark comparison line is always shown under each fund (as in the sample);
      // until fund data is connected the benchmark name and values read "—".
      const benchRow = h("tr", { class: "dr-perf-bench" },
        h("td", {}, h("i"), row.benchmark ? row.benchmark.toUpperCase() : "CATEGORY BENCHMARK — PENDING"),
        ...periods.map((p) => h("td", { class: "num" }, value(row.benchmarkReturns?.[p]))));
      groups.push([fundRow, benchRow]);
    }
  }
  w.table({
    className: "dr-perf",
    before: h("div", { class: "dr-h-row" }, h("h2", { class: "dr-h" }, "TRAILING RETURNS VS BENCHMARK"),
      h("div", { class: "dr-keys" }, h("span", {}, h("i", { class: "up" }), "Beat benchmark"), h("span", {}, h("i", { class: "down" }), "Lagged benchmark"))),
    head: () => h("thead", {}, h("tr", {}, h("th", {}, "FUND / BENCHMARK"), h("th", { class: "num" }, "1Y"), h("th", { class: "num" }, "3Y"), h("th", { class: "num" }, "5Y"))),
    groups,
  });
  w.block(h("p", { class: "dr-note" }, PERFORMANCE_NOTE));
}

// ---------- Section 04 ----------
function section04(stage, model) {
  const w = sectionWriter(stage, { eyebrow: "SECTION 04", title: "Returns & Risk", footer: "SECTION 04" });
  w.block(h("p", { class: "dr-intro" }, RETURNS_INTRO));

  const returnsByPeriod = new Map((model.portfolioReturns ?? []).map((r) => [r.period, r]));
  w.block(h("div", {},
    h("h2", { class: "dr-h" }, "PORTFOLIO RETURN VS NIFTY 500"),
    h("table", { class: "dr-table dr-ret" },
      h("thead", {}, h("tr", {}, h("th", {}, "PERIOD"), h("th", { class: "num" }, "PORTFOLIO"), h("th", { class: "num" }, "NIFTY 500"), h("th", { class: "num" }, "EXCESS"))),
      h("tbody", {}, ["1Y", "3Y", "5Y"].map((period) => {
        const r = returnsByPeriod.get(period);
        return h("tr", {}, h("td", {}, period), h("td", { class: "num strong" }, r ? pct1(r.portfolio) : DASH),
          h("td", { class: "num muted" }, r ? pct1(r.benchmark) : DASH),
          h("td", { class: `num excess ${r ? (r.excess >= 0 ? "up" : "down") : ""}` }, r ? `${r.excess >= 0 ? "+" : ""}${r.excess.toFixed(1)}%` : DASH));
      }))),
    h("div", { class: "dr-keys outline" }, h("span", {}, h("i", { class: "up" }), "Ahead of benchmark"), h("span", {}, h("i", { class: "down" }), "Behind benchmark"))));

  const r = model.risk;
  const riskRow = (label, p, b) => h("tr", {}, h("td", {}, label), h("td", { class: "num strong" }, p), h("td", { class: "num muted" }, b));
  w.block(h("div", { class: "dr-grid-risk" },
    h("div", {},
      h("h2", { class: "dr-h" }, "RISK MEASUREMENT (3-YEAR)"),
      h("table", { class: "dr-table dr-risk" },
        h("thead", {}, h("tr", {}, h("th", {}, "MEASURE (3-YEAR)"), h("th", { class: "num" }, "PORTFOLIO"), h("th", { class: "num" }, "NIFTY 500"))),
        h("tbody", {},
          riskRow("Alpha", r ? num2(r.alpha) : DASH, r ? "0.00" : DASH),
          riskRow("Beta", r ? num2(r.beta) : DASH, r ? num2(r.benchmark.beta) : DASH),
          riskRow("Standard Deviation", r ? pct1(r.stdDev) : DASH, r ? pct1(r.benchmark.stdDev) : DASH),
          riskRow("Sharpe Ratio", r ? num2(r.sharpe) : DASH, r ? num2(r.benchmark.sharpe) : DASH)))),
    h("div", {},
      h("h2", { class: "dr-h" }, "WHAT THESE MEAN"),
      h("div", { class: "dr-meanings" }, WHAT_THESE_MEAN.map((item) =>
        h("div", { class: `dr-meaning is-${item.tone}` }, h("strong", {}, item.title), h("p", {}, item.text)))))));

  w.block(h("div", { class: "dr-obs-head" }, h("h2", {}, "Portfolio Observation"), h("span", { class: "dr-obs-line" }), h("span", { class: "dr-obs-tag" }, "AT A GLANCE")));
  w.block(h("div", { class: "dr-obs-grid" }, observations(model).map((card) =>
    h("div", { class: `dr-obs is-${card.tone}` },
      h("div", { class: "dr-obs-title" }, h("span", { class: "dr-obs-icon" }, card.icon), card.title),
      h("p", {}, rich(card.parts))))));

  const sells = model.holdings.groups.flatMap((group) => group.rows).filter((row) => row.verdict === "sell");
  if (sells.length) {
    const names = sells.flatMap((row, i) => (i ? [", ", h("strong", {}, row.name)] : [h("strong", {}, row.name)]));
    w.block(h("div", { class: "dr-change" },
      h("span", { class: "dr-change-icon" }, "!"),
      h("div", {}, h("div", { class: "dr-change-title" }, "CHANGE IMMEDIATELY"),
        h("p", {}, "Exit ", ...names, model.recommended
          ? " — these holdings are marked Sell; redeploy the proceeds into the Prosperr Recommended Portfolio."
          : " — these holdings are marked Sell; redeploy the proceeds into higher-conviction funds."))));
  }
  w.block(h("p", { class: "dr-source" }, sourceNote(model)));
}

// ---------- Section 05 ----------
function section05(stage, model) {
  const w = sectionWriter(stage, { eyebrow: "SECTION 05", title: "Conclusion & Recommendation", footer: "SECTION 05" });

  // Opening summary: Invest / Hold / Sell — count, value and share of the portfolio.
  const vs = model.verdictSummary;
  const plural = (n) => `${n} fund${n === 1 ? "" : "s"}`;
  w.block(h("div", { class: "dr-vsum" },
    h("div", { class: "dr-vsum-eyebrow" }, "PROSPERR RECOMMENDATION"),
    h("h2", { class: "dr-vsum-title" }, "Invest, Hold or Sell — fund by fund"),
    h("div", { class: "dr-vsum-rule" }),
    h("div", { class: "dr-vsum-tiles" }, ["invest", "hold", "sell"].map((verdict) =>
      h("div", { class: `dr-vsum-tile is-${verdict}` },
        h("div", { class: "dr-vsum-name" }, VERDICT_TEXT[verdict]),
        h("div", { class: "dr-vsum-count" }, plural(vs[verdict].count)),
        h("div", { class: "dr-vsum-value" }, formatInr(vs[verdict].value)),
        h("div", { class: "dr-vsum-share" }, `${(vs[verdict].share * 100).toFixed(1)}% of portfolio`))))));

  w.block(h("p", { class: "dr-intro" }, "Our view on each holding and the Prosperr recommendation — ",
    h("strong", { class: "up" }, "Invest"), " (add more), ", h("strong", { class: "info" }, "Hold"), " (stay invested) or ",
    h("strong", { class: "down" }, "Sell"), " (exit and redeploy)."));

  // Grouped in the order Invest → Hold → Sell (then any fund without a verdict), alphabetical within each.
  const VERDICT_ORDER = { invest: 0, hold: 1, sell: 2 };
  const rank = (row) => VERDICT_ORDER[row.verdict] ?? 3;
  const rows = model.holdings.groups.flatMap((group) => group.rows)
    .sort((p, q) => rank(p) - rank(q) || p.name.localeCompare(q.name, "en", { sensitivity: "base" }));
  for (const row of rows) {
    const tag = oneYearTag(row);
    w.block(h("div", { class: `dr-verdict is-${row.verdict ?? "none"}` },
      h("div", { class: "dr-verdict-badge" }, badge(row.verdict)),
      h("div", {},
        h("div", { class: "dr-verdict-head" }, h("strong", {}, row.name), h("span", { class: tag.tone || (row.verdict === "sell" ? "down" : "") }, tag.text)),
        h("p", {}, fundCommentary(row, row.verdict, { hasRecommended: Boolean(model.recommended) })))));
  }
}

// ---------- The Way Forward ----------
function wayForward(stage, model) {
  const rec = model.recommended;
  const w = sectionWriter(stage, { eyebrow: "THE WAY FORWARD", title: "Prosperr Recommended Portfolio", footer: "PROSPERR RECOMMENDED PORTFOLIO" });
  const kpi = (label, value, variant, extra = "") =>
    h("div", { class: `dr-kpi big is-${variant} ${extra}` }, h("div", { class: "dr-kpi-label" }, label), h("div", { class: "dr-kpi-value" }, value));
  w.block(h("div", { class: "dr-kpis three" },
    kpi("AMOUNT TO INVEST", rupees(rec?.amount ?? null), "green", "tinted"),
    kpi("FUNDS RECOMMENDED", String(rec?.rows.length ?? 0), "navy"),
    kpi("TOTAL ALLOCATION", rec ? allocText(rec.totalPct) : DASH, "green", "green-value")));

  const ret = (item, period) => {
    const v = item.returns?.[period];
    const b = item.benchmarkReturns?.[period];
    return h("td", { class: `num ${typeof v === "number" && typeof b === "number" ? (v >= b ? "up" : "down") : ""}` }, typeof v === "number" ? pct1(v) : DASH);
  };
  const rows = (rec?.rows ?? []).map((item) => h("tr", {},
    h("td", { class: "fund" }, item.name),
    h("td", { class: "center cat" }, item.category ? item.category.toUpperCase() : DASH),
    h("td", { class: "center" }, item.benchmark ? h("span", { class: "dr-chip" }, item.benchmark.toUpperCase()) : DASH),
    h("td", { class: "num alloc" }, allocText(item.pct)),
    ret(item, "r1y"), ret(item, "r3y"), ret(item, "r5y"),
    h("td", { class: "num amount" }, rupees(item.amount))));
  if (rec) {
    rows.push(h("tr", { class: "dr-total" },
      h("td", { colspan: 3 }, "Total Portfolio · Blended Return"),
      h("td", { class: "num" }, allocText(rec.totalPct)),
      ...["r1y", "r3y", "r5y"].map((p) => h("td", { class: "num" }, rec.blended[p] === null ? DASH : pct1(rec.blended[p]))),
      h("td", { class: "num" }, rupees(rec.amount))));
  }
  w.table({
    className: "dr-way",
    head: () => h("thead", {}, h("tr", {}, h("th", { class: "fund" }, "FUND"), h("th", { class: "center" }, "CATEGORY"), h("th", { class: "center" }, "BENCHMARK"),
      h("th", { class: "num" }, "ALLOC."), h("th", { class: "num" }, "1Y"), h("th", { class: "num" }, "3Y"), h("th", { class: "num" }, "5Y"), h("th", { class: "num" }, "AMOUNT"))),
    groups: rows,
  });
  w.block(h("div", { class: "dr-keys" },
    h("span", {}, h("i", { class: "up fill" }), "Ahead of benchmark"),
    h("span", {}, h("i", { class: "down fill" }), "Behind benchmark — returns shown vs each fund's category benchmark.")));

  w.block(h("h2", { class: "dr-h" }, "WHY THESE FUNDS"));
  const held = new Map(model.holdings.groups.flatMap((group) => group.rows).map((row) => [row.isin, row]));
  for (const item of rec?.rows ?? []) {
    const source = held.get(item.isin) ?? { ...item, name: item.name };
    const verdict = held.get(item.isin)?.verdict === "hold" ? "hold" : "invest";
    w.block(h("div", { class: "dr-why" }, h("i"),
      h("p", {}, h("strong", {}, `${item.name} (${allocText(item.pct)}): `), fundCommentary({ ...source, name: item.name }, verdict))));
  }
  w.block(h("p", { class: "dr-source" }, sourceNote(model, { amountsNote: true })));
}
