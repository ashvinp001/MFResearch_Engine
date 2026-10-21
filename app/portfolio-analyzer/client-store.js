/**
 * Advisor choices for the client currently open — kept in memory only.
 *
 * Input:  the analyzed portfolio. Output: { state }.
 * state = {
 *   salutation: "" | one of SALUTATIONS — defaults to the title printed on the CAS, if any,
 *   verdicts:   { [holdingKey]: "invest" | "hold" | "sell" },   // pre-filled from the conditions; advisor can change
 *   suggestions: { [holdingKey]: { verdict, ruleId, reason } }, // what the Prosperr conditions suggested
 *   recommended: { amount: number|null, rows: [ { fundId, name, isin, pct } ], basketId?: model-portfolio id applied,
 *                rowsBeforeBasket?: rows to restore when the model is deselected,
 *                skipped?: true when the advisor skipped this step (report leaves out The Way Forward) },
 *   acknowledged: boolean,   // advisor confirmed flagged figures were checked
 * }
 * Nothing is written to the browser: a refresh, Home, or a new upload always
 * starts fresh, so one client's choices can never carry over to another.
 */

const LEGACY_PREFIX = "prosperr.wealth.client.";

export const SALUTATIONS = ["Mr.", "Mrs.", "Ms."];

/**
 * Title printed on the CAS → one of Mr. / Mrs. / Ms. (the printed honorific's
 * English equivalent: Shri → Mr., Smt. → Mrs., Kumari/Miss → Ms.).
 * Null when nothing is printed, or for titles without an equivalent (e.g. Dr.).
 */
const PRINTED_TITLE = { MR: "Mr.", SHRI: "Mr.", MRS: "Mrs.", SMT: "Mrs.", MS: "Ms.", MISS: "Ms.", KUM: "Ms.", KUMARI: "Ms." };

export function printedSalutation(portfolio) {
  return PRINTED_TITLE[portfolio.investor.title] ?? null;
}

export function emptyRow() {
  return { fundId: "", name: "", isin: "", pct: "" };
}

/** Remove choices saved by earlier versions of the app. */
export function clearSavedClientData() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(LEGACY_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

export function openClientStore(portfolio) {
  return {
    state: {
      salutation: printedSalutation(portfolio) ?? "",
      verdicts: {},
      suggestions: {},
      recommended: { amount: null, rows: [emptyRow()] },
      acknowledged: false,
    },
    save() {
      /* in-memory only by design — nothing persists across refresh */
    },
  };
}
