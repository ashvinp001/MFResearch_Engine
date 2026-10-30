/**
 * Report details filled by the Prosperr logic (engine buildReportProfile), shared by the
 * Final review and One-Pager screens.
 *
 *  autoDetails(profile) → { riskProfile, horizon, diversification }   ("" where the logic cannot decide)
 *  autoNote({ profile, key, auto, current, locked }) → { element, update() }   locked: the field cannot be changed
 *      A one-line note under a field: "Auto · <basis>", "Changed by you · logic gives X",
 *      or why nothing was filled (funds that could not be classified).
 */

import { h } from "../../design-system/components/dom.js";
import { Icon } from "../../design-system/components/icons.js";

export function autoDetails(profile) {
  return {
    riskProfile: profile?.risk.label ?? "",
    horizon: profile?.horizon.label ?? "",
    diversification: profile?.diversification.status ?? "",
  };
}

/** Why the field has its automatic value, or why there is none. */
function basis(profile, key, locked = false) {
  if (!profile) return null;
  const ask = locked ? " The report shows “—”." : " — please choose.";
  const unclassified = (list) => `${list.length} fund${list.length > 1 ? "s" : ""} could not be classified (${list.join(", ")}).${ask}`;
  // Funds outside the logic tables are "Others": named with their share, and not counted.
  const othersText = (part) => (part.others?.length
    ? ` ${part.others.length} fund${part.others.length > 1 ? "s" : ""} in Others (${part.othersPct.toFixed(2)}% of value, not counted): ${part.others.map((o) => `${o.name} (${o.sharePct.toFixed(2)}%) — ${o.reason}`).join("; ")}.`
    : "");
  const allOthers = (part) => `All funds are in Others (outside the logic tables).${ask}${othersText(part)}`;
  if (key === "riskProfile") {
    const r = profile.risk;
    if (r.label) return `${r.equityPct.toFixed(2)}% of the ${r.others?.length ? "counted " : ""}value is in equity.${othersText(r)}`;
    return r.unclassified.length ? unclassified(r.unclassified) : allOthers(r);
  }
  if (key === "horizon") {
    const r = profile.horizon;
    if (r.label) return `Value-weighted ideal holding period: ${r.years.toFixed(2)} years.${othersText(r)}`;
    return r.unclassified.length ? unclassified(r.unclassified) : allOthers(r);
  }
  const d = profile.diversification;
  const largest = d.largestFund && d.largestFund.sharePct >= 50 ? ` Largest fund is ${d.largestFund.sharePct.toFixed(2)}% of the value.` : "";
  return `${d.numFunds} fund${d.numFunds === 1 ? "" : "s"}; ideal ${d.range.min}–${d.range.max} for ${d.range.band}.${largest}`;
}

export function autoNote({ profile, key, auto, current, locked = false }) {
  const element = h("p", { class: "fin-auto-note" });
  function update() {
    const text = basis(profile, key, locked);
    element.hidden = !text;
    if (!text) return;
    const value = current();
    const missing = !auto[key];
    const changed = !missing && value !== auto[key];
    element.className = `fin-auto-note${missing || changed ? " is-changed" : ""}`;
    element.replaceChildren(Icon(missing ? "alert" : changed ? "user" : "sparkle", { size: 12 }),
      missing ? ` ${text}` : changed ? ` Changed by you · logic gives ${auto[key]}. ${text}` : ` Auto · ${text}`);
  }
  update();
  return { element, update };
}
