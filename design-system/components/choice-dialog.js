/**
 * ChoiceDialog — a modal with large option cards (e.g. which report to build).
 *
 * Input:  { eyebrow, title, text, options: [ { id, title, text, icon, points: [string], accent } ] }
 * Output: { element, choose() → Promise<string|null> }   resolves with the chosen id, or null if closed.
 */

import { h } from "./dom.js";
import { Icon } from "./icons.js";

export function ChoiceDialog({ eyebrow, title, text, options }) {
  let resolve = null;
  const element = h("dialog", { class: "cd-dialog", "aria-labelledby": "cd-title" });

  const finish = (value) => {
    if (element.open) element.close();
    resolve?.(value);
    resolve = null;
  };

  element.append(
    h("div", { class: "cd-head" },
      h("div", {},
        eyebrow ? h("div", { class: "ds-eyebrow" }, eyebrow) : null,
        h("h2", { id: "cd-title" }, title),
        text ? h("p", {}, text) : null),
      h("button", { type: "button", class: "app-icon-btn", "aria-label": "Close", onclick: () => finish(null) }, Icon("x", { size: 20 }))),
    h("div", { class: "cd-options" }, options.map((option) =>
      h("button", { type: "button", class: "cd-option", style: { "--accent": option.accent }, onclick: () => finish(option.id) },
        h("span", { class: "cd-option-icon" }, Icon(option.icon, { size: 26 })),
        h("span", { class: "cd-option-title" }, option.title),
        h("span", { class: "cd-option-text" }, option.text),
        h("ul", { class: "cd-option-points" }, option.points.map((point) => h("li", {}, Icon("check", { size: 14, strokeWidth: 2.5 }), point))),
        h("span", { class: "cd-option-cta" }, "Choose", Icon("arrowRight", { size: 16 }))))));

  element.addEventListener("cancel", (event) => { event.preventDefault(); finish(null); });
  element.addEventListener("click", (event) => { if (event.target === element) finish(null); });

  return {
    element,
    choose() {
      return new Promise((done) => {
        resolve = done;
        element.showModal();
      });
    },
  };
}
