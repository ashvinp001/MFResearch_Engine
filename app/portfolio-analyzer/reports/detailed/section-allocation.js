/** Detailed Report — Section 02: Portfolio Allocation. */

import { h } from "../../../../design-system/components/dom.js";
import { DonutSvg } from "../../../../design-system/components/infographics.js";
import { SNAPSHOT_COLORS } from "../snapshot-sheet.js";
import { rupees } from "../snapshot-format.js";
import { MCAP_MIN_ZOOM, pct1, pctWhole, pending, sectionWriter } from "./page-layout.js";

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

export function sectionAllocation(stage, model) {
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
    ...(c.other > 0 ? [{ label: "Other (REIT / InvIT)", value: c.other, color: "var(--grey)" }] : []),
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
    h("p", { class: "dr-sub" }, "How each equity fund distributes across Large, Mid & Small cap.",
      model.marketCapByFund?.excludedNote ? ` ${model.marketCapByFund.excludedNote}` : ""));
  if (!model.marketCapByFund) {
    w.block(h("div", {}, intro, pending("Fund-wise market-capitalisation data is not available for these funds.")));
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
  // Section 02 stays on ONE page: the fund-wise table (with its key) shrinks to fit; only a very long
  // list (below MCAP_MIN_ZOOM) continues on a second page.
  w.fitTable({
    className: "dr-mcap",
    before: intro,
    head: () => h("thead", {}, h("tr", {}, h("th", { class: "fund" }, "EQUITY FUND"), h("th", { class: "center" }, "LARGE"), h("th", { class: "center" }, "MID"), h("th", { class: "center" }, "SMALL"), h("th", {}, "COMPOSITION"))),
    groups: rows,
    after: h("div", { class: "dr-keys" },
      h("span", {}, h("i", { style: { background: "var(--navy)" } }), "Large"),
      h("span", {}, h("i", { style: { background: "var(--blue)" } }), "Mid"),
      h("span", {}, h("i", { style: { background: "var(--green)" } }), "Small")),
    minZoom: MCAP_MIN_ZOOM,
  });
}
