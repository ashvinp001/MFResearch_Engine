/**
 * Calculation Engine — public API. The app imports from here and nowhere deeper.
 *
 *  analyzeCasPdf({ data, password, fileName, pdfjs }) → Promise<NormalizedPortfolio>
 *      Full pipeline: extract → detect → parse → normalize → validate.
 *      Throws CasError (see CAS_ERROR) for password / unreadable / unsupported files.
 *  parseCasDocument(doc, fileName) → NormalizedPortfolio
 *      Same pipeline from an already-extracted StructuredDocument (used by tests).
 *  buildSchemeMap(lists) / mapHoldings(holdings, map) → ISIN → AMFI scheme code, name, category, plan.
 *  revalueAtLatestNav(portfolio, { schemeMap, latestNavs }) → current value at the latest stored NAV.
 *  summarizePortfolio(portfolio) → headline figures for display.
 *  holdingGain(holding) → { gain, gainPct } | null from printed cost and value.
 *  summarizeRecommendations(portfolio, verdicts) → Invest/Hold/Sell counts, values, shares.
 *  suggestVerdicts({ portfolio, fundData, rules }) → rule-based Invest/Hold/Sell suggestion per fund.
 *  buildReportProfile(portfolio, fundData) → Diversification, Risk Profile and Horizon (Report details).
 *  allocatePortfolio({ amount, rows }) → exact per-fund amounts + validation issues.
 *  buildSnapshot(portfolio, fundData) → every number on the one-pager factsheet.
 *  buildFundData({ portfolio, schemeMap, histories }) → fund and portfolio returns / risk from NAV history.
 *  navSeries / trailingReturn / riskMetrics → the E1 / E2 / E12 building blocks.
 *  getFundData(portfolio) → null (kept for callers without NAV history).
 */

import { extractStructuredText } from "./cas/extract-text.js";
import { CAS_FORMAT, detectFormat } from "./cas/detect-format.js";
import { parseCamsKfintech } from "./cas/parse-cams-kfintech.js";
import { parseNsdlCdsl } from "./cas/parse-nsdl-cdsl.js";
import { normalizePortfolio } from "./cas/normalize.js";
import { validatePortfolio } from "./cas/validate.js";
import { CasError, CAS_ERROR } from "./errors.js";

export { CasError, CAS_ERROR } from "./errors.js";
export { probePdf } from "./cas/extract-text.js";
export { CAS_FORMAT } from "./cas/detect-format.js";
export { FLAG } from "./cas/validate.js";
export { isValidIsin } from "./identity/isin.js";
export { buildSchemeMap, mapHoldings, SchemeMapError, UNMATCHED_REASON } from "./identity/scheme-map.js";
export { revalueAtLatestNav, VALUATION_REASON, VALUATION_SOURCE } from "./portfolio-analyzer/revalue.js";
export { holdingGain, summarizePortfolio } from "./portfolio-analyzer/summary.js";
export { holdingKey } from "./model/portfolio.schema.js";
export { VERDICT, VERDICTS, excessReturn, summarizeRecommendations } from "./portfolio-analyzer/recommendation.js";
export {
  buildReportProfile, diversificationStatus, DIVERSIFICATION_STATUS, HORIZON_LABELS, RISK_PROFILE_LABELS,
} from "./portfolio-analyzer/report-profile.js";
export { categoryFromText, classifyFund, FUND_CATEGORY } from "./portfolio-analyzer/fund-category.js";
export { RULE_METRICS, RULE_OPERATORS, fundMetrics, suggestVerdicts, validateRules } from "./portfolio-analyzer/recommendation-rules.js";
export { autoRecommend, gradeFund, engineOf, creditQuality, elssLock, sectorCheck, isSectorPassive, fundOverlap } from "./portfolio-analyzer/auto-recommendation.js";
export { allocatePortfolio, percentToBps } from "./portfolio-analyzer/recommended-portfolio.js";
export { buildSnapshot } from "./portfolio-analyzer/snapshot.js";
export { buildDetailedReport, ASSET_GROUPS } from "./portfolio-analyzer/detailed-report.js";
export { getFundData } from "./market/fund-data-provider.js";
export { navSeries, trailingReturn, xirr } from "./analytics/returns.js";
export { riskMetrics } from "./analytics/risk.js";
export { assetGroup, buildFundData, fundInfo } from "./portfolio-analyzer/portfolio-performance.js";
export { holdingCashflows, portfolioXirr, XIRR_EXCLUSION } from "./portfolio-analyzer/xirr.js";
export { returnNotes } from "./portfolio-analyzer/return-notes.js";
export { buildAllocation, normalisedHoldings, withAllocation, WEIGHT_TOLERANCE } from "./portfolio-analyzer/allocation.js";

export async function analyzeCasPdf({ data, password, fileName, pdfjs }) {
  const doc = await extractStructuredText({ data, password, pdfjs });
  return parseCasDocument(doc, fileName);
}

export function parseCasDocument(doc, fileName) {
  const format = detectFormat(doc);
  let draft;
  if (format === CAS_FORMAT.CAMS_KFINTECH) {
    draft = parseCamsKfintech(doc, fileName);
  } else if (format === CAS_FORMAT.NSDL || format === CAS_FORMAT.CDSL) {
    draft = parseNsdlCdsl(doc, format, fileName);
  } else {
    throw new CasError(
      CAS_ERROR.UNSUPPORTED_FORMAT,
      "This file is not a supported CAS. Please upload a CAMS/KFintech or NSDL/CDSL Consolidated Account Statement."
    );
  }
  return validatePortfolio(normalizePortfolio(draft));
}
