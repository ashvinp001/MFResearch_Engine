/**
 * Step 3 — Set the Prosperr Recommendation (Invest / Hold / Sell per fund).
 *
 * Input:  { portfolio, fundData (Phase 2, may be null), store, summarize(verdicts) → recommendation summary,
 *           holdingGain(holding) → { gain, gainPct } | null, onChange() }
 * Output: DOM element. Verdicts are kept for this session as the advisor clicks.
 * Funds arrive pre-selected by the Prosperr logic (Recommendation_Logic.md, engine auto-recommendation.js)
 * with the reason and a "Why" breakdown; REVIEW funds are left for the advisor with the reason shown;
 * when the advisor changes one, a "Use suggested" reset appears. The Suggestion Box sits beside the list.
 * Before the Invest / Hold / Sell buttons each fund shows its 1Y return (NAV data,
 * "—" until connected) and its absolute return on cost (from the CAS).
 */

import { h } from "../../../design-system/components/dom.js";
import { Card } from "../../../design-system/components/basics.js";
import { Icon } from "../../../design-system/components/icons.js";
import { VerdictToggle } from "../../../design-system/components/workflow.js";
import { STATUS } from "../../../design-system/tokens.js";
import { holdingKey } from "../../../calculation-engine/index.js";
import { buildCommentary } from "../commentary.js";
import { DASH, formatDate, formatInr, formatSignedInr, formatSignedPct } from "../../shared/format.js";
import { pageBand } from "../../shared/page-band.js";

const VERDICT_NAME = { invest: "Invest", hold: "Hold", sell: "Sell" };
const PLAN_ORDER = ["Regular", "Direct", "ETF"];
const PLAN_HEADING = { Regular: "Regular plans", Direct: "Direct plans", ETF: "ETFs" };

/** Regular / Direct / ETF — from the AMFI list when the fund is in it, else from the plan named in the fund name. */
function planOf(holding, info) {
  if (info?.plan) return info.plan;
  const name = holding.schemeName ?? "";
  if (/\b(direct|dir)\b/i.test(name)) return "Direct";
  if (/\betf\b|\bbees\b/i.test(name) && !/fund of fund|\bfof\b/i.test(name)) return "ETF";
  return "Regular";
}

export function createRecommendationScreen({ portfolio, fundData, store, summarize, holdingGain, onChange }) {
  const active = portfolio.holdings.filter((holding) => holding.status === "active");
  const summarySlot = h("div", { class: "rec-side-stack" });

  function refresh() {
    const recommendation = summarize(store.state.verdicts);
    const flags = store.state.autoLogic?.flags ?? [];
    // Side column, top to bottom: list options, summary, Suggestion Box, commentary — all scroll with the page
    // (owner's layout: the panel stays at its place at the top; nothing follows the scroll).
    summarySlot.replaceChildren(
      h("div", { class: "rec-side-pin" }, ...[toolbar, summaryCard(recommendation), flags.length ? flagsCard(flags) : null].filter(Boolean)),
      commentaryCard(recommendation));
  }


  const rows = active.map((holding) => {
    const key = holdingKey(holding);
    const info = fundData?.funds?.[holding.isin] ?? null;
    const plan = planOf(holding, info);
    const r1y = info?.returns?.r1y ?? null;
    const b1y = info?.benchmarkReturns?.r1y ?? null;
    const excess = r1y !== null && b1y !== null ? r1y - b1y : null;
    const gain = holdingGain(holding);
    const tone = (value) => (value === null || value === undefined ? "" : value >= 0 ? "up" : "down");
    const suggestion = store.state.suggestions?.[key] ?? null;
    const ruleTag = h("div", { class: "rec-rule" });
    const e3 = suggestion?.excess?.e3 ?? null;
    const b3 = suggestion?.benchmark?.b3 ?? null;
    const signedPp = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)} pp`;

    /** Shows why the fund was pre-selected, that it needs the advisor's review, or that the advisor changed it. */
    function showRuleTag() {
      if (!suggestion) return ruleTag.replaceChildren();
      const chosen = store.state.verdicts[key];
      if (!suggestion.verdict) {
        ruleTag.className = chosen ? "rec-rule is-changed" : "rec-rule is-review";
        return ruleTag.replaceChildren(Icon(chosen ? "user" : "alert", { size: 12 }),
          chosen ? `Chosen by you · logic: review — ${suggestion.reason}` : `Review · ${suggestion.reason}`);
      }
      if (chosen === suggestion.verdict) {
        ruleTag.className = "rec-rule is-auto";
        return ruleTag.replaceChildren(Icon("sparkle", { size: 12 }), `Auto · ${suggestion.reason}`);   // a portfolio-fit reason starts "Portfolio fit —"
      }
      ruleTag.className = "rec-rule is-changed";
      ruleTag.replaceChildren(Icon("user", { size: 12 }), `Changed by you · logic suggests ${VERDICT_NAME[suggestion.verdict]}`,
        h("button", { type: "button", class: "rec-rule-reset", onclick: () => setVerdict(suggestion.verdict, true) }, "Use suggested"));
    }

    // The plain-language explanation behind the suggestion, in a popup (bulb button beside the buttons).
    const bulb = suggestion
      ? h("button", { type: "button", class: "rec-bulb", title: "Why this recommendation?", "aria-label": `Why this recommendation for ${holding.schemeName ?? holding.isin}`,
          onclick: () => openExplain(holding.schemeName ?? holding.isin, suggestion) }, Icon("bulb", { size: 16 }))
      : null;

    const toggle = VerdictToggle({
      value: store.state.verdicts[key],
      label: `Recommendation for ${holding.schemeName ?? holding.isin}`,
      onChange: (verdict) => setVerdict(verdict, false),
    });

    function setVerdict(verdict, updateToggle) {
      store.state.verdicts[key] = verdict;
      if (updateToggle) toggle.setValue(verdict);
      store.save();
      showRuleTag();
      refresh();
      updateUnratedToggle();
      onChange();
    }
    showRuleTag();

    const element = h("div", { class: "rec-row" },
      h("div", { class: "rec-fund" },
        h("div", { class: "rec-fund-name" }, holding.schemeName ?? holding.isin, h("span", { class: `rec-plan is-${plan.toLowerCase()}` }, plan)),
        h("div", { class: "rec-fund-sub" },
          excess !== null
            ? [`Value ${formatInr(holding.marketValue, { whole: true })} · Excess vs ${info.benchmark} `,
               h("span", { class: `rec-excess-inline ${tone(excess)}` }, formatSignedPct(excess / 100))]
            : [`Value ${formatInr(holding.marketValue, { whole: true })} · 3Y vs category `,
               h("span", { class: `rec-excess-inline ${tone(e3)}` }, e3 === null ? DASH : signedPp(e3)),
               b3 === null ? null : " · vs benchmark ",
               b3 === null ? null : h("span", { class: `rec-excess-inline ${tone(b3)}`, title: suggestion.benchmark.name }, signedPp(b3))]),
        ruleTag),
      h("div", { class: `rec-metric ${tone(r1y)}`, title: r1y === null ? "1-year return — available once NAV data is connected" : "1-year return" },
        r1y === null ? DASH : formatSignedPct(r1y / 100)),
      h("div", { class: `rec-metric ${tone(gain?.gainPct)}`, title: "Absolute return on the amount invested (from the CAS)" },
        gain?.gainPct === null || gain?.gainPct === undefined ? DASH : formatSignedPct(gain.gainPct),
        gain ? h("span", { class: "rec-metric-sub" }, formatSignedInr(gain.gain, { whole: true })) : null),
      toggle, bulb);   // the bulb sits in the row's top-right corner (CSS), outside the column grid
    return { element, plan, key, value: Number(holding.marketValue) || 0 };   // value: current value, as on the row
  });

  // Toolbar above the list: group by plan (Regular first, then Direct, then ETFs; off = the statement's own
  // order) and "Funds to rate" — only the funds without a recommendation yet (e.g. the logic's REVIEW funds).
  const rowsSlot = h("div", { class: "rec-rows" });
  const planToggle = h("button", { type: "button", class: "rec-tool" });
  const unratedToggle = h("button", { type: "button", class: "rec-tool is-review" });
  planToggle.classList.add("is-plan");
  const toolbar = h("div", { class: "rec-toolbar", role: "toolbar", "aria-label": "List options" },
    h("div", { class: "rec-toolbar-grid" }, planToggle, unratedToggle));
  /** Button face: icon in a circle, label, a one-line hint and an optional count badge. */
  const toolFace = (icon, label, hint, badge = null) => [
    h("span", { class: "rec-tool-icon" }, Icon(icon, { size: 20 })),
    h("span", { class: "rec-tool-text" },
      h("strong", {}, label, ...(badge === null ? [] : [h("span", { class: "rec-tool-badge" }, String(badge))])),
      h("small", {}, hint)),
    h("span", { class: "rec-switch", "aria-hidden": "true" }, h("i")),
  ];
  let onlyUnrated = false;
  // A fund rated while the filter is on stays in view until the filter is changed (rows do not jump away).
  let unratedKeys = new Set();
  const unratedNow = () => rows.filter((row) => !store.state.verdicts[row.key]);

  function updateUnratedToggle() {
    const n = unratedNow().length;
    unratedToggle.setAttribute("aria-pressed", String(onlyUnrated));
    unratedToggle.disabled = n === 0 && !onlyUnrated;
    unratedToggle.replaceChildren(...(onlyUnrated
      ? toolFace(n ? "alert" : "checkCircle", n ? "Funds to rate" : "All rated", n ? `Showing ${n} left · switch off for all` : "Switch off to see all funds", n || null)
      : n ? toolFace("alert", "Funds to rate", "Only funds still waiting for a call", n)
        : toolFace("checkCircle", "All funds rated", "Every fund has Invest, Hold or Sell")));
    unratedToggle.classList.toggle("is-done", n === 0);
    unratedToggle.title = n ? "Show only the funds that still need Invest, Hold or Sell" : "Every fund has a recommendation";
  }

  // Group heading: plan, number of funds and their total current value (share of the whole portfolio). The total
  // always covers every fund of that plan, also while "Funds to rate" shows only some of them.
  const portfolioValue = rows.reduce((sum, row) => sum + row.value, 0);
  function planHeading(plan, visible) {
    const all = rows.filter((row) => row.plan === plan);
    const total = all.reduce((sum, row) => sum + row.value, 0);
    const count = visible.length === all.length ? `${all.length} fund${all.length > 1 ? "s" : ""}` : `${visible.length} of ${all.length} funds`;
    return h("div", { class: "rec-plan-group" },
      h("span", {}, `${PLAN_HEADING[plan]} · ${count}`),
      h("span", { class: "rec-plan-total" }, h("strong", { class: "ds-num" }, formatInr(total, { whole: true })),
        portfolioValue ? ` · ${((total / portfolioValue) * 100).toFixed(1)}% of portfolio` : ""));
  }

  function renderRows() {
    const grouped = Boolean(store.state.groupByPlan);
    planToggle.setAttribute("aria-pressed", String(grouped));
    planToggle.replaceChildren(...toolFace("layers", "Regular Funds / Direct Funds",
      grouped ? "Listed as Regular, then Direct" : "Group the list by plan"));
    planToggle.title = grouped ? "Click to show the normal list" : "Arrange the funds as Regular plans, then Direct plans";
    updateUnratedToggle();
    const visible = onlyUnrated ? rows.filter((row) => unratedKeys.has(row.key)) : rows;
    if (!grouped) return rowsSlot.replaceChildren(...visible.map((row) => row.element));
    rowsSlot.replaceChildren(...PLAN_ORDER.flatMap((plan) => {
      const members = visible.filter((row) => row.plan === plan);
      return members.length
        ? [planHeading(plan, members), ...members.map((row) => row.element)]
        : [];
    }));
  }
  planToggle.addEventListener("click", () => {
    store.state.groupByPlan = !store.state.groupByPlan;
    store.save();
    renderRows();
  });
  unratedToggle.addEventListener("click", () => {
    onlyUnrated = !onlyUnrated;
    unratedKeys = new Set(unratedNow().map((row) => row.key));
    renderRows();
  });
  renderRows();

  const suggestions = Object.values(store.state.suggestions ?? {});
  const suggestedCount = suggestions.filter((s) => s.verdict).length;
  const reviewCount = suggestions.filter((s) => !s.verdict).length;
  const logic = store.state.autoLogic;

  refresh();

  return h("main", { class: "app-step-page" },
    pageBand({
      eyebrow: "Step 3 · Recommendation",
      title: "Invest, Hold or Sell — fund by fund",
      text: "Choose Invest, Hold or Sell for every fund. The report commentary and conclusion update automatically.",
    }),
    h("div", { class: "app-container app-step-body rec-layout" },
      h("section", { class: "rec-panel site-reveal" },
        h("header", { class: "rec-panel-head" },
          h("h2", {}, "Set Your Prosperr Recommendation"),
          h("p", {}, "1Y return is calculated from each fund's NAV history; absolute return is the gain on the amount invested, from the CAS."),
          suggestedCount || reviewCount
            ? h("p", { class: "rec-auto-note" }, Icon("sparkle", { size: 14 }),
                ` ${reviewCount ? `Prosperr has suggested a call for ${suggestedCount} of ${active.length} funds` : "Prosperr has suggested a call for every fund"}`
                + (logic ? `, based on fund data up to ${formatDate(logic.asOf)}` : "")
                + (reviewCount ? `. ${reviewCount === 1 ? "1 fund needs" : `${reviewCount} funds need`} your call.` : ".")
                + " Tap the bulb on any fund to see why, and change any call you disagree with.")
            : null),
        h("div", { class: "rec-cols", "aria-hidden": "true" },
          h("span", {}, "Fund"), h("span", {}, "1Y Return"), h("span", {}, "Absolute Return"), h("span", {}, "Recommendation")),
        rowsSlot),
      summarySlot),
    explainDialog
  );
}

// ---------- "Why this recommendation?" popup ----------
// Each measure of the logic (auto-recommendation.js pillars) in plain words: name, what it means.
const MEASURES = {
  R: { name: "Returns vs similar funds", meaning: "Its 3- and 5-year returns compared with the middle (median) fund of the same category." },
  B: { name: "Returns vs its benchmark index", meaning: "Whether it has beaten the market index it is meant to beat." },
  K: { name: "Rank among similar funds", meaning: "Where it stands over 3 years — Q1 is the top quarter of the category, Q4 the bottom quarter." },
  C: { name: "Consistency", meaning: "How often it stayed at or above the category's middle fund across rolling 3-year periods." },
  S: { name: "Risk", meaning: "Return earned for the risk taken (Sharpe ratio) and its deepest fall in 3 years, compared with the category." },
  Q: { name: "Credit quality", meaning: "How much of its money is in the safest bonds (AAA, sovereign) and cash." },
  M: { name: "Sector vs the overall market", meaning: "Whether the fund's sector or theme is doing better than the broad market (NIFTY 500)." },
  T: { name: "Tracking its index", meaning: "How closely the index fund / ETF follows its index, after costs." },
};
const STATE = {
  "+": { text: "Good", tone: "good" },
  "-": { text: "Weak", tone: "weak" },
  0: { text: "Mixed", tone: "neutral" },   // neither clearly good nor clearly weak (e.g. ahead on 3-yr, behind on 5-yr)
  "?": { text: "No data", tone: "none" },
};
const CALL = { invest: "Invest", hold: "Hold", sell: "Sell", review: "Needs your review" };
// "3Y" → "3-yr" so the figures read as words.
const plain = (text) => String(text ?? "").replace(/\b(\d)Y\b/g, "$1-yr").replace(/max(imum)? drawdown/gi, "deepest fall");

const explainBody = h("div", { class: "app-dialog-body rec-explain-body" });
const explainTitle = h("h2", { id: "rec-explain-title" });
const explainCall = h("div", { class: "rec-explain-call" });
const explainDialog = h("dialog", { class: "app-dialog rec-explain", "aria-labelledby": "rec-explain-title" },
  h("div", { class: "app-dialog-head" },
    h("div", {}, h("div", { class: "ds-eyebrow" }, "Why this recommendation"), explainTitle, explainCall),
    h("button", { type: "button", class: "app-icon-btn", "aria-label": "Close", onclick: () => explainDialog.close() }, Icon("x", { size: 20 }))),
  explainBody);
explainDialog.addEventListener("click", (event) => { if (event.target === explainDialog) explainDialog.close(); });

function openExplain(fundName, s) {
  explainTitle.textContent = fundName;
  // replaceChildren() would print a null child as the text "null": empty parts are filtered out.
  explainCall.replaceChildren(...[
    h("span", { class: `rec-explain-chip is-${s.status}` }, `Suggested: ${CALL[s.status] ?? s.status}`),
    s.stage === "portfolio" ? h("span", { class: "rec-explain-chip is-portfolio" }, "Based on the whole portfolio") : null].filter(Boolean));

  const measures = Object.entries(s.pillars ?? {}).filter(([key]) => MEASURES[key]);
  const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  // A portfolio-fit reason reads "Portfolio fit — <why the portfolio needs it>. On its own: <the fund's own result>".
  const [why, onItsOwn = null] = plain(s.reason).replace(/^Portfolio fit — /, "").split(/\s*On its own:\s*/);
  explainBody.replaceChildren(...[
    h("section", { class: "rec-explain-short" }, h("h3", {}, s.stage === "portfolio" ? "Why — for this portfolio" : "In short"), h("p", {}, sentence(why))),
    onItsOwn ? h("section", {}, h("h3", {}, "The fund on its own"), h("p", { class: "rec-explain-own" }, sentence(onItsOwn))) : null,
    measures.length
      ? h("section", {}, h("h3", {}, "How the fund was judged"),
          s.peers ? h("p", { class: "rec-explain-peers" }, `Compared with: ${s.peers.replace(/\((\d+) funds\)/, "— $1 similar funds")}`) : null,
          h("ul", { class: "rec-explain-list" }, measures.map(([key, p]) => {
            const state = STATE[p.state] ?? STATE["?"];
            return h("li", {},
              h("div", { class: "rec-explain-row" }, h("strong", {}, MEASURES[key].name), h("span", { class: `rec-explain-state is-${state.tone}` }, state.text)),
              h("p", { class: "rec-explain-figure" }, plain(p.text)),
              h("p", { class: "rec-explain-meaning" }, MEASURES[key].meaning));
          })))
      : null,
    s.notes?.length ? h("section", {}, h("h3", {}, "Good to know"), h("ul", { class: "rec-explain-notes" }, s.notes.map((note) => h("li", {}, plain(note))))) : null,
    h("p", { class: "rec-explain-foot" }, "pp = percentage points: 12% against 10% is +2 pp. 3-yr / 5-yr returns are yearly averages. "
      + "The suggestion is a starting point — you can change any fund.")].filter(Boolean));
  explainDialog.showModal();
  explainBody.scrollTop = 0;
}

function summaryCard(recommendation) {
  const { byVerdict, unset } = recommendation;
  return Card({
    title: "Recommendation summary",
    icon: "pie",
    accent: "var(--navy)",
    children: [
      h("div", { class: "rec-summary" },
        ["invest", "hold", "sell"].map((verdict) => h("div", { class: "rec-summary-item", style: { "--verdict": STATUS[verdict].color } },
          h("span", { class: "rec-summary-label" }, VERDICT_NAME[verdict]),
          h("strong", { class: "ds-num" }, String(byVerdict[verdict].count)),
          h("span", { class: "rec-summary-value ds-num" }, formatInr(byVerdict[verdict].value, { whole: true }))))),
      unset.length
        ? h("p", { class: "rec-pending" }, Icon("alert", { size: 16 }), ` ${unset.length} fund${unset.length > 1 ? "s still need" : " still needs"} a recommendation.`)
        : h("p", { class: "rec-done" }, Icon("checkCircle", { size: 16 }), " Every fund has a recommendation."),
    ],
  });
}

/** Suggestion Box: the logic's portfolio-level points (fund count, concentration, overlap, folios) — also printed in the report. */
function flagsCard(flags) {
  return Card({
    title: "Suggestion box",
    eyebrow: "Portfolio level",
    className: "rec-flags-card",
    icon: "info",
    accent: "var(--color-warning)",
    children: h("ul", { class: "rec-flags" }, flags.map((flag) => h("li", {}, flag.text))),
  });
}

function commentaryCard(recommendation) {
  const { points, conclusion } = buildCommentary(recommendation);
  return Card({
    title: "Report commentary",
    eyebrow: "Live preview",
    icon: "file",
    accent: "var(--green)",
    children: points.length
      ? [
          h("ul", { class: "rec-commentary" }, points.map((point) =>
            h("li", { style: { "--verdict": STATUS[point.verdict].color } }, point.text))),
          conclusion ? h("p", { class: "rec-conclusion" }, h("strong", {}, "Conclusion: "), conclusion) : null,
        ]
      : h("p", { class: "ds-muted" }, "Commentary appears here as you set recommendations."),
  });
}
