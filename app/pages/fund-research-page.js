/**
 * Fund Research (MF_Platform_Specification.md P7).
 *
 * renderFundResearchPage(view, slug)
 *   #/fund-research              The big asset-class boxes (Equity, Hybrid, Index, Debt, ETF, NFO).
 *   #/fund-research/equity       Market Pulse, then one colour-coded box per Equity category (live categories prefetched).
 *   #/fund-research/<category>   Market Pulse, then that category's full fund list with returns (category-view.js).
 * Asset classes / categories not yet switched on (research-config.js) show as "Coming soon" / "Coming next".
 */

import { h } from "../../design-system/components/dom.js";
import { Icon } from "../../design-system/components/icons.js";
import { ROUTES } from "../shared/site-config.js";
import { loadValuationData } from "../shared/market-data.js";
import { ASSET_CLASSES, EQUITY_CATEGORIES, SHOW_CATEGORY_PAGES } from "./fund-research/research-config.js";
import { indexStrip } from "./fund-research/index-strip.js";
import { categoryView, prefetchCategory } from "./fund-research/category-view.js";

export const EQUITY_ROUTE = `${ROUTES.FUND_RESEARCH}/equity`;

export function renderFundResearchPage(view, slug = null) {
  const open = SHOW_CATEGORY_PAGES;   // inner pages switched off → every address shows the asset classes
  const category = open && slug ? EQUITY_CATEGORIES.find((c) => c.slug === slug && c.ready) : null;
  const level = category ? "category" : open && slug === "equity" ? "equity" : "home";
  // The hero band introduces Fund Research on its home page only; the inner pages open straight on their content.
  view.replaceChildren(h("main", { class: "frx" },
    level === "home" ? h("section", { class: "site-band frx-band" },
      h("div", { class: "site-band-inner" },
        h("div", { class: "ds-eyebrow" }, "Fund Research"),
        h("h1", {}, "Explore the top mutual funds to invest"),
        h("p", { class: "frx-band-text" }, "Compare every scheme within its SEBI category — trailing, monthly and calendar-year returns against the benchmark and the category average, computed from daily AMFI NAVs."))) : null,
    h("div", { class: `home-container frx-body${level === "home" ? " is-home" : ""}` },
      level === "home" ? null : indexStrip(),   // Market Pulse sits with the category boxes and fund tables, not on the asset-class page
      level === "category" ? categoryView(category) : level === "equity" ? equityCategories() : assetClasses())));
}

/** Matching funds per category and plan, from the AMFI lists (filled in once loaded). */
function fundCounts(onReady) {
  loadValuationData().then((market) => {
    if (market.error) return;
    const count = (amfi, plan) => market.schemes.filter((s) => s.plan === plan && s.active !== false && amfi.includes(s.category)).length;
    onReady(new Map(EQUITY_CATEGORIES.map((c) => [c.slug, { Regular: count(c.amfi, "Regular"), Direct: count(c.amfi, "Direct") }])));
  });
}

// ---------- level 1: asset classes ----------
function assetClasses() {
  const grid = h("div", { class: "frx-assets" }, ASSET_CLASSES.map((a, i) => assetBox(a, i, null)));
  fundCounts((counts) => {
    const equity = [...counts.values()].reduce((s, n) => s + n.Regular, 0);
    grid.replaceChildren(...ASSET_CLASSES.map((a, i) => assetBox(a, i, a.slug === "equity" ? equity : null)));
  });
  return h("section", { class: "frx-home" },
    h("div", { class: "frx-section-head" }, h("h2", {}, "Asset classes")),
    grid);
}

function assetBox(asset, i, funds) {
  const live = asset.ready && SHOW_CATEGORY_PAGES;   // opens only while the category pages are switched on
  const inner = [
    h("span", { class: "frx-asset-art", "aria-hidden": "true" }, Icon(asset.icon, { size: 160, strokeWidth: 1 })),
    h("div", { class: "frx-asset-head" },
      h("span", { class: "frx-asset-icon" }, Icon(asset.icon, { size: 34, strokeWidth: 1.6 })),
      h("h3", {}, asset.title)),
    h("p", {}, asset.text),
    h("div", { class: "frx-asset-foot" },
      live
        ? [h("span", { class: "frx-asset-stat" }, funds ? `${funds} schemes · ${EQUITY_CATEGORIES.length} categories` : `${EQUITY_CATEGORIES.length} categories`),
           h("span", { class: "frx-asset-go" }, "Explore", Icon("arrowRight", { size: 16 }))]
        : h("span", { class: "frx-asset-soon" }, Icon("sparkle", { size: 12 }), "Coming soon")),
  ];
  const attrs = { class: `frx-asset${live ? " is-ready" : ""}`, style: { "--accent": `var(--${asset.accent})`, "--i": i } };
  return live ? h("a", { ...attrs, href: EQUITY_ROUTE }, inner) : h("article", { ...attrs, "aria-disabled": "true" }, inner);
}

// ---------- level 2: equity categories ----------
function equityCategories() {
  const grid = h("div", { class: "frx-cats" }, EQUITY_CATEGORIES.map((c, i) => categoryBox(c, i, null)));
  fundCounts((counts) => grid.replaceChildren(...EQUITY_CATEGORIES.map((c, i) => categoryBox(c, i, counts.get(c.slug)))));
  // Fetch the live categories' data in the background now, so opening one is instant.
  EQUITY_CATEGORIES.filter((c) => c.ready).forEach((c) => { prefetchCategory(c, "Regular"); prefetchCategory(c, "Direct"); });
  return h("section", { class: "frx-home" },
    h("div", { class: "frx-section-head" }, h("h2", {}, "Equity Fund Categories"),
      h("p", {}, `${EQUITY_CATEGORIES.length} SEBI categories · each measured against its benchmark index`)),
    grid);
}

function categoryBox(category, i, n) {
  const inner = [
    h("div", { class: "frx-cat-top" },
      h("span", { class: "frx-cat-icon" }, Icon(category.icon, { size: 22, strokeWidth: 1.8 })),
      category.ready ? h("span", { class: "frx-live" }, "Live") : null),
    h("h3", {}, category.name),
    h("p", {}, category.text),
    h("div", { class: "frx-cat-foot" },
      h("span", { class: "frx-cat-count" }, n ? `${n.Regular} schemes` : "…"),
      h("span", { class: "frx-chip", title: "Benchmark index" }, category.benchmark.name)),
    category.ready   // same last row in every box, so the footers line up
      ? h("span", { class: "frx-cat-go" }, "View all funds", Icon("arrowRight", { size: 15 }))
      : h("span", { class: "frx-cat-go is-soon" }, "Fund list available soon"),
  ];
  const attrs = { class: `frx-cat${category.ready ? " is-ready" : ""}`, style: { "--accent": `var(--${category.accent})`, "--i": i } };
  return category.ready
    ? h("a", { ...attrs, href: `${ROUTES.FUND_RESEARCH}/${category.slug}` }, inner)
    : h("div", { ...attrs, "aria-disabled": "true" }, inner);
}
