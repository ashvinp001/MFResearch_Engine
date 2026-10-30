/**
 * Fund Scorecard — which categories are shown. Independent of Fund Research's own switch (research-config.js).
 *
 * Every equity category is rated by the engine; only the categories listed here show their ratings. The rest keep their
 * tab and show "Mapping pending" — no data is loaded for them — until the owner switches them on.
 */

import { INDEX_FAMILY, TRACKED_INDICES } from "../../../calculation-engine/index.js";

export const SCORECARD_LIVE = new Set(["large-cap", "mid-cap", "large-mid-cap", "small-cap", "multi-cap", "flexi-cap"]);

/**
 * Index Funds: one category card; its sub-categories are the indices in calculation-engine/index-funds.js
 * TRACKED_INDICES (the common list the Portfolio Analyzer uses too), grouped by family. Each is rated by
 * research/index-scorecard.js against funds tracking the same index.
 */
export const INDEX_CARD = { slug: "index-funds", name: "Index Funds", accent: "steel", icon: "pie", note: "rated on tracking" };
export const INDEX_SCORECARD = TRACKED_INDICES.map((t) => ({ ...t, kind: "index", index: { code: t.code, name: t.name }, benchmark: { code: t.code, name: t.name } }));
const SHORT = { broad: "Broad market", factor: "Factor", sector: "Sector" };   // compact labels for the sub-category row
export const INDEX_GROUPS = ["broad", "factor", "sector"].map((family) => ({ family, label: SHORT[family], title: INDEX_FAMILY[family].label, items: INDEX_SCORECARD.filter((c) => c.family === family) }));
