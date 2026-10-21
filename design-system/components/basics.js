/**
 * Small presentational components. Each receives finished values and renders
 * them — no business logic, no raw colors (tokens only).
 *
 *  Logo({ size })                         brand mark with text fallback
 *  SectionHeader({ eyebrow, title, aside }) eye-label + title + gradient divider
 *  KpiCard({ label, value, sub, accent, tone })
 *  Badge({ text, tone })                  tone ∈ positive|negative|info|warning|neutral
 *  Callout({ tone, title, items, body })
 *  Card({ title, accent, children })
 */

import { h } from "./dom.js";
import { TONE } from "../tokens.js";
import { Icon } from "./icons.js";

// Resolved from this module's location, so the logo loads from any page depth.
const LOGO_SRC = {
  default: new URL("../../assets/prosperr-logo.png", import.meta.url).href,
  light: new URL("../../assets/prosperr-logo-light.png", import.meta.url).href,
};

/** Transparent logo; variant "light" uses white ink for dark backgrounds. */
export function Logo({ size = 32, variant = "default" } = {}) {
  const wordmark = h("span", { class: "ds-logo-wordmark" }, "Prosperr", h("span", { class: "ds-logo-tld" }, ".io"));
  const img = h("img", { class: "ds-logo-img", src: LOGO_SRC[variant] ?? LOGO_SRC.default, alt: "Prosperr", height: size });
  img.addEventListener("error", () => img.replaceWith(wordmark));
  return h("span", { class: `ds-logo ds-logo-${variant}`, style: { "--logo-size": `${size}px` } }, img);
}

export function SectionHeader({ eyebrow, title, aside }) {
  return h(
    "header",
    { class: "ds-section-header" },
    h("div", { class: "ds-section-header-row" },
      h("div", {}, eyebrow ? h("div", { class: "ds-eyebrow" }, eyebrow) : null, h("h2", {}, title)),
      aside ?? null
    ),
    h("div", { class: "ds-divider" })
  );
}

export function KpiCard({ label, value, sub, accent, tone, icon }) {
  const accentColor = tone ? TONE[tone].color : accent;
  return h(
    "div",
    { class: "ds-kpi", style: { "--accent": accentColor } },
    h("div", { class: "ds-kpi-head" },
      icon ? h("span", { class: "ds-kpi-icon" }, Icon(icon, { size: 18 })) : null,
      h("div", { class: "ds-kpi-label" }, label)),
    h("div", { class: "ds-kpi-value ds-num", style: tone ? { color: TONE[tone].color } : null }, value),
    sub ? h("div", { class: "ds-kpi-sub" }, sub) : null
  );
}

export function Badge({ text, tone = "neutral", title }) {
  const { color, tint } = TONE[tone];
  return h("span", { class: "ds-badge", title, style: { color, background: tint, "border-color": color } }, text);
}

const CALLOUT_ICON = { positive: "checkCircle", negative: "alert", warning: "alert", info: "info", neutral: "info" };

export function Callout({ tone = "info", title, items = [], body }) {
  const { color, tint } = TONE[tone];
  return h(
    "div",
    { class: "ds-callout", role: tone === "negative" || tone === "warning" ? "alert" : "status", style: { "--accent": color, background: tint } },
    h("span", { class: "ds-callout-icon", style: { color } }, Icon(CALLOUT_ICON[tone], { size: 20 })),
    h("div", { class: "ds-callout-content" },
      title ? h("div", { class: "ds-callout-title" }, title) : null,
      body ? h("p", { class: "ds-callout-body" }, body) : null,
      items.length ? h("ul", { class: "ds-callout-list" }, items.map((item) => h("li", {}, item))) : null)
  );
}

export function Card({ title, eyebrow, icon, accent, children, className = "" }) {
  return h(
    "section",
    { class: `ds-card ${className}`.trim(), style: accent ? { "--accent": accent } : null },
    title
      ? h("div", { class: "ds-card-head" },
          icon ? h("span", { class: "ds-card-icon" }, Icon(icon, { size: 18 })) : null,
          h("div", {}, eyebrow ? h("div", { class: "ds-eyebrow" }, eyebrow) : null, h("h3", { class: "ds-card-title" }, title)))
      : null,
    children
  );
}
