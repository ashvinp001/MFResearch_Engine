// The website's own files. Credentials and non-website folders are never served; a visitor that is not this PC
// (only possible inside the Docker container) sees only the website itself (REMOTE_ALLOWED).
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { REMOTE_ALLOWED, MIME, PRIVATE_PATH, ROOT } from "../config.js";
import { send, sendText } from "../lib/http.js";

const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
const insideRoot = (file) => file.toLowerCase().startsWith(rootWithSep.toLowerCase());

/** The relative path a visitor may open, or null when it must answer 404. */
export function allowedPath(pathname, isLocalPc) {
  let relative;
  try { relative = decodeURIComponent(pathname).replace(/\\/g, "/").replace(/^\/+/, ""); } catch { return null; }
  if (relative === "") relative = "index.html";
  if (relative.includes("\0") || PRIVATE_PATH.test(relative)) return null;
  if (!isLocalPc && !REMOTE_ALLOWED.test(relative)) return null;
  return relative;
}

export async function serveStatic({ res, pathname, isLocalPc }) {
  const relative = allowedPath(pathname, isLocalPc);
  if (!relative) return sendText(res, 404, "Not found");
  let file = path.resolve(ROOT, relative);
  if (!insideRoot(file)) return sendText(res, 404, "Not found");
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    const body = await readFile(file);
    send(res, 200, MIME[path.extname(file).toLowerCase()] || "application/octet-stream", body);
  } catch {
    sendText(res, 404, "Not found");
  }
}
