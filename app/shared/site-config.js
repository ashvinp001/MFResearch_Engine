/**
 * Website-level content shared by every page: routes, navigation,
 * footer links and legal text. The site is an advisor workspace: advisors run
 * the analysis on behalf of their clients.
 */

export const ROUTES = Object.freeze({
  HOME: "#/",
  PORTFOLIO_ANALYZER: "#/portfolio-analyzer",
  FUND_RESEARCH: "#/fund-research",
  FUND_SCORECARD: "#/fund-scorecard",
});

// accent = a brand palette token name; each tab carries its own colour.
export const SITE_NAV = [
  { label: "Home", href: ROUTES.HOME, icon: "home", accent: "navy" },
  { label: "Portfolio Analyzer", href: ROUTES.PORTFOLIO_ANALYZER, icon: "pie", accent: "green" },
  { label: "Fund Research", href: ROUTES.FUND_RESEARCH, icon: "search", accent: "blue" },
  { label: "Fund Scorecard", href: ROUTES.FUND_SCORECARD, icon: "trend", accent: "violet" },
];

export const SITE_FOOTER = {
  name: "Prosperr.io Wealth",
  tagline: "Research tools that help advisors give every client clear, confident answers.",
  columns: [
    { title: "Tools", links: [{ label: "Portfolio Analyzer", href: ROUTES.PORTFOLIO_ANALYZER }, { label: "Fund Research", href: ROUTES.FUND_RESEARCH }, { label: "Fund Scorecard", href: ROUTES.FUND_SCORECARD }] },
  ],
  legal: "© Prosperr.io Wealth · Mutual fund investments are subject to market risks. Read all scheme-related documents carefully. Information shown is for portfolio review and is not investment advice.",
};
