/** Detailed Report — Section 01: Client & Portfolio Overview. */

import { h } from "../../../../design-system/components/dom.js";
import { DASH } from "../../../shared/format.js";
import { rupees, signedPct, signedWhole, tone } from "../snapshot-format.js";
import { GROUP_LABEL } from "../detailed-copy.js";
import { badge, sectionWriter } from "./page-layout.js";

export function sectionOverview(stage, model, clientName, settings, asOn) {
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
    h("th", { class: "fund" }, "FUND"), h("th", { class: "num" }, "WT %"),
    h("th", { class: "num" }, "INVESTED AMT", h("br"), "(₹)"), h("th", { class: "num" }, "CURRENT AMT", h("br"), "(₹)"), h("th", { class: "num" }, "PROFIT"), h("th", { class: "center" }, "PROSPERR RECOMMENDATION")));

  const groups = [];
  for (const group of model.holdings.groups) {
    // Every group has its heading — funds the analysis could not place get their own "OTHER" heading, so they can
    // never appear to belong to the group above them. (Without any asset data there is one list and no headings.)
    const known = model.holdings.groups.some((g) => g.key);
    if (group.key || known) {
      groups.push(h("tr", { class: `dr-group is-${group.key ?? "other"}` },
        h("td", { colspan: 4 }, GROUP_LABEL[group.key ?? "other"]),
        h("td", { colspan: 2, class: "num" }, `${rupees(group.value)} · ${group.weightPct.toFixed(1)}%`)));
    }
    for (const row of group.rows) {
      groups.push(h("tr", {},
        h("td", { class: "fund" }, row.name),
        h("td", { class: "num wt" }, row.weightPct.toFixed(2)),
        h("td", { class: "num" }, rupees(row.invested)),
        h("td", { class: "num" }, rupees(row.current)),
        h("td", { class: `num profit ${tone(row.profit)}` }, signedWhole(row.profit)),
        h("td", { class: "center" }, badge(row.verdict))));
    }
  }
  const total = model.holdings.total;
  groups.push(h("tr", { class: "dr-total" },
    h("td", { class: "fund" }, "Total Portfolio"), h("td", { class: "num" }, "100.0"),
    h("td", { class: "num" }, rupees(total.invested)), h("td", { class: "num" }, rupees(total.current)),
    h("td", { class: `num profit ${tone(total.profit)}` }, signedWhole(total.profit)), h("td")));

  // Overview Holding stays on the Section 01 page: it is scaled down to fit.
  w.fitTable({ className: "dr-holdings", head, groups, before: h("h2", { class: "dr-h" }, "OVERVIEW HOLDING") });
}
