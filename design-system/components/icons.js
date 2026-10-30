/**
 * Icon set — simple 24×24 stroke icons drawn with currentColor, so they take
 * the color of their container (token-driven). Usage: Icon("wallet", { size: 20 }).
 */

import { h } from "./dom.js";

const PATHS = {
  wallet: ["M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7z", "M3 7l12-3v3", "M16 13.5h2"],
  invested: ["M12 3v18", "M16.5 7.5c-.8-1.2-2.4-2-4.5-2-2.5 0-4.5 1.3-4.5 3.2 0 4.3 9 2.3 9 6.6 0 1.9-2 3.2-4.5 3.2-2.1 0-3.9-.9-4.7-2.2"],
  trend: ["M3 17l6-6 4 4 8-8", "M15 7h6v6"],
  layers: ["M12 3l9 5-9 5-9-5 9-5z", "M3 13l9 5 9-5"],
  building: ["M4 21V6l8-3 8 3v15", "M9 21v-5h6v5", "M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01"],
  shield: ["M12 3l8 3v6c0 4.5-3.3 8.3-8 9-4.7-.7-8-4.5-8-9V6l8-3z", "M8.5 12l2.5 2.5 4.5-5"],
  lock: ["M6 11h12v10H6z", "M8 11V8a4 4 0 0 1 8 0v3"],
  eye: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  bolt: ["M13 3L5 13h6l-1 8 8-10h-6l1-8z"],
  upload: ["M12 16V4", "M7 9l5-5 5 5", "M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"],
  file: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z", "M14 3v5h5", "M9 13h6M9 17h6"],
  calendar: ["M4 6h16v15H4z", "M4 10h16", "M8 3v5M16 3v5"],
  check: ["M20 6L9 17l-5-5"],
  checkCircle: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z", "M8 12l3 3 5-6"],
  alert: ["M12 3l10 18H2L12 3z", "M12 10v5", "M12 18h.01"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M21 21l-5-5"],
  pie: ["M12 3v9h9", "M21 12a9 9 0 1 1-9-9"],
  list: ["M8 6h13M8 12h13M8 18h13", "M3 6h.01M3 12h.01M3 18h.01"],
  arrowRight: ["M5 12h14", "M13 6l6 6-6 6"],
  refresh: ["M20 11a8 8 0 1 0-2.3 5.7", "M20 4v7h-7"],
  info: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z", "M12 11v6", "M12 7.5h.01"],
  bulb: ["M9 18h6", "M10 21h4", "M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"],
  sparkle: ["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z", "M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z"],
  x: ["M6 6l12 12M18 6L6 18"],
  plus: ["M12 5v14", "M5 12h14"],
  download: ["M12 4v12", "M7 11l5 5 5-5", "M4 20h16"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21a8 8 0 0 1 16 0"],
  home: ["M3 11l9-7 9 7", "M5 10v10h5v-6h4v6h5V10"],
  sun: ["M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"],
  moon: ["M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"],
  // Fund categories
  equity: ["M4 20h16", "M6 16v-3M10 16v-6M14 16v-4M18 16V7", "M5 10l5-4 4 3 5-5", "M16 4h3v3"],
  hybrid: ["M12 4v16", "M6 20h12", "M4 8h16", "M7 8l-3 6a3 3 0 0 0 6 0L7 8z", "M17 8l-3 6a3 3 0 0 0 6 0l-3-6z"],
  index: ["M3 4h18v12H3z", "M8 20h8M12 16v4", "M6 13l3-3 3 2 5-5"],
  debt: ["M12 3c3.9 0 7 1.3 7 3s-3.1 3-7 3-7-1.3-7-3 3.1-3 7-3z", "M5 6v4c0 1.7 3.1 3 7 3s7-1.3 7-3V6", "M5 10v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4", "M5 14v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"],
  etf: ["M3 6h14v11H3z", "M6 14l3-3 2 2 3-3", "M7 21h6M10 17v4", "M15 3h6v4h-6z"],
  nfo: ["M6 4v16M12 4v16M18 4v16", "M4 8h4v5H4zM10 11h4v4h-4zM16 7h4v6h-4z"],
};

export function Icon(name, { size = 20, strokeWidth = 1.8, className = "" } = {}) {
  return h(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": strokeWidth,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: `ds-icon ${className}`.trim(),
      "aria-hidden": "true",
      focusable: "false",
    },
    (PATHS[name] ?? []).map((d) => h("path", { d }))
  );
}
