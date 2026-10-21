/**
 * Report details filled by the Prosperr logic (engine buildReportProfile), shared by the
 * Final review and One-Pager screens.
 *
 *  autoDetails(profile) → { riskProfile, horizon, diversification }   ("" where the logic cannot decide)
 *  autoNote({ profile, key, auto, current }) → { element, update() }
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
function basis(profile, key) {
  if (!profile) return null;
  const unclassified = (list) => `${list.length} fund${list.length > 1 ? "s" : ""} could not be classified (${list.join(", ")}) — please choose.`;
  if (key === "riskProfile") {
    return profile.risk.label ? `${profile.risk.equityPct.toFixed(2)}% of the value is in equity.` : unclassified(profile.risk.unclassified);
  }
  if (key === "horizon") {
    return profile.horizon.label ? `Value-weighted ideal holding period: ${profile.horizon.years.toFixed(2)} years.` : unclassified(profile.horizon.unclassified);
  }
  const d = profile.diversification;
  const largest = d.largestFund && d.largestFund.sharePct >= 50 ? ` Largest fund is ${d.largestFund.sharePct.toFixed(2)}% of the value.` : "";
  return `${d.numFunds} fund${d.numFunds === 1 ? "" : "s"}; ideal ${d.range.min}–${d.range.max} for ${d.range.band}.${largest}`;
}

export function autoNote({ profile, key, auto, current }) {
  const element = h("p", { class: "fin-auto-note" });
  function update() {
    const text = basis(profile, key);
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
