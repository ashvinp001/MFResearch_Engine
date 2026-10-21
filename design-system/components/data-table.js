/**
 * DataTable — bordered table, navy header, zebra rows, tinted group bands.
 *
 * Input: {
 *   columns: [ { key, label, align?: "left"|"right", render?: (row) => Node|string } ],
 *   groups:  [ { label, sub?, accent?, rows: [...] } ]   // or `rows` for a flat table
 *   caption?, onRowClick?(row), rowClass?(row)
 * }
 * Output: a scrollable table element. Values arrive already formatted.
 */

import { h } from "./dom.js";

export function DataTable({ columns, groups, rows, caption, onRowClick, rowClass }) {
  const bodyGroups = groups ?? [{ label: null, rows: rows ?? [] }];

  const head = h("thead", {}, h("tr", {}, columns.map((column) =>
    h("th", { scope: "col", class: column.align === "right" ? "ds-right" : null }, column.label)
  )));

  const bodies = bodyGroups.map((group) => h(
    "tbody",
    {},
    group.label
      ? h("tr", { class: "ds-group-row", style: group.accent ? { "--accent": group.accent } : null },
          h("th", { scope: "colgroup", colspan: columns.length },
            h("span", { class: "ds-group-label" }, group.label),
            group.sub ? h("span", { class: "ds-group-sub" }, group.sub) : null))
      : null,
    group.rows.map((row) => h(
      "tr",
      {
        class: [onRowClick ? "ds-clickable" : "", rowClass?.(row) ?? ""].join(" ").trim() || null,
        tabindex: onRowClick ? 0 : null,
        onclick: onRowClick ? () => onRowClick(row) : null,
        onkeydown: onRowClick ? (event) => { if (event.key === "Enter") onRowClick(row); } : null,
      },
      columns.map((column) => h(
        "td",
        { class: column.align === "right" ? "ds-right ds-num" : null },
        column.render ? column.render(row) : row[column.key] ?? "—"
      ))
    ))
  ));

  return h("div", { class: "ds-table-wrap" },
    h("table", { class: "ds-table" }, caption ? h("caption", {}, caption) : null, head, bodies)
  );
}
