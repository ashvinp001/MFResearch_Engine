/**
 * AlertDialog — a modal that explains a problem and lets the user decide what to do.
 *
 * Input:  { tone: "warning" | "negative", eyebrow, title, text, items: [string], note?,
 *           primary: { label, icon? }, secondary?: { label, icon? } }
 * Output: { element, open(content?) → Promise<"primary" | "secondary" | null> }
 *   open() can take new { title, text, items } to reuse the same dialog.
 */

import { h } from "./dom.js";
import { Icon } from "./icons.js";

export function AlertDialog({ tone = "warning", eyebrow, title, text, items = [], note, primary, secondary }) {
  let resolve = null;
  const titleEl = h("h2", { id: "ad-title" });
  const textEl = h("p", { class: "ad-text" });
  const list = h("ul", { class: "ad-items" });
  const element = h("dialog", { class: `ad-dialog is-${tone}`, "aria-labelledby": "ad-title" });

  const finish = (value) => {
    if (element.open) element.close();
    resolve?.(value);
    resolve = null;
  };

  const fill = (content) => {
    titleEl.textContent = content.title ?? "";
    textEl.textContent = content.text ?? "";
    textEl.hidden = !content.text;
    list.replaceChildren(...(content.items ?? []).map((item) => h("li", {}, Icon("alert", { size: 15 }), h("span", {}, item))));
    list.hidden = !(content.items ?? []).length;
  };
  fill({ title, text, items });

  element.append(
    h("div", { class: "ad-head" },
      h("span", { class: "ad-icon" }, Icon("alert", { size: 24 })),
      h("div", {}, eyebrow ? h("div", { class: "ds-eyebrow" }, eyebrow) : null, titleEl),
      h("button", { type: "button", class: "app-icon-btn", "aria-label": "Close", onclick: () => finish(null) }, Icon("x", { size: 20 }))),
    h("div", { class: "ad-body" }, textEl, list, note ? h("p", { class: "ad-note" }, Icon("info", { size: 14 }), note) : null),
    h("div", { class: "ad-actions" },
      secondary ? h("button", { type: "button", class: "ds-btn", onclick: () => finish("secondary") }, secondary.icon ? Icon(secondary.icon, { size: 16 }) : null, secondary.label) : null,
      h("button", { type: "button", class: "ds-btn ds-btn-primary", onclick: () => finish("primary") }, primary.label, primary.icon ? Icon(primary.icon, { size: 16 }) : null)));

  element.addEventListener("cancel", (event) => { event.preventDefault(); finish(null); });

  return {
    element,
    open(content) {
      if (content) fill(content);
      return new Promise((done) => {
        resolve = done;
        element.showModal();
      });
    },
  };
}
