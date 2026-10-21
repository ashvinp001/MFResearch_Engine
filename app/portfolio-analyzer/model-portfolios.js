/**
 * Prosperr Model Portfolios — ready-made baskets the advisor can apply in Step 4.
 * Choosing a basket fills the recommended-portfolio list with its funds and
 * allocations; the advisor can still edit every row afterwards.
 *
 * THIS IS THE ONLY PLACE TO EDIT THE BASKETS.
 *  - funds[].pct    allocation in percent (up to 2 decimals); each basket must total 100.
 *  - funds[].isin   optional; when it matches a client fund marked Invest/Hold, the
 *                   row links to that holding instead of an "Other fund" entry.
 *  - accent         a brand palette token name (teal, green, blue, amber, violet, navy…).
 *  - draft: true    shows a "Draft" tag on the basket until it is finalised.
 *
 * TODO (Prosperr): add each basket's funds, e.g.
 *   funds: [ { name: "Flexi Cap Fund", isin: "", pct: "30" }, … ]
 * then remove `draft`. A basket with no funds is shown blank and cannot be applied.
 */

export const MODEL_PORTFOLIOS = [
  {
    id: "conservative",
    name: "Conservative",
    tagline: "Capital protection with steady income.",
    risk: 1,
    accent: "teal",
    icon: "shield",
    draft: true,
    funds: [],
  },
  {
    id: "moderate",
    name: "Moderate",
    tagline: "Stability first, with some equity growth.",
    risk: 2,
    accent: "green",
    icon: "layers",
    draft: true,
    funds: [],
  },
  {
    id: "balanced",
    name: "Balanced",
    tagline: "An even mix of growth and stability.",
    risk: 3,
    accent: "blue",
    icon: "hybrid",
    draft: true,
    funds: [],
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "Equity-led wealth creation over the long term.",
    risk: 4,
    accent: "amber",
    icon: "trend",
    draft: true,
    funds: [],
  },
  {
    id: "aggressive",
    name: "Aggressive Growth",
    tagline: "Maximum growth for a long horizon and high risk appetite.",
    risk: 5,
    accent: "violet",
    icon: "bolt",
    draft: true,
    funds: [],
  },
];

export const RISK_LABELS = ["", "Low", "Low–Med", "Medium", "Med–High", "High"];
