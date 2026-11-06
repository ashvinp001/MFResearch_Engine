// Runs a data-pipeline script (Python does the heavy data work) and returns its stdout.
// No shell is involved: arguments go straight to the process, and every route validates them first.
import { execFile } from "node:child_process";
import path from "node:path";
import { LIMITS, PIPELINE_DIR, PYTHON, ROOT } from "../config.js";
import { log } from "./logger.js";

let running = 0;
const waiting = [];
async function acquire() {
  if (running < LIMITS.pythonConcurrency) { running++; return; }
  await new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else running--;
}

class PythonError extends Error {}

/**
 * Resolves { stdout, code }. Rejects with PythonError when the script cannot start, times out, or exits
 * non-zero — except that with allowFailure a script's own non-zero exit still resolves (its stdout is the reply).
 */
export async function runPipeline(script, args = [], { input, allowFailure = false } = {}) {
  await acquire();
  try {
    return await new Promise((resolve, reject) => {
      const child = execFile(
        PYTHON,
        ["-I", path.join(PIPELINE_DIR, script), ...args],
        {
          cwd: ROOT,
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
          timeout: LIMITS.pythonTimeoutMs,
          maxBuffer: LIMITS.pythonOutput,
          windowsHide: true,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          const code = !error ? 0 : typeof error.code === "number" && !error.killed ? error.code : -1;
          const out = (stdout || "").trim();
          // The script's own error text is kept in the server log (and in container logs), not dropped.
          if (code !== 0) log(`${script} exit ${code}: ${String(stderr || error.message || "").slice(-1200)}`);
          if (code === 0 || (allowFailure && code > 0)) resolve({ stdout: out, code });
          else reject(new PythonError(`${script} failed (exit ${code})`));
        },
      );
      child.stdin.on("error", () => {});   // the script may exit before reading its input
      child.stdin.end(input ?? "");
    });
  } finally {
    release();
  }
}
