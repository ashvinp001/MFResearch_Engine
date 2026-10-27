/**
 * Website shell — the header and footer shared by every Prosperr page.
 *
 *  SiteHeader({ links: [{ label, href, icon?, accent?, badge? }], cta?: { label, href },
 *               theme?: { value: "light" | "dark", onChange(theme) } }) → { element, setActive(href) }
 *      Brand strip on top; logo and colour-coded navigation tabs on the left (accent =
 *      a palette token name such as "green"); optional theme switch and call-to-action
 *      right; menu on mobile.
 *  SiteFooter({ name, tagline, columns: [{ title, links: [{ label, href }] }], legal }) → element
 * Content (labels, URLs) comes from the app; this file only renders it.
 */

import { h } from "./dom.js";
import { Logo } from "./basics.js";
import { Icon } from "./icons.js";

/** Light / dark switch: an icon button showing the theme it switches TO. */
function ThemeToggle({ value, onChange }) {
  const button = h("button", { type: "button", class: "site-theme-toggle" });
  const render = (theme) => {
    const dark = theme === "dark";
    button.setAttribute("aria-pressed", String(dark));
    button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    button.title = dark ? "Light theme" : "Dark theme";
    button.replaceChildren(Icon(dark ? "sun" : "moon", { size: 17, strokeWidth: 2 }));
  };
  let current = value;
  render(current);
  button.addEventListener("click", () => {
    current = current === "dark" ? "light" : "dark";
    onChange(current);
    render(current);
  });
  return button;
}

export function SiteHeader({ links, cta, theme }) {
  const anchors = links.map((link) => h("a", {
    href: link.href,
    class: "site-nav-link",
    style: link.accent ? { "--tab-accent": `var(--${link.accent})` } : null,
  },
  link.icon ? h("span", { class: "site-nav-icon" }, Icon(link.icon, { size: 14, strokeWidth: 2 })) : null,
  link.label,
  link.badge ? h("span", { class: "site-nav-badge" }, link.badge) : null));
  const nav = h("nav", { class: "site-nav", "aria-label": "Main" }, anchors);
  const toggle = h("button", { class: "site-menu-toggle", type: "button", "aria-label": "Open menu", "aria-expanded": "false" },
    h("span"), h("span"), h("span"));

  const element = h("header", { class: "site-header" },
    h("div", { class: "site-header-inner" },
      h("a", { href: links[0]?.href ?? "#", class: "site-brand", "aria-label": "Prosperr home" }, Logo({ size: 40 })),
      h("span", { class: "site-header-divider", "aria-hidden": "true" }),
      nav,
      h("div", { class: "site-header-actions" },
        theme ? ThemeToggle(theme) : null,
        cta ? h("a", { href: cta.href, class: "ds-btn ds-btn-primary ds-btn-sm site-cta" }, cta.label, Icon("arrowRight", { size: 16 })) : null,
        toggle)));

  const closeMenu = () => {
    element.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  };
  toggle.addEventListener("click", () => {
    const open = element.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  nav.addEventListener("click", closeMenu);

  // Subtle shadow once the page scrolls under the sticky header.
  const onScroll = () => element.classList.toggle("is-scrolled", window.scrollY > 4);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  return {
    element,
    /** Highlight the navigation link whose href matches the current route. */
    setActive(href) {
      anchors.forEach((anchor, i) => {
        const active = links[i].href === href;
        anchor.classList.toggle("is-active", active);
        if (active) anchor.setAttribute("aria-current", "page");
        else anchor.removeAttribute("aria-current");
      });
    },
  };
}

export function SiteFooter({ name, tagline, columns = [], legal }) {
  return h("footer", { class: "site-footer" },
    h("div", { class: "site-footer-inner" },
      h("div", { class: "site-footer-brand" },
        name ? h("div", { class: "site-footer-name" }, name) : null,
        h("p", {}, tagline)),
      columns.map((column) => h("div", { class: "site-footer-col" },
        h("div", { class: "site-footer-title" }, column.title),
        h("ul", {}, column.links.map((link) => h("li", {}, h("a", { href: link.href }, link.label))))))
    ),
    h("div", { class: "site-footer-legal" }, legal));
}
