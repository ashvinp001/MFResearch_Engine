/**
 * Upload page (Project_Specification_TEMP.md §4.1) — the advisor's landing view of the Portfolio Analyzer.
 * Hero with the upload card, a short note on the two reports, "how it works", and supported statements. Holds no parsing logic — it hands the file to onAnalyze.
 *
 * Input:  { onAnalyze({ file, password }) → Promise,
 *           onFileSelected(file) → Promise<"open" | "password" | "unreadable"> }
 * Flow: choose file → (password asked at once if protected) → Analyse.
 * Output: { element, showPasswordField(), setStatus(text, tone), setBusy(bool) }
 */

import { h } from "../../../design-system/components/dom.js";
import { Icon } from "../../../design-system/components/icons.js";
import { accentAt } from "../../../design-system/tokens.js";

const TRUST = [
  ["lock", "Client data stays on this device"],
  ["shield", "Verified against the statement"],
  ["bolt", "Ready in seconds"],
];

const STEPS = [
  ["upload", "Upload the client's CAS", "Add the statement PDF your client shared with you."],
  ["search", "Every holding is read", "Each fund is captured exactly as printed and keyed by its ISIN."],
  ["shield", "Automatically verified", "Totals are matched against the statement, so you can rely on every number."],
  ["pie", "Review with your client", "Value, gains and allocation in one clear view, ready to discuss."],
];

const SOURCES = ["CAMS", "KFintech", "NSDL", "CDSL"];

/** The two reports the advisor can prepare (chosen after pressing Analyse). */
const REPORTS = [
  {
    variant: "one", cover: ["Portfolio", "Snapshot"], accent: "var(--navy)",
    title: "One-Pager Snapshot Report",
    text: "A one-page factsheet for a quick client conversation.",
    tags: ["1 page", "Holdings & allocation", "Returns & risk"],
  },
  {
    variant: "detail", cover: ["Portfolio Review", "& Recommendation"], accent: "var(--green)",
    title: "Detailed Recommendation Report",
    text: "A complete review with your Invest / Hold / Sell call and a recommended portfolio.",
    tags: ["Full review", "Invest · Hold · Sell", "Recommended portfolio"],
  },
];

export function createUploadScreen({ onAnalyze, onFileSelected }) {
  let file = null;

  const fileInput = h("input", { type: "file", accept: "application/pdf,.pdf", class: "app-visually-hidden", id: "cas-file" });
  const fileName = h("span", { class: "app-file-name" });
  const fileChip = h("div", { class: "app-file-chip", hidden: true }, Icon("file", { size: 18 }), fileName);
  const passwordInput = h("input", { type: "password", class: "ds-input", id: "cas-password", autocomplete: "off", placeholder: "Password set by the client, or the client's PAN" });
  const passwordField = h("div", { class: "app-password", hidden: true },
    h("label", { class: "ds-label", for: "cas-password" }, Icon("lock", { size: 14 }), " This statement is password-protected"),
    passwordInput);
  const status = h("div", { class: "app-status", role: "status", "aria-live": "polite" });
  const buttonLabel = h("span", {}, "Analyse portfolio");
  const analyzeButton = h("button", { class: "ds-btn ds-btn-primary app-analyze", type: "submit", disabled: true }, buttonLabel, Icon("arrowRight", { size: 18 }));
  const clearButton = h("button", { class: "ds-btn app-clear", type: "button", hidden: true }, "Remove");

  const dropzone = h("label", { class: "app-dropzone", for: "cas-file" },
    h("span", { class: "app-dropzone-icon" }, Icon("upload", { size: 26 })),
    h("span", { class: "app-dropzone-title" }, "Drag & drop the client's CAS here"),
    h("span", { class: "app-dropzone-sub" }, "or ", h("span", { class: "app-link" }, "browse your files"), " · PDF only"),
    // The input lives inside the drop zone: focusing it must never scroll the page.
    fileInput
  );

  let needsPassword = false;

  function updateAnalyzeButton() {
    analyzeButton.disabled = !file || (needsPassword && passwordInput.value.trim() === "");
  }

  async function setFile(next) {
    if (next && !/\.pdf$/i.test(next.name) && next.type !== "application/pdf") {
      setStatus("That doesn't look like a PDF. Please choose the client's CAS PDF file.", "negative");
      return;
    }
    file = next;
    needsPassword = false;
    fileName.textContent = file ? file.name : "";
    fileChip.hidden = !file;
    clearButton.hidden = !file;
    dropzone.classList.toggle("app-has-file", Boolean(file));
    passwordField.hidden = true;
    passwordInput.value = "";
    setStatus("");
    updateAnalyzeButton();

    // Check right away whether the statement is password-protected, so the
    // password is entered BEFORE Analyse.
    if (!file || !onFileSelected) return;
    const chosen = file;
    analyzeButton.disabled = true;
    setStatus("Checking the file…", "info");
    const access = await onFileSelected(chosen);
    if (file !== chosen) return; // a different file was chosen meanwhile
    setStatus("");
    if (access === "password") {
      needsPassword = true;
      showPasswordField();
      setStatus("This statement is password-protected. Enter the password, then press Analyse.", "info");
    } else if (access === "unreadable") {
      setStatus("This file could not be opened as a PDF. Please choose the original CAS PDF.", "negative");
    }
    updateAnalyzeButton();
  }

  function showPasswordField() {
    passwordField.hidden = false;
    passwordInput.focus();
  }

  function setStatus(text, tone = "info") {
    status.textContent = text;
    status.dataset.tone = tone;
  }

  function setBusy(busy) {
    if (busy) analyzeButton.disabled = true;
    else updateAnalyzeButton();
    clearButton.disabled = busy;
    analyzeButton.classList.toggle("is-busy", busy);
    buttonLabel.textContent = busy ? "Reading the statement…" : "Analyse portfolio";
  }

  fileInput.addEventListener("change", () => setFile(fileInput.files[0] ?? null));
  passwordInput.addEventListener("input", updateAnalyzeButton);
  for (const type of ["dragenter", "dragover"]) {
    dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.add("app-dragging"); });
  }
  for (const type of ["dragleave", "drop"]) {
    dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.remove("app-dragging"); });
  }
  dropzone.addEventListener("drop", (event) => setFile(event.dataTransfer.files[0] ?? null));
  clearButton.addEventListener("click", () => { fileInput.value = ""; setFile(null); });

  const form = h("form", { class: "app-upload-card site-reveal", style: { "--i": 2 } },
    h("div", { class: "app-upload-card-head" },
      h("h2", {}, "Upload client's CAS"),
      h("p", {}, "CAMS, KFintech, NSDL or CDSL — the format is detected automatically.")),
    dropzone,
    h("div", { class: "app-file-row" }, fileChip, clearButton),
    passwordField,
    analyzeButton,
    status,
    h("p", { class: "app-privacy" }, Icon("lock", { size: 14 }), " The statement is read inside this browser and is never uploaded to any server. No AI, no paid services.")
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (file && !analyzeButton.disabled) onAnalyze({ file, password: passwordInput.value });
  });

  const hero = h("section", { class: "site-band" },
    h("div", { class: "site-band-inner app-hero" },
      h("div", { class: "app-hero-copy" },
        h("div", { class: "ds-eyebrow site-reveal" }, "Advisor workspace"),
        h("h1", { class: "app-hero-title site-reveal", style: { "--i": 1 } },
          "Review any client's mutual fund portfolio ", h("span", { class: "site-gradient-text" }, "in seconds")),
        h("p", { class: "app-hero-lead site-reveal", style: { "--i": 2 } },
          "Upload a client's Consolidated Account Statement and get a verified, fund-by-fund view of their holdings, invested amount, gains and allocation, ready for your review meeting."),
        h("div", { class: "app-hero-chips site-reveal", style: { "--i": 3 } },
          TRUST.map(([icon, text]) => h("span", { class: "site-chip" }, Icon(icon, { size: 16 }), text)))
      ),
      form
    )
  );

  const steps = h("section", { class: "app-section" },
    h("div", { class: "app-section-head" },
      h("div", { class: "ds-eyebrow" }, "How it works"),
      h("h2", {}, "From client statement to portfolio review in four steps")),
    h("ol", { class: "app-steps" }, STEPS.map(([icon, title, text], i) =>
      h("li", { class: "app-step site-reveal", style: { "--accent": accentAt(i), "--i": i } },
        h("span", { class: "app-step-icon" }, Icon(icon, { size: 22 })),
        h("span", { class: "app-step-num" }, `Step ${i + 1}`),
        h("h3", {}, title),
        h("p", {}, text))))
  );

  const reports = h("section", { class: "app-section" },
    h("div", { class: "app-section-head" },
      h("div", { class: "ds-eyebrow" }, "Reports"),
      h("h2", {}, "Two reports to choose from after you analyse")),
    h("div", { class: "app-reports" }, REPORTS.map((report, i) =>
      h("article", { class: `app-report is-${report.variant} site-reveal`, style: { "--accent": report.accent, "--i": i } },
        h("div", { class: "home-report-art app-report-art", "aria-hidden": "true" },
          h("span", { class: "band top" }), h("span", { class: "band bottom" }),
          h("div", { class: "home-report-art-text" }, h("strong", {}, report.cover[0]), h("strong", {}, report.cover[1]))),
        h("div", {},
          h("h3", {}, report.title),
          h("p", {}, report.text),
          h("div", { class: "app-report-tags" }, report.tags.map((tag) => h("span", {}, tag))))))));

  const sources = h("section", { class: "app-section app-sources-line" },
    h("span", { class: "app-sources-label" }, "Works with"),
    SOURCES.map((name, i) => h("span", { class: "app-source-chip", style: { "--accent": accentAt(i) } }, Icon("check", { size: 14, strokeWidth: 2.5 }), name)));

  const element = h("main", { class: "app-upload" }, hero, h("div", { class: "app-container" }, reports, steps, sources));

  return {
    element,
    showPasswordField() {
      needsPassword = true;
      showPasswordField();
      updateAnalyzeButton();
    },
    setStatus,
    setBusy,
  };
}
