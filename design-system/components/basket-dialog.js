/**
 * BasketDialog — a modal of colourful basket cards (e.g. model portfolios).
 * Each card shows its allocation as a stacked bar and a list; cards lift on hover.
 *
 * Input:  { eyebrow, title, text, note?,
 *           baskets: [ { id, name, tagline, accent (CSS colour), icon, badge?, riskLabel, riskLevel (1–5),
 *                        items: [ { label, value (number), display (string) } ] } ] }   // empty items → blank, not selectable
 * Output: { element, choose(selectedId?) → Promise<string|null> }  resolves with the chosen id, or null if closed.
 */

import { h } from "./dom.js";
import { Icon } from "./icons.js";

const RISK_STEPS = 5;

export function BasketDialog({ eyebrow, title, text, note, baskets }) {
  let resolve = null;
  const element = h("dialog", { class: "bk-dialog", "aria-labelledby": "bk-title" });

  const finish = (value) => {
    if (element.open) element.close();
    resolve?.(value);
    resolve = null;
  };

  const cards = baskets.map((basket) => {
    const total = basket.items.reduce((sum, item) => sum + item.value, 0) || 1;
    // Segment shades step from the full accent towards lighter tints.
    const shade = (i) => `color-mix(in srgb, var(--bk-accent) ${100 - i * 16}%, var(--surface))`;
    // A basket without items is shown blank (contents to be added) and cannot be chosen.
    const empty = basket.items.length === 0;
    return h("button", {
      type: "button",
      class: `bk-card${empty ? " is-empty" : ""}`,
      "data-id": basket.id,
      "aria-disabled": empty ? "true" : null,
      style: { "--bk-accent": basket.accent },
      onclick: () => { if (!empty) finish(basket.id); },
    },
      h("span", { class: "bk-card-top" },
        h("span", { class: "bk-card-icon" }, Icon(basket.icon, { size: 22 })),
        basket.badge ? h("span", { class: "bk-card-badge" }, basket.badge) : null,
        h("span", { class: "bk-card-selected" }, Icon("check", { size: 14, strokeWidth: 3 }), "Selected")),
      h("span", { class: "bk-card-name" }, basket.name),
      h("span", { class: "bk-card-tagline" }, basket.tagline),
      h("span", { class: "bk-risk", "aria-label": `Risk: ${basket.riskLabel}` },
        h("span", { class: "bk-risk-dots" }, Array.from({ length: RISK_STEPS }, (_, i) => h("i", { class: i < basket.riskLevel ? "on" : "" }))),
        basket.riskLabel),
      empty ? h("span", { class: "bk-blank", "aria-hidden": "true" }) : [
        h("span", { class: "bk-bar", "aria-hidden": "true" }, basket.items.map((item, i) =>
          h("i", { style: { width: `${(item.value / total) * 100}%`, background: shade(i) } }))),
        h("span", { class: "bk-items" }, basket.items.map((item, i) =>
          h("span", { class: "bk-item" }, h("i", { style: { background: shade(i) } }), h("span", {}, item.label), h("strong", {}, item.display)))),
        h("span", { class: "bk-card-cta" }, "Use this basket", Icon("arrowRight", { size: 16 })),
      ]);
  });

  element.append(
    h("div", { class: "bk-head" },
      h("div", {},
        eyebrow ? h("div", { class: "ds-eyebrow" }, eyebrow) : null,
        h("h2", { id: "bk-title" }, title),
        text ? h("p", {}, text) : null),
      h("button", { type: "button", class: "app-icon-btn", "aria-label": "Close", onclick: () => finish(null) }, Icon("x", { size: 20 }))),
    h("div", { class: "bk-grid" }, cards),
    note ? h("p", { class: "bk-note" }, Icon("info", { size: 14 }), note) : null);

  element.addEventListener("cancel", (event) => { event.preventDefault(); finish(null); });
  element.addEventListener("click", (event) => { if (event.target === element) finish(null); });

  return {
    element,
    choose(selectedId = null) {
      cards.forEach((card) => card.classList.toggle("is-selected", card.dataset.id === selectedId));
      return new Promise((done) => {
        resolve = done;
        element.showModal();
      });
    },
  };
}
