/**
 * Returns from a NAV series (MF_Calculation_Engine.md E1, E2).
 *
 * Input:  a NAV series { dates: ["YYYY-MM-DD", …] ascending, navs: [Number, …] } (navSeries()).
 * Output:
 *  - navSeries(points) → series                      points: [{ date, nav }] or { dates, navs }
 *  - navOn(series, date, rule) → { date, nav } | null  E1 lookup; rule = "previous" | "next"; 10-day cap
 *  - anchorNav(series, asOf) → { date, nav } | null    E1 ANCHOR: latest NAV on or before asOf
 *  - periodStart(anchorDate, period) → "YYYY-MM-DD"   T − period, calendar arithmetic (day clamped to month end)
 *  - trailingReturn(series, period, anchor) → ratio | null
 *        E2: start NAV by NEAREST-PREVIOUS; ≤ 12 months simple, > 12 months CAGR on the actual day count
 *        between the two NAV dates used. null when the fund has no NAV for the start (never extrapolated).
 *  - xirr(cashflows) → null (not specified yet)
 * Periods: { months: 1 | 3 | 6 | 12 } or { years: 3 | 5 | 10 }. Ratios (0.1234 = 12.34%).
 */

import { NAV_LOOKUP } from "../config.js";

const DAY_MS = 86400000;

export function navSeries(points) {
  const dates = Array.isArray(points) ? points.map((p) => p.date) : [...points.dates];
  const navs = Array.isArray(points) ? points.map((p) => Number(p.nav)) : points.navs.map(Number);
  for (let i = 0; i < dates.length; i++) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dates[i]) || !(navs[i] > 0)) throw new Error(`NAV series: bad point ${dates[i]} ${navs[i]}`);
    if (i && dates[i] <= dates[i - 1]) throw new Error(`NAV series: dates not strictly ascending at ${dates[i]}`);
  }
  const index = new Map(dates.map((date, i) => [date, i]));
  return Object.freeze({ dates, navs, index, first: dates[0] ?? null, last: dates.at(-1) ?? null });
}

export function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

/** E1: the target date itself, then step one calendar day at a time, at most NAV_LOOKUP.maxStepDays. */
export function navOn(series, date, rule) {
  const step = rule === "next" ? 1 : -1;
  for (let k = 0; k <= NAV_LOOKUP.maxStepDays; k++) {
    const day = addDays(date, k * step);
    const i = series.index.get(day);
    if (i !== undefined) return { date: day, nav: series.navs[i] };
  }
  return null;
}

/** E1 ANCHOR (T): the latest NAV on or before asOf (default: the series' last NAV). */
export function anchorNav(series, asOf = null) {
  if (!series.dates.length) return null;
  if (!asOf || asOf >= series.last) return { date: series.last, nav: series.navs.at(-1) };
  let lo = 0, hi = series.dates.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series.dates[mid] <= asOf) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found < 0 ? null : { date: series.dates[found], nav: series.navs[found] };
}

/** T − period. 31-Mar − 1M = 28/29-Feb (the day is clamped to the month's last day). */
export function periodStart(anchorDate, { months = 0, years = 0 }) {
  const [y, m, d] = anchorDate.split("-").map(Number);
  const total = y * 12 + (m - 1) - (months + years * 12);
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

export function periodMonths({ months = 0, years = 0 }) {
  return months + years * 12;
}

/** E2 trailing return as a ratio, or null when not eligible. */
export function trailingReturn(series, period, anchor = anchorNav(series)) {
  if (!anchor) return null;
  const start = navOn(series, periodStart(anchor.date, period), "previous");
  if (!start) return null;
  return returnBetween(start, anchor, periodMonths(period) > 12);
}

/** (end / start) − 1, or the CAGR (end / start)^(365 / days) − 1 on the actual day count. */
export function returnBetween(start, end, annualise) {
  const growth = end.nav / start.nav;
  if (!annualise) return growth - 1;
  const days = daysBetween(start.date, end.date);
  return days > 0 ? growth ** (365 / days) - 1 : null;
}

/**
 * XIRR (MF_Calculation_Engine.md E15.5.10) — the annual rate r with Σ CFᵢ / (1 + r)^(daysᵢ / 365) = 0,
 * daysᵢ = calendar days from the first cash flow (Excel XIRR convention). cashflows: [{ date, amount }]
 * with investments negative and money received positive. Solved by bisection on a bracket where the
 * sum changes sign (robust: never jumps to a wrong root), to 1e-10. null when there is no outflow and
 * inflow, or no rate in (−99.99%, +10,000%) solves it.
 */
export function xirr(cashflows) {
  const flows = cashflows.filter((f) => f.amount !== 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const t0 = flows[0].date;
  const years = flows.map((f) => daysBetween(t0, f.date) / 365);
  const npv = (rate) => flows.reduce((sum, f, i) => sum + f.amount / (1 + rate) ** years[i], 0);

  let lo = -0.9999, hi = 100;
  let fLo = npv(lo), fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let k = 0; k < 300 && hi - lo > 1e-10; k++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (fMid === 0) return mid;
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
  }
  return (lo + hi) / 2;
}
