/**
 * Step 2 — Portfolio review dashboard: glue between engine output and Design System.
 *
 * Input:  { portfolio (validated NormalizedPortfolio), summary (summarizePortfolio),
 *           holdingGain, store (client choices; salutation is set here), onChange() }
 * Output: a DOM element. No math here beyond choosing which values to show.
 */

import { h } from "../../../design-system/components/dom.js";
import { Badge, Callout, Card, KpiCard } from "../../../design-system/components/basics.js";
import { DataTable } from "../../../design-system/components/data-table.js";
import { BarChart, DonutChart } from "../../../design-system/components/charts.js";
import { Icon } from "../../../design-system/components/icons.js";
import { accentAt } from "../../../design-system/tokens.js";
import {
  DASH, asPrinted, titleCase, formatAmount, formatDate, formatInr, formatInrCompact, formatSignedAmount, formatSignedInr, formatSignedPct, initials,
} from "../../shared/format.js";
import { FLAG_LABEL, FORMAT_LABEL, statementProblems, verificationItems } from "../copy.js";
import { SALUTATIONS } from "../client-store.js";

const TOP_HOLDINGS = 6;

export function createReviewScreen({ portfolio, summary, holdingGain, store, onChange }) {
  const dialog = createTransactionDialog();
  let showRedeemed = false;
  const holdingsSlot = h("div");

  const renderHoldings = () => holdingsSlot.replaceChildren(
    holdingsTable(portfolio, summary, holdingGain, showRedeemed, (holding) => dialog.open(holding))
  );
  renderHoldings();

  const redeemedToggle = summary.redeemedCount
    ? h("label", { class: "app-toggle" },
        h("input", { type: "checkbox", onchange: (event) => { showRedeemed = event.target.checked; renderHoldings(); } }),
        h("span", {}, `Show ${summary.redeemedCount} fully redeemed fund${summary.redeemedCount > 1 ? "s" : ""}`))
    : null;

  return h("main", { class: "app-dashboard" },
    heroBand(portfolio, summary, store, onChange),
    h("div", { class: "app-container app-dashboard-body" },
      kpiRow(summary),
      reviewNotice(portfolio),
      chartsRow(portfolio, summary),
      h("section", { class: "app-section" },
        sectionHead("Holdings", "Every fund in the client's statement", redeemedToggle),
        holdingsSlot,
        h("p", { class: "app-note" }, Icon("info", { size: 14 }), " Units and NAV are shown exactly as printed on the statement. Click any fund to see its transactions.")
      ),
      checksSection(portfolio)
    ),
    dialog.element
  );
}

function sectionHead(eyebrow, title, aside) {
  return h("div", { class: "app-section-head app-section-head-row" },
    h("div", {}, h("div", { class: "ds-eyebrow" }, eyebrow), h("h2", {}, title)),
    aside ?? null);
}

/** Salutation chosen by the advisor (never inferred from the name). */
function salutationSelect(store, onChange) {
  const select = h("select", { class: "app-salutation", "aria-label": "Client salutation" },
    h("option", { value: "" }, "Mr. / Ms."),
    SALUTATIONS.map((salutation) => h("option", { value: salutation }, salutation)));
  select.value = store.state.salutation;
  select.dataset.empty = String(!store.state.salutation);
  select.addEventListener("change", () => {
    store.state.salutation = select.value;
    select.dataset.empty = String(!select.value);
    store.save();
    onChange();
  });
  return select;
}

export function heroBand(portfolio, summary, store, onChange) {
  const { investor, source, integrity } = portfolio;
  const name = titleCase(investor.name);
  const asOf = formatDate(source.statementAsOf ?? source.statementPeriod.to);
  const gainUp = summary.unrealisedGain === null || summary.unrealisedGain >= 0;
  const verified = integrity.status === "ok";

  return h("section", { class: "site-band" },
    h("div", { class: "site-band-inner app-dash-hero" },
      h("div", { class: "app-dash-hero-top" },
        h("div", { class: "site-reveal" },
          h("div", { class: "ds-eyebrow" }, "Client Name"),
          h("h1", { class: "app-dash-greeting" }, salutationSelect(store, onChange), h("span", {}, name ?? "Client")),
          h("p", { class: "app-dash-sub" }, `Mutual fund holdings as on ${asOf}.`)),
        h("div", { class: "app-dash-hero-actions site-reveal", style: { "--i": 1 } },
          h("span", { class: `site-chip ${verified ? "" : "app-chip-review"}` },
            Icon(verified ? "shield" : "alert", { size: 16 }), verified ? "Verified with the statement" : "Some figures need review"),
          h("span", { class: "site-chip" }, Icon("file", { size: 16 }), FORMAT_LABEL[source.format]))
      ),
      h("div", { class: "app-dash-figures site-reveal", style: { "--i": 2 } },
        h("div", {},
          h("div", { class: "app-dash-label" }, "Current value"),
          h("div", { class: "app-dash-value site-gradient-text ds-num" }, formatInr(summary.totalMarketValue, { whole: true })),
          summary.unrealisedGain !== null
            ? h("span", { class: `app-gain-pill ${gainUp ? "is-up" : "is-down"}` },
                Icon("trend", { size: 16 }),
                `${formatSignedInr(summary.unrealisedGain, { whole: true })} (${formatSignedPct(summary.unrealisedGainPct)}) overall ${gainUp ? "gain" : "loss"}`)
            : null),
        h("dl", { class: "app-dash-stats" },
          stat("Invested", formatInr(summary.totalCostValue, { whole: true })),
          stat("Funds", String(summary.activeCount)),
          stat("AMCs", summary.amcCount ? String(summary.amcCount) : DASH),
          stat("PAN", investor.pans.length ? investor.pans.join(", ") : DASH))
      )
    )
  );
}

function stat(label, value) {
  return h("div", {}, h("dt", {}, label), h("dd", { class: "ds-num" }, value));
}

export function kpiRow(summary) {
  const gainTone = summary.unrealisedGain === null ? undefined : summary.unrealisedGain >= 0 ? "positive" : "negative";
  const costNote = summary.holdingsWithoutCost
    ? `Excludes ${summary.holdingsWithoutCost} fund(s) with no cost on the statement`
    : "Total amount invested";
  return h("section", { class: "app-kpis", "aria-label": "Portfolio summary" },
    [
      KpiCard({ label: "Current value", value: formatInr(summary.totalMarketValue, { whole: true }), sub: "Value of all funds today", accent: accentAt(0), icon: "wallet" }),
      KpiCard({ label: "Amount invested", value: formatInr(summary.totalCostValue, { whole: true }), sub: costNote, accent: accentAt(1), icon: "invested" }),
      KpiCard({ label: "Overall gain", value: formatSignedInr(summary.unrealisedGain, { whole: true }), sub: summary.unrealisedGainPct === null ? DASH : `${formatSignedPct(summary.unrealisedGainPct)} on amount invested`, tone: gainTone, accent: accentAt(2), icon: "trend" }),
      KpiCard({ label: "Funds held", value: String(summary.activeCount), sub: summary.amcCount ? `Across ${summary.amcCount} AMC${summary.amcCount > 1 ? "s" : ""}` : "Mutual fund schemes", accent: accentAt(3), icon: "layers" }),
      KpiCard({ label: "Annual return (XIRR)", value: DASH, sub: "Coming soon", accent: accentAt(4), icon: "sparkle" }),
    ].map((card, i) => { card.classList.add("site-reveal"); card.style.setProperty("--i", i); return card; })
  );
}

function reviewNotice(portfolio) {
  const { status, warnings } = portfolio.integrity;
  if (status === "ok") {
    return warnings.length ? Callout({ tone: "info", title: "Good to know", items: warnings }) : null;
  }
  return Callout({
    tone: "warning",
    title: "A few figures need a quick review",
    body: "Every value is shown exactly as read from the statement, but some of them didn't add up. Please compare these with the PDF before sharing with the client:",
    items: statementProblems(portfolio),
  });
}

function chartsRow(portfolio, summary) {
  const active = portfolio.holdings.filter((holding) => holding.status === "active" && holding.marketValue !== null);
  const topHoldings = [...active].sort((p, q) => q.marketValue - p.marketValue).slice(0, TOP_HOLDINGS);

  // Depository statements don't print the fund house per row; fall back to per-fund allocation.
  const hasAmcs = summary.amcCount > 0;
  const allocationItems = hasAmcs
    ? summary.byAmc.map((item) => ({ label: item.amc, value: item.marketValue, display: formatInr(item.marketValue, { whole: true }) }))
    : active.map((holding) => ({ label: holding.schemeName ?? holding.isin, value: holding.marketValue, display: formatInr(holding.marketValue, { whole: true }) }));

  return h("section", { class: "ds-grid" },
    Card({
      title: hasAmcs ? "AMC Holding" : "Fund Holding",
      eyebrow: "Where the money is",
      icon: "pie",
      accent: accentAt(0),
      className: "ds-col-5 site-reveal",
      children: allocationItems.length
        ? DonutChart({ items: allocationItems, centerValue: formatInrCompact(summary.totalMarketValue), centerLabel: "Total value", ariaLabel: "Allocation donut chart" })
        : h("p", { class: "ds-muted" }, "The statement doesn't show current values."),
    }),
    Card({
      title: "Biggest holdings",
      eyebrow: "Top funds by value",
      icon: "list",
      accent: accentAt(1),
      className: "ds-col-7 site-reveal",
      children: topHoldings.length
        ? BarChart({
            items: topHoldings.map((holding) => ({
              label: holding.schemeName ?? holding.isin,
              value: holding.marketValue,
              display: formatInr(holding.marketValue, { whole: true }),
              tooltip: [formatInr(holding.marketValue), holding.isin ?? ""],
            })),
            ariaLabel: "Top holdings by current value",
          })
        : h("p", { class: "ds-muted" }, "The statement doesn't show current values."),
    })
  );
}

function holdingsTable(portfolio, summary, holdingGain, showRedeemed, onSelect) {
  const visible = portfolio.holdings.filter((holding) => showRedeemed || holding.status === "active");
  const byAmc = new Map();
  for (const holding of visible) {
    const key = holding.amc ?? "Mutual funds";
    if (!byAmc.has(key)) byAmc.set(key, []);
    byAmc.get(key).push(holding);
  }
  const accentByAmc = new Map([...byAmc.keys()].map((amc, i) => [amc, accentAt(i)]));

  const groups = [...byAmc.entries()].map(([amc, rows]) => ({
    label: amc,
    sub: `${rows.length} fund${rows.length > 1 ? "s" : ""}`,
    accent: accentByAmc.get(amc),
    rows,
  }));

  const columns = [
    { key: "fund", label: "Fund", render: (holding) => fundCell(holding, accentByAmc.get(holding.amc ?? "Mutual funds")) },
    { key: "units", label: "Units", align: "right", render: (holding) => asPrinted(holding.raw.units) },
    { key: "nav", label: "NAV (₹)", align: "right", render: (holding) => h("div", {}, asPrinted(holding.raw.nav), h("div", { class: "app-cell-sub" }, formatDate(holding.navDate))) },
    { key: "cost", label: "Invested value (₹)", align: "right", render: (holding) => formatAmount(holding.costValue) },
    { key: "value", label: "Current value (₹)", align: "right", render: (holding) => valueCell(holding, summary.shareOf(holding)) },
    { key: "gain", label: "Gain / Loss (₹)", align: "right", render: (holding) => gainCell(holdingGain(holding)) },
    { key: "r1y", label: "1Y return", align: "right", render: () => h("span", { class: "app-cell-sub" }, "Soon") },
  ];

  if (!groups.length) return Callout({ tone: "info", body: "There are no funds to show." });
  return DataTable({ columns, groups, onRowClick: onSelect, rowClass: (holding) => (holding.flags.length ? "app-row-flagged" : "") });
}

function fundCell(holding, accent) {
  return h("div", { class: "app-fund" },
    h("span", { class: "app-fund-avatar", style: { "--accent": accent } }, initials(holding.amc ?? holding.schemeName)),
    h("div", { class: "app-fund-text" },
      h("div", { class: "app-fund-name" }, holding.schemeName ?? "Unnamed fund"),
      h("div", { class: "app-fund-meta" },
        h("span", { class: "app-tag ds-mono" }, holding.isin ?? "No ISIN"),
        holding.folio ? h("span", { class: "app-tag" }, `Folio ${holding.folio}`) : null,
        holding.status === "redeemed" ? Badge({ text: "Redeemed", tone: "neutral" }) : null),
      holding.flags.length
        ? h("div", { class: "app-flags" }, holding.flags.map((flag) => Badge({ text: FLAG_LABEL[flag] ?? flag, tone: "warning" })))
        : null));
}

function valueCell(holding, share) {
  return h("div", { class: "app-value-cell" },
    h("strong", {}, formatAmount(holding.marketValue)),
    share === null ? null : h("div", { class: "app-share", title: `${(share * 100).toFixed(1)}% of the portfolio` },
      h("span", { class: "app-share-track" }, h("span", { class: "app-share-fill", style: { width: `${Math.max(share * 100, 1)}%` } })),
      h("span", { class: "app-cell-sub" }, `${(share * 100).toFixed(1)}%`)));
}

function gainCell(result) {
  if (!result) return DASH;
  const up = result.gain >= 0;
  return h("div", { class: up ? "app-positive" : "app-negative" },
    formatSignedAmount(result.gain),
    h("div", { class: "app-gain-chip" }, formatSignedPct(result.gainPct)));
}

function checksSection(portfolio) {
  const items = verificationItems(portfolio);

  return h("section", { class: "app-section" },
    sectionHead("Accuracy", "How the numbers were verified"),
    h("div", { class: "app-checks" }, items.map((item, i) =>
      h("div", { class: `app-check site-reveal ${item.passed ? "is-ok" : "is-review"}`, style: { "--i": i } },
        h("span", { class: "app-check-icon" }, Icon(item.passed ? "checkCircle" : "alert", { size: 22 })),
        h("div", {}, h("div", { class: "app-check-title" }, item.title), h("p", {}, item.detail)))))
  );
}

function createTransactionDialog() {
  const body = h("div", { class: "app-dialog-body" });
  const title = h("h2", { id: "txn-title" });
  const subtitle = h("div", { class: "app-dialog-sub" });
  const element = h("dialog", { class: "app-dialog", "aria-labelledby": "txn-title" },
    h("div", { class: "app-dialog-head" },
      h("div", {}, h("div", { class: "ds-eyebrow" }, "Transaction history"), title, subtitle),
      h("button", { class: "app-icon-btn", type: "button", "aria-label": "Close", onclick: () => element.close() }, Icon("x", { size: 20 }))
    ),
    body
  );
  element.addEventListener("click", (event) => { if (event.target === element) element.close(); });

  return {
    element,
    open(holding) {
      title.textContent = holding.schemeName ?? holding.isin;
      subtitle.textContent = [holding.isin, holding.folio ? `Folio ${holding.folio}` : null, `Opening units ${asPrinted(holding.raw.openingUnits)}`, `Closing units ${asPrinted(holding.raw.units)}`]
        .filter(Boolean).join("  ·  ");
      body.replaceChildren(
        holding.transactions.length
          ? DataTable({
              columns: [
                { key: "date", label: "Date", render: (txn) => formatDate(txn.date) },
                { key: "description", label: "Transaction" },
                { key: "amount", label: "Amount (₹)", align: "right", render: (txn) => asPrinted(txn.raw.amount) },
                { key: "units", label: "Units", align: "right", render: (txn) => asPrinted(txn.raw.units) },
                { key: "price", label: "NAV (₹)", align: "right", render: (txn) => asPrinted(txn.raw.price) },
                { key: "balance", label: "Unit balance", align: "right", render: (txn) => asPrinted(txn.raw.unitBalance) },
              ],
              rows: holding.transactions,
            })
          : Callout({ tone: "info", body: "The statement doesn't list any transactions for this fund in this period." })
      );
      element.showModal();
    },
  };
}
