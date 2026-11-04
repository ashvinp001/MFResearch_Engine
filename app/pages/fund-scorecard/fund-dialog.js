/**
 * Fund popup, opened from a top-three card on the Fund Scorecard. Display only: every figure comes from the engine.
 *
 * openFundDialog({ fund, rated, card, grade, benchmarkName, benchmark, peers, quarters }) → void
 *   fund      { name, series, benchmarkSeries? }   rated  the fund's row in the scored category
 *   card      the scored category                  grade  { label, tone }
 *   benchmark the fund's own index series          quarters(code) → a fund's quarterly quartiles (worked out when needed)
 *   peers     [{ code, name, series }] the other top-three funds: adding one puts it on the chart and in the quartile trend
 * One screen: relative performance against the benchmark (6M, 1Y, 3Y, 5Y, All), key risk metrics, quartile trend.
 */

import { h } from "../../../design-system/components/dom.js";
import { Icon } from "../../../design-system/components/icons.js";
import { normalizedComparison, periodStart, rebasedOn } from "../../../calculation-engine/index.js";
import { DASH, formatDate, MONTHS } from "../../shared/format.js";
import { formatMeasure, quartilePill } from "./scorecard-parts.js";

const PERIODS = [["6M", { months: 6 }], ["1Y", { years: 1 }], ["3Y", { years: 3 }], ["5Y", { years: 5 }], ["All", null]];
const KEY_METRICS = ["sharpe", "sortino", "stdDev", "beta", "maxDrawdown", "downCapture"];   // active funds
const MEASURE_NAME = { stdDev: "Std deviation", maxDrawdown: "Max drawdown", downCapture: "Downside capture", sharpe: "Sharpe ratio", sortino: "Sortino ratio" };
const W = 860, H = 210, LEFT = 40, RIGHT = 10, TOP = 8, BOTTOM = 24;
const signed = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
const shortName = (name) => name.replace(/\s+Fund$/i, "");
const quarterName = (iso) => { const [y, m] = iso.split("-").map(Number); return `${MONTHS[m - 1]}-${String(y).slice(2)}`; };

/** Round steps for the value axis. */
function ticks(min, max, count = 4) {
  const raw = (max - min) / (count - 1) || 1;
  const size = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * size).find((s) => s >= raw);
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.999; v += step) out.push(v);
  return out;
}

/** lines: [{ key, label, values }], drawn in that order; the fund itself comes last so it sits on top. */
function lineChart(dates, lines, description) {
  const axis = ticks(Math.min(...lines.flatMap((l) => l.values)), Math.max(...lines.flatMap((l) => l.values)));
  const low = axis[0], high = axis.at(-1), last = dates.length - 1;
  const x = (i) => LEFT + (i / last) * (W - LEFT - RIGHT);
  const y = (v) => TOP + ((high - v) / (high - low)) * (H - TOP - BOTTOM);
  const path = (series) => series.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const labelAt = [0, 0.5, 1].map((f) => Math.round(f * last));

  const cross = h("line", { class: "fsd-cross", y1: TOP, y2: H - BOTTOM, x1: -10, x2: -10 });
  const dots = lines.map((l) => h("circle", { class: `fsd-dot is-${l.key}`, r: 4, cx: -10, cy: -10 }));
  const tip = h("div", { class: "fsd-tip", hidden: true });
  const svg = h("svg", { class: "fsd-chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": description },
    axis.map((v) => [h("line", { class: "fsd-grid", x1: LEFT, x2: W - RIGHT, y1: y(v), y2: y(v) }), h("text", { class: "fsd-axis", x: LEFT - 8, y: y(v) + 4, "text-anchor": "end" }, String(Math.round(v * 10) / 10))]),
    labelAt.map((i, k) => h("text", { class: "fsd-axis", x: x(i), y: H - 8, "text-anchor": k === 0 ? "start" : k === 2 ? "end" : "middle" }, formatDate(dates[i]))),
    lines.map((l) => h("path", { class: `fsd-line is-${l.key}`, d: path(l.values) })),
    cross, dots);

  svg.addEventListener("mousemove", (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(last, Math.round(((px - LEFT) / (W - LEFT - RIGHT)) * last)));
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
    lines.forEach((l, k) => { dots[k].setAttribute("cx", x(i)); dots[k].setAttribute("cy", y(l.values[i])); });
    tip.replaceChildren(h("b", {}, formatDate(dates[i])), ...[...lines].reverse().map((l) => h("span", {}, h("i", { class: `is-${l.key}` }), l.label,
      h("strong", {}, l.values[i].toFixed(2)), h("em", { class: l.values[i] >= 100 ? "is-ahead" : "is-behind" }, signed(l.values[i] - 100)))));
    tip.hidden = false;
    tip.style.left = `${(x(i) / W) * 100}%`;
    tip.classList.toggle("is-left", i > last / 2);
  });
  svg.addEventListener("mouseleave", () => {
    tip.hidden = true;
    cross.setAttribute("x1", -10); cross.setAttribute("x2", -10);
    dots.forEach((d) => d.setAttribute("cx", -10));
  });
  return h("div", { class: "fsd-plot" }, svg, tip);
}

function performance(fund, benchmark, fundName, benchmarkName, peers, onCompare) {
  const end = fund.series.last < benchmark.last ? fund.series.last : benchmark.last;
  const earliest = fund.series.first > benchmark.first ? fund.series.first : benchmark.first;
  const views = PERIODS.map(([name, period]) => {
    const from = period ? periodStart(end, period) : earliest;
    return { name, view: from >= earliest ? normalizedComparison(fund.series, benchmark, from, end) : null };
  });
  const body = h("div", {});
  const tabs = h("div", { class: "fsd-periods", role: "group", "aria-label": "Period" });
  const chosen = new Set();
  let active = (views.find((v) => v.name === "3Y" && v.view) ?? views.find((v) => v.view))?.name;

  function draw() {
    tabs.replaceChildren(...views.map((v) => h("button", { type: "button", class: v.name === active ? "is-on" : "", "aria-pressed": String(v.name === active), disabled: !v.view,
      title: v.view ? null : "Insufficient history", onclick: () => { active = v.name; draw(); } }, v.name)));
    const { view } = views.find((v) => v.name === active);
    const fundGain = view.fund.at(-1) - 100, benchGain = view.benchmark.at(-1) - 100, lead = fundGain - benchGain;
    const shownPeers = peers.map((p, i) => ({ ...p, key: `peer${i}`, values: rebasedOn(p.series, view.dates) }));
    const added = shownPeers.filter((p) => p.values && chosen.has(p.name));
    const chips = shownPeers.map((p) => {
      const on = chosen.has(p.name);
      return h("button", { type: "button", class: `fsd-peer${on ? ` is-on is-${p.key}` : ""}`, "aria-pressed": String(on), disabled: !p.values, title: p.values ? null : "Insufficient history for this period",
        onclick: () => { on ? chosen.delete(p.name) : chosen.add(p.name); draw(); onCompare(peers.filter((x) => chosen.has(x.name))); } }, h("span", { "aria-hidden": "true" }, on ? "✓" : "+"), shortName(p.name));
    });
    body.replaceChildren(
      h("div", { class: "fsd-stats" },
        h("div", {}, h("span", {}, h("i", { class: "is-fund" }), "Fund"), h("b", {}, signed(fundGain))),
        h("div", {}, h("span", {}, h("i", { class: "is-bench" }), benchmarkName), h("b", {}, signed(benchGain))),
        added.map((p) => h("div", {}, h("span", {}, h("i", { class: `is-${p.key}` }), shortName(p.name)), h("b", {}, signed(p.values.at(-1) - 100)))),
        h("div", {}, h("span", {}, "Excess return"), h("b", { class: lead >= 0 ? "is-ahead" : "is-behind" }, `${lead >= 0 ? "▲ +" : "▼ −"}${Math.abs(lead).toFixed(2)} pp`))),
      lineChart(view.dates, [
        { key: "bench", label: "Benchmark", values: view.benchmark },
        ...added.map((p) => ({ key: p.key, label: shortName(p.name), values: p.values })),
        { key: "fund", label: "Fund", values: view.fund },
      ], `${fundName} against ${benchmarkName}, rebased to 100`),
      peers.length ? h("div", { class: "fsd-peers" }, h("span", {}, "Compare with"), chips) : null);
  }
  draw();
  return h("section", { class: "fsd-section" },
    h("div", { class: "fsd-section-head" }, h("div", {}, h("h3", {}, "Relative performance"), h("p", {}, "Cumulative return, rebased to 100")), tabs),
    body);
}

function riskMetrics(rated, card) {
  const all = card.pillars.flatMap((p) => p.measures).filter((m) => m.used);
  const shown = card.kind === "index"
    ? card.pillars.filter((p) => p.key !== "quality").flatMap((p) => p.measures).filter((m) => m.used).slice(0, 6)
    : KEY_METRICS.map((key) => all.find((m) => m.key === key)).filter(Boolean);
  return h("section", { class: "fsd-section" },
    h("div", { class: "fsd-section-head" }, h("div", {}, h("h3", {}, "Key risk metrics"), h("p", {}, "Value and percentile within category"))),
    h("table", { class: "fsd-metrics" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Metric"), h("th", { scope: "col" }, "Value"), h("th", { scope: "col" }, "Percentile"))),
      h("tbody", {}, shown.map((m) => {
        const cell = rated.measures[m.key] ?? { value: null, pct: null };
        return h("tr", {}, h("th", { scope: "row" }, MEASURE_NAME[m.key] ?? m.label), h("td", {}, formatMeasure(m, cell.value, rated)), h("td", {}, cell.pct === null ? DASH : String(Math.round(cell.pct))));
      }))));
}

function quartileTrend(rated, card, quarters) {
  const table = h("div", { class: "fsd-quarters" }, h("p", { class: "fsc-sub" }, "Calculating…"));
  const history = new Map();   // code → its quarters, worked out once
  const past = (code) => { if (!history.has(code)) history.set(code, quarters(code)); return history.get(code); };
  const cell = (row, total) => h("td", {}, row?.rank ? quartilePill(row.quartile) : h("span", { class: "fsd-nr" }, "NR"), h("small", {}, row?.rank ? `${row.rank}/${total}` : DASH));

  function show(selected) {
    const rows = [{ code: rated.code, name: "Fund", key: "fund" }, ...selected.map((p) => ({ code: p.code, name: shortName(p.name), key: p.key }))];
    table.replaceChildren(h("table", { class: "fsd-qtable" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, ""), past(rated.code).map((q) => h("th", { scope: "col" }, quarterName(q.date))), h("th", { scope: "col" }, "Current"))),
      h("tbody", {}, rows.map((row) => h("tr", {},
        h("th", { scope: "row" }, h("i", { class: `is-${row.key}` }), h("span", {}, row.name)),
        past(row.code).map((q) => cell(q, q.rated)),
        cell(card.rated.find((r) => r.code === row.code), card.rated.length))))));
  }
  // Left to the next paint: re-rating takes a moment and the popup must open at once.
  setTimeout(() => show([]), 30);
  const element = h("section", { class: "fsd-section" },
    h("div", { class: "fsd-section-head" }, h("div", {}, h("h3", {}, "Quartile trend"), h("p", {}, "Quarter-end rank within category"))),
    table,
    h("p", { class: "fsc-note" }, card.kind === "index" ? "Historical ranks use current AUM. NR: not rated." : "Historical ranks exclude the AUM screen and Quality pillar. NR: not rated."));
  return { element, show };
}

export function openFundDialog({ fund, rated, card, grade, benchmarkName, benchmark, peers = [], quarters }) {
  const close = () => { dialog.close(); dialog.remove(); };
  const trend = quartileTrend(rated, card, quarters);
  const compare = (selected) => trend.show(selected.map((p) => ({ ...p, key: `peer${peers.indexOf(p)}` })));
  const dialog = h("dialog", { class: "fss fsd", "aria-labelledby": "fsd-title" },
    h("header", { class: "fss-head" },
      h("span", { class: "fss-head-icon" }, Icon("trend", { size: 22, strokeWidth: 1.8 })),
      h("div", {}, h("h2", { id: "fsd-title" }, rated.name), h("p", {}, `Rank ${rated.rank}/${card.rated.length} · Score ${rated.score.toFixed(1)} · Q${rated.quartile} · ${grade.label} · Benchmark: ${benchmarkName}`)),
      h("button", { type: "button", class: "fss-x", "aria-label": "Close", onclick: close }, Icon("x", { size: 20 }))),
    h("div", { class: "fsd-body" },
      performance(fund, benchmark, rated.name, benchmarkName, peers, compare),
      h("div", { class: "fsd-lower" }, riskMetrics(rated, card), trend.element)));
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
}
