/**
 * Infographic primitives (inline SVG / CSS — identical on screen and in print).
 * They draw finished numbers; no business math here.
 *
 *  DonutSvg({ items: [{ value, color }], size, thickness, gap, centerTop, centerBottom })
 *  GroupedBars({ groups: [{ label, values: [number|null, …] }], series: [{ name, color, labelColor? }], height, slotWidth?, fixedSize? })
 *  StackedBar({ items: [{ label, value, color }] })     100% bar with labels
 *  ChartEmpty({ title, note })                         placeholder until data is connected
 */

import { h } from "./dom.js";
import { Icon } from "./icons.js";

export function DonutSvg({ items, size = 120, thickness = 26, gap = 0, centerTop, centerBottom, ariaLabel }) {
  const radius = (size - thickness) / 2;
  const holeRadius = radius - thickness / 2;
  const circumference = 2 * Math.PI * radius;
  const total = items.reduce((sum, item) => sum + Math.max(item.value, 0), 0);
  let offset = 0;

  const arcs = items.map((item) => {
    const length = total ? (Math.max(item.value, 0) / total) * circumference : 0;
    const arc = h("circle", {
      cx: size / 2, cy: size / 2, r: radius, fill: "none",
      stroke: item.color,
      "stroke-width": thickness,
      "stroke-dasharray": `${Math.max(length - gap, 0.01)} ${circumference}`,
      "stroke-dashoffset": -offset,
    }, item.title ? h("title", {}, item.title) : null);
    offset += length;
    return arc;
  });

  return h("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: "ig-donut", role: "img", "aria-label": ariaLabel ?? "Donut chart" },
    h("circle", { cx: size / 2, cy: size / 2, r: radius, fill: "none", stroke: "var(--surface-alt)", "stroke-width": thickness }),
    h("g", { transform: `rotate(-90 ${size / 2} ${size / 2})` }, arcs),
    // Centre labels are placed relative to the hole so they fit any donut size.
    centerTop ? h("text", { x: size / 2, y: size / 2 + (centerBottom ? holeRadius * 0.12 : holeRadius * 0.3), "text-anchor": "middle", class: "ig-donut-top" }, centerTop) : null,
    centerBottom ? h("text", { x: size / 2, y: size / 2 + holeRadius * 0.6, "text-anchor": "middle", class: "ig-donut-bottom" }, centerBottom) : null);
}

/** Vertical grouped bars with value labels. Negative values sit as a thin bar on the baseline. */
export function GroupedBars({ groups, series, height = 150, barWidth = 26, slotWidth, fixedSize = false, ariaLabel }) {
  const values = groups.flatMap((group) => group.values).filter((value) => value !== null && value !== undefined);
  const max = Math.max(...values.map((value) => Math.max(value, 0)), 1);
  const labelSpace = 18;
  const plot = height - labelSpace - 16;
  const groupWidth = series.length * barWidth + (series.length - 1) * 6;
  const slot = slotWidth ?? groupWidth + 70;
  const width = groups.length * slot;

  const children = groups.flatMap((group, g) => {
    const x0 = g * slot + (slot - groupWidth) / 2;
    const bars = group.values.flatMap((value, s) => {
      const x = x0 + s * (barWidth + 6);
      if (value === null || value === undefined) {
        return [h("text", { x: x + barWidth / 2, y: labelSpace + plot - 4, "text-anchor": "middle", class: "ig-bar-label", fill: series[s].labelColor ?? series[s].color }, "—")];
      }
      const barHeight = value > 0 ? Math.max((value / max) * plot, 3) : 3;
      const y = labelSpace + plot - barHeight;
      return [
        h("rect", { x, y, width: barWidth, height: barHeight, rx: 2, fill: series[s].color }, h("title", {}, `${series[s].name} ${group.label}: ${value}`)),
        h("text", { x: x + barWidth / 2, y: y - 5, "text-anchor": "middle", class: "ig-bar-label", fill: series[s].labelColor ?? series[s].color }, value.toFixed(1)),
      ];
    });
    return [...bars, h("text", { x: x0 + groupWidth / 2, y: height - 2, "text-anchor": "middle", class: "ig-axis-label" }, group.label)];
  });

  return h("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width: fixedSize ? width : null,
    height: fixedSize ? height : null,
    class: "ig-bars", role: "img", "aria-label": ariaLabel ?? "Bar chart", preserveAspectRatio: "xMidYMid meet",
  },
    h("line", { x1: 0, x2: width, y1: labelSpace + plot, y2: labelSpace + plot, class: "ig-baseline" }),
    children);
}

export function StackedBar({ items, ariaLabel }) {
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  return h("div", { class: "ig-stacked", role: "img", "aria-label": ariaLabel ?? "Stacked bar" },
    h("div", { class: "ig-stacked-bar" }, items.map((item) =>
      h("span", { style: { width: `${(item.value / total) * 100}%`, background: item.color }, title: `${item.label}: ${item.value.toFixed(1)}%` }))),
    h("div", { class: "ig-stacked-legend" }, items.map((item) =>
      h("span", {}, h("i", { style: { background: item.color } }), `${item.label} `, h("strong", {}, `${item.value.toFixed(1)}%`)))));
}

export function ChartEmpty({ title = "Data not yet connected", note = "This section fills in automatically once fund and NAV data is connected." } = {}) {
  return h("div", { class: "ig-empty" },
    h("span", { class: "ig-empty-icon" }, Icon("pie", { size: 22 })),
    h("strong", {}, title),
    h("p", {}, note));
}
