/**
 * Home — the Prosperr landing page for advisors.
 *
 * renderHomePage(view): a short hero with a sample preview, a Portfolio Analyzer
 * spotlight, and a teaser for the tools on the way. Kept deliberately small —
 * more sections are added here as new tools go live.
 * Presentation only: every figure in the hero preview is labelled as a sample.
 */

import { h } from "../../design-system/components/dom.js";
import { Badge } from "../../design-system/components/basics.js";
import { Icon } from "../../design-system/components/icons.js";
import { DonutSvg } from "../../design-system/components/infographics.js";
import { ROUTES } from "../shared/site-config.js";

const ANALYZER_STEPS = [
  { icon: "upload", accent: "navy", title: "Upload the client's CAS", text: "CAMS, KFintech, NSDL or CDSL — detected automatically." },
  { icon: "shield", accent: "blue", title: "Get a verified review", text: "Every fund read as printed and matched to the statement's totals." },
  { icon: "file", accent: "green", title: "Share a client-ready report", text: "One-Pager Snapshot or the Detailed Recommendation Report." },
];

export function renderHomePage(view) {
  view.replaceChildren(h("main", { class: "home" },
    hero(),
    h("div", { class: "home-container" },
      analyzerSpotlight(),
      comingNext())));
}

// ---------- hero ----------
function hero() {
  return h("section", { class: "site-band home-hero" },
    h("div", { class: "site-band-inner home-hero-inner" },
      h("div", { class: "home-hero-copy" },
        h("span", { class: "home-pill site-reveal" }, Icon("sparkle", { size: 14 }), "Research tools for mutual fund advisors"),
        h("h1", { class: "home-title site-reveal", style: { "--i": 1 } },
          "Portfolio reviews your clients ", h("span", { class: "site-gradient-text" }, "instantly understand")),
        h("p", { class: "home-lead site-reveal", style: { "--i": 2 } },
          "Turn any Consolidated Account Statement into a verified portfolio review and a polished client report — in minutes."),
        h("div", { class: "home-cta site-reveal", style: { "--i": 3 } },
          h("a", { class: "ds-btn ds-btn-primary home-cta-primary", href: ROUTES.PORTFOLIO_ANALYZER }, "Analyse a CAS", Icon("arrowRight", { size: 18 }))),
        h("div", { class: "home-trust site-reveal", style: { "--i": 4 } },
          ["Works with CAMS · KFintech · NSDL · CDSL", "Verified to the paisa", "Never uploaded"].map((text) =>
            h("span", {}, Icon("check", { size: 14, strokeWidth: 2.5 }), text)))),
      heroPreview()));
}

/** Illustrative product preview (clearly marked as a sample). */
function heroPreview() {
  const amcs = [
    { label: "HDFC Mutual Fund", value: 38, color: "var(--navy)" },
    { label: "PPFAS Mutual Fund", value: 26, color: "var(--blue)" },
    { label: "SBI Mutual Fund", value: 21, color: "var(--green)" },
    { label: "Axis Mutual Fund", value: 15, color: "var(--lime)" },
  ];
  const funds = [
    ["Parag Parikh Flexi Cap Fund", "+21.4%", "invest"],
    ["HDFC Mid Cap Fund", "+18.2%", "invest"],
    ["SBI Healthcare Opportunities", "+9.6%", "hold"],
    ["Axis Strategic Bond Fund", "−1.2%", "sell"],
  ];
  const tone = { invest: "positive", hold: "info", sell: "negative" };
  return h("div", { class: "home-preview site-reveal", style: { "--i": 2 }, "aria-label": "Sample portfolio preview" },
    h("div", { class: "home-preview-card main" },
      h("div", { class: "home-preview-head" }, h("span", {}, "Client portfolio"), h("span", { class: "home-sample" }, "Sample")),
      h("div", { class: "home-preview-value" }, "₹24,86,350"),
      h("div", { class: "home-preview-gain" }, Icon("trend", { size: 14 }), "+₹4,12,870 (+19.9%) overall gain"),
      h("div", { class: "home-preview-donut" },
        DonutSvg({ items: amcs, size: 112, thickness: 22, gap: 2, centerTop: "4", centerBottom: "AMCS", ariaLabel: "Sample AMC allocation" }),
        h("ul", {}, amcs.map((item) => h("li", {}, h("i", { style: { background: item.color } }), item.label, h("strong", {}, `${item.value}%`)))))),
    h("div", { class: "home-preview-card list" },
      h("div", { class: "home-preview-head" }, h("span", {}, "Prosperr recommendation"), h("span", { class: "home-sample" }, "Sample")),
      h("ul", {}, funds.map(([name, gain, verdict]) =>
        h("li", {}, h("span", { class: "home-fund" }, name), h("span", { class: `home-gain ${gain.startsWith("−") ? "down" : "up"}` }, gain),
          Badge({ text: verdict.toUpperCase(), tone: tone[verdict] }))))));
}

// ---------- Portfolio Analyzer spotlight ----------
function analyzerSpotlight() {
  return h("section", { class: "home-spotlight site-reveal" },
    h("div", { class: "home-spotlight-copy" },
      h("span", { class: "home-live" }, h("i"), "Live now"),
      h("h2", {}, "Portfolio Analyzer"),
      h("p", { class: "home-spotlight-lead" }, "Everything you need for a client portfolio review, from the statement to the report."),
      h("ol", { class: "home-spotlight-steps" }, ANALYZER_STEPS.map((step, i) =>
        h("li", { style: { "--step-accent": `var(--${step.accent})` } },
          h("span", { class: "home-spotlight-icon" }, Icon(step.icon, { size: 20 })),
          h("div", {}, h("strong", {}, `${i + 1}. ${step.title}`), h("span", {}, step.text))))),
      h("a", { class: "ds-btn ds-btn-primary home-cta-primary", href: ROUTES.PORTFOLIO_ANALYZER }, "Open Portfolio Analyzer", Icon("arrowRight", { size: 18 }))),
    h("div", { class: "home-spotlight-reports" },
      reportTile("one", "One-Pager Snapshot", "Portfolio", "Snapshot"),
      reportTile("detail", "Detailed Recommendation Report", "Portfolio Review", "& Recommendation")));
}

function reportTile(variant, caption, line1, line2) {
  return h("a", { class: `home-report-tile is-${variant}`, href: ROUTES.PORTFOLIO_ANALYZER },
    h("div", { class: "home-report-art" },
      h("span", { class: "band top" }), h("span", { class: "band bottom" }),
      h("div", { class: "home-report-art-text" }, h("strong", {}, line1), h("strong", {}, line2))),
    h("span", { class: "home-report-caption" }, caption));
}

// ---------- coming next ----------
function comingNext() {
  return h("a", { class: "home-next site-reveal", href: ROUTES.FUND_RESEARCH },
    h("span", { class: "home-next-icon" }, Icon("search", { size: 22 })),
    h("div", { class: "home-next-copy" },
      h("strong", {}, "Fund Research"),
      h("span", {}, "Explore equity, hybrid, index, debt funds, ETFs and NFOs.")),
    h("span", { class: "home-next-badge" }, "Coming soon"),
    Icon("arrowRight", { size: 18, className: "home-next-arrow" }));
}
