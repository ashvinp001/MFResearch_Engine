/**
 * Step 3 — Set the Prosperr Recommendation (Invest / Hold / Sell per fund).
 *
 * Input:  { portfolio, fundData (Phase 2, may be null), store, summarize(verdicts) → recommendation summary,
 *           holdingGain(holding) → { gain, gainPct } | null, onChange() }
 * Output: DOM element. Verdicts are kept for this session as the advisor clicks.
 * Funds matching a Prosperr condition (recommendation-rules.js) arrive pre-selected and
 * show the reason; when the advisor changes one, a "Use suggested" reset appears.
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
import { DASH, formatInr, formatSignedInr, formatSignedPct } from "../../shared/format.js";
import { pageBand } from "../../shared/page-band.js";

const VERDICT_NAME = { invest: "Invest", hold: "Hold", sell: "Sell" };

export function createRecommendationScreen({ portfolio, fundData, store, summarize, holdingGain, onChange }) {
  const active = portfolio.holdings.filter((holding) => holding.status === "active");
  const summarySlot = h("div", { class: "rec-side-stack" });

  function refresh() {
    const recommendation = summarize(store.state.verdicts);
    summarySlot.replaceChildren(summaryCard(recommendation), commentaryCard(recommendation));
  }

  const rows = active.map((holding) => {
    const key = holdingKey(holding);
    const info = fundData?.funds?.[holding.isin] ?? null;
    const r1y = info?.returns?.r1y ?? null;
    const b1y = info?.benchmarkReturns?.r1y ?? null;
    const excess = r1y !== null && b1y !== null ? r1y - b1y : null;
    const gain = holdingGain(holding);
    const tone = (value) => (value === null || value === undefined ? "" : value >= 0 ? "up" : "down");
    const suggestion = store.state.suggestions?.[key] ?? null;
    const ruleTag = h("div", { class: "rec-rule" });

    /** Shows why the fund was pre-selected, or that the advisor changed it (with a reset). */
    function showRuleTag() {
      if (!suggestion) return ruleTag.replaceChildren();
      if (store.state.verdicts[key] === suggestion.verdict) {
        ruleTag.className = "rec-rule is-auto";
        return ruleTag.replaceChildren(Icon("sparkle", { size: 12 }), `Auto · ${suggestion.reason}`);
      }
      ruleTag.className = "rec-rule is-changed";
      ruleTag.replaceChildren(Icon("user", { size: 12 }), `Changed by you · conditions suggest ${VERDICT_NAME[suggestion.verdict]}`,
        h("button", { type: "button", class: "rec-rule-reset", onclick: () => setVerdict(suggestion.verdict, true) }, "Use suggested"));
    }

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
      onChange();
    }
    showRuleTag();

    return h("div", { class: "rec-row" },
      h("div", { class: "rec-fund" },
        h("div", { class: "rec-fund-name" }, holding.schemeName ?? holding.isin),
        h("div", { class: "rec-fund-sub" },
          `Value ${formatInr(holding.marketValue, { whole: true })} · Excess vs ${info?.benchmark ?? "Nifty 500"} `,
          h("span", { class: `rec-excess-inline ${tone(excess)}` }, excess === null ? DASH : formatSignedPct(excess / 100))),
        ruleTag),
      h("div", { class: `rec-metric ${tone(r1y)}`, title: r1y === null ? "1-year return — available once NAV data is connected" : "1-year return" },
        r1y === null ? DASH : formatSignedPct(r1y / 100)),
      h("div", { class: `rec-metric ${tone(gain?.gainPct)}`, title: "Absolute return on the amount invested (from the CAS)" },
        gain?.gainPct === null || gain?.gainPct === undefined ? DASH : formatSignedPct(gain.gainPct),
        gain ? h("span", { class: "rec-metric-sub" }, formatSignedInr(gain.gain, { whole: true })) : null),
      toggle);
  });

  const suggestedCount = Object.keys(store.state.suggestions ?? {}).length;

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
          h("p", {}, "1Y return comes from NAV history (shown once connected); absolute return is the gain on the amount invested, from the CAS."),
          suggestedCount
            ? h("p", { class: "rec-auto-note" }, Icon("sparkle", { size: 14 }),
                ` ${suggestedCount} of ${active.length} funds pre-selected from the Prosperr conditions — change any fund if needed.`)
            : null),
        h("div", { class: "rec-cols", "aria-hidden": "true" },
          h("span", {}, "Fund"), h("span", {}, "1Y Return"), h("span", {}, "Absolute Return"), h("span", {}, "Recommendation")),
        rows),
      summarySlot)
  );
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
        ? h("p", { class: "rec-pending" }, Icon("alert", { size: 16 }), ` ${unset.length} fund${unset.length > 1 ? "s" : ""} still need a recommendation.`)
        : h("p", { class: "rec-done" }, Icon("checkCircle", { size: 16 }), " Every fund has a recommendation."),
    ],
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
