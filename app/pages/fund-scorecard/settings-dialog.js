/**
 * Fund Scorecard settings — a modal for the owner to change the pillar weights and the rating conditions.
 *
 * openPasswordDialog({ passwordSet, onUnlocked(password) }) → void   — asks for the edit password first (checked by the server)
 * openSettingsDialog({ settings, defaults, pillars, colors, password, onSaved }) → void
 *   settings: the current { weights, conditions } (already resolved over the defaults)
 *   onSaved(saved) is called with the server's reply after a successful save; the dialog then closes.
 * Weights: a slider and a number per pillar, a live mix bar and a total meter — Save stays off until the total is 100%.
 * Conditions: steppers with their allowed range. The server validates again and accepts changes from the owner's PC only.
 */

import { h } from "../../../design-system/components/dom.js";
import { Icon } from "../../../design-system/components/icons.js";
import { saveScorecardSettings, setScorecardPassword, verifyScorecardPassword } from "../../shared/market-data.js";

const PILLAR_HINT = {
  returns: "1Y, 3Y and 5Y returns",
  riskAdjusted: "Sharpe, Sortino, Information ratio",
  benchmark: "Alpha, excess over the index",
  volatility: "Standard deviation, Beta",
  downside: "Drawdown, recovery, Calmar, capture",
  consistency: "Rolling returns, calendar quartiles",
  quality: "Fund size (AUM)",
};
const CONDITIONS = {
  minHistoryYears: { label: "Minimum history", unit: "years", min: 2, max: 10, step: 1, icon: "calendar",
    hint: (v) => (v < 3 ? "2 years: every fund's risk is measured over the last 24 months" : "Risk measured over 36 monthly returns (standard)") },
  maxNavAgeDays: { label: "Maximum NAV age", unit: "days", min: 1, max: 30, step: 1, icon: "refresh", hint: () => "Older NAV = closed or stale scheme" },
  minPeers: { label: "Minimum eligible funds", unit: "funds", min: 3, max: 50, step: 1, icon: "layers", hint: () => "Per category, and per measure" },
  minAumCr: { label: "Minimum AUM", unit: "₹ Cr", min: 0, max: 100000, step: 100, icon: "wallet", hint: () => "Scheme-level fund size" },
};

/**
 * The edit password, asked before the settings open (the server checks it, and again on save; nothing is stored here).
 * Modes: "unlock" (default) and "create" (no password set yet — new + confirm; writes only a hash on the server, owner's
 * PC only). The owner made the password final (2026-10-28): the page offers no way to change it, and the server refuses.
 */
export function openPasswordDialog({ passwordSet, onUnlocked }) {
  let mode = passwordSet ? "unlock" : "create";
  const close = () => { dialog.close(); dialog.remove(); };
  const title = h("h2", { id: "fsp-title" });
  const subtitle = h("p", {});
  const body = h("div", { class: "fsp-body" });

  const field = (placeholder, autocomplete) => {
    const input = h("input", { type: "password", class: "fsp-input", autocomplete, placeholder, "aria-label": placeholder });
    const reveal = h("button", { type: "button", class: "fsp-reveal", "aria-label": "Show password", onclick: () => {
      const shown = input.type === "text";
      input.type = shown ? "password" : "text";
      reveal.setAttribute("aria-label", shown ? "Show password" : "Hide password");
      reveal.classList.toggle("is-on", !shown);
    } }, Icon("eye", { size: 17 }));
    return { input, element: h("label", { class: "fsp-field" }, input, reveal) };
  };
  const shake = () => { dialog.classList.remove("is-shake"); void dialog.offsetWidth; dialog.classList.add("is-shake"); };

  function render() {
    const error = h("p", { class: "fss-error", role: "alert" });
    const next = field(mode === "unlock" ? "Edit password" : "New password (at least 8 characters)", mode === "unlock" ? "current-password" : "new-password");
    const confirm = field("Type the new password again", "new-password");
    const label = mode === "unlock" ? "Unlock" : "Create password";
    const submit = h("button", { type: "submit", class: "fss-save" }, Icon(mode === "unlock" ? "lock" : "checkCircle", { size: 15 }), label);
    title.textContent = mode === "unlock" ? "Owner access" : "Create the edit password";
    subtitle.textContent = mode === "unlock" ? "Enter the edit password to change the scorecard settings."
      : "Set it once on this PC — only a secure hash is stored, never the password.";
    const form = h("form", { class: "fsp-form" },
      next.element, mode === "unlock" ? null : confirm.element, error,
      h("div", { class: "fsp-actions" },
        h("span", { class: "fss-spacer" }),
        h("button", { type: "button", class: "fss-ghost", onclick: close }, "Cancel"), submit));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.textContent = "";
      if (!next.input.value) { error.textContent = "Enter the password."; next.input.focus(); return; }
      submit.disabled = true;
      submit.lastChild.textContent = "Please wait…";
      const result = mode === "unlock"
        ? await verifyScorecardPassword(next.input.value)
        : await setScorecardPassword({ password: next.input.value, confirm: confirm.input.value });
      submit.lastChild.textContent = label;
      submit.disabled = false;
      if (result.error) { error.textContent = result.error; shake(); return; }
      const password = next.input.value;
      close();
      onUnlocked(password);   // creating also unlocks with the new password
    });
    body.replaceChildren(form);
    next.input.focus();
  }

  const dialog = h("dialog", { class: "fss fsp", "aria-labelledby": "fsp-title" },
    h("header", { class: "fss-head" },
      h("span", { class: "fss-head-icon" }, Icon("lock", { size: 22, strokeWidth: 1.8 })),
      h("div", {}, title, subtitle),
      h("button", { type: "button", class: "fss-x", "aria-label": "Close", onclick: close }, Icon("x", { size: 20 }))),
    body);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
  render();
}

/** Weight mix as a donut: one arc per pillar in its colour, small gaps between; a short total leaves a grey gap, an
 * over-full total is scaled to fit (and the centre turns red). */
function donutChart(pillars, weights, colors, sum) {
  const R = 52, C = 2 * Math.PI * R, GAP = 3;
  const scale = sum > 100 ? 100 / sum : 1;
  const arcs = [];
  let start = 0;
  for (const p of pillars) {
    const w = Number.isFinite(weights[p.key]) ? weights[p.key] : 0;
    if (w <= 0) continue;
    const len = (w * scale / 100) * C;
    arcs.push(h("circle", { cx: 70, cy: 70, r: R, class: "fss-arc", style: { stroke: `var(--${colors[p.key]})` },
      "stroke-dasharray": `${Math.max(0.5, len - GAP)} ${C}`, "stroke-dashoffset": String(-start), transform: "rotate(-90 70 70)" },
      h("title", {}, `${p.label} ${w}%`)));
    start += len;
  }
  return h("svg", { viewBox: "0 0 140 140", role: "img", "aria-label": `Weights total ${sum}%` },
    h("circle", { cx: 70, cy: 70, r: R, class: "fss-arc-track" }), ...arcs);
}

export function openSettingsDialog({ settings, defaults, pillars, colors, password, onSaved }) {
  const weights = { ...settings.weights };
  const conditions = { ...settings.conditions };
  const controls = { weights: {}, conditions: {} };

  const donut = h("div", { class: "fss-donut" });
  const legend = h("div", { class: "fss-legend" });
  const error = h("p", { class: "fss-error", role: "alert" });
  const save = h("button", { type: "button", class: "fss-save" }, Icon("checkCircle", { size: 16 }), "Save settings");

  function refresh() {
    const sum = pillars.reduce((s, p) => s + (Number.isInteger(weights[p.key]) ? weights[p.key] : NaN), 0);
    const ok = sum === 100;
    const note = !Number.isFinite(sum) ? "Whole numbers only" : ok ? "Ready to save" : sum < 100 ? `Add ${100 - sum}% more` : `Remove ${sum - 100}%`;
    dialog.dataset.state = ok ? "ok" : "bad";
    donut.replaceChildren(donutChart(pillars, weights, colors, Number.isFinite(sum) ? sum : 0), h("div", { class: "fss-donut-centre" },
      h("b", {}, Number.isFinite(sum) ? `${sum}%` : "—"), h("small", {}, note)));
    legend.replaceChildren(...pillars.map((p) => h("span", { class: `fss-chip${weights[p.key] > 0 ? "" : " is-zero"}`, style: { "--accent": `var(--${colors[p.key]})` } },
      h("i", {}), h("span", {}, p.label), h("b", {}, Number.isFinite(weights[p.key]) ? `${weights[p.key]}%` : "—"))));
    for (const p of pillars) {
      const { range } = controls.weights[p.key];
      range.style.setProperty("--fill", `${Math.min(100, Math.max(0, ((weights[p.key] || 0) / 50) * 100))}%`);   // slider runs 0–50%
    }
    for (const [k, def] of Object.entries(CONDITIONS)) controls.conditions[k].hint.textContent = def.hint(conditions[k]);
    save.disabled = !ok;
  }

  const setWeight = (key, value, from) => {
    weights[key] = Number.isInteger(value) ? Math.max(0, Math.min(100, value)) : NaN;
    const { range, number } = controls.weights[key];
    if (from !== "range" && Number.isFinite(weights[key])) range.value = String(weights[key]);
    if (from !== "number") number.value = Number.isFinite(weights[key]) ? String(weights[key]) : number.value;
    refresh();
  };
  const setCondition = (key, value) => {
    const def = CONDITIONS[key];
    conditions[key] = Number.isFinite(value) ? Math.max(def.min, Math.min(def.max, value)) : def.min;
    controls.conditions[key].input.value = String(conditions[key]);
    refresh();
  };

  const weightRows = pillars.map((p) => {
    const range = h("input", { type: "range", min: 0, max: 50, step: 1, value: String(Math.min(50, weights[p.key])), class: "fss-range", "aria-label": `${p.label} weight` });
    const number = h("input", { type: "number", min: 0, max: 100, step: 1, value: String(weights[p.key]), class: "fss-num", "aria-label": `${p.label} weight, percent` });
    range.addEventListener("input", () => setWeight(p.key, Number(range.value), "range"));
    number.addEventListener("input", () => setWeight(p.key, Number(number.value), "number"));
    controls.weights[p.key] = { range, number };
    return h("div", { class: "fss-weight", style: { "--accent": `var(--${colors[p.key]})` } },
      h("div", { class: "fss-weight-label" }, h("i", {}), h("div", {}, h("strong", {}, p.label), h("small", {}, PILLAR_HINT[p.key]))),
      range, h("label", { class: "fss-num-wrap" }, number, h("span", {}, "%")));
  });

  const conditionCards = Object.entries(CONDITIONS).map(([key, def]) => {
    const input = h("input", { type: "number", min: def.min, max: def.max, step: def.step, value: String(conditions[key]), "aria-label": def.label });
    input.addEventListener("change", () => setCondition(key, Number(input.value)));
    const hint = h("small", {});
    controls.conditions[key] = { input, hint };
    const step = (dir) => setCondition(key, (Number(input.value) || 0) + dir * def.step);
    return h("div", { class: "fss-cond" },
      h("div", { class: "fss-cond-head" }, h("span", { class: "fss-cond-icon" }, Icon(def.icon, { size: 16, strokeWidth: 2 })), h("strong", {}, def.label)),
      h("div", { class: "fss-stepper" },
        h("button", { type: "button", "aria-label": `Decrease ${def.label}`, onclick: () => step(-1) }, "−"),
        input, h("span", { class: "fss-unit" }, def.unit),
        h("button", { type: "button", "aria-label": `Increase ${def.label}`, onclick: () => step(1) }, "+")),
      hint, h("small", { class: "fss-range-note" }, `Allowed ${def.min.toLocaleString("en-IN")}–${def.max.toLocaleString("en-IN")}`));
  });

  const close = () => { dialog.close(); dialog.remove(); };
  const loadDefaults = () => {
    for (const p of pillars) setWeight(p.key, defaults.weights[p.key]);
    for (const k of Object.keys(CONDITIONS)) setCondition(k, defaults.conditions[k]);
  };
  save.addEventListener("click", async () => {
    save.disabled = true;
    error.textContent = "";
    save.lastChild.textContent = "Saving…";
    const result = await saveScorecardSettings({ weights, conditions }, password);
    save.lastChild.textContent = "Save settings";
    if (result.error) { error.textContent = result.error; refresh(); return; }
    close();
    onSaved(result.settings);
  });

  const dialog = h("dialog", { class: "fss", "aria-labelledby": "fss-title" },
    h("header", { class: "fss-head" },
      h("span", { class: "fss-head-icon" }, Icon("layers", { size: 22, strokeWidth: 1.8 })),
      h("div", {}, h("h2", { id: "fss-title" }, "Scorecard settings"), h("p", {}, "Only you can change these — your team sees them read-only.")),
      h("button", { type: "button", class: "fss-x", "aria-label": "Close", onclick: close }, Icon("x", { size: 20 }))),
    h("div", { class: "fss-body" },
      h("section", { class: "fss-section" },
        h("div", { class: "fss-section-head" }, h("h3", {}, "Pillar weights"),
          h("p", {}, "Drag a slider or type a number — the total must be 100%.")),
        h("div", { class: "fss-summary" }, donut, legend),
        h("div", { class: "fss-weights" }, weightRows)),
      h("section", { class: "fss-section" },
        h("div", { class: "fss-section-head" }, h("h3", {}, "Rating conditions"), h("p", {}, "A fund failing any one is Not rated and never recommended.")),
        h("div", { class: "fss-conds" }, conditionCards))),
    h("footer", { class: "fss-foot" },
      error,
      h("button", { type: "button", class: "fss-ghost", onclick: loadDefaults }, Icon("refresh", { size: 15 }), "Load defaults"),
      h("span", { class: "fss-spacer" }),
      h("button", { type: "button", class: "fss-ghost", onclick: close }, "Cancel"),
      save));
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  document.body.append(dialog);
  refresh();
  dialog.showModal();
}
