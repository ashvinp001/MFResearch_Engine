/**
 * Fund Research — coming-soon page with a preview of the fund categories
 * advisors will be able to explore.
 * renderFundResearchPage(view)
 */

import { h } from "../../design-system/components/dom.js";
import { Icon } from "../../design-system/components/icons.js";
import { ROUTES } from "../shared/site-config.js";

// accent = a brand palette token name
const CATEGORIES = [
  { icon: "equity", accent: "navy", title: "Equity Funds", text: "Predominantly invests in stocks with an aim to provide long term capital appreciation." },
  { icon: "hybrid", accent: "green", title: "Hybrid Funds", text: "Invests in equity stocks & fixed income securities with an aim to protect capital and generate capital appreciation." },
  { icon: "index", accent: "blue", title: "Index Funds", text: "Invests in equity stocks & these are all passive funds that replicate the index they follow." },
  { icon: "debt", accent: "steel", title: "Debt Funds", text: "Predominantly invests in fixed income securities with an aim to protect the capital with a decent return." },
  { icon: "etf", accent: "olive", title: "ETF", text: "An ETF is an exchange traded fund that trades like a common stock on a stock exchange." },
  { icon: "nfo", accent: "amber", title: "NFO", text: "An NFO offers mutual fund units at ₹10, introducing a new investment opportunity." },
];

export function renderFundResearchPage(view) {
  view.replaceChildren(h("main", { class: "soon" },
    h("section", { class: "site-band" },
      h("div", { class: "site-band-inner soon-inner" },
        h("span", { class: "home-pill site-reveal" }, Icon("sparkle", { size: 14 }), "Coming soon"),
        h("h1", { class: "soon-title site-reveal", style: { "--i": 1 } }, "Fund research, built for advisors"),
        h("p", { class: "soon-text site-reveal", style: { "--i": 2 } },
          "Category comparisons, rolling returns and risk ratios for every mutual fund — powered by the same verified data engine as the Portfolio Analyzer."),
        h("a", { class: "ds-btn ds-btn-primary site-reveal", style: { "--i": 3 }, href: ROUTES.PORTFOLIO_ANALYZER },
          "Try the Portfolio Analyzer", Icon("arrowRight", { size: 18 })))),
    h("section", { class: "fr-explore" },
      h("div", { class: "home-container" },
        h("h2", { class: "fr-title" }, "Explore the Top Mutual Funds to Invest"),
        h("div", { class: "fr-grid" }, CATEGORIES.map(categoryCard))))));
}

function categoryCard(category, i) {
  return h("article", { class: "fr-card site-reveal", style: { "--accent": `var(--${category.accent})`, "--i": i } },
    h("div", { class: "fr-card-head" },
      h("span", { class: "fr-card-icon" }, Icon(category.icon, { size: 30, strokeWidth: 1.5 })),
      h("h3", {}, category.title)),
    h("p", {}, category.text),
    h("span", { class: "fr-card-soon" }, Icon("sparkle", { size: 12 }), "Coming soon"));
}
