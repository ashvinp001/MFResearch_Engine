/**
 * Display formatting at the edge (Project_Specification_TEMP.md §7). The engine stores Numbers and ISO
 * dates; only this file turns them into text. Missing values render as "—".
 */

export const DASH = "—";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ₹1,00,000.00 (Indian grouping). */
export function formatInr(value, { whole = false } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return (whole ? inrWhole : inr).format(value);
}

/** 1,00,000.00 — Indian grouping, no ₹ (for columns headed "(₹)"). */
export function formatAmount(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** +12,345.00 / −1,234.00 — signed, no ₹ (for columns headed "(₹)"). */
export function formatSignedAmount(value) {
  if (value === null || value === undefined) return DASH;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatAmount(Math.abs(value))}`;
}

/** Signed rupee change: +₹12,345 / −₹1,234. Sign is shown so meaning never relies on color. */
export function formatSignedInr(value, options) {
  if (value === null || value === undefined) return DASH;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatInr(Math.abs(value), options)}`;
}

/** Compact rupees for chart centres: ₹12.4 L, ₹1.2 Cr. */
export function formatInrCompact(value) {
  if (value === null || value === undefined) return DASH;
  const abs = Math.abs(value);
  if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(value / 1e5).toFixed(2)} L`;
  return formatInr(value, { whole: true });
}

export function formatSignedPct(ratio) {
  if (ratio === null || ratio === undefined) return DASH;
  const pct = ratio * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

/** Today's local date as ISO "YYYY-MM-DD" (the day a report is prepared). */
export function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** "2024-12-31" → "31 Dec 2024". */
export function formatDate(iso) {
  if (!iso) return DASH;
  const [year, month, day] = iso.split("-").map(Number);
  return `${String(day).padStart(2, "0")} ${MONTHS[month - 1]} ${year}`;
}

/** "PRIYA KAPOOR" → "Priya Kapoor" for display. */
export function titleCase(fullName) {
  const words = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  return words.length ? words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ") : null;
}

/** Initials for an avatar: "HDFC Mutual Fund" → "HM". */
export function initials(text) {
  return String(text ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join("") || "MF";
}

/** Printed strings (units, NAV) are shown exactly as the statement printed them. */
export function asPrinted(raw) {
  return raw ?? DASH;
}
