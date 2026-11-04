/** Detailed Report — Returns & Risk section. */

import { h } from "../../../../design-system/components/dom.js";
import { DASH, formatInr } from "../../../shared/format.js";
import { benchmarkColumn, observations, returnsIntro, sourceNote, WHAT_THESE_MEAN } from "../detailed-copy.js";
import { byFund, num2, pct1, rich, sectionWriter, titleCase } from "./page-layout.js";

export function sectionReturnsRisk(stage, model, num) {
  const w = sectionWriter(stage, { eyebrow: `SECTION ${num}`, title: "Returns & Risk", footer: `SECTION ${num}` });
  w.block(h("p", { class: "dr-intro" }, returnsIntro(model)));

  const returnsByPeriod = new Map((model.portfolioReturns ?? []).map((r) => [r.period, r]));
  w.block(h("div", {},
    h("h2", { class: "dr-h" }, "PORTFOLIO RETURN VS BENCHMARK RETURN"),
    h("table", { class: "dr-table dr-ret" },
      h("thead", {}, h("tr", {}, h("th", {}, "PERIOD"), h("th", { class: "num" }, "PORTFOLIO"), h("th", { class: "num" }, benchmarkColumn(model.benchmarkName)), h("th", { class: "num" }, "EXCESS"))),
      h("tbody", {}, ["1Y", "3Y", "5Y"].map((period) => {
        const r = returnsByPeriod.get(period);
        const excess = r?.excess ?? null;
        return h("tr", {}, h("td", {}, period), h("td", { class: "num strong" }, pct1(r?.portfolio)),
          h("td", { class: "num muted" }, pct1(r?.benchmark)),
          h("td", { class: `num excess ${excess === null ? "" : excess >= 0 ? "up" : "down"}` }, excess === null ? DASH : `${excess >= 0 ? "+" : ""}${excess.toFixed(1)}%`));
      }))),
    h("div", { class: "dr-keys outline" }, h("span", {}, h("i", { class: "up" }), "Ahead of benchmark"), h("span", {}, h("i", { class: "down" }), "Behind benchmark"))));

  const r = model.risk;
  const riskRow = (label, p, b) => h("tr", {}, h("td", {}, label), h("td", { class: "num strong" }, p), h("td", { class: "num muted" }, b));
  w.block(h("div", { class: "dr-grid-risk" },
    h("div", {},
      h("h2", { class: "dr-h" }, "RISK MEASUREMENT (3-YEAR)"),
      h("table", { class: "dr-table dr-risk" },
        h("thead", {}, h("tr", {}, h("th", {}, "MEASURE (3-YEAR)"), h("th", { class: "num" }, "PORTFOLIO"), h("th", { class: "num" }, benchmarkColumn(model.benchmarkName)))),
        h("tbody", {},
          riskRow("Alpha", num2(r?.alpha), r?.benchmark ? "0.00" : DASH),
          riskRow("Beta", num2(r?.beta), num2(r?.benchmark?.beta)),
          riskRow("Standard Deviation", pct1(r?.stdDev), pct1(r?.benchmark?.stdDev)),
          riskRow("Sharpe Ratio", num2(r?.sharpe), num2(r?.benchmark?.sharpe))))),
    h("div", {},
      h("h2", { class: "dr-h" }, "WHAT THESE MEAN"),
      h("div", { class: "dr-meanings" }, WHAT_THESE_MEAN.map((item) =>
        h("div", { class: `dr-meaning is-${item.tone}` }, h("strong", {}, item.title), h("p", {}, item.text)))))));

  w.block(h("div", { class: "dr-obs-head" }, h("h2", {}, "Portfolio Observation"), h("span", { class: "dr-obs-line" }), h("span", { class: "dr-obs-tag" }, "AT A GLANCE")));
  w.block(h("div", { class: "dr-obs-grid" }, observations(model).map((card) =>
    h("div", { class: `dr-obs is-${card.tone}` },
      h("div", { class: "dr-obs-title" }, h("span", { class: "dr-obs-icon" }, card.icon), card.title),
      h("p", {}, rich(card.parts))))));

  const sellRows = model.holdings.groups.flatMap((group) => group.rows).filter((row) => row.verdict === "sell");
  const sells = byFund(sellRows.filter((row) => !row.call?.trim));
  const reductions = byFund(sellRows.filter((row) => row.call?.trim));
  if (reductions.length) {
    const amount = (row) => sellRows.filter((other) => other.isin === row.isin).reduce((s, other) => s + (other.call?.trim?.amount ?? 0), 0);
    w.block(h("div", { class: "dr-change" },
      h("span", { class: "dr-change-icon" }, "!"),
      h("div", {},
        h("div", { class: "dr-change-title" }, "RECOMMENDED REDUCTIONS"),
        h("p", {}, "These holdings stay in the portfolio, but above their limit. We recommend reducing them as follows:"),
        h("ul", { class: "dr-change-list" }, reductions.map((row) => {
          const { trim } = row.call;
          return h("li", {}, h("strong", {}, row.name), ` — from ${trim.fromPct.toFixed(1)}% to ${trim.toPct.toFixed(1)}% of the portfolio (about ${formatInr(amount(row), { whole: true })})`);
        })))));
  }
  if (sells.length) {
    const total = sells.reduce((s, row) => s + row.current, 0);
    const share = sells.reduce((s, row) => s + row.weightPct, 0);
    w.block(h("div", { class: "dr-change" },
      h("span", { class: "dr-change-icon" }, "!"),
      h("div", {},
        h("div", { class: "dr-change-title" }, "RECOMMENDED EXITS"),
        h("p", {}, `Based on our review, we recommend exiting the following ${sells.length === 1 ? "holding" : `${sells.length} holdings`}, `
          + "which no longer meet our selection criteria:"),
        h("ul", { class: "dr-change-list" }, sells.map((row) =>
          h("li", {}, h("strong", {}, row.name, row.folios.length > 1 ? ` (${row.folios.length} folios)` : ""),
            h("span", {}, `${formatInr(row.current, { whole: true })} · ${row.weightPct.toFixed(1)}% of the portfolio`)))),
        h("p", {}, `Together ${formatInr(total, { whole: true })} (${share.toFixed(1)}% of the portfolio). We suggest redeploying the proceeds into `
          + (model.recommended ? "the Prosperr Recommended Portfolio" : "higher-conviction funds suited to your risk profile")
          + ". Please review exit loads and capital-gains tax before redeeming; units still in an ELSS lock-in cannot be redeemed until it ends."))));
  }
  // Folios left with less than one unit: a short note to close them too.
  if (model.leftovers?.length) {
    w.block(h("div", { class: "dr-leftover" },
      h("strong", {}, "Note: "),
      `${model.leftovers.length === 1 ? "This folio holds" : "These folios hold"} less than one unit — please redeem ${model.leftovers.length === 1 ? "it" : "them"} to close the folio${model.leftovers.length === 1 ? "" : "s"}: `,
      model.leftovers.map((l, i) => [i ? "; " : "", h("b", {}, titleCase(l.name)), ` (${l.folio ? `folio ${l.folio}, ` : ""}${l.units} units)`]),
      "."));
  }
  w.block(h("p", { class: "dr-source" }, sourceNote(model)));
}
