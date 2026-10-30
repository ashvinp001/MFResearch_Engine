/**
 * App entry — hash router for the Prosperr website.
 *
 *   #/                    Home (landing page)
 *   #/portfolio-analyzer  Portfolio Analyzer (CAS → reports)
 *   #/fund-research       Fund Research (#/fund-research/<category> for one category)
 *   #/fund-scorecard      Fund Scorecard (internal: funds rated and ranked per category)
 *
 * Every navigation mounts a fresh page, so no client data carries over.
 */

import { mountSiteShell } from "./shell.js";
import { ROUTES, SITE_NAV } from "./shared/site-config.js";
import { renderHomePage } from "./pages/home-page.js";
import { renderFundResearchPage } from "./pages/fund-research-page.js";
import { renderFundScorecardPage } from "./pages/fund-scorecard-page.js";
import { mountPortfolioAnalyzer } from "./portfolio-analyzer/workflow.js";

const shell = mountSiteShell(document.getElementById("app"));

const PAGES = {
  [ROUTES.HOME]: (view) => renderHomePage(view),
  [ROUTES.PORTFOLIO_ANALYZER]: (view) => mountPortfolioAnalyzer(view).showUpload(),
  [ROUTES.FUND_RESEARCH]: (view, sub) => renderFundResearchPage(view, sub),
  [ROUTES.FUND_SCORECARD]: (view) => renderFundScorecardPage(view),
};

function render() {
  // Fund Research has sub-pages: #/fund-research/<category>.
  const [base, sub] = location.hash.startsWith(`${ROUTES.FUND_RESEARCH}/`)
    ? [ROUTES.FUND_RESEARCH, location.hash.slice(ROUTES.FUND_RESEARCH.length + 1)]
    : [location.hash, null];
  const route = PAGES[base] ? base : ROUTES.HOME;
  shell.setActive(route);
  // Browser tab: the logo icon plus the page's own name, e.g. "Portfolio Analyzer".
  document.title = SITE_NAV.find((link) => link.href === route)?.label ?? "Home";
  PAGES[route](shell.view, sub);
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", render);
render();
