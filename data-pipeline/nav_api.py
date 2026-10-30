"""NAV history for the website (called by the local server for GET /api/nav-history?codes=…).

Usage (by serve.ps1):  python data-pipeline/nav_api.py [--years=N] 122639 100119 …
Output (stdout, JSON): { "from": "YYYY-MM-DD", "series": { "<code>": { "dates": [...], "navs": ["90.354600", ...] } },
                         "missing": [codes with no stored history] }
Only daily NAVs from YEARS_BACK years (plus a margin for the E1 lookups) are returned — enough for
1Y / 3Y / 5Y returns and the 3-year monthly risk window. --years=N (1–MAX_YEARS) asks for a longer window
(Fund Research: 10Y and calendar-year returns). NAVs are exact decimal strings.
Files are read through verified_cache: a local copy is used only while it matches the manifest's SHA-256, and a
download that does not match it is treated as missing. The Supabase key is read from .env here and never leaves the server.
"""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import settings  # noqa: E402
from nav_history import MANIFEST_PATH, from_parquet  # noqa: E402
from supabase_storage import StorageClient  # noqa: E402
from verified_cache import cached_manifest, prune, verified_bytes  # noqa: E402

MAX_CODES = 80
YEARS_BACK = 5
MAX_YEARS = 20
MARGIN_DAYS = 45   # covers the 10-day NEAREST-PREVIOUS step and month-end lookups at the window start


def years_option(argv: list[str]) -> tuple[int | None, list[str]]:
    """--years=N (1–MAX_YEARS) → (N, other args); (YEARS_BACK, argv) when absent; (None, …) when malformed."""
    rest = [a for a in argv if not a.startswith("--years=")]
    given = [a.split("=", 1)[1] for a in argv if a.startswith("--years=")]
    if not given:
        return YEARS_BACK, rest
    if len(given) > 1 or not given[0].isdigit() or not 1 <= int(given[0]) <= MAX_YEARS:
        return None, rest
    return int(given[0]), rest


def main(argv: list[str]) -> int:
    years, argv = years_option(argv)
    codes = sorted({int(a) for a in argv if a.isdigit()})
    if years is None or not codes or len(codes) > MAX_CODES or len(codes) != len(set(argv)):
        print(json.dumps({"error": "bad scheme code list"}))
        return 2
    today = date.today()
    start = date(today.year - years, today.month, min(today.day, 28)) - timedelta(days=MARGIN_DAYS)
    connection = settings.supabase()
    client = StorageClient(connection)
    bucket = connection.get("bucket") or "mf-data"
    manifest = cached_manifest(client, MANIFEST_PATH, bucket)
    if manifest is None:
        print(json.dumps({"error": "NAV manifest not available"}))
        return 1
    files = {f["schemeCode"]: f for f in manifest.get("files", [])}

    def one(code):
        entry = files.get(code)
        data = verified_bytes(client, entry["path"], entry.get("sha256"), bucket) if entry else None
        if data is None:
            return code, None
        rows = [(d, n) for d, n in sorted(from_parquet(data)) if d >= start]
        return code, {"dates": [d.isoformat() for d, _ in rows], "navs": [str(n) for _, n in rows]}

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(pool.map(one, codes))
    out = {"from": start.isoformat(),
           "series": {str(c): s for c, s in results.items() if s},
           "missing": [c for c, s in results.items() if not s]}
    sys.stdout.write(json.dumps(out, separators=(",", ":")))
    prune(bucket)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
