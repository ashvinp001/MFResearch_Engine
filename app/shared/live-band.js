/**
 * Live header shared by Fund Research and the Fund Scorecard. Display only: real stored data, nothing calculated for ratings.
 *
 * liveBand() → { layer, pulse, ticker }   Each element fills itself once its data arrives.
 * indexCloses() → Promise<{ [code]: { name, series } } | null>   The same stored index closes, for other parts of a page.
 *   layer   moving colour, still weekly NIFTY 50 candles with the moving NIFTY 50 and NIFTY 500 lines over them, and rising particles
 *   pulse   glowing dot with the time the latest NAVs were stored
 *   ticker  sliding strip of index closes; hovering pauses it, and it is left out when the data cannot be loaded
 * The data is kept for the visit, so moving between the two pages shows everything at once with nothing moving; the first
 * time, the ticker's height is already reserved and each part fades in.
 * Motion stops for anyone whose device asks for reduced motion (design-system/components/live-band.css).
 */

import { h } from "../../design-system/components/dom.js";
import { lastMove, recentPoints, TRACKED_INDICES } from "../../calculation-engine/index.js";
import { loadBenchmarkHistories, loadValuationData } from "./market-data.js";
import { formatDate } from "./format.js";

const PARTICLES = 46;
const CANDLE_CODE = "OB48";   // NIFTY 50
const SECOND_LINE_CODE = "OB56";   // NIFTY 500
const CANDLE_DAYS = 5;        // trading days in one candle
const TICKER = TRACKED_INDICES.filter((index) => index.family !== "factor");
const number = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Still weekly candles from the stored daily closes (intraday prices are not stored): each opens at the previous week's
 * close, closes at the week's last close, and its wick spans the week's closes. Rising and falling weeks differ in
 * brightness as well as colour.
 */
function marketCandles(series) {
  const { values } = recentPoints(series, 365);
  const weeks = [];
  for (let i = 1; i < values.length; i += CANDLE_DAYS) {
    const days = values.slice(i, i + CANDLE_DAYS);
    weeks.push({ open: values[i - 1], close: days.at(-1), high: Math.max(values[i - 1], ...days), low: Math.min(values[i - 1], ...days) });
  }
  if (weeks.length < 2) return null;
  const min = Math.min(...weeks.map((w) => w.low)), span = Math.max(...weeks.map((w) => w.high)) - min || 1;
  const y = (v) => 195 - ((v - min) / span) * 190;
  const step = 1200 / weeks.length, body = step * 0.56;
  const shapes = { up: { wick: "", body: "" }, down: { wick: "", body: "" } };
  weeks.forEach((w, i) => {
    const x = (i + 0.5) * step;
    const top = y(Math.max(w.open, w.close)), bottom = Math.max(y(Math.min(w.open, w.close)), top + 1.5);
    const shape = shapes[w.close >= w.open ? "up" : "down"];
    shape.wick += `M${x.toFixed(1)},${y(w.high).toFixed(1)}V${y(w.low).toFixed(1)}`;
    shape.body += `M${(x - body / 2).toFixed(1)},${top.toFixed(1)}h${body.toFixed(1)}V${bottom.toFixed(1)}h${(-body).toFixed(1)}Z`;
  });
  return h("svg", { class: "live-candles", viewBox: "0 0 1200 200", preserveAspectRatio: "none", "aria-hidden": "true" },
    ["up", "down"].map((key) => [h("path", { class: `live-wick is-${key}`, d: shapes[key].wick }), h("path", { class: `live-candle-body is-${key}`, d: shapes[key].body })]));
}

/**
 * A moving line: the year of closes followed by its mirror image, repeated, so it can drift for ever with no jump
 * where the year's end meets its start. A background graphic; the candles and the ticker carry the actual figures.
 */
function marketLine(series, className) {
  const { values } = recentPoints(series, 365);
  if (values.length < 2) return null;
  const min = Math.min(...values), span = Math.max(...values) - min || 1;
  const cycle = [...values, ...[...values].reverse()];
  const y = (v) => (190 - ((v - min) / span) * 180).toFixed(1);
  const part = (offset) => cycle.map((v, i) => `${(offset + (i / (cycle.length - 1)) * 2400).toFixed(1)},${y(v)}`);
  return h("svg", { class: `live-line ${className}`, viewBox: "0 0 4800 200", preserveAspectRatio: "none", "aria-hidden": "true" },
    h("path", { d: `M${[...part(0), ...part(2400)].join("L")}` }));
}

function tickerItem({ name, series }) {
  const move = lastMove(series);
  const up = move.change >= 0;
  return h("span", { class: "live-tick-item" }, h("b", {}, name), number.format(move.value),
    h("span", { class: up ? "is-up" : "is-down" }, `${up ? "▲ +" : "▼ −"}${Math.abs(move.change * 100).toFixed(2)}%`));
}

function updatedText(generatedAt) {
  const when = new Date(generatedAt);
  if (Number.isNaN(when.getTime())) return null;
  const time = when.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
  const day = when.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return `Data updated ${formatDate(day)}, ${time}`;
}

let market = null;    // { indices, updated } once loaded: reused on every later visit to the page
let loading = null;   // the load in progress, shared by everyone who asks

function loadMarket() {
  loading ??= (async () => {
    const [indices, valuation] = await Promise.all([loadBenchmarkHistories(TRACKED_INDICES.map((index) => index.code), { years: 1 }), loadValuationData()]);
    const generatedAt = valuation.latestNavs?.generatedAt;
    const loaded = { indices, updated: generatedAt ? updatedText(generatedAt) : null };
    if (indices) market = loaded;
    else loading = null;   // a failed load is tried again on the next visit
    return loaded;
  })();
  return loading;
}

export async function indexCloses() {
  return (await loadMarket()).indices;
}

export function liveBand() {
  const layer = h("div", { class: "live-layer", "aria-hidden": "true" },
    Array.from({ length: PARTICLES }, (_, i) => h("span", { class: "live-particle", style: {
      left: `${(i * 37) % 100}%`, top: `${50 + ((i * 53) % 50)}%`, width: `${2 + (i % 4)}px`, height: `${2 + (i % 4)}px`,
      "animation-duration": `${7 + ((i * 3) % 9)}s`, "animation-delay": `${-((i * 7) % 15)}s` } })));
  const pulse = h("span", { class: "live-pulse" }, h("i", { "aria-hidden": "true" }), h("span", {}, " "));
  const ticker = h("section", { class: "live-ticker", "aria-label": "Index closes" });

  function fill({ indices, updated }, instant) {
    const mode = instant ? " is-instant" : "";
    if (updated) { pulse.lastChild.textContent = updated; pulse.className = `live-pulse is-ready${mode}`; }
    if (!indices) { ticker.remove(); return; }
    const chart = [marketCandles(indices[CANDLE_CODE]?.series), marketLine(indices[SECOND_LINE_CODE]?.series, "is-second"), marketLine(indices[CANDLE_CODE]?.series, "is-first")].filter(Boolean);
    if (chart.length) layer.append(h("div", { class: `live-chart${mode}` }, chart));
    const items = TICKER.map((index) => ({ name: index.name, series: indices[index.code]?.series })).filter((item) => lastMove(item.series));
    if (!items.length) { ticker.remove(); return; }
    const closeDate = items.reduce((latest, item) => (item.series.last > latest ? item.series.last : latest), "");
    ticker.classList.add("is-ready");
    if (instant) ticker.classList.add("is-instant");
    ticker.replaceChildren(
      h("span", { class: "live-tick-date" }, `Closing values as on ${formatDate(closeDate)}`),
      h("div", { class: "live-tick-window" }, h("div", { class: "live-tick-run" },
        h("div", { class: "live-tick-set" }, items.map(tickerItem)),
        h("div", { class: "live-tick-set", "aria-hidden": "true" }, items.map(tickerItem)))));
  }

  if (market) fill(market, true);
  else loadMarket().then((loaded) => fill(loaded, false));
  return { layer, pulse, ticker };
}
