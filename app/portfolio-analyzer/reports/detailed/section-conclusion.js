/** Detailed Report — Conclusion & Recommendation section. */

import { h } from "../../../../design-system/components/dom.js";
import { formatInr } from "../../../shared/format.js";
import { fundCommentary } from "../detailed-copy.js";
import { badge, byFund, sectionWriter, VERDICT_TEXT } from "./page-layout.js";

export function sectionConclusion(stage, model, num) {
  const w = sectionWriter(stage, { eyebrow: `SECTION ${num}`, title: "Conclusion & Recommendation", footer: `SECTION ${num}` });

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
  const rows = byFund(model.holdings.groups.flatMap((group) => group.rows))
    .sort((p, q) => rank(p) - rank(q) || p.name.localeCompare(q.name, "en", { sensitivity: "base" }));
  for (const row of rows) {
    w.block(h("div", { class: `dr-verdict is-${row.verdict ?? "none"}` },
      h("div", { class: "dr-verdict-badge" }, badge(row.verdict)),
      h("div", {},
        h("div", { class: "dr-verdict-head" },
          h("strong", {}, row.name, row.folioNote ? h("span", { class: "dr-folio" }, ` (${row.folioNote})`) : null)),
        h("p", {}, fundCommentary(row, row.verdict, { hasRecommended: Boolean(model.recommended) })))));
  }
  if (model.suggestions?.length) {
    w.block(h("div", { class: "dr-suggest" },
      h("div", { class: "dr-suggest-title" }, "SUGGESTION BOX"),
      h("ul", {}, model.suggestions.map((item) => h("li", {}, item.text)))));
  }
}
