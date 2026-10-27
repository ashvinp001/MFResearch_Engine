/**
 * Site shell — renders the header and footer once and exposes the content area
 * that each routed page renders into.
 *
 * mountSiteShell(root) → { view: HTMLElement, setActive(route) }
 */

import { SiteFooter, SiteHeader } from "../design-system/components/site-shell.js";
import { h } from "../design-system/components/dom.js";
import { SITE_FOOTER, SITE_NAV } from "./shared/site-config.js";
import { currentTheme, setTheme } from "./shared/theme.js";

export function mountSiteShell(root) {
  const header = SiteHeader({ links: SITE_NAV, theme: { value: currentTheme(), onChange: setTheme } });
  const view = h("div", { class: "site-view", id: "main-content" });
  root.classList.add("site");
  root.replaceChildren(header.element, view, SiteFooter(SITE_FOOTER));
  return { view, setActive: header.setActive };
}
