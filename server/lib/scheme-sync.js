// Keeps data/schemes/ (the AMFI fund lists the website and the Python helpers read) in step with Supabase, where
// the daily cloud job (GitHub Actions) writes them. Runs when the server starts and every 30 minutes. A file is
// replaced only when all three lists download, parse and look complete; otherwise the files on disk stay as they are.
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../config.js";
import { log } from "./logger.js";
import { downloadObject } from "./supabase.js";

const LISTS = { Regular: "regular.json", Direct: "direct.json", ETF: "etf.json" };
const DIR = path.join(ROOT, "data", "schemes");
const EVERY_MS = 30 * 60 * 1000;
let lastAsOf = null;

/** The three lists from Supabase, checked like scheme_lists.read_lists (right plan, count matches, not empty). */
async function fetchLists() {
  const out = {};
  for (const [plan, name] of Object.entries(LISTS)) {
    const body = await downloadObject(`schemes/${name}`);
    const list = JSON.parse(body.toString("utf8"));
    if (list.plan !== plan || !Array.isArray(list.schemes) || list.schemes.length !== list.count || !list.count) {
      throw new Error(`schemes/${name} is not a valid ${plan} list`);
    }
    out[name] = { body, asOf: list.dataAsOf };
  }
  return out;
}

export async function syncSchemeLists() {
  try {
    const lists = await fetchLists();
    for (const [name, { body }] of Object.entries(lists)) {
      const target = path.join(DIR, name);
      await writeFile(`${target}.tmp`, body);
      await rename(`${target}.tmp`, target);
    }
    const asOf = lists[LISTS.Regular].asOf;
    if (asOf !== lastAsOf) log(`fund lists updated from Supabase (AMFI data as of ${asOf})`);
    lastAsOf = asOf;
  } catch (error) {
    log(`fund lists not updated from Supabase (the files on disk are kept): ${error.message}`);
  }
}

export function startSchemeSync() {
  syncSchemeLists();
  setInterval(syncSchemeLists, EVERY_MS).unref();
}
