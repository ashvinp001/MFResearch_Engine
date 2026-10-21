/**
 * Chart components — inline SVG, so the same chart renders on screen and prints
 * crisply. They draw already-computed data; there is no business math here.
 *
 *  DonutChart({ items: [{ label, value, display }], centerLabel, centerValue, maxSlices })
 *     Slices take CHART_SEQUENCE colors in fixed order; anything past maxSlices
 *     folds into "Other" (grey). Legend always shown, with value and share.
 *  BarChart({ items: [{ label, value, display }], color })
 *     Horizontal ranked bars, one series, value labels at the bar end.
 * Both show a hover tooltip and expose an accessible text summary.
 */

import { h } from "./dom.js";
import { CHART_SEQUENCE } from "../tokens.js";

const OTHER_COLOR = "var(--grey)";

function attachTooltip(container) {
  const tip = h("div", { class: "ds-tooltip", role: "tooltip", hidden: true });
  container.append(tip);
  return {
    show(event, lines) {
      tip.replaceChildren(...lines.map((line, i) => h("div", { class: i === 0 ? "ds-tooltip-title" : null }, line)));
      tip.hidden = false;
      const box = container.getBoundingClientRect();
      const x = Math.min(event.clientX - box.left + 14, box.width - tip.offsetWidth - 4);
      tip.style.left = `${Math.max(4, x)}px`;
      tip.style.top = `${event.clientY - box.top + 14}px`;
    },
    hide() { tip.hidden = true; },
  };
}

export function DonutChart({ items, centerLabel, centerValue, maxSlices = 5, ariaLabel }) {
  const sorted = [...items].sort((p, q) => q.value - p.value);
  const head = sorted.slice(0, maxSlices).map((item, i) => ({ ...item, color: CHART_SEQUENCE[i] }));
  const tail = sorted.slice(maxSlices);
  if (tail.length) {
    const value = tail.reduce((sum, item) => sum + item.value, 0);
    head.push({ label: `Other (${tail.length})`, value, display: null, color: OTHER_COLOR, members: tail.map((item) => item.label) });
  }
  const total = head.reduce((sum, item) => sum + item.value, 0);

  const size = 200;
  const radius = 80;
  const thickness = 26;
  const circumference = 2 * Math.PI * radius;

  const container = h("div", { class: "ds-chart ds-donut" });
  const tooltip = attachTooltip(container);

  let offset = 0;
  const arcs = head.map((item) => {
    const share = total ? item.value / total : 0;
    const length = share * circumference;
    const arc = h("circle", {
      cx: size / 2, cy: size / 2, r: radius,
      fill: "none",
      stroke: item.color,
      "stroke-width": thickness,
      "stroke-dasharray": `${Math.max(length - 2, 0.01)} ${circumference}`,
      "stroke-dashoffset": -offset,
      class: "ds-donut-arc",
      style: { "--arc-length": `${Math.max(length - 2, 0.01)}px`, "--circumference": `${circumference}px` },
    });
    const lines = [item.label, `${(share * 100).toFixed(1)}%${item.display ? ` · ${item.display}` : ""}`];
    arc.addEventListener("mousemove", (event) => tooltip.show(event, lines));
    arc.addEventListener("mouseleave", () => tooltip.hide());
    offset += length;
    return arc;
  });

  const svg = h(
    "svg",
    { viewBox: `0 0 ${size} ${size}`, class: "ds-donut-svg", role: "img", "aria-label": ariaLabel ?? centerLabel },
    h("circle", { cx: size / 2, cy: size / 2, r: radius, fill: "none", stroke: "var(--surface-alt)", "stroke-width": thickness }),
    h("g", { transform: `rotate(-90 ${size / 2} ${size / 2})` }, arcs)
  );

  const legend = h("ul", { class: "ds-legend" }, head.map((item) =>
    h("li", { title: item.members ? item.members.join(", ") : null },
      h("span", { class: "ds-legend-swatch", style: { background: item.color } }),
      h("span", { class: "ds-legend-label" }, item.label),
      h("span", { class: "ds-legend-value ds-num" }, `${total ? ((item.value / total) * 100).toFixed(1) : "0.0"}%`)
    )
  ));

  container.append(
    h("div", { class: "ds-donut-figure" },
      svg,
      h("div", { class: "ds-donut-center" },
        h("div", { class: "ds-donut-center-value ds-num" }, centerValue),
        h("div", { class: "ds-donut-center-label" }, centerLabel))
    ),
    legend
  );
  return container;
}

export function BarChart({ items, color = CHART_SEQUENCE[0], ariaLabel }) {
  const max = Math.max(...items.map((item) => item.value), 0);
  const container = h("div", { class: "ds-chart ds-bars", role: "img", "aria-label": ariaLabel });
  const tooltip = attachTooltip(container);

  for (const item of items) {
    const pct = max ? (item.value / max) * 100 : 0;
    const row = h("div", { class: "ds-bar-row" },
      h("div", { class: "ds-bar-label", title: item.label }, item.label),
      h("div", { class: "ds-bar-track" },
        h("div", { class: "ds-bar-fill", style: { width: `${pct}%`, background: color } })),
      h("div", { class: "ds-bar-value ds-num" }, item.display)
    );
    row.addEventListener("mousemove", (event) => tooltip.show(event, [item.label, ...(item.tooltip ?? [item.display])]));
    row.addEventListener("mouseleave", () => tooltip.hide());
    container.append(row);
  }
  return container;
}
