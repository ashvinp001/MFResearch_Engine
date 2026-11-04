/**
 * Detailed Report page furniture: number formats, the section page and the section writer that moves a block
 * to a continuation page when it does not fit. Shared by every section file.
 */

import { h } from "../../../../design-system/components/dom.js";
import { Logo } from "../../../../design-system/components/basics.js";
import { DASH, formatInr } from "../../../shared/format.js";

export const VERDICT_TEXT = { invest: "INVEST", hold: "HOLD", sell: "SELL" };

// ---------- formatting helpers ----------
export const pctWhole = (v) => (v === null || v === undefined ? DASH : `${Math.round(v)}%`);
export const pct1 = (v) => (v === null || v === undefined ? DASH : `${v.toFixed(1)}%`);
export const num2 = (v) => (v === null || v === undefined ? DASH : v.toFixed(2));
export const allocText = (v) => `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
export const badge = (verdict) => (verdict ? h("span", { class: `dr-badge is-${verdict}` }, VERDICT_TEXT[verdict]) : h("span", { class: "dr-muted" }, DASH));
export const rich = (parts) => parts.map((part) => (typeof part === "string" ? part : part.b ? h("strong", {}, part.b) : part.up ? h("strong", { class: "up" }, part.up) : h("strong", { class: "down" }, part.down)));

// ---------- page scaffolding ----------
function sectionPage({ eyebrow, title, footer }) {
  const body = h("div", { class: "dr-body" });
  const el = h("section", { class: "dr-page ds-paper" },
    h("div", { class: "dr-frame" },
      h("header", { class: "dr-head" },
        h("div", {}, h("div", { class: "dr-eyebrow" }, eyebrow), h("h1", { class: "dr-title" }, title)),
        Logo({ size: 28 })),
      h("div", { class: "dr-rule" }),
      body),
    h("footer", { class: "dr-foot" }, h("span", {}, "PROSPERR.IO"), h("span", {}, footer)));
  return { el, body };
}

export const overflowing = (body) => body.scrollHeight > body.clientHeight + 1;
/** Smallest scale a table may shrink to before it continues on a new page (keeps text readable). */
const MIN_TABLE_ZOOM = 0.6;
/** The fund-wise market-cap table may shrink further so Section 02 fits on one page. */
export const MCAP_MIN_ZOOM = 0.45;

/** Section writer: appends blocks and opens a continuation page when a block does not fit. */
export function sectionWriter(stage, spec) {
  let page = null;
  const open = (continued) => {
    page = sectionPage({ ...spec, title: continued ? `${spec.title} (continued)` : spec.title });
    stage.append(page.el);
    return page;
  };
  open(false);
  return {
    get page() { return page; },
    /** Append a block; move it to a new page if it overflows (unless it is the first block on the page). */
    block(node) {
      page.body.append(node);
      if (overflowing(page.body) && page.body.children.length > 1) {
        node.remove();
        open(true).body.append(node);
      }
    },
    /**
     * Keep a table on the current page by scaling it down (to a readable minimum).
     * Only if it still cannot fit does it flow onto a continuation page.
     */
    fitTable({ className, head, groups, before, after = null, minZoom = MIN_TABLE_ZOOM }) {
      if (before) this.block(before);
      const table = h("table", { class: `dr-table ${className ?? ""}`.trim() }, head(), h("tbody", {}, groups.flat()));
      const wrap = h("div", { class: "dr-fit" }, table, after);
      page.body.append(wrap);
      let zoom = 1;
      while (overflowing(page.body) && zoom > minZoom) {
        zoom = Math.round((zoom - 0.02) * 100) / 100;
        wrap.style.zoom = String(zoom);
      }
      if (overflowing(page.body)) {
        wrap.remove();
        this.table({ className, head, groups });
        if (after) this.block(after);
      }
    },
    /** Flow table rows (or row groups) across pages, repeating the table head. */
    table({ className, head, groups, before }) {
      let tbody = null;
      const startTable = () => {
        tbody = h("tbody");
        page.body.append(h("table", { class: `dr-table ${className ?? ""}`.trim() }, head(), tbody));
      };
      if (before) this.block(before);
      startTable();
      for (const rows of groups) {
        const list = Array.isArray(rows) ? rows : [rows];
        tbody.append(...list);
        if (overflowing(page.body) && tbody.children.length > list.length) {
          list.forEach((row) => row.remove());
          open(true);
          startTable();
          tbody.append(...list);
        }
      }
    },
  };
}

// ---------- helpers used by more than one section ----------
// Client-facing: when a figure cannot be shown for this portfolio, say so plainly.
export const pending = (text = "This analysis is not available for the funds in this portfolio.") => h("p", { class: "dr-pending" }, text);

/** A name the CAS prints in capitals, in title case; short abbreviations (US, ETF, BSE, SBI) stay as they are. */
export function titleCase(text) {
  if (text !== text.toUpperCase()) return text;
  return text.split(/(\s+|-)/).map((word) => (/^[A-Z&]{1,3}$/.test(word) && !/^(AND|OF|THE|FOR|CAP|MID|TAX|TOP|NEW|ONE)$/.test(word)
    ? word : word.charAt(0) + word.slice(1).toLowerCase())).join("");
}

/**
 * One entry per fund and verdict: the same fund held in several folios with the same recommendation is
 * written once (values added); folios given different recommendations stay separate, named by folio.
 */
export function byFund(rows) {
  const groups = new Map();
  for (const row of rows) {
    const k = `${row.isin ?? row.name}|${row.verdict ?? ""}`;
    const g = groups.get(k);
    if (g) {
      g.folios.push(row.folio);
      g.current += row.current;
      g.weightPct += row.weightPct;
    } else groups.set(k, { ...row, folios: [row.folio] });
  }
  const list = [...groups.values()];
  const split = new Set(list.map((g) => g.isin ?? g.name).filter((id, i, all) => all.indexOf(id) !== i));
  return list.map((g) => ({
    ...g,
    folioNote: g.folios.length > 1 ? `${g.folios.length} folios, ${formatInr(g.current, { whole: true })} together`
      : split.has(g.isin ?? g.name) && g.folios[0] ? `Folio ${g.folios[0]}` : null,
  }));
}
