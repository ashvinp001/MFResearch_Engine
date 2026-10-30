/**
 * Fund Research content: asset-class tabs, the market index strip and the fund categories
 * (MF_Platform_Specification.md P7 Sections 1 and 4).
 *
 * Index codes are PulseDB benchmark codes (bucket benchmark-data); Gold is shown from the
 * Nippon India ETF Gold BeES NAV (AMFI), as no verified gold price index is stored.
 * A category lists the AMFI categories it covers and its benchmark (the SEBI-prescribed index family).
 * `ready: false` categories show as "Coming next" until they are switched on; accent / icon colour each box.
 */

// Temporary visibility switch for everything after the asset-class boxes (category boxes, fund tables).
// false: the asset classes all show "Coming soon" and the inner pages are closed (their addresses lead back to
// Fund Research); the code and data stay in place. true: Equity opens as built.
export const SHOW_CATEGORY_PAGES = false;

export const RESEARCH_YEARS = 12;   // history requested for the tables: 10Y trailing and calendar years from 2015

// The big asset-class boxes on the Fund Research home; a ready one opens its category boxes.
// accent = a brand palette token name.
export const ASSET_CLASSES = [
  { slug: "equity", icon: "equity", accent: "navy", title: "Equity Funds", ready: true,
    text: "Invest predominantly in equity shares, with the objective of long-term capital appreciation." },
  { slug: "hybrid", icon: "hybrid", accent: "green", title: "Hybrid Funds",
    text: "Combine equity and fixed income in one portfolio, balancing capital growth with stability." },
  { slug: "index", icon: "index", accent: "blue", title: "Index Funds",
    text: "Passively managed funds that replicate the composition and performance of a market index." },
  { slug: "debt", icon: "debt", accent: "steel", title: "Debt Funds",
    text: "Invest predominantly in fixed income securities, aiming for steady returns with capital preservation." },
  { slug: "etf", icon: "etf", accent: "olive", title: "ETF",
    text: "Exchange-traded funds that track an index and are bought and sold on the stock exchange like shares." },
  { slug: "nfo", icon: "nfo", accent: "amber", title: "NFO",
    text: "New fund offers — schemes open for initial subscription, typically at ₹10 per unit." },
];

// Ten cards, five to a row. Colour follows the index family — broad, segment (market cap), sector, commodity
// (spec P8: colour always means something).
// kind "index" → benchmark code, "nav" → AMFI scheme code
export const INDEX_FAMILIES = {
  broad: "Broad market",
  segment: "Market cap",
  sector: "Sector",
  commodity: "Commodity",
};
export const MARKET_INDICES = [
  { name: "NIFTY 50", kind: "index", code: "OB48", family: "broad" },
  { name: "SENSEX", kind: "index", code: "OB117", family: "broad" },
  { name: "NIFTY Next 50", kind: "index", code: "OB82", family: "broad" },
  { name: "NIFTY 100", kind: "index", code: "OB44", family: "broad" },
  { name: "NIFTY 500", kind: "index", code: "OB56", family: "broad" },
  { name: "NIFTY Midcap 150", kind: "index", code: "OB79", family: "segment" },
  { name: "NIFTY Smallcap 250", kind: "index", code: "OB88", family: "segment" },
  { name: "NIFTY LargeMidcap 250", kind: "index", code: "OB73", family: "segment" },
  { name: "NIFTY Bank", kind: "index", code: "OB60", family: "sector" },
  { name: "Gold", kind: "nav", code: 140088, family: "commodity", note: "Gold BeES NAV", source: "Nippon India ETF Gold BeES NAV (AMFI)" },
];

export const EQUITY_CATEGORIES = [
  { slug: "large-cap", accent: "blue", icon: "building", name: "Large Cap", amfi: ["Large Cap Fund"], benchmark: { code: "OB44", name: "NIFTY 100" },
    text: "Minimum 80% in large-cap stocks.", ready: true },
  { slug: "mid-cap", accent: "teal", icon: "layers", name: "Mid Cap", amfi: ["Mid Cap Fund"], benchmark: { code: "OB79", name: "NIFTY Midcap 150" },
    text: "Minimum 65% in mid-cap stocks." },
  { slug: "large-mid-cap", accent: "violet", icon: "pie", name: "Large & Mid Cap", amfi: ["Large & Mid Cap Fund"], benchmark: { code: "OB73", name: "NIFTY LargeMidcap 250" },
    text: "Minimum 35% each in large-cap and mid-cap stocks." },
  { slug: "small-cap", accent: "green", icon: "sparkle", name: "Small Cap", amfi: ["Small Cap Fund"], benchmark: { code: "OB88", name: "NIFTY Smallcap 250" },
    text: "Minimum 65% in small-cap stocks." },
  { slug: "multi-cap", accent: "amber", icon: "layers", name: "Multi Cap", amfi: ["Multi Cap Fund"], benchmark: { code: "OB189", name: "NIFTY 500 Multicap 50:25:25" },
    text: "Minimum 25% each in large-cap, mid-cap and small-cap stocks." },
  { slug: "flexi-cap", accent: "navy", icon: "trend", name: "Flexi Cap", amfi: ["Flexi Cap Fund"], benchmark: { code: "OB56", name: "NIFTY 500" },
    text: "Minimum 65% in equity, with the flexibility to invest across market capitalisations." },
  { slug: "focused", accent: "red", icon: "bolt", name: "Focused", amfi: ["Focused Fund"], benchmark: { code: "OB56", name: "NIFTY 500" },
    text: "A concentrated portfolio of up to 30 stocks, with a minimum 65% in equity." },
  { slug: "value", accent: "olive", icon: "wallet", name: "Value", amfi: ["Value Fund"], benchmark: { code: "OB56", name: "NIFTY 500" },
    text: "Follows a value investment strategy, with a minimum 65% in equity." },
  { slug: "contra", accent: "steel", icon: "refresh", name: "Contra", amfi: ["Contra Fund"], benchmark: { code: "OB56", name: "NIFTY 500" },
    text: "Follows a contrarian investment strategy, with a minimum 65% in equity." },
  { slug: "dividend-yield", accent: "green", icon: "invested", name: "Dividend Yield", amfi: ["Dividend Yield Fund"], benchmark: { code: "OB56", name: "NIFTY 500" },
    text: "Invests predominantly in dividend-yielding stocks, with a minimum 65% in equity." },
  { slug: "elss", accent: "violet", icon: "shield", name: "ELSS (Tax Saver)", amfi: ["ELSS (Tax Saver)"], benchmark: { code: "OB56", name: "NIFTY 500" },
    text: "Minimum 80% in equity, with a statutory 3-year lock-in; eligible for deduction under Section 80C (old tax regime)." },
  { slug: "sectoral-thematic", accent: "teal", icon: "pie", name: "Sectoral / Thematic", amfi: ["Sectoral/Thematic", "Thematic Fund", "Sectoral Fund"],
    benchmark: { code: "OB56", name: "NIFTY 500" }, text: "Minimum 80% in a specific sector or theme; each fund is measured against its own sector or thematic index." },
];
