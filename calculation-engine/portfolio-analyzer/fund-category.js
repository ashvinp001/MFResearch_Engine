/**
 * SEBI fund category of a holding — needed for the Risk Profile and Horizon logic.
 *
 * Input:  a holding, and its fund info from fundData (Phase 2, may be null).
 * Output: { category, source: "fund data" | "scheme name" } or null (unclassified).
 *
 * A CAS does not print the SEBI category, so it is taken from fundData.category when
 * available, else read from the scheme name — but ONLY when the name states the
 * category plainly. Anything ambiguous returns null and is never guessed: e.g.
 * "Emerging Equity" (could be mid cap or large & mid), international funds, debt
 * index / target-maturity funds, solution-oriented funds and "Commodities" equity funds.
 * Rules are checked IN ORDER — the order matters (e.g. "Large & Mid Cap" before "Mid Cap",
 * "Ultra Short" before "Short Duration", "Medium to Long" before "Long Duration").
 */

/** Category keys used by report-profile.js (one per row of the logic tables). */
export const FUND_CATEGORY = Object.freeze({
  OVERNIGHT: "overnight",
  LIQUID: "liquid",
  ULTRA_SHORT: "ultraShort",
  LOW_DURATION: "lowDuration",
  MONEY_MARKET: "moneyMarket",
  FLOATER: "floater",
  SHORT_DURATION: "shortDuration",
  BANKING_PSU: "bankingPsu",
  CORPORATE_BOND: "corporateBond",
  CREDIT_RISK: "creditRisk",
  DYNAMIC_BOND: "dynamicBond",
  MEDIUM_TO_LONG: "mediumToLong",
  MEDIUM_DURATION: "mediumDuration",
  LONG_DURATION: "longDuration",
  GILT: "gilt",
  ARBITRAGE: "arbitrage",
  EQUITY_SAVINGS: "equitySavings",
  CONSERVATIVE_HYBRID: "conservativeHybrid",
  BALANCED_ADVANTAGE: "balancedAdvantage", // incl. Dynamic Asset Allocation
  BALANCED_HYBRID: "balancedHybrid",
  MULTI_ASSET: "multiAsset",
  AGGRESSIVE_HYBRID: "aggressiveHybrid",
  GOLD_SILVER: "goldSilver", // Gold / Silver / precious-metal funds
  EQUITY: "equity", // large, large & mid, flexi, multi, focused, value, contra, dividend yield, ELSS, index, sectoral/thematic
  MID_CAP: "midCap",
  SMALL_CAP: "smallCap",
});

const C = FUND_CATEGORY;
const UNCLASSIFIED = null;

/** [result, pattern] checked top to bottom; result null = deliberately not classified. */
const RULES = [
  // Not covered by the logic tables → never guessed.
  [UNCLASSIFIED, /retirement|children|\bchild\b/],
  [UNCLASSIFIED, /international|global|overseas|nasdaq|s&p\s*500|\bworld\b|emerging\s*markets?|china|japan|europe|\basia|hang\s*seng|taiwan|\bfang\b|us\s*(equity|bluechip|specific|treasury)/],

  // Hybrids (before debt and equity words they contain).
  [C.ARBITRAGE, /arbitrage/],
  [C.EQUITY_SAVINGS, /equity\s*savings/],
  [C.CONSERVATIVE_HYBRID, /conservative\s*hybrid|debt\s*hybrid/],
  [C.BALANCED_ADVANTAGE, /balanced\s*advantage|dynamic\s*asset\s*allocation/],
  [C.BALANCED_HYBRID, /balanced\s*hybrid/],
  [C.MULTI_ASSET, /multi[\s-]*asset/],
  [C.AGGRESSIVE_HYBRID, /aggressive\s*hybrid|equity\s*(&|and)\s*debt|equity\s*hybrid|hybrid\s*equity/],

  // Gold / silver.
  [C.GOLD_SILVER, /\bgold\b|\bsilver\b|precious\s*metals?/],

  // Debt index / ETF / target-maturity funds have no row in the tables → not guessed.
  [UNCLASSIFIED, /(?=.*(\bindex\b|\betf\b|target\s*maturity|bharat\s*bond|\bfof\b|fund\s*of\s*funds?))(?=.*(\bgilt\b|g[\s-]*sec|\bsdl\b|\bbond\b|\bdebt\b|t[\s-]*bill|treasury|crisil\s*ibx))/],

  // Debt (order matters).
  [C.OVERNIGHT, /overnight/],
  [C.LIQUID, /\bliquid\b/],
  [C.ULTRA_SHORT, /ultra[\s-]*short/],
  [C.LOW_DURATION, /low[\s-]*duration/],
  [C.MONEY_MARKET, /money\s*market/],
  [C.FLOATER, /floater|floating\s*rate/],
  [C.SHORT_DURATION, /short[\s-]*(duration|term)/],
  [C.BANKING_PSU, /banking\s*(&|and)\s*psu/],
  [C.CORPORATE_BOND, /corporate\s*bond/],
  [C.CREDIT_RISK, /credit\s*risk/],
  [C.DYNAMIC_BOND, /dynamic\s*bond/],
  [C.MEDIUM_TO_LONG, /medium\s*to\s*long/],
  [C.MEDIUM_DURATION, /medium[\s-]*(duration|term)/],
  [C.LONG_DURATION, /long[\s-]*duration/],
  [C.GILT, /\bgilt\b|constant\s*maturity/],

  // ELSS (before the debt guard: names like "Tax Savings" are equity).
  [C.EQUITY, /\belss\b|tax[\s-]*sav(er|ings?)|long[\s-]*term\s*equity|tax\s*(plan|advantage)/],

  // Any other debt-looking name has no clear row → not guessed (never treated as equity).
  [UNCLASSIFIED, /\bbond\b|\bdebt\b|g[\s-]*sec|\bsdl\b|t[\s-]*bill|treasury|\bincome\b|accrual|duration|maturity|fixed\s*term|\bfmp\b|savings/],

  // Equity. Index funds are the SEBI "Index Funds" category (7.0 yrs) even when they track mid/small caps.
  [C.EQUITY, /\bindex\b|\betf\b|nifty|sensex|\bbees\b/],
  [C.EQUITY, /large\s*(&|and)\s*mid[\s-]*cap/],
  [C.SMALL_CAP, /small[\s-]*cap/],
  [C.MID_CAP, /mid[\s-]*cap/],
  [C.EQUITY, /large[\s-]*cap|blue[\s-]*chip|top\s*100|\bfocused\b|flexi[\s-]*cap|multi[\s-]*cap|\bvalue\b|contra|dividend\s*yield/],
  [C.EQUITY, /thematic|sectoral|technology|digital|banking\s*(&|and)\s*financial|financial\s*services|\bbanking\b|healthcare|health\s*care|pharma|infrastructure|\binfra\b|consumption|\bconsumer\b|manufacturing|\benergy\b|\bpower\b|\bauto(motive)?\b|\bmnc\b|\bpsu\b|business\s*cycle|innovation|transportation|logistics|housing|realty|defence|\brural\b|\besg\b/],
];

/** Category key for a piece of text (scheme name or category label), or null. */
export function categoryFromText(text) {
  const normalized = String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  for (const [result, pattern] of RULES) {
    if (pattern.test(normalized)) return result;
  }
  return null;
}

export function classifyFund(holding, info = null) {
  const fromData = info?.category ? categoryFromText(info.category) : null;
  if (fromData) return { category: fromData, source: "fund data" };
  const fromName = categoryFromText(holding.schemeName);
  return fromName ? { category: fromName, source: "scheme name" } : null;
}
