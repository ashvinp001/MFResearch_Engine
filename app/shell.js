/**
 * Site shell — renders the header and footer once and exposes the content area
 * that each routed page renders into.
 *
 * mountSiteShell(root, { hidden: [route], account? }) → { view: HTMLElement, setActive(route) }
 *   hidden    routes this login may not open (the team login: the Fund Scorecard), left out of the menu and footer
 *   account   { label, onSignOut } on another computer: who is signed in, with a sign-out button
 */

import { SiteFooter, SiteHeader } from "../design-system/components/site-shell.js";
import { h } from "../design-system/components/dom.js";
import { SITE_FOOTER, SITE_NAV } from "./shared/site-config.js";
import { currentTheme, setTheme } from "./shared/theme.js";

export function mountSiteShell(root, { hidden = [], account = null } = {}) {
  const shown = (link) => !hidden.includes(link.href);
  const footer = { ...SITE_FOOTER, columns: SITE_FOOTER.columns.map((c) => ({ ...c, links: c.links.filter(shown) })) };
  const header = SiteHeader({ links: SITE_NAV.filter(shown), theme: { value: currentTheme(), onChange: setTheme }, account });
  const view = h("div", { class: "site-view", id: "main-content" });
  root.classList.add("site");
  root.replaceChildren(header.element, view, SiteFooter(footer));
  return { view, setActive: header.setActive };
}
