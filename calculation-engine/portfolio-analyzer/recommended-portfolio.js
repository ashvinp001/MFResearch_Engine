/**
 * Prosperr Recommended Portfolio — splits an investment amount across funds.
 *
 * Input:  { amount: rupees, rows: [ { fundId, isin, name, pct } ] }
 *         pct is the advisor's allocation in percent, up to 2 decimals.
 * Output: allocatePortfolio → {
 *   rows: [ { ...row, bps, amount } ], totalPct, remainingPct, allocatedAmount,
 *   issues: [ { index|null, code } ], complete
 * }
 * Exactness: percentages are held as integer basis points and money as integer
 * paise. When allocations total 100%, rupee amounts are distributed with the
 * largest-remainder method, so the row amounts always add up to the amount
 * EXACTLY (no lost or extra paisa).
 *
 * Issue codes: AMOUNT_INVALID, NO_ROWS, NO_FUND, ZERO_PCT, PCT_INVALID,
 * DUPLICATE_FUND, ISIN_INVALID, TOTAL_NOT_100.
 */

import { isValidIsin } from "../identity/isin.js";

const FULL_BPS = 10000;

/** "12.5" → 1250 basis points; null when not a valid percentage (max 2 decimals). */
export function percentToBps(pct) {
  const text = String(pct ?? "").trim();
  if (text === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}

export function allocatePortfolio({ amount, rows }) {
  const amountPaise = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
  const issues = [];
  if (!amountPaise) issues.push({ index: null, code: "AMOUNT_INVALID" });
  if (!rows.length) issues.push({ index: null, code: "NO_ROWS" });

  const bpsList = rows.map((row) => percentToBps(row.pct));
  const seen = new Map();
  rows.forEach((row, index) => {
    if (!row.fundId || !row.name) issues.push({ index, code: "NO_FUND" });
    if (bpsList[index] === null) issues.push({ index, code: "PCT_INVALID" });
    else if (bpsList[index] === 0) issues.push({ index, code: "ZERO_PCT" });
    if (row.isin && !isValidIsin(row.isin)) issues.push({ index, code: "ISIN_INVALID" });

    const identity = row.isin ? `isin:${row.isin}` : row.name ? `name:${row.name.trim().toLowerCase()}` : null;
    if (identity) {
      if (seen.has(identity)) issues.push({ index, code: "DUPLICATE_FUND" });
      else seen.set(identity, index);
    }
  });

  const totalBps = bpsList.reduce((sum, bps) => sum + (bps ?? 0), 0);
  if (rows.length && totalBps !== FULL_BPS) issues.push({ index: null, code: "TOTAL_NOT_100" });

  const amountsPaise = distribute(amountPaise, bpsList.map((bps) => bps ?? 0), totalBps === FULL_BPS);
  const allocatedPaise = amountsPaise.reduce((sum, paise) => sum + paise, 0);

  return {
    rows: rows.map((row, index) => ({ ...row, bps: bpsList[index], amount: amountsPaise[index] / 100 })),
    totalPct: totalBps / 100,
    remainingPct: (FULL_BPS - totalBps) / 100,
    allocatedAmount: allocatedPaise / 100,
    amount: amountPaise / 100,
    issues,
    complete: issues.length === 0,
  };
}

/**
 * Paise per row = amount × bps / 10000, floored. When the allocation is exactly
 * 100%, the leftover paise go to the rows with the largest remainders (ties to
 * the earlier row), so the parts sum to the whole.
 */
function distribute(amountPaise, bpsList, isFull) {
  // BigInt keeps amount × bps exact even for very large amounts.
  const full = BigInt(FULL_BPS);
  const exact = bpsList.map((bps) => BigInt(amountPaise) * BigInt(bps));
  const floors = exact.map((value) => value / full);
  if (isFull) {
    let leftover = BigInt(amountPaise) - floors.reduce((sum, paise) => sum + paise, 0n);
    const order = exact
      .map((value, index) => ({ index, remainder: Number(value % full) }))
      .sort((p, q) => q.remainder - p.remainder || p.index - q.index);
    for (let i = 0; leftover > 0n; i = (i + 1) % order.length, leftover--) floors[order[i].index] += 1n;
  }
  return floors.map(Number);
}
