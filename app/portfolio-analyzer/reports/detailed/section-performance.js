/** Detailed Report — Section 03: Fund Performance. */

import { h } from "../../../../design-system/components/dom.js";
import { DASH, formatDate } from "../../../shared/format.js";
import { GROUP_LABEL, PERFORMANCE_NOTE } from "../detailed-copy.js";
import { sectionWriter } from "./page-layout.js";

export function sectionPerformance(stage, model) {
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
      // without a verified benchmark the benchmark name and values read "—".
      const benchRow = h("tr", { class: "dr-perf-bench" },
        h("td", {}, h("i"), row.benchmark ? row.benchmark.toUpperCase() : "BENCHMARK DATA NOT AVAILABLE"),
        ...periods.map((p) => h("td", { class: "num" }, value(row.benchmarkReturns?.[p]))));
      groups.push([fundRow, benchRow]);
    }
  }
  w.table({
    className: "dr-perf",
    before: h("div", { class: "dr-h-row" }, h("h2", { class: "dr-h" }, "TRAILING RETURNS VS BENCHMARK"),
      h("div", { class: "dr-keys" }, h("span", {}, h("i", { class: "up" }), "Beat benchmark"), h("span", {}, h("i", { class: "down" }), "Lagged benchmark"),
        model.asOf ? h("span", { class: "dr-asof" }, `Data as on ${formatDate(model.asOf)}`) : null)),
    head: () => h("thead", {}, h("tr", {}, h("th", {}, "FUND / BENCHMARK"), h("th", { class: "num" }, "1Y"), h("th", { class: "num" }, "3Y"), h("th", { class: "num" }, "5Y"))),
    groups,
  });
  w.block(h("p", { class: "dr-note" }, PERFORMANCE_NOTE));
}
