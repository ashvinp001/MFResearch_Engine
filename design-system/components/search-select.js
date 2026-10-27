/**
 * SearchSelect — a text box that lists matches as you type (accessible combobox).
 *
 * SearchSelect({ placeholder, value, search(query) → Promise<items> | items, onPick(item), label, minChars })
 *   → { element, focus() }
 * items: [{ label, sub?, group? }] — consecutive items with the same `group` sit under one heading.
 * `search("")` is called on focus when the box is empty, so the caller can offer a starting list
 * (e.g. the client's own funds); typed queries shorter than `minChars` show that same list.
 * Keyboard: ↓ / ↑ move through the list, Enter picks, Esc closes. Matching is done by the caller.
 */

import { h } from "./dom.js";
import { Icon } from "./icons.js";

let uid = 0;
const MAX_LIST_HEIGHT = 320;   // matches .ds-search-list max-height
const BOTTOM_RESERVE = 96;     // room for a sticky action bar at the bottom of the screen

export function SearchSelect({ placeholder = "Search…", value = "", search, onPick, label = "Search", minChars = 2 }) {
  const listId = `ds-search-list-${++uid}`;
  const input = h("input", {
    class: "ds-input ds-search-input", type: "search", placeholder, value, autocomplete: "off", spellcheck: "false",
    role: "combobox", "aria-label": label, "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": listId,
  });
  const list = h("ul", { class: "ds-search-list", id: listId, role: "listbox", hidden: true });
  let items = [];
  let options = [];   // the <li> elements that can be picked, in item order
  let active = -1;
  let ticket = 0;
  let picked = value; // the label currently chosen (re-shown if the box is left without a new pick)

  // The open list is rendered on <body> (fixed position, aligned to the box), so no container's
  // overflow, transform or stacking order can clip or cover it.
  const reposition = () => placeList();
  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    active = -1;
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    list.remove();
  };
  const highlight = (index) => {
    active = index;
    options.forEach((li, i) => li.setAttribute("aria-selected", String(i === index)));
    options[index]?.scrollIntoView?.({ block: "nearest" });
  };
  const pick = (index) => {
    const item = items[index];
    if (!item) return;
    input.value = picked = item.label;
    close();
    onPick(item);
  };

  /** Align the list to the box; open upwards when the space below (minus a sticky bottom bar) is too small. */
  function placeList() {
    if (list.hidden) return;
    if (list.parentElement !== document.body) {
      document.body.append(list);
      window.addEventListener("scroll", reposition, true);
      window.addEventListener("resize", reposition);
    }
    const box = input.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - BOTTOM_RESERVE;
    const needed = Math.min(list.scrollHeight, MAX_LIST_HEIGHT);
    const up = below < needed && box.top > below;
    Object.assign(list.style, {
      left: `${box.left}px`, width: `${box.width}px`,
      top: up ? "" : `${box.bottom + 4}px`, bottom: up ? `${window.innerHeight - box.top + 4}px` : "",
    });
  }

  async function refresh() {
    const mine = ++ticket;
    const typed = input.value.trim();
    const query = typed.length >= minChars ? typed : "";
    const found = await search(query);
    if (mine !== ticket) return; // a newer keystroke won
    items = found;
    options = [];
    const rows = [];
    let group = null;
    items.forEach((item, i) => {
      if (item.group && item.group !== group) {
        group = item.group;
        rows.push(h("li", { class: "ds-search-group", role: "presentation" }, group));
      }
      const li = h("li", { role: "option", class: "ds-search-option", "aria-selected": "false" },
        h("span", { class: "ds-search-label" }, item.label), item.sub ? h("span", { class: "ds-search-sub" }, item.sub) : null);
      li.addEventListener("mousedown", (event) => { event.preventDefault(); pick(i); });
      options.push(li);
      rows.push(li);
    });
    if (!items.length && query) rows.push(h("li", { class: "ds-search-empty" }, "No fund matches — try fewer or different words."));
    if (!items.length && !query && typed) rows.push(h("li", { class: "ds-search-empty" }, `Type at least ${minChars} letters to search all funds.`));
    list.replaceChildren(...rows);
    list.hidden = rows.length === 0;
    placeList();
    input.setAttribute("aria-expanded", String(!list.hidden));
    active = -1;
  }

  input.addEventListener("input", refresh);
  input.addEventListener("focus", () => { input.select(); refresh(); });
  input.addEventListener("blur", () => { close(); if (!input.value.trim() || input.value !== picked) input.value = picked; });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && options.length) { event.preventDefault(); highlight(Math.min(options.length - 1, active + 1)); }
    else if (event.key === "ArrowUp" && options.length) { event.preventDefault(); highlight(Math.max(0, active - 1)); }
    else if (event.key === "Enter" && active >= 0) { event.preventDefault(); pick(active); }
    else if (event.key === "Escape") { close(); input.blur(); }
  });

  const element = h("div", { class: "ds-search" }, h("span", { class: "ds-search-icon" }, Icon("search", { size: 16 })), input);
  return { element, focus: () => input.focus() };
}
