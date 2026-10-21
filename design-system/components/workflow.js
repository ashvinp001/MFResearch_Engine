/**
 * Workflow components for multi-step advisor flows.
 *
 *  Stepper({ steps: [label], current, reachable, onSelect(index) })
 *      Numbered progress bar; completed steps show a tick, reachable steps are clickable.
 *  VerdictToggle({ value, onChange(verdict), label })
 *      Invest / Hold / Sell segmented buttons in status colours.
 *  ActionBar() → { element, update({ backLabel, onBack, nextLabel, onNext, nextEnabled, message, tone }) }
 *      Sticky bottom bar with Back / Next and a status message.
 */

import { h } from "./dom.js";
import { Icon } from "./icons.js";
import { STATUS } from "../tokens.js";

export function Stepper({ steps, current, reachable, onSelect }) {
  return h("nav", { class: "wf-stepper", "aria-label": "Progress" },
    h("ol", {}, steps.map((label, index) => {
      const state = index < current ? "done" : index === current ? "current" : "todo";
      const clickable = index !== current && index <= reachable && onSelect;
      return h("li", { class: `wf-step is-${state}` },
        h(clickable ? "button" : "span", {
          class: "wf-step-inner",
          type: clickable ? "button" : null,
          onclick: clickable ? () => onSelect(index) : null,
          "aria-current": state === "current" ? "step" : null,
        },
          h("span", { class: "wf-step-dot" }, state === "done" ? Icon("check", { size: 14, strokeWidth: 3 }) : String(index + 1)),
          h("span", { class: "wf-step-label" }, label)));
    })));
}

const VERDICT_LABEL = { invest: "Invest", hold: "Hold", sell: "Sell" };

export function VerdictToggle({ value, onChange, label }) {
  const group = h("div", { class: "wf-verdict", role: "group", "aria-label": label });
  const buttons = Object.entries(VERDICT_LABEL).map(([verdict, text]) => {
    const button = h("button", {
      type: "button",
      class: "wf-verdict-btn",
      "data-verdict": verdict,
      style: { "--verdict": STATUS[verdict].color },
      onclick: () => {
        for (const other of buttons) other.setAttribute("aria-pressed", String(other === button));
        onChange(verdict);
      },
    }, text);
    button.setAttribute("aria-pressed", String(value === verdict));
    return button;
  });
  group.append(...buttons);
  /** Select a verdict from outside (e.g. "reset to suggested") without firing onChange. */
  group.setValue = (verdict) => {
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.verdict === verdict));
  };
  return group;
}

export function ActionBar() {
  const message = h("div", { class: "wf-action-message", role: "status", "aria-live": "polite" });
  const back = h("button", { type: "button", class: "ds-btn" });
  const next = h("button", { type: "button", class: "ds-btn ds-btn-primary" });
  const element = h("div", { class: "wf-action-bar" },
    h("div", { class: "wf-action-inner" }, back, message, next));

  let handlers = {};
  back.addEventListener("click", () => handlers.onBack?.());
  next.addEventListener("click", () => handlers.onNext?.());

  return {
    element,
    update({ backLabel, onBack, nextLabel, onNext, nextEnabled = true, message: text = "", tone = "info", nextIcon = "arrowRight" }) {
      handlers = { onBack, onNext };
      back.hidden = !onBack;
      back.replaceChildren(Icon("arrowRight", { size: 16, className: "wf-flip" }), backLabel ?? "Back");
      next.hidden = !onNext;
      next.disabled = !nextEnabled;
      next.replaceChildren(nextLabel ?? "Next", Icon(nextIcon, { size: 16 }));
      message.textContent = text;
      message.dataset.tone = tone;
    },
  };
}
