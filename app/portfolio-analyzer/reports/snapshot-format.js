/**
 * Number formats used on the one-pager, matching the Sample Portfolio Review:
 *  date "05-Feb-2026" · money "₹5,70,982" (whole rupees) · signed "+990" / "−1,651"
 *  weight "21.89" · split "35.0" · gain % "−0.19%".
 */

import { DASH } from "../../shared/format.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MINUS = "−";

export function formatSnapshotDate(iso) {
  if (!iso) return DASH;
  const [year, month, day] = iso.split("-").map(Number);
  return `${String(day).padStart(2, "0")}-${MONTHS[month - 1]}-${year}`;
}

const whole = (value) => Math.round(Math.abs(value)).toLocaleString("en-IN");

export function rupees(value) {
  if (value === null || value === undefined) return DASH;
  return `${value < 0 ? MINUS : ""}₹${whole(value)}`;
}

export function signedWhole(value) {
  if (value === null || value === undefined) return DASH;
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : rounded < 0 ? MINUS : ""}${whole(value)}`;
}

export function signedPct(value, digits = 2) {
  if (value === null || value === undefined) return DASH;
  const fixed = Math.abs(value).toFixed(digits);
  const sign = Number(fixed) === 0 ? "" : value > 0 ? "+" : MINUS;
  return `${sign}${fixed}%`;
}

export const pct1 = (value) => (value === null || value === undefined ? DASH : value.toFixed(1));
export const pct2 = (value) => (value === null || value === undefined ? DASH : value.toFixed(2));

/** Tone for a signed number: "up" / "down" / "" — colour always paired with a sign. */
export function tone(value) {
  if (value === null || value === undefined) return "";
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? "up" : rounded < 0 ? "down" : "";
}
