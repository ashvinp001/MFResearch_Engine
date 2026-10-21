/**
 * Print one element via the browser's "Save as PDF" (free, no services).
 * The element is cloned into #print-root; print CSS hides everything else.
 * Input: (element, fileName) — fileName becomes the suggested PDF name.
 */

export function printElement(element, fileName) {
  const root = document.createElement("div");
  root.id = "print-root";
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
