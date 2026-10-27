/**
 * Step 4 — Build the Prosperr Recommended Portfolio.
 *
 * Input:  { portfolio, store, recommendation (engine summary), allocate (engine), onChange() }
 * Output: DOM element. The advisor chooses Lumpsum or SIP, sets the amount, picks funds (client's Invest /
 * Hold funds, or any fund in the AMFI universe found by typing its name) and allocations totalling 100%,
 * or applies a Prosperr Model Portfolio basket (model-portfolios.js) to fill the list.
 * Every amount shown comes from the engine's exact allocation.
 */

import { h } from "../../../design-system/components/dom.js";
import { Card } from "../../../design-system/components/basics.js";
import { BasketDialog } from "../../../design-system/components/basket-dialog.js";
import { SearchSelect } from "../../../design-system/components/search-select.js";
import { DonutChart } from "../../../design-system/components/charts.js";
import { Icon } from "../../../design-system/components/icons.js";
import { holdingKey } from "../../../calculation-engine/index.js";
import { emptyRow } from "../client-store.js";
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

/** Client's funds the advisor may recommend: those marked Invest or Hold. */
function clientFundOptions(portfolio, verdicts) {
  const active = portfolio.holdings.filter((holding) => holding.status === "active");
  const pick = (verdict) => active
    .filter((holding) => verdicts[holdingKey(holding)] === verdict)
    .map((holding) => ({ id: `h:${holdingKey(holding)}`, name: holding.schemeName ?? holding.isin, isin: holding.isin }));
  return { invest: pick("invest"), hold: pick("hold") };
}

export function createBuilderScreen({ portfolio, summary, store, recommendation, allocate, onChange, searchFunds }) {
  const model = store.state.recommended;
  const options = clientFundOptions(portfolio, store.state.verdicts);
  const optionById = new Map([...options.invest, ...options.hold].map((option) => [option.id, option]));

  // A client fund that is no longer Invest/Hold can't stay selected.
  for (const row of model.rows) {
    if (row.fundId.startsWith("h:") && !optionById.has(row.fundId)) Object.assign(row, emptyRow(), { pct: row.pct });
  }

  const rowsSlot = h("div", { class: "bld-rows" });
  const totalValue = h("span", { class: "bld-total-value ds-num" });
  const totalPill = h("span", { class: "bld-total-pill" });
  const issuesSlot = h("ul", { class: "bld-issues" });
  const previewSlot = h("div");
  let amountCells = [];
  let rowElements = [];

  // ---------- amount ----------
  const amountInput = h("input", { class: "bld-amount-input ds-num", inputmode: "numeric", autocomplete: "off", placeholder: "0", "aria-label": "Amount to invest in rupees" });
  const showAmount = () => { amountInput.value = model.amount ? model.amount.toLocaleString("en-IN") : ""; };
  showAmount();
  amountInput.addEventListener("input", () => {
    const digits = amountInput.value.replace(/[^\d]/g, "");
    model.amount = digits ? Number(digits) : null;
    commit();
  });
  amountInput.addEventListener("blur", showAmount);

  // ---------- Lumpsum / SIP ----------
  // How the amount is invested: once (lumpsum) or every month (SIP). Printed on The Way Forward page of the report.
  const MODE_TEXT = {
    lumpsum: { amount: "Lumpsum amount", column: "Lumpsum", preview: "Lumpsum amount", hint: "One-time investment" },
    sip: { amount: "Monthly SIP amount", column: "Monthly SIP", preview: "Monthly SIP", hint: "Invested every month" },
  };
  const modeOf = () => (model.mode === "sip" ? "sip" : "lumpsum");
  const amountLabel = h("label", { class: "bld-amount-label" });
  const amountHead = h("span");
  // A sliding switch: the coloured thumb moves under the chosen option (Lumpsum = one-time, SIP = every month).
  const modeButtons = ["lumpsum", "sip"].map((mode) => h("button", { type: "button", class: "bld-mode-btn", "data-mode": mode,
    title: MODE_TEXT[mode].hint, onclick: () => { model.mode = mode; showMode(); commit(); } },
    Icon(mode === "sip" ? "calendar" : "bolt", { size: 15, strokeWidth: 2.2 }), mode === "sip" ? "SIP" : "Lumpsum"));
  const modeToggle = h("div", { class: "bld-mode", role: "group", "aria-label": "Lumpsum or SIP" },
    h("span", { class: "bld-mode-thumb", "aria-hidden": "true" }), ...modeButtons);
  function showMode() {
    const text = MODE_TEXT[modeOf()];
    modeButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === modeOf())));
    modeToggle.dataset.mode = modeOf();
    amountLabel.textContent = text.amount;
    amountHead.textContent = text.column;
    amountInput.setAttribute("aria-label", `${text.amount} in rupees`);
  }

  const quickFills = [
    recommendation.byVerdict.sell.value ? ["Exit proceeds (Sell funds)", Math.round(recommendation.byVerdict.sell.value)] : null,
  ].filter(Boolean);

  // ---------- model portfolio baskets ----------
  const basketDialog = BasketDialog({
    eyebrow: "Prosperr Model Portfolios",
    title: "Start from a model portfolio",
    text: "Pick a basket to fill the list below with its funds and allocations. You can still edit every row afterwards.",
    note: "Choosing a basket replaces the funds currently in the list.",
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
  const basketLabel = h("span", { class: "bld-model-label" });
  const basketEnd = h("span", { class: "bld-model-end" });
  const basketButton = h("button", { type: "button", class: "bld-model-btn" },
    h("span", { class: "bld-model-icon" }, Icon("layers", { size: 16, strokeWidth: 2.2 })), basketLabel, basketEnd);
  const showBasketLabel = () => {
    const chosen = MODEL_PORTFOLIOS.find((basket) => basket.id === model.basketId);
    basketLabel.textContent = chosen ? `Model: ${chosen.name}` : "Model Portfolio";
    // Chosen: an ✕ to deselect, and the button takes the basket's own colour.
    basketEnd.replaceChildren(chosen ? Icon("x", { size: 13, strokeWidth: 2.6 }) : "");
    basketEnd.hidden = !chosen;
    basketButton.classList.toggle("is-set", Boolean(chosen));
    basketButton.style.setProperty("--model-accent", chosen ? `var(--${chosen.accent})` : "");
    basketButton.title = chosen ? "Click to deselect this model portfolio" : "Choose a Prosperr model portfolio";
  };
  showBasketLabel();
  // Click toggles: with a model selected, the button deselects it; otherwise it opens the baskets.
  basketButton.addEventListener("click", async () => {
    if (model.basketId) return clearBasket();
    const id = await basketDialog.choose(null);
    const basket = MODEL_PORTFOLIOS.find((item) => item.id === id);
    if (basket) applyBasket(basket);
  });

  /** Deselect the model and restore the list as it was before the basket was applied. */
  function clearBasket() {
    model.rows = model.rowsBeforeBasket?.length ? model.rowsBeforeBasket : [emptyRow()];
    model.rowsBeforeBasket = null;
    model.basketId = null;
    showBasketLabel();
    renderRows();
    commit();
  }

  /** Replace the list with the basket's funds; a fund the client already holds (Invest/Hold) links to that holding. */
  function applyBasket(basket) {
    if (!model.basketId) model.rowsBeforeBasket = model.rows.map((row) => ({ ...row }));
    const optionByIsin = new Map([...optionById.values()].filter((option) => option.isin).map((option) => [option.isin, option]));
    model.rows = basket.funds.map((fund) => {
      const own = fund.isin ? optionByIsin.get(fund.isin) : null;
      return own
        ? { fundId: own.id, name: own.name, isin: own.isin, pct: fund.pct }
        : { fundId: OTHER, name: fund.name, isin: fund.isin ?? "", pct: fund.pct };
    });
    model.basketId = basket.id;
    showBasketLabel();
    renderRows();
    commit();
  }

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
      label: "Fund", placeholder: "Search all funds — type a fund name, e.g. parag flexi direct", value: row.name,
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
    rowElements = model.rows.map((row, index) => {
      const pct = h("input", { class: "bld-pct-input ds-num", inputmode: "decimal", value: row.pct, placeholder: "0", "aria-label": "Allocation percent" });
      pct.addEventListener("input", () => { row.pct = pct.value.trim(); commit(); });
      const amountCell = h("div", { class: "bld-amount ds-num" });
      amountCells.push(amountCell);
      const remove = h("button", { type: "button", class: "bld-remove", "aria-label": "Remove fund", title: "Remove fund" }, Icon("x", { size: 16 }));
      remove.addEventListener("click", () => {
        model.rows.splice(index, 1);
        if (!model.rows.length) model.rows.push(emptyRow());
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
  function commit() {
    store.save();
    const result = allocate({ amount: model.amount, rows: model.rows });

    result.rows.forEach((row, index) => {
      amountCells[index].textContent = row.bps ? formatInr(row.amount) : "₹0";
      rowElements[index].classList.toggle("has-issue", result.issues.some((issue) => issue.index === index));
    });

    totalValue.textContent = `${result.totalPct.toFixed(2).replace(/\.00$/, "")}%`;
    const state = result.totalPct === 100 ? "done" : result.totalPct > 100 ? "over" : "left";
    totalValue.dataset.state = state;
    totalPill.dataset.state = state;
    totalPill.textContent = state === "done" ? "Complete" : state === "over" ? `${Math.abs(result.remainingPct).toFixed(2).replace(/\.00$/, "")}% over` : `${result.remainingPct.toFixed(2).replace(/\.00$/, "")}% left`;

    const messages = [...new Set(result.issues.map((issue) =>
      issue.index === null ? ISSUE_TEXT[issue.code] : `Row ${issue.index + 1}: ${ISSUE_TEXT[issue.code]}`))];
    issuesSlot.replaceChildren(...messages.map((text) => h("li", {}, Icon("alert", { size: 14 }), ` ${text}`)));
    issuesSlot.hidden = messages.length === 0;

    previewSlot.replaceChildren(previewCard(result, MODE_TEXT[modeOf()]));
    onChange();
  }

  renderRows();

  const addButton = h("button", { type: "button", class: "bld-add" }, Icon("plus", { size: 16 }), "Add fund");
  addButton.addEventListener("click", () => { model.rows.push(emptyRow()); renderRows(); commit(); });

  const element = h("main", { class: "app-step-page" },
    pageBand({
      eyebrow: "Step 4 · Recommended portfolio",
      title: "Where the client's money should go",
      text: "Choose the amount, the funds and how much goes into each. Every rupee is allocated exactly — this builds the final report.",
    }),
    h("div", { class: "app-container app-step-body bld-layout" },
      h("section", { class: "bld-panel site-reveal" },
        h("header", { class: "bld-panel-head" },
          h("h2", {}, "Build the Prosperr Recommended Portfolio"),
          h("p", {}, "Set the amount to invest, then pick funds and allocations. Allocations must total 100%.")),
        h("div", { class: "bld-amount-row" },
          amountLabel,
          h("div", { class: "bld-amount-field" }, h("span", { class: "bld-rupee" }, "₹"), amountInput),
          h("div", { class: "bld-quick" },
            // Current portfolio value is shown for reference only (not a click-to-fill shortcut).
            summary.totalMarketValue ? h("span", { class: "bld-info" }, `Current portfolio value: ${formatInr(summary.totalMarketValue, { whole: true })}`) : null,
            quickFills.map(([label, value]) =>
              h("button", { type: "button", class: "bld-chip", onclick: () => { model.amount = value; showAmount(); commit(); } },
                `${label}: ${formatInr(value, { whole: true })}`))),
          // Lumpsum / SIP stacked above Model Portfolio, at the right of the amount row.
          h("div", { class: "bld-actions" }, modeToggle, basketButton)),
        h("div", { class: "bld-head-row", "aria-hidden": "true" }, h("span", {}, "Fund"), h("span", {}, "Allocation"), amountHead, h("span")),
        rowsSlot,
        h("div", { class: "bld-foot" },
          addButton,
          h("div", { class: "bld-total" }, h("span", { class: "bld-total-label" }, "Total allocation"), totalValue, totalPill)),
        issuesSlot),
      h("div", { class: "rec-side-stack" }, previewSlot)),
    basketDialog.element
  );

  showMode();
  commit();
  return element;
}

function previewCard(result, modeText) {
  const items = result.rows
    .filter((row) => row.bps > 0 && row.name)
    .map((row) => ({ label: row.name, value: row.bps, display: `${(row.bps / 100).toFixed(2)}%` }));
  return Card({
    title: "Allocation preview",
    eyebrow: "Recommended portfolio",
    icon: "pie",
    accent: "var(--green)",
    children: items.length
      ? [
          DonutChart({ items, centerValue: formatInrCompact(result.allocatedAmount), centerLabel: "Allocated", maxSlices: 6, ariaLabel: "Recommended allocation" }),
          h("dl", { class: "bld-preview-stats" },
            h("div", {}, h("dt", {}, modeText.preview), h("dd", { class: "ds-num" }, formatInr(result.amount))),
            h("div", {}, h("dt", {}, "Allocated"), h("dd", { class: "ds-num" }, formatInr(result.allocatedAmount)))),
        ]
      : h("p", { class: "ds-muted" }, "Pick funds and allocations to see the portfolio take shape."),
  });
}
