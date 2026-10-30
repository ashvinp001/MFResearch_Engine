/**
 * Market Pulse — a horizontal strip of index cards (MF_Platform_Specification.md P7 Section 1):
 * name, latest close, 1-day change in % and points (▲ / ▼, signed so it never relies on colour) and a 30-day sparkline,
 * on a two-tone gradient of its index family — broad market, market cap, sector, commodity (MF_Platform_Specification.md P8).
 *
 * indexStrip() → element   Fills itself once the data arrives; cards keep their place while loading.
 */

import { h } from "../../../design-system/components/dom.js";
import { lastMove, recentPoints } from "../../../calculation-engine/index.js";
import { loadBenchmarkHistories, loadNavHistories } from "../../shared/market-data.js";
import { formatDate } from "../../shared/format.js";
import { INDEX_FAMILIES, MARKET_INDICES } from "./research-config.js";

const number = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function indexStrip() {
  const cards = new Map(MARKET_INDICES.map((index) => [index.name, card(index, null)]));
  const strip = h("div", { class: "frx-strip", role: "list", "aria-label": "Market indices" }, [...cards.values()]);
  const element = h("section", { class: "frx-pulse" },
    h("div", { class: "frx-pulse-head" }, h("h2", {}, "Market Pulse"), h("span", { class: "frx-asof" }, "Loading index closes…")),
    strip);

  (async () => {
    const codes = MARKET_INDICES.filter((i) => i.kind === "index").map((i) => i.code);
    const navCodes = MARKET_INDICES.filter((i) => i.kind === "nav").map((i) => i.code);
    const [indices, navs] = await Promise.all([loadBenchmarkHistories(codes, { years: 1 }), loadNavHistories(navCodes, { years: 1 })]);
    let latest = null;
    for (const index of MARKET_INDICES) {
      const series = index.kind === "index" ? indices?.[index.code]?.series : navs?.histories?.[index.code];
      cards.get(index.name).replaceWith(card(index, series ?? null));
      if (series && (!latest || series.last > latest)) latest = series.last;
    }
    element.querySelector(".frx-asof").textContent = latest ? `Closing values as on ${formatDate(latest)} · updated daily` : "Index data is not available right now";
  })();
  return element;
}

function card(index, series) {
  const move = series ? lastMove(series) : null;
  const up = move ? move.change >= 0 : null;
  const points = move ? move.value - move.previous : null;
  return h("article", { class: `frx-index is-${index.family}${move ? (up ? " is-up" : " is-down") : ""}`, role: "listitem", title: index.source ?? null },
    h("div", { class: "frx-index-name" }, index.name),
    h("div", { class: "frx-index-value" }, move ? `${index.kind === "nav" ? "₹" : ""}${number.format(move.value)}` : series === null ? "…" : "—"),
    h("div", { class: "frx-index-move" },
      move ? h("span", { class: "frx-index-chip" }, `${up ? "▲" : "▼"} ${up ? "+" : "−"}${Math.abs(move.change * 100).toFixed(2)}%`) : null,
      move ? h("span", {}, `${up ? "+" : "−"}${number.format(Math.abs(points))} today`) : " "),
    series ? sparkline(recentPoints(series, 30), `${index.name}: last 30 days`) : h("div", { class: "frx-spark is-empty" }),
    h("div", { class: "frx-index-foot" },
      h("span", {}, index.note ?? "30-day trend"),
      h("span", { class: "frx-index-family" }, INDEX_FAMILIES[index.family])));
}

/** 30-day closing path with a soft area under it; the dot marks the latest close. */
function sparkline({ dates, values }, label) {
  const W = 200, H = 30, P = 3;
  if (values.length < 2) return h("div", { class: "frx-spark is-empty" });
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const x = (i) => P + (i / (values.length - 1)) * (W - 2 * P);
  const y = (v) => H - P - ((v - min) / span) * (H - 2 * P);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(values.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
  return h("svg", { class: "frx-spark", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": label },
    h("title", {}, `${label} · ${formatDate(dates[0])} → ${formatDate(dates.at(-1))}: ${number.format(values[0])} → ${number.format(values.at(-1))}`),
    h("path", { class: "frx-spark-area", d: area }),
    h("path", { class: "frx-spark-line", d: line, fill: "none", "stroke-width": 1.8, "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }),
    h("circle", { cx: x(values.length - 1), cy: y(values.at(-1)), r: 2.6 }));
}
