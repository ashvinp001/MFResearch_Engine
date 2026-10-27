/**
 * Print one element via the browser's "Save as PDF" (free, no services).
 * The element is cloned into #print-root; print CSS hides everything else.
 * Input: (element, fileName) — fileName becomes the suggested PDF name.
 */

/**
 * CSS zoom that cancels the site's fit-to-screen scale (index.html sets --fit on <html>), for an off-screen area
 * where a report is laid out and measured: pages break exactly as they print, whatever the screen.
 */
export function trueSizeZoom() {
  const fit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fit")) || 1;
  return String(1 / fit);
}

export function printElement(element, fileName) {
  const root = document.createElement("div");
  root.id = "print-root";
  root.className = "ds-paper"; // reports print in the light palette whatever the site theme
  root.append(element.cloneNode(true));
  document.body.append(root);
  const previousTitle = document.title;
  document.title = fileName;
  const cleanup = () => {
    root.remove();
    document.title = previousTitle;
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}
