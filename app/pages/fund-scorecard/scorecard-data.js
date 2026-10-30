/**
 * Data for one Fund Scorecard category and plan, loaded once per visit and shared.
 *
 * scorecardData(category, plan) → Promise<{ asOf, funds, benchmark, schemes, peerStats, metadataAsOf } | { error }>
 *   funds: [{ code, name, series, aum, benchmarkSeries?, benchmarkName? }] — every listed fund of the category with
 *   stored NAV history. Sector / thematic funds are measured against their own index (from the peer statistics'
 *   verified mapping); every other category against its SEBI benchmark (research-config.js).
 */

import { loadBenchmarkHistories, loadFundMetadata, loadNavHistories, loadPeerStats, loadValuationData } from "../../shared/market-data.js";
import { RESEARCH_YEARS } from "../fund-research/research-config.js";
import { isIndexFund } from "../../../calculation-engine/index.js";

const cache = new Map();
export const OWN_INDEX_CATEGORIES = new Set(["sectoral-thematic"]);

export function scorecardData(category, plan) {
  const key = `${category.slug}|${plan}`;
  if (!cache.has(key)) {
    cache.set(key, load(category, plan).then((result) => {
      if (result.error) cache.delete(key);
      return result;
    }));
  }
  return cache.get(key);
}

/**
 * Index-fund sub-category (scorecard-config INDEX_SCORECARD): the plan's index funds whose verified benchmark (peer
 * statistics' mapping) is the sub-category's index, each measured against that index.
 */
async function loadIndex(category, plan, market) {
  const all = market.schemes.filter((s) => s.plan === plan && s.active !== false && isIndexFund(s));
  const allStats = await loadPeerStats(all.map((s) => s.schemeCode));
  const schemes = all.filter((s) => allStats?.funds?.[String(s.schemeCode)]?.benchmark?.code === category.index.code);
  if (!schemes.length) return { error: `No ${plan} plan index funds tracking ${category.index.name} are listed.` };
  const codes = schemes.map((s) => s.schemeCode);
  const [navs, metadata, indices] = await Promise.all([
    loadNavHistories(codes, { years: RESEARCH_YEARS }), loadFundMetadata(codes), loadBenchmarkHistories([category.index.code], { years: RESEARCH_YEARS }),
  ]);
  if (navs.error) return { error: `NAV history is not available right now (${navs.error}).` };
  if (!metadata) return { error: "Fund details (AUM) are not available right now — funds cannot be checked against the AUM condition." };
  const benchmark = indices?.[category.index.code]?.series ?? null;
  if (!benchmark) return { error: `The ${category.index.name} index history is not available right now.` };
  const funds = schemes.map((s) => ({ code: s.schemeCode, name: s.schemeName, scheme: s, series: navs.histories[s.schemeCode],
    aum: metadata.funds?.[String(s.schemeCode)]?.aum ?? null, benchmarkSeries: benchmark })).filter((f) => f.series?.dates.length);
  if (!funds.length) return { error: "None of these funds has stored NAV history yet." };
  const asOf = funds.reduce((latest, f) => (f.series.last > latest ? f.series.last : latest), "");
  return { asOf, funds, benchmark, peerStats: allStats, metadataAsOf: metadata.generatedAt ?? null };
}

async function load(category, plan) {
  const market = await loadValuationData();
  if (market.error) return { error: `The fund list could not be loaded: ${market.error}` };
  if (category.kind === "index") return loadIndex(category, plan, market);
  const schemes = market.schemes.filter((s) => s.plan === plan && s.active !== false && category.amfi.includes(s.category));
  if (!schemes.length) return { error: `No ${plan} plan funds are listed in ${category.name}.` };
  const codes = schemes.map((s) => s.schemeCode);
  const [navs, peerStats, metadata] = await Promise.all([
    loadNavHistories(codes, { years: RESEARCH_YEARS }), loadPeerStats(codes), loadFundMetadata(codes),
  ]);
  if (navs.error) return { error: `NAV history is not available right now (${navs.error}).` };
  if (!metadata) return { error: "Fund details (AUM) are not available right now — funds cannot be checked against the AUM condition." };

  const own = OWN_INDEX_CATEGORIES.has(category.slug);
  const ownCodes = own ? [...new Set(codes.map((c) => peerStats?.funds?.[String(c)]?.benchmark?.code).filter(Boolean))] : [];
  const indices = await loadBenchmarkHistories([category.benchmark.code, ...ownCodes], { years: RESEARCH_YEARS });
  const benchmark = indices?.[category.benchmark.code]?.series ?? null;
  if (!benchmark) return { error: `The ${category.benchmark.name} index history is not available right now.` };

  const funds = schemes.map((s) => {
    const series = navs.histories[s.schemeCode];
    const ownIndex = own ? peerStats?.funds?.[String(s.schemeCode)]?.benchmark : null;
    const ownSeries = ownIndex?.code ? indices?.[ownIndex.code]?.series ?? null : null;
    return {
      code: s.schemeCode, name: s.schemeName, scheme: s, series,
      aum: metadata.funds?.[String(s.schemeCode)]?.aum ?? null,
      ...(ownSeries ? { benchmarkSeries: ownSeries, benchmarkName: ownIndex.name } : {}),
    };
  }).filter((f) => f.series?.dates.length);
  if (!funds.length) return { error: "None of these funds has stored NAV history yet." };
  const asOf = funds.reduce((latest, f) => (f.series.last > latest ? f.series.last : latest), "");
  return { asOf, funds, benchmark, peerStats, metadataAsOf: metadata.generatedAt ?? null };
}
