/** Small pieces shared by the Fund Scorecard page and its fund popup. */

import { h } from "../../../design-system/components/dom.js";
import { DASH } from "../../shared/format.js";

export function quartilePill(q) {
  return h("span", { class: `fsc-q is-q${q}` }, q ? `Q${q}` : DASH);
}

export function formatMeasure(m, value, r) {
  if (value === null || value === undefined) return DASH;
  if (m.unit === "pct") return `${value >= 0 ? "" : "−"}${Math.abs(value * 100).toFixed(2)}%`;
  if (m.unit === "ratio") return value.toFixed(2);
  if (m.unit === "share") return `${Math.round(value)}%`;
  if (m.unit === "num") return value.toFixed(1);
  if (m.unit === "days") return `${Math.round(value)} days${r.recovered === false ? " (not yet recovered)" : ""}`;
  if (m.unit === "cr") return `₹${Math.round(value).toLocaleString("en-IN")} Cr`;
  return String(value);
}
