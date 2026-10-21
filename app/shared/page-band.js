/**
 * Compact hero band used at the top of each workflow step.
 * Input: { eyebrow, title, text, aside? }. Output: DOM element.
 */

import { h } from "../../design-system/components/dom.js";

export function pageBand({ eyebrow, title, text, aside }) {
  return h("section", { class: "site-band" },
    h("div", { class: "site-band-inner app-page-band" },
      h("div", { class: "site-reveal" },
        h("div", { class: "ds-eyebrow" }, eyebrow),
        h("h1", { class: "app-page-title" }, title),
        text ? h("p", { class: "app-page-text" }, text) : null),
      aside ?? null));
}
