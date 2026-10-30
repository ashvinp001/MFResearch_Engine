/**
 * Fund Research returns tables (MF_Calculation_Engine.md E1–E3, E5–E7; MF_Platform_Specification.md P7 Section 4).
 *
 * returnColumns(view, asOf, { firstYear }) → [Column]
 *   view "trailing": 1M 3M 6M 1Y 3Y 5Y 10Y (E2 — up to 12M simple, above that CAGR on the actual day count)
 *   view "monthly":  MTD, then the 12 completed months before it, latest first (E5)
 *   view "annual":   YTD, then each calendar year back to firstYear, latest first (E3)
 * columnReturn(series, column, asOf) → ratio | null
 * returnsTable({ funds, benchmark, view, asOf, firstYear }) → {
 *   view, asOf, columns,
 *   rows:      [{ ...fund, returns: { [column.key]: ratio | null } }]   funds: [{ series, … }] (any extra fields kept)
 *   average:   { returns, counts }   E6: equal-weighted mean of the funds that have a figure; "—" funds are left out
 *   benchmark: { name, returns } | null   E7: the same functions on the index's daily closes
 * }
 * Period start: NEAREST-NEXT from the 1st of the month / 1st January; end: NEAREST-PREVIOUS from the last day;
 * the current month / year ends at the ANCHOR (latest NAV on or before asOf). A fund is eligible for a period
 * only when its history starts on or before the period's first day — never a part-period figure.
 */

import { addDays, anchorNav, navOn, returnBetween, trailingReturn } from "../analytics/returns.js";

export const RETURN_VIEW = Object.freeze({ TRAILING: "trailing", MONTHLY: "monthly", ANNUAL: "annual" });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TRAILING = [
  { key: "1M", period: { months: 1 } }, { key: "3M", period: { months: 3 } }, { key: "6M", period: { months: 6 } },
  { key: "1Y", period: { months: 12 } }, { key: "3Y", period: { years: 3 } }, { key: "5Y", period: { years: 5 } },
  { key: "10Y", period: { years: 10 } },
];
const pad = (n) => String(n).padStart(2, "0");
const lastDay = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();   // month 1–12

export function returnColumns(view, asOf, { firstYear = 2015 } = {}) {
  const [y, m] = asOf.split("-").map(Number);
  if (view === RETURN_VIEW.TRAILING) {
    return TRAILING.map((c) => ({ key: c.key, label: c.key, kind: "trailing", period: c.period, annualised: Boolean(c.period.years) }));
  }
  if (view === RETURN_VIEW.MONTHLY) {
    const columns = [];
    for (let k = 0; k <= 12; k++) {
      const total = y * 12 + (m - 1) - k;
      const year = Math.floor(total / 12), month = total - year * 12 + 1;
      columns.push({
        key: `${year}-${pad(month)}`, label: k === 0 ? "MTD" : `${MONTHS[month - 1]} ${String(year).slice(2)}`,
        title: `${MONTHS[month - 1]} ${year}${k === 0 ? " (month to date)" : ""}`, kind: "span",
        start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(lastDay(year, month))}`, current: k === 0,
      });
    }
    return columns;
  }
  if (view === RETURN_VIEW.ANNUAL) {
    const columns = [];
    for (let year = y; year >= firstYear; year--) {
      columns.push({ key: String(year), label: year === y ? `YTD ${year}` : String(year), title: year === y ? `${year} (year to date)` : String(year),
        kind: "span", start: `${year}-01-01`, end: `${year}-12-31`, current: year === y });
    }
    return columns;
  }
  throw new Error(`Unknown returns view "${view}"`);
}

export function columnReturn(series, column, asOf) {
  if (!series?.dates.length) return null;
  const anchor = anchorNav(series, asOf);
  if (!anchor) return null;
  if (column.kind === "trailing") return trailingReturn(series, column.period, anchor);
  if (series.first > column.start) return null;                       // not yet launched on the period's first day
  const start = navOn(series, column.start, "next");
  const end = column.current ? anchor : navOn(series, column.end, "previous");
  if (!start || !end || end.date <= start.date) return null;
  if (column.current && anchor.date < column.start) return null;      // no NAV yet in the current period
  return returnBetween(start, end, false);
}

export function returnsTable({ funds, benchmark = null, view, asOf, firstYear }) {
  const columns = returnColumns(view, asOf, { firstYear });
  const figures = (series) => Object.fromEntries(columns.map((c) => [c.key, columnReturn(series, c, asOf)]));
  const rows = funds.map((fund) => ({ ...fund, returns: figures(fund.series) }));
  const average = { returns: {}, counts: {} };
  for (const c of columns) {
    const values = rows.map((r) => r.returns[c.key]).filter((v) => v !== null);
    average.counts[c.key] = values.length;
    average.returns[c.key] = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  }
  return {
    view, asOf, columns, rows, average,
    benchmark: benchmark?.series ? { name: benchmark.name, returns: figures(benchmark.series) } : null,
  };
}

/** Day-on-day change of an index / NAV series: { date, value, previous, change } at its last point, or null. */
export function lastMove(series) {
  if (!series || series.dates.length < 2) return null;
  const value = series.navs.at(-1), previous = series.navs.at(-2);
  return { date: series.last, value, previous, previousDate: series.dates.at(-2), change: value / previous - 1 };
}

/** The last `days` calendar days of a series (for sparklines): { dates, values }. */
export function recentPoints(series, days = 30) {
  if (!series?.dates.length) return { dates: [], values: [] };
  const from = addDays(series.last, -days);
  const i = series.dates.findIndex((d) => d >= from);
  return { dates: series.dates.slice(i), values: series.navs.slice(i) };
}
