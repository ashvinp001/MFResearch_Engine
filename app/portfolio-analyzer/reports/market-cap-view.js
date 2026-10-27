/**
 * Market cap (equity) for the One-Pager — the same block on screen and in the printed sheet:
 * a half-donut gauge of the Large / Mid / Small split (largest share in its middle), the portfolio's tilt in a
 * few words, and one tile per size with its share and what it means (SEBI's ranking by market value).
 *
 * marketCapBlock(marketCap: { large, mid, small } (% of domestic equity), { size: "screen" | "print" }) → HTMLElement
 * The shares are shown exactly as calculated (engine allocation.js); nothing is estimated here.
 */

import { h } from "../../../design-system/components/dom.js";
import { GaugeSvg } from "../../../design-system/components/infographics.js";
import { pct1 } from "./snapshot-format.js";

const CAPS = [
  { key: "large", label: "Large cap", color: "var(--navy)", note: "Top 100 companies" },
  { key: "mid", label: "Mid cap", color: "var(--blue)", note: "Companies 101–250" },
  { key: "small", label: "Small cap", color: "var(--green)", note: "Companies 251 onwards" },
];

/** The portfolio's market-cap tilt, from its own shares. */
export function marketCapTilt({ large, mid, small }) {
  if (large >= 60) return "Large-cap led";
  if (mid + small >= 50) return "Mid & small-cap tilt";
  return "Balanced mix";
}

export function marketCapBlock(marketCap, { size = "screen" } = {}) {
  const items = CAPS.map((cap) => ({ ...cap, value: marketCap[cap.key] ?? 0 }));
  const lead = items.reduce((a, b) => (b.value > a.value ? b : a));
  const print = size === "print";
  return h("div", { class: `mc-block ${print ? "is-print" : ""}`.trim() },
    h("div", { class: "mc-gauge" },
      GaugeSvg({
        items: items.map((item) => ({ value: item.value, color: item.color, title: `${item.label}: ${pct1(item.value)}%` })),
        width: print ? 150 : 210, thickness: print ? 18 : 26, gap: 2,
        centerTop: `${pct1(lead.value)}%`, centerBottom: lead.label.toUpperCase(),
        ariaLabel: `Market cap split: ${items.map((item) => `${item.label} ${pct1(item.value)}%`).join(", ")}`,
      }),
      h("span", { class: "mc-tilt" }, marketCapTilt(marketCap))),
    h("div", { class: "mc-tiles" }, items.map((item) =>
      h("div", { class: "mc-tile", style: { "--mc": item.color } },
        h("strong", {}, `${pct1(item.value)}%`),
        h("span", {}, item.label),
        h("small", {}, item.note)))));
}
