/** Detailed Report — Portfolio Overlap section (only when overlap can be shown) and its summary, shared with the One-Pager screen. */

import { h } from "../../../../design-system/components/dom.js";
import { OVERLAP_HIGH } from "../../../../calculation-engine/index.js";
import { overflowing, pending, sectionWriter, titleCase } from "./page-layout.js";

/** Overlap as a whole percentage: 0.34 → "34%". */
const ovPct = (v) => `${Math.round(v * 100)}%`;
/** Above this many rows the closest-overlap chart runs in two columns. */
const CHART_ONE_COLUMN = 16;
/** Smallest scales when the chart and the summary are fitted onto one page: text stays close to the other pages' size. */
const CHART_MIN_ZOOM = 0.9;
const SUMMARY_MIN_ZOOM = 0.9;
// The three overlap buckets: heading, range, what the bucket means for the client, and how many pairs are listed.
const OVERLAP_BUCKETS = [
  { key: "high", title: "High overlap", range: "50% and above", shown: 10,
    lead: (n) => n ? `${n} pair${n === 1 ? " holds" : "s hold"} largely the same stocks. Holding both funds of a pair adds cost and complexity without spreading risk — consolidating into the stronger fund is worth considering.`
      : "No two funds share half or more of their stocks — there is no duplicated exposure." },
  { key: "moderate", title: "Moderate overlap", range: "25% to 50%", shown: 8,
    lead: (n) => n ? `${n} pair${n === 1 ? " shares" : "s share"} a meaningful part of the portfolio, mostly the largest companies. Acceptable, but worth watching before adding similar funds.`
      : "No pair of funds falls in this range." },
  { key: "low", title: "Low overlap", range: "below 25%", shown: 6,
    lead: (n) => n ? `${n} pair${n === 1 ? " is" : "s are"} well differentiated — each fund of the pair brings different stocks and adds genuine diversification.`
      : "No pair of funds is below 25%." },
];

/** Pairs reordered so the first ones each bring funds not yet listed (a fund with 0% against everyone would
 * otherwise fill the low-overlap list on its own); the rest follow in their order. */
function variedPairs(pairs) {
  const seen = new Set(), first = [], rest = [];
  for (const p of pairs) {
    if (seen.has(p.aN) || seen.has(p.bN)) rest.push(p);
    else { first.push(p); seen.add(p.aN); seen.add(p.bN); }
  }
  return [...first, ...rest];
}

export function sectionOverlap(stage, model, num) {
  const w = sectionWriter(stage, { eyebrow: `SECTION ${num}`, title: "Portfolio Overlap", footer: `SECTION ${num}` });
  const o = model.overlap;
  w.block(h("p", { class: "dr-intro" },
    "How much of each pair of funds is invested in the same stocks. ", h("strong", {}, "0%"), " means nothing in common and ",
    h("strong", {}, "100%"), " identical portfolios; at ", h("strong", {}, ovPct(OVERLAP_HIGH)), " or more the two funds give largely the same exposure."));
  if (!o) {
    w.block(pending("Overlap analysis needs stock-level holdings for at least two equity funds and is not applicable to this portfolio."));
    return;
  }
  const scope = "Equity and hybrid funds are compared (index funds and equity ETFs included; for a hybrid fund, its stock portion). A fund held in several folios or in both its Regular and Direct plans counts once. Debt, gold & silver funds, funds of funds and arbitrage funds are not compared.";
  // Closest overlap for every fund: one lollipop row per pair on a 0–100% scale, highest first; two columns when long.
  const track = (v, band) => h("div", { class: "dr-ovc-track" },
    h("i",{ class: `dr-ovc-stick is-${band}`, style: { width: `${v * 100}%` } }),
    h("i", { class: `dr-ovc-dot is-${band}`, style: { left: `${v * 100}%` } }),
    h("span", { class: `dr-ovc-val is-${band}${v > 0.84 ? " is-inside" : ""}`, style: v > 0.84 ? { right: `${100 - v * 100}%` } : { left: `${v * 100}%` } }, ovPct(v)));
  const row = (r) => h("div", { class: "dr-ovc-row" },
    r.solo
      // a fund below 10% with every fund: its own row, the line drawn to its highest overlap (green)
      ? [h("div", { class: "dr-ovc-names" }, h("b", {}, titleCase(r.solo))), track(r.overlap, "low")]
      : [h("div", { class: "dr-ovc-names" }, h("b", {}, titleCase(r.a)), h("em", {}, "vs"), h("b", {}, titleCase(r.b))), track(r.overlap, r.band)]);
  const axis = () => h("div", { class: "dr-ovc-row is-axis" }, h("span", {}),
    h("div", { class: "dr-ovc-ticks" }, ...[0, 25, 50, 75, 100].map((t) => h("span", { style: { left: `${t}%` } }, `${t}%`))));
  const rows = o.closest;
  const two = rows.length > CHART_ONE_COLUMN;
  const half = Math.ceil(rows.length / 2);
  const columns = two ? [rows.slice(0, half), rows.slice(half)] : [rows];
  const chart = h("div", { class: "dr-ovc" },
    h("div", { class: "dr-ovc-head" }, h("h2", { class: "dr-h" }, "CLOSEST OVERLAP FOR EVERY FUND"),
      h("span", {}, `${o.funds.length} funds · each appears on the row of the fund it overlaps with most`)),
    h("div", { class: `dr-ovc-cols${two ? " is-two" : ""}` }, columns.map((list) => h("div", {}, axis(), list.map(row)))),
    h("div", { class: "dr-keys dr-ov-keys" },
      h("span", {}, h("i", { class: "dr-ov-key is-high" }), "High — 50% and above"),
      h("span", {}, h("i", { class: "dr-ov-key is-moderate" }), "Moderate — 25% to 50%"),
      h("span", {}, h("i", { class: "dr-ov-key is-low" }), "Low — below 25%"),
      o.asOn ? h("span", { class: "dr-asof" }, `Holdings as disclosed for ${o.asOn}`) : null),
    h("p", { class: "dr-note dr-ov-note" }, scope));
  // The chart and the summary on one page: the chart is scaled down first, then the summary, each to a readable minimum;
  // only if they still do not fit does the summary continue on the next page.
  const summary = overlapSummary(o);
  const rest = h("div", {}, summary);
  const body = w.page.body;
  body.append(chart, rest);
  const shrink = (el, min) => {
    let zoom = 1;
    while (overflowing(body) && zoom > min) {
      zoom = Math.round((zoom - 0.02) * 100) / 100;
      el.style.zoom = String(zoom);
    }
  };
  shrink(chart, CHART_MIN_ZOOM);
  shrink(rest, SUMMARY_MIN_ZOOM);
  if (overflowing(body)) {
    rest.remove();
    summary.forEach((block) => w.block(block));
  }
}

/** Overlap Summary blocks: per bucket one comment, then the pairs' names only (Low: the funds that overlap little with
 * every other fund, as its pairs are most of the list). The heading travels with the first box. */
function overlapSummary(o) {
  return overlapSummaryData(o).map((b) => {
    const box = h("div", { class: `dr-ovb is-${b.key}` },
      h("div", { class: "dr-ovb-title" }, h("i"), h("strong", {}, b.title.toUpperCase()), h("span", {}, b.range), h("b", {}, b.countText)),
      h("p", {}, b.comment),
      b.funds ? h("ul", { class: "is-funds" }, h("li", { class: "dr-ovb-label" }, b.fundsLabel), b.funds.map((name) => h("li", {}, name)))
        : b.pairs.length ? h("ul", {}, b.pairs.map((p) => h("li", {}, h("b", {}, p.pct), `${p.a}  vs  ${p.b}`))) : null,
      b.more ? h("p", { class: "dr-ovb-more" }, b.more) : null);
    return b.key === "high" ? h("div", {}, h("h2", { class: "dr-h dr-ovb-h" }, "OVERLAP SUMMARY"), box) : box;
  });
}

/**
 * The Overlap Summary's content — one entry per bucket (high, moderate, low), shared by the PDF and the One-Pager
 * screen so both say exactly the same: { key, title, range, countText, comment, pairs: [{ pct, a, b }],
 * funds (Low: funds with low overlap against every other fund) | null, fundsLabel, more (text) | null }.
 */
export function overlapSummaryData(o) {
  return OVERLAP_BUCKETS.map((b) => {
    const pairs = b.key === "low" ? variedPairs([...o.buckets.low].reverse()) : o.buckets[b.key];   // low: most distinct first
    const common = b.key === "low" ? [] : commonHoldings(pairs);
    const funds = b.key === "low" && o.distinct.length ? o.distinct.map((name) => titleCase(name)) : null;
    const shown = funds ? [] : pairs.slice(0, b.shown);
    const more = funds ? 0 : pairs.length - shown.length;
    return {
      key: b.key, title: b.title, range: b.range, countText: `${pairs.length} pair${pairs.length === 1 ? "" : "s"}`,
      comment: `${b.lead(pairs.length)}${common.length ? ` The stocks most often held in common: ${common.join(", ")}.` : ""}`,
      pairs: shown.map((p) => ({ pct: ovPct(p.overlap), a: titleCase(p.a), b: titleCase(p.b) })),
      funds, fundsLabel: "Funds with low overlap against every other fund:",
      more: more > 0 ? `+ ${more} more pair${more === 1 ? "" : "s"} in this range.` : null,
    };
  });
}

/** The stocks that appear most often among the pairs' largest common holdings (at most three). */
function commonHoldings(pairs) {
  const count = new Map();
  for (const p of pairs) for (const name of p.shared) count.set(name, (count.get(name) ?? 0) + 1);
  return [...count].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([name]) => name);
}
