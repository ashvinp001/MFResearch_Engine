/**
 * Step 4 — Build the Prosperr Recommended Portfolio.
 *
 * Input:  { portfolio, store, recommendation (engine summary), allocate (engine), onChange() }
 * Output: DOM element. The advisor chooses how the client invests — Lumpsum, SIP, or Lumpsum + SIP — and builds each
 * plan separately: its own amount, funds (client's Invest / Hold funds, or any fund in the AMFI universe found by
 * typing its name) and allocations totalling 100%, or a Prosperr Model Portfolio basket (model-portfolios.js).
 * With Lumpsum + SIP the report prints two tables, one per plan. Every amount shown comes from the engine's exact allocation.
 */

import { h } from "../../../design-system/components/dom.js";
import { Card } from "../../../design-system/components/basics.js";
import { BasketDialog } from "../../../design-system/components/basket-dialog.js";
import { SearchSelect } from "../../../design-system/components/search-select.js";
import { DonutChart } from "../../../design-system/components/charts.js";
import { Icon } from "../../../design-system/components/icons.js";
import { holdingKey } from "../../../calculation-engine/index.js";
import { activePlans, emptyRow } from "../client-store.js";
import { MODEL_PORTFOLIOS, RISK_LABELS } from "../model-portfolios.js";
import { formatInr, formatInrCompact } from "../../shared/format.js";
import { pageBand } from "../../shared/page-band.js";

const OTHER = "other";

const ISSUE_TEXT = {
  AMOUNT_INVALID: "Enter the amount to invest.",
  NO_ROWS: "Add at least one fund.",
  NO_FUND: "Search and pick a fund for this row.",
  ZERO_PCT: "Enter an allocation above 0%.",
  PCT_INVALID: "Allocation must be a number with up to 2 decimals.",
  DUPLICATE_FUND: "This fund is already in the portfolio.",
  ISIN_INVALID: "The ISIN entered is not valid (check-digit failed).",
  TOTAL_NOT_100: "Allocations must total exactly 100%.",
};

// How the money is invested. Printed on The Way Forward page of the report (one table per plan).
const PLAN_TEXT = {
  lumpsum: { title: "Lumpsum", sub: "One-time investment", amount: "Lumpsum amount", column: "Lumpsum", preview: "Lumpsum amount", icon: "bolt" },
  sip: { title: "Monthly SIP", sub: "Invested every month", amount: "Monthly SIP amount", column: "Monthly SIP", preview: "Monthly SIP", icon: "calendar" },
};
const MODES = [
  { mode: "lumpsum", label: "Lumpsum", icon: "bolt", hint: "One-time investment" },
  { mode: "sip", label: "SIP", icon: "calendar", hint: "Invested every month" },
  { mode: "both", label: "Lumpsum + SIP", icon: "layers", hint: "A one-time amount and a monthly SIP, each with its own funds" },
];

/** Client's funds the advisor may recommend: those marked Invest or Hold. */
function clientFundOptions(portfolio, verdicts) {
  const active = portfolio.holdings.filter((holding) => holding.status === "active");
  const pick = (verdict) => active
    .filter((holding) => verdicts[holdingKey(holding)] === verdict)
    .map((holding) => ({ id: `h:${holdingKey(holding)}`, name: holding.schemeName ?? holding.isin, isin: holding.isin }));
  return { invest: pick("invest"), hold: pick("hold") };
}

export function createBuilderScreen({ portfolio, summary, store, recommendation, allocate, onChange, searchFunds }) {
  const recommended = store.state.recommended;
  const options = clientFundOptions(portfolio, store.state.verdicts);
  const optionById = new Map([...options.invest, ...options.hold].map((option) => [option.id, option]));

  // A client fund that is no longer Invest/Hold can't stay selected (in either plan).
  for (const plan of Object.values(recommended.plans)) {
    for (const row of plan.rows) {
      if (row.fundId.startsWith("h:") && !optionById.has(row.fundId)) Object.assign(row, emptyRow(), { pct: row.pct });
    }
  }

  const basketDialog = BasketDialog({
    eyebrow: "Prosperr Model Portfolios",
    title: "Start from a model portfolio",
    text: "Pick a basket to fill the list below with its funds and allocations. You can still edit every row afterwards.",
    note: "Choosing a basket replaces the funds currently in this plan's list.",
    baskets: MODEL_PORTFOLIOS.map((basket) => ({
      id: basket.id,
      name: basket.name,
      tagline: basket.tagline,
      accent: `var(--${basket.accent})`,
      icon: basket.icon,
      badge: basket.draft ? "Draft" : null,
      riskLevel: basket.risk,
      riskLabel: `${RISK_LABELS[basket.risk]} risk`,
      items: basket.funds.map((fund) => ({ label: fund.name, value: Number(fund.pct), display: `${fund.pct}%` })),
    })),
  });

  // ---------- Lumpsum / SIP / Lumpsum + SIP ----------
  const modeButtons = MODES.map(({ mode, label, icon, hint }) => h("button", { type: "button", class: "bld-mode-btn", "data-mode": mode, title: hint,
    onclick: () => { recommended.mode = mode; render(); } }, Icon(icon, { size: 15, strokeWidth: 2.2 }), label));
  const modeToggle = h("div", { class: "bld-mode is-three", role: "group", "aria-label": "How the client invests" },
    h("span", { class: "bld-mode-thumb", "aria-hidden": "true" }), ...modeButtons);
  const modeHint = h("span", { class: "bld-mode-hint" });

  // ---------- model portfolio basket ----------
  // One plan: the button sits in that plan's amount row. Lumpsum + SIP: ONE button in the top row fills both plans
  // with the basket (each plan can still be edited afterwards); deselecting restores both lists.
  const basketButton = (getPlans, onDone, scope) => {
    const label = h("span", { class: "bld-model-label" });
    const end = h("span", { class: "bld-model-end" });
    const button = h("button", { type: "button", class: "bld-model-btn" },
      h("span", { class: "bld-model-icon" }, Icon("layers", { size: 16, strokeWidth: 2.2 })), label, end);
    const show = () => {
      const chosen = MODEL_PORTFOLIOS.find((basket) => basket.id === getPlans()[0].basketId);
      label.textContent = chosen ? `Model: ${chosen.name}` : "Model Portfolio";
      end.replaceChildren(chosen ? Icon("x", { size: 13, strokeWidth: 2.6 }) : "");
      end.hidden = !chosen;
      button.classList.toggle("is-set", Boolean(chosen));
      button.style.setProperty("--model-accent", chosen ? `var(--${chosen.accent})` : "");
      button.title = chosen ? "Click to deselect this model portfolio" : `Choose a Prosperr model portfolio${scope}`;
    };
    button.addEventListener("click", async () => {
      const plans = getPlans();
      if (plans[0].basketId) {
        plans.forEach(clearBasket);
      } else {
        const chosenId = await basketDialog.choose(null);
        const basket = MODEL_PORTFOLIOS.find((item) => item.id === chosenId);
        if (!basket) return;
        plans.forEach((plan) => applyBasket(plan, basket));
      }
      show();
      onDone();
    });
    show();
    return button;
  };
  function clearBasket(plan) {
    plan.rows = plan.rowsBeforeBasket?.length ? plan.rowsBeforeBasket : [emptyRow()];
    plan.rowsBeforeBasket = null;
    plan.basketId = null;
  }
  /** Replace a plan's list with the basket's funds; a fund the client already holds (Invest/Hold) links to that holding. */
  function applyBasket(plan, basket) {
    if (!plan.basketId) plan.rowsBeforeBasket = plan.rows.map((row) => ({ ...row }));
    const optionByIsin = new Map([...optionById.values()].filter((option) => option.isin).map((option) => [option.isin, option]));
    plan.rows = basket.funds.map((fund) => {
      const own = fund.isin ? optionByIsin.get(fund.isin) : null;
      return own
        ? { fundId: own.id, name: own.name, isin: own.isin, pct: fund.pct }
        : { fundId: OTHER, name: fund.name, isin: fund.isin ?? "", pct: fund.pct };
    });
    plan.basketId = basket.id;
  }
  const sharedBasketSlot = h("div", { class: "bld-shared-model" });

  const sectionsSlot = h("div", { class: "bld-plans" });
  const previewSlot = h("div", { class: "bld-previews" });
  let sections = [];

  function render() {
    const mode = ["sip", "both"].includes(recommended.mode) ? recommended.mode : "lumpsum";
    modeButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
    modeToggle.dataset.mode = mode;
    modeHint.textContent = MODES.find((m) => m.mode === mode).hint;
    const both = mode === "both";
    // The two plans only share a basket when both carry the same one (otherwise the shared button starts unset).
    if (both && recommended.plans.lumpsum.basketId !== recommended.plans.sip.basketId) {
      for (const plan of Object.values(recommended.plans)) if (plan.basketId) { plan.basketId = null; plan.rowsBeforeBasket = null; }
    }
    sharedBasketSlot.replaceChildren(...(both
      ? [basketButton(() => [recommended.plans.lumpsum, recommended.plans.sip], render, " for both the Lumpsum and the SIP")] : []));
    sections = activePlans(recommended).map(({ mode: planMode, plan }) => planSection(planMode, plan, both));
    sectionsSlot.replaceChildren(...sections.map((section) => section.element));
    sections.forEach((section) => section.commit(false));
    refreshPreview();
    store.save();
    onChange();
  }

  function refreshPreview() {
    previewSlot.replaceChildren(...sections.map((section) => previewCard(section.result(), PLAN_TEXT[section.mode], sections.length > 1)));
  }

  /** One plan (Lumpsum or Monthly SIP): amount, model basket, fund rows, total and issues. */
  function planSection(mode, plan, showHeading) {
    const text = PLAN_TEXT[mode];
    const rowsSlot = h("div", { class: "bld-rows" });
    const totalValue = h("span", { class: "bld-total-value ds-num" });
    const totalPill = h("span", { class: "bld-total-pill" });
    const issuesSlot = h("ul", { class: "bld-issues" });
    let amountCells = [];
    let rowElements = [];
    let last = allocate({ amount: plan.amount, rows: plan.rows });

    // ---------- amount ----------
    const amountInput = h("input", { class: "bld-amount-input ds-num", inputmode: "numeric", autocomplete: "off", placeholder: "0", "aria-label": `${text.amount} in rupees` });
    const showAmount = () => { amountInput.value = plan.amount ? plan.amount.toLocaleString("en-IN") : ""; };
    showAmount();
    amountInput.addEventListener("input", () => {
      const digits = amountInput.value.replace(/[^\d]/g, "");
      plan.amount = digits ? Number(digits) : null;
      commit();
    });
    amountInput.addEventListener("blur", showAmount);

    // The exit proceeds suit a one-time investment only.
    const quickFills = mode === "lumpsum" && recommendation.byVerdict.sell.value
      ? [["Exit proceeds (Sell funds)", Math.round(recommendation.byVerdict.sell.value)]] : [];

    // Model portfolio: here only with a single plan (Lumpsum + SIP has one shared button in the top row).
    const planBasket = showHeading ? null : basketButton(() => [plan], () => { renderRows(); commit(); }, "");

    // ---------- rows ----------
    /**
     * One searchable fund box per row. Empty or short text → the client's Invest / Hold funds; typing → those
     * that match, then every matching fund in the AMFI universe. A pick fills the exact name and ISIN.
     */
    function fundPicker(row) {
      const clientItems = (query) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const matches = (name) => words.every((word) => name.toLowerCase().includes(word));
        return [
          ...options.invest.filter((o) => matches(o.name)).map((o) => ({ label: o.name, sub: o.isin ?? "", group: "Client's funds — Invest", client: o })),
          ...options.hold.filter((o) => matches(o.name)).map((o) => ({ label: o.name, sub: o.isin ?? "", group: "Client's funds — Hold", client: o })),
        ];
      };
      const chosen = h("div", { class: "bld-other-chosen" });
      const showChosen = () => chosen.replaceChildren(...(row.isin
        ? [h("span", { class: "app-tag ds-mono" }, row.isin), row.schemeCode ? h("span", { class: "app-tag" }, `AMFI ${row.schemeCode}`) : null,
           row.fundId.startsWith("h:") ? h("span", { class: "app-tag" }, "Client's fund") : null].filter(Boolean)
        : []));
      const picker = SearchSelect({
        label: "Fund", placeholder: "Search all funds — a fund name (e.g. parag flexi direct) or its ISIN", value: row.name,
        search: async (query) => {
          const own = clientItems(query);
          if (!query) return own;
          const ownIsins = new Set(own.map((item) => item.client.isin));
          const universe = (await searchFunds(query)).filter((item) => !ownIsins.has(item.scheme.isin))
            .map((item) => ({ ...item, group: "All funds (AMFI list)" }));
          return [...own, ...universe];
        },
        onPick: (item) => {
          if (item.client) Object.assign(row, { fundId: item.client.id, name: item.client.name, isin: item.client.isin ?? "", schemeCode: null });
          else Object.assign(row, { fundId: OTHER, name: item.label, isin: item.scheme.isin ?? item.scheme.isinReinvest ?? "", schemeCode: item.scheme.schemeCode });
          showChosen();
          commit();
        },
      });
      showChosen();
      return h("div", { class: "bld-picker" }, picker.element, chosen);
    }
    function renderRows() {
      amountCells = [];
      rowElements = plan.rows.map((row, index) => {
        const pct = h("input", { class: "bld-pct-input ds-num", inputmode: "decimal", value: row.pct, placeholder: "0", "aria-label": "Allocation percent" });
        pct.addEventListener("input", () => { row.pct = pct.value.trim(); commit(); });
        const amountCell = h("div", { class: "bld-amount ds-num" });
        amountCells.push(amountCell);
        const remove = h("button", { type: "button", class: "bld-remove", "aria-label": "Remove fund", title: "Remove fund" }, Icon("x", { size: 16 }));
        remove.addEventListener("click", () => {
          plan.rows.splice(index, 1);
          if (!plan.rows.length) plan.rows.push(emptyRow());
          renderRows();
          commit();
        });
        return h("div", { class: "bld-row" },
          h("div", { class: "bld-fund" }, fundPicker(row)),
          h("div", { class: "bld-pct" }, pct, h("span", {}, "%")),
          amountCell,
          remove);
      });
      rowsSlot.replaceChildren(...rowElements);
    }

    // ---------- computed parts ----------
    /** Recompute this plan; notify = false while the whole screen is being drawn (render() notifies once). */
    function commit(notify = true) {
      last = allocate({ amount: plan.amount, rows: plan.rows });
      last.rows.forEach((row, index) => {
        amountCells[index].textContent = row.bps ? formatInr(row.amount) : "₹0";
        rowElements[index].classList.toggle("has-issue", last.issues.some((issue) => issue.index === index));
      });
      totalValue.textContent = `${last.totalPct.toFixed(2).replace(/\.00$/, "")}%`;
      const state = last.totalPct === 100 ? "done" : last.totalPct > 100 ? "over" : "left";
      totalValue.dataset.state = state;
      totalPill.dataset.state = state;
      totalPill.textContent = state === "done" ? "Complete" : state === "over" ? `${Math.abs(last.remainingPct).toFixed(2).replace(/\.00$/, "")}% over` : `${last.remainingPct.toFixed(2).replace(/\.00$/, "")}% left`;
      const messages = [...new Set(last.issues.map((issue) =>
        issue.index === null ? ISSUE_TEXT[issue.code] : `Row ${issue.index + 1}: ${ISSUE_TEXT[issue.code]}`))];
      issuesSlot.replaceChildren(...messages.map((message) => h("li", {}, Icon("alert", { size: 14 }), ` ${message}`)));
      issuesSlot.hidden = messages.length === 0;
      if (notify) {
        store.save();
        refreshPreview();
        onChange();
      }
    }

    renderRows();
    const addButton = h("button", { type: "button", class: "bld-add" }, Icon("plus", { size: 16 }), "Add fund");
    addButton.addEventListener("click", () => { plan.rows.push(emptyRow()); renderRows(); commit(); });

    const element = h("section", { class: `bld-plan is-${mode}`, "aria-label": `${text.title} portfolio` },
      showHeading
        ? h("div", { class: "bld-plan-head" }, h("span", { class: "bld-plan-icon" }, Icon(text.icon, { size: 16, strokeWidth: 2.2 })),
            h("strong", {}, `${text.title} portfolio`), h("span", {}, text.sub))
        : null,
      h("div", { class: "bld-amount-row" },
        h("label", { class: "bld-amount-label" }, text.amount),
        h("div", { class: "bld-amount-field" }, h("span", { class: "bld-rupee" }, "₹"), amountInput),
        h("div", { class: "bld-quick" },
          // Current portfolio value is shown for reference only (not a click-to-fill shortcut).
          mode === "lumpsum" && summary.totalMarketValue ? h("span", { class: "bld-info" }, `Current portfolio value: ${formatInr(summary.totalMarketValue, { whole: true })}`) : null,
          quickFills.map(([label, value]) =>
            h("button", { type: "button", class: "bld-chip", onclick: () => { plan.amount = value; showAmount(); commit(); } },
              `${label}: ${formatInr(value, { whole: true })}`))),
        planBasket ? h("div", { class: "bld-actions" }, planBasket) : null),
      h("div", { class: "bld-head-row", "aria-hidden": "true" }, h("span", {}, "Fund"), h("span", {}, "Allocation"), h("span", {}, text.column), h("span")),
      rowsSlot,
      h("div", { class: "bld-foot" },
        addButton,
        h("div", { class: "bld-total" }, h("span", { class: "bld-total-label" }, "Total allocation"), totalValue, totalPill)),
      issuesSlot);
    return { mode, element, commit, result: () => last };
  }

  const element = h("main", { class: "app-step-page" },
    pageBand({
      eyebrow: "Step 4 · Recommended portfolio",
      title: "Where the client's money should go",
      text: "Choose Lumpsum, SIP or both, then the amount, the funds and how much goes into each. Every rupee is allocated exactly — this builds the final report.",
    }),
    h("div", { class: "app-container app-step-body bld-layout" },
      h("section", { class: "bld-panel site-reveal" },
        h("header", { class: "bld-panel-head" },
          h("h2", {}, "Build the Prosperr Recommended Portfolio"),
          h("p", {}, "Choose how the client invests, then pick funds and allocations for each plan. Allocations must total 100% in every plan.")),
        // Label and hint on the left; the switch (and, for Lumpsum + SIP, the one Model Portfolio button) at the far right.
        h("div", { class: "bld-mode-row" },
          h("div", { class: "bld-mode-text" }, h("span", { class: "bld-amount-label" }, "How the client invests"), modeHint),
          h("div", { class: "bld-mode-right" }, modeToggle, sharedBasketSlot)),
        sectionsSlot),
      h("div", { class: "rec-side-stack" }, previewSlot)),
    basketDialog.element
  );

  render();
  return element;
}

function previewCard(result, planText, labelled) {
  const items = result.rows
    .filter((row) => row.bps > 0 && row.name)
    .map((row) => ({ label: row.name, value: row.bps, display: `${(row.bps / 100).toFixed(2)}%` }));
  return Card({
    title: labelled ? `${planText.title} allocation` : "Allocation preview",
    eyebrow: "Recommended portfolio",
    icon: "pie",
    accent: "var(--green)",
    children: items.length
      ? [
          DonutChart({ items, centerValue: formatInrCompact(result.allocatedAmount), centerLabel: "Allocated", maxSlices: 6, ariaLabel: `${planText.title} allocation` }),
          h("dl", { class: "bld-preview-stats" },
            h("div", {}, h("dt", {}, planText.preview), h("dd", { class: "ds-num" }, formatInr(result.amount))),
            h("div", {}, h("dt", {}, "Allocated"), h("dd", { class: "ds-num" }, formatInr(result.allocatedAmount)))),
        ]
      : h("p", { class: "ds-muted" }, `Pick funds and allocations to see the ${planText.title.toLowerCase()} take shape.`),
  });
}
