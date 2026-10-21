/**
 * Tokens for JavaScript / charts. Values are CSS variable REFERENCES, so
 * tokens.css stays the only place a color is defined. SVG fills and inline
 * styles accept var(...) directly.
 */

const v = (name) => `var(--${name})`;

/** Ordered chart sequence (Project_Specification_TEMP.md §3.1): portfolio = navy, benchmark = lime. */
export const CHART_SEQUENCE = Object.freeze(["navy", "blue", "green", "steel", "lime", "grey"].map(v));

/** Card accent rotation for neutral/structural cards (Project_Specification_TEMP.md §3.1). */
export const ACCENT_CYCLE = Object.freeze(["navy", "blue", "green", "steel", "lime"].map(v));

/** Semantic tones shared by Badge, Callout and KpiCard. */
export const TONE = Object.freeze({
  positive: { color: v("color-positive"), tint: v("surface-tint-green") },
  negative: { color: v("color-negative"), tint: v("surface-tint-red") },
  info: { color: v("color-info"), tint: v("surface-tint-blue") },
  warning: { color: v("color-warning"), tint: v("surface-tint-amber") },
  neutral: { color: v("color-primary"), tint: v("surface-tint-navy") },
});

/** Verdict status colors (Project_Specification_TEMP.md §3.1). */
export const STATUS = Object.freeze({ invest: TONE.positive, hold: TONE.info, sell: TONE.negative });

export const accentAt = (index) => ACCENT_CYCLE[index % ACCENT_CYCLE.length];
