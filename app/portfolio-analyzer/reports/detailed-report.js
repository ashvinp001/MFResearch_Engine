/**
 * Detailed Report — replica of "Portfolio Review & Recommendation" (US Letter).
 *
 * Input:  { model (engine buildDetailedReport), clientName, settings: { riskProfile, horizon, diversification },
 *           reportDate (ISO, the day the report is prepared — shown as "As On") }
 * Output: Promise<HTMLElement> — a .dr-doc holding every page, ready to print.
 *
 * Pages are filled by measurement: content that does not fit moves to a new
 * page of the same section (tables repeat their header), so nothing is ever cut.
 * Must run in a document with fonts loaded; uses a hidden staging area.
 */

/* One file per section in ./detailed/; shared page furniture in ./detailed/page-layout.js. */

import { h } from "../../../design-system/components/dom.js";
import { Logo } from "../../../design-system/components/basics.js";
import { DASH } from "../../shared/format.js";
import { trueSizeZoom } from "../../shared/print.js";
import { sectionOverview } from "./detailed/section-overview.js";
import { sectionAllocation } from "./detailed/section-allocation.js";
import { sectionPerformance } from "./detailed/section-performance.js";
import { sectionOverlap } from "./detailed/section-overlap.js";
import { sectionReturnsRisk } from "./detailed/section-returns-risk.js";
import { sectionConclusion } from "./detailed/section-conclusion.js";
import { wayForward } from "./detailed/section-way-forward.js";

// ---------- document ----------
export async function renderDetailedReport({ model, clientName, settings, reportDate }) {
  const asOn = reportDate ?? model.asOf;
  // Laid out at true size (the on-screen fit-to-screen scale cancelled), so pages break exactly as they print.
  const stage = h("div", { class: "dr-stage", "aria-hidden": "true", style: { zoom: trueSizeZoom() } });
  document.body.append(stage);
  await document.fonts?.ready;

  stage.append(coverPage(model, clientName, asOn));
  sectionOverview(stage, model, clientName, settings, asOn);
  sectionAllocation(stage, model);
  sectionPerformance(stage, model);
  // Portfolio Overlap only when it can be shown; otherwise the next sections move up a number.
  let next = 4;
  const number = () => String(next++).padStart(2, "0");
  // Left out (not a placeholder) when there is nothing to compare: one fund, or no stock-level holdings for two funds.
  if (model.overlapApplies !== false && model.overlap) sectionOverlap(stage, model, number());
  sectionReturnsRisk(stage, model, number());
  sectionConclusion(stage, model, number());
  // The advisor may skip the recommended portfolio; the report then ends with the Conclusion section.
  if (model.recommended) wayForward(stage, model);

  const doc = h("div", { class: "dr-doc" }, ...stage.children);
  stage.remove();
  return doc;
}

// ---------- cover ----------
function coverPage(model, clientName, asOn) {
  return h("section", { class: "dr-page dr-cover ds-paper" },
    h("div", { class: "dr-cover-top" }),
    h("div", { class: "dr-cover-frame" }),
    h("div", { class: "dr-cover-logo" }, Logo({ size: 67 })),
    h("div", { class: "dr-cover-center" },
      h("div", { class: "dr-cover-eyebrow" }, "PRIVATE & CONFIDENTIAL"),
      h("h1", { class: "dr-cover-title" }, "Portfolio Review", h("br"), "& Recommendation"),
      h("div", { class: "dr-cover-rule" }),
      h("div", { class: "dr-cover-for" }, "PREPARED FOR"),
      h("div", { class: "dr-cover-name" }, clientName.toUpperCase()),
      h("div", { class: "dr-cover-date" }, "As On", h("span", { class: "dr-dot" }, "·"), asOn ?? DASH)),
    h("div", { class: "dr-cover-bottom" },
      h("div", { class: "dr-cover-motto" }, "CLARITY.", h("i", {}, "•"), "COMPLIANCE.", h("i", {}, "•"), "CONFIDENCE.")));
}
