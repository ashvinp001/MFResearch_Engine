/**
 * Portfolio Analyzer — workflow controller (Project_Specification_TEMP.md §4). Wires the Calculation Engine
 * to the Design System; holds no math and no styling.
 *
 * mountPortfolioAnalyzer(container) → { showUpload(), openPortfolio(portfolio, step), openSnapshot(portfolio), goTo(step),
 *                                       withLatestNav(portfolio) }
 * The site shell (header / footer) is owned by the router, not by this feature.
 *
 * After "Analyse", the advisor chooses the report:
 *  · One-Pager Snapshot → overview + infographics + downloadable factsheet (one page)
 *  · Detailed Recommendation Report →
 *    0 Upload → 1 Portfolio review → 2 Recommendation → 3 Recommended portfolio → 4 Final review & download
 *
 * A step is reachable only when the steps before it are complete, so the final
 * report can never be produced from unfinished choices. The recommended portfolio
 * (step 3) is optional: the advisor may skip it, and the report then leaves out
 * "The Way Forward". A complete portfolio is always included.
 */

import * as pdfjs from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs";
import {
  analyzeCasPdf, probePdf, allocatePortfolio, buildDetailedReport, buildFundData, buildSnapshot, CAS_ERROR, fundInfo, holdingGain, summarizePortfolio, summarizeRecommendations,
  suggestVerdicts, autoRecommend, buildReportProfile, revalueAtLatestNav, returnNotes, buildAllocation, withAllocation,
} from "../../calculation-engine/index.js";
import { loadBenchmarkHistories, loadFundHoldings, loadNavHistories, loadPeerStats, loadValuationData } from "../shared/market-data.js";
import { searchSchemes } from "../shared/scheme-search.js";
import { RECOMMENDATION_RULES } from "./recommendation-rules.js";
import { ChoiceDialog } from "../../design-system/components/choice-dialog.js";
import { AlertDialog } from "../../design-system/components/alert-dialog.js";
import { statementProblems } from "./copy.js";
import { createSnapshotScreen } from "./screens/snapshot-screen.js";
import { ActionBar, Stepper } from "../../design-system/components/workflow.js";
import { h } from "../../design-system/components/dom.js";
import { Icon } from "../../design-system/components/icons.js";
import { createUploadScreen } from "./screens/upload-screen.js";
import { createReviewScreen } from "./screens/review-screen.js";
import { createRecommendationScreen } from "./screens/recommendation-screen.js";
import { createBuilderScreen } from "./screens/builder-screen.js";
import { createFinalScreen } from "./screens/final-screen.js";
import { clearSavedClientData, openClientStore } from "./client-store.js";

pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";

const MARKET_INDEX = "OB56";   // NIFTY 500 (PulseDB code) — the portfolio's benchmark when the funds' own ones cover < 80%
const STEPS = ["Upload", "Portfolio review", "Recommendation", "Recommended portfolio", "Final review"];

export const REPORT = Object.freeze({ SNAPSHOT: "snapshot", DETAILED: "detailed" });

const REPORT_OPTIONS = [
  {
    id: REPORT.SNAPSHOT,
    title: "One-Pager Snapshot Report",
    text: "A single-page portfolio factsheet for a quick client conversation.",
    icon: "file",
    accent: "var(--navy)",
    points: ["Overview and holdings performance", "Composition, sectors, market cap, AMC allocation", "Returns vs benchmark, risk analysis, observations", "Download as a one-page PDF"],
  },
  {
    id: REPORT.DETAILED,
    title: "Detailed Recommendation Report",
    text: "Step-by-step review with Prosperr recommendations and a recommended portfolio.",
    icon: "layers",
    accent: "var(--blue)",
    points: ["Full portfolio review", "Invest / Hold / Sell for every fund", "Build the recommended portfolio", "Cross-verify and download the detailed report"],
  },
];

export function mountPortfolioAnalyzer(container) {
  // Every load starts fresh: no client data from an earlier session survives.
  clearSavedClientData();
  const view = document.createElement("div");
  const reportDialog = ChoiceDialog({
    eyebrow: "Choose report",
    title: "Which report would you like to prepare?",
    text: "Both are built from the same verified CAS data.",
    options: REPORT_OPTIONS,
  });
  const issuesDialog = AlertDialog({
    tone: "warning",
    eyebrow: "Statement check",
    note: "You can continue: flagged figures are marked in the review, and you confirm them before downloading a report.",
    primary: { label: "Continue to the review", icon: "arrowRight" },
    secondary: { label: "Choose another file", icon: "upload" },
  });
  container.replaceChildren(view, reportDialog.element, issuesDialog.element);

  const actionBar = ActionBar();
  let session = null; // { portfolio, summary, store }
  let current = 0;
  let finalScreen = null;
  let snapshotScreen = null;
  let analyzing = false;

  // ---------- derived state (engine) ----------
  const recommendationOf = () => summarizeRecommendations(session.portfolio, session.store.state.verdicts);
  const allocationOf = () => allocatePortfolio({ amount: session.store.state.recommended.amount, rows: session.store.state.recommended.rows });
  const portfolioSkipped = () => Boolean(session.store.state.recommended.skipped);

  function reachableStep() {
    if (!session) return 0;
    if (!recommendationOf().complete) return 2;
    if (!allocationOf().complete && !portfolioSkipped()) return 3;
    return 4;
  }

  function skipPortfolio() {
    session.store.state.recommended.skipped = true;
    goTo(4);
  }

  // ---------- step 0: upload ----------
  function showUpload() {
    session = null;
    current = 0;
    snapshotScreen = null;
    const screen = createUploadScreen({
      // Is the file password-protected? Asked as soon as a file is chosen.
      async onFileSelected(file) {
        return probePdf({ data: await file.arrayBuffer(), pdfjs });
      },
      // Read the statement first (password already entered); only then ask which report to build.
      async onAnalyze({ file, password }) {
        if (analyzing) return; // one run at a time: a second click never starts a duplicate
        analyzing = true;
        try {
          await analyze(screen, file, password);
        } finally {
          analyzing = false;
        }
      },
    });
    view.replaceChildren(screen.element);
    window.scrollTo(0, 0);
  }

  /** Read → check → latest NAV → (fund data loading in the background) → choose report → open it. */
  async function analyze(screen, file, password) {
    screen.setBusy(true);
    screen.setStatus("Reading the statement…", "info");
    let portfolio;
    try {
      portfolio = await analyzeCasPdf({ data: await file.arrayBuffer(), password, fileName: file.name, pdfjs });
    } catch (error) {
      handleError(screen, error);
      screen.setBusy(false);
      return;
    }
    screen.setBusy(false);

    // Anything that does not add up is explained BEFORE the advisor continues.
    if (portfolio.integrity.status !== "ok") {
      const problems = statementProblems(portfolio);
      const choice = await issuesDialog.open({
        title: `${problems.length} thing${problems.length > 1 ? "s" : ""} in this statement need${problems.length > 1 ? "" : "s"} checking`,
        text: "Every figure is shown exactly as printed, but the checks below did not add up. Compare them with the client's PDF before sharing any report.",
        items: problems,
      });
      if (choice !== "primary") {
        screen.setStatus("Statement read with problems — see the list. Choose another file, or press Analyse to continue.", "negative");
        return;
      }
    }

    // Current value at the latest NAV (after the statement checks, which compare the printed figures).
    screen.setBusy(true);
    screen.setStatus("Statement read. Fetching the latest NAVs…", "info");
    portfolio = await withLatestNav(portfolio);

    // Returns, risk and holdings start loading NOW, while the advisor picks the report.
    const fundDataReady = fundDataFor(portfolio).catch(() => null);
    screen.setStatus("Statement read successfully. Choose the report to prepare.", "info");
    const report = await reportDialog.choose();
    if (!report) {
      screen.setBusy(false);
      screen.setStatus("Statement read. Press Analyse to choose a report.", "info");
      return;
    }
    screen.setStatus("Preparing the report — returns, risk and fund holdings…", "info");
    const fundData = await fundDataReady;
    if (report === REPORT.SNAPSHOT) await openSnapshot(portfolio, { fundData });
    else await openPortfolio(portfolio, 1, { fundData });
  }

  function handleError(screen, error) {
    if (error?.code === CAS_ERROR.PASSWORD_REQUIRED || error?.code === CAS_ERROR.PASSWORD_INCORRECT) {
      screen.showPasswordField();
      screen.setStatus(error.message, error.code === CAS_ERROR.PASSWORD_INCORRECT ? "negative" : "info");
      return;
    }
    if (error?.code) {
      screen.setStatus(error.message, "negative");
      return;
    }
    console.error(error);
    screen.setStatus("Something went wrong while reading this statement. Please try again, or try a different CAS file.", "negative");
  }

  /**
   * Returns for Recommended Portfolio funds that are not in the client's CAS (picked from the AMFI
   * search or a model basket): fetched once, then the final screen is redrawn with them.
   */
  function loadRecommendedFundData(rows) {
    const known = session.fundData?.funds ?? {};
    const wanted = rows.map((row) => row.isin).filter((isin) => isin && !known[isin] && !session.pendingIsins?.has(isin));
    if (!wanted.length) return;
    session.pendingIsins = new Set([...(session.pendingIsins ?? []), ...wanted]);
    const mine = session;
    (async () => {
      const market = await loadValuationData();
      if (market.error) return;
      const schemes = wanted.map((isin) => [isin, market.schemeMap.byIsin(isin)]).filter(([, scheme]) => scheme);
      const codes = schemes.map(([, scheme]) => scheme.schemeCode);
      const [navs, peerStats] = await Promise.all([loadNavHistories(codes), loadPeerStats(codes)]);
      if (navs.error || session !== mine) return;
      const { benchmarks } = await benchmarksFor(codes, peerStats);
      if (session !== mine) return;
      session.fundData ??= { funds: {} };
      session.fundData.funds ??= {};
      for (const [isin, scheme] of schemes) {
        const series = navs.histories[scheme.schemeCode];
        if (series?.dates.length) session.fundData.funds[isin] = fundInfo(scheme, series, scheme.schemeName, benchmarks[scheme.schemeCode] ?? null);
      }
      if (current === 4) goTo(4);
    })();
  }

  /** Fund search for the Recommended Portfolio (the whole AMFI universe). */
  async function searchFunds(query) {
    const market = await loadValuationData();
    return market.error ? [] : searchSchemes(market.schemes, query);
  }

  /** Current value at the latest NAV (after the statement checks, which compare the printed figures). */
  async function withLatestNav(portfolio) {
    const market = await loadValuationData();
    return market.error
      ? { ...portfolio, valuation: { asOf: null, latest: 0, statement: null, unavailable: market.error, reasons: [] } }
      : revalueAtLatestNav(portfolio, market).portfolio;
  }

  /**
   * Fund and portfolio returns / risk from NAV history (calculation engine). Shows a short status
   * while loading; returns null when the NAV store is unreachable (reports then show "—").
   */
  async function fundDataFor(portfolio) {
    const market = await loadValuationData();
    if (market.error) return null;
    const schemes = {};
    for (const holding of portfolio.holdings) {
      const scheme = holding.status === "active" && holding.isin ? market.schemeMap.byIsin(holding.isin) : null;
      if (scheme) schemes[holding.isin] = scheme;
    }
    const codes = Object.values(schemes).map((scheme) => scheme.schemeCode);
    // NAV history (returns / risk), holdings (Portfolio Allocation, PulseDB) and peer statistics
    // (automatic Invest / Hold / Sell) are requested together.
    const [navs, holdings, peerStats] = await Promise.all([
      loadNavHistories(codes),
      loadFundHoldings(portfolio.holdings.filter((h) => h.status === "active").map((h) => h.isin).filter(Boolean)),
      loadPeerStats(codes),
    ]);
    if (navs.error) return null;
    const { benchmarks, market: marketIndex } = await benchmarksFor(Object.values(schemes).map((s) => s.schemeCode), peerStats);
    const fundData = buildFundData({ portfolio, schemeMap: market.schemeMap, histories: navs.histories, benchmarks, market: marketIndex });
    const withHoldings = holdings ? withAllocation(fundData, buildAllocation({ portfolio, fundHoldings: holdings })) : fundData;
    return { ...withHoldings, autoInputs: { schemes, peerStats, fundHoldings: holdings } };
  }

  /**
   * Each fund's own verified benchmark (code from the peer statistics' mapping) with its price history, and the
   * broad market (NIFTY 500) → { benchmarks: { [schemeCode]: { code, name, series } }, market: { code, name, series } | null }.
   * Empty when the benchmark data is unreachable (reports show "—").
   */
  async function benchmarksFor(schemeCodes, peerStats) {
    const byScheme = {};
    for (const code of schemeCodes) {
      const bm = peerStats?.funds?.[String(code)]?.benchmark;
      if (bm?.code) byScheme[code] = bm;
    }
    const histories = await loadBenchmarkHistories([...Object.values(byScheme).map((bm) => bm.code), MARKET_INDEX]);
    const benchmarks = {};
    for (const [code, bm] of Object.entries(byScheme)) {
      const h = histories?.[bm.code];
      if (h?.series?.dates.length) benchmarks[code] = { code: bm.code, name: bm.name ?? h.name ?? bm.code, series: h.series };
    }
    const m = histories?.[MARKET_INDEX];
    return { benchmarks, market: m?.series?.dates.length ? { code: MARKET_INDEX, name: m.name ?? "NIFTY 500 Index", series: m.series } : null };
  }

  // ---------- One-Pager Snapshot ----------
  /**
   * options.fundData: already prepared (upload flow, tests, previews); options.settings: previews only;
   * options.store: the client's choices so far (switching from the Detailed report keeps them).
   */
  async function openSnapshot(portfolio, options = {}) {
    const fundData = "fundData" in options ? options.fundData : await fundDataFor(portfolio);
    session = { portfolio, fundData, summary: summarizePortfolio(portfolio), store: options.store ?? openClientStore(portfolio),
      profile: buildReportProfile(portfolio, fundData), lastStep: options.lastStep ?? null };
    if (options.settings) session.store.state.snapshot = { ...options.settings };
    current = -1;
    finalScreen = null;
    snapshotScreen = createSnapshotScreen({
      portfolio,
      summary: session.summary,
      snapshot: buildSnapshot(portfolio, fundData),
      profile: session.profile,
      store: session.store,
    });
    view.replaceChildren(reportSwitch("snapshot"), snapshotScreen.element, actionBar.element);
    actionBar.update({
      backLabel: "Upload another statement", onBack: showUpload,
      nextLabel: "Download one-pager (PDF)", nextIcon: "download", onNext: () => snapshotScreen.download(),
    });
    window.scrollTo(0, 0);
    return session.store;
  }

  // ---------- steps 1–4 ----------
  /**
   * options.fundData: already prepared by the upload flow (or tests / previews); options.store: the client's choices
   * so far (switching from the One-Pager keeps them — a verdict already set is never overwritten).
   */
  async function openPortfolio(portfolio, step = 1, options = {}) {
    const fundData = "fundData" in options ? options.fundData : await fundDataFor(portfolio);
    session = { portfolio, fundData, summary: summarizePortfolio(portfolio), store: options.store ?? openClientStore(portfolio), profile: buildReportProfile(portfolio, fundData) };
    applySuggestedVerdicts(session);
    goTo(step);
    return session.store;
  }

  // ---------- switching report: One-Pager <-> Detailed report ----------
  // Same statement, same fund data, same choices: nothing is read or calculated again, nothing is reset.
  function switchToDetailed() {
    if (!session) return;
    openPortfolio(session.portfolio, session.lastStep ?? 1, { fundData: session.fundData ?? null, store: session.store });
  }
  function switchToSnapshot() {
    if (!session) return;
    openSnapshot(session.portfolio, { fundData: session.fundData ?? null, store: session.store, lastStep: current > 0 ? current : null });
  }
  /** "One-Pager | Detailed report" switch shown above both reports. */
  function reportSwitch(active) {
    const option = (id, label, icon, onClick) => h("button", { type: "button", class: "wf-report-opt", "aria-pressed": String(active === id),
      onclick: () => { if (active !== id) onClick(); } }, Icon(icon, { size: 15 }), label);
    return h("div", { class: "wf-report-switch" },
      h("div", { class: "wf-report-inner" },
        h("span", { class: "wf-report-label" }, "Report"),
        h("div", { class: "wf-report-toggle", role: "group", "aria-label": "Report type" },
          option("snapshot", "One-Pager", "file", switchToSnapshot),
          option("detailed", "Detailed report", "layers", switchToDetailed))));
  }

  /**
   * Pre-select Invest / Hold / Sell from the Prosperr logic (Recommendation_Logic.md); the advisor can change
   * any fund. A REVIEW fund is not pre-selected. Without peer statistics nothing is pre-selected by the logic.
   */
  function applySuggestedVerdicts({ portfolio, fundData, store }) {
    const auto = fundData?.autoInputs ? autoRecommend({ portfolio, ...fundData.autoInputs }) : null;
    const suggestions = auto?.suggestions ?? suggestVerdicts({ portfolio, fundData, rules: RECOMMENDATION_RULES });
    store.state.suggestions = suggestions;
    store.state.autoLogic = auto ? { version: auto.version, asOf: auto.asOf, flags: auto.flags } : null;
    for (const [key, suggestion] of Object.entries(suggestions)) {
      if (suggestion.verdict) store.state.verdicts[key] ??= suggestion.verdict;
    }
  }

  function goTo(step) {
    if (!session) return showUpload();
    current = Math.min(step, reachableStep());
    finalScreen = null;

    const { portfolio, summary, store } = session;
    const onChange = () => updateChrome();
    let screen;

    if (current === 1) {
      screen = createReviewScreen({ portfolio, summary, holdingGain, store, onChange, fundData: session.fundData });
    } else if (current === 2) {
      screen = createRecommendationScreen({ portfolio, fundData: session.fundData, store, holdingGain, summarize: (verdicts) => summarizeRecommendations(portfolio, verdicts), onChange });
    } else if (current === 3) {
      screen = createBuilderScreen({ portfolio, summary, store, recommendation: recommendationOf(), allocate: allocatePortfolio, onChange, searchFunds });
    } else {
      const recommendation = recommendationOf();
      const allocation = allocationOf();
      // Only a complete portfolio goes into the report; otherwise the step was skipped.
      const included = allocation.complete;
      if (included) loadRecommendedFundData(store.state.recommended.rows);
      finalScreen = createFinalScreen({
        model: buildDetailedReport({ portfolio, fundData: session.fundData, verdicts: store.state.verdicts, allocation: included ? { ...allocation, mode: store.state.recommended.mode === "sip" ? "sip" : "lumpsum" } : null,
          suggestions: store.state.autoLogic?.flags ?? [], calls: store.state.suggestions ?? {},
          fundHoldings: session.fundData?.autoInputs?.fundHoldings ?? null }),
        notes: returnNotes(portfolio, session.fundData),
        portfolio,
        recommendation,
        allocation,
        skipped: !included,
        profile: session.profile,
        store,
        onGoTo: goTo,
        onChange,
      });
      screen = finalScreen.element;
    }

    const stepper = document.createElement("div");
    stepper.className = "wf-stepper-slot";
    view.replaceChildren(reportSwitch("detailed"), stepper, screen, actionBar.element);
    updateChrome();
    window.scrollTo(0, 0);
  }

  /** Refresh the stepper and the Back / Next bar after any change. */
  function updateChrome() {
    const reachable = reachableStep();
    view.querySelector(".wf-stepper-slot")?.replaceChildren(
      Stepper({ steps: STEPS, current, reachable, onSelect: (index) => (index === 0 ? showUpload() : goTo(index)) }));

    if (current === 1) {
      actionBar.update({ backLabel: "Upload another statement", onBack: showUpload, nextLabel: "Set recommendations", onNext: () => goTo(2), message: "Review the client's portfolio, then continue." });
    } else if (current === 2) {
      const recommendation = recommendationOf();
      actionBar.update({
        backLabel: "Portfolio review", onBack: () => goTo(1),
        nextLabel: "Build recommended portfolio", onNext: () => goTo(3), nextEnabled: recommendation.complete,
        message: recommendation.complete ? "Every fund has a recommendation." : `${recommendation.unset.length} fund(s) still need Invest, Hold or Sell.`,
        tone: recommendation.complete ? "positive" : "warning",
      });
    } else if (current === 3) {
      const allocation = allocationOf();
      actionBar.update(allocation.complete
        ? {
            backLabel: "Recommendation", onBack: () => goTo(2),
            nextLabel: "Final review", onNext: () => goTo(4),
            message: "Portfolio complete — 100% allocated.", tone: "positive",
          }
        : {
            backLabel: "Recommendation", onBack: () => goTo(2),
            nextLabel: "Skip this step", nextIcon: "arrowRight", onNext: skipPortfolio,
            message: "Portfolio not complete yet — finish it, or skip this step to leave it out of the report.",
            tone: "warning",
          });
    } else if (current === 4 && finalScreen) {
      const ready = finalScreen.canDownload();
      actionBar.update({
        backLabel: "Recommended portfolio", onBack: () => goTo(3),
        nextLabel: "Download report (PDF)", nextIcon: "download", onNext: () => finalScreen.download(), nextEnabled: ready,
        message: ready ? "All checks passed — ready to download." : "Complete the cross-verification checklist to download.",
        tone: ready ? "positive" : "warning",
      });
    }
  }

  return { showUpload, openPortfolio, openSnapshot, goTo, withLatestNav };
}
