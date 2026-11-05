/**
 * Who is using the website (GET /api/whoami): the admin login sees everything; the team login sees everything except
 * the Fund Scorecard. The server enforces the same (nothing opens before sign-in, and its settings API refuses a team
 * login): this only decides what is shown. When the answer cannot be read, the narrower team view is shown.
 *
 * Closing the tab ends the sign-in: the sign-in page marks the tab (sessionStorage, which the browser drops with the
 * tab), and a tab without the mark — a new tab, a reopened one — is signed out and shown the sign-in page again.
 *
 * access() → Promise<{ role: "admin" | "team", signedIn: boolean }>
 */

import { ROUTES } from "./site-config.js";

export const TAB_KEY = "prosperr-tab-signed-in";   // the same name is used in login.html

function tabSignedIn() {
  try { return sessionStorage.getItem(TAB_KEY) === "1"; } catch { return true; }   // no storage: the cookie alone decides
}

/** Never resolves: the page is being replaced (sign-in page), so nothing should render meanwhile. */
const leaving = () => new Promise(() => {});

let pending = null;

export function access() {
  pending ??= (async () => {
    if (!tabSignedIn()) { await signOut(); return leaving(); }
    try {
      const r = await fetch("/api/whoami", { cache: "no-store" });
      if (r.status === 401) { location.replace("/"); return leaving(); }   // the session ended (expired, server restart)
      const a = r.ok ? await r.json() : null;
      return { role: a?.role === "admin" ? "admin" : "team", signedIn: Boolean(a?.signedIn) };
    } catch {
      return { role: "team", signedIn: true };
    }
  })();
  return pending;
}

/** Routes a role may not open. */
export const hiddenRoutes = (role) => (role === "admin" ? [] : [ROUTES.FUND_SCORECARD]);

export async function signOut() {
  try { sessionStorage.removeItem(TAB_KEY); } catch { /* storage unavailable */ }
  try { await fetch("/__logout", { method: "POST" }); } finally { location.replace("/"); }
}

// A page brought back from the browser's back/forward cache is not shown as it was: it is loaded again, so a signed-out
// tab cannot show what it displayed before.
addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
