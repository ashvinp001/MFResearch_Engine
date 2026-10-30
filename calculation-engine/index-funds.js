/**
 * Index funds — the one place that says what an index fund tracks. Used by the Portfolio Analyzer (report group and
 * category label) and by the Fund Scorecard (the index-fund categories).
 *
 * AMFI files every index fund — equity, debt and hybrid — under "Other Scheme - Index Funds" (and since 2025 also
 * "Index Funds - Equity / Debt / Hybrid"). What a fund really is follows from the index it tracks.
 *
 * isIndexFund(scheme) → true for an AMFI index-fund category (ETFs are not index funds here)
 * indexFamily({ category, name, benchmarkName }) → { family, label, kind, indexName }
 *   family    broad | factor | sector | international | debt | hybrid | other
 *   label     the family as shown ("Broad market", "Factor / smart beta", …)
 *   kind      equity | debt | hybrid — the report's asset group (an international index fund is equity)
 *   indexName the tracked index as named by the verified benchmark mapping ("NIFTY 50"), else null
 *   The verified benchmark name decides when there is one; otherwise the fund's name.
 * TRACKED_INDICES — the indices whose funds are rated against each other in the Fund Scorecard (enough funds per plan),
 *   by PulseDB benchmark code: a fund belongs to one when its verified benchmark is that index.
 */

export const INDEX_FAMILY = Object.freeze({
  broad: { label: "Broad market", kind: "equity" },
  factor: { label: "Factor / smart beta", kind: "equity" },
  sector: { label: "Sector / thematic", kind: "equity" },
  international: { label: "International", kind: "equity" },
  debt: { label: "Debt index", kind: "debt" },
  hybrid: { label: "Hybrid index", kind: "hybrid" },
  other: { label: "Other equity index", kind: "equity" },
});

export const TRACKED_INDICES = Object.freeze([
  { slug: "idx-nifty-50", code: "OB48", name: "NIFTY 50", family: "broad", accent: "blue", icon: "building" },
  { slug: "idx-sensex", code: "OB117", name: "BSE Sensex", family: "broad", accent: "navy", icon: "building" },
  { slug: "idx-next-50", code: "OB82", name: "NIFTY Next 50", family: "broad", accent: "violet", icon: "layers" },
  { slug: "idx-midcap-150", code: "OB79", name: "NIFTY Midcap 150", family: "broad", accent: "teal", icon: "layers" },
  { slug: "idx-smallcap-250", code: "OB88", name: "NIFTY Smallcap 250", family: "broad", accent: "green", icon: "sparkle" },
  { slug: "idx-nifty-500", code: "OB56", name: "NIFTY 500", family: "broad", accent: "steel", icon: "pie" },
  { slug: "idx-momentum-30", code: "OB180", name: "NIFTY 200 Momentum 30", family: "factor", accent: "amber", icon: "trend" },
  { slug: "idx-equal-weight-50", code: "OB50", name: "NIFTY 50 Equal Weight", family: "factor", accent: "olive", icon: "pie" },
  { slug: "idx-bank", code: "OB60", name: "NIFTY Bank", family: "sector", accent: "red", icon: "wallet" },
  { slug: "idx-it", code: "OB165", name: "NIFTY IT", family: "sector", accent: "violet", icon: "bolt" },
]);

const INDEX_CATEGORY = /^index funds\b/i;

export function isIndexFund(scheme) {
  return INDEX_CATEGORY.test(scheme?.category ?? "");
}

// Checked in this order; the first that matches decides.
// Hybrid = an EQUITY index plus a debt part ("NIFTY LargeMidcap250 Plus 8-13 yr G-Sec 70:30"); "SDL Plus G-Sec 70:30"
// or "Gilt Plus SDL 50:50" are two debt indices — debt.
const HYBRID = /\b(large\s*mid\s*cap\s*\d*|largemidcap\s*\d*|midcap|smallcap|momentum|quality|sensex|nifty\s*\d{2,3})\b.*\bplus\b.*\b(g[\s-]*sec|sdl|bond|gilt)\b/i;
const DEBT = /\bg[\s-]*sec\b|\bgilt\b|\bsdl\b|\bbond\b|\bdebt\b|t[\s-]*bills?\b|\btbill\b|treasury|crisil[\s-]*ibx|target\s*maturity|ccil|bharat\s*bond|\bpsu\s+bank\s+bond|\bcorporate\b|money\s*market|liquid|overnight|\b1d\s*rate\b/i;
const INTERNATIONAL = /s\s*&\s*p\s*500|nasdaq|dow\s*jones|hang\s*seng|nyse|fang|msci|ftse|global|world|\bus\b|u\.s\.|international|emerging\s+markets?|developed\s+markets?|japan|china|taiwan|europe/i;
const FACTOR = /momentum|quality|low[\s-]*vol(atility)?|value\s*\d*|\balpha\b|equal[\s-]*weight(ed)?|dividend\s+opportunities|\bdividend\b|multi[\s-]*factor|enhanced\s+value|\bgrowth\b\s+sectors/i;
const SECTOR = /\b(bank|banking|financials?|fin\s*serv|ex[\s-]*banks?|clean\s+environment|environment|business\s+groups|psu|cpse|it|tech|technology|digital|internet|pharma|healthcare|health|hospitals?|auto|automotive|ev\b|fmcg|consumption|consumer|infra(structure)?|energy|oil|power|metal|realty|reits?|real\s*estate|media|defen[cs]e|manufacturing|commodities|mnc|capital\s*markets?|housing|rail(ways)?|tourism|logistics|transport(ation)?|chemicals?|services|sector\s+leaders|non[\s-]*cyclical|ipo|esg|shariah|bharat\s*22|psu)\b/i;
const BROAD = /nifty\s*50\b|sensex|nifty\s*next\s*50|nifty\s*100\b|bse\s*100\b|nifty\s*200\b|bse\s*200\b|nifty\s*500\b|bse\s*500\b|total\s*market|midcap\s*150|smallcap\s*250|large\s*mid\s*cap\s*250|largemidcap\s*250|midsmallcap\s*400|midcap\s*50\b|smallcap\s*50\b|microcap\s*250|multicap\s*50\s*:\s*25\s*:\s*25|top\s*\d+\b|bse\s*1000|sensex\s+next/i;

/** The tracked index's short name from a benchmark name: "NIFTY 50 Index" → "NIFTY 50". */
export function indexShortName(benchmarkName) {
  return benchmarkName ? String(benchmarkName).replace(/\s+index(\s+tri)?\s*$/i, "").replace(/\s+tri\s*$/i, "").trim() : null;
}

export function indexFamily({ category = "", name = "", benchmarkName = null } = {}) {
  const text = `${benchmarkName ?? ""} ${benchmarkName ? "" : name}`.trim() || name;
  const cat = String(category).toLowerCase();
  let family;
  if (/index funds\s*-\s*hybrid/.test(cat) || HYBRID.test(`${name} ${benchmarkName ?? ""}`)) family = "hybrid";
  else if (/index funds\s*-\s*debt/.test(cat) || DEBT.test(text)) family = "debt";
  else if (INTERNATIONAL.test(text)) family = "international";
  else if (FACTOR.test(text)) family = "factor";
  else if (SECTOR.test(text)) family = "sector";
  else if (BROAD.test(text)) family = "broad";
  else family = "other";
  return { family, label: INDEX_FAMILY[family].label, kind: INDEX_FAMILY[family].kind, indexName: indexShortName(benchmarkName) };
}

/** Category label for an index fund in a report: "Index Fund · NIFTY 50" (the tracked index), else its family. */
export function indexCategoryLabel({ category, name, benchmarkName }) {
  const f = indexFamily({ category, name, benchmarkName });
  return `Index Fund · ${f.family === "debt" || f.family === "hybrid" || !f.indexName ? f.label : f.indexName}`;
}
