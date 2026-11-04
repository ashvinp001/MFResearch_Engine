/** Detailed Report — The Way Forward: Prosperr Recommended Portfolio. */

import { h } from "../../../../design-system/components/dom.js";
import { DASH } from "../../../shared/format.js";
import { rupees } from "../snapshot-format.js";
import { categoryLabel, fundCommentary, sourceNote } from "../detailed-copy.js";
import { allocText, pct1, sectionWriter } from "./page-layout.js";

export function wayForward(stage, model) {
  const rec = model.recommended;
  const w = sectionWriter(stage, { eyebrow: "THE WAY FORWARD", title: "Prosperr Recommended Portfolio", footer: "PROSPERR RECOMMENDED PORTFOLIO" });
  const kpi = (label, value, variant, extra = "") =>
    h("div", { class: `dr-kpi big is-${variant} ${extra}` }, h("div", { class: "dr-kpi-label" }, label), h("div", { class: "dr-kpi-value" }, value));
  // Lumpsum or SIP (the advisor's choice in Step 4) is stated in the amount tile, the table column and the note.
  const sip = rec?.mode === "sip";
  w.block(h("div", { class: "dr-kpis three" },
    kpi(sip ? "MONTHLY SIP AMOUNT" : "LUMPSUM AMOUNT",
      rupees(rec?.amount ?? null), "green", "tinted"),
    kpi("FUNDS RECOMMENDED", String(rec?.rows.length ?? 0), "navy"),
    kpi("TOTAL ALLOCATION", rec ? allocText(rec.totalPct) : DASH, "green", "green-value")));

  // Plain figures: no ahead / behind colouring in this table (owner, 2026-11-04).
  const ret = (item, period) => {
    const v = item.returns?.[period];
    return h("td", { class: "num" }, typeof v === "number" ? pct1(v) : DASH);
  };
  const rows = (rec?.rows ?? []).map((item) => h("tr", {},
    h("td", { class: "fund" }, item.name),
    h("td", { class: "center cat" }, categoryLabel(item.category, { name: item.name, benchmark: item.benchmark }) ?? DASH),
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
      h("th", { class: "num" }, "ALLOC."), h("th", { class: "num" }, "1Y"), h("th", { class: "num" }, "3Y"), h("th", { class: "num" }, "5Y"), h("th", { class: "num" }, sip ? ["MONTHLY SIP", h("br"), "(₹)"] : ["LUMPSUM", h("br"), "(₹)"]))),
    groups: rows,
  });

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
