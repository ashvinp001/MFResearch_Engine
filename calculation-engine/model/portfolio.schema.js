/**
 * NormalizedPortfolio — the single contract every CAS parser produces (MF_Calculation_Engine.md E15.1).
 *
 * Input: none. Output: JSDoc types plus factory functions that create empty,
 * correctly shaped objects. Everything downstream reads ONLY this shape.
 *
 * Conventions:
 *  - Numbers are parsed from the printed text; the exact printed string is kept
 *    in `raw` so "same-to-same" extraction is provable and auditable.
 *  - Reconciliation sums money in integer paise (see parse-values.js#toPaise).
 *  - Dates are ISO "YYYY-MM-DD". `null` means "not printed" — never guessed.
 */

/** @typedef {"CAMS_KFINTECH" | "NSDL" | "CDSL"} CasFormat */

/**
 * @typedef {Object} Transaction
 * @property {string} date             ISO date as printed
 * @property {string} description      transaction text as printed
 * @property {number|null} amount      ₹, negative for outflows printed in ( )
 * @property {number|null} units
 * @property {number|null} price       NAV/price as printed
 * @property {number|null} unitBalance running balance as printed
 * @property {{amount:string|null, units:string|null, price:string|null, unitBalance:string|null}} raw
 */

/**
 * @typedef {Object} Holding
 * @property {string|null} isin          PRIMARY KEY (validated in validate.js)
 * @property {string|null} schemeName    as printed
 * @property {string|null} rtaSchemeCode registrar's scheme code prefix, if printed
 * @property {string|null} amc           as printed
 * @property {string|null} folio
 * @property {string|null} pan           PAN printed against this folio
 * @property {"CAMS"|"KFINTECH"|null} registrar
 * @property {"active"|"redeemed"} status redeemed = closing units printed as zero
 * @property {number|null} openingUnits
 * @property {number|null} units         closing unit balance
 * @property {number|null} nav
 * @property {string|null} navDate
 * @property {number|null} costValue
 * @property {number|null} marketValue
 * @property {number|null} averageCost   average cost per unit, if the statement prints it
 * @property {number|null} printedGain   unrealised profit/loss, if the statement prints it
 * @property {{openingUnits:string|null, units:string|null, nav:string|null, costValue:string|null, marketValue:string|null, averageCost:string|null, printedGain:string|null}} raw
 * @property {Transaction[]} transactions
 * @property {string|null} category      enriched in Phase 2
 * @property {string|null} assetClass    enriched in Phase 2
 * @property {string[]} flags            validation flags for this row
 */

/**
 * Stable identity of a holding within a statement: ISIN + folio (the same ISIN
 * can sit in several folios). Used to key advisor choices for that holding.
 */
export function holdingKey(holding) {
  return `${holding.isin ?? ""}|${holding.folio ?? ""}`;
}

/** @returns {Holding} */
export function createHolding() {
  return {
    isin: null,
    schemeName: null,
    rtaSchemeCode: null,
    amc: null,
    folio: null,
    pan: null,
    registrar: null,
    status: "active",
    openingUnits: null,
    units: null,
    nav: null,
    navDate: null,
    costValue: null,
    marketValue: null,
    averageCost: null,
    printedGain: null,
    raw: { openingUnits: null, units: null, nav: null, costValue: null, marketValue: null, averageCost: null, printedGain: null },
    transactions: [],
    category: null,
    assetClass: null,
    flags: [],
  };
}

/**
 * @param {CasFormat} format
 * @param {string|null} rawFileName
 * @returns {NormalizedPortfolio}
 */
export function createPortfolio(format, rawFileName) {
  return {
    source: {
      format,
      statementAsOf: null,
      statementPeriod: { from: null, to: null },
      generatedOn: null,
      rawFileName: rawFileName ?? null,
    },
    // title: honorific printed before the name on the statement ("MR", "SMT"…), else null
    investor: { name: null, title: null, pan: null, pans: [], email: null, address: null },
    holdings: [],
    printedTotals: {
      totalCostValue: null,
      totalMarketValue: null,
      raw: { totalCostValue: null, totalMarketValue: null },
      // Per fund house, from the statement's portfolio summary (CAMS/KFintech): [{ amc, costValue, marketValue, raw }]
      byAmc: [],
    },
    integrity: { status: "ok", checks: [], warnings: [] },
  };
}

/**
 * @typedef {Object} NormalizedPortfolio
 * @property {{format:CasFormat, statementAsOf:string|null, statementPeriod:{from:string|null,to:string|null}, generatedOn:string|null, rawFileName:string|null}} source
 * @property {{name:string|null, title:string|null, pan:string|null, pans:string[], email:string|null, address:string|null}} investor
 * @property {Holding[]} holdings
 * @property {{totalCostValue:number|null, totalMarketValue:number|null, raw:{totalCostValue:string|null,totalMarketValue:string|null},
 *             byAmc:{amc:string, costValue:number|null, marketValue:number|null, raw:{costValue:string|null, marketValue:string|null}}[]}} printedTotals
 * @property {{status:"ok"|"needs_review", checks:{name:string,passed:boolean,detail:string}[], warnings:string[]}} integrity
 */
