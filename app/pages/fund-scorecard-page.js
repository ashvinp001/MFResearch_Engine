/**
 * Fund Scorecard — internal research: every fund of a category rated 0–100 and ranked (engine research/fund-scorecard.js),
 * shown beside the Recommendation Logic's grade for the same fund (auto-recommendation.js gradeFund).
 *
 * renderFundScorecardPage(view)
 *   Category tabs (Equity) · plan switch · summary · top three · ranked list (each row opens every measure with its
 *   value and percentile) · funds not rated, with the reason · weights & conditions (editable on the owner's PC only;
 *   the server refuses changes from anywhere else) · model check (back-test) · method.
 */

import { h } from "../../design-system/components/dom.js";
import { Icon } from "../../design-system/components/icons.js";
import { SCORECARD } from "../../calculation-engine/config.js";
import { backtestCategory, gradeFund, resolveSettings, SCORECARD_PILLARS, scoreCategory, scoreIndexCategory } from "../../calculation-engine/index.js";
import { loadScorecardSettings } from "../shared/market-data.js";
import { DASH, formatDate } from "../shared/format.js";
import { EQUITY_CATEGORIES } from "./fund-research/research-config.js";
import { OWN_INDEX_CATEGORIES, scorecardData } from "./fund-scorecard/scorecard-data.js";
import { openPasswordDialog, openSettingsDialog } from "./fund-scorecard/settings-dialog.js";
import { INDEX_CARD, INDEX_GROUPS, INDEX_SCORECARD, SCORECARD_LIVE } from "./fund-scorecard/scorecard-config.js";

const PLANS = ["Regular", "Direct"];
const PILLAR_COLOR = { returns: "blue", riskAdjusted: "violet", benchmark: "teal", volatility: "amber", downside: "red", consistency: "green", quality: "steel",
  trackingDiff: "blue", trackingError: "violet", trackingConsistency: "green" };   // index funds (research/index-scorecard.js)
const isIndex = (c) => c?.kind === "index";
const isLive = (c) => isIndex(c) || SCORECARD_LIVE.has(c.slug);
// The Recommendation Logic's grade, shown as a signal badge: colour + icon + words (never colour alone).
const GRADE = {
  STRONG: { label: "Recommended to Buy", tone: "invest", icon: "trend", hint: "STRONG in the Recommendation Logic — recommended for fresh investment" },
  MIXED: { label: "Hold", tone: "hold", icon: "shield", hint: "MIXED in the Recommendation Logic — stay invested" },
  HOLD: { label: "Hold", tone: "hold", icon: "shield", hint: "A hold-type fund in the Recommendation Logic — stay invested" },
  WEAK: { label: "Exit", tone: "exit", icon: "alert", hint: "WEAK in the Recommendation Logic — exit and redeploy" },
  REVIEW: { label: "Review", tone: "review", icon: "eye", hint: "REVIEW in the Recommendation Logic — the advisor decides" },
};
const NEEDLE = { exit: 150, hold: 90, invest: 30 };   // degrees on the dial: red (left) → amber → green (right)

/** Signal gauge: a red / amber / green dial with the needle on the fund's grade, and the grade beside it. */
function gradeGauge(grade) {
  const C = 30, R = 22;
  const at = (deg, r = R) => [C + r * Math.cos((deg * Math.PI) / 180), 30 - r * Math.sin((deg * Math.PI) / 180)];
  const arc = (from, to, cls) => {
    const [x1, y1] = at(from), [x2, y2] = at(to);
    return h("path", { class: `fsc-dial-${cls}`, d: `M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}` });
  };
  const angle = NEEDLE[grade.tone];
  const [nx, ny] = angle === undefined ? [C, 30] : at(angle, R - 5);
  return h("span", { class: `fsc-gauge is-${grade.tone}`, title: grade.hint },
    h("svg", { viewBox: "0 0 60 36", "aria-hidden": "true" },
      arc(180, 122, "exit"), arc(118, 62, "hold"), arc(58, 0, "invest"),
      angle === undefined
        ? h("text", { x: C, y: 31, "text-anchor": "middle", class: "fsc-dial-q" }, "?")
        : [h("path", { class: "fsc-needle", d: `M${C},30 L${nx.toFixed(2)},${ny.toFixed(2)}` }), h("circle", { class: "fsc-hub", cx: C, cy: 30, r: 3.2 })]),
    h("span", { class: "fsc-gauge-text" }, h("b", {}, grade.label), grade.tone === "review" ? h("small", {}, "advisor decides") : null));
}

/**
 * Pillar profile: a small radar of the fund's pillar scores (0–100 from the centre, one spoke per weighted pillar),
 * tinted in its quartile colour, with its strongest and weakest pillar named beside it. Hover lists every pillar.
 */
function pillarProfile(r, pillars, weights) {
  const S = 60, C = S / 2, R = 25;
  const n = pillars.length;
  const point = (i, v) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [C + R * (v / 100) * Math.cos(a), C + R * (v / 100) * Math.sin(a)];
  };
  const ring = (v) => `M${pillars.map((_, i) => point(i, v).map((x) => x.toFixed(2)).join(",")).join("L")}Z`;
  const scores = pillars.map((p) => r.pillars[p.key] ?? 0);
  const shape = `M${scores.map((v, i) => point(i, v).map((x) => x.toFixed(2)).join(",")).join("L")}Z`;
  const ranked = pillars.map((p) => ({ p, v: r.pillars[p.key] })).filter((x) => x.v !== null).sort((a, b) => b.v - a.v);
  const best = ranked[0], worst = ranked.at(-1);
  const title = pillars.map((p) => `${p.label}: ${r.pillars[p.key] === null ? "—" : Math.round(r.pillars[p.key])} / 100 (weight ${weights[p.key]}%)`).join("\n");
  return h("div", { class: `fsc-profile is-q${r.quartile}`, title },
    h("svg", { viewBox: `0 0 ${S} ${S}`, role: "img", "aria-label": `Pillar profile: strongest ${best?.p.label}, weakest ${worst?.p.label}` },
      h("path", { class: "fsc-radar-grid", d: ring(100) }), h("path", { class: "fsc-radar-grid", d: ring(50) }),
      ...pillars.map((_, i) => { const [x, y] = point(i, 100); return h("path", { class: "fsc-radar-spoke", d: `M${C},${C} L${x.toFixed(2)},${y.toFixed(2)}` }); }),
      h("path", { class: "fsc-radar-shape", d: shape }),
      ...pillars.map((p, i) => { const [x, y] = point(i, scores[i]); return h("circle", { cx: x, cy: y, r: 2.1, style: { fill: `var(--${PILLAR_COLOR[p.key]})` } }); })),
    h("div", { class: "fsc-profile-text" },
      best ? h("span", { class: "is-best" }, h("i", { style: { background: `var(--${PILLAR_COLOR[best.p.key]})` } }), "▲ ", best.p.label, h("b", {}, Math.round(best.v))) : null,
      worst && worst !== best ? h("span", { class: "is-worst" }, h("i", { style: { background: `var(--${PILLAR_COLOR[worst.p.key]})` } }), "▼ ", worst.p.label, h("b", {}, Math.round(worst.v))) : null));
}
const CONDITION_TEXT = {
  minHistoryYears: (v, index) => `At least ${v} year${v === 1 ? "" : "s"} of NAV history (new funds and NFOs are not rated)${!index && v < 3 ? " — risk measured over the last 24 months for every fund" : ""}`,
  maxNavAgeDays: (v) => `Latest NAV no more than ${v} days old`,
  minPeers: (v, index) => `At least ${v} eligible funds ${index ? "tracking the same index" : "in the category"} (and per measure)`,
  minAumCr: (v) => `AUM at least ₹${Number(v).toLocaleString("en-IN")} Cr (scheme level)`,
};

export function renderFundScorecardPage(view) {
  const state = { category: EQUITY_CATEGORIES[0], plan: "Regular", settingsInfo: null, open: new Set() };
  const chips = h("div", { class: "fsc-chips" });
  const head = h("div", { class: "fsc-head" });
  const results = h("div", { class: "fsc-results" });
  const side = h("div", { class: "fsc-side" });

  // Category selector: the live categories as colour cards; the rest in a quieter "mapping in progress" row.
  function drawChips() {
    const pick = (c) => () => { if (state.category !== c) { state.category = c; state.open.clear(); drawChips(); load(); } };
    const live = EQUITY_CATEGORIES.filter((c) => SCORECARD_LIVE.has(c.slug));
    const soon = EQUITY_CATEGORIES.filter((c) => !SCORECARD_LIVE.has(c.slug));
    const card = (c, on, sub, onclick) => h("button", { type: "button", role: "tab", class: `fsc-cat-card${on ? " is-on" : ""}`, "aria-selected": String(on),
      style: { "--accent": `var(--${c.accent})` }, onclick },
      h("span", { class: "fsc-cat-card-icon" }, Icon(c.icon, { size: 20, strokeWidth: 1.9 })),
      h("span", { class: "fsc-cat-card-text" }, h("b", {}, c.name), h("small", {}, sub)),
      on ? h("span", { class: "fsc-cat-card-check" }, Icon("check", { size: 14, strokeWidth: 3 })) : null);
    const indexOn = isIndex(state.category);
    // replaceChildren would print a null as the text "null": the rows that are not shown are left out.
    chips.replaceChildren(...[
      h("div", { class: "fsc-cat-cards", role: "tablist", "aria-label": "Category" },
        live.map((c) => card(c, c === state.category, `vs ${c.benchmark.name}`, pick(c))),
        card(INDEX_CARD, indexOn, indexOn ? `${state.category.name} · ${INDEX_CARD.note}` : `${INDEX_SCORECARD.length} indices · ${INDEX_CARD.note}`,
          indexOn ? () => {} : pick(INDEX_SCORECARD[0]))),
      // Index Funds: its sub-categories (the tracked indices), compact and grouped by family.
      indexOn ? h("div", { class: "fsc-sub-row", role: "tablist", "aria-label": "Index" }, INDEX_GROUPS.map((g) => h("div", { class: "fsc-sub-group" },
        h("span", { class: "fsc-sub-label" }, g.label),
        g.items.map((c) => h("button", { type: "button", role: "tab", class: `fsc-sub-pill${c === state.category ? " is-on" : ""}`, "aria-selected": String(c === state.category),
          style: { "--accent": `var(--${c.accent})` }, onclick: pick(c) }, c.name))))) : null,
      soon.length ? h("div", { class: "fsc-soon-row" },
        h("span", { class: "fsc-soon-label" }, Icon("refresh", { size: 13, strokeWidth: 2.2 }), "Mapping in progress"),
        soon.map((c) => h("button", { type: "button", role: "tab", class: `fsc-soon-pill${c === state.category ? " is-on" : ""}`, "aria-selected": String(c === state.category),
          style: { "--accent": `var(--${c.accent})` }, onclick: pick(c), title: `${c.name} — scorecard coming soon` },
          Icon("lock", { size: 11, strokeWidth: 2.4 }), c.name))) : null,
    ].filter(Boolean));
  }

  // plan switch (built once so its thumb slides)
  const planButtons = PLANS.map((plan) => h("button", { type: "button", class: "frx-plan-btn", "data-plan": plan,
    onclick: () => { if (state.plan !== plan) { state.plan = plan; state.open.clear(); showPlan(); load(); } } },
    Icon(plan === "Direct" ? "bolt" : "user", { size: 15, strokeWidth: 2.2 }), `${plan} plans`));
  const planToggle = h("div", { class: "frx-plan", role: "group", "aria-label": "Plan" }, h("span", { class: "frx-plan-thumb", "aria-hidden": "true" }), ...planButtons);
  function showPlan() {
    planToggle.dataset.plan = state.plan;
    planButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.plan === state.plan)));
  }
  showPlan();

  let data = null;
  let ticket = 0;
  async function load() {
    const mine = ++ticket;
    data = null;
    drawHead(null);
    if (!isLive(state.category)) { results.replaceChildren(pending(state.category)); side.replaceChildren(); return; }   // no data loaded
    results.replaceChildren(skeleton(state.category));
    side.replaceChildren();
    const [loaded, settingsInfo] = await Promise.all([scorecardData(state.category, state.plan), state.settingsInfo ?? loadScorecardSettings()]);
    if (mine !== ticket) return;
    state.settingsInfo = settingsInfo ?? { canEdit: false, settings: {} };
    if (loaded.error) { results.replaceChildren(h("div", { class: "frx-error" }, Icon("alert", { size: 18 }), ` ${loaded.error}`)); return; }
    data = loaded;
    draw();
  }

  function draw() {
    const settings = state.settingsInfo.settings;
    const index = isIndex(state.category);
    const card = index ? scoreIndexCategory({ funds: data.funds, asOf: data.asOf })
      : scoreCategory({ funds: data.funds, benchmark: data.benchmark, asOf: data.asOf, settings });
    const check = index ? null : backtestCategory({ funds: data.funds, benchmark: data.benchmark, asOf: data.asOf, settings });
    const byCode = new Map(data.funds.map((f) => [f.code, f]));
    const peers = data.peerStats;
    const gradeOf = (code) => {
      const fund = byCode.get(code);
      const stats = peers?.funds?.[String(code)] ?? null;
      return gradeFund({ scheme: fund.scheme, name: fund.name, stats, group: stats ? peers.groups?.[stats.group] ?? null : null, statsAsOf: peers?.asOf ?? null }).grade;
    };
    drawHead(data.asOf);
    results.replaceChildren(...summary(card), ...(card.categoryReason ? [notice(card.categoryReason)] : [podium(card, gradeOf), ranked(card, gradeOf, byCode)]), notRated(card));
    side.replaceChildren(settingsPanel(card), modelCheck(check, card), method(state.category, data));
  }

  function drawHead(asOf) {
    const c = state.category;
    const own = OWN_INDEX_CATEGORIES.has(c.slug);
    head.replaceChildren(
      h("div", {},
        h("div", { class: "ds-eyebrow" }, isIndex(c) ? `Index Funds · ${INDEX_GROUPS.find((g) => g.family === c.family)?.title ?? ""}` : "Equity · SEBI category"),
        h("h2", {}, isIndex(c) ? `${c.name} Index Funds — Scorecard` : `${c.name} Funds — Scorecard`),
        h("p", {}, isIndex(c) ? ["Every fund here tracks ", h("strong", {}, c.name), " — rated on how closely it follows the index: tracking difference, tracking error, consistency and fund size."]
          : own ? "Each fund is measured against its own sector or thematic index." : ["Benchmark for alpha, beta, capture and excess return: ", h("strong", {}, c.benchmark.name), "."])),
      h("div", { class: "fsc-head-end" }, isLive(c) ? planToggle : null,
        asOf ? h("span", { class: "frx-data-date" }, Icon("calendar", { size: 14, strokeWidth: 2.2 }), "Data as on ", h("strong", {}, formatDate(asOf))) : null));
  }

  // ---------- summary + top three ----------
  function summary(card) {
    const scores = card.rated.map((r) => r.score).sort((a, b) => a - b);
    const median = scores.length ? (scores.length % 2 ? scores[(scores.length - 1) / 2] : (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2) : null;
    const tile = (label, value, note, tone) => h("div", { class: `fsc-tile${tone ? ` is-${tone}` : ""}` }, h("span", {}, label), h("b", {}, value), note ? h("small", {}, note) : null);
    return [h("div", { class: "fsc-tiles" },
      tile("Funds rated", String(card.rated.length), `of ${card.rated.length + card.notRated.length} in the category`, "blue"),
      tile("Not rated", String(card.notRated.length), "new, stale, small or incomplete data", "amber"),
      tile("Top score", card.rated[0] ? card.rated[0].score.toFixed(1) : DASH, card.rated[0]?.name ?? "", "green"),
      tile("Median score", median === null ? DASH : median.toFixed(1), "50 = middle of the category", "violet"))];
  }

  function podium(card, gradeOf) {
    const medals = ["gold", "silver", "bronze"];
    return h("section", { class: "fsc-podium", "aria-label": "Top three" }, card.rated.slice(0, 3).map((r, i) => {
      const strongest = [...card.pillars].filter((p) => card.weights[p.key] > 0 && r.pillars[p.key] !== null)
        .sort((a, b) => r.pillars[b.key] - r.pillars[a.key]).slice(0, 3);
      const grade = GRADE[gradeOf(r.code)] ?? GRADE.REVIEW;
      return h("article", { class: `fsc-medal is-${medals[i]}` },
        h("div", { class: "fsc-medal-top" }, h("span", { class: "fsc-medal-rank" }, `#${r.rank}`), ring(r.score, r.quartile)),
        h("h3", {}, r.name),
        h("div", { class: "fsc-medal-tags" }, quartilePill(r.quartile), gradeGauge(grade)),
        h("ul", {}, strongest.map((p) => h("li", {}, h("i", { style: { background: `var(--${PILLAR_COLOR[p.key]})` } }), `${p.label}`, h("b", {}, Math.round(r.pillars[p.key]))))));
    }));
  }

  // ---------- ranked list ----------
  function ranked(card, gradeOf, byCode) {
    const pillars = card.pillars.filter((p) => card.weights[p.key] > 0);
    const body = h("tbody");
    for (const r of card.rated) {
      const gradeKey = gradeOf(r.code);
      const grade = GRADE[gradeKey] ?? GRADE.REVIEW;
      const disagree = (r.quartile === 1 && gradeKey === "WEAK") || (r.quartile === 4 && gradeKey === "STRONG");
      const open = state.open.has(r.code);
      const row = h("tr", { class: `fsc-row${open ? " is-open" : ""}`, tabindex: "0", "aria-expanded": String(open) },
        h("td", { class: "fsc-rank" }, String(r.rank)),
        h("th", { scope: "row", class: "fsc-name" }, r.name, byCode.get(r.code)?.benchmarkName ? h("small", {}, `vs ${byCode.get(r.code).benchmarkName}`) : null),
        h("td", {}, h("div", { class: "fsc-score" }, h("b", {}, r.score.toFixed(1)), h("span", { class: `fsc-bar is-q${r.quartile}` }, h("i", { style: { width: `${r.score}%` } })))),
        h("td", {}, quartilePill(r.quartile)),
        h("td", {}, pillarProfile(r, pillars, card.weights)),
        h("td", {}, gradeGauge(grade), disagree ? h("span", { class: "fsc-flag", title: "The score and the Recommendation Logic disagree strongly — review this fund" }, Icon("alert", { size: 13 })) : null),
        h("td", { class: "fsc-num" }, r.measures.aum.value === null ? DASH : `₹${Math.round(r.measures.aum.value).toLocaleString("en-IN")}`),
        h("td", { class: "fsc-caret" }, Icon("arrowRight", { size: 14 })));
      const toggle = () => { open ? state.open.delete(r.code) : state.open.add(r.code); draw(); };
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      body.append(row);
      if (open) body.append(h("tr", { class: "fsc-detail" }, h("td", { colspan: 8 }, detail(r, card, disagree))));
    }
    return h("section", { class: "fsc-card" },
      h("div", { class: "fsc-card-head" }, h("h3", {}, "Ranked list"), h("p", {}, "Click a fund to see every measure — its value and where it stands in the category (percentile).")),
      h("div", { class: "fsc-legend" }, pillars.map((p) => h("span", {}, h("i", { style: { background: `var(--${PILLAR_COLOR[p.key]})` } }), `${p.label} ${card.weights[p.key]}%`))),
      h("div", { class: "fsc-table-wrap" }, h("table", { class: "fsc-table" },
        h("thead", {}, h("tr", {}, ["Rank", "Fund name", "Score", "Quartile", "Pillar profile", "Prosperr grade", "AUM (₹ Cr)", ""].map((t) => h("th", { scope: "col" }, t)))),
        body)));
  }

  function detail(r, card, disagree) {
    return h("div", { class: "fsc-detail-in" },
      disagree ? h("p", { class: "fsc-warn" }, Icon("alert", { size: 14 }), " The score and the Recommendation Logic point in opposite directions — check this fund before acting on either.") : null,
      h("div", { class: "fsc-detail-grid" }, card.pillars.filter((p) => card.weights[p.key] > 0).map((p) => {
        const def = card.pillars.find((x) => x.key === p.key);
        return h("div", { class: "fsc-pillar", style: { "--accent": `var(--${PILLAR_COLOR[p.key]})` } },
          h("div", { class: "fsc-pillar-head" }, h("strong", {}, p.label), h("span", {}, `${r.pillars[p.key] === null ? "—" : Math.round(r.pillars[p.key])} / 100 · weight ${card.weights[p.key]}%`)),
          def.measures.map((m) => {
            const cell = r.measures[m.key] ?? { value: null, pct: null };
            return h("div", { class: `fsc-measure${m.used ? "" : " is-off"}` },
              h("span", {}, m.label, m.better === "lower" ? h("em", {}, " · lower is better") : null),
              h("b", {}, formatMeasure(m, cell.value, r)),
              h("span", { class: "fsc-pct" }, cell.pct === null ? (m.used ? "n/a" : "not used") : h("i", { style: { width: `${cell.pct}%` } })),
              h("small", {}, cell.pct === null ? "" : `${Math.round(cell.pct)}`));
          }));
      })),
      r.measures.trackingError?.value != null ? h("p", { class: "fsc-note" }, `Tracking error vs the index: ${(r.measures.trackingError.value * 100).toFixed(2)}% a year (used in the information ratio).`) : null,
      r.notes.length ? h("ul", { class: "fsc-notes" }, r.notes.map((n) => h("li", {}, n))) : null);
  }

  function notRated(card) {
    if (!card.notRated.length) return h("div");
    const sorted = [...card.notRated].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    return h("details", { class: "fsc-card fsc-notrated" },
      h("summary", {}, h("h3", {}, `Not rated (${card.notRated.length})`), h("span", {}, "Not scored and not recommended — the reason is shown for each fund")),
      h("ul", {}, sorted.map((n) => h("li", {}, h("strong", {}, n.name), h("span", {}, n.reason)))));
  }

  // ---------- weights & conditions ----------
  function settingsPanel(card) {
    const index = card.kind === "index";
    const canEdit = state.settingsInfo.canEdit && !index;
    return h("section", { class: "fsc-card fsc-settings" },
      h("div", { class: "fsc-card-head" }, h("h3", {}, "Weights & conditions"),
        canEdit ? h("button", { type: "button", class: "fsc-edit", onclick: openEditor }, Icon("lock", { size: 14 }), "Edit") : h("span", { class: "fsc-lock" }, Icon("lock", { size: 13 }), index ? " Index-fund method" : " Set by the owner")),
      h("p", { class: "fsc-sub" }, index ? "Fixed method for index funds (calculation engine)" : card.custom ? `Owner's settings${state.settingsInfo.settings?.updatedAt ? ` · updated ${formatDate(state.settingsInfo.settings.updatedAt.slice(0, 10))}` : ""}` : "Default settings"),
      h("div", { class: "fsc-weights" }, card.pillars.map((p) => h("div", { class: "fsc-weight" },
        h("span", {}, h("i", { style: { background: `var(--${PILLAR_COLOR[p.key]})` } }), p.label),
        h("span", { class: "fsc-weight-bar" }, h("i", { style: { width: `${card.weights[p.key]}%`, background: `var(--${PILLAR_COLOR[p.key]})` } })),
        h("b", {}, `${card.weights[p.key]}%`)))),
      h("h4", {}, "A fund is rated only when"),
      h("ul", { class: "fsc-conds" }, Object.entries(card.conditions).map(([k, v]) => h("li", {}, Icon("checkCircle", { size: 14 }), CONDITION_TEXT[k](v, index)))),
      h("p", { class: "fsc-sub" }, `and its NAV history has no break (a one-day move above 25%) in the last ${index ? "year" : "6 years"}.`));
  }

  // Edit: the password first (checked by the server), then the settings; the password stays only in this call.
  function openEditor() {
    openPasswordDialog({
      passwordSet: Boolean(state.settingsInfo.passwordSet),
      onUnlocked: (password) => (state.settingsInfo = { ...state.settingsInfo, passwordSet: true }, openSettingsDialog({
        settings: resolveSettings(state.settingsInfo.settings), defaults: SCORECARD, pillars: SCORECARD_PILLARS, colors: PILLAR_COLOR, password,
        onSaved: (saved) => { state.settingsInfo = { ...state.settingsInfo, settings: saved }; draw(); },
      })),
    });
  }

  // ---------- model check ----------
  function modelCheck(check, card) {
    if (card.kind === "index") return h("section", { class: "fsc-card fsc-check" }, h("h3", {}, "Model check"), h("p", { class: "fsc-sub" }, "Not needed for index funds: every fund tracks the same index, so the score measures tracking quality directly — there is no stock-picking edge to test."));
    if (!check) return h("section", { class: "fsc-card fsc-check" }, h("h3", {}, "Model check"), h("p", { class: "fsc-sub" }, "Not enough funds with history three years back to test the method in this category."));
    const pct = (x) => (x === null ? DASH : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}%`);
    const verdict = check.edge;
    return h("section", { class: "fsc-card fsc-check" },
      h("div", { class: "fsc-card-head" }, h("h3", {}, "Model check"), h("span", { class: `fsc-verdict${verdict ? " is-ok" : " is-bad"}`, title: "Clear edge: the top quartile beat the category by at least 0.5% a year and the bottom quartile by at least 1% a year" }, verdict ? "Clear edge — top quartile led" : "No clear edge")),
      h("p", { class: "fsc-sub" }, `Funds rated by this method as on ${formatDate(check.from)} (AUM condition and Quality left out — AUM then is not known), and their return since (p.a.).`),
      h("table", { class: "fsc-check-table" },
        h("thead", {}, h("tr", {}, ["Quartile then", "Funds", "Return since", "Beat median"].map((t) => h("th", {}, t)))),
        h("tbody", {}, check.quartiles.map((q) => h("tr", {}, h("td", {}, quartilePill(q.quartile)), h("td", {}, String(q.funds)), h("td", {}, pct(q.avgReturn)), h("td", {}, q.funds ? `${q.beatMedian} of ${q.funds}` : DASH)))),
        h("tfoot", {}, h("tr", {}, h("td", {}, "Category"), h("td", {}, String(check.funds)), h("td", {}, pct(check.categoryAvg)), h("td", {}, `median ${pct(check.median)}`)))),
      h("p", { class: "fsc-note" }, "Funds closed or merged since then are not in today's list, so the test covers surviving funds only."));
  }

  function method(category, d) {
    if (isIndex(category)) {
      return h("details", { class: "fsc-card fsc-method" },
        h("summary", {}, h("h3", {}, "How the score is calculated")),
        h("ol", {},
          h("li", {}, `Only funds whose verified benchmark is ${category.name} are compared, and only those that meet every condition are rated; the rest are listed as Not rated with the reason.`),
          h("li", {}, "Tracking difference: the fund's return minus the index's over 1 year and 3 years (p.a.) at the fund's latest NAV — closer to zero is better."),
          h("li", {}, "Tracking error: how far the fund's daily returns stray from the index's, over 1 and 3 years (annualised) — lower is better."),
          h("li", {}, "Tracking consistency: how steady the rolling 1-year tracking difference has been over the last 12 month-ends; fund quality: AUM."),
          h("li", {}, "Each measure becomes a percentile among the rated funds; a pillar is the average of its measures and the score the weighted average of the pillars. Ranks and quartiles by the E9 rule."),
          h("li", {}, "The Prosperr grade beside each fund comes from the Recommendation Logic, which also judges index funds on how closely they track their index.")),
        h("p", { class: "fsc-note" }, `Fund details (AUM) from PulseDB${d.metadataAsOf ? `, updated ${formatDate(d.metadataAsOf.slice(0, 10))}` : ""}; NAVs from AMFI; index closes from PulseDB. For internal research — not for client distribution.`));
    }
    return h("details", { class: "fsc-card fsc-method" },
      h("summary", {}, h("h3", {}, "How the score is calculated")),
      h("ol", {},
        h("li", {}, "Only funds that meet every condition are rated; the rest are listed as Not rated with the reason — never scored and never recommended."),
        h("li", {}, "Each measure is computed by the calculation engine at the fund's latest NAV: returns (E2), risk on the last 36 monthly returns (E12), drawdown on daily NAVs, calendar years (E3) and quartiles (E9)."),
        h("li", {}, "Every measure is normalised within the category: the fund's percentile among the rated funds (0 = weakest, 100 = strongest; for “lower is better” measures the order is reversed). A measure is used only when at least the minimum number of funds have it."),
        h("li", {}, "A pillar is the average of its measures; the score is the weighted average of the pillars. Funds are ranked by score and placed in quartiles by the E9 rule."),
        h("li", {}, "The Prosperr grade beside each fund comes from the Recommendation Logic (Invest / Hold / Sell engine) on the same daily data; a strong disagreement is flagged.")),
      h("p", { class: "fsc-note" }, `Fund details (AUM) from PulseDB${d.metadataAsOf ? `, updated ${formatDate(d.metadataAsOf.slice(0, 10))}` : ""}; NAVs from AMFI; index closes from PulseDB. ${OWN_INDEX_CATEGORIES.has(category.slug) ? "" : `Benchmark: ${category.benchmark.name}.`} For internal research — not for client distribution.`));
  }

  drawChips();
  load();
  view.replaceChildren(h("main", { class: "fsc" },
    h("section", { class: "site-band frx-band" },
      h("div", { class: "site-band-inner fsc-band" },
        h("div", {},
          h("div", { class: "ds-eyebrow" }, "Fund Research"),
          h("h1", {}, "Fund Scorecard"),
          h("p", { class: "frx-band-text" }, "Every fund rated within its SEBI category on returns, risk-adjusted return, benchmark, volatility, downside, consistency and fund quality — normalised, weighted and ranked.")),
        h("span", { class: "fsc-internal" }, Icon("lock", { size: 14 }), "Internal use only"))),
    h("div", { class: "home-container fsc-body" }, chips, head, h("div", { class: "fsc-layout" }, results, side))));
}

// ---------- small pieces ----------
function quartilePill(q) {
  return h("span", { class: `fsc-q is-q${q}` }, q ? `Q${q}` : DASH);
}

function ring(score, quartile) {
  const r = 26, c = 2 * Math.PI * r;
  return h("svg", { class: `fsc-ring is-q${quartile}`, viewBox: "0 0 64 64", role: "img", "aria-label": `Score ${score.toFixed(1)} of 100` },
    h("circle", { cx: 32, cy: 32, r, class: "fsc-ring-track" }),
    h("circle", { cx: 32, cy: 32, r, class: "fsc-ring-fill", "stroke-dasharray": `${(score / 100) * c} ${c}`, transform: "rotate(-90 32 32)" }),
    h("text", { x: 32, y: 37, "text-anchor": "middle" }, score.toFixed(1)));
}

/** A category rated by the engine but not switched on yet: no figures shown, nothing loaded. */
function pending(category) {
  return h("section", { class: "fsc-pending", style: { "--accent": `var(--${category.accent})` } },
    h("span", { class: "fsc-pending-icon" }, Icon(category.icon, { size: 30, strokeWidth: 1.6 })),
    h("span", { class: "fsc-pending-badge" }, Icon("refresh", { size: 13 }), "Mapping pending"),
    h("h3", {}, `${category.name} — scorecard coming soon`),
    h("p", {}, "This category's funds and benchmark are being mapped and verified. Its ratings will appear here once the mapping is complete."),
    h("div", { class: "fsc-pending-live" }, h("span", {}, "Available now:"), ...EQUITY_CATEGORIES.filter((c) => SCORECARD_LIVE.has(c.slug)).map((c) => h("b", {}, c.name))));
}

function notice(text) {
  return h("div", { class: "fsc-notice" }, Icon("info", { size: 18 }), h("span", {}, text));
}

function skeleton(category) {
  const bar = (w) => h("span", { class: "frx-sk", style: { width: w } });
  return h("div", { class: "fsc-card frx-skeleton", "aria-busy": "true" },
    h("p", { class: "fsc-sub" }, `Rating ${category.name} funds — loading 12 years of NAVs and computing every measure…`),
    Array.from({ length: 7 }, (_, i) => h("div", { class: "frx-sk-row" }, bar(`${34 + ((i * 9) % 20)}%`), bar("10%"), bar("8%"), bar("14%"))));
}

function formatMeasure(m, value, r) {
  if (value === null || value === undefined) return DASH;
  if (m.unit === "pct") return `${value >= 0 ? "" : "−"}${Math.abs(value * 100).toFixed(2)}%`;
  if (m.unit === "ratio") return value.toFixed(2);
  if (m.unit === "share") return `${Math.round(value)}%`;
  if (m.unit === "num") return value.toFixed(1);
  if (m.unit === "days") return `${Math.round(value)} days${r.recovered === false ? " (not yet recovered)" : ""}`;
  if (m.unit === "cr") return `₹${Math.round(value).toLocaleString("en-IN")} Cr`;
  return String(value);
}
