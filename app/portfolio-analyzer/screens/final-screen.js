/**
 * Step 5 — Final review: a clear summary of the report (sections, key facts,
 * readiness), the report details the advisor sets, and a cross-verification
 * checklist that must pass before download. The download is the replica of
 * "Portfolio Review & Recommendation" (US Letter), saved via the browser's PDF.
 *
 * Input:  { model (engine buildDetailedReport), portfolio, recommendation, allocation,
 *           skipped (true when the recommended portfolio step was skipped),
 *           profile (engine buildReportProfile — pre-fills the report details), store, onGoTo(step), onChange() }
 * Output: { element, canDownload(), download() }
 */

import { h } from "../../../design-system/components/dom.js";
import { Icon } from "../../../design-system/components/icons.js";
import { Logo } from "../../../design-system/components/basics.js";
import { clientDisplayName } from "../copy.js";
import { formatInr, todayIso } from "../../shared/format.js";
import { pageBand } from "../../shared/page-band.js";
import { printElement } from "../../shared/print.js";
import { renderDetailedReport } from "../reports/detailed-report.js";
import { autoDetails, autoNote } from "../report-profile-notes.js";
import { signedPct, signedWhole } from "../reports/snapshot-format.js";

export const STEP = { REVIEW: 1, RECOMMENDATION: 2, BUILDER: 3 };

export function createFinalScreen({ model, portfolio, recommendation, allocation, skipped = false, profile = null, store, onGoTo, onChange, notes = [] }) {
  // Report details come from the Prosperr logic (engine buildReportProfile) and are locked: nobody can change them.
  // Where the logic cannot decide, the report shows "—".
  const details = store.state.reportDetails = { ...autoDetails(profile) };
  let reviewed = false;
  let busy = false;

  const checks = [
    {
      title: "Statement figures verified",
      ok: () => portfolio.integrity.status === "ok" || store.state.acknowledged,
      detail: portfolio.integrity.status === "ok"
        ? "All values match the statement's printed totals."
        : "Some figures need review. Confirm you checked them against the client's PDF.",
      confirm: portfolio.integrity.status === "ok" ? null : {
        label: "I have checked the flagged figures against the client's PDF",
        get: () => store.state.acknowledged,
        set: (value) => { store.state.acknowledged = value; },
      },
    },
    {
      title: "Client name and salutation",
      ok: () => Boolean(store.state.salutation),
      detail: store.state.salutation ? clientDisplayName(store.state.salutation, portfolio.investor.name) : "Select Mr. / Ms. on the Portfolio review step.",
      fix: store.state.salutation ? null : { label: "Set salutation", step: STEP.REVIEW },
    },
    {
      title: "Recommendation for every fund",
      ok: () => recommendation.complete,
      detail: recommendation.complete
        ? `All ${recommendation.byVerdict.invest.count + recommendation.byVerdict.hold.count + recommendation.byVerdict.sell.count} funds have Invest, Hold or Sell.`
        : `${recommendation.unset.length} fund(s) still need a recommendation.`,
      fix: recommendation.complete ? null : { label: "Set recommendations", step: STEP.RECOMMENDATION },
    },
    ...(skipped
      ? [{
          title: "Recommended portfolio skipped",
          ok: () => true,
          detail: "The report will not include The Way Forward (Prosperr Recommended Portfolio).",
          fix: { label: "Add a recommended portfolio", step: STEP.BUILDER },
        }]
      : [
          {
            title: "Recommended portfolio totals 100%",
            ok: () => allocation.complete,
            detail: allocation.complete
              ? `${formatInr(allocation.amount)} fully allocated across ${allocation.rows.length} fund(s).`
              : "Amount, funds or allocations are incomplete.",
            fix: allocation.complete ? null : { label: "Complete portfolio", step: STEP.BUILDER },
          },
          {
            title: "Allocated amounts add up exactly",
            ok: () => allocation.complete && allocation.allocatedAmount === allocation.amount,
            detail: allocation.complete
              ? `Fund amounts total ${formatInr(allocation.allocatedAmount)} — exactly the amount to invest.`
              : "Shown once the portfolio is complete.",
          },
        ]),
    {
      title: "Report reviewed",
      ok: () => reviewed,
      detail: "Go through the report details and the report summary on the left.",
      confirm: {
        label: "I have reviewed this report",
        get: () => reviewed,
        set: (value) => { reviewed = value; },
      },
    },
  ];

  const list = h("ul", { class: "fin-checks" });
  const downloadButton = h("button", { type: "button", class: "ds-btn ds-btn-primary fin-download" }, Icon("download", { size: 18 }), "Download detailed report (PDF)");
  downloadButton.addEventListener("click", () => download());

  function render() {
    list.replaceChildren(...checks.map((check) => {
      const ok = check.ok();
      return h("li", { class: ok ? "is-ok" : "is-todo" },
        h("span", { class: "fin-check-icon" }, Icon(ok ? "checkCircle" : "alert", { size: 20 })),
        h("div", {},
          h("strong", {}, check.title),
          h("p", {}, check.detail),
          check.confirm ? confirmBox(check.confirm) : null,
          check.fix ? h("button", { type: "button", class: "fin-fix", onclick: () => onGoTo(check.fix.step) }, check.fix.label, Icon("arrowRight", { size: 14 })) : null));
    }));
    downloadButton.disabled = busy || !canDownload();
    onChange?.();
  }

  function confirmBox(confirm) {
    const enabled = confirm.enabled ? confirm.enabled() : true;
    const input = h("input", { type: "checkbox", disabled: !enabled });
    input.checked = enabled && confirm.get();
    input.addEventListener("change", () => { confirm.set(input.checked); render(); });
    return h("div", {},
      h("label", { class: `fin-confirm ${enabled ? "" : "is-locked"}`.trim() }, input, h("span", {}, confirm.label)),
      enabled || !confirm.lockedHint ? null : h("p", { class: "fin-locked-hint" }, Icon("lock", { size: 12 }), ` ${confirm.lockedHint}`));
  }

  function canDownload() {
    return checks.every((check) => check.ok());
  }

  async function download() {
    if (!canDownload() || busy) return;
    busy = true;
    render();
    try {
      const clientName = portfolio.investor.name ?? "Client";
      const reportDate = todayIso();
      const doc = await renderDetailedReport({ model, clientName, settings: details, reportDate });
      printElement(doc, `${clientName} - Portfolio Review & Recommendation - ${reportDate}`);
    } finally {
      busy = false;
      render();
    }
  }

  // ---------- document preview popup ----------
  const previewBody = h("div", { class: "fin-doc-body" });
  const previewDialog = h("dialog", { class: "fin-doc-dialog", "aria-label": "Report preview" },
    h("div", { class: "fin-doc-head" },
      h("div", {}, h("div", { class: "ds-eyebrow" }, "Preview"), h("h2", {}, "Portfolio Review & Recommendation"),
        h("p", {}, "Exactly what will be downloaded. Scroll through every page to cross-check.")),
      h("button", { type: "button", class: "app-icon-btn", "aria-label": "Close preview", onclick: () => previewDialog.close() }, Icon("x", { size: 20 }))),
    previewBody);
  previewDialog.addEventListener("click", (event) => { if (event.target === previewDialog) previewDialog.close(); });

  async function openPreview() {
    previewBody.replaceChildren(h("p", { class: "fin-doc-loading" }, "Preparing the preview…"));
    previewDialog.showModal();
    const doc = await renderDetailedReport({ model, clientName: portfolio.investor.name ?? "Client", settings: details, reportDate: todayIso() });
    previewBody.replaceChildren(doc);
    previewBody.scrollTop = 0;
  }

  render();

  const element = h("main", { class: "app-step-page" },
    pageBand({
      eyebrow: "Step 5 · Final review",
      title: "Cross-verify and download the report",
      text: "Check what goes into each section and the report details, complete the checklist, then download the Portfolio Review & Recommendation as a PDF.",
    }),
    h("div", { class: "app-container app-step-body fin-layout" },
      h("div", { class: "fin-main" },
        coverCard(model, portfolio, () => openPreview()),
        detailsCard(details, profile),
        h("div", { class: "fin-sections" }, sectionCards(model, recommendation).map((card, i) => sectionCard(card, i))),
        notesCard(notes, profile?.risk?.others ?? [])),
      h("aside", { class: "fin-side" },
        h("div", { class: "fin-card" },
          h("div", { class: "ds-eyebrow" }, "Before you download"),
          h("h2", {}, "Cross-verification"),
          list,
          downloadButton,
          h("p", { class: "fin-hint" }, Icon("info", { size: 14 }), " In the print window, choose “Save as PDF” as the destination.")))),
    previewDialog
  );

  return { element, canDownload, download };
}

// ---------- notes ----------
/** Why some funds show "—" for every time frame (engine returnNotes); hidden when there is nothing to explain. */
function notesCard(notes, others = []) {
  if (!notes.length && !others.length) return null;
  const item = (name, text) => h("li", {}, h("strong", {}, name), h("span", {}, text));
  return h("section", { class: "fin-notes" },
    h("div", { class: "fin-notes-head" }, Icon("info", { size: 18 }),
      h("div", {}, h("div", { class: "ds-eyebrow" }, "Note"), h("h2", {}, "Before you share the report"))),
    others.length ? [
      h("p", { class: "fin-notes-intro" }, `${others.length} fund${others.length > 1 ? "s are" : " is"} counted in the number of funds but not in the Risk profile or Horizon:`),
      h("ul", {}, others.map((o) => item(o.name, `${o.reason} (${o.sharePct.toFixed(2)}% of value).`))),
    ] : null,
    notes.length ? [
      h("p", { class: "fin-notes-intro" }, `${notes.length} fund${notes.length > 1 ? "s show" : " shows"} “—” for every return period (1Y, 3Y, 5Y). This is expected, not an error:`),
      h("ul", {}, notes.map((note) => item(note.schemeName ?? note.isin, note.reason))),
    ] : null);
}

// ---------- summary cards ----------
function coverCard(model, portfolio, onPreview) {
  const name = (portfolio.investor.name ?? "Client").toUpperCase();
  return h("section", { class: "fin-cover" },
    h("button", { type: "button", class: "fin-cover-art ds-paper", onclick: onPreview, "aria-label": "Preview the full report" },
      h("span", { class: "fin-cover-band top" }), h("span", { class: "fin-cover-band bottom" }),
      h("div", { class: "fin-cover-mini" }, Logo({ size: 18 }), h("strong", {}, "Portfolio Review"), h("strong", {}, "& Recommendation")),
      h("span", { class: "fin-cover-hover" }, Icon("search", { size: 18 }), "Preview report")),
    h("div", { class: "fin-cover-text" },
      h("div", { class: "ds-eyebrow" }, "Private & confidential"),
      h("h2", {}, "Portfolio Review & Recommendation"),
      h("p", {}, "Prepared for ", h("strong", {}, name), ` · As on ${todayIso()}`),
      h("button", { type: "button", class: "ds-btn ds-btn-sm fin-preview-btn", onclick: onPreview }, Icon("search", { size: 16 }), "Preview full report"),
      h("div", { class: "fin-cover-facts" },
        fact("Sections", String((model.recommended ? 8 : 7) - (model.overlapApplies !== false && model.overlap ? 0 : 1))),   // cover + Sections 01–06 (+ The Way Forward); no Overlap with one fund
        fact("Funds", String(model.fundCount)),
        fact("Current value", formatInr(model.totals.value, { whole: true })),
        fact("Format", "PDF · US Letter"))));
}

function fact(label, value) {
  return h("div", { class: "fin-fact" }, h("span", {}, label), h("strong", {}, value));
}

/** Report details: locked values from the logic, each with its basis. */
function detailsCard(details, profile) {
  const field = (label, key) => h("div", { class: "snp-field" },
    h("span", { class: "ds-label" }, label),
    h("div", { class: `fin-locked-field${details[key] ? "" : " is-empty"}`, "aria-readonly": "true" },
      h("span", {}, details[key] || "Not determined"), Icon("lock", { size: 14 })),
    autoNote({ profile, key, auto: details, current: () => details[key], locked: true }).element);
  return h("section", { class: "fin-details" },
    h("div", { class: "fin-details-head" }, Icon("user", { size: 18 }), h("div", {}, h("strong", {}, "Report details"),
      h("p", {}, "Shown under Client Details in Section 01. Set by the Prosperr logic from the portfolio — locked, cannot be changed."))),
    h("div", { class: "fin-details-grid" },
      field("Risk profile", "riskProfile"),
      field("Horizon", "horizon"),
      field("Diversification", "diversification")));
}

function sectionCards(model, recommendation) {
  const rec = model.recommended;
  const hasReturns = Boolean(model.portfolioReturns || model.performance.some((g) => g.rows.some((r) => r.returns)));
  const hasAllocationData = Boolean(model.composition || model.marketCap || model.sectors);
  const v = recommendation.byVerdict;
  const cards = [
    {
      code: "01", title: "Client & Portfolio Overview", icon: "user", status: "ready",
      text: "Client details, portfolio snapshot and every holding with its recommendation.",
      facts: [`${model.fundCount} funds · ${model.amcCount} AMCs`, `Invested ${formatInr(model.totals.invested, { whole: true })}`, `Value ${formatInr(model.totals.value, { whole: true })}`, `Gain ${signedWhole(model.totals.gain)} (${signedPct(model.totals.gainPct)})`],
    },
    {
      code: "02", title: "Portfolio Allocation", icon: "pie", status: hasAllocationData ? "ready" : "partial",
      text: "Market cap, asset allocation, top sectors, AMC-wise allocation and fund-wise market-cap split.",
      facts: [`AMC split across ${model.amcCount} AMCs`, hasAllocationData ? "Asset, sector & market-cap split" : "Asset, sector & market-cap split — awaiting fund data"],
    },
    {
      code: "03", title: "Fund Performance", icon: "trend", status: hasReturns ? "ready" : "pending",
      text: "1Y, 3Y and 5Y returns of every fund against its category benchmark.",
      facts: [hasReturns ? "Returns vs benchmark for each fund" : "Awaiting NAV history"],
    },
    {
      code: "04", title: "Portfolio Overlap", icon: "layers", status: model.overlap ? "ready" : "pending",
      text: "How much each pair of funds holds the same stocks (0–100%), grouped into high, moderate and low overlap with an insight for each pair.",
      facts: model.overlap
        ? [`${model.overlap.funds.length} funds compared`, ...["high", "moderate", "low"].map((b) => `${model.overlap.buckets[b].length} ${b}`)]
        : ["Awaiting fund holdings"],
    },
    {
      code: "05", title: "Returns & Risk", icon: "shield", status: hasReturns ? "ready" : "partial",
      text: "Portfolio return vs its benchmark (each fund's own index, by value), 3-year risk measures and the at-a-glance observations.",
      facts: ["Observations & change-immediately list", hasReturns ? "Returns & risk ratios" : "Returns & risk ratios — awaiting NAV history"],
    },
    {
      code: "06", title: "Conclusion & Recommendation", icon: "checkCircle", status: "ready",
      text: "The Prosperr view on each holding with commentary.",
      facts: [`Invest ${v.invest.count}`, `Hold ${v.hold.count}`, `Sell ${v.sell.count}`],
    },
    {
      code: "→", title: "The Way Forward", icon: "sparkle", status: rec?.rows.length ? "ready" : "skipped",
      text: "The Prosperr Recommended Portfolio with amounts and why each fund was chosen.",
      facts: rec ? [rec.mode === "sip" ? `Monthly SIP ${formatInr(rec.amount, { whole: true })}` : `Lumpsum ${formatInr(rec.amount, { whole: true })}`, `${rec.rows.length} funds`, `${rec.totalPct}% allocated`] : ["Skipped — not included in the report"],
    },
  ];
  // No Portfolio Overlap section (one fund, or no stock-level holdings for two funds): the sections after it move up
  // a number, exactly as in the PDF.
  if (model.overlapApplies !== false && model.overlap) return cards;
  let next = 4;
  return cards.filter((c) => c.title !== "Portfolio Overlap")
    .map((c) => (/^\d+$/.test(c.code) && Number(c.code) >= 4 ? { ...c, code: String(next++).padStart(2, "0") } : c));
}

const STATUS_TEXT = { ready: "Ready", partial: "Partly ready", pending: "Awaiting data", skipped: "Not included" };

function sectionCard(card, index) {
  return h("article", { class: `fin-section is-${card.status} site-reveal`, style: { "--i": index } },
    h("div", { class: "fin-section-head" },
      h("span", { class: "fin-section-num" }, card.code),
      h("div", {}, h("div", { class: "fin-section-eyebrow" }, card.code === "→" ? "The way forward" : `Section ${card.code}`), h("h3", {}, card.title)),
      h("span", { class: "fin-section-status" }, Icon(card.status === "ready" ? "checkCircle" : "info", { size: 14 }), STATUS_TEXT[card.status])),
    h("p", {}, card.text),
    h("div", { class: "fin-section-facts" }, card.facts.map((text) => h("span", {}, text))));
}
