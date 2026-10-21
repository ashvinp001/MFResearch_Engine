/**
 * Minimal DOM builder used by every component. Text is always set as text
 * (never parsed as HTML), so values read from a PDF can never inject markup.
 *
 * h("div", { class: "x", style: { color: "var(--navy)" }, onclick: fn }, "text", childNode)
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set(["svg", "g", "path", "circle", "rect", "line", "text", "title"]);

export function h(tag, attrs = {}, ...children) {
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);

  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "style" && typeof value === "object") {
      for (const [prop, val] of Object.entries(value)) el.style.setProperty(prop, val);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value);
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }

  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}
