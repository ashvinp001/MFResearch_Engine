"""The daily data job — runs once a day in the cloud (GitHub Actions, .github/workflows/daily-data.yml, 07:00 IST).
No PC has to be on. It can also be run by hand: python data-pipeline/run_daily.py

Steps, in order:
  0. Fund lists: the current lists are taken from Supabase (schemes/), so the run builds on yesterday's lists
     wherever it runs (the copy in git can be old).
  1. Fund NAVs            daily_update.py      — retried up to 3 times (each run is idempotent and self-healing)
  2. Benchmark prices     benchmark_daily.py   — retried up to 2 times
  3. Peer statistics      peer_stats.py        — ONLY after step 1 succeeded: statistics are never built from a
                                                 half-finished NAV update (the previous file stays live)
  4. Fund details (AUM)   fund_metadata.py     — a failure keeps the previous file
A day that is missed for any reason is filled by the next run: every step reads back over the last weeks.
Exit code 0 only when every step succeeded; otherwise 1, and GitHub e-mails the repository owner.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import settings  # noqa: E402
from scheme_lists import FILES, LISTS_DIR, check, read_lists  # noqa: E402
from supabase_storage import StorageClient  # noqa: E402

RETRY_WAIT_SECONDS = 300   # AMFI / PulseDB hiccups usually clear within minutes


def log(text: str) -> None:
    print(f"[{datetime.now(settings.IST):%Y-%m-%d %H:%M:%S} IST] {text}", flush=True)


def sync_lists() -> None:
    """Supabase schemes/*.json → data/schemes/, only when all three files are present and pass every check."""
    client = StorageClient(settings.supabase())
    with tempfile.TemporaryDirectory() as folder:
        temp = Path(folder)
        for name in FILES.values():
            data = client.download(f"schemes/{name}")
            if not data:
                raise RuntimeError(f"schemes/{name} not found in Supabase")
            (temp / name).write_bytes(data)
        schemes = read_lists(temp)
        check(schemes)
        LISTS_DIR.mkdir(parents=True, exist_ok=True)
        for name in FILES.values():
            (LISTS_DIR / name).write_bytes((temp / name).read_bytes())
    as_of = json.loads((LISTS_DIR / "regular.json").read_text(encoding="utf-8")).get("dataAsOf")
    log(f"fund lists taken from Supabase: {len(schemes)} schemes, AMFI data as of {as_of}")


def run_step(title: str, script: str, attempts: int) -> bool:
    for attempt in range(1, attempts + 1):
        log(f"=== {title}" + (f" (attempt {attempt} of {attempts})" if attempt > 1 else "") + " ===")
        code = subprocess.call([sys.executable, "-u", str(HERE / script)], cwd=HERE.parent)
        if code == 0:
            return True
        log(f"{title} exited with code {code}")
        if attempt < attempts:
            log(f"waiting {RETRY_WAIT_SECONDS // 60} minutes before trying again")
            time.sleep(RETRY_WAIT_SECONDS)
    return False


def main() -> int:
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    results: dict[str, str] = {}
    try:
        sync_lists()
        results["Fund lists"] = "ok"
    except Exception as error:   # without yesterday's lists the NAV update must not start
        log(f"ERROR fund lists could not be taken from Supabase: {error!r}")
        results["Fund lists"] = "FAILED"

    navs_ok = results["Fund lists"] == "ok" and run_step("Fund NAVs", "daily_update.py", attempts=3)
    results["Fund NAVs"] = "ok" if navs_ok else "FAILED"
    results["Benchmarks"] = "ok" if run_step("Benchmark prices", "benchmark_daily.py", attempts=2) else "FAILED"
    if navs_ok:
        results["Peer statistics"] = "ok" if run_step("Peer statistics", "peer_stats.py", attempts=2) else "FAILED"
    else:
        log("Peer statistics skipped: the NAV update did not finish — yesterday's statistics stay live")
        results["Peer statistics"] = "SKIPPED (previous file kept)"
    results["Fund details"] = "ok" if run_step("Fund details", "fund_metadata.py", attempts=2) else "FAILED"

    log("=== summary ===")
    for step, outcome in results.items():
        log(f"  {step}: {outcome}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write("### Daily data update\n\n| Step | Result |\n|---|---|\n")
            out.writelines(f"| {step} | {outcome} |\n" for step, outcome in results.items())
    return 0 if all(outcome == "ok" for outcome in results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
