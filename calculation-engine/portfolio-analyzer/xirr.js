/**
 * Portfolio and fund XIRR from the statement's transactions (MF_Calculation_Engine.md E15.5.10).
 *
 * holdingCashflows(holding) → { flows: [{ date, amount }], excluded: reason | null }
 * portfolioXirr(portfolio) → { xirr, funds: { [holdingKey]: xirr | null }, excluded: [{ schemeName, reason }] }
 *
 * Investor's cash flows (₹, exact from the printed amounts, investments negative):
 *   Purchase / SIP / switch-in / NFO (amount > 0, units > 0)      → − amount
 *   Redemption / switch-out / SIP rejection (amount < 0)          → + |amount|  (printed NET of STT / TDS)
 *   *** Stamp Duty ***                                             → − amount    (paid on top of the purchase)
 *   IDCW / dividend PAYOUT (no units)                              → + amount
 *   STT / TDS lines                                                → none        (already deducted above)
 *   IDCW REINVESTMENT                                              → none        (no cash moves)
 *   Lines without an amount (address, nominee, KYC …)              → none
 *   Today: each active holding's current value (latest NAV, revalue.js) on its NAV date → + value
 * A holding is left out (and the portfolio XIRR is null) when its history is incomplete: units at the
 * start of the statement, no transactions, or opening units + transactions ≠ closing units.
 */

import { xirr } from "../analytics/returns.js";
import { toPaise } from "../cas/parse-values.js";
import { FLAG } from "../cas/validate.js";
import { holdingKey } from "../model/portfolio.schema.js";

const NO_CASH = /reinvest/i;
const STAMP_DUTY = /stamp\s*duty/i;
const TAX_LINE = /\*+\s*(stt|tds)\b|stt\s*paid|tds\s*on\s*above/i;
const PAYOUT = /(idcw|dividend)[^]*?(payout|paid)|payout[^]*?(idcw|dividend)/i;

export const XIRR_EXCLUSION = Object.freeze({
  OPENING_UNITS: "The statement starts after the first purchase (units held at the start).",
  NO_TRANSACTIONS: "The statement shows no transactions for this fund.",
  UNITS_DO_NOT_RECONCILE: "Transactions do not add up to the closing units.",
  NO_VALUE: "No current value for this fund.",
});

/** Cash flows of one holding (₹ as numbers; built from paise so nothing drifts). */
export function holdingCashflows(holding) {
  if (holding.openingUnits) return { flows: [], excluded: XIRR_EXCLUSION.OPENING_UNITS };
  if (!holding.transactions?.length) return { flows: [], excluded: XIRR_EXCLUSION.NO_TRANSACTIONS };
  if (holding.flags?.includes(FLAG.UNIT_BALANCE_MISMATCH)) return { flows: [], excluded: XIRR_EXCLUSION.UNITS_DO_NOT_RECONCILE };

  const flows = [];
  for (const t of holding.transactions) {
    const paise = toPaise(t.raw?.amount ?? null);
    if (paise === null || paise === 0 || !t.date) continue;
    const text = t.description ?? "";
    if (TAX_LINE.test(text) || NO_CASH.test(text)) continue;
    let investor;
    if (STAMP_DUTY.test(text)) investor = -Math.abs(paise);
    else if (t.units === null && PAYOUT.test(text)) investor = Math.abs(paise);
    else if (t.units === null) continue;   // any other unit-less line is not a cash flow
    else investor = -paise;                // purchase (+) is paid out; redemption (−) is received
    flows.push({ date: t.date, paise: investor });
  }
  if (holding.status === "active") {
    const value = toPaise(holding.raw?.marketValue ?? null);
    const date = holding.navDate;
    if (value === null || !date) return { flows: [], excluded: XIRR_EXCLUSION.NO_VALUE };
    flows.push({ date, paise: value });
  }
  return { flows: flows.map((f) => ({ date: f.date, amount: f.paise / 100 })), excluded: null };
}

export function portfolioXirr(portfolio) {
  const all = [];
  const funds = {};
  const excluded = [];
  for (const holding of portfolio.holdings) {
    const { flows, excluded: reason } = holdingCashflows(holding);
    if (reason) {
      excluded.push({ schemeName: holding.schemeName, reason });
      funds[holdingKey(holding)] = null;
      continue;
    }
    funds[holdingKey(holding)] = holding.status === "active" ? xirr(flows) : null;
    all.push(...flows);
  }
  // The portfolio figure covers every fund or none: a partial XIRR would mislead.
  return { xirr: excluded.length ? null : xirr(all), funds, excluded };
}
