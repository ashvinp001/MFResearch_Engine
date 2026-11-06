/** Detailed Report — The Way Forward: Prosperr Recommended Portfolio (one table per plan: Lumpsum, Monthly SIP, or both). */

import { h } from "../../../../design-system/components/dom.js";
import { DASH } from "../../../shared/format.js";
import { rupees } from "../snapshot-format.js";
import { categoryLabel, fundCommentary, sourceNote } from "../detailed-copy.js";
import { allocText, pct1, sectionWriter } from "./page-layout.js";

// How each plan is named on the page: tile label, table heading and line under it, amount column, total row.
const PLAN = {
  lumpsum: { tile: "LUMPSUM AMOUNT", heading: "LUMPSUM INVESTMENT", sub: (amount, n) => `${amount} invested once, across ${n} fund${n === 1 ? "" : "s"}.`,
    column: ["LUMPSUM", h("br"), "(₹)"], total: "Total Lumpsum · Blended Return", short: "Lumpsum" },
  sip: { tile: "MONTHLY SIP AMOUNT", heading: "MONTHLY SIP", sub: (amount, n) => `${amount} invested every month, across ${n} fund${n === 1 ? "" : "s"}.`,
    column: ["MONTHLY SIP", h("br"), "(₹)"], total: "Total Monthly SIP · Blended Return", short: "SIP" },
};

export function wayForward(stage, model) {
  const plans = model.recommendedPlans?.length ? model.recommendedPlans : model.recommended ? [model.recommended] : [];
  const both = plans.length > 1;
  const w = sectionWriter(stage, { eyebrow: "THE WAY FORWARD", title: "Prosperr Recommended Portfolio", footer: "PROSPERR RECOMMENDED PORTFOLIO" });
  const kpi = (label, value, variant, extra = "") =>
    h("div", { class: `dr-kpi big is-${variant} ${extra}` }, h("div", { class: "dr-kpi-label" }, label), h("div", { class: "dr-kpi-value" }, value));
  const keyOf = (item) => item.isin || item.name;
  const funds = new Map();
  for (const plan of plans) for (const item of plan.rows) if (!funds.has(keyOf(item))) funds.set(keyOf(item), item);

  // Tiles: one plan → its amount, funds, total allocation; Lumpsum + SIP → both amounts and the funds across them.
  w.block(h("div", { class: "dr-kpis three" }, ...(both
    ? [kpi(PLAN.lumpsum.tile, rupees(plans[0].amount), "green", "tinted"),
       kpi(PLAN.sip.tile, rupees(plans[1].amount), "navy", "tinted-navy"),
       kpi("FUNDS RECOMMENDED", String(funds.size), "green", "green-value")]
    : [kpi(PLAN[plans[0]?.mode ?? "lumpsum"].tile, rupees(plans[0]?.amount ?? null), "green", "tinted"),
       kpi("FUNDS RECOMMENDED", String(plans[0]?.rows.length ?? 0), "navy"),
       kpi("TOTAL ALLOCATION", plans[0] ? allocText(plans[0].totalPct) : DASH, "green", "green-value")])));

  // Plain figures: no ahead / behind colouring in these tables (owner, 2026-11-04).
  const ret = (item, period) => {
    const v = item.returns?.[period];
    return h("td", { class: "num" }, typeof v === "number" ? pct1(v) : DASH);
  };
  for (const plan of plans) {
    const text = PLAN[plan.mode] ?? PLAN.lumpsum;
    // With two plans each table has its own heading, so a Lumpsum figure can never be read as a monthly one.
    if (both) {
      w.block(h("div", { class: `dr-plan-head is-${plan.mode}` },
        h("h2", { class: "dr-h" }, text.heading),
        h("p", {}, text.sub(rupees(plan.amount), plan.rows.length))));
    }
    const rows = plan.rows.map((item) => h("tr", {},
      h("td", { class: "fund" }, item.name),
      h("td", { class: "center cat" }, categoryLabel(item.category, { name: item.name, benchmark: item.benchmark }) ?? DASH),
      h("td", { class: "center" }, item.benchmark ? h("span", { class: "dr-chip" }, item.benchmark.toUpperCase()) : DASH),
      h("td", { class: "num alloc" }, allocText(item.pct)),
      ret(item, "r1y"), ret(item, "r3y"), ret(item, "r5y"),
      h("td", { class: "num amount" }, rupees(item.amount))));
    rows.push(h("tr", { class: "dr-total" },
      h("td", { colspan: 3 }, both ? text.total : "Total Portfolio · Blended Return"),
      h("td", { class: "num" }, allocText(plan.totalPct)),
      ...["r1y", "r3y", "r5y"].map((p) => h("td", { class: "num" }, plan.blended[p] === null ? DASH : pct1(plan.blended[p]))),
      h("td", { class: "num" }, rupees(plan.amount))));
    w.table({
      className: `dr-way${both ? " is-plan" : ""}`,
      head: () => h("thead", {}, h("tr", {}, h("th", { class: "fund" }, "FUND"), h("th", { class: "center" }, "CATEGORY"), h("th", { class: "center" }, "BENCHMARK"),
        h("th", { class: "num" }, "ALLOC."), h("th", { class: "num" }, "1Y"), h("th", { class: "num" }, "3Y"), h("th", { class: "num" }, "5Y"), h("th", { class: "num" }, text.column))),
      groups: rows,
    });
  }

  // Each fund once, with its share in every plan it is part of.
  w.block(h("h2", { class: "dr-h" }, "WHY THESE FUNDS"));
  const held = new Map(model.holdings.groups.flatMap((group) => group.rows).map((row) => [row.isin, row]));
  for (const [key, item] of funds) {
    const shares = plans.map((plan) => [plan.mode, plan.rows.find((row) => keyOf(row) === key)]).filter(([, row]) => row);
    const share = both ? shares.map(([mode, row]) => `${PLAN[mode].short} ${allocText(row.pct)}`).join(" · ") : allocText(shares[0][1].pct);
    const source = held.get(item.isin) ?? { ...item, name: item.name };
    const verdict = held.get(item.isin)?.verdict === "hold" ? "hold" : "invest";
    w.block(h("div", { class: "dr-why" }, h("i"),
      h("p", {}, h("strong", {}, `${item.name} (${share}): `), fundCommentary({ ...source, name: item.name }, verdict))));
  }
  w.block(h("p", { class: "dr-source" }, sourceNote(model, { amountsNote: true })));
}
