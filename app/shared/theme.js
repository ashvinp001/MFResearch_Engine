/**
 * Website theme — light (default) or dark (Project_Specification_TEMP.md §3.1).
 *
 *  currentTheme() → "light" | "dark"
 *  setTheme(theme) → applies it to <html data-theme> and remembers it in this browser.
 * index.html applies the remembered theme before the page paints, so it never flashes.
 * Reports (.ds-paper) always stay light; see design-system/tokens.css.
 */

export const THEME_STORAGE_KEY = "prosperr-theme";
const THEMES = new Set(["light", "dark"]);

export function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setTheme(theme) {
  if (!THEMES.has(theme)) return;
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private window, site data off): the theme still applies for this visit.
  }
}
