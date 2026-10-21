/**
 * Portfolio Analyzer — workflow controller (Project_Specification_TEMP.md §4). Wires the Calculation Engine
 * to the Design System; holds no math and no styling.
 *
 * mountPortfolioAnalyzer(container) → { showUpload(), openPortfolio(portfolio, step), openSnapshot(portfolio), goTo(step) }
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
  analyzeCasPdf, probePdf, allocatePortfolio, buildDetailedReport, buildSnapshot, CAS_ERROR, getFundData, holdingGain, summarizePortfolio, summarizeRecommendations,
  suggestVerdicts, buildReportProfile,
} from "../../calculation-engine/index.js";
import { RECOMMENDATION_RULES } from "./recommendation-rules.js";
import { ChoiceDialog } from "../../design-system/components/choice-dialog.js";
import { AlertDialog } from "../../design-system/components/alert-dialog.js";
import { statementProblems } from "./copy.js";
import { createSnapshotScreen } from "./screens/snapshot-screen.js";
import { ActionBar, Stepper } from "../../design-system/components/workflow.js";
import { createUploadScreen } from "./screens/upload-screen.js";
import { createReviewScreen } from "./screens/review-screen.js";
import { createRecommendationScreen } from "./screens/recommendation-screen.js";
import { createBuilderScreen } from "./screens/builder-screen.js";
import { createFinalScreen } from "./screens/final-screen.js";
import { clearSavedClientData, openClientStore } from "./client-store.js";

pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";

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

        screen.setStatus("Statement read successfully. Choose the report to prepare.", "info");
        const report = await reportDialog.choose();
        if (!report) {
          screen.setStatus("Statement read. Press Analyse to choose a report.", "info");
          return;
        }
        if (report === REPORT.SNAPSHOT) await openSnapshot(portfolio);
        else await openPortfolio(portfolio, 1);
      },
    });
    view.replaceChildren(screen.element);
    window.scrollTo(0, 0);
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

  // ---------- One-Pager Snapshot ----------
  /** options.fundData / options.settings exist for tests and previews only. */
  async function openSnapshot(portfolio, options = {}) {
    const fundData = options.fundData ?? await getFundData(portfolio);
    session = { portfolio, summary: summarizePortfolio(portfolio), store: openClientStore(portfolio), profile: buildReportProfile(portfolio, fundData) };
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
    view.replaceChildren(snapshotScreen.element, actionBar.element);
    actionBar.update({
      backLabel: "Upload another statement", onBack: showUpload,
      nextLabel: "Download one-pager (PDF)", nextIcon: "download", onNext: () => snapshotScreen.download(),
    });
    window.scrollTo(0, 0);
    return session.store;
  }

  // ---------- steps 1–4 ----------
  /** options.fundData exists for tests and previews only. */
  async function openPortfolio(portfolio, step = 1, options = {}) {
    const fundData = options.fundData ?? await getFundData(portfolio);
    session = { portfolio, fundData, summary: summarizePortfolio(portfolio), store: openClientStore(portfolio), profile: buildReportProfile(portfolio, fundData) };
    applySuggestedVerdicts(session);
    goTo(step);
    return session.store;
  }

  /** Pre-select Invest / Hold / Sell from the Prosperr conditions; the advisor can change any fund. */
  function applySuggestedVerdicts({ portfolio, fundData, store }) {
    const suggestions = suggestVerdicts({ portfolio, fundData, rules: RECOMMENDATION_RULES });
    store.state.suggestions = suggestions;
    for (const [key, suggestion] of Object.entries(suggestions)) {
      store.state.verdicts[key] ??= suggestion.verdict;
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
      screen = createReviewScreen({ portfolio, summary, holdingGain, store, onChange });
    } else if (current === 2) {
      screen = createRecommendationScreen({ portfolio, fundData: session.fundData, store, holdingGain, summarize: (verdicts) => summarizeRecommendations(portfolio, verdicts), onChange });
    } else if (current === 3) {
      screen = createBuilderScreen({ portfolio, summary, store, recommendation: recommendationOf(), allocate: allocatePortfolio, onChange });
    } else {
      const recommendation = recommendationOf();
      const allocation = allocationOf();
      // Only a complete portfolio goes into the report; otherwise the step was skipped.
      const included = allocation.complete;
      finalScreen = createFinalScreen({
        model: buildDetailedReport({ portfolio, fundData: session.fundData, verdicts: store.state.verdicts, allocation: included ? allocation : null }),
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
    view.replaceChildren(stepper, screen, actionBar.element);
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

  return { showUpload, openPortfolio, openSnapshot, goTo };
}
